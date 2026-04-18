import { buildFreezeCashPMF } from "./freezeShape";
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

/**
 * True when the model calibrates its α (or shell mass) so that
 * Σ pmf·prize = singleCost·(1+ROI). False for embedded empirical shapes
 * that ignore the ROI target by design. Used in UI to label the row and
 * to suppress "target not hit" warnings on realdata-* models.
 */
export function finishModelSupportsTargetRoi(id: FinishModelId): boolean {
  return !REFERENCE_SHAPE_MODELS.has(id);
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
      // Same power-law shape as the plain "power-law" model. The
      // "real-data-influenced" label means the surrounding defaults (global
      // ITM = 18.7%, matching our 1.5k-player sample) shape the distribution;
      // α is still solved upstream against the user's target ROI so this
      // model obeys global/per-row ROI settings instead of pinning them.
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
      for (let i = 0; i < N; i++) {
        // Linear interpolation in source space
        const t = (i / Math.max(1, N - 1)) * (M - 1);
        const lo = Math.floor(t);
        const hi = Math.min(M - 1, lo + 1);
        const frac = t - lo;
        const v = Math.max(0, src[lo] * (1 - frac) + src[hi] * frac);
        pmf[i] = v;
        s += v;
      }
      if (s <= 0) {
        pmf.fill(1 / N);
        return pmf;
      }
      for (let i = 0; i < N; i++) pmf[i] /= s;
      return pmf;
    }
    case "linear-skill": {
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
 * E[W] is monotonically increasing in alpha for power-law, linear-skill,
 * and stretched-exp. For `uniform` E[W] is constant in alpha, so calibration
 * is impossible — we pin alpha=0 and the configured ROI has no effect on the
 * finish distribution. Callers that need ROI to bite must pick a skill model.
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
  if (
    model.id === "uniform" ||
    model.id === "empirical" ||
    model.id === "freeze-realdata-step" ||
    model.id === "freeze-realdata-linear" ||
    model.id === "freeze-realdata-tilt" ||
    model.id === "pko-realdata-step" ||
    model.id === "pko-realdata-linear" ||
    model.id === "pko-realdata-tilt" ||
    model.id === "mystery-realdata-step" ||
    model.id === "mystery-realdata-linear" ||
    model.id === "mystery-realdata-tilt"
  )
    return 0;
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

export function calibrateShelledItm(
  N: number,
  paidCount: number,
  payouts: readonly number[],
  prizePool: number,
  targetWinnings: number,
  itmRate: number,
  shellLocks: { first?: number; top3?: number; ft?: number } | undefined,
  model: FinishModelConfig,
): ShelledCalibrationResult {
  const pmf = new Float64Array(N);
  const paid = Math.max(0, Math.min(paidCount, N));
  const clampedItm = Math.max(0, Math.min(1, itmRate));

  const emptyShells = { first: 0, top3: 0, ft: 0 };

  // Real-data freeze shapes embed the sample's empirical ITM (18.7%) and
  // cash-band width (15.5%). Per-row itmRate / shell locks don't apply —
  // we build the full PMF directly and report whatever E[W] it produces.
  if (
    model.id === "freeze-realdata-step" ||
    model.id === "freeze-realdata-linear" ||
    model.id === "freeze-realdata-tilt" ||
    model.id === "pko-realdata-step" ||
    model.id === "pko-realdata-linear" ||
    model.id === "pko-realdata-tilt" ||
    model.id === "mystery-realdata-step" ||
    model.id === "mystery-realdata-linear" ||
    model.id === "mystery-realdata-tilt"
  ) {
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
    return { alpha: 0, pmf, currentWinnings: 0, feasible: true, supportsTargetRoi: true, shells: emptyShells };
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
      feasible: Math.abs(w - targetWinnings) < 1e-6,
      supportsTargetRoi: true,
      shells: { first: pmf[0], top3: pmf[0], ft: pmf[0] },
    };
  }

  // ---- 1. Determine locked shell layers --------------------------------
  const ftEnd = Math.min(9, paid);
  // Cumulative locks (monotone clamp). All are bounded to [0, itmRate].
  const locks = shellLocks ?? {};
  const cumFirst =
    locks.first != null
      ? Math.max(0, Math.min(clampedItm, locks.first))
      : undefined;
  const cumTop3 =
    locks.top3 != null
      ? Math.max(cumFirst ?? 0, Math.min(clampedItm, locks.top3))
      : undefined;
  const cumFt =
    locks.ft != null
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
      let sFree = 0;
      for (const idx of freeIndices) sFree += band[idx];
      if (sFree <= 0) return 0;
      let ew = 0;
      for (const idx of freeIndices) {
        const m = (band[idx] / sFree) * freeMassTotal;
        ew += m * payouts[idx] * prizePool;
      }
      return ew;
    };

    const range =
      model.id === "stretched-exp" ? { lo: -5, hi: 8 } : { lo: -6, hi: 25 };
    const ewLo = freeEw(range.lo);
    const ewHi = freeEw(range.hi);

    if (targetFreeEw <= ewLo) {
      alpha = range.lo;
      feasible = Math.abs(ewLo - targetFreeEw) < 1e-6;
    } else if (targetFreeEw >= ewHi) {
      alpha = range.hi;
      feasible = Math.abs(ewHi - targetFreeEw) < 1e-6;
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
    let sFree = 0;
    for (const idx of freeIndices) sFree += band[idx];
    for (let i = 0; i < paid; i++) pmf[i] = perPlaceLocked[i];
    if (sFree > 0) {
      for (const idx of freeIndices) {
        pmf[idx] += (band[idx] / sFree) * freeMassTotal;
      }
    }
  }

  // ---- 4. OOTM tail -----------------------------------------------------
  const rest = N - paid;
  if (rest > 0) {
    const q = (1 - clampedItm) / rest;
    for (let i = paid; i < N; i++) pmf[i] = q;
  }

  // ---- 5. Report -------------------------------------------------------
  let currentWinnings = 0;
  for (let i = 0; i < paid; i++) currentWinnings += pmf[i] * payouts[i] * prizePool;
  if (Math.abs(currentWinnings - targetWinnings) > 1e-3) feasible = false;

  const sumRange = (from: number, toExcl: number): number => {
    let s = 0;
    for (let i = from; i < Math.min(toExcl, paid); i++) s += pmf[i];
    return s;
  };
  const shells = {
    first: pmf[0] ?? 0,
    top3: sumRange(0, Math.min(3, paid)),
    ft: sumRange(0, ftEnd),
  };

  return { alpha, pmf, currentWinnings, feasible, supportsTargetRoi: true, shells };
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
  if (l > 1) l = 1;

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
