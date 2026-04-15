export type LineStylePresetId =
  | "hm"
  | "h2n"
  | "hm3"
  | "pt4"
  | "pokercraft"
  | "pokerdope";

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
  /** 5th-percentile trajectory — worst-case run at 95% confidence. */
  p05: LineStyle;
  /** 95th-percentile trajectory — best-case run at 95% confidence. */
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

// Per user mapping: `best` (luckiest sample path) is drawn like the tracker's
// "factual winnings" line — the bold saturated main curve. `worst` (unluckiest)
// is drawn like the tracker's "EV" line — thinner, often dashed, secondary
// color. `mean` stays as the expected-profit backbone in a neutral tone so the
// best/worst pair visually reads as Winnings-vs-EV the way a real report does.

// Holdem Manager 2: solid lime-green Net Won + thin blue dashed All-In EV Adj.
const hm: LineStylePreset = {
  id: "hm",
  label: "Holdem Manager 2",
  description: "Классический HM2: лаймовая Net Won и тонкая синяя пунктирная EV Adjusted.",
  mean: { stroke: "#94a3b8", width: 1.25, dash: [2, 3] },
  ev: { stroke: "#42a5f5", width: 1.75, dash: [5, 3] },
  best: { stroke: "#7cb342", width: 2.75 },
  worst: { stroke: "#42a5f5", width: 1.75, dash: [5, 3] },
  p05: { stroke: "#e57373", width: 1.5, dash: [5, 3] },
  p95: { stroke: "#9ccc65", width: 1.5, dash: [5, 3] },
  path: { stroke: "rgba(148,163,184,0.22)", width: 1 },
  bandExtreme: { stroke: "rgba(124,179,66,0.10)", width: 1 },
  bandWide: { stroke: "rgba(124,179,66,0.20)", width: 1 },
  bandNarrow: { stroke: "rgba(124,179,66,0.36)", width: 1 },
  refLine: { stroke: "#94a3b8", width: 1, dash: [3, 4] },
  bankrollLine: { stroke: "#ef4444", width: 1.5, dash: [4, 4] },
};

// Hand2Note: bold emerald Amount Won + thin yellow dashed All-In EV.
const h2n: LineStylePreset = {
  id: "h2n",
  label: "Hand2Note",
  description: "Толстая зелёная Amount Won и тонкая жёлтая пунктирная All-In EV — дефолт H2N.",
  mean: { stroke: "#94a3b8", width: 1.25, dash: [2, 3] },
  ev: { stroke: "#ffcc00", width: 1.75, dash: [6, 4] },
  best: { stroke: "#16a34a", width: 3 },
  worst: { stroke: "#ffcc00", width: 1.75, dash: [6, 4] },
  p05: { stroke: "#f87171", width: 1.5, dash: [5, 3] },
  p95: { stroke: "#4ade80", width: 1.5, dash: [5, 3] },
  path: { stroke: "rgba(148,163,184,0.25)", width: 1 },
  bandExtreme: { stroke: "rgba(22,163,74,0.10)", width: 1 },
  bandWide: { stroke: "rgba(22,163,74,0.20)", width: 1 },
  bandNarrow: { stroke: "rgba(22,163,74,0.36)", width: 1 },
  refLine: { stroke: "#64748b", width: 1, dash: [3, 4] },
  bankrollLine: { stroke: "#ef4444", width: 1.5, dash: [4, 4] },
};

// Holdem Manager 3: fresh green Net Winnings + solid blue All-In EV on dark.
const hm3: LineStylePreset = {
  id: "hm3",
  label: "Holdem Manager 3",
  description: "HM3: зелёная Net Winnings и синяя All-In EV — на тёмном фоне.",
  mean: { stroke: "#94a3b8", width: 1.25, dash: [2, 3] },
  ev: { stroke: "#4a90e2", width: 2 },
  best: { stroke: "#61c454", width: 2.75 },
  worst: { stroke: "#4a90e2", width: 2 },
  p05: { stroke: "#f5a623", width: 1.5, dash: [5, 3] },
  p95: { stroke: "#61c454", width: 1.5, dash: [5, 3] },
  path: { stroke: "rgba(148,163,184,0.22)", width: 1 },
  bandExtreme: { stroke: "rgba(97,196,84,0.10)", width: 1 },
  bandWide: { stroke: "rgba(97,196,84,0.20)", width: 1 },
  bandNarrow: { stroke: "rgba(97,196,84,0.36)", width: 1 },
  refLine: { stroke: "#94a3b8", width: 1, dash: [3, 4] },
  bankrollLine: { stroke: "#ef4444", width: 1.5, dash: [4, 4] },
};

// PokerTracker 4: green BB Won + YELLOW Net Expected (not red — red is
// non-showdown in PT4, often mistaken for EV).
const pt4: LineStylePreset = {
  id: "pt4",
  label: "PokerTracker 4",
  description: "PT4: зелёная Net Won и жёлтая Net Expected (All-In Adjusted).",
  mean: { stroke: "#94a3b8", width: 1.25, dash: [2, 3] },
  ev: { stroke: "#fbc02d", width: 2 },
  best: { stroke: "#00a651", width: 2.75 },
  worst: { stroke: "#fbc02d", width: 2 },
  p05: { stroke: "#ed1c24", width: 1.5, dash: [5, 3] },
  p95: { stroke: "#00a651", width: 1.5, dash: [5, 3] },
  path: { stroke: "rgba(148,163,184,0.22)", width: 1 },
  bandExtreme: { stroke: "rgba(0,166,81,0.10)", width: 1 },
  bandWide: { stroke: "rgba(0,166,81,0.20)", width: 1 },
  bandNarrow: { stroke: "rgba(0,166,81,0.36)", width: 1 },
  refLine: { stroke: "#94a3b8", width: 1, dash: [3, 4] },
  bankrollLine: { stroke: "#ef4444", width: 1.5, dash: [4, 4] },
};

// GG PokerCraft: green Total Winnings + yellow All-In Adjusted on dark bg.
const pokercraft: LineStylePreset = {
  id: "pokercraft",
  label: "PokerCraft (GG)",
  description: "PokerCraft (GGPoker): зелёная Total Winnings и жёлтая All-In Adjusted на тёмном.",
  mean: { stroke: "#94a3b8", width: 1.25, dash: [2, 3] },
  ev: { stroke: "#fde047", width: 2 },
  best: { stroke: "#4ade80", width: 2.75 },
  worst: { stroke: "#fde047", width: 2 },
  p05: { stroke: "#fb923c", width: 1.5, dash: [5, 3] },
  p95: { stroke: "#4ade80", width: 1.5, dash: [5, 3] },
  path: { stroke: "rgba(148,163,184,0.22)", width: 1 },
  bandExtreme: { stroke: "rgba(74,222,128,0.10)", width: 1 },
  bandWide: { stroke: "rgba(74,222,128,0.20)", width: 1 },
  bandNarrow: { stroke: "rgba(74,222,128,0.36)", width: 1 },
  refLine: { stroke: "#94a3b8", width: 1, dash: [3, 4] },
  bankrollLine: { stroke: "#ef4444", width: 1.5, dash: [4, 4] },
};

// PokerDope / Primedope variance calculator: BLACK straight EV line, chunky
// light-green 70% CI curve and darker green 95% CI curve. No dashes — PD's
// signature look is fat solid lines, hence the user's "прям всратые жирные".
const pokerdope: LineStylePreset = {
  id: "pokerdope",
  label: "PokerDope",
  description: "PokerDope/Primedope: чёрная прямая EV и жирные зелёные доверительные кривые.",
  mean: { stroke: "#0f172a", width: 2.5 },
  ev: { stroke: "#0f172a", width: 2.5 },
  best: { stroke: "#86efac", width: 3.25 },
  worst: { stroke: "#0f172a", width: 2.5 },
  p05: { stroke: "#2e7d32", width: 3, dash: [6, 4] },
  p95: { stroke: "#2e7d32", width: 3, dash: [6, 4] },
  path: { stroke: "rgba(148,163,184,0.18)", width: 1 },
  bandExtreme: { stroke: "rgba(134,239,172,0.18)", width: 1 },
  bandWide: { stroke: "rgba(134,239,172,0.32)", width: 1 },
  bandNarrow: { stroke: "rgba(46,125,50,0.42)", width: 1 },
  refLine: { stroke: "#64748b", width: 1, dash: [3, 4] },
  bankrollLine: { stroke: "#ef4444", width: 1.5, dash: [4, 4] },
};

export const LINE_STYLE_PRESETS: Record<LineStylePresetId, LineStylePreset> = {
  hm,
  h2n,
  hm3,
  pt4,
  pokercraft,
  pokerdope,
};

export const LINE_STYLE_PRESET_ORDER: LineStylePresetId[] = [
  "hm",
  "h2n",
  "hm3",
  "pt4",
  "pokercraft",
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

/**
 * Lines that are hidden by default and opt-in via the customizer.
 * p05/p95 envelope lines aren't part of the tracker-style default visuals —
 * we only draw them when the user explicitly enables them.
 */
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
  /**
   * Optional visibility toggle. Undefined = preset default
   * (optional lines default off, all others default on).
   */
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
  p05: { stroke: "#f472b6", width: 1.5, dash: [5, 3] },
  p95: { stroke: "#fbcfe8", width: 1.5, dash: [5, 3] },
  path: { stroke: "rgba(236,72,153,0.24)", width: 1 },
  bandExtreme: { stroke: "rgba(236,72,153,0.10)", width: 1 },
  bandWide: { stroke: "rgba(236,72,153,0.20)", width: 1 },
  bandNarrow: { stroke: "rgba(236,72,153,0.38)", width: 1 },
  refLine: { stroke: "#64748b", width: 1, dash: [3, 4] },
  bankrollLine: { stroke: "#ef4444", width: 1.5, dash: [4, 4] },
};
