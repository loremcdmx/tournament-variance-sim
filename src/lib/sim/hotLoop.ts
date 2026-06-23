/**
 * The Monte Carlo hot loop. `simulateShard` runs a disjoint `[sStart, sEnd)`
 * slice of samples; the worker pool runs slices on separate cores and merges
 * the raw buffers (see `mergeShards` in `engine.ts`).
 *
 * Determinism contract: `SimulationInput + seed` → byte-identical `RawShard`
 * regardless of how samples are sharded. No `Math.random`, no `Date.now` —
 * only `mulberry32` seeded via `mixSeed(seed, sampleIdx)`, each stochastic
 * channel an XOR-offset of the seed, `sampleIdx` the GLOBAL index in
 * `[0, samples)`. No allocations inside the per-sample inner loop — all
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
  RawShard,
} from "./engineTypes";
import { makeHiResGrid } from "./grids";
import { mulberry32, mixSeed } from "./rng";
import { poissonPTRS } from "./simNumerics";
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
  const { K, checkpointIdx } = grid;
  const K1 = K + 1;
  const N = compiled.tournamentsPerSample;
  const numRows = input.schedule.length;
  const bankroll = input.bankroll;
  const shardSize = sEnd - sStart;

  const finalProfits = new Float64Array(shardSize);
  const pathMatrix = new Float64Array(shardSize * K1);
  // Per-sample reusable scratch for the breakeven/first-return post-loop:
  // segLo[jj]/segHi[jj] cache the min/max of checkpoint segment (jj-1, jj) so
  // the two O(K1²) chord scans don't recompute them on every starting point.
  const segLo = new Float64Array(K1);
  const segHi = new Float64Array(K1);
  const maxDrawdowns = new Float64Array(shardSize);
  const maxRunUps = new Float64Array(shardSize);
  const runningMins = new Float64Array(shardSize);
  const longestBreakevens = new Float64Array(shardSize);
  const breakevenStreakAvgs = new Float64Array(shardSize);
  const longestCashless = new Int32Array(shardSize);
  const recoveryLengths = new Int32Array(shardSize);
  const rowProfits = new Float64Array(shardSize * numRows);
  const rowBountyProfits = new Float64Array(shardSize * numRows);
  const jackpotMask = new Uint8Array(shardSize);
  const leaderboardConfig = normalizeBattleRoyaleLeaderboardConfig(
    input.battleRoyaleLeaderboard,
  );
  const leaderboardLegacyAllBr =
    leaderboardConfig !== null &&
    (!input.battleRoyaleLeaderboard?.includedRowIds ||
      input.battleRoyaleLeaderboard.includedRowIds.length === 0);
  const hasBattleRoyaleRows = compiled.flat.some(
    (entry) =>
      entry.isBattleRoyale &&
      (leaderboardLegacyAllBr || entry.battleRoyaleLeaderboardShare > 0),
  );
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
  const breakevenStreakCounts = new Int32Array(K + 1);
  const cashlessStreakCounts = new Int32Array(N + 1);
  let ruinedCount = 0;

  // Hi-res capture. Allocated per-shard regardless of shard size so the
  // RawShard contract stays uniform (mergeShards can safely read fields
  // even on single-sample shards).
  const hiGrid = makeHiResGrid(N);
  const hiK = hiGrid.K;
  const hiK1 = hiK + 1;
  const hiCheckpointIdx = hiGrid.checkpointIdx;
  // Hi-res path budget is split proportionally across shards so the visible
  // run count stays ≈ HI_RES_GLOBAL_CAP regardless of pool / oversubscription.
  // Under 4×W oversub with W=16 and S=10k, a single shard holds ~156 samples —
  // if only shard 0 captured paths we'd cap the slider at ~156 instead of 1000.
  const HI_RES_GLOBAL_CAP = 1000;
  const wantHiResPaths = Math.min(
    shardSize,
    Math.max(
      1,
      Math.ceil((shardSize / Math.max(1, input.samples)) * HI_RES_GLOBAL_CAP),
    ),
  );
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

  const perPass = compiled.tournamentsPerPass;
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
    const rng = mulberry32(mixSeed(input.seed, s));
    // Per-sample shock RNG — decoupled from finish draws and
    // independent of shard boundaries.
    const skillRng = mulberry32(mixSeed((input.seed ^ 0xbeef) >>> 0, s));
    // Dedicated RNG for within-place bounty noise — kept separate so adding
    // a bounty flag doesn't perturb the finish-sampling stream (otherwise
    // same-seed comparison tests between bounty and non-bounty runs drift).
    const bRng = mulberry32(mixSeed((input.seed ^ 0xb01dface) >>> 0, s));
    const leaderboardRng = leaderboardActive
      ? mulberry32(mixSeed((input.seed ^ 0x1eadeb0b) >>> 0, s))
      : null;
    // Cached-pair gaussians bound to each stream — halves log/sqrt cost
    // relative to the discarding boxMuller.
    const gaussSkill = makeGauss(skillRng);
    const gaussB = makeGauss(bRng);
    const gaussLeaderboard = leaderboardRng ? makeGauss(leaderboardRng) : null;

    const deltaROI = roiStdErr > 0 ? gaussSkill() * roiStdErr : 0;
    let drift = 0;
    let sessionShock = 0;
    let tiltState: -1 | 0 | 1 = 0;
    let tiltAnchor = 0;
    let tiltStreakLen = 0;
    let tiltSwingMag = 0;
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
    hiResScratch[0] = 0;
    let nextHiCp = 1;
    let nextHiCpIdx = hiCheckpointIdx[1];

    for (let i = 0; i < N; i++) {
      let effectiveDelta = 0;
      if (hasShocks) {
      if ((sigSession > 0 || sigDrift > 0) && i % perPass === 0) {
        if (sigSession > 0) sessionShock = gaussSkill() * sigSession;
        if (sigDrift > 0)
          drift = driftRho * drift + gaussSkill() * driftInnovScale;
      }
      const tourneyShock =
        sigTourney > 0 ? gaussSkill() * sigTourney : 0;

      let tiltShift = 0;
      if (tiltFastOn) {
        const dd = runningMax - profit;
        const upSwing = profit - runningMin;
        const net = dd - upSwing;
        tiltShift -= tiltFastGain * Math.tanh(net / tiltFastScale);
      }
      if (tiltSlowOn) {
        if (tiltState === 0) {
          const dd = runningMax - profit;
          const up = profit - runningMin;
          if (dd >= tiltSlowThreshold) {
            tiltStreakLen++;
            if (tiltStreakLen >= tiltSlowMinDur) {
              tiltState = -1;
              tiltAnchor = profit;
              tiltSwingMag = dd;
              tiltStreakLen = 0;
            }
          } else if (up >= tiltSlowThreshold) {
            tiltStreakLen++;
            if (tiltStreakLen >= tiltSlowMinDur) {
              tiltState = 1;
              tiltAnchor = profit;
              tiltSwingMag = up;
              tiltStreakLen = 0;
            }
          } else {
            tiltStreakLen = 0;
          }
        } else if (tiltState === -1) {
          tiltShift -= tiltSlowGain;
          if (profit - tiltAnchor >= tiltSlowRecFrac * tiltSwingMag) {
            tiltState = 0;
            tiltStreakLen = 0;
          }
        } else {
          tiltShift += tiltSlowGain;
          if (tiltAnchor - profit >= tiltSlowRecFrac * tiltSwingMag) {
            tiltState = 0;
            tiltStreakLen = 0;
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
      const leaderboardRowActive =
        leaderboardLegacyAllBr || t.battleRoyaleLeaderboardShare > 0;
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
        if (bp !== null) {
          const mean = bp[place];
          if (mean > 0 && bkm !== null) {
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
      rowProfits[rowBase + t.rowIdx] += delta;
      if (
        leaderboardConfig !== null &&
        leaderboardRng !== null &&
        gaussLeaderboard !== null &&
        isBattleRoyale &&
        leaderboardRowActive &&
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
            gaussLeaderboard,
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

      if (profit > runningMax) {
        runningMax = profit;
        if (ddTroughIdx >= 0 && sampleRecoveryLen < 0) {
          sampleRecoveryLen = i - ddTroughIdx;
        }
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
    if (profit > hiResBestFinal) {
      hiResBestFinal = profit;
      hiResBestPath.set(hiResScratch);
    }
    if (profit < hiResWorstFinal) {
      hiResWorstFinal = profit;
      hiResWorstPath.set(hiResScratch);
    }

    // End-of-sample: any cashless streak still open at the last tournament
    // was never terminated — count it so the histogram reflects it.
    if (cashlessRun > 0) cashlessStreakCounts[cashlessRun]++;

    // "Playing for nothing" = longest horizontal chord of the profit
    // trajectory starting at time i: max(j − i) such that the path,
    // interpolated between checkpoint samples, revisits level profit[i]
    // at time j. Computed on the K=240 checkpoint grid; the inner loop
    // breaks on the first (furthest) match, so per-i cost is the gap
    // from i to the first enclosing segment. Each starting point's
    // longest chord contributes to the histogram — that turns the shape
    // into a decay-right distribution ("how common is each streak
    // length across all time points in all runs") instead of the
    // extreme-value distribution of per-sample max chords.
    let longestChordGrid = 0;
    // Parallel forward-scan for the "any streak" metric: for each starting
    // point ii, find the FIRST jj>ii where the path returns to Y[ii]. That
    // first-return distance is the streak length the user would perceive
    // when they say "I went up to X, dropped, climbed back to X — that
    // span counts." Sum them per sample; divide by count to get the
    // per-sample mean first-return chord.
    let firstReturnSum = 0;
    let firstReturnCount = 0;
    // Precompute each segment's min/max once (O(K1)). The chord scans below
    // are still O(K1²) but now just read segLo/segHi instead of recomputing
    // `a < b ? …` on every starting point — the dominant cost in this
    // post-loop. Same ternary form, so the straddle test is bit-identical.
    for (let jj = 1; jj < K1; jj++) {
      const a = pathMatrix[pathBase + jj - 1];
      const b = pathMatrix[pathBase + jj];
      segLo[jj] = a < b ? a : b;
      segHi[jj] = a < b ? b : a;
    }
    for (let ii = 0; ii < K1 - 1; ii++) {
      const Pi = pathMatrix[pathBase + ii];
      let chordLen = 0;
      for (let jj = K1 - 1; jj > ii; jj--) {
        if (segLo[jj] <= Pi && Pi <= segHi[jj]) {
          // Skip the trivial case where the segment only touches Pi at
          // its left endpoint (which is time ii itself): that isn't a
          // distinct second point.
          if (jj === ii + 1) {
            const a = pathMatrix[pathBase + jj - 1];
            const b = pathMatrix[pathBase + jj];
            if (a === Pi && b !== Pi) break;
          }
          chordLen = jj - ii;
          break;
        }
      }
      if (chordLen > 0 && chordLen <= K) {
        breakevenStreakCounts[chordLen]++;
      }
      if (chordLen > longestChordGrid) longestChordGrid = chordLen;

      let firstLen = 0;
      for (let jj = ii + 1; jj < K1; jj++) {
        if (segLo[jj] <= Pi && Pi <= segHi[jj]) {
          if (jj === ii + 1) {
            const a = pathMatrix[pathBase + jj - 1];
            const b = pathMatrix[pathBase + jj];
            if (a === Pi && b !== Pi) continue;
          }
          firstLen = jj - ii;
          break;
        }
      }
      if (firstLen > 0) {
        firstReturnSum += firstLen;
        firstReturnCount++;
      }
    }
    const longestBreakeven = K > 0 ? (longestChordGrid / K) * N : 0;
    const breakevenStreakAvg =
      firstReturnCount > 0 && K > 0
        ? (firstReturnSum / firstReturnCount / K) * N
        : 0;

    if (
      leaderboardConfig !== null &&
      leaderboardRng !== null &&
      gaussLeaderboard !== null &&
      leaderboardTournaments % leaderboardConfig.windowTournaments !== 0 &&
      leaderboardConfig.awardPartialWindow
    ) {
      const settled = sampleBattleRoyaleLeaderboardWindow(
        leaderboardWindowScore,
        leaderboardConfig,
        leaderboardRng,
        gaussLeaderboard,
      );
      leaderboardSettledWindows++;
      leaderboardRankSum += settled.rank;
      if (settled.payout > 0) leaderboardPaid++;
      leaderboardTotalPayout += settled.payout;
      leaderboardTotalExpectedPayout += settled.expectedPayout;
      leaderboardWindowScore = 0;
    }

    finalProfits[localS] = profit;
    maxDrawdowns[localS] = maxDD;
    maxRunUps[localS] = maxUp;
    runningMins[localS] = runningMin;
    longestBreakevens[localS] = longestBreakeven;
    breakevenStreakAvgs[localS] = breakevenStreakAvg;
    longestCashless[localS] = longestCashlessRun;
    recoveryLengths[localS] = sampleRecoveryLen;
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
