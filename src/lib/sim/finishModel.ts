import { buildFreezeCashPMF } from "./freezeShape";
import {
  applyItmTopHeavyToFreeBand,
  clampItmTopHeavyBias,
  finishModelSupportsItmTopHeavy,
} from "./itmTopHeavy";
import { buildMysteryCashPMF } from "./mysteryShape";
import { buildPkoCashPMF } from "./pkoShape";
import type { FinishModelConfig, FinishModelId } from "./types";

const REFERENCE_SHAPE_MODELS: ReadonlySet<FinishModelId> = new Set([
  "freeze-realdata-step",
  "freeze-realdata-linear",
  "freeze-realdata-tilt",
  "pko-realdata-step",
  "pko-realdata-linear",
  "pko-realdata-tilt",
  "mystery-realdata-step",
  "mystery-realdata-linear",
  "mystery-realdata-tilt",
]);

// Fixed-shape models: α is ignored (or the pmf is built directly from an
// embedded sample), so `calibrateAlpha` short-circuits to 0 and the finish
// distribution does not respond to the ROI target. Every realdata-* model
// plus the two neutral shapes (uniform, empirical).
const FIXED_SHAPE_MODELS: ReadonlySet<FinishModelId> = new Set<FinishModelId>([
  "uniform",
  "empirical",
  ...REFERENCE_SHAPE_MODELS,
]);

/**
 * How far a solved cash EV may sit from its target and still count as hitting
 * it, as a share of the target. The share is the same at every stake: an
 * absolute dollar slack was 9% of a $0.01 ticket and 0.005% of a $20 one.
 */
const TARGET_EV_REL_TOL = 1e-3;

export function targetEvTolerance(target: number): number {
  return TARGET_EV_REL_TOL * Math.max(Math.abs(target), 1e-9);
}

export function withinTargetEv(actual: number, target: number): boolean {
  return Math.abs(actual - target) <= targetEvTolerance(target);
}

/**
 * Smallest cash EV the solvers are asked to hit. It only keeps the target off
 * zero when a bounty takes nearly the whole winnings, so it follows the ticket:
 * a fixed $0.01 sat above the real target of a $0.01 buy-in and the row paid
 * -9% whatever ROI was typed.
 */
export function cashTargetFloor(entryCost: number): number {
  return Math.min(0.01, Math.max(1e-6, 1e-3 * entryCost));
}

/**
 * The most bounty EV one entry can collect: the whole bounty pool, and nothing
 * when it finishes last. When the pinned ITM caps the cash side, the engine
 * pays the rest of the ROI as bounty; past this ceiling that is money the
 * table does not hold (heads-up PKO at any winning ROI paid the winner $131
 * from a $100 pool).
 */
export function bountyEvCeiling(
  N: number,
  buyIn: number,
  bountyFraction: number,
  pmf: Float64Array,
): number {
  return N * buyIn * bountyFraction * (1 - (pmf[N - 1] ?? 0));
}

/**
 * True when the bounty pool can pay `residual` of KO EV to one entry. The
 * slack is rounding only (a heads-up row at the ITM its ROI implies lands on
 * the ceiling to the last bit): past the ceiling the engine would pay money
 * the table does not hold, so the on-target tolerance does not apply.
 */
export function bountyResidualFits(residual: number, ceiling: number): boolean {
  return residual <= ceiling * (1 + 1e-9);
}

/**
 * True when the model calibrates its α (or shell mass) so that
 * Σ pmf·prize = singleCost·(1+ROI). False for the fixed shapes that ignore
 * the ROI target by design: every realdata-* model, uniform and empirical.
 * Used in UI to label the model and to word the expected-profit readout.
 */
export function finishModelSupportsTargetRoi(id: FinishModelId): boolean {
  return !FIXED_SHAPE_MODELS.has(id);
}

/**
 * True when the model carries its own whole-field finish distribution, so the
 * row's ITM, shell locks and top-heaviness do not apply: the realdata shapes
 * and a pasted empirical history. An empirical model with no data keeps the
 * documented fallback (uniform over the paid places at the row's ITM).
 */
export function playsWholeFieldShape(model: FinishModelConfig): boolean {
  if (REFERENCE_SHAPE_MODELS.has(model.id)) return true;
  return model.id === "empirical" && (model.empiricalBuckets?.some((v) => v > 0) ?? false);
}

/**
 * True for the three real-data tilt models, the only ones whose shape reads a
 * hand-set α on a fixed-ITM row. Every other model solves its own α against
 * the row's ROI there, so an α sent with it is ignored.
 */
export function supportsManualAlpha(id: FinishModelId): boolean {
  return (
    id === "freeze-realdata-tilt" ||
    id === "pko-realdata-tilt" ||
    id === "mystery-realdata-tilt"
  );
}

/** The range the α field accepts; anything stored or linked is held to it too. */
export const MANUAL_ALPHA_MIN = -0.5;
export const MANUAL_ALPHA_MAX = 0.5;

/** The α override to send with `id`: the typed value, or none when `id` ignores it. */
export function manualAlphaFor(
  id: FinishModelId,
  alpha: number | null | undefined,
): number | undefined {
  return supportsManualAlpha(id) && alpha != null && Number.isFinite(alpha)
    ? alpha
    : undefined;
}

/**
 * True when the model's α is solved against the ROI target — so for any
 * given `targetWinnings`, `calibrateAlpha` will move α until
 * `Σ pmf × payouts × pool ≈ targetWinnings`. False for fixed-shape models
 * (uniform / empirical / all realdata-*) and for models where the caller
 * has pinned α explicitly — in both cases, cash EV does not adapt to
 * external targets and the bounty budget must be closed via a residual
 * reconcile to keep the total-EV ROI contract honest.
 */
export function isAlphaAdjustable(model: FinishModelConfig): boolean {
  if (model.alpha !== undefined) return false;
  return !FIXED_SHAPE_MODELS.has(model.id);
}

/**
 * Splits `totalWinningsEV` between cash and bounty by nudging bounty away
 * from its principled anchor while keeping total EV pinned.
 *
 *   bias = 0         → bountyMean = anchor
 *   bias ∈ (0, 0.25] → bountyMean = anchor × (1 − bias)          (more cash share)
 *   bias ∈ [−0.25,0) → bountyMean = anchor + |bias|·(total − anchor)   (more bounty share)
 *
 * Bias ≥ 0 shrinks bounty proportionally; negative bias grows bounty part
 * of the way toward the ceiling `totalWinningsEV`. Caller is responsible
 * for clamping bias to ±0.25 and for pairing this with α-driven cash
 * movement (α-adjustable models) or a shape-driven cashEV (fixed-shape
 * models) — the helper only does the bounty-side split.
 */
export function applyBountyBias(
  anchor: number,
  totalWinningsEV: number,
  bias: number,
): number {
  if (bias >= 0) return anchor * (1 - bias);
  return anchor + (-bias) * Math.max(0, totalWinningsEV - anchor);
}

/**
 * Probability distribution over finish places 1..N for a single player.
 * Returns a Float64Array of length N summing to 1.
 */
export function buildFinishPMF(
  N: number,
  model: FinishModelConfig,
  alpha: number,
): Float64Array {
  const pmf = new Float64Array(N);
  switch (model.id) {
    case "uniform": {
      pmf.fill(1 / N);
      return pmf;
    }
    case "freeze-realdata-step":
      return buildFreezeCashPMF(N, "step", 0);
    case "freeze-realdata-linear":
      return buildFreezeCashPMF(N, "linear", 0);
    case "freeze-realdata-tilt":
      return buildFreezeCashPMF(N, "tilt", alpha);
    case "pko-realdata-step":
      return buildPkoCashPMF(N, "step", 0);
    case "pko-realdata-linear":
      return buildPkoCashPMF(N, "linear", 0);
    case "pko-realdata-tilt":
      return buildPkoCashPMF(N, "tilt", alpha);
    case "mystery-realdata-step":
      return buildMysteryCashPMF(N, "step", 0);
    case "mystery-realdata-linear":
      return buildMysteryCashPMF(N, "linear", 0);
    case "mystery-realdata-tilt":
      return buildMysteryCashPMF(N, "tilt", alpha);
    case "powerlaw-realdata-influenced": {
      // Same power-law shape as the plain "power-law" model; the id is
      // historical and the shape is not fitted to real tournament data. α is
      // solved upstream against the row's target ROI, and the cashing share is
      // the row's itmRate, which the run path fills with the payout table's
      // paid-places share unless the row or the global ITM target sets one
      // (that target is optional; 18.7% is only its default value).
      let s = 0;
      for (let i = 1; i <= N; i++) {
        const v = Math.pow(i, -alpha);
        pmf[i - 1] = v;
        s += v;
      }
      for (let i = 0; i < N; i++) pmf[i] /= s;
      return pmf;
    }
    case "empirical": {
      // Resample a user-provided histogram over 1..M onto 1..N. Missing
      // data → fall back to uniform so the simulator keeps running.
      const src = model.empiricalBuckets;
      if (!src || src.length === 0) {
        pmf.fill(1 / N);
        return pmf;
      }
      const M = src.length;
      let s = 0;
      // src[j] is a density over [j, j+1) in source-index space, integrated over
      // each destination cell: every pasted bucket keeps its share of the field
      // at any N. Point-sampling gives the end buckets half a cell and, for N < M,
      // can alias to an all-zero pmf.
      for (let i = 0; i < N; i++) {
        const a = (i / N) * M;
        const b = ((i + 1) / N) * M;
        const jhi = Math.min(M - 1, Math.ceil(b) - 1);
        let acc = 0;
        for (let j = Math.floor(a); j <= jhi; j++) {
          const lo = Math.max(a, j);
          const hi = Math.min(b, j + 1);
          if (hi > lo) acc += Math.max(0, src[j]) * (hi - lo);
        }
        pmf[i] = acc;
        s += acc;
      }
      if (s <= 0) {
        pmf.fill(1 / N);
        return pmf;
      }
      for (let i = 0; i < N; i++) pmf[i] /= s;
      return pmf;
    }
    case "linear-skill": {
      // slope = tanh(alpha) is bounded to (-1, 1), so the pmf can tilt at most
      // to a triangular shape — its max E[W] saturates well below the
      // power-law / Plackett-Luce models (~20x lower on top-heavy payouts).
      // High-ROI rows therefore clamp alpha at the bisection ceiling and are
      // run-blocked by validateSchedule as infeasible; pick power-law /
      // plackett-luce for a strong top-heavy edge.
      const slope = Math.tanh(alpha);
      const mid = (N + 1) / 2;
      const half = Math.max((N - 1) / 2, 1e-9);
      let s = 0;
      for (let i = 1; i <= N; i++) {
        const v = Math.max(0, 1 + slope * ((mid - i) / half));
        pmf[i - 1] = v;
        s += v;
      }
      for (let i = 0; i < N; i++) pmf[i] /= s;
      return pmf;
    }
    case "stretched-exp": {
      // Exponential / stretched-exp in discrete form:
      //   p_i ∝ exp(−alpha · (i−1)^beta)
      // β=1 → plain geometric decay; β<1 → fatter tail; β>1 → sharper head.
      // α=0 → uniform, α→∞ → all mass on i=1, α<0 → skewed to bottom.
      const beta = model.beta ?? 1;
      const sign = alpha >= 0 ? 1 : -1;
      const absA = Math.abs(alpha);
      let s = 0;
      // To handle α<0 symmetrically we flip the place index.
      for (let i = 1; i <= N; i++) {
        const k = sign >= 0 ? i - 1 : N - i;
        const v = Math.exp(-absA * Math.pow(k, beta));
        pmf[i - 1] = v;
        s += v;
      }
      for (let i = 0; i < N; i++) pmf[i] /= s;
      return pmf;
    }
    case "plackett-luce": {
      // Plackett-Luce with one skilled player (skill s ≥ 0) against N−1
      // identical baseline opponents (skill 1). The CDF of the skilled
      // player's finish rank k is 1 − Π_{j=1..k}(N−j)/(N−j+s), yielding
      //
      //   P(rank = k) = tail(k−1) − tail(k), tail(k) = Π (N−j)/(N−j+s)
      //
      // For s = 1 the distribution is uniform; as s → ∞ all mass collapses
      // to rank 1. It's the standard ranking model from psychometrics /
      // sports ranking literature (Plackett 1975, Luce 1959) and gives a
      // cleaner theoretical grounding than the ad-hoc i^−α power law.
      //
      // We reparametrize α → s = exp(α) so α ∈ ℝ is monotone increasing
      // in skill, α = 0 ↔ uniform, and the existing α binary-search works
      // without changing its search bounds.
      const s = Math.max(1e-6, Math.exp(alpha));
      let tail = 1;
      let acc = 0;
      for (let k = 1; k <= N; k++) {
        const denom = N - k + s;
        const newTail = denom > 0 ? tail * ((N - k) / denom) : 0;
        const p = tail - newTail;
        pmf[k - 1] = p;
        acc += p;
        tail = newTail;
      }
      // Guard against cumulative numerical drift on huge N.
      if (acc > 0 && Math.abs(acc - 1) > 1e-9) {
        for (let i = 0; i < N; i++) pmf[i] /= acc;
      }
      return pmf;
    }
    case "power-law":
    default: {
      let s = 0;
      for (let i = 1; i <= N; i++) {
        const v = Math.pow(i, -alpha);
        pmf[i - 1] = v;
        s += v;
      }
      for (let i = 0; i < N; i++) pmf[i] /= s;
      return pmf;
    }
  }
}

export function expectedWinnings(
  pmf: Float64Array,
  payouts: number[],
  prizePool: number,
): number {
  let ew = 0;
  const paid = Math.min(payouts.length, pmf.length);
  for (let i = 0; i < paid; i++) ew += pmf[i] * payouts[i] * prizePool;
  return ew;
}

/**
 * Binary-search an alpha value so that player's expected ROI matches target.
 * E[W] is monotonically increasing in alpha for every α-adjustable model that
 * routes through this bisection — power-law, linear-skill, stretched-exp,
 * plackett-luce (α → skill s = e^α), and powerlaw-realdata-influenced. For
 * `uniform` E[W] is constant in alpha, so calibration is impossible — we pin
 * alpha=0 and the configured ROI has no effect on the finish distribution.
 * Callers that need ROI to bite must pick a skill model.
 */
export function calibrateAlpha(
  N: number,
  payouts: number[],
  prizePool: number,
  costPerEntry: number,
  targetROI: number,
  model: FinishModelConfig,
): number {
  if (model.alpha !== undefined) return model.alpha;
  if (FIXED_SHAPE_MODELS.has(model.id)) return 0;
  const targetWinnings = costPerEntry * (1 + targetROI);
  const range =
    model.id === "stretched-exp" ? { lo: -5, hi: 8 } : { lo: -6, hi: 25 };

  const ewLo = expectedWinnings(
    buildFinishPMF(N, model, range.lo),
    payouts,
    prizePool,
  );
  const ewHi = expectedWinnings(
    buildFinishPMF(N, model, range.hi),
    payouts,
    prizePool,
  );
  if (targetWinnings <= ewLo) return range.lo;
  if (targetWinnings >= ewHi) return range.hi;

  let lo = range.lo;
  let hi = range.hi;
  for (let iter = 0; iter < 50; iter++) {
    const mid = (lo + hi) / 2;
    const ew = expectedWinnings(
      buildFinishPMF(N, model, mid),
      payouts,
      prizePool,
    );
    if (ew < targetWinnings) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Shelled fixed-ITM calibration.
 *
 * Holds the in-the-money rate constant at `itmRate` and optionally pins the
 * cumulative masses of the "top shells" — P(place 1), P(top-3), P(FT = top-9).
 * Locked shells use uniform mass across their places; free places within the
 * paid band are shaped by the configured finish model, with α binary-searched
 * so total E[W] matches `targetWinnings`.
 *
 *   - Any unlocked shell inputs are `undefined`; pass empty object for pure α.
 *   - Cumulative constraint: first ≤ top3 ≤ ft ≤ itmRate. Violations are
 *     clamped defensively; returned `feasible` is false when the run couldn't
 *     hit the target (locked constraints left no α room).
 *   - `currentWinnings` is the actual Σ pmf·prize after solve; UI uses the
 *     delta vs target to explain "you need $X more on some place".
 */
export interface ShelledCalibrationResult {
  alpha: number;
  pmf: Float64Array;
  currentWinnings: number;
  feasible: boolean;
  /**
   * False for reference-shape models that embed a fixed empirical
   * distribution (`*-realdata-*`) — those ignore `targetWinnings` by
   * design. Distinct from `feasible`, which reports whether shell locks
   * left any α room to hit the target.
   */
  supportsTargetRoi: boolean;
  /** Computed cumulative shell probabilities in the final PMF. */
  shells: { first: number; top3: number; ft: number };
}

/**
 * Share of the no-skill cash winnings over which the fixed-ITM solver's
 * first-place floor fades out below break-even.
 */
const FIRST_PLACE_FLOOR_BAND = 0.1;

/**
 * Under a top-heavy tilt the 1/N-locked solution differs from the free one
 * even where the free P(1st) is exactly 1/N: locking first place moves the
 * tilt's top onto 2nd. The locked solution's share therefore fades out as
 * the free P(1st) rises from 1/N to this much above it, instead of dropping
 * to nothing at 1/N.
 */
const FIRST_PLACE_LOCK_FADE = 0.1;

/**
 * The least P(1st) a fixed-ITM row is held to: the no-skill 1/N from the
 * no-skill cash winnings up, falling linearly to nothing over
 * `FIRST_PLACE_FLOOR_BAND` of them. A floor that switched on at break-even
 * swapped the pmf between two neighbouring ROIs whenever the pinned ITM sat
 * above the table's paid share.
 */
function firstPlaceFloor(
  targetWinnings: number,
  equilibriumWinnings: number,
  equilibriumFirst: number,
): number {
  if (targetWinnings >= equilibriumWinnings - 1e-9) return equilibriumFirst;
  const ramp =
    (targetWinnings / equilibriumWinnings - (1 - FIRST_PLACE_FLOOR_BAND)) /
    FIRST_PLACE_FLOOR_BAND;
  return ramp > 0 ? equilibriumFirst * ramp : 0;
}

export function calibrateShelledItm(
  N: number,
  paidCount: number,
  payouts: readonly number[],
  prizePool: number,
  targetWinnings: number,
  itmRate: number,
  shellLocks: { first?: number; top3?: number; ft?: number } | undefined,
  model: FinishModelConfig,
  itmTopHeavyBias = 0,
  // The most cash EV the caller still plays at this target: a bounty row
  // hands an overpaid cash side's excess back through its KO budget.
  maxCashWinnings = targetWinnings,
): ShelledCalibrationResult {
  const pmf = new Float64Array(N);
  const paid = Math.max(0, Math.min(paidCount, N));
  const clampedItm = paid === N ? 1 : Math.max(0, Math.min(1, itmRate));
  const clampedTopHeavyBias = finishModelSupportsItmTopHeavy(model.id)
    ? clampItmTopHeavyBias(itmTopHeavyBias)
    : 0;

  const emptyShells = { first: 0, top3: 0, ft: 0 };
  // Uniform and empirical have no α to move, so the free band lands wherever
  // the shape puts it. Their gap to the row's ROI says nothing about whether
  // the locks are satisfiable, and the engine plays the shape either way.
  const ignoresTarget = !finishModelSupportsTargetRoi(model.id);

  // Real-data shapes embed the sample's ITM and cash-band width, and a pasted
  // history is a histogram over the whole field: squeezing it into the paid
  // places turned its busts into min-cashes and replaced its ITM with the
  // table's. Per-row itmRate / shell locks don't apply — we build the full PMF
  // directly and report whatever E[W] it produces.
  if (playsWholeFieldShape(model)) {
    const alpha = model.alpha ?? 0;
    const full = buildFinishPMF(N, model, alpha);
    let ew = 0;
    for (let i = 0; i < Math.min(payouts.length, N); i++) {
      ew += full[i] * payouts[i] * prizePool;
    }
    const ftEnd = Math.min(9, N);
    const sumR = (from: number, toExcl: number) => {
      let s = 0;
      for (let i = from; i < Math.min(toExcl, N); i++) s += full[i];
      return s;
    };
    return {
      alpha,
      pmf: full,
      currentWinnings: ew,
      feasible: true,
      supportsTargetRoi: false,
      shells: {
        first: full[0] ?? 0,
        top3: sumR(0, Math.min(3, N)),
        ft: sumR(0, ftEnd),
      },
    };
  }

  if (paid === 0 || prizePool <= 0 || clampedItm <= 0) {
    pmf.fill(1 / Math.max(1, N));
    return {
      alpha: 0,
      pmf,
      currentWinnings: 0,
      feasible: true,
      supportsTargetRoi: !ignoresTarget,
      shells: emptyShells,
    };
  }
  if (paid === 1) {
    pmf[0] = clampedItm;
    const rest = N - 1;
    if (rest > 0) {
      const q = (1 - clampedItm) / rest;
      for (let i = 1; i < N; i++) pmf[i] = q;
    }
    const w = pmf[0] * payouts[0] * prizePool;
    return {
      alpha: 0,
      pmf,
      currentWinnings: w,
      feasible: ignoresTarget || withinTargetEv(w, targetWinnings),
      supportsTargetRoi: !ignoresTarget,
      shells: { first: pmf[0], top3: pmf[0], ft: pmf[0] },
    };
  }

  // ---- 1. Determine locked shell layers --------------------------------
  const ftEnd = Math.min(9, paid);
  // Cumulative locks (monotone clamp). All are bounded to [0, itmRate].
  const locks = shellLocks ?? {};
  let equilibriumWinnings = 0;
  for (let i = 0; i < paid; i++) {
    equilibriumWinnings += (1 / N) * payouts[i] * prizePool;
  }
  const equilibriumFirst = 1 / N;
  const cumFirst =
    locks.first != null
      ? Math.max(0, Math.min(clampedItm, locks.first))
      : undefined;
  const cumTop3 =
    paid <= 3 && locks.top3 != null ? clampedItm : locks.top3 != null
      ? Math.max(cumFirst ?? 0, Math.min(clampedItm, locks.top3))
      : undefined;
  const cumFt =
    paid <= 9 && locks.ft != null ? clampedItm : locks.ft != null
      ? Math.max(cumTop3 ?? cumFirst ?? 0, Math.min(clampedItm, locks.ft))
      : undefined;

  // Layers (disjoint) — [startIdx, endIdxExcl, cumMass?, isLocked]
  // We only mark a layer as locked if BOTH its inner and outer cumulative
  // masses are known.
  interface Layer {
    start: number;
    end: number;
    locked: boolean;
    mass: number;
  }
  const layers: Layer[] = [];
  let prevEnd = 0;
  let prevCum: number | undefined = 0;
  const pushBoundary = (endIdx: number, cum: number | undefined) => {
    if (endIdx <= prevEnd) return;
    const locked = prevCum != null && cum != null;
    const mass = locked ? Math.max(0, (cum as number) - (prevCum as number)) : 0;
    layers.push({ start: prevEnd, end: endIdx, locked, mass });
    prevEnd = endIdx;
    prevCum = cum;
  };
  pushBoundary(1, cumFirst);
  pushBoundary(Math.min(3, paid), cumTop3);
  pushBoundary(ftEnd, cumFt);
  pushBoundary(paid, clampedItm); // outermost = itmRate

  // ---- 2. Identify free places and locked contribution -----------------
  const isLocked = new Uint8Array(paid);
  const perPlaceLocked = new Float64Array(paid);
  let totalLockedMass = 0;
  let lockedEw = 0;
  for (const layer of layers) {
    if (!layer.locked) continue;
    const width = layer.end - layer.start;
    if (width <= 0) continue;
    const perPlace = layer.mass / width;
    for (let i = layer.start; i < layer.end; i++) {
      isLocked[i] = 1;
      perPlaceLocked[i] = perPlace;
      totalLockedMass += perPlace;
      lockedEw += perPlace * payouts[i] * prizePool;
    }
  }

  const freeIndices: number[] = [];
  for (let i = 0; i < paid; i++) if (!isLocked[i]) freeIndices.push(i);
  const freeMassTotal = clampedItm - totalLockedMass;

  // ---- 3. Solve for α on the free band ---------------------------------
  let alpha = 0;
  let feasible = true;
  // Free-band mass the model gave no place to: it weights every free place at
  // exactly zero at the α the bisection ended on (linear skill at its ceiling
  // puts none on the last paid place; a stretched exponential underflows on a
  // far-tail band).
  let unplacedFreeMass = 0;

  if (freeIndices.length === 0 || freeMassTotal <= 1e-12) {
    // Nothing left to shape; locked layers fully determine the PMF.
    if (freeMassTotal < -1e-9) feasible = false;
    for (let i = 0; i < paid; i++) pmf[i] = perPlaceLocked[i];
  } else {
    const targetFreeEw = targetWinnings - lockedEw;

    // Shape the free places by sampling from buildFinishPMF(paid, model, α)
    // restricted to the free indices and renormalised to sum to freeMassTotal.
    // This preserves the configured model (power-law / linear / etc.) while
    // honouring the locks.
    const freeEw = (alphaVal: number): number => {
      const band = buildFinishPMF(paid, model, alphaVal);
      const { adjusted, freeSum: sFree } = applyItmTopHeavyToFreeBand(
        band,
        freeIndices,
        clampedTopHeavyBias,
      );
      if (sFree <= 0) return 0;
      let ew = 0;
      for (const idx of freeIndices) {
        const m = (adjusted[idx] / sFree) * freeMassTotal;
        ew += m * payouts[idx] * prizePool;
      }
      return ew;
    };

    const range =
      model.id === "stretched-exp" ? { lo: -5, hi: 8 } : { lo: -6, hi: 25 };
    const ewLo = freeEw(range.lo);
    const ewHi = freeEw(range.hi);

    // At an α bound the free band cannot move any further; the check on the
    // assembled pmf below decides whether what it reached is close enough.
    if (targetFreeEw <= ewLo) {
      alpha = range.lo;
    } else if (targetFreeEw >= ewHi) {
      alpha = range.hi;
    } else {
      let lo = range.lo;
      let hi = range.hi;
      for (let iter = 0; iter < 50; iter++) {
        const mid = (lo + hi) / 2;
        if (freeEw(mid) < targetFreeEw) lo = mid;
        else hi = mid;
      }
      alpha = (lo + hi) / 2;
    }

    // Assemble final PMF.
    const band = buildFinishPMF(paid, model, alpha);
    const { adjusted, freeSum: sFree } = applyItmTopHeavyToFreeBand(
      band,
      freeIndices,
      clampedTopHeavyBias,
    );
    for (let i = 0; i < paid; i++) pmf[i] = perPlaceLocked[i];
    if (sFree > 0) {
      for (const idx of freeIndices) {
        pmf[idx] += (adjusted[idx] / sFree) * freeMassTotal;
      }
    } else {
      unplacedFreeMass = freeMassTotal;
    }
  }

  // ---- 4. OOTM tail -----------------------------------------------------
  const rest = N - paid;
  if (rest > 0) {
    const q = (1 - clampedItm) / rest;
    for (let i = paid; i < N; i++) pmf[i] = q;
  }

  // ---- 5. Report -------------------------------------------------------
  const winningsOf = (): number => {
    let w = 0;
    for (let i = 0; i < paid; i++) w += pmf[i] * payouts[i] * prizePool;
    return w;
  };
  let currentWinnings = winningsOf();
  if (!ignoresTarget && !withinTargetEv(currentWinnings, targetWinnings)) feasible = false;

  const sumRange = (from: number, toExcl: number): number => {
    let s = 0;
    for (let i = from; i < Math.min(toExcl, paid); i++) s += pmf[i];
    return s;
  };
  const shellsOf = () => ({
    first: pmf[0] ?? 0,
    top3: sumRange(0, Math.min(3, paid)),
    ft: sumRange(0, ftEnd),
  });
  let shells = shellsOf();

  const firstFloor = firstPlaceFloor(targetWinnings, equilibriumWinnings, equilibriumFirst);
  const naturalFirst = shells.first;
  const belowFloor = naturalFirst < firstFloor - 1e-10;
  const tilted = clampedTopHeavyBias !== 0;
  // A top-3 or final-table lock typed under 1/N already holds P(1st) below
  // the floor; the lock is the user's, so the floor steps aside.
  const floorFitsLocks =
    (cumTop3 == null || cumTop3 >= equilibriumFirst) &&
    (cumFt == null || cumFt >= equilibriumFirst);
  let floored: ShelledCalibrationResult | null = null;
  if (
    locks.first == null &&
    paid > 1 &&
    clampedItm >= equilibriumFirst &&
    floorFitsLocks &&
    firstFloor > 0 &&
    (belowFloor || (tilted && naturalFirst < equilibriumFirst * (1 + FIRST_PLACE_LOCK_FADE)))
  ) {
    floored = calibrateShelledItm(
      N,
      paidCount,
      payouts,
      prizePool,
      targetWinnings,
      itmRate,
      { ...locks, first: equilibriumFirst },
      model,
      itmTopHeavyBias,
    );
    if (belowFloor && targetWinnings >= equilibriumWinnings - 1e-9) return floored;
  }

  if (unplacedFreeMass > 0) {
    // The locks and the ITM fix this band's mass whatever the model says, so
    // it still lands on the band, spread evenly. Runs after the equilibrium
    // first-place retry above so that retry keeps deciding on the same pmf
    // it always saw.
    const share = unplacedFreeMass / freeIndices.length;
    for (const idx of freeIndices) pmf[idx] += share;
    currentWinnings = winningsOf();
    feasible = ignoresTarget || withinTargetEv(currentWinnings, targetWinnings);
    shells = shellsOf();
  }

  // Short of the full 1/N lock the floor is met by a mixture with the 1/N
  // solution. Both solve the same target at the same ITM and locks, so the
  // mixture keeps them. Without a tilt the share is the least that lifts
  // P(1st) to the floor: 0 where the natural P(1st) meets it and 1 at
  // break-even. Under a tilt the two solutions differ below first place even
  // at equal P(1st), so the share is the floor's ramp times a fade over the
  // natural P(1st) from 1/N to FIRST_PLACE_LOCK_FADE above it: 1 where the
  // full lock applies, 0 at the band's onset and past the fade. Either share
  // is continuous in the target wherever the row stays on target. Where the
  // 1/N solution sits at an end of its α range, the share also stops where
  // the mixture's winnings would leave the target's tolerance or, on a bounty
  // row, pass what the caller plays (a natural solution already outside keeps
  // its own winnings as that bound); a 1/N solution that misses its target at
  // break-even itself is the old blocked row, and the mixture ends there.
  if (floored) {
    const flooredWinnings = floored.currentWinnings;
    const ceiling = Math.max(targetWinnings, maxCashWinnings);
    const high = Math.max(
      currentWinnings,
      (ceiling + targetEvTolerance(ceiling)) * (1 - 1e-9),
    );
    const low = Math.min(
      currentWinnings,
      (targetWinnings - targetEvTolerance(targetWinnings)) * (1 + 1e-9),
    );
    const bound =
      flooredWinnings > high
        ? (high - currentWinnings) / (flooredWinnings - currentWinnings)
        : flooredWinnings < low
          ? (currentWinnings - low) / (currentWinnings - flooredWinnings)
          : 1;
    const wanted = tilted
      ? (firstFloor / equilibriumFirst) *
        Math.min(
          1,
          (equilibriumFirst * (1 + FIRST_PLACE_LOCK_FADE) - naturalFirst) /
            (equilibriumFirst * FIRST_PLACE_LOCK_FADE),
        )
      : (firstFloor - naturalFirst) / (equilibriumFirst - naturalFirst);
    const share = Math.min(bound, wanted);
    if (share > 0) {
      for (let i = 0; i < N; i++) pmf[i] += share * (floored.pmf[i] - pmf[i]);
      alpha += share * (floored.alpha - alpha);
      currentWinnings = winningsOf();
      feasible = ignoresTarget || withinTargetEv(currentWinnings, targetWinnings);
      shells = shellsOf();
    }
  }

  return { alpha, pmf, currentWinnings, feasible, supportsTargetRoi: !ignoresTarget, shells };
}

/**
 * PrimeDope-compat finish distribution (two-bin uniform).
 *
 * PrimeDope's actual algorithm (verified against their legacy source):
 *   u = rand();
 *   if (u < l) place = uniform(0, paid);         // ITM — any paid slot
 *   else       place = uniform(paid, N);         // unpaid — any non-ITM slot
 * where `l` is the ITM probability chosen so expected winnings match the
 * player's target. Paid places use the REAL top-heavy payout curve unchanged,
 * so variance is dominated by the rare deep runs — exactly why PrimeDope's
 * site shows the huge spreads on large MTTs.
 *
 * Expressed as a pmf over places:
 *   pmf[i<paid]  = l / paid
 *   pmf[i>=paid] = (1 − l) / (N − paid)
 *
 * Mean winnings:
 *   E[W] = (l / paid) × Σ payouts_paid × pool = l × pool / paid
 * so we solve `l = target × paid / pool` and clamp to [0, 1].
 */
export function buildBinaryItmAssets(
  N: number,
  paidCount: number,
  payouts: readonly number[],
  prizePool: number,
  targetWinnings: number,
): { pmf: Float64Array; prizeByPlace: Float64Array } {
  const pmf = new Float64Array(N);
  const prizeByPlace = new Float64Array(N);
  if (N <= 0) return { pmf, prizeByPlace };
  const paid = Math.max(0, Math.min(paidCount, N));
  if (paid === 0 || prizePool <= 0) {
    pmf.fill(1 / N);
    return { pmf, prizeByPlace };
  }

  // Solve ITM rate so E[W] matches target. Clamp defensively.
  let l = (targetWinnings * paid) / prizePool;
  if (!Number.isFinite(l) || l < 0) l = 0;
  if (l > 1 || paid === N) l = 1;

  const pPaid = l / paid;
  const pUnpaid = N > paid ? (1 - l) / (N - paid) : 0;
  for (let i = 0; i < paid; i++) pmf[i] = pPaid;
  for (let i = paid; i < N; i++) pmf[i] = pUnpaid;

  // Real top-heavy payouts on paid places; zero elsewhere.
  const maxPaid = Math.min(paid, payouts.length);
  for (let i = 0; i < maxPaid; i++) {
    prizeByPlace[i] = payouts[i] * prizePool;
  }
  return { pmf, prizeByPlace };
}

/**
 * Sum of probabilities on paid places — the expected in-the-money rate for
 * a single tournament entry, directly readable from the PMF.
 */
export function itmProbability(
  pmf: Float64Array,
  paidCount: number,
): number {
  const paid = Math.min(paidCount, pmf.length);
  let s = 0;
  for (let i = 0; i < paid; i++) s += pmf[i];
  return s;
}

export function buildCDF(pmf: Float64Array): Float64Array {
  const cdf = new Float64Array(pmf.length);
  let acc = 0;
  for (let i = 0; i < pmf.length; i++) {
    acc += pmf[i];
    cdf[i] = acc;
  }
  cdf[cdf.length - 1] = 1;
  return cdf;
}

export function sampleFromCDF(cdf: Float64Array, u: number): number {
  let lo = 0;
  let hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cdf[mid] < u) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Vose's alias method preprocessing. Given a pmf, builds two arrays
 * (`prob`, `alias`) such that a single draw uniformly from [0,N) combined
 * with one comparison against `prob[i]` picks an index in O(1) — replacing
 * the O(log N) binary search over the cdf. Preprocessing is O(N).
 *
 * Usage in the hot loop:
 *   const r = rng() * N;
 *   const i = r | 0;
 *   const place = (r - i) < prob[i] ? i : alias[i];
 */
export function buildAliasTable(pmf: Float64Array): {
  prob: Float64Array;
  alias: Int32Array;
} {
  const N = pmf.length;
  const prob = new Float64Array(N);
  const alias = new Int32Array(N);
  const scaled = new Float64Array(N);
  for (let i = 0; i < N; i++) scaled[i] = pmf[i] * N;

  // Two stacks for small (<1) and large (>=1) scaled probabilities.
  const small = new Int32Array(N);
  const large = new Int32Array(N);
  let sTop = 0;
  let lTop = 0;
  for (let i = 0; i < N; i++) {
    if (scaled[i] < 1) small[sTop++] = i;
    else large[lTop++] = i;
  }

  while (sTop > 0 && lTop > 0) {
    const l = small[--sTop];
    const g = large[--lTop];
    prob[l] = scaled[l];
    alias[l] = g;
    scaled[g] = scaled[g] + scaled[l] - 1;
    if (scaled[g] < 1) small[sTop++] = g;
    else large[lTop++] = g;
  }
  while (lTop > 0) {
    const g = large[--lTop];
    prob[g] = 1;
    alias[g] = g;
  }
  while (sTop > 0) {
    // Only reached via floating-point slack.
    const l = small[--sTop];
    prob[l] = 1;
    alias[l] = l;
  }
  return { prob, alias };
}
