import type { DictKey } from "@/lib/i18n/dict";
import { fmt } from "@/lib/results/formatters";

export interface TrajectoryLineMeta {
  /** Stable identifier. The tooltip title comes from `trajectoryLineTitle`. */
  label: string;
  color: string;
  seriesIdx: number;
  /** Probability that a real run lands at-or-below this line, if applicable. */
  percentile?: number;
  /** Free-form "what kind of line" tag for the tooltip. */
  kind: "mean" | "band" | "best" | "worst" | "path" | "ref";
  /** For best/worst lines: "real" = single sample path, "agg" = pointwise envelope. */
  variant?: "real" | "agg";
  /** Display rank for path lines — the i-th most-preferred run to show.
   *  Undefined for non-path lines. Used to skip hidden paths in the cursor
   *  tooltip so it never highlights an invisible series. */
  rank?: number;
  /** 1-based sample number of a path line. */
  runNumber?: number;
  /** Set on lines that belong to the overlaid second result. */
  overlayLabel?: string;
  /** A line whose title is a plain dictionary entry. */
  titleKey?: DictKey;
}

type Translate = (key: DictKey) => string;

/** The tail share a percentile line cuts off, in percent: 0.0015 and 0.9985 are both 0.15. */
export function formatTailPercent(percentile: number): string {
  const tail = Math.min(percentile, 1 - percentile) * 100;
  return String(Number(tail.toFixed(2)));
}

export function formatTrajectoryBandCoverage(percentile: number): string {
  const centralPct = (1 - 2 * Math.min(percentile, 1 - percentile)) * 100;
  const rounded =
    Math.abs(centralPct - Math.round(centralPct)) < 0.05
      ? Math.round(centralPct).toString()
      : centralPct.toFixed(1);
  return `${rounded}%`;
}

export function trajectoryBandSideKey(
  percentile: number,
): "chart.traj.band.side.lower" | "chart.traj.band.side.upper" {
  return percentile < 0.5
    ? "chart.traj.band.side.lower"
    : "chart.traj.band.side.upper";
}

function extremeKey(line: TrajectoryLineMeta): DictKey {
  const agg = line.variant === "agg";
  if (line.kind === "best") {
    return agg ? "chart.traj.extreme.aggBest" : "chart.traj.extreme.realBest";
  }
  return agg ? "chart.traj.extreme.aggWorst" : "chart.traj.extreme.realWorst";
}

/** Header of the hover tooltip, in the UI language. */
export function trajectoryLineTitle(line: TrajectoryLineMeta, t: Translate): string {
  if (line.kind === "band" && line.percentile != null) {
    return fmt(t("chart.traj.band.title"), {
      coverage: formatTrajectoryBandCoverage(line.percentile),
      side: t(trajectoryBandSideKey(line.percentile)),
    });
  }
  if (line.titleKey) return t(line.titleKey);
  if (line.kind === "path" && line.runNumber != null) {
    return fmt(t("chart.traj.runLabel"), { n: String(line.runNumber) });
  }
  if (line.kind === "best" || line.kind === "worst") {
    const own = t(extremeKey(line));
    return line.overlayLabel ? `${line.overlayLabel} · ${own}` : own;
  }
  return line.label;
}
