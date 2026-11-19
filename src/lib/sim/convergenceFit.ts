import {
  inferRowFormat,
  type ConvergenceRowFormat,
} from "./convergencePolicy";
import type { TournamentRow } from "./types";
import { buildScheduleAnalyticBreakdown } from "./compile";

/**
 * Closed-form σ_ROI surfaces. The planning cards no longer read them for their
 * point (`formatRuntimeSigma` compiles the format's default row) nor for their
 * band (`runtimeSigmaBands.ts`, measured against the engine's Monte Carlo).
 * They are the fallback path of `computeConvergenceRows` when no runtime
 * override is passed, and the `resid` of each is the error of THAT surface
 * against its own grid, not the band a card shows.
 */

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

// PKO 2D log-poly fit (scripts/refit_2d_logpoly.ts) to the canonical grid of
// scripts/resweep_sigma.ts (scripts/fit_beta_pko.json, 11 ROIs x 18 fields,
// each cell the engine's exact per-tournament σ of the mtt-gg-bounty /
// pko-realdata-linear row at bounty share 0.5 and rake 10 %). LOO xval:
// mean |delta/sigma| 2.14 %, p95 4.93 %, max 9.24 %. Between the grid points it
// misses by 3.9 % at p95 (170 geometric midpoints) and by up to 9.7 % around
// fields 260-300 at ROI -20 %, where steps in the mtt-gg-bounty curve put a
// narrow feature into σ that no grid field samples. `resid` is the LOO p95
// rounded up. A grid only describes the engine that measured it: re-run
// both scripts after a change to the compile, the PKO payout table or the
// finish model, never refit a stored grid.
export const SIGMA_ROI_PKO: SigmaCoef = {
  kind: "log-poly-2d",
  a0: 0.28406,
  a1: 0.07573,
  a2: 0.01632,
  b1: 1.22695,
  b2: -0.10408,
  c: -0.09765,
  resid: 0.05,
};

// Mystery 2D log-poly refit 2026-07-13 from a FRESHLY MEASURED canonical grid
// (scripts/resweep_sigma.ts FORMAT=mystery). LOO xval: mean |delta/sigma|=5.01%,
// p95=12.84%, max=45.15%. The chart uses a runtime single-row Mystery center
// for user-facing bands; this 2D surface remains diagnostic/generic.
//
// Trained at a per-KO log-variance of 2.4: that recipe added a 0.4 PKO
// head-size term to mysteryBountyVariance 2.0, a channel the engine no longer
// has. Mystery compiles at 2.0, so on its own training model
// (mystery-realdata-linear, bounty share 0.5) this surface sits 4-12% above
// the engine for fields 100-5000, ROI 0-30%. Refit from a fresh
// `resweep_sigma.ts FORMAT=mystery` before showing it.
//
// Re-measured alongside PKO: the previous grid was produced by an older engine
// AND with `payoutStructure: "mtt-gg-bounty"`, while the canonical sweep now
// builds Mystery rows with "mtt-gg-mystery" — so those coefficients described a
// materially different row than today's. The ROI coefficient doubled
// (b1 1.142 → 2.291), restoring the modeling expectation that Mystery's
// envelope variance reacts to ROI harder than PKO's (b1 1.227).
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

export const SIGMA_ROI_MYSTERY_ROYALE: SigmaCoef = {
  // BR is locked to AFS=18 in the widget, so the user-facing tab centers on
  // the runtime single-row compile rather than this helper. These coefficients
  // are still kept in sync with the current runtime line inside the full BR UI
  // box (ROI ±10%, rake 8%) for diagnostics and the fallback path. The band the
  // BR card shows is `runtimeSigmaBands.ts`, not this `resid`.
  kind: "single-beta",
  C0: 5.48538,
  C1: 3.11864,
  beta: 0,
  resid: 0.10,
};

export const SIGMA_COEF_BY_FORMAT: Record<
  Exclude<ConvergenceRowFormat, "ocean-ko">,
  SigmaCoef
> = {
  freeze: SIGMA_ROI_FREEZE,
  pko: SIGMA_ROI_PKO,
  mystery: SIGMA_ROI_MYSTERY,
  "mystery-royale": SIGMA_ROI_MYSTERY_ROYALE,
};

export const FIT_RAKE_BY_FORMAT: Record<
  Exclude<ConvergenceRowFormat, "ocean-ko">,
  number
> = {
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
  if (fmt === "ocean-ko") {
    const breakdown = buildScheduleAnalyticBreakdown({
      schedule: [{ ...row, count: 1 }],
      finishModel: { id: "power-law" },
    });
    if (!breakdown) throw new Error("Ocean KO runtime moments unavailable");
    const sigma = breakdown.sigmaRoiPerTourney * (rakeScaleOverride ?? 1);
    return { sigma, sigmaLo: sigma, sigmaHi: sigma, format: fmt };
  }
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
