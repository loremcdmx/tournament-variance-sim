/**
 * The Monte Carlo hot loop. `simulateShard` runs a disjoint `[sStart, sEnd)`
 * slice of samples; the worker pool runs slices on separate cores and merges
 * the raw buffers (see `mergeShards` in `engine.ts`).
 *
 * Determinism contract: `SimulationInput + seed` → byte-identical `RawShard`
 * regardless of how samples are sharded. No `Math.random`, no `Date.now` —
 * only `sampleStream(seed, sampleIdx, channel)`, each stochastic channel its
 * own stream id, `sampleIdx` the GLOBAL index in `[0, samples)`. No allocations inside the per-sample inner loop — all
 * scratch is preallocated per shard and reused.
 */
import {
  battleRoyaleLeaderboardPoints,
  normalizeBattleRoyaleLeaderboardConfig,
  sampleBattleRoyaleLeaderboardWindow,
} from "./battleRoyaleLeaderboard";
import {
  HEAT_BIN_SCALE,
  HEAT_Z_RANGE,
  JACKPOT_THRESHOLD,
} from "./engineConstants";
import type {
  CheckpointGrid,
  CompiledSchedule,
  DownsideShard,
  RawShard,
} from "./engineTypes";
import { makeHiResGrid } from "./grids";
import {
  STREAM_BOUNTY,
  STREAM_FINISH,
  STREAM_LEADERBOARD,
  STREAM_OCEAN,
  STREAM_SKILL,
  sampleStream,
} from "./rng";
import { poissonPTRS } from "./simNumerics";
import { createOceanKoScratch, sampleOceanKoBounty } from "./oceanKo";
import {
  createFirstReturnScratch,
  createPathChordScratch,
  scanFirstReturns,
  scanPathChords,
} from "./pathChords";
import {
  createDownsideReportArrays,
  createDownsideReportState,
  observeDownsideReport,
  resetDownsideReportState,
  saveDownsideReportState,
} from "./downsideReport";
import type { SimulationInput } from "./types";

export type ProgressCb = (done: number, total: number) => void;

/**
 * Marsaglia polar gaussian factory. The polar method natively yields two
 * independent N(0,1) draws per accepted (u,v); this factory caches the
 * second, halving `log`/`sqrt` cost on the second call. Bind one closure
 * per RNG stream at the top of the hot loop.
 */
function makeGauss(rng: () => number): () => number {
  let hasCached = false;
  let cached = 0;
  return () => {
    if (hasCached) {
      hasCached = false;
      return cached;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = rng() * 2 - 1;
      v = rng() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    cached = v * m;
    hasCached = true;
    return u * m;
  };
}

export function simulateShard(
  input: SimulationInput,
  compiled: CompiledSchedule,
  sStart: number,
  sEnd: number,
  grid: CheckpointGrid,
  onProgress?: ProgressCb,
): RawShard {
  return simulateShardInternal(input, compiled, sStart, sEnd, grid, onProgress, true);
}

export function simulateDownsideShard(
  input: SimulationInput,
  compiled: CompiledSchedule,
  sStart: number,
  sEnd: number,
  grid: CheckpointGrid,
  onProgress?: ProgressCb,
): DownsideShard {
  if (!input.collectDownsideReport) throw new Error("engine: downside collection must be enabled");
  const { finalProfits, pathMatrix, maxDrawdowns, recoveryLengths, downsideReport } =
    simulateShardInternal(input, compiled, sStart, sEnd, grid, onProgress, false);
  return { finalProfits, pathMatrix, maxDrawdowns, recoveryLengths, downsideReport };
}

function simulateShardInternal(
  input: SimulationInput,
  compiled: CompiledSchedule,
  sStart: number,
  sEnd: number,
  grid: CheckpointGrid,
  onProgress: ProgressCb | undefined,
  collectDetails: boolean,
): RawShard {
  const { K, checkpointIdx } = grid;
  const K1 = K + 1;
  const N = compiled.tournamentsPerSample;
  const numRows = input.schedule.length;
  const bankroll = input.bankroll;
  const shardSize = sEnd - sStart;

  const downsideReport = input.collectDownsideReport ? createDownsideReportArrays(shardSize) : undefined;
  const downsideState = downsideReport ? createDownsideReportState() : null;

  const finalProfits = new Float64Array(shardSize);
  const pathMatrix = new Float64Array(shardSize * K1);
  const chordScratch = collectDetails ? createPathChordScratch(K1) : null;
  // With a checkpoint at every tournament the grid scan already reads every
  // tournament, and runs of 240 or fewer keep their old bytes.
  const firstReturns = collectDetails && K < N ? createFirstReturnScratch(K) : null;
  const profitTrace = new Float64Array(firstReturns ? N + 1 : 0);
  const maxDrawdowns = new Float64Array(shardSize);
  const maxRunUps = new Float64Array(shardSize);
  const runningMins = new Float64Array(shardSize);
  const longestBreakevens = new Float64Array(collectDetails ? shardSize : 0);
  const breakevenStreakAvgs = new Float64Array(collectDetails ? shardSize : 0);
  const longestCashless = new Int32Array(shardSize);
  const recoveryLengths = new Int32Array(shardSize);
  const satelliteSeatsWon = compiled.flat.some((entry) => entry.isSatellite)
    ? new Uint32Array(shardSize * input.schedule.length)
    : null;
  const rowProfits = new Float64Array(shardSize * numRows);
  const rowBountyProfits = new Float64Array(shardSize * numRows);
  const jackpotMask = new Uint8Array(shardSize);
  let oceanMaxField = 0;
  for (const entry of compiled.flat) {
    if (entry.variants) {
      for (const variant of entry.variants) {
        if (variant.oceanKo) oceanMaxField = Math.max(oceanMaxField, variant.fieldSize);
      }
    } else if (entry.oceanKo) oceanMaxField = Math.max(oceanMaxField, entry.fieldSize);
  }
  const oceanScratch = oceanMaxField > 0 ? createOceanKoScratch(oceanMaxField) : null;
  const leaderboardConfig = normalizeBattleRoyaleLeaderboardConfig(
    input.battleRoyaleLeaderboard,
  );
  const hasBattleRoyaleRows = compiled.flat.some((entry) => entry.isBattleRoyale);
  const leaderboardActive = leaderboardConfig !== null && hasBattleRoyaleRows;
  const leaderboardPoints = leaderboardActive ? new Float64Array(shardSize) : null;
  const leaderboardPayouts = leaderboardActive ? new Float64Array(shardSize) : null;
  const leaderboardExpectedPayouts = leaderboardActive
    ? new Float64Array(shardSize)
    : null;
  const leaderboardWindows = leaderboardActive ? new Int32Array(shardSize) : null;
  const leaderboardPaidWindows = leaderboardActive ? new Int32Array(shardSize) : null;
  const leaderboardRankSums = leaderboardActive ? new Int32Array(shardSize) : null;
  const leaderboardKnockouts = leaderboardActive ? new Int32Array(shardSize) : null;
  const leaderboardFirsts = leaderboardActive ? new Int32Array(shardSize) : null;
  const leaderboardSeconds = leaderboardActive ? new Int32Array(shardSize) : null;
  const leaderboardThirds = leaderboardActive ? new Int32Array(shardSize) : null;
  // Per-length streak counters. Cashless is indexed by integer tournament
  // count so it's allocated at N+1. Breakeven is indexed by chord-grid
  // position (0..K) to keep the downstream histogram aligned to the
  // chord quantum — see histogramFromCounts call at buildResult.
  const breakevenStreakCounts = new Int32Array(collectDetails ? K + 1 : 0);
  const cashlessStreakCounts = new Int32Array(N + 1);
  let ruinedCount = 0;

  // Hi-res capture. Allocated per-shard regardless of shard size so the
  // RawShard contract stays uniform (mergeShards can safely read fields
  // even on single-sample shards).
  const hiGrid = collectDetails ? makeHiResGrid(N) : { K: 0, checkpointIdx: new Int32Array(0) };
  const hiK = hiGrid.K;
  const hiK1 = collectDetails ? hiK + 1 : 0;
  const hiCheckpointIdx = hiGrid.checkpointIdx;
  // Select global sample indices so sharding cannot change the visible runs.
  const HI_RES_GLOBAL_CAP = 1000;
  const wantHiResPaths = collectDetails ? Math.max(0, Math.min(sEnd, HI_RES_GLOBAL_CAP) - sStart) : 0;
  const hiResPaths: Float64Array[] = new Array(wantHiResPaths);
  for (let i = 0; i < wantHiResPaths; i++) hiResPaths[i] = new Float64Array(hiK1);
  const hiResSampleIndices = new Int32Array(wantHiResPaths);
  const hiResBestPath = new Float64Array(hiK1);
  const hiResWorstPath = new Float64Array(hiK1);
  const hiResScratch = new Float64Array(hiK1);
  let hiResBestFinal = Number.NEGATIVE_INFINITY;
  let hiResWorstFinal = Number.POSITIVE_INFINITY;
  // Pointwise min/max across ALL samples in this shard, computed on the
  // hi-res grid (not the K=80 low-res grid). Checkpoint 0 is t=0 / profit=0
  // for every sample, so the envelope pins to 0 there.
  const hiResMin = new Float64Array(hiK1);
  const hiResMax = new Float64Array(hiK1);
  for (let j = 1; j < hiK1; j++) {
    hiResMin[j] = Number.POSITIVE_INFINITY;
    hiResMax[j] = Number.NEGATIVE_INFINITY;
  }

  const roiStdErr = Math.max(0, input.roiStdErr ?? 0);
  const sigTourney = Math.max(0, input.roiShockPerTourney ?? 0);
  const sigSession = Math.max(0, input.roiShockPerSession ?? 0);
  const sigDrift = Math.max(0, input.roiDriftSigma ?? 0);
  const driftRho = Math.max(0, Math.min(0.999, input.roiDriftRho ?? 0.95));
  const driftInnovScale = sigDrift * Math.sqrt(1 - driftRho * driftRho);

  const tiltFastGain = input.tiltFastGain ?? 0;
  const tiltFastScale = Math.max(1, input.tiltFastScale ?? 0);
  const tiltFastOn = tiltFastGain !== 0 && tiltFastScale > 0;
  const tiltSlowGain = input.tiltSlowGain ?? 0;
  const tiltSlowThreshold = Math.max(0, input.tiltSlowThreshold ?? 0);
  const tiltSlowMinDur = Math.max(
    0,
    Math.floor(input.tiltSlowMinDuration ?? 500),
  );
  const tiltSlowRecFrac = Math.max(
    0,
    Math.min(1, input.tiltSlowRecoveryFrac ?? 0.5),
  );
  const tiltSlowOn =
    tiltSlowGain !== 0 && tiltSlowThreshold > 0 && tiltSlowMinDur > 0;
  const tiltSlowHoldFrac = 1 - tiltSlowRecFrac;
  // An extreme over the whole sample drifts away like sqrt(distance), so a
  // fixed depth fires ever more often on a longer run; over a trailing window
  // the swing a tilt reads is stationary. Unset or under 1 keeps the
  // all-time extremes.
  //
  // The window of point k holds the points k - W .. k. Cut the path into
  // blocks of B = W + 1 points: the window is the tail of the previous block
  // and the head of the current one, so its extreme is the previous block's
  // suffix extreme (one backward pass when a block fills) against the
  // current block's running one: O(1) amortised, and unlike a monotonic
  // deque no loop runs a data-dependent number of times. With W >= N the
  // whole run is one block.
  const tiltFastWindow = Math.floor(input.tiltFastWindow ?? 0);
  const tiltSlowWindow = Math.floor(input.tiltSlowWindow ?? 0);
  const fastWindowed = tiltFastOn && tiltFastWindow >= 1;
  const slowWindowed = tiltSlowOn && tiltSlowWindow >= 1;
  const fastBlock = fastWindowed ? Math.min(tiltFastWindow, N) + 1 : 0;
  const fastBlockVals = new Float64Array(fastBlock);
  const fastSuffixMax = new Float64Array(fastBlock);
  const slowBlock = slowWindowed ? Math.min(tiltSlowWindow, N) + 1 : 0;
  const slowBlockVals = new Float64Array(slowBlock);
  const slowSuffixMax = new Float64Array(slowBlock);
  const slowSuffixMin = new Float64Array(slowBlock);
  // Slow tilt reads its swings off profit minus this prefix: on raw profit a
  // winner's rise from the all-time low only grows and "up" would never end.
  const expectedProfitPrefix = downsideReport || tiltSlowOn ? new Float64Array(N) : null;
  if (expectedProfitPrefix) {
    let expectedProfit = 0;
    for (let i = 0; i < N; i++) {
      const entry = compiled.flat[i];
      const variants = entry.variants;
      const mean = variants?.length
        ? variants.reduce((sum, variant) => sum + variant.analyticMeanSingle - variant.singleCost + variant.rakebackBonusPerBullet, 0) / variants.length
        : entry.analyticMeanSingle - entry.singleCost + entry.rakebackBonusPerBullet;
      expectedProfit += mean;
      expectedProfitPrefix[i] = expectedProfit;
    }
  }
  // Hot-loop fast path: when every shock/tilt source is off, effectiveDelta
  // is provably 0 every iteration, so we can skip the whole block and the
  // session/drift modulo check per tournament.
  const hasShocks =
    roiStdErr > 0 ||
    sigSession > 0 ||
    sigDrift > 0 ||
    sigTourney > 0 ||
    tiltFastOn ||
    tiltSlowOn;

  // Counted on the index within the sample, so neither the count x repeats
  // split nor a shard boundary moves a session.
  const requestedSessionLen = input.tournamentsPerSession;
  const sessionLen =
    requestedSessionLen === undefined || Number.isNaN(requestedSessionLen)
      ? compiled.tournamentsPerPass
      : Math.max(1, Math.floor(requestedSessionLen));
  const flat = compiled.flat;

  // Adaptive progress ticks: tiny shards feel laggy with < 20 ticks, huge
  // shards spam the main thread. Scale with log of shard size so a 5k shard
  // fires ~20 and a 500k shard fires ~40, without ever dropping below 15.
  const progressTicks = Math.max(
    15,
    Math.min(40, Math.round(15 + Math.log10(Math.max(1, shardSize / 1000)) * 10)),
  );
  const nextProgressStep = Math.max(1, Math.floor(shardSize / progressTicks));
  let nextProgressAt = nextProgressStep;

  for (let s = sStart; s < sEnd; s++) {
    const localS = s - sStart;
    if (downsideState) resetDownsideReportState(downsideState);
    const rng = sampleStream(input.seed, s, STREAM_FINISH);
    // Per-sample shock RNG — decoupled from finish draws and
    // independent of shard boundaries.
    const skillRng = sampleStream(input.seed, s, STREAM_SKILL);
    // Dedicated RNG for within-place bounty noise — kept separate so adding
    // a bounty flag doesn't perturb the finish-sampling stream (otherwise
    // same-seed comparison tests between bounty and non-bounty runs drift).
    const bRng = sampleStream(input.seed, s, STREAM_BOUNTY);
    const oceanRng = oceanScratch
      ? sampleStream(input.seed, s, STREAM_OCEAN)
      : null;
    const leaderboardRng = leaderboardActive
      ? sampleStream(input.seed, s, STREAM_LEADERBOARD)
      : null;
    // Cached-pair gaussians bound to each stream — halves log/sqrt cost
    // relative to the discarding boxMuller.
    const gaussSkill = makeGauss(skillRng);
    const gaussB = makeGauss(bRng);

    const deltaROI = roiStdErr > 0 ? gaussSkill() * roiStdErr : 0;
    let drift = 0;
    let sessionShock = 0;
    let tiltState: -1 | 0 | 1 = 0;
    let tiltAnchor = 0;
    let tiltStreakLen = 0;
    let tiltStreakSide: -1 | 0 | 1 = 0;
    let tiltSwingMag = 0;
    let tiltExpected = 0;
    let tiltXMax = 0;
    let tiltXMin = 0;
    // The first block starts with the point before the first tournament,
    // profit 0, as the all-time extremes do; the window reads below are kept
    // in tiltFastPeak / tiltXMax / tiltXMin.
    let tiltFastPeak = 0;
    let fastBlockAt = 1;
    let fastBlockMax = 0;
    let fastHasPrev = false;
    if (fastWindowed) fastBlockVals[0] = 0;
    let slowBlockAt = 1;
    let slowBlockMax = 0;
    let slowBlockMin = 0;
    let slowHasPrev = false;
    if (slowWindowed) slowBlockVals[0] = 0;
    let profit = 0;
    let runningMax = 0;
    let runningMin = 0;
    let maxDD = 0;
    let maxUp = 0;
    let cashlessRun = 0;
    let longestCashlessRun = 0;
    let ddTroughIdx = -1;
    let sampleRecoveryLen = -1;
    let ruined = false;
    let leaderboardWindowScore = 0;
    let leaderboardTournaments = 0;
    let leaderboardTotalPoints = 0;
    let leaderboardTotalPayout = 0;
    let leaderboardTotalExpectedPayout = 0;
    let leaderboardSettledWindows = 0;
    let leaderboardPaid = 0;
    let leaderboardRankSum = 0;
    let leaderboardKoTotal = 0;
    let leaderboardFirstTotal = 0;
    let leaderboardSecondTotal = 0;
    let leaderboardThirdTotal = 0;

    let nextCp = 1;
    let nextCpIdx = checkpointIdx[1];
    const pathBase = localS * K1;
    const rowBase = localS * numRows;

    // Hi-res scratch starts at 0 (pre-tournament profit). We always capture
    // into scratch so the shardBest/Worst swap at end-of-sample sees the full
    // trajectory regardless of which sample turns out extreme.
    if (collectDetails) hiResScratch[0] = 0;
    let nextHiCp = 1;
    let nextHiCpIdx = hiCheckpointIdx[1];

    for (let i = 0; i < N; i++) {
      let effectiveDelta = 0;
      if (hasShocks) {
      if ((sigSession > 0 || sigDrift > 0) && i % sessionLen === 0) {
        if (sigSession > 0) sessionShock = gaussSkill() * sigSession;
        if (sigDrift > 0)
          drift = driftRho * drift + gaussSkill() * driftInnovScale;
      }
      const tourneyShock =
        sigTourney > 0 ? gaussSkill() * sigTourney : 0;

      let tiltShift = 0;
      if (tiltFastOn) {
        const peak = fastWindowed ? tiltFastPeak : runningMax;
        tiltShift +=
          tiltFastGain * Math.tanh((peak - profit) / tiltFastScale);
      }
      if (tiltSlowOn) {
        const x = profit - tiltExpected;
        if (tiltState === 0) {
          const dd = tiltXMax - x;
          const up = x - tiltXMin;
          const side: -1 | 0 | 1 =
            dd >= tiltSlowThreshold ? -1 : up >= tiltSlowThreshold ? 1 : 0;
          if (side === 0) {
            tiltStreakLen = 0;
            tiltStreakSide = 0;
          } else {
            if (side !== tiltStreakSide) {
              tiltStreakSide = side;
              tiltStreakLen = 0;
            }
            tiltStreakLen++;
            if (tiltStreakLen >= tiltSlowMinDur) {
              tiltState = side;
              tiltAnchor = x;
              tiltSwingMag = side === -1 ? dd : up;
              tiltStreakLen = 0;
              tiltStreakSide = 0;
            }
          }
        } else if (tiltState === -1) {
          tiltShift -= tiltSlowGain;
          // Winning back that share of the swing is the gap to the peak
          // shrinking to the rest of it. Read from the window's peak, an old
          // peak stops holding the state once it is forgotten.
          if (
            slowWindowed
              ? tiltXMax - x <= tiltSlowHoldFrac * tiltSwingMag
              : x - tiltAnchor >= tiltSlowRecFrac * tiltSwingMag
          ) {
            tiltState = 0;
            tiltStreakLen = 0;
            tiltStreakSide = 0;
          }
        } else {
          tiltShift += tiltSlowGain;
          if (
            slowWindowed
              ? x - tiltXMin <= tiltSlowHoldFrac * tiltSwingMag
              : tiltAnchor - x >= tiltSlowRecFrac * tiltSwingMag
          ) {
            tiltState = 0;
            tiltStreakLen = 0;
            tiltStreakSide = 0;
          }
        }
      }

      effectiveDelta =
        deltaROI + drift + sessionShock + tourneyShock + tiltShift;
      }

      const parent = flat[i];
      const variants = parent.variants;
      const t = variants
        ? variants[(rng() * variants.length) | 0]
        : parent;
      let bp = t.bountyByPlace;
      const bkm = t.bountyKmean;
      const bkmExp = t.bountyKmeanExp;
      const bkmInv = t.bountyKmeanInv;
      const prizes = t.prizeByPlace;
      const aliasProb = t.aliasProb;
      const aliasIdx = t.aliasIdx;
      // PKO latent heat: one gauss draw per tourney selects a reshaped
      // bbp bin from the precomputed bank. Disabled → this branch is
      // never entered, so no extra RNG is consumed and the legacy PKO
      // path is bit-exact preserved.
      const heatBountyByPlace = t.heatBountyByPlace;
      if (heatBountyByPlace !== null) {
        const zh = gaussB();
        let zc = zh;
        if (zc < -HEAT_Z_RANGE) zc = -HEAT_Z_RANGE;
        else if (zc > HEAT_Z_RANGE) zc = HEAT_Z_RANGE;
        const bi = ((zc + HEAT_Z_RANGE) * HEAT_BIN_SCALE + 0.5) | 0;
        bp = heatBountyByPlace[bi];
      }
      const aliasN = aliasProb.length;
      const single = t.singleCost;
      const bulletCost = single - effectiveDelta * single;
      const rakebackPerBullet = t.rakebackBonusPerBullet;
      const pc = t.paidCount;
      const mystVar = t.mysteryBountyLogVar;
      const mystSig = t.mysteryBountyLogSigma;
      const brRatios = t.brTierRatios;
      const brAliasProb = t.brTierAliasProb;
      const brAliasIdx = t.brTierAliasIdx;
      const isBattleRoyale = t.isBattleRoyale;
      let delta = 0;
      let cashedThisSlot = false;
      let leaderboardPlace = -1;
      let leaderboardKnockoutsThisSlot = 0;
      {
        // Vose alias: one uniform → O(1) finish draw.
        const r0 = rng() * aliasN;
        const i0 = r0 | 0;
        const place = r0 - i0 < aliasProb[i0] ? i0 : aliasIdx[i0];
        leaderboardPlace = place;
        let bountyDraw = 0;
        if (t.oceanKo && oceanScratch && oceanRng) {
          bountyDraw = sampleOceanKoBounty(t.oceanKo, place, oceanRng, oceanScratch);
          if (oceanScratch.jackpot) jackpotMask[localS] = 1;
        } else if (bp !== null) {
          const mean = bp[place];
          const koCash = t.pkoKoCash;
          if (koCash !== null) {
            if (mean > 0) {
              // The knockout at j is a Bernoulli(1/j); the gap to the next
              // one is drawn directly (P(none in j+1..k) = j / k), so a
              // tournament costs one uniform per knockout plus one.
              const lastJ = koCash.length - 1;
              const koSig = t.pkoKoLogSigma![place];
              const koHalfVar = 0.5 * koSig * koSig;
              let haul = place === 0 ? t.pkoWinnerHead : 0;
              let sumRatio = 0;
              let j = place === 0 ? 1 : Math.floor(place / bRng()) + 1;
              while (j <= lastJ) {
                if (koSig > 0) {
                  const ratio = Math.exp(koSig * gaussB() - koHalfVar);
                  sumRatio += ratio;
                  haul += koCash[j] * ratio;
                } else {
                  haul += koCash[j];
                }
                j = Math.floor(j / bRng()) + 1;
              }
              const shrink = t.pkoHaulShrink![place];
              if (shrink < 1 && haul > 0) haul = shrink * haul + t.pkoHaulShift![place];
              bountyDraw = mean * t.pkoRawInv![place] * haul;
              if (sumRatio >= JACKPOT_THRESHOLD) jackpotMask[localS] = 1;
            }
          } else if (mean > 0 && bkm !== null) {
            const lam = bkm[place];
            if (lam > 0) {
              let k: number;
              if (lam < 30) {
                const L = bkmExp![place];
                let p = 1;
                k = 0;
                do {
                  k++;
                  p *= bRng();
                } while (p > L);
                k--;
              } else {
                k = poissonPTRS(lam, bRng);
              }
              bountyDraw = mean * k * bkmInv![place];
              if (k > 0 && bountyDraw > 0) {
                if (brRatios !== null) {
                  const perKO = mean * bkmInv![place];
                  bountyDraw = 0;
                  let sumRatio = 0;
                  for (let j = 0; j < k; j++) {
                    const rT = bRng() * 10;
                    const iT = rT | 0;
                    const pick = rT - iT < brAliasProb![iT] ? iT : brAliasIdx![iT];
                    const ratio = brRatios[pick];
                    sumRatio += ratio;
                    bountyDraw += perKO * ratio;
                  }
                  leaderboardKnockoutsThisSlot = k;
                  if (sumRatio >= JACKPOT_THRESHOLD) jackpotMask[localS] = 1;
                } else if (mystVar > 0) {
                  const perKO = mean * bkmInv![place];
                  bountyDraw = 0;
                  let sumRatio = 0;
                  for (let j = 0; j < k; j++) {
                    const ratio = Math.exp(mystSig * gaussB() - 0.5 * mystVar);
                    sumRatio += ratio;
                    bountyDraw += perKO * ratio;
                  }
                  leaderboardKnockoutsThisSlot = k;
                  if (sumRatio >= JACKPOT_THRESHOLD) jackpotMask[localS] = 1;
                }
                if (brRatios === null) leaderboardKnockoutsThisSlot = 0;
              }
            } else {
              bountyDraw = mean;
            }
          } else {
            bountyDraw = mean;
          }
        }
        delta = prizes[place] + bountyDraw - bulletCost + rakebackPerBullet;
        if (bountyDraw !== 0) rowBountyProfits[rowBase + t.rowIdx] += bountyDraw;
        if (place < pc) cashedThisSlot = true;
      }
      profit += delta;
      if (downsideState && expectedProfitPrefix) observeDownsideReport(downsideState, profit, expectedProfitPrefix[i], delta, single);
      if (tiltSlowOn) {
        tiltExpected = expectedProfitPrefix![i];
        const x = profit - tiltExpected;
        if (slowWindowed) {
          // Inline on purpose: V8 does not inline a helper into this function.
          slowBlockVals[slowBlockAt] = x;
          if (x > slowBlockMax) slowBlockMax = x;
          if (x < slowBlockMin) slowBlockMin = x;
          tiltXMax = slowBlockMax;
          tiltXMin = slowBlockMin;
          if (slowHasPrev && slowBlockAt + 1 < slowBlock) {
            if (slowSuffixMax[slowBlockAt + 1] > tiltXMax) tiltXMax = slowSuffixMax[slowBlockAt + 1];
            if (slowSuffixMin[slowBlockAt + 1] < tiltXMin) tiltXMin = slowSuffixMin[slowBlockAt + 1];
          }
          if (++slowBlockAt === slowBlock) {
            let hi = slowBlockVals[slowBlock - 1];
            let lo = hi;
            for (let j = slowBlock - 1; j >= 0; j--) {
              const v = slowBlockVals[j];
              if (v > hi) hi = v;
              if (v < lo) lo = v;
              slowSuffixMax[j] = hi;
              slowSuffixMin[j] = lo;
            }
            slowBlockAt = 0;
            slowBlockMax = Number.NEGATIVE_INFINITY;
            slowBlockMin = Number.POSITIVE_INFINITY;
            slowHasPrev = true;
          }
        } else {
          if (x > tiltXMax) tiltXMax = x;
          else if (x < tiltXMin) tiltXMin = x;
        }
      }
      if (fastWindowed) {
        fastBlockVals[fastBlockAt] = profit;
        if (profit > fastBlockMax) fastBlockMax = profit;
        tiltFastPeak = fastBlockMax;
        if (fastHasPrev && fastBlockAt + 1 < fastBlock && fastSuffixMax[fastBlockAt + 1] > tiltFastPeak) {
          tiltFastPeak = fastSuffixMax[fastBlockAt + 1];
        }
        if (++fastBlockAt === fastBlock) {
          let hi = fastBlockVals[fastBlock - 1];
          for (let j = fastBlock - 1; j >= 0; j--) {
            if (fastBlockVals[j] > hi) hi = fastBlockVals[j];
            fastSuffixMax[j] = hi;
          }
          fastBlockAt = 0;
          fastBlockMax = Number.NEGATIVE_INFINITY;
          fastHasPrev = true;
        }
      }
      rowProfits[rowBase + t.rowIdx] += delta;
      if (satelliteSeatsWon && t.isSatellite && t.prizeByPlace[leaderboardPlace] > 0) {
        satelliteSeatsWon[rowBase + t.rowIdx]++;
      }
      if (
        leaderboardConfig !== null &&
        leaderboardRng !== null &&
        isBattleRoyale &&
        leaderboardPlace >= 0
      ) {
        const place1 = leaderboardPlace + 1;
        const points = battleRoyaleLeaderboardPoints(
          leaderboardConfig.scoring,
          place1,
          leaderboardKnockoutsThisSlot,
        );
        leaderboardWindowScore += points;
        leaderboardTotalPoints += points;
        leaderboardKoTotal += leaderboardKnockoutsThisSlot;
        leaderboardTournaments++;
        if (place1 === 1) leaderboardFirstTotal++;
        else if (place1 === 2) leaderboardSecondTotal++;
        else if (place1 === 3) leaderboardThirdTotal++;
        if (
          leaderboardTournaments % leaderboardConfig.windowTournaments === 0
        ) {
          const settled = sampleBattleRoyaleLeaderboardWindow(
            leaderboardWindowScore,
            leaderboardConfig,
            leaderboardRng,
          );
          leaderboardSettledWindows++;
          leaderboardRankSum += settled.rank;
          if (settled.payout > 0) leaderboardPaid++;
          leaderboardTotalPayout += settled.payout;
          leaderboardTotalExpectedPayout += settled.expectedPayout;
          leaderboardWindowScore = 0;
        }
      }

      if (cashedThisSlot) {
        if (cashlessRun > 0) cashlessStreakCounts[cashlessRun]++;
        cashlessRun = 0;
      } else {
        cashlessRun++;
        if (cashlessRun > longestCashlessRun) longestCashlessRun = cashlessRun;
      }

      if (profit > runningMax) runningMax = profit;
      // Back at the old peak counts as recovered, as in the cash engine; on a
      // lattice of whole buy-ins a run lands on its peak exactly.
      if (profit === runningMax && ddTroughIdx >= 0 && sampleRecoveryLen < 0) {
        sampleRecoveryLen = i - ddTroughIdx;
      }
      if (profit < runningMin) runningMin = profit;
      const dd = runningMax - profit;
      if (dd > maxDD) {
        maxDD = dd;
        ddTroughIdx = i;
        sampleRecoveryLen = -1;
      }
      const up = profit - runningMin;
      if (up > maxUp) maxUp = up;

      if (bankroll > 0 && !ruined && profit <= -bankroll) ruined = true;

      if (firstReturns) profitTrace[i + 1] = profit;
      while (nextCp <= K && i + 1 === nextCpIdx) {
        pathMatrix[pathBase + nextCp] = profit;
        nextCp++;
        if (nextCp <= K) nextCpIdx = checkpointIdx[nextCp];
      }
      while (nextHiCp <= hiK && i + 1 === nextHiCpIdx) {
        hiResScratch[nextHiCp] = profit;
        if (profit < hiResMin[nextHiCp]) hiResMin[nextHiCp] = profit;
        if (profit > hiResMax[nextHiCp]) hiResMax[nextHiCp] = profit;
        nextHiCp++;
        if (nextHiCp <= hiK) nextHiCpIdx = hiCheckpointIdx[nextHiCp];
      }
    }

    // Persist the first `wantHiResPaths` samples' hi-res trajectories, and
    // swap in a new shard-best/worst if this sample breaks the record. New
    // records are rare (≈ O(log S)) so the per-sample cost is ~O(N/stride).
    if (localS < wantHiResPaths) {
      hiResPaths[localS].set(hiResScratch);
      hiResSampleIndices[localS] = s;
    }
    if (collectDetails && profit > hiResBestFinal) {
      hiResBestFinal = profit;
      hiResBestPath.set(hiResScratch);
    }
    if (collectDetails && profit < hiResWorstFinal) {
      hiResWorstFinal = profit;
      hiResWorstPath.set(hiResScratch);
    }

    // End-of-sample: any cashless streak still open at the last tournament
    // was never terminated — count it so the histogram reflects it.
    if (cashlessRun > 0) cashlessStreakCounts[cashlessRun]++;

    let longestBreakeven = 0;
    let breakevenStreakAvg = 0;
    if (chordScratch) {
      // "Playing for nothing" = longest horizontal chord of the profit
      // trajectory starting at time i: max(j − i) such that the path,
      // interpolated between checkpoint samples, revisits level profit[i]
      // at time j. Computed on the K=240 checkpoint grid. Each starting
      // point's longest chord contributes to the histogram — that turns the
      // shape into a decay-right distribution ("how common is each streak
      // length across all time points in all runs") instead of the
      // extreme-value distribution of per-sample max chords.
      //
      // The "any streak" metric is the FIRST return instead: for each
      // starting checkpoint, the first later tournament the path is back at
      // that level. That is the span the user means by "I went up to X,
      // dropped, climbed back to X". Averaged over the starting points that
      // return at all.
      scanPathChords(pathMatrix, pathBase, K1, breakevenStreakCounts, chordScratch);
      longestBreakeven = K > 0 ? (chordScratch.longestChord / K) * N : 0;
      if (firstReturns) {
        scanFirstReturns(profitTrace, N, checkpointIdx, K, firstReturns);
        breakevenStreakAvg =
          firstReturns.firstReturnCount > 0
            ? firstReturns.firstReturnSum / firstReturns.firstReturnCount
            : 0;
      } else {
        breakevenStreakAvg =
          chordScratch.firstReturnCount > 0 && K > 0
            ? (chordScratch.firstReturnSum / chordScratch.firstReturnCount / K) * N
            : 0;
      }
    }

    if (
      leaderboardConfig !== null &&
      leaderboardRng !== null &&
      leaderboardTournaments % leaderboardConfig.windowTournaments !== 0 &&
      leaderboardConfig.awardPartialWindow
    ) {
      const settled = sampleBattleRoyaleLeaderboardWindow(
        leaderboardWindowScore,
        leaderboardConfig,
        leaderboardRng,
      );
      leaderboardSettledWindows++;
      leaderboardRankSum += settled.rank;
      if (settled.payout > 0) leaderboardPaid++;
      leaderboardTotalPayout += settled.payout;
      leaderboardTotalExpectedPayout += settled.expectedPayout;
      leaderboardWindowScore = 0;
    }

    finalProfits[localS] = profit;
    if (downsideReport && downsideState) saveDownsideReportState(downsideReport, localS, downsideState);
    maxDrawdowns[localS] = maxDD;
    maxRunUps[localS] = maxUp;
    runningMins[localS] = runningMin;
    if (collectDetails) {
      longestBreakevens[localS] = longestBreakeven;
      breakevenStreakAvgs[localS] = breakevenStreakAvg;
    }
    longestCashless[localS] = longestCashlessRun;
    recoveryLengths[localS] = maxDD > 0 ? sampleRecoveryLen : -2;
    if (leaderboardPoints !== null) leaderboardPoints[localS] = leaderboardTotalPoints;
    if (leaderboardPayouts !== null) leaderboardPayouts[localS] = leaderboardTotalPayout;
    if (leaderboardExpectedPayouts !== null) {
      leaderboardExpectedPayouts[localS] = leaderboardTotalExpectedPayout;
    }
    if (leaderboardWindows !== null) leaderboardWindows[localS] = leaderboardSettledWindows;
    if (leaderboardPaidWindows !== null) leaderboardPaidWindows[localS] = leaderboardPaid;
    if (leaderboardRankSums !== null) leaderboardRankSums[localS] = leaderboardRankSum;
    if (leaderboardKnockouts !== null) leaderboardKnockouts[localS] = leaderboardKoTotal;
    if (leaderboardFirsts !== null) leaderboardFirsts[localS] = leaderboardFirstTotal;
    if (leaderboardSeconds !== null) leaderboardSeconds[localS] = leaderboardSecondTotal;
    if (leaderboardThirds !== null) leaderboardThirds[localS] = leaderboardThirdTotal;
    if (ruined) ruinedCount++;

    if (onProgress && localS + 1 >= nextProgressAt) {
      onProgress(localS + 1, shardSize);
      nextProgressAt += nextProgressStep;
    }
  }
  onProgress?.(shardSize, shardSize);

  return {
    ...(downsideReport ? { downsideReport } : {}),
    satelliteSeatsWon,
    sStart,
    sEnd,
    finalProfits,
    pathMatrix,
    maxDrawdowns,
    maxRunUps,
    runningMins,
    longestBreakevens,
    breakevenStreakAvgs,
    longestCashless,
    recoveryLengths,
    breakevenStreakCounts,
    cashlessStreakCounts,
    rowProfits,
    rowBountyProfits,
    jackpotMask,
    leaderboardPoints,
    leaderboardPayouts,
    leaderboardExpectedPayouts,
    leaderboardWindows,
    leaderboardPaidWindows,
    leaderboardRankSums,
    leaderboardKnockouts,
    leaderboardFirsts,
    leaderboardSeconds,
    leaderboardThirds,
    ruinedCount,
    hiResCheckpointIdx: hiCheckpointIdx,
    hiResPaths,
    hiResSampleIndices,
    hiResBestPath,
    hiResWorstPath,
    hiResBestFinal,
    hiResWorstFinal,
    hiResMin,
    hiResMax,
  };
}
