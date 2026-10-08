/**
 * The numeric band around the planning cards' runtime σ, and the grid it holds on.
 *
 * Every single-format card (and a one-row schedule) centers on `formatRuntimeSigma`,
 * the engine's analytic twin of the format's default one-row schedule. The band is
 * how far that analytic σ sat from what the engine actually samples: the largest
 * |σ_MC / σ_analytic − 1| plus two standard errors, rounded up to a whole percent,
 * over the cells of the calibration grid. It is NOT a band on the gap between the
 * model and real play.
 *
 * One table feeds the convergence chips, the prove-edge card, schedule mode and the
 * gate that hides the band outside the grid (`isInsideFitBox`). Regenerate with
 * `scripts/fit_runtime_sigma_bands.ts`; the measured table is in
 * `scripts/fit_runtime_sigma_bands.json` and `docs/FITTING.md`, and a test pins this
 * table to that artifact.
 *
 * Leaf module (types only): `convergenceMath`, `convergencePolicy` and
 * `formatRuntimeSigma` all read it, so it must not import any of them.
 */

export type RuntimeSigmaFormat = "freeze" | "pko" | "mystery" | "mystery-royale";

export interface RuntimeSigmaBandSpec {
  /** Half-width of the band as a fraction of σ (0.03 = ±3 %). */
  resid: number;
  /** Field sizes the band was measured on, inclusive. */
  afsMin: number;
  afsMax: number;
  /** ROI range the band was measured on, as fractions, inclusive. */
  roiMin: number;
  roiMax: number;
}

export const RUNTIME_SIGMA_BANDS: Record<RuntimeSigmaFormat, RuntimeSigmaBandSpec> = {
  freeze: { resid: 0.03, afsMin: 50, afsMax: 50_000, roiMin: -0.3, roiMax: 1.0 },
  pko: { resid: 0.02, afsMin: 50, afsMax: 50_000, roiMin: -0.3, roiMax: 1.0 },
  mystery: { resid: 0.02, afsMin: 50, afsMax: 50_000, roiMin: -0.3, roiMax: 1.0 },
  // Noise-limited: the Monte Carlo of the 10 000x envelope cannot resolve a
  // gap under ~1-2 %, so 6 % is mostly two standard errors, not a measured error.
  "mystery-royale": { resid: 0.06, afsMin: 18, afsMax: 18, roiMin: -0.2, roiMax: 1.0 },
};

/** Half-width of the numeric band around the runtime σ of a format. */
export function runtimeSigmaBandResid(format: RuntimeSigmaFormat): number {
  return RUNTIME_SIGMA_BANDS[format].resid;
}

const BOX_EPS = 1e-9;

/** Whether a (field, ROI) point lies on the grid the format's band was measured on. */
export function isInsideRuntimeSigmaBox(
  format: RuntimeSigmaFormat,
  field: number,
  roi: number,
): boolean {
  const box = RUNTIME_SIGMA_BANDS[format];
  return (
    field >= box.afsMin - BOX_EPS &&
    field <= box.afsMax + BOX_EPS &&
    roi >= box.roiMin - BOX_EPS &&
    roi <= box.roiMax + BOX_EPS
  );
}
