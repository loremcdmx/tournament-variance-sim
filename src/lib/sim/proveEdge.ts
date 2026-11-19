/**
 * "Prove edge from zero" companion to the convergence widget.
 *
 * The convergence table answers Q1: "how many tournaments until the
 * observed mean ROI sits inside ±X pp of the true ROI with confidence
 * z?" Formula: N ∝ (z·σ / target_band)² — N grows with σ.
 *
 * This module answers Q2: "how many tournaments until I can
 * statistically distinguish my true ROI from zero at confidence C?"
 * Formula: N ∝ ((z_sig + z_pow)·σ / |ROI|)² — N grows with σ AND with
 * 1/|ROI|².
 *
 * Power matters here. A naive N = (z·σ/|ROI|)² is the point where the test
 * threshold sits exactly at the true ROI, so a player whose true edge is
 * exactly that big still only clears the bar ~50 % of the time — it's the
 * median, not "you will have proven it". The bar is two-sided at C,
 * z_sig = Φ⁻¹((1 + C)/2), and the power term is the one-sided quantile of the
 * same C, z_pow = Φ⁻¹(C), so a player whose true ROI is exactly the tested
 * one clears the bar with probability Φ(z_pow) = C, the chance the card
 * prints. At C = 95 % the volume is 3.4× the median. Below C = 50 % z_pow
 * would turn negative and print less than the median volume; it is held at
 * 0, so the chance there is 50 % (`proveEdgeDetectionPct`).
 *
 * C is the normal-theory chance, and tournament ROI is right-skewed. Playing
 * the card's own row N times on the engine (20 000 runs, AFS 50-50 000, ROI
 * -30 % to +100 %): freeze, PKO and Mystery clear within about 2 points of C
 * from C = 90 % up (worst 96.8 % at 95 %, SE 0.3), but near 50 % the median
 * run sits off the mean. A winning ROI then clears less often (freeze AFS 200
 * at C = 50 %: 49 % at +10 %, N = 955; 44 % at +100 %, N = 23; Mystery AFS
 * 50 000 at +100 %: 31 %; PKO AFS 50 000 at +100 %: 27 %) and a losing one
 * more often (freeze AFS 1 000 at -30 %: 64 %). On Battle Royale and Ocean KO
 * rare jackpots carry most of σ (Ocean's is also an upper bound), and the gap
 * depends on the edge: from about +10 % up a winning ROI clears 95-100 % at
 * C = 75 % and 37-46 % at C = 50 %, while at edges of a few percent it clears
 * less often than C (Battle Royale +1 %: 44 % at C = 60 %, 72 % at C = 75 %).
 * The reading guide says so without row-specific figures; no skew correction,
 * which would need each row's third moment.
 *
 * Same σ source as ConvergenceChart:
 *   - Single format → per-candidate runtime σ of the format's default one-row
 *     schedule (`formatRuntimeSigma`), the number schedule mode shows for that
 *     row; the calibrated residual supplies the band
 *   - Ocean KO → per-candidate runtime variance upper bound, without a
 *     calibrated residual band
 *   - Schedule mode → schedule-aware `buildExactBreakdown(schedule).sigmaEff`,
 *     where σ already weights per-row dollar variance, field variability,
 *     payout shape, rake, and bounty structure. It is evaluated once, at the
 *     schedule's own ROIs, and held for every candidate row (the card says so):
 *     a higher hypothetical ROI has a heavier σ than the table uses
 *
 * Honest about extrapolation: when a candidate ROI (or any schedule row)
 * sits outside the grid its format's band was calibrated on, the band gate
 * flags `outside-fit-box` so the UI can suppress the range and show only the
 * point estimate, matching the convergence widget's policy. The band itself is
 * `runtimeSigmaBandResid`, the same number the convergence chips use.
 */
import {
  buildExactBreakdown,
  buildOceanKoSigmaBand,
  ciToZ,
  oceanKoRoiReached,
  scheduleEffectiveRoi,
  type ExactBreakdown,
} from "./convergenceMath";
import {
  getConvergenceBandPolicy,
  inferRowFormat,
  isInsideFitBox,
  type ConvergenceRowFormat,
  type FitBoxSample,
} from "./convergencePolicy";
import {
  formatRuntimeRoiReached,
  formatRuntimeSigma,
  runtimeSigmaBandResid,
  type RuntimeSigmaFormat,
  type RuntimeSigmaPoint,
} from "./formatRuntimeSigma";
import { isAlphaAdjustable } from "./finishModel";
import type { ItmTargetConfig } from "./itmTarget";
import type { FinishModelConfig, TournamentRow } from "./types";

export type ProveEdgeFormat = ConvergenceRowFormat | "exact";

/** Opening tab: whichever format the user actually plays most of. Showing PKO
 *  numbers to a freezeout-only schedule is a silent lie. */
function dominantScheduleFormat(
  schedule: readonly TournamentRow[] | null | undefined,
): ProveEdgeFormat {
  if (!schedule || schedule.length === 0) return "pko";
  const counts = new Map<ProveEdgeFormat, number>();
  for (const row of schedule) {
    const f = inferRowFormat(row);
    counts.set(f, (counts.get(f) ?? 0) + Math.max(0, row.count));
  }
  let best: ProveEdgeFormat | null = null;
  let bestCount = -1;
  for (const [f, c] of counts) {
    if (c > bestCount) {
      best = f;
      bestCount = c;
    }
  }
  return best ?? "pko";
}

/** The tab the card shows until the user picks one; derived every render so it
 *  follows a schedule that loads or changes after the card mounted. */
export function defaultProveEdgeFormat(
  schedule: readonly TournamentRow[] | null | undefined,
  defaultMode: "avg" | "exact",
): ProveEdgeFormat {
  return defaultMode === "exact" && schedule && schedule.length > 0
    ? "exact"
    : dominantScheduleFormat(schedule);
}

export interface ProveEdgeRow {
  /** Candidate true ROI as a fraction (0.10 = +10 %). */
  roi: number;
  /** σ_ROI at this candidate ROI; an upper bound for Ocean KO. In schedule mode
   *  every row carries the schedule's own σ, not one re-evaluated per ROI. */
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
  /** False when the format's row cannot pay this ROI at its pinned ITM (Run
   *  would block it): `sigma` then belongs to the ROI the row saturates at,
   *  so the card withholds the volume. Always true in schedule mode. */
  roiReached: boolean;
  /** Highlighted as the user's anchor row: the closest candidate of the same
   *  sign, none when the grid has no row of that sign. */
  isCurrent: boolean;
}

export interface ProveEdgeAnchor {
  /** Anchor ROI used for `sigma` / `tourneys` (= user's exact input; in
   *  schedule mode the schedule's cost-weighted mean ROI, or the engine's
   *  expected ROI for a model that ignores the row ROI). */
  roi: number;
  sigma: number;
  sigmaLo: number;
  sigmaHi: number;
  tourneys: number;
  tourneysLo: number;
  tourneysHi: number;
  fields: number;
  insideFitBox: boolean;
  /** See `ProveEdgeRow.roiReached`. */
  roiReached: boolean;
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
  /** Full ticket cost matters for Ocean's dollar-denominated bounty tiers. */
  oceanKoTotalTicket?: number;
  /** Global ITM target of the run path; ignored in schedule mode, whose rows
   *  arrive already stamped. */
  itmTarget?: ItmTargetConfig;
  /** Chosen confidence C as a fraction (0.95): the size of the two-sided bar
   *  over zero, and the chance the printed volume clears it. */
  confidence: number;
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
  roiReached: boolean;
}

function runtimeSigmaPoint(
  safeAfs: number,
  rake: number,
  roi: number,
  finishModel?: FinishModelConfig,
  itmTarget?: ItmTargetConfig,
): RuntimeSigmaPoint {
  return { afs: safeAfs, roi, rake, finishModel, itmTarget };
}

function isRuntimeSigmaFormat(format: ProveEdgeFormat): format is RuntimeSigmaFormat {
  return format !== "exact" && format !== "ocean-ko";
}

/**
 * Every runtime σ `computeProveEdge` reads for this input (each candidate ROI
 * plus the exact anchor), keyed exactly as it reads them. On large fields one
 * σ costs tens of milliseconds, so the card warms these one per task before
 * it asks for the whole table. Empty for schedule mode and Ocean KO.
 */
export function proveEdgeRuntimeSigmaPoints(
  input: ProveEdgeInput,
): { format: RuntimeSigmaFormat; point: RuntimeSigmaPoint }[] {
  const { format } = input;
  if (!isRuntimeSigmaFormat(format)) return [];
  const safeAfs = Math.max(1, input.afs);
  return [...input.candidates, input.currentRoi].map((roi) => ({
    format,
    point: runtimeSigmaPoint(
      safeAfs,
      input.rake,
      roi,
      input.finishModel,
      input.itmTarget,
    ),
  }));
}

function singleFormatSigma(
  format: ConvergenceRowFormat,
  afs: number,
  rake: number,
  roi: number,
  finishModel?: FinishModelConfig,
  oceanKoTotalTicket = 100,
  itmTarget?: ItmTargetConfig,
): SigmaTriple {
  if (format === "ocean-ko") {
    const ocean = {
      afs, rake, roi, finishModel, totalTicket: oceanKoTotalTicket, itmTarget,
    };
    const runtime = buildOceanKoSigmaBand(ocean);
    return {
      sigma: runtime.s,
      sigmaLo: runtime.s,
      sigmaHi: runtime.s,
      insideBox: false,
      roiReached: oceanKoRoiReached(ocean),
    };
  }
  const safeAfs = Math.max(1, afs);
  const point = runtimeSigmaPoint(safeAfs, rake, roi, finishModel, itmTarget);
  const sigma = formatRuntimeSigma(format, point);
  // A one-row schedule with a positive buy-in always compiles; a null here
  // would be an engine regression, not a reason to fall back to a fit.
  if (sigma === null) {
    throw new Error(`proveEdge: no runtime σ for ${format} at AFS ${safeAfs}`);
  }
  const roiReached = formatRuntimeRoiReached(format, point);
  const insideBox = roiReached && isInsideFitBox({ format, field: safeAfs, roi });
  const resid = insideBox ? runtimeSigmaBandResid(format) : 0;
  return {
    sigma,
    sigmaLo: sigma * (1 - resid),
    sigmaHi: sigma * (1 + resid),
    insideBox,
    roiReached,
  };
}

/**
 * A candidate row prints a bare point (no range) while the table's band policy
 * is numeric: the anchor sits inside the validated zone, this row's ROI does
 * not. When the anchor itself is outside, the banner already says the ranges
 * are hidden.
 */
export function rowIsPointOnly(
  result: Pick<ProveEdgeResult, "bandPolicy">,
  row: Pick<ProveEdgeRow, "insideFitBox" | "roiReached">,
): boolean {
  return result.bandPolicy === "numeric" && row.roiReached && !row.insideFitBox;
}

/** Chance, in percent, that a player whose true ROI is the tested one clears
 *  the two-sided `ciPct` bar over zero at the volume this card prints. */
export function proveEdgeDetectionPct(ciPct: number): number {
  return Math.max(50, ciPct);
}

/** Standard errors between zero and the tested ROI: the two-sided bar plus the
 *  one-sided power term Φ⁻¹(C) = ciToZ(2C − 1). See module header. */
function detectionZ(confidence: number): number {
  return ciToZ(confidence) + ciToZ(Math.max(0, 2 * confidence - 1));
}

function nFromSigma(zDetect: number, sigma: number, roi: number): number {
  const absRoi = Math.abs(roi);
  if (absRoi <= 1e-9) return Number.POSITIVE_INFINITY;
  return Math.ceil(Math.pow((zDetect * sigma) / absRoi, 2));
}

function pickAnchorIndex(
  candidates: readonly number[],
  currentRoi: number,
): number {
  let best = -1;
  let bestDist = Infinity;
  candidates.forEach((roi, i) => {
    // A losing ROI on the winning-only grid has no row; snapping it to +0.1 %
    // marked the largest volume in the table as the chosen ROI.
    if (roi * currentRoi < 0) return;
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

export function computeProveEdge(input: ProveEdgeInput): ProveEdgeResult {
  const { format, currentRoi, candidates } = input;

  if (format === "exact") {
    return computeProveEdgeSchedule(input);
  }

  const zDetect = detectionZ(input.confidence);
  const formatTyped = format as ConvergenceRowFormat;
  const safeAfs = Math.max(1, input.afs);
  const anchorIdx = pickAnchorIndex(candidates, currentRoi);

  const rows: ProveEdgeRow[] = candidates.map((roi, i) => {
    const triple = singleFormatSigma(
      formatTyped,
      safeAfs,
      input.rake,
      roi,
      input.finishModel,
      input.oceanKoTotalTicket,
      input.itmTarget,
    );
    const tourneys = nFromSigma(zDetect, triple.sigma, roi);
    const tourneysLo = nFromSigma(zDetect, triple.sigmaLo, roi);
    const tourneysHi = nFromSigma(zDetect, triple.sigmaHi, roi);
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
      roiReached: triple.roiReached,
      isCurrent: i === anchorIdx,
    };
  });

  // Anchor = precise σ at user's exact ROI, not snapped to grid.
  const anchorTriple = singleFormatSigma(
    formatTyped,
    safeAfs,
    input.rake,
    currentRoi,
    input.finishModel,
    input.oceanKoTotalTicket,
    input.itmTarget,
  );
  const anchor: ProveEdgeAnchor = {
    roi: currentRoi,
    sigma: anchorTriple.sigma,
    sigmaLo: anchorTriple.sigmaLo,
    sigmaHi: anchorTriple.sigmaHi,
    tourneys: nFromSigma(zDetect, anchorTriple.sigma, currentRoi),
    tourneysLo: nFromSigma(zDetect, anchorTriple.sigmaLo, currentRoi),
    tourneysHi: nFromSigma(zDetect, anchorTriple.sigmaHi, currentRoi),
    fields: 0, // filled below
    insideFitBox: anchorTriple.insideBox,
    roiReached: anchorTriple.roiReached,
  };
  anchor.fields = Number.isFinite(anchor.tourneys)
    ? anchor.tourneys / safeAfs
    : Infinity;

  return {
    rows,
    effectiveAfs: safeAfs,
    bandPolicy: anchor.insideFitBox ? "numeric" : "outside-fit-box",
    anchor,
  };
}

function computeProveEdgeSchedule(input: ProveEdgeInput): ProveEdgeResult {
  const { schedule, finishModel, candidates } = input;
  const zDetect = detectionZ(input.confidence);
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
        fieldMin: r.fieldMin,
        fieldMax: r.fieldMax,
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
  // A fixed-shape model never calibrates to the typed row ROI, so the ROI the
  // schedule really has is the one the engine compiles from its pmf.
  const effectiveRoi =
    breakdown && !isAlphaAdjustable(finishModel ?? { id: "power-law" })
      ? breakdown.expectedRoi
      : scheduleEffectiveRoi(safeSchedule);
  const anchorIdx = pickAnchorIndex(candidates, effectiveRoi);

  const rows: ProveEdgeRow[] = candidates.map((roi, i) => {
    const tourneys = nFromSigma(zDetect, sigmaPoint, roi);
    const tourneysLo = nFromSigma(zDetect, sigmaLo, roi);
    const tourneysHi = nFromSigma(zDetect, sigmaHi, roi);
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
      roiReached: true,
      isCurrent: i === anchorIdx,
    };
  });

  const anchorTourneys = nFromSigma(zDetect, sigmaPoint, effectiveRoi);
  const anchor: ProveEdgeAnchor = {
    roi: effectiveRoi,
    sigma: sigmaPoint,
    sigmaLo,
    sigmaHi,
    tourneys: anchorTourneys,
    tourneysLo: nFromSigma(zDetect, sigmaLo, effectiveRoi),
    tourneysHi: nFromSigma(zDetect, sigmaHi, effectiveRoi),
    fields: Number.isFinite(anchorTourneys)
      ? anchorTourneys / effectiveAfs
      : Infinity,
    insideFitBox: bandPolicy === "numeric",
    roiReached: true,
  };

  return {
    rows,
    effectiveAfs,
    bandPolicy,
    anchor,
  };
}
