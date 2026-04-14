export type LineStylePresetId = "h2n" | "pt4" | "hm3" | "pokerdope";

export interface LineStyle {
  stroke: string;
  width: number;
  dash?: number[];
}

export interface LineStylePreset {
  id: LineStylePresetId;
  label: string;
  /** Short human description — shown in the dropdown. */
  description: string;
  /** Main expected-profit curve (analogue of H2N "Won"). */
  mean: LineStyle;
  /** EV reference line (analogue of H2N "All-in EV"). */
  ev: LineStyle;
  /** Luckiest sample path. */
  best: LineStyle;
  /** Unluckiest sample path. */
  worst: LineStyle;
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

// Hand2Note default: thick solid green winnings, thin dashed yellow EV on top.
// EV line is intentionally thinner and dashed so it reads as a projection
// rather than a live run — matches the H2N "All-in EV" visual hierarchy.
const h2n: LineStylePreset = {
  id: "h2n",
  label: "Hand2Note",
  description: "Толстая зелёная линия выигрыша, тонкая пунктирная жёлтая EV сверху — как в H2N по дефолту.",
  mean: { stroke: "#34d399", width: 2.5 },
  ev: { stroke: "#fbbf24", width: 1.5, dash: [6, 4] },
  best: { stroke: "#86efac", width: 1.25 },
  worst: { stroke: "#fca5a5", width: 1.25 },
  path: { stroke: "rgba(148,163,184,0.25)", width: 1 },
  bandExtreme: { stroke: "rgba(52,211,153,0.14)", width: 1 },
  bandWide: { stroke: "rgba(52,211,153,0.24)", width: 1 },
  bandNarrow: { stroke: "rgba(52,211,153,0.42)", width: 1 },
  refLine: { stroke: "#64748b", width: 1, dash: [3, 4] },
  bankrollLine: { stroke: "#ef4444", width: 1.5, dash: [4, 4] },
};

const pt4: LineStylePreset = {
  id: "pt4",
  label: "PokerTracker 4",
  description: "PT4-style: насыщенная зелёная линия выигрыша и розовая EV, сплошные линии.",
  mean: { stroke: "#22c55e", width: 2.75 },
  ev: { stroke: "#ec4899", width: 2 },
  best: { stroke: "#bbf7d0", width: 1.25 },
  worst: { stroke: "#fecaca", width: 1.25 },
  path: { stroke: "rgba(148,163,184,0.22)", width: 1 },
  bandExtreme: { stroke: "rgba(34,197,94,0.12)", width: 1 },
  bandWide: { stroke: "rgba(34,197,94,0.22)", width: 1 },
  bandNarrow: { stroke: "rgba(34,197,94,0.40)", width: 1 },
  refLine: { stroke: "#94a3b8", width: 1, dash: [3, 4] },
  bankrollLine: { stroke: "#ef4444", width: 1.5, dash: [4, 4] },
};

const hm3: LineStylePreset = {
  id: "hm3",
  label: "Holdem Manager 3",
  description: "HM3-style: бирюзовая линия выигрыша и оранжевая пунктирная EV.",
  mean: { stroke: "#0ea5e9", width: 2.5 },
  ev: { stroke: "#f97316", width: 1.75, dash: [5, 3] },
  best: { stroke: "#7dd3fc", width: 1.25 },
  worst: { stroke: "#fdba74", width: 1.25 },
  path: { stroke: "rgba(148,163,184,0.22)", width: 1 },
  bandExtreme: { stroke: "rgba(14,165,233,0.12)", width: 1 },
  bandWide: { stroke: "rgba(14,165,233,0.22)", width: 1 },
  bandNarrow: { stroke: "rgba(14,165,233,0.40)", width: 1 },
  refLine: { stroke: "#94a3b8", width: 1, dash: [3, 4] },
  bankrollLine: { stroke: "#ef4444", width: 1.5, dash: [4, 4] },
};

const pokerdope: LineStylePreset = {
  id: "pokerdope",
  label: "PokerDope",
  description: "PokerDope-style: фиолетовая линия выигрыша и розовая тонкая EV, минималистичная палитра.",
  mean: { stroke: "#a78bfa", width: 2.5 },
  ev: { stroke: "#f472b6", width: 1.5, dash: [4, 3] },
  best: { stroke: "#e9d5ff", width: 1.25 },
  worst: { stroke: "#fbcfe8", width: 1.25 },
  path: { stroke: "rgba(148,163,184,0.22)", width: 1 },
  bandExtreme: { stroke: "rgba(167,139,250,0.10)", width: 1 },
  bandWide: { stroke: "rgba(167,139,250,0.20)", width: 1 },
  bandNarrow: { stroke: "rgba(167,139,250,0.36)", width: 1 },
  refLine: { stroke: "#64748b", width: 1, dash: [3, 4] },
  bankrollLine: { stroke: "#ef4444", width: 1.5, dash: [4, 4] },
};

export const LINE_STYLE_PRESETS: Record<LineStylePresetId, LineStylePreset> = {
  h2n,
  pt4,
  hm3,
  pokerdope,
};

export const LINE_STYLE_PRESET_ORDER: LineStylePresetId[] = [
  "h2n",
  "pt4",
  "hm3",
  "pokerdope",
];

export const DEFAULT_LINE_STYLE_PRESET: LineStylePresetId = "h2n";

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
// Users can tweak color + width on top of a preset for the four prominent
// lines. Bands, paths and reference dashes stay preset-driven to keep the UI
// surface small. Overrides are stored globally (not per-preset) and re-applied
// whenever the active preset changes.

export type OverridableLineKey = "mean" | "ev" | "best" | "worst";
export const OVERRIDABLE_LINE_KEYS: OverridableLineKey[] = [
  "mean",
  "ev",
  "best",
  "worst",
];

export interface LineStyleOverride {
  stroke?: string;
  width?: number;
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
 * Preset used for the secondary (PrimeDope) pane in twin mode — always a
 * distinct magenta so the two panes remain visually separable regardless
 * of which preset the user picks for their main chart.
 */
export const PRIMEDOPE_PANE_PRESET: LineStylePreset = {
  id: "h2n",
  label: "PrimeDope",
  description: "",
  mean: { stroke: "#f472b6", width: 2.5 },
  ev: { stroke: "#fbbf24", width: 1.5, dash: [6, 4] },
  best: { stroke: "#fbcfe8", width: 1.25 },
  worst: { stroke: "#fecdd3", width: 1.25 },
  path: { stroke: "rgba(236,72,153,0.24)", width: 1 },
  bandExtreme: { stroke: "rgba(236,72,153,0.10)", width: 1 },
  bandWide: { stroke: "rgba(236,72,153,0.20)", width: 1 },
  bandNarrow: { stroke: "rgba(236,72,153,0.38)", width: 1 },
  refLine: { stroke: "#64748b", width: 1, dash: [3, 4] },
  bankrollLine: { stroke: "#ef4444", width: 1.5, dash: [4, 4] },
};
