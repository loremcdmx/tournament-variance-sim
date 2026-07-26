/**
 * Derived curves: the ROI sensitivity scan (closed-form, noise-free) and the
 * running-mean convergence band over sample count. Owns the "convergence"
 * phase of the build progress.
 */
import type { BuildProgressCb } from "./engineTypes";
import type { SimulationResult } from "./types";

/**
 * ΔROI linear scan: realized profit ≈ mean + ΔROI × totalBuyIn (under
 * α-calibration the expectation is truly linear in ROI because the PMF shape
 * is held constant — we just rescale expected winnings). At extreme Δ we
 * clamp against the absolute pool floor so the line stays interpretable.
 */
export function buildSensitivity(
  mean: number,
  totalBuyIn: number,
): SimulationResult["sensitivity"] {
  const deltas = [-0.2, -0.1, -0.05, -0.025, 0, 0.025, 0.05, 0.1, 0.2];
  const expectedProfits = deltas.map((d) => mean + d * totalBuyIn);
  return { deltas, expectedProfits };
}

/** Running mean and 1.96 SE vs sample count, in log-spaced buckets. */
export function buildConvergence(
  finalProfits: Float64Array,
  S: number,
  onBuildProgress?: BuildProgressCb,
): SimulationResult["convergence"] {
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
  return { x: convX, mean: convMean, seLo: convSeLo, seHi: convSeHi };
}
