/**
 * Pure numeric / statistical leaves shared across the engine's compile,
 * hot-loop, and result-build stages. No RNG state, no engine state, no
 * imports from `engine.ts` — keep it a dependency-free leaf so the heavier
 * modules can all import it without cycles.
 */

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

export function poissonPTRS(lam: number, rng: () => number): number {
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

// =====================================================================
// Statistical utilities
// ---------------------------------------------------------------------
// Pure helpers — normal CDF (PD-bit-compatible), histogram bucketing
// for the result distribution chart, no RNG, no engine state.
// =====================================================================

/**
 * Hastings approximation for the standard normal CDF Φ(z). Same algorithm
 * used by PrimeDope's legacy JS (function `q` at line 1192 of tmp_legacy.js)
 * so the Gaussian-RoR readout lines up with theirs bit-for-bit.
 */
export function normalCdf(z: number): number {
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

export function countProfits(arr: Float64Array): number {
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
export function histogramFromCounts(
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
    // Empty / degenerate input: lo/hi never updated (lo=+Inf, hi=-Inf) or all
    // samples equal. Pin a finite unit span so binEdges/span stay finite
    // instead of producing NaN edges (an empty arr would give Inf-Inf=NaN).
    if (!Number.isFinite(lo)) lo = 0;
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
