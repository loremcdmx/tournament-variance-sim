import {
  inferRowFormat,
  type ConvergenceRowFormat,
} from "./convergencePolicy";
import type { TournamentRow } from "./types";

export type SigmaCoefSingleBeta = {
  kind: "single-beta";
  C0: number;
  C1: number;
  beta: number;
  resid: number;
};

export type SigmaCoefLogPoly2D = {
  kind: "log-poly-2d";
  a0: number;
  a1: number;
  a2: number;
  b1: number;
  b2: number;
  c: number;
  resid: number;
};

export type SigmaCoef = SigmaCoefSingleBeta | SigmaCoefLogPoly2D;

export const SIGMA_ROI_FREEZE: SigmaCoef = {
  kind: "single-beta",
  C0: 0.6564,
  C1: 0,
  beta: 0.3694,
  resid: 0.06,
};

// PKO 2D log-poly refit 2026-04-20 from canonical scripts/fit_beta_pko.json
// (11 ROIs x 18 fields x 120k samples). LOO xval: mean |delta/sigma|=4.00%,
// p95=11.72%, max=15.15%.
export const SIGMA_ROI_PKO: SigmaCoef = {
  kind: "log-poly-2d",
  a0: 1.21374,
  a1: -0.21789,
  a2: 0.03473,
  b1: 0.67318,
  b2: -0.03445,
  c: -0.05298,
  resid: 0.12,
};

// Mystery 2D log-poly refit 2026-04-20 from canonical
// scripts/fit_beta_mystery.json. LOO xval: mean |delta/sigma|=4.25%,
// p95=16.97%, max=30.61%. Numeric bands stay hidden by policy.
export const SIGMA_ROI_MYSTERY: SigmaCoef = {
  kind: "log-poly-2d",
  a0: 2.33290,
  a1: -0.27564,
  a2: 0.02917,
  b1: 1.14218,
  b2: -0.09962,
  c: -0.08406,
  resid: 0.17,
};

export const SIGMA_ROI_MYSTERY_ROYALE: SigmaCoef = {
  // Legacy averaged BR fit retained for diagnostics and generic helpers.
  // The user-facing averaged BR tab now uses a runtime point estimate and
  // hides the numeric band until a new residual policy is validated.
  kind: "single-beta",
  C0: 8.1534,
  C1: 7.9063,
  beta: 0,
  resid: 0.02,
};

export const SIGMA_COEF_BY_FORMAT: Record<
  ConvergenceRowFormat,
  SigmaCoef
> = {
  freeze: SIGMA_ROI_FREEZE,
  pko: SIGMA_ROI_PKO,
  mystery: SIGMA_ROI_MYSTERY,
  "mystery-royale": SIGMA_ROI_MYSTERY_ROYALE,
};

export const FIT_RAKE_BY_FORMAT: Record<ConvergenceRowFormat, number> = {
  freeze: 0.10,
  pko: 0.10,
  mystery: 0.10,
  "mystery-royale": 0.08,
};

export function evalSigma(coef: SigmaCoef, field: number, roi: number): number {
  const f = Math.max(1, field);
  if (coef.kind === "single-beta") {
    return Math.max(0, coef.C0 + coef.C1 * roi) * Math.pow(f, coef.beta);
  }
  const L = Math.log(f);
  return Math.exp(
    coef.a0 +
      coef.a1 * L +
      coef.a2 * L * L +
      coef.b1 * roi +
      coef.b2 * roi * roi +
      coef.c * roi * L,
  );
}

export function sigmaRoiForRow(
  row: TournamentRow,
  rakeScaleOverride?: number,
): {
  sigma: number;
  sigmaLo: number;
  sigmaHi: number;
  format: ConvergenceRowFormat;
} {
  const fmt = inferRowFormat(row);
  const coef = SIGMA_COEF_BY_FORMAT[fmt];
  const afs = Math.max(1, row.players);
  const roi = row.roi;
  const rakeScale =
    rakeScaleOverride ??
    (1 + FIT_RAKE_BY_FORMAT[fmt]) / (1 + (row.rake ?? 0));
  const sigma = evalSigma(coef, afs, roi) * rakeScale;
  return {
    sigma,
    sigmaLo: sigma * (1 - coef.resid),
    sigmaHi: sigma * (1 + coef.resid),
    format: fmt,
  };
}
