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
      .slice(0, 16);
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

export function roiLabel(roi: number): string {
  const pct = Math.round(roi * 100);
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
