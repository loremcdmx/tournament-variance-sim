import {
  evalSigma,
  FIT_RAKE_BY_FORMAT,
  SIGMA_ROI_FREEZE,
  SIGMA_ROI_MYSTERY,
  SIGMA_ROI_MYSTERY_ROYALE,
  SIGMA_ROI_PKO,
  type SigmaCoef,
} from "./convergenceFit";
import { buildScheduleAnalyticBreakdown } from "./engine";
import {
  CONVERGENCE_FIELD_MAX,
  CONVERGENCE_FIELD_MIN,
  CONVERGENCE_KO_ROI_MAX,
  CONVERGENCE_KO_ROI_MIN,
  CONVERGENCE_MBR_ROI_MAX,
  CONVERGENCE_MBR_ROI_MIN,
  inferRowFormat,
  type ConvergenceRowFormat,
} from "./convergencePolicy";
import type { CalibrationMode, SimulationInput, TournamentRow } from "./types";

export {
  FIT_RAKE_BY_FORMAT,
  SIGMA_ROI_FREEZE,
  SIGMA_ROI_MYSTERY,
  SIGMA_ROI_MYSTERY_ROYALE,
  SIGMA_ROI_PKO,
};

export interface ConvergenceTableRow {
  targetPct: number;
  tourneys: number;
  tourneysLo: number;
  tourneysHi: number;
  fields: number;
  fieldsLo: number;
  fieldsHi: number;
}

export type SigmaRoiFit = SigmaCoef;

export type MixTuple = [number, number, number];

export type ConvergenceFormat =
  | "freeze"
  | "pko"
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
  perRow: ExactBreakdownRow[];
  avgField: number;
  sigmaEff: number;
  sigmaEffLo: number;
  sigmaEffHi: number;
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

export function sigmaForFit(
  coef: SigmaRoiFit,
  afs: number,
  roi: number,
  rakeScale: number,
): number {
  return evalSigma(coef, afs, roi) * rakeScale;
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

// Winitzki's approximation of the inverse error function (max error ~4e-4),
// good enough to turn a user-picked two-tailed CI into a z-score.
function inverseErf(x: number): number {
  const a = 0.147;
  const ln1 = Math.log(1 - x * x);
  const t = 2 / (Math.PI * a) + ln1 / 2;
  const sign = x >= 0 ? 1 : -1;
  return sign * Math.sqrt(Math.sqrt(t * t - ln1 / a) - t);
}

export function ciToZ(ciFrac: number): number {
  const clamped = Math.max(0, Math.min(0.999999, ciFrac));
  return Math.SQRT2 * inverseErf(clamped);
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
  return {
    perRow: perRowWithoutShare.map((r) => ({
      ...r,
      varShare: totalVar > 0 ? r.varContribution / totalVar : 0,
    })),
    avgField,
    sigmaEff: analytic.sigmaRoiPerTourney,
    sigmaEffLo: analytic.sigmaRoiPerTourney,
    sigmaEffHi: analytic.sigmaRoiPerTourney,
  };
}

export function isRoiControlActive(
  format: ConvergenceFormat,
  mode: "avg" | "exact",
  mix: MixTuple,
): boolean {
  void format;
  void mix;
  return mode !== "exact";
}

export function computeConvergenceRows(input: {
  afs: number;
  z: number;
  roi: number;
  mix: MixTuple;
  format: ConvergenceFormat;
  rakePct: number;
  exactBreakdown?: ExactBreakdown | null;
  sigmaOverrides?: Partial<Record<RowFormat, SigmaBand>>;
}): ConvergenceTableRow[] {
  const { afs, z, roi, mix, format, rakePct, exactBreakdown, sigmaOverrides } =
    input;
  const fitRake =
    format === "mystery-royale" ? FIT_RAKE_BY_FORMAT["mystery-royale"] : 0.10;
  const rakeScale = (1 + fitRake) / (1 + rakePct / 100);
  const sigmaForFitBand = (
    coef: SigmaRoiFit,
  ): SigmaBand => {
    const s = sigmaForFit(coef, afs, roi, rakeScale);
    return { s, lo: s * (1 - coef.resid), hi: s * (1 + coef.resid) };
  };
  const sigmaFor = (rowFormat: RowFormat, coef: SigmaRoiFit): SigmaBand =>
    sigmaOverrides?.[rowFormat] ?? sigmaForFitBand(coef);

  const f = sigmaFor("freeze", SIGMA_ROI_FREEZE);
  const p = sigmaFor("pko", SIGMA_ROI_PKO);
  const m = sigmaFor("mystery", SIGMA_ROI_MYSTERY);
  const mr = sigmaFor("mystery-royale", SIGMA_ROI_MYSTERY_ROYALE);
  const [fFreeze, fPko, fMystery] = mix;
  const pick = (key: "s" | "lo" | "hi"): number =>
    format === "exact" && exactBreakdown
      ? key === "s"
        ? exactBreakdown.sigmaEff
        : key === "lo"
          ? exactBreakdown.sigmaEffLo
          : exactBreakdown.sigmaEffHi
      : format === "mystery-royale"
        ? mr[key]
        : format === "mystery"
          ? m[key]
          : format === "pko"
            ? p[key]
            : format === "freeze"
              ? f[key]
              : Math.sqrt(
                  fFreeze * f[key] * f[key] +
                    fPko * p[key] * p[key] +
                    fMystery * m[key] * m[key],
                );

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
