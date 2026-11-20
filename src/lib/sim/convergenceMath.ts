import { runtimeSigmaBandResid } from "./runtimeSigmaBands";
import { buildScheduleAnalyticBreakdown } from "./compile";
import { applyGameType } from "./gameType";
import { applyItmTarget, type ItmTargetConfig } from "./itmTarget";
import { validateSchedule } from "./validation";
import {
  CONVERGENCE_FIELD_MAX,
  CONVERGENCE_FIELD_MIN,
  CONVERGENCE_KO_ROI_MAX,
  CONVERGENCE_KO_ROI_MIN,
  CONVERGENCE_MBR_ROI_MAX,
  CONVERGENCE_MBR_ROI_MIN,
  inferRowFormat,
  isInsideFitBox,
  type ConvergenceRowFormat,
} from "./convergencePolicy";
import type { CalibrationMode, SimulationInput, TournamentRow } from "./types";

export interface ConvergenceTableRow {
  targetPct: number;
  tourneys: number;
  tourneysLo: number;
  tourneysHi: number;
  fields: number;
  fieldsLo: number;
  fieldsHi: number;
}

export type MixTuple = [number, number, number];

export type ConvergenceFormat =
  | "freeze"
  | "pko"
  | "ocean-ko"
  | "mystery"
  | "mystery-royale"
  | "mix"
  | "exact";

export type RowFormat = ConvergenceRowFormat;

export interface ExactBreakdownRow {
  index: number;
  label: string;
  afs: number;
  fieldMin: number;
  fieldMax: number;
  roi: number;
  format: RowFormat;
  weight: number;
  countShare: number;
  costShare: number;
  sigma: number;
  sigmaLo: number;
  sigmaHi: number;
  variance: number;
  varContribution: number;
  varContributionLo: number;
  varContributionHi: number;
  varShare: number;
}

export interface ExactBreakdown {
  /** Ocean rows propagate a conservative variance bound to the schedule. */
  varianceEstimate: "model" | "upper-bound";
  perRow: ExactBreakdownRow[];
  avgField: number;
  sigmaEff: number;
  sigmaEffLo: number;
  sigmaEffHi: number;
  /** The engine's expected ROI of the schedule (before rakeback). */
  expectedRoi: number;
}

export interface ExactBreakdownOptions {
  finishModel?: SimulationInput["finishModel"];
  calibrationMode?: CalibrationMode;
  rakebackFracOfRake?: number;
}

export interface SigmaBand {
  s: number;
  lo: number;
  hi: number;
}

export const TARGETS = [
  0.5, 0.3, 0.2, 0.1, 0.05, 0.025, 0.01, 0.005, 0.001,
];

// Log-scaled AFS slider range: 50 .. 50 000 players.
export const AFS_MIN = CONVERGENCE_FIELD_MIN;
export const AFS_MAX = CONVERGENCE_FIELD_MAX;
export const AFS_LOG_MIN = Math.log(AFS_MIN);
export const AFS_LOG_MAX = Math.log(AFS_MAX);

// Linear ROI slider range in ROI units (not percent).
export const ROI_MIN_DEFAULT = -0.30;
export const ROI_MAX_DEFAULT = 1.00;
export const ROI_MIN_KO = CONVERGENCE_KO_ROI_MIN;
export const ROI_MAX_KO = CONVERGENCE_KO_ROI_MAX;
export const ROI_MIN_MBR = CONVERGENCE_MBR_ROI_MIN;
export const ROI_MAX_MBR = CONVERGENCE_MBR_ROI_MAX;

export function normalizeMix(m: MixTuple): MixTuple {
  const s = m[0] + m[1] + m[2];
  if (s <= 1e-9) return [1 / 3, 1 / 3, 1 / 3];
  return [m[0] / s, m[1] / s, m[2] / s];
}

export function posToAfs(pos: number): number {
  const clamped = Math.max(0, Math.min(1, pos));
  if (clamped <= 0) return AFS_MIN;
  if (clamped >= 1) return AFS_MAX;
  return Math.exp(AFS_LOG_MIN + (AFS_LOG_MAX - AFS_LOG_MIN) * clamped);
}

export function afsToPos(afs: number): number {
  const clamped = Math.max(
    AFS_LOG_MIN,
    Math.min(AFS_LOG_MAX, Math.log(Math.max(1, afs))),
  );
  return (clamped - AFS_LOG_MIN) / (AFS_LOG_MAX - AFS_LOG_MIN);
}

export function roiControlBoundsForFormat(
  format: ConvergenceFormat,
): { min: number; max: number } {
  if (format === "mystery-royale") {
    return { min: ROI_MIN_MBR, max: ROI_MAX_MBR };
  }
  if (format === "pko" || format === "mystery" || format === "mix") {
    return { min: ROI_MIN_KO, max: ROI_MAX_KO };
  }
  return { min: ROI_MIN_DEFAULT, max: ROI_MAX_DEFAULT };
}

export function fmtAfs(
  n: number,
  locales: Intl.LocalesArgument = "en-US",
): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k`;
  return Math.round(n).toLocaleString(locales);
}

const TWO_OVER_SQRT_PI = 2 / Math.sqrt(Math.PI);

// Positive-term series for erf. The alternating Taylor series loses digits
// above x ~ 3, which the slider ceiling (z ~ 4.9) reaches.
function erf(x: number): number {
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let n = 1; n < 400; n++) {
    term *= (2 * x2) / (2 * n + 1);
    sum += term;
    if (term <= sum * 1e-17) break;
  }
  return TWO_OVER_SQRT_PI * Math.exp(-x2) * sum;
}

// Winitzki's closed form (error ~4e-4, which showed z = 1.959 at 95 %) seeds a
// Newton refinement on erf, so the z that sizes every table is the textbook one.
function inverseErf(x: number): number {
  const a = 0.147;
  const ln1 = Math.log(1 - x * x);
  const t = 2 / (Math.PI * a) + ln1 / 2;
  let y = Math.sqrt(Math.sqrt(t * t - ln1 / a) - t);
  for (let i = 0; i < 4; i++) {
    y -= (erf(y) - x) / (TWO_OVER_SQRT_PI * Math.exp(-y * y));
  }
  return y;
}

export function ciToZ(ciFrac: number): number {
  const clamped = Math.max(0, Math.min(0.999999, ciFrac));
  return Math.SQRT2 * inverseErf(clamped);
}

/** Cost-weighted mean of the typed row ROIs: the schedule's profit over what
 *  it costs when the finish model calibrates to the row ROI. A model that
 *  ignores it (uniform, empirical, `*-realdata-*`, a pinned α) plays its own
 *  pmf instead; `ExactBreakdown.expectedRoi` carries that. */
export function scheduleEffectiveRoi(
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

export function buildExactBreakdown(
  schedule?: readonly TournamentRow[] | null,
  options?: ExactBreakdownOptions,
): ExactBreakdown | null {
  if (!schedule) return null;
  const analytic = buildScheduleAnalyticBreakdown({
    schedule: [...schedule],
    finishModel: options?.finishModel ?? { id: "power-law" },
    calibrationMode: options?.calibrationMode,
    rakebackFracOfRake: options?.rakebackFracOfRake,
  });
  if (!analytic) return null;

  const perRowWithoutShare = schedule.map((row, i) => {
    const fmt = inferRowFormat(row);
    const stats = analytic.perRow[i];
    const sigma =
      stats.totalCost > 0 ? stats.sigmaDollar / (stats.totalCost / stats.count) : 0;
    const varContribution =
      analytic.totalCost > 0
        ? (analytic.tournamentsPerPass * stats.varianceDollar) /
          (analytic.totalCost * analytic.totalCost)
        : 0;
    return {
      index: i,
      label: row.label || `#${i + 1}`,
      afs: stats.fieldAvg,
      fieldMin: stats.fieldMin,
      fieldMax: stats.fieldMax,
      roi: row.roi,
      format: fmt,
      weight: stats.costShare,
      countShare: stats.countShare,
      costShare: stats.costShare,
      sigma,
      sigmaLo: sigma,
      sigmaHi: sigma,
      variance: sigma * sigma,
      varContribution,
      varContributionLo: varContribution,
      varContributionHi: varContribution,
    };
  });
  const totalVar = perRowWithoutShare.reduce(
    (a, r) => a + r.varContribution,
    0,
  );
  const avgField =
    analytic.tournamentsPerPass > 0
      ? analytic.perRow.reduce(
          (acc, row) => acc + row.fieldAvg * row.countShare,
          0,
        )
      : 0;
  // Schedule-mode band: gate on every row sitting inside the grid its
  // format's band was calibrated on, then take the variance-share-weighted
  // average of the per-format residuals the chips and the prove-edge card
  // use (`runtimeSigmaBandResid`). Single-format mode is the 1-row case of
  // this formula (varShare = 1 → weightedResid = resid_fmt). If any row is
  // outside its box the schedule estimate stays point-only, matching the
  // single-format `outside-fit-box` policy.
  const allInsideBox = perRowWithoutShare.every((r) =>
    isInsideFitBox({ format: r.format, field: r.afs, fieldMin: r.fieldMin, fieldMax: r.fieldMax, roi: r.roi }),
  );
  const perRowWithShare = perRowWithoutShare.map((r) => ({
    ...r,
    varShare: totalVar > 0 ? r.varContribution / totalVar : 0,
  }));
  const weightedResid = allInsideBox
    ? perRowWithShare.reduce(
        (acc, r) => acc + r.varShare * (
          r.format === "ocean-ko" ? 0 : runtimeSigmaBandResid(r.format)
        ),
        0,
      )
    : 0;
  // Apply weighted residual to every row's sigma so per-row sigmaLo/Hi
  // reflect the same band the total uses, and to sigmaEff.
  const decoratedPerRow = perRowWithShare.map((r) => {
    const rResid = allInsideBox && r.format !== "ocean-ko"
      ? runtimeSigmaBandResid(r.format)
      : 0;
    return {
      ...r,
      sigmaLo: r.sigma * (1 - rResid),
      sigmaHi: r.sigma * (1 + rResid),
      varContributionLo: r.varContribution * Math.pow(1 - rResid, 2),
      varContributionHi: r.varContribution * Math.pow(1 + rResid, 2),
    };
  });
  return {
    varianceEstimate: perRowWithShare.some((r) => r.format === "ocean-ko")
      ? "upper-bound"
      : "model",
    perRow: decoratedPerRow,
    avgField,
    sigmaEff: analytic.sigmaRoiPerTourney,
    sigmaEffLo: analytic.sigmaRoiPerTourney * (1 - weightedResid),
    sigmaEffHi: analytic.sigmaRoiPerTourney * (1 + weightedResid),
    expectedRoi: analytic.expectedRoi,
  };
}

export function isRoiControlActive(mode: "avg" | "exact"): boolean {
  return mode !== "exact";
}

export function defaultOceanKoTicket(schedule?: readonly TournamentRow[] | null): number {
  let count = 0;
  let ticketTotal = 0;
  for (const row of schedule ?? []) {
    if (inferRowFormat(row) !== "ocean-ko") continue;
    const plays = Math.max(0, row.count);
    count += plays;
    ticketTotal += plays * row.buyIn * (1 + row.rake);
  }
  return count > 0 ? Math.max(0.01, ticketTotal / count) : 100;
}

export interface OceanKoRuntimeInput {
  afs: number;
  roi: number;
  rake: number;
  totalTicket: number;
  finishModel?: SimulationInput["finishModel"];
  /** Global ITM target of the run path; off means the payout table's paid share. */
  itmTarget?: ItmTargetConfig;
}

function buildOceanKoRuntimeRow(input: OceanKoRuntimeInput): TournamentRow {
  const base: TournamentRow = {
    id: "convergence-ocean-ko-runtime",
    players: Math.max(2, Math.round(input.afs)),
    buyIn: Math.max(0.01, input.totalTicket) / (1 + Math.max(0, input.rake)),
    rake: Math.max(0, input.rake),
    roi: input.roi,
    payoutStructure: "mtt-gg-bounty",
    count: 1,
  };
  const ocean: TournamentRow = {
    ...base,
    ...applyGameType(base, "ocean-ko"),
    buyIn: base.buyIn,
    rake: base.rake,
  };
  // The run path pins every row's ITM; an unpinned row is one Run never plays.
  return applyItmTarget([ocean], input.itmTarget ?? { enabled: false, pct: 0 })[0];
}

export function buildOceanKoSigmaBand(input: OceanKoRuntimeInput): SigmaBand {
  const breakdown = buildExactBreakdown([buildOceanKoRuntimeRow(input)], {
    finishModel: input.finishModel,
  });
  if (!breakdown) throw new Error("Ocean KO runtime moments unavailable");
  const s = breakdown.sigmaEff;
  // Ocean's runtime sigma is an analytic upper bound. Equal endpoints mean
  // no calibrated residual band; they do not make this an exact sigma.
  return { s, lo: s, hi: s };
}

/** Whether Run would accept the Ocean tab's pinned row, by the same gate
 *  (`validateSchedule`) as `formatRuntimeRoiReached` for the other tabs. */
export function oceanKoRoiReached(input: OceanKoRuntimeInput): boolean {
  return validateSchedule(
    [buildOceanKoRuntimeRow(input)],
    input.finishModel ?? { id: "power-law" },
  ).ok;
}

const NO_SIGMA: SigmaBand = { s: NaN, lo: NaN, hi: NaN };

/**
 * The volumes of the convergence table, from σ the caller compiled: the
 * schedule's breakdown on the Schedule tab, otherwise one band per format the
 * tab uses (`buildRuntimeSigmaBands`, `buildOceanKoSigmaBand`). `sigmaBands`
 * is required and nothing stands in for a missing band: a format without one
 * prints no volume (NaN, shown as a dash), never a closed-form estimate.
 */
export function computeConvergenceRows(input: {
  afs: number;
  z: number;
  mix: MixTuple;
  format: ConvergenceFormat;
  exactBreakdown?: ExactBreakdown | null;
  sigmaBands: Partial<Record<RowFormat, SigmaBand>> | undefined;
}): ConvergenceTableRow[] {
  const { afs, z, mix, format, exactBreakdown, sigmaBands } = input;
  const band = (rowFormat: RowFormat): SigmaBand =>
    sigmaBands?.[rowFormat] ?? NO_SIGMA;
  // A Mix component with no weight is not compiled, so it has no band.
  const mixTerm = (share: number, rowFormat: RowFormat, key: "s" | "lo" | "hi") =>
    share > 0 ? share * band(rowFormat)[key] * band(rowFormat)[key] : 0;
  const [fFreeze, fPko, fMystery] = mix;
  // Weights that are not shares (NaN, negative, infinite, all zero) describe no
  // blend, so the Mix has no σ: reading such a weight as "no weight" would
  // print the σ of the other components, or 0 tournaments.
  const mixIsShares =
    mix.every((share) => Number.isFinite(share) && share >= 0) &&
    fFreeze + fPko + fMystery > 0;
  const pick = (key: "s" | "lo" | "hi"): number =>
    format === "exact"
      ? exactBreakdown
        ? key === "s"
          ? exactBreakdown.sigmaEff
          : key === "lo"
            ? exactBreakdown.sigmaEffLo
            : exactBreakdown.sigmaEffHi
        : NaN
      : format === "mix"
        ? mixIsShares
          ? Math.sqrt(
              mixTerm(fFreeze, "freeze", key) +
                mixTerm(fPko, "pko", key) +
                mixTerm(fMystery, "mystery", key),
            )
          : NaN
        : band(format)[key];

  const sigmaRoi = pick("s");
  const sigmaRoiLo = pick("lo");
  const sigmaRoiHi = pick("hi");
  const fieldBase =
    format === "exact" && exactBreakdown
      ? exactBreakdown.avgField
      : afs;
  return TARGETS.map((target) => {
    const k = Math.ceil(Math.pow((z * sigmaRoi) / target, 2));
    const kLo = Math.ceil(Math.pow((z * sigmaRoiLo) / target, 2));
    const kHi = Math.ceil(Math.pow((z * sigmaRoiHi) / target, 2));
    const invAfs = 1 / Math.max(1, fieldBase);
    return {
      targetPct: target,
      tourneys: k,
      tourneysLo: kLo,
      tourneysHi: kHi,
      fields: k * invAfs,
      fieldsLo: kLo * invAfs,
      fieldsHi: kHi * invAfs,
    };
  });
}

export function formatTargetPct(targetPct: number): string {
  return `±${Number((targetPct * 100).toFixed(1))}%`;
}

export function formatPointRange(
  pointLabel: string,
  loLabel: string,
  hiLabel: string,
  showRange: boolean,
): string {
  if (!showRange || (pointLabel === loLabel && pointLabel === hiLabel)) {
    return pointLabel;
  }
  return `${pointLabel} · ${loLabel}–${hiLabel}`;
}
