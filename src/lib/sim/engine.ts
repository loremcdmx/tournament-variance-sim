/**
 * Core Monte Carlo engine. Runs inside Web Workers (see `worker.ts`), never
 * on the main thread. The public surface is small — `compileSchedule`,
 * `simulateShard`, `mergeShards`, `buildResult` — and is orchestrated by
 * `useSimulation.ts` on the UI side.
 *
 * Determinism contract: `SimulationInput + seed → byte-identical
 * SimulationResult` regardless of worker pool size or shard dispatch order.
 * Enforced by `engine.test.ts`. No `Math.random`, no `Date.now`, no wall
 * clock. Only `mulberry32` seeded via `mixSeed(baseSeed, sampleIdx, rowIdx,
 * bulletIdx)`, where `sampleIdx` is the GLOBAL index in `[0, samples)`.
 *
 * Hot loop allocation rule: no `new Float64Array(...)` inside the per-sample
 * inner loop. All scratch buffers are preallocated per shard and reused.
 *
 * See `docs/ARCHITECTURE.md` for data flow, hot-loop shape, and storage.
 */
import { getPayoutTable } from "./payouts";
import {
  applyBountyBias,
  buildAliasTable,
  buildBinaryItmAssets,
  buildFinishPMF,
  calibrateAlpha,
  calibrateShelledItm,
  isAlphaAdjustable,
  itmProbability,
} from "./finishModel";
import {
  battleRoyaleCashProfitShare,
  clampBountyMean,
  isBattleRoyaleRow,
} from "./bountySplit";
import { makeBrTierSampler } from "./brBountyTiers";
import { normalizeBrMrConsistency } from "./gameType";
import { mulberry32, mixSeed } from "./rng";
import type {
  CalibrationMode,
  RowDecomposition,
  SimulationInput,
  SimulationResult,
  TournamentRow,
} from "./types";

// ---- Variant D: PKO latent heat ----------------------------------------
// When `row.pkoHeat > 0`, compileSingleEntry precomputes HEAT_BIN_COUNT
// alternative `bountyByPlace` banks: each bin raises the raw PKO weight
// curve to an exponent `1 + pkoHeat · z_b` (z_b evenly spaced in
// [-HEAT_Z_RANGE, +HEAT_Z_RANGE]) and re-normalizes against the base pmf
// back to the same mean bounty. The hot loop draws one Gaussian per
// tournament, snaps it to the nearest bin, and uses that bin's bbp. Mean
// bounty is preserved exactly per bin (normalization); hot bins
// concentrate bounty mass on the deepest finishes so the right tail
// fattens while σ only drifts marginally. Finish-place pmf is unchanged
// across bins, so prize EV stays on the α-calibrated target.
const HEAT_BIN_COUNT = 33;
const HEAT_Z_RANGE = 3;
// Precomputed scalar for z → bin index: (HEAT_BIN_COUNT - 1) / (2 · RANGE).
const HEAT_BIN_SCALE = (HEAT_BIN_COUNT - 1) / (2 * HEAT_Z_RANGE);

// Threshold (in units of per-KO mean) used to tag a sample as having
// hit a "jackpot" in `jackpotMask`. We flag at the tournament level:
// if the sum of per-KO ratios in a single bounty-bearing tournament
// crosses this threshold, the sample is marked. Matches the scale of
// FinishPMFPreview's `jackpotShareFrac` so the preview stats and the
// UI toggle share a definition — but the per-tournament aggregation
// also catches compound jackpots (many moderate-ratio KOs in one
// tournament summing past the threshold) that a per-KO cutoff misses.
export const JACKPOT_THRESHOLD = 100;

// ---- PTRS Poisson sampler (Hörmann 1993) ----------------------------------
// Unbiased, ~1.13 expected iterations, valid for λ ≥ 10. Replaces the Gaussian
// approximation which introduces skewness bias at moderate λ.
const LOG_FACT_SMALL: Float64Array = (() => {
  const lut = new Float64Array(16);
  let acc = 0;
  for (let i = 1; i < 16; i++) {
    acc += Math.log(i);
    lut[i] = acc;
  }
  return lut;
})();
function logFactorial(k: number): number {
  if (k < 16) return LOG_FACT_SMALL[k];
  return (k + 0.5) * Math.log(k) - k + 0.9189385332046727 + 1 / (12 * k);
}
function poissonPTRS(lam: number, rng: () => number): number {
  const smu = Math.sqrt(lam);
  const b = 0.931 + 2.53 * smu;
  const a = -0.059 + 0.02483 * b;
  const invAlpha = 1.1239 + 1.1328 / (b - 3.4);
  const vR = 0.9277 - 3.6224 / (b - 2);
  for (;;) {
    const U = rng() - 0.5;
    const V = rng();
    const us = 0.5 - Math.abs(U);
    const k = Math.floor((2 * a / us + b) * U + lam + 0.43);
    if (k < 0) continue;
    if (us >= 0.07 && V <= vR) return k;
    if (us < 0.013 && V > us) continue;
    if (
      Math.log(V) + Math.log(invAlpha) - Math.log(a / (us * us) + b) <=
      -lam + k * Math.log(lam) - logFactorial(k)
    ) {
      return k;
    }
  }
}

interface CompiledEntry {
  rowIdx: number;
  /**
   * When this slot corresponds to a row with fieldVariability, variants holds
   * the full bucket set. The hot loop picks one uniformly per sample, so field
   * size actually contributes variance instead of being compile-time smoothed.
   * For rows without variability this is undefined (fast path).
   */
  variants?: CompiledEntry[];
  /** Amortized cost per slot: singleCost × (1 + reentryExpected). Used only
   *  for totalBuyIn reporting / per-row accounting. */
  costPerEntry: number;
  /** Cost of a single bullet (buy-in + rake, no re-entry scaling). The hot
   *  loop charges this per fired bullet. */
  singleCost: number;
  /** Deterministic rakeback credit added to profit for every bullet fired.
   *  `input.rakebackFracOfRake × row.rake × row.buyIn`. Zero when rakeback
   *  isn't configured; pure mean shift (adds zero variance, but reshapes
   *  path-dependent stats — drawdown, running max, time-above-zero, bust
   *  probability — since cumulative profit is what those read). */
  rakebackBonusPerBullet: number;
  /** Cap on bullets fired per slot. 1 for freezeouts. */
  maxEntries: number;
  /** Probability of firing the next bullet after a non-cash bust. */
  reRate: number;
  /** Number of paid places — the boundary for "did I cash" checks during
   *  re-entry rolls. */
  paidCount: number;
  /** Vose's alias method: O(1) finish-place sampling in the hot loop.
   *  `aliasProb[i]` is the acceptance threshold for index i; when the
   *  fractional part of a scaled uniform is above it, we take `aliasIdx[i]`
   *  instead. Built in O(N) once per compiled entry. */
  aliasProb: Float64Array;
  aliasIdx: Int32Array;
  prizeByPlace: Float64Array;
  alpha: number;
  /** Σ pmf[i] over paid places — exact ITM for this entry. */
  itm: number;
  /**
   * Expected extra re-entries per seat. For a geometric re-entry process
   * with cap `maxEntries` and retry rate `p`, the expected number of
   * *additional* entries is Σ_{k=1..cap-1} p^k = p(1−p^(cap−1))/(1−p)
   * for p<1, else cap−1. Used for amortized cost reporting only.
   */
  reentryExpected: number;
  /**
   * Per-place bounty EV. For a row with bountyFraction > 0, bounties are
   * distributed across finish places using the elimination-order model:
   * E[elims | place p] = H_{N−1} − H_{p−1}, where H_k is the k-th harmonic
   * number. Deep finishers collect most bounties; early busts collect zero.
   * The per-entry mean is normalized against the calibrated pmf so overall
   * EV is unchanged — only variance shifts into the tails.
   *
   * null when bountyFraction === 0 (skip the array read entirely).
   */
  bountyByPlace: Float64Array | null;
  /**
   * Mystery-bounty log-space variance σ² per KO. When > 0 the realized
   * bounty haul is multiplied by a log-normal draw with mean 1 and log-
   * variance σ²/k (Fenton–Wilkinson aggregate-of-k-lognormals approx),
   * so each KO independently rolls a possibly-huge or possibly-tiny $
   * value. Mean preserved, only variance added. 0 means flat bounties.
   */
  mysteryBountyLogVar: number;
  mysteryBountyLogSigma: number;
  /** Precomputed `exp(mysteryBountyLogVar) − 1`. Used by the Fenton–Wilkinson
   *  scaling inside the hot loop — hoisted here to save one `Math.exp` call
   *  per KO draw. Zero when `mysteryBountyLogVar` is zero (mystery bounty off).
   */
  mysteryBountyExpMinus1: number;
  /**
   * Expected number of knockouts by finish place. Used by the hot loop to
   * add within-place stochastic noise to the bounty haul: at a fixed place
   * the realized KO count is Poisson around `bountyKmean[place]`, and the
   * realized bounty payout equals `bountyByPlace[place] × K / kmean`. K is
   * drawn via Knuth's inverse-CDF for small λ and PTRS (Hörmann 1993) for
   * λ ≥ 10 — see `poissonPTRS` / `poissonKnuth` above. Mean is preserved
   * exactly; the per-tournament within-place variance is real (not zero
   * as in the original scalar-per-place bounty formulation). Shares null
   * with bountyByPlace.
   */
  bountyKmean: Float64Array | null;
  /** Precomputed exp(−bountyKmean[i]) for the Knuth Poisson path. Saves one
   *  `Math.exp` per tourney in bounty rows. Zero where bountyKmean is zero. */
  bountyKmeanExp: Float64Array | null;
  /** Precomputed 1/bountyKmean[i] for the bounty normalization. Replaces the
   *  per-tourney divide with a multiply. Zero where bountyKmean is zero. */
  bountyKmeanInv: Float64Array | null;
  /**
   * Analytical per-tourney σ from the calibrated pmf — √(E[X²]−E[X]²) on
   * prize + bounty. Cheap, compile-time, and independent of the MC run;
   * used to cross-check MC σ in diagnostics.
   */
  sigmaSingleAnalytic: number;
  /**
   * Analytical per-bullet E[prize + bounty] from the calibrated pmf. Should
   * equal `singleCost · (1 + row.roi)` to within float tolerance for any
   * calibrated model; realdata-* models return the reference-shape mean and
   * may diverge. Exposed so regression tests can assert the ROI contract
   * without running Monte Carlo.
   */
  analyticMeanSingle: number;
  /**
   * PKO latent-heat bounty bank. When non-null, length is HEAT_BIN_COUNT
   * and each entry is an alternative `bountyByPlace` curve built by
   * raising the raw PKO weights to `1 + pkoHeat · z_b`, then re-normalized
   * against the (unchanged) calibrated pmf so each bin's mean bounty
   * equals the original `bountyMean`. Null → legacy PKO path.
   */
  heatBountyByPlace: Float64Array[] | null;
  /**
   * GG Mystery Battle Royale discrete envelope tier tables. When non-null,
   * replaces the per-KO log-normal draw with a 10-tier Vose alias sample.
   * Ratios are pre-normalised to E[ratio] = 1 under `brTierAliasProb`, so
   * pool-accounting EV is preserved — only the shape of the KO-bounty
   * variance changes (jackpot tier ≈ 10000× buy-in at freq 4e-7, etc).
   * Null for every row except `payoutStructure === "battle-royale"`.
   */
  brTierRatios: Float64Array | null;
  brTierAliasProb: Float64Array | null;
  brTierAliasIdx: Int32Array | null;
}

interface CompiledSchedule {
  flat: CompiledEntry[];
  totalBuyIn: number;
  /** Deterministic profit target from the schedule ROI plus deterministic RB. */
  expectedProfit: number;
  tournamentsPerSample: number;
  /** flat.length / scheduleRepeats — used as session boundary in the hot loop. */
  tournamentsPerPass: number;
  rowCounts: number[];
  rowBuyIns: number[];
  rowLabels: string[];
  rowIds: string[];
  /** Weighted mean ITM over every entry in the flat schedule. */
  itmRate: number;
}

export function compileSchedule(
  input: SimulationInput,
  calibrationMode: CalibrationMode = "alpha",
): CompiledSchedule {
  // Normalize BR ↔ mystery-royale pairing at the compile boundary: legacy
  // rows with drifted flags silently get fixed up so both gameType-gated and
  // payoutStructure-gated hot-loop branches see consistent state (#131).
  const normalizedSchedule = input.schedule.map(normalizeBrMrConsistency);
  input = normalizedSchedule === input.schedule ? input : { ...input, schedule: normalizedSchedule };
  const rowCounts = new Array<number>(input.schedule.length).fill(0);
  const rowBuyIns = new Array<number>(input.schedule.length).fill(0);
  const rowLabels = input.schedule.map((r, i) => r.label || `Row ${i + 1}`);
  const rowIds = input.schedule.map((r) => r.id);

  // For each row, compile one or more variants depending on fieldVariability.
  // variants[r] is an array of { entry, weight } — weight is # of plays per
  // unit `count` consumed from this row.
  const primedopeCompare = calibrationMode === "primedope-binary-itm";
  // Compare mode isolates PrimeDope's distribution assumptions. The EV target
  // stays on our user-facing ROI basis (buy-in + rake), otherwise the right
  // pane compares a different edge instead of a different variance model.
  const primedopeStyleEV = false;
  // Three independent PD-flavour toggles, all default ON when compare mode
  // is active. Flipping any of them off isolates that single PD quirk's
  // contribution to σ while keeping the schedule EV fixed.
  const forcePrimedopePayouts =
    primedopeCompare && input.usePrimedopePayouts !== false;
  const usePdFinishModel =
    primedopeCompare && input.usePrimedopeFinishModel !== false;
  const usePdRakeMath =
    primedopeCompare && input.usePrimedopeRakeMath !== false;
  const pdFlags = { usePdFinishModel, usePdRakeMath };
  const variants: { entry: CompiledEntry; share: number }[][] =
    input.schedule.map((row, idx) =>
      compileRowVariants(row, idx, input.finishModel, calibrationMode, primedopeStyleEV, forcePrimedopePayouts, pdFlags),
    );

  // Stamp rakeback onto each variant. Bonus is row-specific (scales with
  // row.rake × row.buyIn) but the rakeback program % itself is global —
  // sits on SimulationInput, not on the row. Mutating the compiled entries
  // in-place here keeps compileRowVariants / compileSingleEntry signatures
  // unchanged and means the hot loop just reads `entry.rakebackBonusPerBullet`.
  const rbFrac = Math.max(0, input.rakebackFracOfRake ?? 0);
  if (rbFrac > 0) {
    for (let r = 0; r < input.schedule.length; r++) {
      const row = input.schedule[r];
      const bonus = rbFrac * row.rake * row.buyIn;
      for (const v of variants[r]) v.entry.rakebackBonusPerBullet = bonus;
    }
  }

  const flat: CompiledEntry[] = [];
  let totalBuyIn = 0;
  let expectedProfit = 0;
  let itmAcc = 0;
  // Build one "slot entry" per row. For rows with a single bucket this is
  // the compiled entry itself. For rows with fieldVariability it's a copy
  // of the first variant with .variants populated — the hot loop rolls a
  // variant per sample, so field size genuinely drives variance.
  const slotEntries: CompiledEntry[] = input.schedule.map((_, r) => {
    const rv = variants[r];
    if (rv.length === 1) return rv[0].entry;
    const first = rv[0].entry;
    const variantList = rv.map((v) => v.entry);
    // Parent's bookkeeping fields (costPerEntry equal across variants; itm
    // is the mean over variants so totalBuyIn/itmRate reporting is correct
    // in expectation).
    const meanItm =
      variantList.reduce((a, v) => a + v.itm, 0) / variantList.length;
    return {
      ...first,
      itm: meanItm,
      variants: variantList,
    };
  });

  for (let rep = 0; rep < input.scheduleRepeats; rep++) {
    for (let r = 0; r < input.schedule.length; r++) {
      const row = input.schedule[r];
      const entry = slotEntries[r];
      const n = Math.max(1, Math.floor(row.count));
      for (let k = 0; k < n; k++) {
        flat.push(entry);
        totalBuyIn += entry.costPerEntry;
        expectedProfit +=
          entry.costPerEntry * row.roi +
          entry.rakebackBonusPerBullet * (1 + entry.reentryExpected);
        itmAcc += entry.itm;
        rowCounts[r] += 1;
        rowBuyIns[r] += entry.costPerEntry;
      }
    }
  }

  const reps = Math.max(1, input.scheduleRepeats);
  return {
    flat,
    totalBuyIn,
    expectedProfit,
    tournamentsPerSample: flat.length,
    tournamentsPerPass: Math.max(1, Math.floor(flat.length / reps)),
    rowCounts,
    rowBuyIns,
    rowLabels,
    rowIds,
    itmRate: flat.length > 0 ? itmAcc / flat.length : 0,
  };
}

function compileSingleEntry(
  row: TournamentRow,
  idx: number,
  players: number,
  model: SimulationInput["finishModel"],
  calibrationMode: CalibrationMode,
  primedopeStyleEV = false,
  forcePrimedopePayouts = false,
  pdFlags: PdCompareFlags = { usePdFinishModel: false, usePdRakeMath: false },
): CompiledEntry {
  // ---- input validation --------------------------------------------------
  // Guard impossible values at compile time so the hot loop is never fed
  // a broken row. Done once per row — negligible cost.
  const label = row.label || row.id || `row ${idx}`;
  if (!(row.players >= 1)) {
    throw new Error(`engine: row "${label}" players must be ≥ 1 (got ${row.players})`);
  }
  if (!(row.buyIn >= 0)) {
    throw new Error(`engine: row "${label}" buyIn must be ≥ 0 (got ${row.buyIn})`);
  }
  if (!(row.rake >= 0 && row.rake <= 1)) {
    throw new Error(`engine: row "${label}" rake must be in [0,1] (got ${row.rake})`);
  }
  if (!Number.isFinite(row.roi)) {
    throw new Error(`engine: row "${label}" roi must be finite (got ${row.roi})`);
  }
  if (row.bountyFraction != null && !(row.bountyFraction >= 0 && row.bountyFraction <= 0.9)) {
    throw new Error(
      `engine: row "${label}" bountyFraction must be in [0,0.9] (got ${row.bountyFraction})`,
    );
  }
  if (row.payJumpAggression != null && !(row.payJumpAggression >= 0 && row.payJumpAggression <= 1)) {
    throw new Error(
      `engine: row "${label}" payJumpAggression must be in [0,1] (got ${row.payJumpAggression})`,
    );
  }
  if (row.reentryRate != null && !(row.reentryRate >= 0 && row.reentryRate <= 1)) {
    throw new Error(
      `engine: row "${label}" reentryRate must be in [0,1] (got ${row.reentryRate})`,
    );
  }
  if (row.maxEntries != null && !(row.maxEntries >= 1)) {
    throw new Error(`engine: row "${label}" maxEntries must be ≥ 1 (got ${row.maxEntries})`);
  }
  if (row.mysteryBountyVariance != null && !(row.mysteryBountyVariance >= 0)) {
    throw new Error(
      `engine: row "${label}" mysteryBountyVariance must be ≥ 0 (got ${row.mysteryBountyVariance})`,
    );
  }
  if (row.pkoHeadVar != null && !(row.pkoHeadVar >= 0)) {
    throw new Error(
      `engine: row "${label}" pkoHeadVar must be ≥ 0 (got ${row.pkoHeadVar})`,
    );
  }
  if (row.pkoHeat != null && !(row.pkoHeat >= 0 && row.pkoHeat <= 3)) {
    throw new Error(
      `engine: row "${label}" pkoHeat must be in [0,3] (got ${row.pkoHeat})`,
    );
  }

  // Late-registration: the real field at reg-close is the nominal field
  // scaled by `lateRegMultiplier`. Scales prize pool and paid seats, and
  // widens the finish-position shape. Defaults to 1 (no late reg).
  const lateRegMult = Math.max(1, row.lateRegMultiplier ?? 1);
  const N = Math.max(1, Math.floor(players * lateRegMult));

  // ---- re-entry accounting ------------------------------------------------
  // Expected number of *extra* entries per seat (beyond the first) under
  // geometric re-entry with cap (maxEntries-1). Contributes to cost and to
  // prize pool (every re-entry pays rake and buy-in too).
  const maxEntries = Math.max(1, Math.floor(row.maxEntries ?? 1));
  const reRate = Math.max(0, Math.min(1, row.reentryRate ?? (maxEntries > 1 ? 1 : 0)));
  let reentryExpected = 0;
  if (maxEntries > 1 && reRate > 0) {
    if (reRate === 1) {
      reentryExpected = maxEntries - 1;
    } else {
      // Σ_{k=1}^{M-1} p^k = p(1 − p^(M−1)) / (1 − p)
      const M = maxEntries - 1;
      reentryExpected = (reRate * (1 - Math.pow(reRate, M))) / (1 - reRate);
    }
  }
  // ROI in this app is always net of rake: profit / (buy-in + rake). Keep
  // that cost basis in the PrimeDope comparison too so both panes compare the
  // same edge. PrimeDope's rake quirk is modeled below through the prize-pool
  // variance basis, not by silently changing the EV target.
  const entryCostSingle = primedopeStyleEV
    ? row.buyIn
    : row.buyIn * (1 + row.rake);
  const costPerEntry = entryCostSingle * (1 + reentryExpected);
  // Field-average extra entries inflate the prize pool too.
  const effectiveSeats = N * (1 + reentryExpected);
  // Rake-SD coupling: in PD-binary-itm mode, we model PD's internal quirk
  // of using the POST-RAKE pool as the variance driver while keeping the
  // app's full-cost ROI target fixed.
  // (See notes/pokerdope_weaknesses.md §7.) The binary-ITM calibrator
  // will inflate l so the mean outcome still hits `targetRegular`, but
  // the tighter per-prize spread drops σ in proportion to rake.
  const poolBuyInBasis =
    calibrationMode === "primedope-binary-itm" &&
    pdFlags.usePdRakeMath
      ? // PD's rake-math quirk shrinks the pool by the full rake fraction.
        // At very high rake (e.g. $50+$50 satellite-style, rake=100%) that
        // would literally zero the pool, collapsing PD's sim to a single
        // deterministic loss per tournament with no variance — blank charts.
        // Floor at 20 % of the buy-in so PD still produces a signal while
        // preserving the rake→σ shrinkage the quirk is meant to model.
        Math.max(row.buyIn * 0.2, row.buyIn * (1 - row.rake))
      : row.buyIn;
  const basePool = effectiveSeats * poolBuyInBasis;
  const overlay = Math.max(0, (row.guarantee ?? 0) - basePool);
  let prizePool = basePool + overlay;

  // ---- bounty split -------------------------------------------------------
  // Knockouts: `bountyFraction` of the buy-in (not rake) is carried as
  // bounty. The regular prize pool shrinks by the same fraction. Each
  // entry's expected bounty haul is roughly the per-seat bounty (every
  // player starts with ~1 bounty on their head and collects ~1 in expectation
  // over the whole field by symmetry, but the sim-relevant quantity is the
  // skill-adjusted collected bounties). We fold a *lifted* expected bounty
  // into bountyEV so skilled players collect more than 1 bounty on average.
  const bountyFraction = Math.max(0, Math.min(0.9, row.bountyFraction ?? 0));
  let bountyMean = 0;
  // EV-bias: user-tunable shift of the expected-winnings split between
  // the cash and bounty channels. The requested bountyMean drives the finish
  // shape; constrained models then close the actual KO budget as the residual
  // after cash EV so total ROI stays pinned even when α hits a boundary.
  // Clamped to ±0.25 — past that, α-adjustable models also start bottoming
  // out against their search envelope and the slider stops adding useful
  // behavioral range.
  const bias = Math.max(-0.25, Math.min(0.25, row.bountyEvBias ?? 0));
  const totalWinningsEV = entryCostSingle * (1 + row.roi);
  const isBattleRoyale = isBattleRoyaleRow(row);
  if (bountyFraction > 0) {
    const bountyPerSeat = row.buyIn * bountyFraction;
    // Skill lift on bounty collection — equilibrium haul is bountyPerSeat
    // (no rake on bounty pool). Total edge = entryCost · roi distributes
    // proportionally over cash + bounty, so lift = (1+rake)(1+roi). Capped
    // at 3× for sanity. This is a *heuristic* anchor used to drive the pmf
    // build; for constrained models we replace it with the actual residual
    // after the pmf is known.
    const bountyLift = Math.max(0.1, Math.min(3, (1 + row.rake) * (1 + row.roi)));
    const defaultBountyMean = bountyPerSeat * bountyLift;
    bountyMean = applyBountyBias(defaultBountyMean, totalWinningsEV, bias);

    // Shrink the regular pool by the bounty share.
    prizePool = prizePool * (1 - bountyFraction);
  }

  // ---- raw payout curve --------------------------------------------------
  // Both passes honour the user's selected payout by default, so the
  // PrimeDope comparison isolates the *finish-model* effect. Only when
  // `usePrimedopePayouts` is explicitly set does the binary-ITM pass
  // switch onto PD's native curve — that's the "reproduce PD's σ on
  // their reference scenarios" escape hatch, not the default behaviour.
  const effectivePayoutStructure = forcePrimedopePayouts
    ? "mtt-primedope"
    : row.payoutStructure;
  const payouts = getPayoutTable(
    effectivePayoutStructure,
    N,
    row.customPayouts,
  );

  const paidCount = payouts.reduce((n, p) => (p > 0 ? n + 1 : n), 0);

  const buildPrizeByPlace = (
    binaryItmPrizeOverride: Float64Array | null,
  ): Float64Array => {
    const out = new Float64Array(N);
    if (binaryItmPrizeOverride) {
      out.set(binaryItmPrizeOverride);
    } else {
      for (let i = 0; i < Math.min(payouts.length, N); i++) {
        out[i] = payouts[i] * prizePool;
      }
    }
    return out;
  };

  const cashEVFor = (
    candidatePmf: Float64Array,
    candidatePrizeByPlace: Float64Array,
  ): number => {
    let cashEV = 0;
    for (let i = 0; i < N; i++) cashEV += candidatePmf[i] * candidatePrizeByPlace[i];
    return cashEV;
  };

  const solveFinish = (
    regularTarget: number,
  ): {
    alpha: number;
    pmf: Float64Array;
    prizeByPlace: Float64Array;
  } => {
    let solvedPmf: Float64Array;
    let solvedAlpha = 0;
    let binaryItmPrizeOverride: Float64Array | null = null;
    const solvedEffectiveROI = regularTarget / entryCostSingle - 1;

    if (calibrationMode === "primedope-binary-itm" && pdFlags.usePdFinishModel) {
      const assets = buildBinaryItmAssets(
        N,
        paidCount,
        payouts,
        prizePool,
        regularTarget,
      );
      solvedPmf = assets.pmf;
      binaryItmPrizeOverride = assets.prizeByPlace;
    } else if (row.itmRate != null && row.itmRate > 0) {
      const fi = calibrateShelledItm(
        N,
        paidCount,
        payouts,
        prizePool,
        regularTarget,
        row.itmRate,
        row.finishBuckets,
        model,
      );
      solvedAlpha = fi.alpha;
      solvedPmf = fi.pmf;
    } else {
      solvedAlpha = calibrateAlpha(
        N,
        payouts,
        prizePool,
        entryCostSingle,
        solvedEffectiveROI,
        model,
      );
      solvedPmf = buildFinishPMF(N, model, solvedAlpha);
    }

    return {
      alpha: solvedAlpha,
      pmf: solvedPmf,
      prizeByPlace: buildPrizeByPlace(binaryItmPrizeOverride),
    };
  };

  if (bountyFraction > 0 && isBattleRoyale) {
    // BR uses a fixed 50/50 cash/KO pool, but fixed-ITM settings can make
    // the cash baseline higher than the raw pool share before any ROI is
    // added. Split the incremental ROI profit from that breakeven baseline;
    // otherwise every ROI/RB preset click becomes residual KO EV.
    const neutralBountyMean = entryCostSingle * bountyFraction;
    const neutralTargetRegular = Math.max(0.01, entryCostSingle - neutralBountyMean);
    const neutral = solveFinish(neutralTargetRegular);
    const neutralCashEV = cashEVFor(neutral.pmf, neutral.prizeByPlace);
    const desiredCashEV = Math.max(
      0.01,
      neutralCashEV + entryCostSingle * row.roi * battleRoyaleCashProfitShare(bias),
    );
    bountyMean = clampBountyMean(totalWinningsEV - desiredCashEV, totalWinningsEV);
  }

  // ---- finish distribution -----------------------------------------------
  // The player's expected total winnings target is `cost × (1+ROI)`. A
  // bounty lump contributes bountyEV directly; the regular prize pool must
  // therefore hit `targetTotal − bountyEV` on its own. We translate that
  // back into an "effective ROI" target to feed the existing calibrator.
  // Target is defined PER BULLET: the pmf shapes one bullet's prize
  // distribution. A player fires K bullets stochastically, each costs
  // `entryCostSingle`, each samples independently from this pmf.
  //   E[profit per slot] = E[K] × (E[prize per bullet] + E[bounty per bullet] − singleCost)
  // For overall ROI = row.roi on TOTAL money spent (= E[K] × singleCost):
  //   E[prize per bullet] + E[bounty per bullet] − singleCost = singleCost × ROI
  //   → E[prize per bullet] = singleCost × (1 + ROI) − bountyMean
  const targetRegular = Math.max(0.01, entryCostSingle * (1 + row.roi) - bountyMean);
  let pmf: Float64Array;
  let alpha = 0;
  let binaryItmPrizeOverride: Float64Array | null = null;
  const effectiveROI = targetRegular / entryCostSingle - 1;
  if (calibrationMode === "primedope-binary-itm" && pdFlags.usePdFinishModel) {
    // entryCostSingle has already dropped rake when pdDisplayMode is on, so
    // targetRegular is naturally PrimeDope-style. Otherwise we calibrate
    // against our normal cost-with-rake basis.
    const assets = buildBinaryItmAssets(
      N,
      paidCount,
      payouts,
      prizePool,
      targetRegular,
    );
    pmf = assets.pmf;
    binaryItmPrizeOverride = assets.prizeByPlace;
  } else if (row.itmRate != null && row.itmRate > 0) {
    // Fixed-ITM (shelled) calibration: user pins the ITM rate and optionally
    // pins top-shell masses (P(1st), P(top-3), P(FT)). Skill concentrates
    // only within the cashed band; locked shells stay fixed, free band
    // α-calibrates so total E[W] still hits target.
    const fi = calibrateShelledItm(
      N,
      paidCount,
      payouts,
      prizePool,
      targetRegular,
      row.itmRate,
      row.finishBuckets,
      model,
    );
    alpha = fi.alpha;
    pmf = fi.pmf;
  } else {
    alpha = calibrateAlpha(
      N,
      payouts,
      prizePool,
      entryCostSingle,
      effectiveROI,
      model,
    );
    pmf = buildFinishPMF(N, model, alpha);
  }
  const prizeByPlace = new Float64Array(N);
  if (binaryItmPrizeOverride) {
    prizeByPlace.set(binaryItmPrizeOverride);
  } else {
    for (let i = 0; i < Math.min(payouts.length, N); i++) {
      prizeByPlace[i] = payouts[i] * prizePool;
    }
  }

  // ---- bounty reconcile (constrained finish models) ----------------------
  // With fixed ITM/shells or reference-shape models the finish solver can hit
  // an α boundary before `targetRegular` is reached. The slider still changes
  // the requested split and therefore the solved finish shape, but the actual
  // KO budget must be the residual after that shape's cash EV. Otherwise total
  // ROI drifts at the slider edges.
  if (
    bountyFraction > 0 &&
    ((row.itmRate != null && row.itmRate > 0) || !isAlphaAdjustable(model))
  ) {
    let cashEV = 0;
    for (let i = 0; i < N; i++) cashEV += pmf[i] * prizeByPlace[i];
    bountyMean = Math.max(0, totalWinningsEV - cashEV);
  }

  // ---- "sit through pay jumps" transform --------------------------------
  // Reshape pmf so the player min-cashes less and deep-runs more, with a
  // compensating mass flowing into busts. EV-preserving by construction
  // (the bust/top split is chosen so Σ pmf·prize is unchanged).
  if (
    row.sitThroughPayJumps &&
    paidCount >= 4 &&
    calibrationMode !== "primedope-binary-itm"
  ) {
    const q = Math.max(0, Math.min(1, row.payJumpAggression ?? 0.5));
    if (q > 0) {
      const half = Math.max(1, Math.floor(paidCount / 2));
      // Top-half paid = [0, half); bottom-half paid = [half, paidCount).
      let massBottom = 0;
      let ePrizeBottom = 0; // Σ pmf[i]·prize[i] over bottom
      let massTop = 0;
      let ePrizeTop = 0;
      let ePrize2Top = 0; // Σ pmf[i]·prize[i]² over top
      for (let i = 0; i < half; i++) {
        massTop += pmf[i];
        ePrizeTop += pmf[i] * prizeByPlace[i];
        ePrize2Top += pmf[i] * prizeByPlace[i] * prizeByPlace[i];
      }
      for (let i = half; i < paidCount; i++) {
        massBottom += pmf[i];
        ePrizeBottom += pmf[i] * prizeByPlace[i];
      }
      const removed = q * massBottom;
      if (removed > 0 && massTop > 0 && ePrizeTop > 0 && ePrize2Top > 0) {
        // Top is redistributed in proportion to pmf[i]·prize[i] so deeper
        // finishes absorb more. That means the prize-weighted mean gain
        // per unit of `toTop` is (Σ pmf·prize²) / (Σ pmf·prize) = T2/T1
        // — NOT the plain conditional mean ePrizeTop/massTop. Getting this
        // wrong leaks EV (the old derivation assumed pmf-weighted redist).
        //
        // EV delta setting:
        //   ΔEV = x · removed · (ePrize2Top / ePrizeTop)   ← top bonus
        //       − removed · (ePrizeBottom / massBottom)    ← bottom loss
        // Set ΔEV = 0:
        //   x = (ePrizeBottom / massBottom) · (ePrizeTop / ePrize2Top)
        const avgBottom = ePrizeBottom / massBottom;
        const prizeWeightedTop = ePrize2Top / ePrizeTop;
        let x = avgBottom / prizeWeightedTop;
        if (!Number.isFinite(x) || x < 0) x = 0;
        if (x > 1) x = 1;
        const toTop = removed * x;
        const toBust = removed * (1 - x);
        // Shrink bottom bracket.
        const bottomScale = 1 - q;
        for (let i = half; i < paidCount; i++) pmf[i] *= bottomScale;
        // Distribute `toTop` across top paid proportional to pmf[i]·prize[i]
        // (so pricier places pick up more of the absorption).
        for (let i = 0; i < half; i++) {
          pmf[i] += toTop * ((pmf[i] * prizeByPlace[i]) / ePrizeTop);
        }
        // Distribute `toBust` uniformly across unpaid places.
        const bustCount = N - paidCount;
        if (bustCount > 0 && toBust > 0) {
          const perBust = toBust / bustCount;
          for (let i = paidCount; i < N; i++) pmf[i] += perBust;
        } else if (bustCount === 0) {
          // Degenerate: no unpaid places. Fold toBust back into top instead.
          for (let i = 0; i < half; i++) {
            pmf[i] += toBust * ((pmf[i] * prizeByPlace[i]) / ePrizeTop);
          }
        }
        // Floating-point guard: re-normalize to 1.
        let s = 0;
        for (let i = 0; i < N; i++) s += pmf[i];
        if (s > 0 && Math.abs(s - 1) > 1e-12) {
          const k = 1 / s;
          for (let i = 0; i < N; i++) pmf[i] *= k;
        }
      }
    }
  }

  const { prob: aliasProb, alias: aliasIdx } = buildAliasTable(pmf);
  const brSampler =
    row.payoutStructure === "battle-royale" ? makeBrTierSampler(row.buyIn) : null;

  // ---- bounty distribution across finish places -------------------------
  // Elimination-order model: the player finishing at 1-indexed place p was
  // alive for the first N−p busts and killed 1/(N−m) of each bust m in
  // that window (one of (N−m) alive non-victims).
  //
  // Shape depends on gameType:
  //
  // - PKO ("pko"): each bust pays half the current head; heads accumulate
  //   (cash_m = h_m/2, T(m) = T(m−1) − cash_m). Deep finishers win more and
  //   the winner gets T(N−1) on top. Per-KO value grows across the run.
  //
  // - Mystery / Mystery-Royale: each bust inside the bounty window is an
  //   iid draw from the mystery pool. Per-KO variance comes from the
  //   envelope distribution (log-normal for plain mystery, 10-tier GG
  //   table for BR). raw[i] is therefore just the expected count of
  //   envelope-dropping busts — harmonic, restricted to the window
  //   (victims finishing inside the bounty-paying tier). For Battle
  //   Royale the published envelope table fixes the mean $ per KO, so
  //   changing the bounty budget rescales KO counts, not envelope size.
  //
  // The final raw weights are normalized against the calibrated pmf so that
  // Σ pmf[i] · bountyByPlace[i] === bountyMean. This preserves ROI
  // calibration while shifting all the bounty variance onto the shape of
  // the finish distribution. bountyKmean[i] holds the expected window KO
  // count at place i and is used by the hot loop to add within-place
  // Poisson-style stochastic noise around the mean.
  let bountyByPlace: Float64Array | null = null;
  let bountyKmean: Float64Array | null = null;
  // Raw (unnormalized) bounty weights. Captured so the latent-heat bank
  // below can re-normalize the same shape against its per-bin shifted pmf
  // without redoing the per-gametype math.
  let bountyRaw: Float64Array | null = null;
  if (bountyMean > 0 && N >= 2) {
    const raw = new Float64Array(N);
    bountyKmean = new Float64Array(N);

    const isMystery =
      row.gameType === "mystery" || row.gameType === "mystery-royale";

    if (isMystery) {
      // Envelope-dropping window: for `mystery-royale` it's the final
      // table (top-9, GG 18-max BR); for plain `mystery` it's the ITM
      // bubble. Only busts whose victim finishes inside this window drop
      // an envelope. For N=18, BR top-9 ⇒ 8 envelope-dropping busts
      // (places 9..2 get eliminated; winner keeps their own envelope
      // unopened), so mean envelope = bountyPool / 8.
      const ft =
        row.gameType === "mystery-royale" ? Math.min(9, N) : paidCount;
      // Window busts are m = N−ft+1 .. N−1 (victim finishes at place
      // N−m+1, which lies in [2..ft]). Expected envelope-drops by
      // finisher at 1-indexed place p is
      //   Σ_{m=max(1, N−ft+1)..N−p} 1 / (N−m)
      // since they're one of (N−m) non-victim candidates per bust.
      const mLo = Math.max(1, N - ft + 1);
      for (let i = 0; i < N; i++) {
        const p = i + 1;
        const mHi = N - p;
        if (mHi < mLo) {
          raw[i] = 0;
          bountyKmean[i] = 0;
        } else {
          let acc = 0;
          for (let m = mLo; m <= mHi; m++) acc += 1 / (N - m);
          raw[i] = acc;
          bountyKmean[i] = acc;
        }
      }
    } else {
      // PKO / freezeout-with-bounty path. Keep the accumulating-head
      // progression and the full-range harmonic bustsAtPos.
      const Hprefix = new Float64Array(N);
      let hAcc = 0;
      for (let k = 1; k < N; k++) {
        hAcc += 1 / k;
        Hprefix[k] = hAcc;
      }
      const totalH = Hprefix[N - 1];
      for (let i = 0; i < N; i++) {
        bountyKmean[i] = totalH - Hprefix[i];
      }

      // Progressive PKO: at bust m (1..N−1) we have (N−m+1) alive players
      // sharing total head mass T(m−1), starting at T(0)=N×B. Each KO
      // pays avgHead/2 cash, the same amount is consumed from the pool:
      //   h(m)   = T(m−1) / (N−m+1)
      //   cash_m = h(m) / 2
      //   T(m)   = T(m−1) − cash_m
      // Expected cash for finisher at 1-indexed place p is
      //   Σ_{m=1..N−p} cash_m / (N−m)
      // plus T(N−1) for the winner as their final own-head.
      // Per-seat B factors out — normalized away — so we initialise
      // T(0)=N and read cash_m in the same arbitrary unit.
      const cashAtBust = new Float64Array(N - 1);
      let T = N;
      for (let m = 1; m <= N - 1; m++) {
        const h = T / (N - m + 1);
        const cash = h / 2;
        cashAtBust[m - 1] = cash;
        T -= cash;
      }
      const Tfinal = T;

      const prefix = new Float64Array(N);
      let acc = 0;
      for (let m = 1; m <= N - 1; m++) {
        acc += cashAtBust[m - 1] / (N - m);
        prefix[m] = acc;
      }
      for (let i = 0; i < N; i++) {
        const p = i + 1;
        const upto = N - p;
        raw[i] = upto > 0 ? prefix[upto] : 0;
      }
      raw[0] += Tfinal; // winner's own final head
    }

    // Normalize so Σ pmf[i]·bountyByPlace[i] = bountyMean (ROI intact).
    // BR is special: the GG tier table fixes mean $/envelope, so we scale
    // expected KO counts (`bountyKmean`) to hit the budget and keep
    // `bountyByPlace / bountyKmean` constant at the profile mean.
    let Z = 0;
    for (let i = 0; i < N; i++) Z += pmf[i] * raw[i];
    bountyByPlace = new Float64Array(N);
    if (brSampler !== null && Z > 1e-12 && brSampler.meanValue > 1e-12) {
      const kScale = bountyMean / (brSampler.meanValue * Z);
      for (let i = 0; i < N; i++) {
        const lam = raw[i] * kScale;
        bountyKmean[i] = lam;
        bountyByPlace[i] = lam * brSampler.meanValue;
      }
    } else if (Z > 1e-12) {
      const scale = bountyMean / Z;
      for (let i = 0; i < N; i++) bountyByPlace[i] = raw[i] * scale;
    } else {
      for (let i = 0; i < N; i++) bountyByPlace[i] = bountyMean;
    }
    bountyRaw = raw;
  }

  // Derived bountyKmean transforms. Hoisting these out of the hot loop saves
  // one exp and one divide per tournament in bounty rows.
  let bountyKmeanExp: Float64Array | null = null;
  let bountyKmeanInv: Float64Array | null = null;
  if (bountyKmean !== null) {
    bountyKmeanExp = new Float64Array(N);
    bountyKmeanInv = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const lam = bountyKmean[i];
      if (lam > 0) {
        bountyKmeanExp[i] = Math.exp(-lam);
        bountyKmeanInv[i] = 1 / lam;
      }
    }
  }

  // ---- PKO latent-heat bank (variant D) ---------------------------------
  // Precompute HEAT_BIN_COUNT alternative `bountyByPlace` curves, each
  // reshaping the raw cumulative-cash weights by raising to exponent
  // `1 + pkoHeat · z_b`, then re-normalized against the (unchanged)
  // calibrated pmf so every bin has the same mean bounty. Hot bins
  // (exp > 1) push bounty mass onto the very deepest finishes; cold bins
  // (exp < 1) flatten it. The player's finish pmf and prize curve are
  // untouched, so ROI stays exactly on target while the right tail of
  // the bounty haul distribution fattens.
  const pkoHeat = Math.max(0, row.pkoHeat ?? 0);
  let heatBountyByPlace: Float64Array[] | null = null;
  if (pkoHeat > 0 && bountyMean > 0 && bountyRaw !== null) {
    heatBountyByPlace = new Array(HEAT_BIN_COUNT);
    const rawRef = bountyRaw;
    for (let b = 0; b < HEAT_BIN_COUNT; b++) {
      const z =
        -HEAT_Z_RANGE + (2 * HEAT_Z_RANGE * b) / (HEAT_BIN_COUNT - 1);
      // Clamp exponent below at 0.05 so a strongly-cold bin doesn't
      // collapse tiny raw values to ~constant (which would flatten bbp
      // to near-uniform and erase the "deep runs pay more" signal).
      const exp = Math.max(0.05, 1 + pkoHeat * z);
      const reshaped = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        const v = rawRef[i];
        reshaped[i] = v > 0 ? Math.pow(v, exp) : 0;
      }
      let Zb = 0;
      for (let i = 0; i < N; i++) Zb += pmf[i] * reshaped[i];
      const bbpBin = new Float64Array(N);
      if (Zb > 1e-12) {
        const scale = bountyMean / Zb;
        for (let i = 0; i < N; i++) bbpBin[i] = reshaped[i] * scale;
      } else {
        bbpBin.fill(bountyMean);
      }
      heatBountyByPlace[b] = bbpBin;
    }
  }

  // ---- pmf integrity check ------------------------------------------------
  // Downstream hot-loop assumes pmf is a proper distribution. Catch bugs in
  // finishModel / sit-through / custom-payout code paths before they
  // leak into sampling.
  if (process.env.NODE_ENV !== "production") {
    let pmfSum = 0;
    for (let i = 0; i < N; i++) {
      const p = pmf[i];
      if (!Number.isFinite(p) || p < 0) {
        throw new Error(
          `engine: pmf[${i}] invalid (${p}) for row "${row.label || row.id}"`,
        );
      }
      pmfSum += p;
    }
    if (Math.abs(pmfSum - 1) > 1e-9) {
      throw new Error(
        `engine: pmf Σ=${pmfSum} off from 1 for row "${row.label || row.id}"`,
      );
    }
  }

  // ---- analytical per-tourney σ (self-check / diagnostic) ----------------
  // σ² = E[X²] − E[X]² on (prize + bounty − singleCost). Cheap to compute
  // from pmf and used as a sanity metric next to MC σ in the results view.
  let eX = 0;
  let eX2 = 0;
  for (let i = 0; i < N; i++) {
    const p = pmf[i];
    if (p <= 0) continue;
    const prize = prizeByPlace[i] + (bountyByPlace ? bountyByPlace[i] : 0);
    eX += p * prize;
    eX2 += p * prize * prize;
  }
  const varSingle = Math.max(0, eX2 - eX * eX);
  const sigmaSingleAnalytic = Math.sqrt(varSingle);

  // Combined per-KO log-variance: mystery bounty noise + PKO head-size noise.
  // Both are independent log-normal sources, so variances add in log-space.
  // Default pkoHeadVar to 0.4 when bountyFraction > 0 and not explicitly set,
  // so all PKO rows get head-size variance even without applyGameType.
  const effectivePkoHeadVar =
    row.pkoHeadVar ?? (bountyMean > 0 ? 0.4 : 0);
  const perKoLogVar =
    Math.max(0, row.mysteryBountyVariance ?? 0) +
    Math.max(0, effectivePkoHeadVar);

  // Attach discrete envelope tiers only for GG Mystery Battle Royale.
  // The sampler replaces the log-normal per-KO draw inside the hot loop,
  // restoring the heavy-tailed jackpot shape that ~1.8 log-variance can't
  // reach. Non-BR rows keep the log-normal path (fields smoothly varying
  // around `bountyMean` with the configured σ²).

  return {
    rowIdx: idx,
    costPerEntry,
    singleCost: entryCostSingle,
    rakebackBonusPerBullet: 0,
    maxEntries,
    reRate,
    paidCount,
    aliasProb,
    aliasIdx,
    prizeByPlace,
    alpha,
    itm: itmProbability(pmf, paidCount),
    reentryExpected,
    bountyByPlace,
    bountyKmean,
    bountyKmeanExp,
    bountyKmeanInv,
    mysteryBountyLogVar: perKoLogVar,
    mysteryBountyLogSigma: perKoLogVar > 0 ? Math.sqrt(perKoLogVar) : 0,
    mysteryBountyExpMinus1: perKoLogVar > 0 ? Math.exp(perKoLogVar) - 1 : 0,
    sigmaSingleAnalytic,
    analyticMeanSingle: eX,
    heatBountyByPlace,
    brTierRatios: bountyByPlace !== null ? brSampler?.ratios ?? null : null,
    brTierAliasProb: bountyByPlace !== null ? brSampler?.aliasProb ?? null : null,
    brTierAliasIdx: bountyByPlace !== null ? brSampler?.aliasIdx ?? null : null,
  };
}

interface PdCompareFlags {
  usePdFinishModel: boolean;
  usePdRakeMath: boolean;
}

function compileRowVariants(
  row: TournamentRow,
  idx: number,
  model: SimulationInput["finishModel"],
  calibrationMode: CalibrationMode,
  primedopeStyleEV: boolean,
  forcePrimedopePayouts: boolean,
  pdFlags: PdCompareFlags = { usePdFinishModel: false, usePdRakeMath: false },
): { entry: CompiledEntry; share: number }[] {
  const fv = row.fieldVariability;
  if (!fv || fv.kind === "fixed") {
    return [
      {
        entry: compileSingleEntry(row, idx, row.players, model, calibrationMode, primedopeStyleEV, forcePrimedopePayouts, pdFlags),
        share: 1,
      },
    ];
  }
  const buckets = Math.max(1, Math.floor(fv.buckets ?? 5));
  const lo = Math.max(2, Math.floor(Math.min(fv.min, fv.max)));
  const hi = Math.max(lo, Math.floor(Math.max(fv.min, fv.max)));
  if (buckets === 1 || lo === hi) {
    const mid = Math.round((lo + hi) / 2);
    return [
      {
        entry: compileSingleEntry(row, idx, mid, model, calibrationMode, primedopeStyleEV, forcePrimedopePayouts, pdFlags),
        share: 1,
      },
    ];
  }
  const variants: { entry: CompiledEntry; share: number }[] = [];
  const share = 1 / buckets;
  for (let b = 0; b < buckets; b++) {
    // Midpoints of evenly-spaced sub-intervals over [lo, hi].
    const t = (b + 0.5) / buckets;
    const players = Math.round(lo + t * (hi - lo));
    variants.push({
      entry: compileSingleEntry(row, idx, players, model, calibrationMode, primedopeStyleEV, forcePrimedopePayouts, pdFlags),
      share,
    });
  }
  return variants;
}

type ProgressCb = (done: number, total: number) => void;
/**
 * Coarse phase label for the current emit. The four stages together cover
 * every emit site inside `buildResult` so the UI can tell a user which
 * phase is taking the wall-clock — envelope sorts and streak rankings
 * dominate on large S, stats/convergence are cheap.
 */
export type BuildStage = "stats" | "envelopes" | "streaks" | "convergence";
type BuildProgressCb = (frac: number, stage: BuildStage) => void;

/**
 * Marsaglia polar gaussian factory. The polar method natively yields two
 * independent N(0,1) draws per accepted (u,v); `boxMuller` above discards
 * the second. This factory caches it, halving `log`/`sqrt` cost on the
 * second call. Bind one closure per RNG stream at the top of the hot loop.
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

export function runSimulation(
  input: SimulationInput,
  onProgress?: ProgressCb,
): SimulationResult {
  const calibrationMode: CalibrationMode =
    input.calibrationMode ?? "alpha";

  // Twin run for side-by-side: same seed, same schedule, only the finish
  // distribution differs. Primary = α-calibration, comparison = uniform lift.
  if (input.compareWithPrimedope && !input.calibrationMode) {
    const half: ProgressCb | undefined = onProgress
      ? (done, total) => onProgress(done, total * 2)
      : undefined;
    const primary = runSimulation(
      { ...input, calibrationMode: "alpha", compareWithPrimedope: false },
      half,
    );
    const secondHalf: ProgressCb | undefined = onProgress
      ? (done, total) => onProgress(total + done, total * 2)
      : undefined;
    const comparison = runSimulation(
      {
        ...input,
        calibrationMode: "primedope-binary-itm",
        compareWithPrimedope: false,
      },
      secondHalf,
    );
    return { ...primary, comparison };
  }

  const compiled = compileSchedule(input, calibrationMode);
  const N = compiled.tournamentsPerSample;
  const S = input.samples;

  if (N === 0 || S === 0) throw new Error("Empty schedule or zero samples");

  const grid = makeCheckpointGrid(N);
  const shard = simulateShard(input, compiled, 0, S, grid, onProgress);
  return buildResult(input, compiled, shard, calibrationMode, grid);
}

/**
 * Aggregate a merged shard into a final SimulationResult. Separated from
 * runSimulation so the parallel orchestrator can run shards in workers
 * and call this on the merged result from the main thread.
 */
export function buildResult(
  input: SimulationInput,
  compiled: CompiledSchedule,
  shard: RawShard,
  calibrationMode: CalibrationMode,
  grid: CheckpointGrid,
  onBuildProgress?: BuildProgressCb,
): SimulationResult {
  const N = compiled.tournamentsPerSample;
  const S = input.samples;
  const bankroll = input.bankroll;
  const numRows = input.schedule.length;
  const { K, checkpointIdx } = grid;
  const {
    finalProfits,
    pathMatrix,
    maxDrawdowns,
    runningMins,
    longestBreakevens,
    breakevenStreakAvgs,
    longestCashless,
    recoveryLengths,
    rowProfits,
    rowBountyProfits,
    ruinedCount,
  } = shard;
  onBuildProgress?.(0.02, "stats");
  let expectedProfitAccum = 0;
  for (let s = 0; s < S; s++) expectedProfitAccum += finalProfits[s];

  // Stats -------------------------------------------------------------------
  const mean = expectedProfitAccum / S;
  // Direct typed-array memcpy: .slice() on a Float64Array is a single
  // memcpy, .from() iterates and boxes. Same for other sorted copies below.
  const sorted = finalProfits.slice().sort();
  onBuildProgress?.(0.10, "stats");
  const pct = (p: number) =>
    sorted[Math.min(S - 1, Math.max(0, Math.floor(p * (S - 1))))];
  const median = pct(0.5);
  const min = sorted[0];
  const max = sorted[S - 1];
  const p01 = pct(0.01);
  const p05 = pct(0.05);
  const p95 = pct(0.95);
  const p99 = pct(0.99);

  let varAcc = 0;
  let downVarAcc = 0;
  let downCount = 0;
  for (let s = 0; s < S; s++) {
    const d = finalProfits[s] - mean;
    varAcc += d * d;
    if (finalProfits[s] < 0) {
      downVarAcc += d * d;
      downCount++;
    }
  }
  const stdDev = Math.sqrt(varAcc / Math.max(1, S - 1));
  const downSigma = Math.sqrt(downVarAcc / Math.max(1, downCount - 1));

  // Higher moments: bias-corrected sample skewness (G1) and excess kurtosis
  // (G2) per standard formulas. Population moments under-estimate both for
  // the skewed MTT distribution; these are the same estimators Excel,
  // numpy.scipy.stats and R use by default.
  //   G1 = [S/((S−1)(S−2))] · Σ z_i³
  //   G2 = [S(S+1)/((S−1)(S−2)(S−3))] · Σ z_i⁴ − 3(S−1)²/((S−2)(S−3))
  // where z_i = (x_i − mean)/stdDev and stdDev is the sample SD (already
  // computed above with the S−1 divisor).
  let sumZ3 = 0;
  let sumZ4 = 0;
  if (stdDev > 0) {
    for (let s = 0; s < S; s++) {
      const z = (finalProfits[s] - mean) / stdDev;
      const z2 = z * z;
      sumZ3 += z2 * z;
      sumZ4 += z2 * z2;
    }
  }
  let skewness = 0;
  let kurtosis = 0;
  if (stdDev > 0 && S >= 3) {
    skewness = (S / ((S - 1) * (S - 2))) * sumZ3;
  }
  if (stdDev > 0 && S >= 4) {
    const a = (S * (S + 1)) / ((S - 1) * (S - 2) * (S - 3));
    const b = (3 * (S - 1) * (S - 1)) / ((S - 2) * (S - 3));
    kurtosis = a * sumZ4 - b;
  }

  // Kelly: f* ≈ μ / σ² for continuous outcomes. Only meaningful if +EV.
  // We report the fraction and the implied bankroll = totalBuyIn / f*.
  const variance = stdDev * stdDev;
  const kellyFraction =
    mean > 0 && variance > 0 ? mean / variance : 0;
  const kellyBankroll =
    kellyFraction > 0 ? compiled.totalBuyIn / kellyFraction : Infinity;

  // Expected log-growth — the thing Kelly actually maximises. Only valid
  // when the user has a bankroll. Winsorize ruin samples at ln(0.01) ≈ −4.6
  // instead of ln(1e-9) ≈ −20.7: the old floor collapsed the entire ruin
  // tail to a single value, killing variance structure where it matters most
  // for bankroll sizing. A 99% loss still strongly penalises over-betting.
  const LOG_RUIN_FLOOR = Math.log(0.01);
  let logGrowthRate = 0;
  if (bankroll > 0) {
    let acc = 0;
    for (let s = 0; s < S; s++) {
      const ratio = 1 + finalProfits[s] / bankroll;
      acc += ratio > 0.01 ? Math.log(ratio) : LOG_RUIN_FLOOR;
    }
    logGrowthRate = acc / S;
  }

  const sharpe = stdDev > 0 ? mean / stdDev : 0;
  const sortino = downSigma > 0 ? mean / downSigma : 0;

  const profitCount = countProfits(finalProfits);
  const probProfit = profitCount / S;

  // VaR/CVaR at 95 / 99 — positive numbers (losses)
  const var95 = -pct(0.05);
  const var99 = -pct(0.01);
  let cvar95Acc = 0;
  let cvar95N = 0;
  let cvar99Acc = 0;
  let cvar99N = 0;
  const q95 = pct(0.05);
  const q99 = pct(0.01);
  for (let s = 0; s < S; s++) {
    const v = finalProfits[s];
    if (v <= q95) {
      cvar95Acc += v;
      cvar95N++;
    }
    if (v <= q99) {
      cvar99Acc += v;
      cvar99N++;
    }
  }
  const cvar95 = cvar95N > 0 ? -cvar95Acc / cvar95N : 0;
  const cvar99 = cvar99N > 0 ? -cvar99Acc / cvar99N : 0;

  // Rough time-to-significance: how many tournaments before 1.96 × σ_single
  // is under 5 % of cost_per_tournament.
  const costPer = compiled.totalBuyIn / N;
  const sigmaPerTourn = stdDev / Math.sqrt(Math.max(1, N));
  const tournamentsFor95ROI =
    costPer > 0 && sigmaPerTourn > 0
      ? Math.ceil(Math.pow((1.96 * sigmaPerTourn) / (0.05 * costPer), 2))
      : 0;

  // Monte Carlo precision readouts -----------------------------------------
  const mcSeMean = S > 0 ? stdDev / Math.sqrt(S) : 0;
  const mcSeStdDev = S > 1 ? stdDev / Math.sqrt(2 * (S - 1)) : 0;
  const mcCi95HalfWidthMean = 1.96 * mcSeMean;
  const mcRoiErrorPct =
    Math.abs(mean) > 1e-6
      ? Math.abs(mcCi95HalfWidthMean / mean)
      : Number.POSITIVE_INFINITY;
  const mcPrecisionScore =
    mcRoiErrorPct < 0.01 ? 1 : mcRoiErrorPct < 0.05 ? 0.5 : 0;
  // Projected S for ≤1 % relative MC error on mean: solve (1.96·σ/√S)/μ = 0.01
  //   → S = (1.96·σ / (0.01·μ))²
  const mcSamplesFor1Pct =
    mean > 1e-6 && stdDev > 0
      ? Math.ceil(Math.pow((1.96 * stdDev) / (0.01 * mean), 2))
      : Number.POSITIVE_INFINITY;

  // Gaussian analytic RoR — PrimeDope-compatible readout ------------------
  // Per-tourney mean/σ from total-horizon stats. First-passage of Brownian
  // motion with drift: P(ruin by N | B) = Φ((−B−μ·N)/(σ·√N)) +
  // exp(−2μ·B/σ²) · Φ((−B+μ·N)/(σ·√N)). Invert numerically by bisection.
  const muPerTourn = N > 0 ? mean / N : 0;
  const sigmaPerTournRuin = N > 0 ? stdDev / Math.sqrt(N) : 0;
  const gaussianRuinProb = (B: number): number => {
    if (B <= 0) return 1;
    if (sigmaPerTournRuin <= 0 || N <= 0) return muPerTourn >= 0 ? 0 : 1;
    const sqrtN = Math.sqrt(N);
    const denom = sigmaPerTournRuin * sqrtN;
    const a = (-B - muPerTourn * N) / denom;
    const b = (-B + muPerTourn * N) / denom;
    const var1 = sigmaPerTournRuin * sigmaPerTournRuin;
    const expArg = (-2 * muPerTourn * B) / var1;
    // expArg blows up only under strongly unfavorable drift (μ≪0), where the
    // infinite-horizon ruin probability equals 1; short-circuit to avoid
    // Infinity·Φ(b) → NaN.
    if (expArg > 700) return 1;
    const p = normalCdf(a) + Math.exp(expArg) * normalCdf(b);
    return Math.min(1, Math.max(0, p));
  };
  const solveGaussianBankroll = (alpha: number): number => {
    if (sigmaPerTournRuin <= 0) return 0;
    // Bracket: 0 → ruin prob = 1. Upper bound: scale with σ√N × 10.
    let lo = 0;
    let hi = Math.max(100, stdDev * 10);
    // Expand hi until ruin prob drops below alpha.
    for (let k = 0; k < 20 && gaussianRuinProb(hi) > alpha; k++) hi *= 2;
    for (let k = 0; k < 64; k++) {
      const mid = 0.5 * (lo + hi);
      if (gaussianRuinProb(mid) > alpha) lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  };
  const minBankrollRoR1pctGaussian = solveGaussianBankroll(0.01);
  const minBankrollRoR5pctGaussian = solveGaussianBankroll(0.05);
  const riskOfRuinGaussian =
    bankroll > 0 ? gaussianRuinProb(bankroll) : 0;

  // Minimum bankroll for historical RoR ≤ threshold.
  // For each sample, "ruin" at bankroll B <=> runningMin <= -B.
  // Sort −runningMin ascending → the 1 − ε quantile gives B such that ε
  // of samples go below. Inline negate into a single allocation (was
  // .from().map().sort() — three passes, two intermediate buffers).
  const worstLosses = new Float64Array(S);
  for (let s = 0; s < S; s++) worstLosses[s] = -runningMins[s];
  worstLosses.sort();
  const minBankrollRoR1pct = worstLosses[Math.floor(0.99 * (S - 1))];
  const minBankrollRoR5pct = worstLosses[Math.floor(0.95 * (S - 1))];
  const minBankrollRoR15pct = worstLosses[Math.floor(0.85 * (S - 1))];
  const minBankrollRoR50pct = worstLosses[Math.floor(0.5 * (S - 1))];
  // "Runs that never dipped below 0" — fraction of samples whose running
  // minimum profit stayed non-negative over the entire schedule.
  let neverBelowZero = 0;
  for (let s = 0; s < S; s++) if (runningMins[s] >= 0) neverBelowZero++;
  const neverBelowZeroFrac = neverBelowZero / S;

  // Histograms --------------------------------------------------------------
  // longTailClip folds jackpot outliers into the last bin so the Mystery/BR
  // bulk stays readable — without it, a single $10k BI bounty stretches the
  // 60-bin range across 2+ orders of magnitude and crushes the core mass
  // into the first 2 bins. Raw extremes still available via stats.p99 etc.
  const histogram = histogramOf(finalProfits, 60, false, true);
  // Drawdowns are non-negative by construction, so lo auto-ranges from the
  // real observed minimum instead of being pinned to 0 (which wasted leading
  // bins when every sample had dd ≥ some floor like 50 BI).
  const drawdownHistogram = histogramOf(maxDrawdowns, 50, false, true);
  // Streak histograms — distribution of max drawdown / longest cashless /
  // longest breakeven / recovery length across samples. Int32Array → Float64
  // copy is cheap. Recovery uses recovered-only (unrecovered share is
  // reported separately in stats).
  // Cashless histogram counts EVERY cashless streak across every sample —
  // answers "how often do streaks of a given length occur". The breakeven
  // histogram answers the same question for "playing for nothing" chords:
  // for every time point in every run we measure the longest horizontal
  // chord starting there and bucket it by length. That gives a
  // decay-right shape (short chords outnumber long ones) rather than the
  // extreme-value distribution of per-sample max chords. Breakeven counts
  // are indexed by chord-grid position (0..K), not by tournament count —
  // integer bin widths kill alias peaks. We scale binEdges back to
  // tournament units on the way out.
  const longestBreakevenHistogram = histogramFromCounts(
    shard.breakevenStreakCounts,
    60,
    N / K,
  );
  const longestCashlessHistogram = histogramFromCounts(
    shard.cashlessStreakCounts,
    60,
  );
  onBuildProgress?.(0.18, "stats");

  // Envelopes ---------------------------------------------------------------
  // Percentile sorts run on the low-res K=80 grid (cheap). The final
  // envelopes are upsampled to the hi-res grid below so they line up with
  // the sample paths on a single uPlot x-axis.
  const K1 = K + 1;

  const mean_ = new Float64Array(K1);
  const envP05 = new Float64Array(K1);
  const envP95 = new Float64Array(K1);
  const p15 = new Float64Array(K1);
  const p85 = new Float64Array(K1);
  const p025 = new Float64Array(K1);
  const p975 = new Float64Array(K1);
  const p0015 = new Float64Array(K1);
  const p9985 = new Float64Array(K1);

  // Envelope percentiles: sorting K1 full columns of a 1M-sample run is
  // ≈80 × O(S log S) ≈ 1.6 B ops — freezes the worker at 99% for tens of
  // seconds. Subsample uniformly for the quantile computation (mean still
  // runs on the full S, which is just an additive loop and cheap).
  // Accuracy at the reported percentiles: p0015 / p9985 need ≥ 1 / (1-p)
  // samples minimum, so we cap at ≥ 20k; 50k keeps all six percentiles
  // within ~0.3 σ of the exact answer and runs in ~200 ms total.
  const ENV_CAP = 200_000;
  const envS = Math.min(S, ENV_CAP);
  const envStride = S / envS;
  const col = new Float64Array(envS);
  // Emit build-progress every ~8 columns so the main thread sees steady
  // motion through the dominant build phase (envelope sorts are ~65 % of
  // buildResult wall time for large S).
  const envEmitStride = Math.max(1, Math.floor(K1 / 10));
  for (let j = 0; j < K1; j++) {
    // Mean on the full S (cheap accumulator, no sort needed).
    let acc = 0;
    for (let s = 0; s < S; s++) acc += pathMatrix[s * K1 + j];
    mean_[j] = acc / S;
    // Percentiles on a stratified subsample of size envS.
    for (let s = 0; s < envS; s++) {
      const src = Math.min(S - 1, (s * envStride) | 0);
      col[s] = pathMatrix[src * K1 + j];
    }
    col.sort();
    envP05[j] = col[Math.floor(0.05 * (envS - 1))];
    envP95[j] = col[Math.floor(0.95 * (envS - 1))];
    p15[j] = col[Math.floor(0.15 * (envS - 1))];
    p85[j] = col[Math.floor(0.85 * (envS - 1))];
    p025[j] = col[Math.floor(0.025 * (envS - 1))];
    p975[j] = col[Math.floor(0.975 * (envS - 1))];
    p0015[j] = col[Math.floor(0.0015 * (envS - 1))];
    p9985[j] = col[Math.floor(0.9985 * (envS - 1))];
    if (onBuildProgress && j > 0 && j % envEmitStride === 0) {
      onBuildProgress(0.10 + 0.70 * ((j + 1) / K1), "envelopes");
    }
  }
  onBuildProgress?.(0.82, "envelopes");

  // Sample paths ------------------------------------------------------------
  // Hi-res capture was populated during simulateShard: each shard stores a
  // capped slice of its local samples, and mergeShards preserves their global
  // sample ids beside the path buffers. This replaces the old low-res
  // pathMatrix slicing which produced smooth diagonals at K=80 checkpoints.
  const hiCheckpointIdx = shard.hiResCheckpointIdx;
  const xHi: number[] = new Array(hiCheckpointIdx.length);
  for (let j = 0; j < hiCheckpointIdx.length; j++) xHi[j] = hiCheckpointIdx[j];
  const paths = shard.hiResPaths;
  const best = shard.hiResBestPath;
  const worst = shard.hiResWorstPath;
  const chosen: number[] = Array.from(shard.hiResSampleIndices);

  // Drawdown + breakeven
  let ddMean = 0;
  let ddWorst = 0;
  for (let s = 0; s < S; s++) {
    ddMean += maxDrawdowns[s];
    if (maxDrawdowns[s] > ddWorst) ddWorst = maxDrawdowns[s];
  }
  ddMean /= S;

  // Tail quantiles of max drawdown — a straight answer to
  // "how bad is a typical/5%/1% worst run". PrimeDope only shows a single
  // aggregate estimate; we expose the whole tail shape.
  onBuildProgress?.(0.83, "streaks");
  const ddSorted = maxDrawdowns.slice().sort();
  onBuildProgress?.(0.85, "streaks");
  const ddPct = (p: number) =>
    ddSorted[Math.min(S - 1, Math.max(0, Math.floor(p * (S - 1))))];
  const maxDrawdownMedian = ddPct(0.5);
  const maxDrawdownP95 = ddPct(0.95);
  const maxDrawdownP99 = ddPct(0.99);

  let beMean = 0;
  for (let s = 0; s < S; s++) beMean += longestBreakevens[s];
  beMean /= S;

  // Mean "any streak" length per sample: average of breakevenStreakAvgs
  // over samples that had at least one forward return. Samples with no
  // returns (monotone paths) contribute 0; we still divide by S so the
  // aggregate has the same semantics as beMean.
  let beStreakMean = 0;
  for (let s = 0; s < S; s++) beStreakMean += breakevenStreakAvgs[s];
  beStreakMean /= S;

  // Cashless streak stats
  let cashlessAcc = 0;
  let cashlessWorst = 0;
  for (let s = 0; s < S; s++) {
    const v = longestCashless[s];
    cashlessAcc += v;
    if (v > cashlessWorst) cashlessWorst = v;
  }
  const longestCashlessMean = cashlessAcc / S;

  // Recovery from deepest drawdown: -1 entries are "unrecovered" — we
  // compute median / p90 over the recovered-only slice, and report the
  // unrecovered share separately.
  let unrecoveredCount = 0;
  const recoveredOnly: number[] = [];
  for (let s = 0; s < S; s++) {
    const v = recoveryLengths[s];
    if (v < 0) unrecoveredCount++;
    else recoveredOnly.push(v);
  }
  recoveredOnly.sort((a, b) => a - b);
  const recoveredCount = recoveredOnly.length;
  const recoveryPct = (p: number) =>
    recoveredCount === 0
      ? 0
      : recoveredOnly[
          Math.min(
            recoveredCount - 1,
            Math.max(0, Math.floor(p * (recoveredCount - 1))),
          )
        ];
  const recoveryMedian = recoveryPct(0.5);
  const recoveryP90 = recoveryPct(0.9);
  const recoveryUnrecoveredShare = unrecoveredCount / S;
  const recoveredF = new Float64Array(recoveredOnly.length);
  for (let i = 0; i < recoveredOnly.length; i++) recoveredF[i] = recoveredOnly[i];
  const recoveryHistogram =
    recoveredF.length > 0
      ? histogramOf(recoveredF, 40, true, true)
      : { binEdges: [0, 1], counts: [0] };

  // Decomposition -----------------------------------------------------------
  // Single sequential pass over rowProfits (row-major by sample): accumulate
  // ΣX and ΣX² per row, then compute mean/variance via E[X²]−E[X]². Replaces
  // two stride-numRows column scans, better cache behavior for numRows>2.
  const decomposition: RowDecomposition[] = new Array(numRows);
  const rowMeans = new Float64Array(numRows);
  const rowVariances = new Float64Array(numRows);
  const rowSumSq = new Float64Array(numRows);
  const rowBountySums = new Float64Array(numRows);
  for (let s = 0; s < S; s++) {
    const base = s * numRows;
    for (let r = 0; r < numRows; r++) {
      const v = rowProfits[base + r];
      rowMeans[r] += v;
      rowSumSq[r] += v * v;
      rowBountySums[r] += rowBountyProfits[base + r];
    }
  }
  for (let r = 0; r < numRows; r++) {
    const m = rowMeans[r] / S;
    rowMeans[r] = m;
    // Sample variance: (ΣX² − S·m²) / (S−1). Clamp at 0 for the all-equal
    // degenerate case where floating-point cancellation can dip negative.
    rowVariances[r] =
      S > 1 ? Math.max(0, (rowSumSq[r] - S * m * m) / (S - 1)) : 0;
  }
  const totalRowVarSum = rowVariances.reduce((a, b) => a + b, 0) || 1;
  for (let r = 0; r < numRows; r++) {
    // Per-row Kelly: f* = mean / variance on the row's slot distribution.
    // Only meaningful when the row has positive EV and non-zero variance;
    // otherwise Kelly is undefined (we emit 0 / Infinity respectively).
    const rv = rowVariances[r];
    const rm = rowMeans[r];
    const rowKellyFraction = rm > 0 && rv > 1e-9 ? rm / rv : 0;
    const rowKellyBankroll =
      rowKellyFraction > 0
        ? compiled.rowBuyIns[r] / rowKellyFraction
        : Number.POSITIVE_INFINITY;
    decomposition[r] = {
      rowId: compiled.rowIds[r],
      label: compiled.rowLabels[r],
      mean: rm,
      stdDev: Math.sqrt(rv),
      varianceShare: rv / totalRowVarSum,
      bountyMean: rowBountySums[r] / S,
      tournamentsPerSample: compiled.rowCounts[r],
      totalBuyIn: compiled.rowBuyIns[r],
      kellyFraction: rowKellyFraction,
      kellyBankroll: rowKellyBankroll,
    };
  }

  // Sensitivity analysis ----------------------------------------------------
  // ΔROI linear scan: realized profit ≈ mean + ΔROI × totalBuyIn
  // (under α-calibration the expectation is truly linear in ROI because
  // the PMF shape is held constant — we just rescale expected winnings).
  // At extreme Δ we clamp against the absolute pool floor so the line
  // stays interpretable.
  const sensDeltas = [-0.2, -0.1, -0.05, -0.025, 0, 0.025, 0.05, 0.1, 0.2];
  const sensProfits = sensDeltas.map(
    (d) => mean + d * compiled.totalBuyIn,
  );

  // Downswing / upswing catalog --------------------------------------------
  // Top-3 samples by max drawdown depth (downswings) and by max run-up height
  // (upswings). Previously we showed the top-10 downswings, but the tail
  // samples clustered very tightly — rank 8-10 differ by a few bucks and add
  // noise without new information. Top-3 keeps the spread meaningful and
  // leaves room for a symmetric upswings table next to it.
  const maxRunUps = shard.maxRunUps;
  const ddIdx: number[] = new Array(S);
  const upIdx: number[] = new Array(S);
  for (let i = 0; i < S; i++) {
    ddIdx[i] = i;
    upIdx[i] = i;
  }
  onBuildProgress?.(0.88, "streaks");
  ddIdx.sort((a, b) => maxDrawdowns[b] - maxDrawdowns[a]);
  onBuildProgress?.(0.93, "streaks");
  upIdx.sort((a, b) => maxRunUps[b] - maxRunUps[a]);
  onBuildProgress?.(0.97, "streaks");
  const downswings = ddIdx.slice(0, Math.min(3, S)).map((sampleIndex, i) => ({
    rank: i + 1,
    sampleIndex,
    depth: maxDrawdowns[sampleIndex],
    finalProfit: finalProfits[sampleIndex],
    longestBreakeven: longestBreakevens[sampleIndex],
  }));
  const upswings = upIdx.slice(0, Math.min(3, S)).map((sampleIndex, i) => ({
    rank: i + 1,
    sampleIndex,
    height: maxRunUps[sampleIndex],
    finalProfit: finalProfits[sampleIndex],
    longestBreakeven: longestBreakevens[sampleIndex],
  }));

  // Convergence curve -------------------------------------------------------
  // Compute running mean and 1.96 SE vs sample count in log-spaced buckets.
  const convPoints = Math.min(80, S);
  const convX: number[] = new Array(convPoints);
  for (let j = 0; j < convPoints; j++) {
    const frac = (j + 1) / convPoints;
    convX[j] = Math.max(1, Math.floor(S * frac));
  }
  const convMean = new Float64Array(convPoints);
  const convSeLo = new Float64Array(convPoints);
  const convSeHi = new Float64Array(convPoints);
  let cumSum = 0;
  let cumSqSum = 0;
  let idxConv = 0;
  for (let s = 0; s < S; s++) {
    const v = finalProfits[s];
    cumSum += v;
    cumSqSum += v * v;
    if (idxConv < convPoints && s + 1 === convX[idxConv]) {
      const n = s + 1;
      const m = cumSum / n;
      // Population-moment estimator scaled to sample variance:
      //   s² = (Σx² − n·m²) / (n − 1)
      // SE of the running mean = s / √n. Using /n instead of /(n−1) shrinks
      // the band by √(n/(n−1)) — off by 15 % at n=4, <0.5 % at n=100.
      const sampleVar =
        n > 1 ? Math.max(0, cumSqSum - n * m * m) / (n - 1) : 0;
      const se = Math.sqrt(sampleVar / n);
      convMean[idxConv] = m;
      convSeLo[idxConv] = m - 1.96 * se;
      convSeHi[idxConv] = m + 1.96 * se;
      idxConv++;
    }
  }
  onBuildProgress?.(0.99, "convergence");

  return {
    type: "result",
    samples: S,
    tournamentsPerSample: N,
    totalBuyIn: compiled.totalBuyIn,
    expectedProfit: compiled.expectedProfit,
    calibrationMode,
    finalProfits,
    rowProfits,
    jackpotMask: shard.jackpotMask,
    histogram,
    drawdownHistogram,
    longestBreakevenHistogram,
    longestCashlessHistogram,
    recoveryHistogram,
    samplePaths: { x: xHi, paths, best, worst, sampleIndices: chosen },
    envelopes: {
      x: xHi,
      mean: upsampleToGrid(mean_, checkpointIdx, hiCheckpointIdx),
      p05: upsampleToGrid(envP05, checkpointIdx, hiCheckpointIdx),
      p95: upsampleToGrid(envP95, checkpointIdx, hiCheckpointIdx),
      p15: upsampleToGrid(p15, checkpointIdx, hiCheckpointIdx),
      p85: upsampleToGrid(p85, checkpointIdx, hiCheckpointIdx),
      p025: upsampleToGrid(p025, checkpointIdx, hiCheckpointIdx),
      p975: upsampleToGrid(p975, checkpointIdx, hiCheckpointIdx),
      p0015: upsampleToGrid(p0015, checkpointIdx, hiCheckpointIdx),
      p9985: upsampleToGrid(p9985, checkpointIdx, hiCheckpointIdx),
      min: shard.hiResMin,
      max: shard.hiResMax,
    },
    decomposition,
    sensitivity: { deltas: sensDeltas, expectedProfits: sensProfits },
    downswings,
    upswings,
    convergence: { x: convX, mean: convMean, seLo: convSeLo, seHi: convSeHi },
    stats: {
      mean,
      median,
      stdDev,
      min,
      max,
      p01,
      p05,
      p95,
      p99,
      probProfit,
      riskOfRuin: bankroll > 0 ? ruinedCount / S : 0,
      maxDrawdownMean: ddMean,
      maxDrawdownWorst: ddWorst,
      maxDrawdownMedian,
      maxDrawdownP95,
      maxDrawdownP99,
      recoveryMedian,
      recoveryP90,
      recoveryUnrecoveredShare,
      longestCashlessMean,
      longestCashlessWorst: cashlessWorst,
      longestBreakevenMean: beMean,
      breakevenStreakMean: beStreakMean,
      var95,
      var99,
      cvar95,
      cvar99,
      sharpe,
      sortino,
      tournamentsFor95ROI,
      minBankrollRoR1pct,
      minBankrollRoR5pct,
      minBankrollRoR15pct,
      minBankrollRoR50pct,
      minBankrollRoR1pctGaussian,
      minBankrollRoR5pctGaussian,
      riskOfRuinGaussian,
      mcSeMean,
      mcSeStdDev,
      mcCi95HalfWidthMean,
      mcRoiErrorPct,
      mcPrecisionScore,
      mcSamplesFor1Pct,
      neverBelowZeroFrac,
      itmRate: compiled.itmRate,
      skewness,
      kurtosis,
      kellyFraction,
      kellyBankroll,
      logGrowthRate,
      maxDrawdownBuyIns:
        compiled.totalBuyIn > 0
          ? ddMean / (compiled.totalBuyIn / N)
          : 0,
      sigmaPerTournamentAnalytic: (() => {
        // √( Σ σᵢ² / N ) — per-tourney σ assuming independent rows. Matches
        // how stdDev/√N is interpreted on the MC side.
        if (compiled.flat.length === 0) return 0;
        let acc = 0;
        for (const e of compiled.flat) {
          const s = e.sigmaSingleAnalytic;
          acc += s * s;
        }
        return Math.sqrt(acc / compiled.flat.length);
      })(),
      sigmaPerTournamentEmpirical: sigmaPerTourn,
    },
  };
}

/**
 * Hastings approximation for the standard normal CDF Φ(z). Same algorithm
 * used by PrimeDope's legacy JS (function `q` at line 1192 of tmp_legacy.js)
 * so the Gaussian-RoR readout lines up with theirs bit-for-bit.
 */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const a = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-a * a);
  return 0.5 * (1 + sign * y);
}

function countProfits(arr: Float64Array): number {
  let n = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] > 0) n++;
  return n;
}

/**
 * Build a linear histogram from a "counts per integer length" array.
 * The input is effectively a sparse distribution keyed by streak length;
 * we re-bin it into [0, maxLen] linearly with `bins` buckets so the chart
 * renders "how often do streaks of this length occur" with a shape that
 * matches histogramOf (same {binEdges, counts} contract).
 */
function histogramFromCounts(
  countsByLen: Int32Array,
  bins: number,
  scale = 1,
): { binEdges: number[]; counts: number[] } {
  let maxLen = 0;
  let total = 0;
  for (let i = 1; i < countsByLen.length; i++) {
    const c = countsByLen[i];
    if (c > 0) {
      total += c;
      if (i > maxLen) maxLen = i;
    }
  }
  if (maxLen === 0 || total === 0) {
    return { binEdges: [0, 1], counts: new Array(bins).fill(0) };
  }
  // Long-tail guard. Streak-count distributions are near-geometric: most
  // mass sits on short streaks, but the tail goes to thousands. A naive
  // max-length or even p99 range still crushes the bulk into the first
  // bin (one heavy-tailed outlier dominates). Anchor the visible range to
  // the *median* instead: hi = median × 10, capped by p99 to stay honest
  // and by maxLen as a hard ceiling. This puts the median around bin 4/40
  // and makes the knee of the distribution clearly visible. Overflow
  // folds into the last bin; extremes remain available via
  // stats.longestBreakevenMean / -Worst.
  const pctLen = (p: number): number => {
    const target = total * p;
    let cum = 0;
    for (let i = 1; i <= maxLen; i++) {
      cum += countsByLen[i];
      if (cum >= target) return i;
    }
    return maxLen;
  };
  const medianLen = pctLen(0.5);
  const p999Len = pctLen(0.999);
  let hi = Math.min(maxLen, p999Len, Math.max(medianLen * 10, 20));
  if (hi < 1) hi = 1;
  // Streak lengths are integers — bin WIDTH must itself be an integer,
  // otherwise some bins cover 2 integer values and others cover 1, and
  // the overlay line alternates high/low between bins (hedgehog).
  const w = hi <= bins ? 1 : Math.ceil(hi / bins);
  bins = Math.max(1, Math.ceil(hi / w));
  hi = bins * w;
  const binEdges: number[] = new Array(bins + 1);
  for (let i = 0; i <= bins; i++) binEdges[i] = i * w * scale;
  const counts: number[] = new Array(bins).fill(0);
  for (let len = 1; len <= maxLen; len++) {
    const c = countsByLen[len];
    if (c === 0) continue;
    let b = len >= hi ? bins - 1 : Math.floor(len / w);
    if (b < 0) b = 0;
    else if (b >= bins) b = bins - 1;
    counts[b] += c;
  }
  return { binEdges, counts };
}

export function histogramOf(
  arr: Float64Array,
  bins: number,
  nonNegative = false,
  longTailClip = false,
): { binEdges: number[]; counts: number[] } {
  const n = arr.length;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (nonNegative) lo = 0;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi === lo) {
    hi = lo + 1;
  }
  // Long-tail guard (opt-in): a single jackpot sample at 100× median
  // (Mystery Royale right tail) stretches the x-axis 2+ orders of
  // magnitude and crushes the visible bulk into the first 1-2 bins.
  // Upper bound = min(p99.9, median + 4·IQR): for approximately-Gaussian
  // data the p99.9 wins and behavior is unchanged; for jackpot-heavy data
  // the Tukey bound wins and keeps the bulk readable. Overflow folds into
  // the last bin; raw extremes still exposed via stats.*.
  //
  // For signed data (finalProfits: losses AND wins) mirror the same clip
  // on the lower side so an asymmetric right tail can't push the bulk
  // off-axis to the left. Right-skewed non-negative distributions
  // (drawdowns, recovery) keep lo = min(arr) — the left side carries
  // real information there, not a clipped tail.
  if (longTailClip && n > 1) {
    const sorted = new Float64Array(arr);
    sorted.sort();
    const q = (p: number): number =>
      sorted[Math.min(n - 1, Math.max(0, Math.floor(p * (n - 1))))];
    const p999 = q(0.999);
    if (p999 > lo + 1e-9 && p999 < hi) hi = p999;
    if (!nonNegative && lo < 0) {
      const med = q(0.5);
      const iqr = q(0.75) - q(0.25);
      if (iqr > 0) {
        const upper = med + 4 * iqr;
        const lower = med - 4 * iqr;
        if (upper < hi) hi = upper;
        if (lower > lo) lo = lower;
      }
    }
  }
  const span = hi - lo;
  const binEdges: number[] = new Array(bins + 1);
  for (let i = 0; i <= bins; i++) binEdges[i] = lo + (span * i) / bins;
  const counts: number[] = new Array(bins).fill(0);
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    let b = v >= hi ? bins - 1 : Math.floor(((v - lo) / span) * bins);
    if (b < 0) b = 0;
    else if (b >= bins) b = bins - 1;
    counts[b]++;
  }
  return { binEdges, counts };
}

// =====================================================================
// Sharded execution
// ---------------------------------------------------------------------
// The hot loop is extracted here so a worker pool can run disjoint
// [sStart, sEnd) slices on different cores and the main thread can
// merge the raw buffers back together before running aggregation.
//
// Determinism note: the serial engine used to carry a *single* shock RNG
// stream across every sample in the run, which made output depend on
// sample-visit order — fine serially, broken under sharding. The sharded
// version seeds a fresh shock RNG per sample (mixSeed(seed ^ 0xbeef, s))
// so splitting samples across workers produces the same aggregate as a
// monolithic run. Individual sample numerics differ from the pre-shard
// engine, but the statistical expectation is unchanged and all tests
// live inside noise bounds rather than asserting exact byte values.
// =====================================================================

export interface RawShard {
  sStart: number;
  sEnd: number;
  finalProfits: Float64Array;
  pathMatrix: Float64Array;
  maxDrawdowns: Float64Array;
  /** Per-sample max upswing: max(profit − runningMin). Mirror of maxDrawdowns
   *  used to surface top-N upswings alongside top-N downswings. */
  maxRunUps: Float64Array;
  runningMins: Float64Array;
  longestBreakevens: Float64Array;
  /** Per-sample mean first-forward-return chord length, in tournament units.
   *  For each checkpoint ii, scan forward for the first jj>ii where the
   *  segment [jj-1, jj] crosses Y[ii]; record (jj-ii); average across all
   *  starting points that had a return. Zero for samples with no returns
   *  (monotone paths). This is the "any streak between two equal-Y points"
   *  metric — the dual of longestBreakevens (max chord per sample). */
  breakevenStreakAvgs: Float64Array;
  longestCashless: Int32Array;
  recoveryLengths: Int32Array;
  /** Per-length histograms. `breakevenStreakCounts` counts one entry
   *  per starting point per sample at the grid-unit length of that
   *  point's longest horizontal chord (index in [0, K], scale by N/K
   *  for tournament units). Chord-grid units avoid alias peaks from
   *  uneven round(gridPos * N/K) quantization. `cashlessStreakCounts`
   *  counts EVERY cashless streak across every sample, indexed by
   *  length in tournaments; length N + 1. Merged additively across
   *  shards. */
  breakevenStreakCounts: Int32Array;
  cashlessStreakCounts: Int32Array;
  rowProfits: Float64Array;
  /** Bounty-only contribution per (sample, row), parallel-allocated to
   *  `rowProfits`. Accumulates only the `bountyDraw` part of each delta;
   *  zero entries for rows without bounty configuration. Used by the
   *  decomposition chart to split the mean bar into cash vs. bounty. */
  rowBountyProfits: Float64Array;
  /** Per-sample 0/1 flag: 1 if any single bounty-bearing tournament in
   *  this sample had its summed per-KO envelope ratios reach
   *  JACKPOT_THRESHOLD. Catches both single-tier jackpots (one ratio
   *  ≥ threshold) and compound jackpots (many moderate tiers adding up
   *  within one tournament). Observational side-effect of existing
   *  bounty draws (no extra RNG), so it preserves the seed→result
   *  determinism contract. Empty (length 0) for schedules without
   *  mystery rows — callers must null-check. */
  jackpotMask: Uint8Array;
  ruinedCount: number;
  /** Hi-res capture grid (K'+1 points). Shared across all hi-res buffers
   *  in this shard. */
  hiResCheckpointIdx: Int32Array;
  /** Per-sample hi-res paths for the first `wantHiResPaths` samples of
   *  this shard. */
  hiResPaths: Float64Array[];
  /** Global sample ids parallel to `hiResPaths`, used by UI filters that need
   *  to map visible paths back to per-sample result arrays. */
  hiResSampleIndices: Int32Array;
  /** Snapshot of the shard-local best-final-profit sample path. */
  hiResBestPath: Float64Array;
  hiResWorstPath: Float64Array;
  /** Final profit of the shard's best/worst sample (used to pick globally
   *  across multi-shard merges). ±Infinity for empty shards. */
  hiResBestFinal: number;
  hiResWorstFinal: number;
  /** Pointwise min/max across every sample in this shard, on the hi-res
   *  checkpoint grid. Merged across shards via pointwise min/max. */
  hiResMin: Float64Array;
  hiResMax: Float64Array;
}

export interface CheckpointGrid {
  K: number;
  checkpointIdx: Int32Array;
}

export function makeCheckpointGrid(N: number): CheckpointGrid {
  const K = Math.min(240, N);
  const checkpointIdx = new Int32Array(K + 1);
  for (let j = 0; j <= K; j++) checkpointIdx[j] = Math.round((j * N) / K);
  return { K, checkpointIdx };
}

// Hi-res grid for the visible sample paths + best/worst curves. At K=80 each
// checkpoint averages N/80 tournaments, so a single big cash spreads over ~13
// finishes and the line reads as a gentle slope instead of a staircase. We
// capture a second set of checkpoints at up to 4000 points for the handful of
// sample curves actually rendered — envelope sorts still run on the K=80 grid,
// so compute/memory stay bounded while the chart regains real vertical candles.
const MAX_HIRES_POINTS = 4000;
export function makeHiResGrid(N: number): CheckpointGrid {
  const K = Math.min(MAX_HIRES_POINTS, N);
  const checkpointIdx = new Int32Array(K + 1);
  for (let j = 0; j <= K; j++) checkpointIdx[j] = Math.round((j * N) / K);
  return { K, checkpointIdx };
}

/** Linear interpolation of an arbitrary series from one checkpoint grid to
 * another. Both grids must cover the same [0, N] interval; the destination
 * grid is usually a refinement (upsample), but equal-length passthrough and
 * coarsening also work. */
function upsampleToGrid(
  src: Float64Array,
  srcIdx: Int32Array,
  dstIdx: Int32Array,
): Float64Array {
  const out = new Float64Array(dstIdx.length);
  let lo = 0;
  const last = srcIdx.length - 1;
  for (let d = 0; d < dstIdx.length; d++) {
    const xd = dstIdx[d];
    while (lo < last && srcIdx[lo + 1] <= xd) lo++;
    if (lo >= last) {
      out[d] = src[last];
      continue;
    }
    const x0 = srcIdx[lo];
    const x1 = srcIdx[lo + 1];
    const span = x1 - x0;
    const t = span > 0 ? (xd - x0) / span : 0;
    out[d] = src[lo] * (1 - t) + src[lo + 1] * t;
  }
  return out;
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
      const maxB = t.maxEntries;
      const pc = t.paidCount;
      const mystVar = t.mysteryBountyLogVar;
      const mystSig = t.mysteryBountyLogSigma;
      const brRatios = t.brTierRatios;
      const brAliasProb = t.brTierAliasProb;
      const brAliasIdx = t.brTierAliasIdx;
      let delta = 0;
      let cashedThisSlot = false;
      if (maxB === 1) {
        // Vose alias: one uniform → O(1) finish draw.
        const r0 = rng() * aliasN;
        const i0 = r0 | 0;
        const place = r0 - i0 < aliasProb[i0] ? i0 : aliasIdx[i0];
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
                  if (sumRatio >= JACKPOT_THRESHOLD) jackpotMask[localS] = 1;
                }
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
      } else {
        const reRate = t.reRate;
        for (let b = 0; b < maxB; b++) {
          const r1 = rng() * aliasN;
          const i1 = r1 | 0;
          const place = r1 - i1 < aliasProb[i1] ? i1 : aliasIdx[i1];
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
                    if (sumRatio >= JACKPOT_THRESHOLD) jackpotMask[localS] = 1;
                  }
                }
              } else {
                bountyDraw = mean;
              }
            } else {
              bountyDraw = mean;
            }
          }
          delta += prizes[place] + bountyDraw - bulletCost + rakebackPerBullet;
          if (bountyDraw !== 0) rowBountyProfits[rowBase + t.rowIdx] += bountyDraw;
          if (place < pc) {
            cashedThisSlot = true;
            break;
          }
          if (b + 1 < maxB && rng() >= reRate) break;
        }
      }
      profit += delta;
      rowProfits[rowBase + t.rowIdx] += delta;

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
    for (let ii = 0; ii < K1 - 1; ii++) {
      const Pi = pathMatrix[pathBase + ii];
      let chordLen = 0;
      for (let jj = K1 - 1; jj > ii; jj--) {
        const a = pathMatrix[pathBase + jj - 1];
        const b = pathMatrix[pathBase + jj];
        const lo = a < b ? a : b;
        const hi = a < b ? b : a;
        if (lo <= Pi && Pi <= hi) {
          // Skip the trivial case where the segment only touches Pi at
          // its left endpoint (which is time ii itself): that isn't a
          // distinct second point.
          if (jj === ii + 1 && a === Pi && b !== Pi) break;
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
        const a = pathMatrix[pathBase + jj - 1];
        const b = pathMatrix[pathBase + jj];
        const lo = a < b ? a : b;
        const hi = a < b ? b : a;
        if (lo <= Pi && Pi <= hi) {
          if (jj === ii + 1 && a === Pi && b !== Pi) continue;
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

    finalProfits[localS] = profit;
    maxDrawdowns[localS] = maxDD;
    maxRunUps[localS] = maxUp;
    runningMins[localS] = runningMin;
    longestBreakevens[localS] = longestBreakeven;
    breakevenStreakAvgs[localS] = breakevenStreakAvg;
    longestCashless[localS] = longestCashlessRun;
    recoveryLengths[localS] = sampleRecoveryLen;
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

/**
 * Stitch disjoint shards covering [0, S) into a single RawShard with
 * full-sized buffers. Fast-paths a single full-range shard by returning
 * it directly (no copies).
 */
export function mergeShards(
  shards: RawShard[],
  S: number,
  K1: number,
  numRows: number,
): RawShard {
  if (
    shards.length === 1 &&
    shards[0].sStart === 0 &&
    shards[0].sEnd === S
  ) {
    return shards[0];
  }
  const sorted = shards.slice().sort((a, b) => a.sStart - b.sStart);
  const finalProfits = new Float64Array(S);
  const pathMatrix = new Float64Array(S * K1);
  const maxDrawdowns = new Float64Array(S);
  const maxRunUps = new Float64Array(S);
  const runningMins = new Float64Array(S);
  const longestBreakevens = new Float64Array(S);
  const breakevenStreakAvgs = new Float64Array(S);
  const longestCashless = new Int32Array(S);
  const recoveryLengths = new Int32Array(S);
  const rowProfits = new Float64Array(S * numRows);
  const rowBountyProfits = new Float64Array(S * numRows);
  const jackpotMask = new Uint8Array(S);
  const beCountsLen = sorted[0].breakevenStreakCounts.length;
  const clCountsLen = sorted[0].cashlessStreakCounts.length;
  const breakevenStreakCounts = new Int32Array(beCountsLen);
  const cashlessStreakCounts = new Int32Array(clCountsLen);
  let ruinedCount = 0;
  for (const sh of sorted) {
    finalProfits.set(sh.finalProfits, sh.sStart);
    maxDrawdowns.set(sh.maxDrawdowns, sh.sStart);
    maxRunUps.set(sh.maxRunUps, sh.sStart);
    runningMins.set(sh.runningMins, sh.sStart);
    longestBreakevens.set(sh.longestBreakevens, sh.sStart);
    breakevenStreakAvgs.set(sh.breakevenStreakAvgs, sh.sStart);
    longestCashless.set(sh.longestCashless, sh.sStart);
    recoveryLengths.set(sh.recoveryLengths, sh.sStart);
    pathMatrix.set(sh.pathMatrix, sh.sStart * K1);
    rowProfits.set(sh.rowProfits, sh.sStart * numRows);
    rowBountyProfits.set(sh.rowBountyProfits, sh.sStart * numRows);
    jackpotMask.set(sh.jackpotMask, sh.sStart);
    for (let i = 0; i < beCountsLen; i++) {
      breakevenStreakCounts[i] += sh.breakevenStreakCounts[i];
    }
    for (let i = 0; i < clCountsLen; i++) {
      cashlessStreakCounts[i] += sh.cashlessStreakCounts[i];
    }
    ruinedCount += sh.ruinedCount;
  }
  // Hi-res aggregation: concatenate per-shard hiResPaths in sStart order so
  // the slider exposes the union of each shard's budget (not just shard 0).
  // Global best/worst are still picked by scanning per-shard extrema.
  const leading = sorted[0];
  const hiResCheckpointIdx = leading.hiResCheckpointIdx;
  const hiResPaths: Float64Array[] = [];
  const hiResSampleIndices: number[] = [];
  for (const sh of sorted) {
    for (let i = 0; i < sh.hiResPaths.length; i++) {
      hiResPaths.push(sh.hiResPaths[i]);
      hiResSampleIndices.push(sh.hiResSampleIndices[i]);
    }
  }
  let bestShard = leading;
  let worstShard = leading;
  for (const sh of sorted) {
    if (sh.hiResBestFinal > bestShard.hiResBestFinal) bestShard = sh;
    if (sh.hiResWorstFinal < worstShard.hiResWorstFinal) worstShard = sh;
  }
  // Pointwise min/max across shards.
  const mergedHiResMin = new Float64Array(leading.hiResMin.length);
  const mergedHiResMax = new Float64Array(leading.hiResMax.length);
  mergedHiResMin.set(leading.hiResMin);
  mergedHiResMax.set(leading.hiResMax);
  for (let i = 1; i < sorted.length; i++) {
    const mn = sorted[i].hiResMin;
    const mx = sorted[i].hiResMax;
    for (let j = 0; j < mergedHiResMin.length; j++) {
      if (mn[j] < mergedHiResMin[j]) mergedHiResMin[j] = mn[j];
      if (mx[j] > mergedHiResMax[j]) mergedHiResMax[j] = mx[j];
    }
  }
  return {
    sStart: 0,
    sEnd: S,
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
    ruinedCount,
    hiResCheckpointIdx,
    hiResPaths,
    hiResSampleIndices: Int32Array.from(hiResSampleIndices),
    hiResBestPath: bestShard.hiResBestPath,
    hiResWorstPath: worstShard.hiResWorstPath,
    hiResBestFinal: bestShard.hiResBestFinal,
    hiResWorstFinal: worstShard.hiResWorstFinal,
    hiResMin: mergedHiResMin,
    hiResMax: mergedHiResMax,
  };
}
