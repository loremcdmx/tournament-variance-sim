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

// PKO 2D log-poly refit 2026-07-13 from a FRESHLY MEASURED canonical grid
// (scripts/resweep_pko.ts → scripts/fit_beta_pko.json, 11 ROIs x 18 fields x
// 120k samples x N=500). LOO xval: mean |delta/sigma|=3.88%, p95=10.07%,
// max=19.04%.
//
// Why the re-measurement: the previous coefficients were fit on a grid
// produced by an older engine build. An audit found the current engine yields
// ~10-14% more sigma at small fields x high ROI than that stored grid, which
// combined with the surface's own fit error to put the widget ~18-22% low
// there (worst 36% at ROI 0.8) — and since k ∝ sigma², the convergence table
// understated the required volume by up to ~1.9x on that corner. The ROI
// coefficient roughly doubled in the refit (b1 0.673 → 1.402), which is
// exactly that missing ROI-dependence.
export const SIGMA_ROI_PKO: SigmaCoef = {
  kind: "log-poly-2d",
  a0: 1.22829,
  a1: -0.22862,
  a2: 0.03549,
  b1: 1.40175,
  b2: -0.14989,
  c: -0.10421,
  resid: 0.11,
};

// Mystery 2D log-poly refit 2026-07-13 from a FRESHLY MEASURED canonical grid
// (scripts/resweep_sigma.ts FORMAT=mystery). LOO xval: mean |delta/sigma|=5.01%,
// p95=12.84%, max=45.15%. The chart uses a runtime single-row Mystery center
// for user-facing bands; this 2D surface remains diagnostic/generic.
//
// Re-measured alongside PKO: the previous grid was produced by an older engine
// AND with `payoutStructure: "mtt-gg-bounty"`, while the canonical sweep now
// builds Mystery rows with "mtt-gg-mystery" — so those coefficients described a
// materially different row than today's. The ROI coefficient doubled
// (b1 1.142 → 2.291), restoring the modeling expectation that Mystery's
// envelope variance reacts to ROI harder than PKO's (b1 1.402).
export const SIGMA_ROI_MYSTERY: SigmaCoef = {
  kind: "log-poly-2d",
  a0: 2.18541,
  a1: -0.27892,
  a2: 0.03057,
  b1: 2.29124,
  b2: -0.35711,
  c: -0.16149,
  resid: 0.13,
};

// The user-facing Mystery convergence tab now centers on a runtime single-row
// compile instead of this promoted 2D surface. Independent fresh-sim checks
// across off-grid and edge-of-box points stayed within roughly 1.2% of sigma,
// so the chart uses a conservative symmetric runtime residual band of ±3%.
// The legacy 2D coefficients remain useful for diagnostics / generic helpers.
export const SIGMA_ROI_MYSTERY_RUNTIME_RESID = 0.03;

export const SIGMA_ROI_MYSTERY_ROYALE: SigmaCoef = {
  // BR is locked to AFS=18 in the widget, so the user-facing tab centers on
  // the runtime single-row compile rather than this helper. These coefficients
  // are still kept in sync with the current runtime line inside the full BR UI
  // box (ROI ±10%, rake 8%) for diagnostics and generic helpers. Independent
  // hold-out sim checks across the BR UI box stayed within roughly 10% of
  // sigma, so the chart uses a conservative symmetric ±10% band around the
  // runtime point rather than pretending the runtime helper is tighter.
  kind: "single-beta",
  C0: 5.48538,
  C1: 3.11864,
  beta: 0,
  resid: 0.10,
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
