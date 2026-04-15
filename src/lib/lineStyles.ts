/**
 * Dark-background line-style presets for the trajectory chart. Four
 * neutral, internally-consistent palettes — no tracker branding. Pure
 * data; consumed by `ResultsView` when rendering uPlot series. Labels
 * and descriptions are resolved via the i18n dict (see
 * `LINE_STYLE_PRESET_META`) so the pure-data module stays locale-free.
 */
import type { DictKey } from "./i18n/dict";

export type LineStylePresetId = "classic" | "duotone" | "mono" | "vivid";

export interface LineStyle {
  stroke: string;
  width: number;
  dash?: number[];
}

export interface LineStylePreset {
  id: LineStylePresetId;
  /** Main expected-profit curve. */
  mean: LineStyle;
  /** EV reference line. */
  ev: LineStyle;
  /** Luckiest sample path. */
  best: LineStyle;
  /** Unluckiest sample path. */
  worst: LineStyle;
  /** 5th-percentile trajectory. */
  p05: LineStyle;
  /** 95th-percentile trajectory. */
  p95: LineStyle;
  /** Individual sample paths drawn behind the envelope. */
  path: LineStyle;
  /** p0.15 / p99.85 extreme envelope edges. */
  bandExtreme: LineStyle;
  /** p2.5 / p97.5 envelope. */
  bandWide: LineStyle;
  /** p15 / p85 envelope. */
  bandNarrow: LineStyle;
  /** Dashed ROI reference slopes. Color is overridden per line. */
  refLine: LineStyle;
  /** Horizontal bankroll-zero line. */
  bankrollLine: LineStyle;
}

// "classic" — warm amber mean + cool blue EV. Default. Maximum readability
// on the dark editorial background; complements the accent purple used
// elsewhere in the UI without clashing.
const classic: LineStylePreset = {
  id: "classic",
  mean: { stroke: "#fbbf24", width: 2.75 },
  ev: { stroke: "#60a5fa", width: 1.5, dash: [6, 4] },
  best: { stroke: "#fde68a", width: 1.25 },
  worst: { stroke: "#bfdbfe", width: 1.25 },
  p05: { stroke: "#f87171", width: 1.5, dash: [5, 3] },
  p95: { stroke: "#4ade80", width: 1.5, dash: [5, 3] },
  path: { stroke: "rgba(251,191,36,0.14)", width: 0.85 },
  bandExtreme: { stroke: "rgba(251,191,36,0.06)", width: 1 },
  bandWide: { stroke: "rgba(251,191,36,0.14)", width: 1 },
  bandNarrow: { stroke: "rgba(251,191,36,0.28)", width: 1 },
  refLine: { stroke: "#64748b", width: 1, dash: [3, 4] },
  bankrollLine: { stroke: "#ef4444", width: 1.5 },
};

// "duotone" — teal mean + magenta EV. High-contrast complementary pair
// for users who want the two primary lines maximally separable.
const duotone: LineStylePreset = {
  id: "duotone",
  mean: { stroke: "#2dd4bf", width: 2.75 },
  ev: { stroke: "#f472b6", width: 1.5, dash: [6, 4] },
  best: { stroke: "#99f6e4", width: 1.25 },
  worst: { stroke: "#fbcfe8", width: 1.25 },
  p05: { stroke: "#fb923c", width: 1.5, dash: [5, 3] },
  p95: { stroke: "#a3e635", width: 1.5, dash: [5, 3] },
  path: { stroke: "rgba(45,212,191,0.14)", width: 0.85 },
  bandExtreme: { stroke: "rgba(45,212,191,0.06)", width: 1 },
  bandWide: { stroke: "rgba(45,212,191,0.14)", width: 1 },
  bandNarrow: { stroke: "rgba(45,212,191,0.28)", width: 1 },
  refLine: { stroke: "#64748b", width: 1, dash: [3, 4] },
  bankrollLine: { stroke: "#ef4444", width: 1.5 },
};

// "mono" — near-monochrome slate palette. Minimal color so other chart
// elements (ref lines, annotations) dominate. Good for screenshots.
const mono: LineStylePreset = {
  id: "mono",
  mean: { stroke: "#f8fafc", width: 2.75 },
  ev: { stroke: "#94a3b8", width: 1.5, dash: [6, 4] },
  best: { stroke: "#cbd5e1", width: 1.25 },
  worst: { stroke: "#64748b", width: 1.25 },
  p05: { stroke: "#e2e8f0", width: 1.5, dash: [5, 3] },
  p95: { stroke: "#e2e8f0", width: 1.5, dash: [5, 3] },
  path: { stroke: "rgba(203,213,225,0.12)", width: 0.85 },
  bandExtreme: { stroke: "rgba(148,163,184,0.06)", width: 1 },
  bandWide: { stroke: "rgba(148,163,184,0.14)", width: 1 },
  bandNarrow: { stroke: "rgba(148,163,184,0.26)", width: 1 },
  refLine: { stroke: "#475569", width: 1, dash: [3, 4] },
  bankrollLine: { stroke: "#ef4444", width: 1.5 },
};

// "vivid" — saturated purple + yellow editorial palette, matches the
// app's suit-accent aesthetic. Loud but harmonic (complementary hues).
const vivid: LineStylePreset = {
  id: "vivid",
  mean: { stroke: "#c084fc", width: 2.75 },
  ev: { stroke: "#facc15", width: 1.5, dash: [6, 4] },
  best: { stroke: "#e9d5ff", width: 1.25 },
  worst: { stroke: "#fef08a", width: 1.25 },
  p05: { stroke: "#fb7185", width: 1.5, dash: [5, 3] },
  p95: { stroke: "#34d399", width: 1.5, dash: [5, 3] },
  path: { stroke: "rgba(192,132,252,0.14)", width: 0.85 },
  bandExtreme: { stroke: "rgba(192,132,252,0.06)", width: 1 },
  bandWide: { stroke: "rgba(192,132,252,0.14)", width: 1 },
  bandNarrow: { stroke: "rgba(192,132,252,0.28)", width: 1 },
  refLine: { stroke: "#64748b", width: 1, dash: [3, 4] },
  bankrollLine: { stroke: "#ef4444", width: 1.5 },
};

export const LINE_STYLE_PRESETS: Record<LineStylePresetId, LineStylePreset> = {
  classic,
  duotone,
  mono,
  vivid,
};

export const LINE_STYLE_PRESET_ORDER: LineStylePresetId[] = [
  "classic",
  "duotone",
  "mono",
  "vivid",
];

export const DEFAULT_LINE_STYLE_PRESET: LineStylePresetId = "classic";

export const LINE_STYLE_PRESET_META: Record<
  LineStylePresetId,
  { labelKey: DictKey; descriptionKey: DictKey }
> = {
  classic: {
    labelKey: "lineStyle.preset.classic.label",
    descriptionKey: "lineStyle.preset.classic.desc",
  },
  duotone: {
    labelKey: "lineStyle.preset.duotone.label",
    descriptionKey: "lineStyle.preset.duotone.desc",
  },
  mono: {
    labelKey: "lineStyle.preset.mono.label",
    descriptionKey: "lineStyle.preset.mono.desc",
  },
  vivid: {
    labelKey: "lineStyle.preset.vivid.label",
    descriptionKey: "lineStyle.preset.vivid.desc",
  },
};

const STORAGE_KEY = "tvs.lineStylePreset.v1";

export function loadLineStylePreset(): LineStylePresetId {
  if (typeof localStorage === "undefined") return DEFAULT_LINE_STYLE_PRESET;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && raw in LINE_STYLE_PRESETS) return raw as LineStylePresetId;
  } catch {}
  return DEFAULT_LINE_STYLE_PRESET;
}

export function saveLineStylePreset(id: LineStylePresetId) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {}
}

// ---- Per-line overrides ---------------------------------------------------
// Users can tweak color + width on top of a preset for the six prominent
// lines. Bands, paths and reference dashes stay preset-driven to keep the UI
// surface small. Overrides are stored globally (not per-preset) and re-applied
// whenever the active preset changes.

export type OverridableLineKey =
  | "mean"
  | "ev"
  | "best"
  | "worst"
  | "p05"
  | "p95";
export const OVERRIDABLE_LINE_KEYS: OverridableLineKey[] = [
  "mean",
  "ev",
  "best",
  "worst",
  "p05",
  "p95",
];

const OPTIONAL_LINE_KEYS: ReadonlySet<OverridableLineKey> = new Set([
  "p05",
  "p95",
]);

export function isOptionalLine(key: OverridableLineKey): boolean {
  return OPTIONAL_LINE_KEYS.has(key);
}

export function isLineEnabled(
  key: OverridableLineKey,
  overrides: LineStyleOverrides,
): boolean {
  const ov = overrides[key];
  if (ov?.enabled != null) return ov.enabled;
  return !OPTIONAL_LINE_KEYS.has(key);
}

export interface LineStyleOverride {
  stroke?: string;
  width?: number;
  enabled?: boolean;
}

export type LineStyleOverrides = Partial<
  Record<OverridableLineKey, LineStyleOverride>
>;

export function applyLineStyleOverrides(
  preset: LineStylePreset,
  overrides: LineStyleOverrides,
): LineStylePreset {
  const merge = (key: OverridableLineKey): LineStyle => {
    const base = preset[key];
    const ov = overrides[key];
    if (!ov) return base;
    return {
      stroke: ov.stroke ?? base.stroke,
      width: ov.width ?? base.width,
      dash: base.dash,
    };
  };
  return {
    ...preset,
    mean: merge("mean"),
    ev: merge("ev"),
    best: merge("best"),
    worst: merge("worst"),
    p05: merge("p05"),
    p95: merge("p95"),
  };
}

const OVERRIDES_STORAGE_KEY = "tvs.lineStyleOverrides.v1";

export function loadLineStyleOverrides(): LineStyleOverrides {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(OVERRIDES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as LineStyleOverrides;
    return {};
  } catch {
    return {};
  }
}

export function saveLineStyleOverrides(overrides: LineStyleOverrides) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(OVERRIDES_STORAGE_KEY, JSON.stringify(overrides));
  } catch {}
}

/**
 * Preset used for the secondary (PrimeDope-comparison) pane in twin mode —
 * always a distinct magenta so the two panes stay visually separable
 * regardless of which preset the user picks for their main chart. Not
 * user-selectable; not listed in LINE_STYLE_PRESET_ORDER.
 */
export const PRIMEDOPE_PANE_PRESET: LineStylePreset = {
  id: "classic",
  mean: { stroke: "#f472b6", width: 2.5 },
  ev: { stroke: "#fbbf24", width: 1.5 },
  best: { stroke: "#fbcfe8", width: 1.25 },
  worst: { stroke: "#fecdd3", width: 1.25 },
  p05: { stroke: "#f472b6", width: 1.75 },
  p95: { stroke: "#f472b6", width: 1.75 },
  path: { stroke: "rgba(236,72,153,0.24)", width: 1 },
  bandExtreme: { stroke: "rgba(236,72,153,0.10)", width: 1 },
  bandWide: { stroke: "rgba(236,72,153,0.20)", width: 1 },
  bandNarrow: { stroke: "rgba(236,72,153,0.38)", width: 1 },
  refLine: { stroke: "#64748b", width: 1, dash: [3, 4] },
  bankrollLine: { stroke: "#ef4444", width: 1.5 },
};
