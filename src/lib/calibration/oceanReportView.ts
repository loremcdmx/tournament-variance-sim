import type { ComparisonFormat, FormatComparisonSummary } from "./formatComparison";

/** The longest spell below EV saturates at the distance: a career's profit tends
 * to stay on one side of its EV for most of the path, so P95 is about the whole
 * distance at any horizon. From this share on, the number carries no information. */
export const FULL_DISTANCE_SHARE = 0.97;

export function isNearFullDistance(value: number, distance: number): boolean {
  return distance > 0 && value >= FULL_DISTANCE_SHARE * distance;
}

export interface OceanFormatRatio {
  format: ComparisonFormat;
  /** Ocean P95 / format P95 of the drawdown from the peak; null if the format's P95 is 0. */
  drawdown: number | null;
  /** The same for the largest gap below EV. */
  evShortfall: number | null;
}

const RATIO_FORMATS: ComparisonFormat[] = ["freezeout", "pko", "mystery"];

type RatioRow = Pick<FormatComparisonSummary, "format" | "maxDrawdownBI" | "maxEvShortfallBI">;

/** Ocean P95 against every other format in the report. Unrounded: callers round to
 * one digit because the second one is inside Monte Carlo noise. */
export function oceanRatios(rows: readonly RatioRow[]): OceanFormatRatio[] {
  const ocean = rows.find((row) => row.format === "ocean-ko");
  if (!ocean) return [];
  const ratio = (numerator: number, denominator: number) => denominator > 0 ? numerator / denominator : null;
  return RATIO_FORMATS.flatMap((format) => {
    const other = rows.find((row) => row.format === format);
    return other ? [{
      format,
      drawdown: ratio(ocean.maxDrawdownBI.p95, other.maxDrawdownBI.p95),
      evShortfall: ratio(ocean.maxEvShortfallBI.p95, other.maxEvShortfallBI.p95),
    }] : [];
  });
}

export function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}
