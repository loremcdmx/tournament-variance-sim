/**
 * "Prove edge from zero" companion to the convergence widget.
 *
 * The convergence table answers Q1: "how many tournaments until the
 * observed mean ROI sits inside ±X pp of the true ROI with confidence
 * z?" Formula: N ∝ (z·σ / target_band)² — N grows with σ.
 *
 * This module answers Q2: "how many tournaments until I can
 * statistically distinguish my true ROI from zero with confidence z?"
 * Formula: N ∝ (z·σ / |ROI|)² — N grows with σ AND with 1/|ROI|².
 *
 * Same σ source as ConvergenceChart:
 *   - Single format → per-candidate `evalSigma(coef, afs, roi) · rakeScale`
 *   - Schedule mode → schedule-aware `buildExactBreakdown(schedule).sigmaEff`,
 *     where σ already weights per-row dollar variance, field variability,
 *     payout shape, rake, and bounty structure
 *
 * Honest about extrapolation: when a candidate ROI (or any schedule row)
 * sits outside its format's validated fit-box, the band gate flags
 * `outside-fit-box` so the UI can suppress the residual range and
 * show only the point estimate, matching the convergence widget's
 * policy.
 */
import { buildExactBreakdown, type ExactBreakdown } from "./convergenceMath";
import {
  FIT_RAKE_BY_FORMAT,
  SIGMA_COEF_BY_FORMAT,
  evalSigma,
} from "./convergenceFit";
import {
  getConvergenceBandPolicy,
  isInsideFitBox,
  type ConvergenceRowFormat,
  type FitBoxSample,
} from "./convergencePolicy";
import type { FinishModelConfig, TournamentRow } from "./types";

export type ProveEdgeFormat = ConvergenceRowFormat | "exact";

export interface ProveEdgeRow {
  /** Candidate true ROI as a fraction (0.10 = +10 %). */
  roi: number;
  /** σ_ROI evaluated at this candidate ROI (point estimate). */
  sigma: number;
  /** σ × (1 - residual). Equal to `sigma` when out-of-box. */
  sigmaLo: number;
  /** σ × (1 + residual). Equal to `sigma` when out-of-box. */
  sigmaHi: number;
  /** Tournaments needed (point); `Infinity` when ROI === 0. */
  tourneys: number;
  /** Optimistic bound (uses sigmaLo). Equals `tourneys` when out-of-box. */
  tourneysLo: number;
  /** Pessimistic bound (uses sigmaHi). Equals `tourneys` when out-of-box. */
  tourneysHi: number;
  /** Tournaments expressed in fields of the effective AFS. */
  fields: number;
  /** Whether this candidate sits inside its format's validated fit-box. */
  insideFitBox: boolean;
  /** Highlighted as the user's anchor row (closest candidate). */
  isCurrent: boolean;
}

export interface ProveEdgeAnchor {
  /** Anchor ROI used for `sigma` / `tourneys` (= user's exact input,
   *  or schedule's cost-weighted mean ROI in schedule mode). */
  roi: number;
  sigma: number;
  sigmaLo: number;
  sigmaHi: number;
  tourneys: number;
  tourneysLo: number;
  tourneysHi: number;
  fields: number;
  insideFitBox: boolean;
}

export type BandPolicy = "numeric" | "outside-fit-box";

export interface ProveEdgeResult {
  rows: ProveEdgeRow[];
  /** Effective AFS used for `fields` conversion (= explicit AFS in
   *  single-format mode, schedule's avgField in schedule mode). */
  effectiveAfs: number;
  /** Mode-aware band gate matching the convergence widget. */
  bandPolicy: BandPolicy;
  /** Anchor at user's exact ROI (or schedule's effective ROI),
   *  recomputed instead of snapped to a candidate. */
  anchor: ProveEdgeAnchor;
}

export interface ProveEdgeInput {
  format: ProveEdgeFormat;
  /** Required when `format === "exact"`. Pass the user's schedule. */
  schedule?: readonly TournamentRow[] | null;
  /** Optional finish-model override for schedule σ; defaults to power-law. */
  finishModel?: FinishModelConfig;
  /** Field size for σ evaluation — ignored when `format === "exact"`. */
  afs: number;
  /** Player's rake fraction (0.10 = 10 %); ignored when `format === "exact"`. */
  rake: number;
  /** Two-tailed z-score from the chosen confidence level. */
  z: number;
  /** Player's current ROI fraction — used to highlight the closest candidate
   *  AND to compute the precise anchor σ (without snapping). */
  currentRoi: number;
  /** Candidate ROI grid in fraction units. Negative entries are valid
   *  ("how long to prove I'm a loser") — the formula uses |ROI|. */
  candidates: readonly number[];
}

/**
 * Default candidate grid — bidirectional, covers winning and losing
 * edges from elite (±30 %) down to break-even hopium (±0.1 %).
 */
export const PROVE_EDGE_DEFAULT_CANDIDATES: readonly number[] = [
  0.30,
  0.20,
  0.15,
  0.10,
  0.05,
  0.025,
  0.01,
  0.005,
  0.001,
  -0.001,
  -0.005,
  -0.01,
  -0.025,
  -0.05,
  -0.10,
  -0.15,
  -0.20,
  -0.30,
];

/** Positive-only subset, useful when the UI hides the losing side by default. */
export const PROVE_EDGE_POSITIVE_CANDIDATES: readonly number[] =
  PROVE_EDGE_DEFAULT_CANDIDATES.filter((r) => r > 0);

interface SigmaTriple {
  sigma: number;
  sigmaLo: number;
  sigmaHi: number;
  insideBox: boolean;
}

function singleFormatSigma(
  format: ConvergenceRowFormat,
  afs: number,
  rake: number,
  roi: number,
): SigmaTriple {
  const coef = SIGMA_COEF_BY_FORMAT[format];
  const fitRake = FIT_RAKE_BY_FORMAT[format];
  const rakeScale = (1 + fitRake) / (1 + Math.max(0, rake));
  const safeAfs = Math.max(1, afs);
  const sigma = evalSigma(coef, safeAfs, roi) * rakeScale;
  const insideBox = isInsideFitBox({ format, field: safeAfs, roi });
  const resid = insideBox ? coef.resid : 0;
  return {
    sigma,
    sigmaLo: sigma * (1 - resid),
    sigmaHi: sigma * (1 + resid),
    insideBox,
  };
}

function nFromSigma(z: number, sigma: number, roi: number): number {
  const absRoi = Math.abs(roi);
  if (absRoi <= 1e-9) return Number.POSITIVE_INFINITY;
  return Math.ceil(Math.pow((z * sigma) / absRoi, 2));
}

function pickAnchorIndex(
  candidates: readonly number[],
  currentRoi: number,
): number {
  let best = -1;
  let bestDist = Infinity;
  candidates.forEach((roi, i) => {
    const d = Math.abs(roi - currentRoi);
    if (d < bestDist - 1e-12) {
      bestDist = d;
      best = i;
    } else if (Math.abs(d - bestDist) < 1e-12) {
      // Equidistant tie-break: prefer the larger ROI (more aspirational).
      if (best < 0 || roi > candidates[best]) best = i;
    }
  });
  return best;
}

/** Cost-weighted mean ROI of a schedule. Used as the schedule-mode anchor. */
function scheduleEffectiveRoi(
  schedule: readonly TournamentRow[],
): number {
  let totalCost = 0;
  let totalCostRoi = 0;
  for (const row of schedule) {
    const count = Math.max(0, row.count ?? 0);
    if (count <= 0) continue;
    const buyIn = Math.max(0, row.buyIn) * (1 + Math.max(0, row.rake));
    const cost = buyIn * count;
    totalCost += cost;
    totalCostRoi += cost * row.roi;
  }
  return totalCost > 0 ? totalCostRoi / totalCost : 0;
}

export function computeProveEdge(input: ProveEdgeInput): ProveEdgeResult {
  const { format, z, currentRoi, candidates } = input;

  if (format === "exact") {
    return computeProveEdgeSchedule(input);
  }

  const formatTyped = format as ConvergenceRowFormat;
  const safeAfs = Math.max(1, input.afs);
  const anchorIdx = pickAnchorIndex(candidates, currentRoi);

  const rows: ProveEdgeRow[] = candidates.map((roi, i) => {
    const triple = singleFormatSigma(formatTyped, safeAfs, input.rake, roi);
    const tourneys = nFromSigma(z, triple.sigma, roi);
    const tourneysLo = nFromSigma(z, triple.sigmaLo, roi);
    const tourneysHi = nFromSigma(z, triple.sigmaHi, roi);
    const fields = Number.isFinite(tourneys) ? tourneys / safeAfs : Infinity;
    return {
      roi,
      sigma: triple.sigma,
      sigmaLo: triple.sigmaLo,
      sigmaHi: triple.sigmaHi,
      tourneys,
      tourneysLo,
      tourneysHi,
      fields,
      insideFitBox: triple.insideBox,
      isCurrent: i === anchorIdx,
    };
  });

  // Aggregate band policy for the whole table — mirrors the convergence
  // widget. If any single-format sample is out of box, suppress bands.
  const samples: FitBoxSample[] = rows.map((r) => ({
    format: formatTyped,
    field: safeAfs,
    roi: r.roi,
  }));
  const policy = getConvergenceBandPolicy(samples);
  const bandPolicy: BandPolicy =
    policy.kind === "numeric" ? "numeric" : "outside-fit-box";

  // Anchor = precise σ at user's exact ROI, not snapped to grid.
  const anchorTriple = singleFormatSigma(
    formatTyped,
    safeAfs,
    input.rake,
    currentRoi,
  );
  const anchor: ProveEdgeAnchor = {
    roi: currentRoi,
    sigma: anchorTriple.sigma,
    sigmaLo: anchorTriple.sigmaLo,
    sigmaHi: anchorTriple.sigmaHi,
    tourneys: nFromSigma(z, anchorTriple.sigma, currentRoi),
    tourneysLo: nFromSigma(z, anchorTriple.sigmaLo, currentRoi),
    tourneysHi: nFromSigma(z, anchorTriple.sigmaHi, currentRoi),
    fields: 0, // filled below
    insideFitBox: anchorTriple.insideBox,
  };
  anchor.fields = Number.isFinite(anchor.tourneys)
    ? anchor.tourneys / safeAfs
    : Infinity;

  return {
    rows,
    effectiveAfs: safeAfs,
    bandPolicy,
    anchor,
  };
}

function computeProveEdgeSchedule(input: ProveEdgeInput): ProveEdgeResult {
  const { schedule, finishModel, z, candidates } = input;
  const safeSchedule = schedule ?? [];

  const breakdown: ExactBreakdown | null = buildExactBreakdown(
    safeSchedule.length > 0 ? safeSchedule : null,
    { finishModel },
  );
  // Schedule has its own band policy (every row's format/AFS/ROI must
  // sit inside its fit-box). Reuse the same convergence gate.
  const samples: FitBoxSample[] = breakdown
    ? breakdown.perRow.map((r) => ({
        format: r.format,
        field: r.afs,
        roi: r.roi,
      }))
    : [];
  const policy = breakdown ? getConvergenceBandPolicy(samples) : null;
  const bandPolicy: BandPolicy =
    breakdown && policy?.kind === "numeric" ? "numeric" : "outside-fit-box";

  const sigmaPoint = breakdown?.sigmaEff ?? 0;
  const sigmaLo =
    bandPolicy === "numeric" ? (breakdown?.sigmaEffLo ?? sigmaPoint) : sigmaPoint;
  const sigmaHi =
    bandPolicy === "numeric" ? (breakdown?.sigmaEffHi ?? sigmaPoint) : sigmaPoint;
  const effectiveAfs = breakdown ? Math.max(1, breakdown.avgField) : 1;
  const effectiveRoi = scheduleEffectiveRoi(safeSchedule);
  const anchorIdx = pickAnchorIndex(candidates, effectiveRoi);

  const rows: ProveEdgeRow[] = candidates.map((roi, i) => {
    const tourneys = nFromSigma(z, sigmaPoint, roi);
    const tourneysLo = nFromSigma(z, sigmaLo, roi);
    const tourneysHi = nFromSigma(z, sigmaHi, roi);
    const fields = Number.isFinite(tourneys) ? tourneys / effectiveAfs : Infinity;
    return {
      roi,
      sigma: sigmaPoint,
      sigmaLo,
      sigmaHi,
      tourneys,
      tourneysLo,
      tourneysHi,
      fields,
      // For schedule mode, "in fit-box" is global — every row must pass.
      insideFitBox: bandPolicy === "numeric",
      isCurrent: i === anchorIdx,
    };
  });

  const anchorTourneys = nFromSigma(z, sigmaPoint, effectiveRoi);
  const anchor: ProveEdgeAnchor = {
    roi: effectiveRoi,
    sigma: sigmaPoint,
    sigmaLo,
    sigmaHi,
    tourneys: anchorTourneys,
    tourneysLo: nFromSigma(z, sigmaLo, effectiveRoi),
    tourneysHi: nFromSigma(z, sigmaHi, effectiveRoi),
    fields: Number.isFinite(anchorTourneys)
      ? anchorTourneys / effectiveAfs
      : Infinity,
    insideFitBox: bandPolicy === "numeric",
  };

  return {
    rows,
    effectiveAfs,
    bandPolicy,
    anchor,
  };
}

/**
 * Backwards-compatible helper for the previous `computeProveEdgeRows`
 * signature — returns just the row array. New callers should prefer
 * `computeProveEdge` for the full result with anchor + band policy.
 */
export function computeProveEdgeRows(
  input: ProveEdgeInput,
): ProveEdgeRow[] {
  return computeProveEdge(input).rows;
}
