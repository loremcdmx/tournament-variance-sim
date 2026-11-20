import type { ConvergenceRowFormat } from "../../src/lib/sim/convergencePolicy";

/**
 * Closed-form σ_ROI surfaces through the canonical grids, for the sweep and
 * probe scripts. They stay out of src/: every σ the app prints is the engine's
 * compile (`formatRuntimeSigma`, `buildExactBreakdown`, `buildOceanKoSigmaBand`),
 * and a surface that misses its own grid by up to 35 % must not be one
 * forgotten argument away from a planning card (`surface_vs_card_gap.ts`
 * measures how far each sits from its card's σ). The `resid` of each is the
 * error of THAT surface against its own grid, not the band a card shows.
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

// Freeze single-β line (scripts/refit_2d_logpoly.ts, Model A) through the
// canonical grid of `resweep_sigma.ts FORMAT=freeze`
// (scripts/fit_beta_freeze_realdata.json, 7 ROIs x 18 fields, each cell the
// engine's exact per-tournament σ of the mtt-standard / freeze-realdata-linear
// row at rake 10 %). That model plays one shape whatever the ROI, so C1 is 0
// and the seven ROI columns are copies: the held-out unit is the field, since
// leaving out one cell keeps six copies of it in the fit. Leave-one-field-out:
// mean |delta/sigma| 4.53 %, max 14.24 % (field 50 000; 12.0 % at field 300).
// Between the grid points (every field 50-2000, 401 fields up to 50 000) it
// misses by 9.4 % at p95 and by up to 13.3 % at fields 255-280, where σ stays
// flat from 200 to 260 players and then climbs. `resid` is the held-out p95
// (with 18 fields, the max) rounded up.
export const SIGMA_ROI_FREEZE: SigmaCoef = {
  kind: "single-beta",
  C0: 0.6459,
  C1: 0,
  beta: 0.3715,
  resid: 0.15,
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

// Mystery 2D log-poly fit (scripts/refit_2d_logpoly.ts) to the canonical grid
// of `resweep_sigma.ts FORMAT=mystery` (scripts/fit_beta_mystery.json, 11 ROIs
// x 18 fields, each cell the engine's exact per-tournament σ of the
// mtt-gg-mystery / mystery-realdata-linear row at bounty share 0.5, per-KO
// log-variance 2.0 and rake 10 %). Leave-one-cell-out: mean |delta/sigma|
// 4.52 %, p95 13.05 %, max 43.03 % (field 50, ROI +80 %); leaving out a whole
// field instead: p95 22.5 %, max 52.0 %. Between the grid points it reads up
// to 35 % high at fields 50-64; from field 100 up (every field to 2 000, 401
// fields to 50 000) it misses by 7.9 % at p95 and by up to 13.1 % (field
// 50 000, ROI -20 %). `resid` is the cell p95 rounded up. The surface has no
// bounty-share input and its row is not the Mystery card's (another finish
// model), which is why the chips take `formatRuntimeSigma` instead.
export const SIGMA_ROI_MYSTERY: SigmaCoef = {
  kind: "log-poly-2d",
  a0: 2.08379,
  a1: -0.28581,
  a2: 0.03218,
  b1: 2.18546,
  b2: -0.30473,
  c: -0.16109,
  resid: 0.14,
};

export const SIGMA_ROI_MYSTERY_ROYALE: SigmaCoef = {
  // A line through `formatRuntimeSigma("mystery-royale")`, the BR card's own
  // $10 row, at five ROIs of the BR slider box (scripts/fit_br_fixed18.ts, AFS
  // 18, ROI ±10 %, rake 8 %). Every ROI of that box on a 0.1 pp step sits
  // within 0.08 % of the card's σ; `resid` is that, rounded up. Another ticket
  // draws another envelope table and has its own σ (a $50 row reads 27 % lower).
  // The band the BR card shows is `runtimeSigmaBands.ts`, not this `resid`.
  kind: "single-beta",
  C0: 7.50416,
  C1: 4.03121,
  beta: 0,
  resid: 0.01,
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
