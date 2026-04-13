import type { FinishModelConfig } from "./types";

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
  if (model.id === "uniform" || model.id === "empirical") return 0;

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
 * PrimeDope-compat finish distribution — "uniform lift".
 *
 * Zero-edge baseline is flat 1/N over the whole field. A target ROI > 0 is
 * produced by multiplying **every paid place's probability** by a common
 * factor k, and taking the removed mass uniformly out of the unpaid places.
 * The lift is the same for 1st place and for the min-cash: skill does not
 * concentrate in deep finishes, it just inflates the ITM rate.
 *
 * Derivation (payouts[] sums to 1):
 *   E[W]   = Σ_paid (k/N) × payouts[i] × prizePool
 *          = (k/N) × prizePool × 1
 *          = k × prizePool / N
 *   ⇒ k   = targetWinnings × N / prizePool
 *
 * This is the structural flaw Muchomota Substack documents (2024) — cf. the
 * inflated ~21% ITM for a 20%-ROI target vs. ~17% measured in real samples.
 * Use this as the reference model for side-by-side "we vs PrimeDope".
 */
export function buildUniformLiftPMF(
  N: number,
  paidCount: number,
  targetWinnings: number,
  prizePool: number,
): Float64Array {
  const pmf = new Float64Array(N);
  if (N <= 0) return pmf;
  const paid = Math.max(0, Math.min(paidCount, N));
  if (paid === 0 || prizePool <= 0) {
    pmf.fill(1 / N);
    return pmf;
  }
  const rawK = (targetWinnings * N) / prizePool;
  // Clamp: k × paid must never exceed N (all mass would spill out of [0,1])
  const maxK = N / paid;
  const k = Math.max(0, Math.min(rawK, maxK));
  const paidProb = k / N;
  const unpaidMass = Math.max(0, 1 - (k * paid) / N);
  const unpaidProb = N > paid ? unpaidMass / (N - paid) : 0;
  for (let i = 0; i < paid; i++) pmf[i] = paidProb;
  for (let i = paid; i < N; i++) pmf[i] = unpaidProb;
  return pmf;
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
