export interface RefLineSpec {
  roi: number;
  label: string;
  color: string;
}

export interface RefLineConfig extends RefLineSpec {
  enabled: boolean;
}

export const DEFAULT_REF_LINES: RefLineConfig[] = [
  { roi: -0.2, label: "ROI −20%", color: "#fb923c", enabled: false },
  { roi: 0.2, label: "ROI +20%", color: "#a3e635", enabled: false },
  { roi: 0.5, label: "ROI +50%", color: "#22d3ee", enabled: false },
];

const REF_LINES_STORAGE_KEY = "tvs.refLines.v1";

export function loadRefLines(): RefLineConfig[] {
  if (typeof localStorage === "undefined") return DEFAULT_REF_LINES;
  try {
    const raw = localStorage.getItem(REF_LINES_STORAGE_KEY);
    if (!raw) return DEFAULT_REF_LINES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_REF_LINES;
    return parsed
      .filter(
        (r): r is RefLineConfig =>
          !!r &&
          typeof r.roi === "number" &&
          Number.isFinite(r.roi) &&
          r.roi > -1.0 &&
          typeof r.label === "string" &&
          typeof r.color === "string" &&
          typeof r.enabled === "boolean",
      )
      .slice(0, 16)
      // A label is derived, never typed: deriving it again keeps a saved one
      // in step with the ROI the line is drawn at.
      .map((r) => ({ ...r, label: roiLabel(r.roi) }));
  } catch {
    return DEFAULT_REF_LINES;
  }
}

export function saveRefLines(value: RefLineConfig[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(REF_LINES_STORAGE_KEY, JSON.stringify(value));
  } catch {}
}

// The line is drawn at the ROI it holds, so its box and label carry the
// hundredths of a percent a typed 7.5 or 2.25 has, not a whole percent.
export function roiPct(roi: number): number {
  return Math.round(roi * 10_000) / 100;
}

export function roiLabel(roi: number): string {
  const pct = roiPct(roi);
  if (pct === 0) return "ROI 0%";
  const sign = pct > 0 ? "+" : "−";
  return `ROI ${sign}${Math.abs(pct)}%`;
}

export function buildRefLine(
  x: ArrayLike<number>,
  slopePerX: number,
): Float64Array {
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] * slopePerX;
  return out;
}
