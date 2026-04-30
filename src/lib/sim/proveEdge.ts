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
 * Same σ source (per-format fits in `convergenceFit.ts`), but evaluated
 * at every candidate ROI separately — for ROI-sensitive formats
 * (PKO / Mystery / MBR) σ shifts a few percent across the candidate
 * grid; for freeze it's ROI-invariant by construction.
 *
 * No engine changes, no UI mutation — purely additive helpers consumed
 * by the new ProveEdgeCard.
 */
import {
  FIT_RAKE_BY_FORMAT,
  SIGMA_COEF_BY_FORMAT,
  evalSigma,
} from "./convergenceFit";
import type { ConvergenceRowFormat } from "./convergencePolicy";

export interface ProveEdgeRow {
  /** Candidate true ROI as a fraction (0.10 = +10 %). */
  roi: number;
  /** σ_ROI evaluated at this candidate ROI. */
  sigma: number;
  /** Tournaments needed; `Infinity` when ROI === 0. */
  tourneys: number;
  /** Tournaments expressed in fields of size `afs`. */
  fields: number;
  /** Marked when this row sits at (or closest to) the user's input ROI. */
  isCurrent: boolean;
}

export interface ProveEdgeInput {
  format: ConvergenceRowFormat;
  /** Average field size for σ evaluation + fields conversion. */
  afs: number;
  /** Player's current rake fraction (0.10 = 10 %). */
  rake: number;
  /** Two-tailed z-score from the chosen confidence level. */
  z: number;
  /** Player's current ROI fraction — used to highlight the closest row. */
  currentRoi: number;
  /** Candidate ROI grid in fraction units. */
  candidates: readonly number[];
}

/**
 * Default candidate grid — covers winning edges from elite (+30 %) down
 * to fish-territory hopium (+0.1 %). Two-decimal ROIs match the AFS /
 * ROI grid the σ fits were trained on, so we stay inside the validated
 * box for every candidate.
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
];

export function computeProveEdgeRows(
  input: ProveEdgeInput,
): ProveEdgeRow[] {
  const { format, afs, rake, z, currentRoi, candidates } = input;
  const coef = SIGMA_COEF_BY_FORMAT[format];
  const fitRake = FIT_RAKE_BY_FORMAT[format];
  const rakeScale = (1 + fitRake) / (1 + Math.max(0, rake));
  const safeAfs = Math.max(1, afs);

  // Find the candidate closest to currentRoi to highlight as "you are
  // here". Snap by absolute distance in ROI fraction. If two are
  // equidistant, prefer the larger (more optimistic) — matches the
  // intuition that a player nudging their own ROI estimate up rounds
  // up to the more aspirational tier.
  let bestIdx = -1;
  let bestDist = Infinity;
  candidates.forEach((roi, i) => {
    const d = Math.abs(roi - currentRoi);
    if (d < bestDist - 1e-12 || (Math.abs(d - bestDist) < 1e-12 && roi > candidates[bestIdx])) {
      bestDist = d;
      bestIdx = i;
    }
  });

  return candidates.map((roi, i) => {
    const sigma = evalSigma(coef, safeAfs, roi) * rakeScale;
    const absRoi = Math.abs(roi);
    const tourneys = absRoi <= 1e-9
      ? Number.POSITIVE_INFINITY
      : Math.ceil(Math.pow((z * sigma) / absRoi, 2));
    const fields = Number.isFinite(tourneys) ? tourneys / safeAfs : Infinity;
    return {
      roi,
      sigma,
      tourneys,
      fields,
      isCurrent: i === bestIdx,
    };
  });
}
