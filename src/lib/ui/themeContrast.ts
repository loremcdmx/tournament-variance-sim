import { FORMAT_TAB_ACCENTS } from "@/components/charts/formatTabAccents";

/**
 * Contrast contract for the status colours in `globals.css`.
 *
 * Status text sits on dark-tuned tints. A Tailwind palette class
 * (`text-amber-200`) has no light value, so the light theme drew it at
 * 1.1-2:1 on a pale card. Every status colour now comes from a `--c-*` token
 * with a value in both theme blocks; this module reads those blocks and
 * measures each (token, surface) pair the components actually use.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Rgba extends Rgb {
  a: number;
}

export type ThemeName = "dark" | "light";
export type ThemeTokens = Record<string, string>;
export type Palette = Record<string, Rgb>;

const BLOCK_BODY = String.raw`\{([^}]*)\}`;
const DARK_BLOCK = new RegExp(String.raw`:root,\s*:root\[data-theme="dark"\]\s*` + BLOCK_BODY);
const LIGHT_BLOCK = new RegExp(String.raw`:root\[data-theme="light"\]\s*` + BLOCK_BODY);

function declarations(block: string): ThemeTokens {
  const out: ThemeTokens = {};
  const withoutComments = block.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of withoutComments.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

export function parseThemeTokens(css: string): Record<ThemeName, ThemeTokens> {
  const dark = DARK_BLOCK.exec(css);
  const light = LIGHT_BLOCK.exec(css);
  if (!dark || !light) throw new Error("globals.css: theme blocks not found");
  return { dark: declarations(dark[1]), light: declarations(light[1]) };
}

function oklchToRgb(L: number, C: number, hDeg: number): Rgb {
  const a = C * Math.cos((hDeg * Math.PI) / 180);
  const b = C * Math.sin((hDeg * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  const gamma = (x: number) =>
    x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  const [r, g, bl] = lin.map((x) => gamma(clamp(x)));
  return { r, g, b: bl };
}

const NUM = String.raw`(-?[\d.]+)`;

/** Parses the colour notations the theme uses: #rrggbb, oklch(), rgba() and
 *  `color-mix(in oklab, <colour> N%, transparent)`, which is how Tailwind
 *  writes an opacity modifier. */
export function parseColor(value: string): Rgba {
  const v = value.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 };
  }
  const oklch = new RegExp(String.raw`^oklch\(\s*${NUM}%\s+${NUM}\s+${NUM}\s*\)$`).exec(v);
  if (oklch) return { ...oklchToRgb(+oklch[1] / 100, +oklch[2], +oklch[3]), a: 1 };
  const rgba = new RegExp(
    String.raw`^rgba\(\s*${NUM}\s*,\s*${NUM}\s*,\s*${NUM}\s*,\s*${NUM}\s*\)$`,
  ).exec(v);
  if (rgba) return { r: +rgba[1] / 255, g: +rgba[2] / 255, b: +rgba[3] / 255, a: +rgba[4] };
  const mix = /^color-mix\(\s*in oklab\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*transparent\s*\)$/.exec(v);
  if (mix) {
    const inner = parseColor(mix[1]);
    return { ...inner, a: inner.a * (+mix[2] / 100) };
  }
  throw new Error(`unsupported colour: ${value}`);
}

export function parsePalette(tailwindThemeCss: string): Palette {
  const out: Palette = {};
  for (const m of tailwindThemeCss.matchAll(
    /--color-([a-z]+-\d+):\s*(oklch\([^)]*\));/g,
  )) {
    const { r, g, b } = parseColor(m[2]);
    out[m[1]] = { r, g, b };
  }
  return out;
}

export function over(fg: Rgba, bg: Rgb, alpha = 1): Rgb {
  const a = fg.a * alpha;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
  };
}

function luminance(c: Rgb): number {
  const lin = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** One painted layer under the text: a Tailwind palette colour (the tint
 *  classes keep their palette values in both themes), a theme token, or a
 *  literal CSS colour, composited at `alpha`. */
export interface SurfaceLayer {
  palette?: string;
  token?: string;
  css?: string;
  alpha?: number;
}

export interface StatusSite {
  id: string;
  where: string;
  fg: { token: string; alpha?: number };
  /** `card` is `bg-elev/60` over the page, which is what `Card` paints. */
  base: "card" | "page";
  layers?: SurfaceLayer[];
  /** Defaults to 4.5. Lower only for a colour that was already below it before
   *  the token existed and that the dark theme must keep as it was. */
  minRatio?: number;
}

export const MIN_TEXT_CONTRAST = 4.5;

const emerald5: SurfaceLayer = { palette: "emerald-500", alpha: 0.05 };
const amber5: SurfaceLayer = { palette: "amber-400", alpha: 0.05 };
const rosePanelRow: SurfaceLayer = { token: "--c-bad-panel-bg", alpha: 0.4 };
const roseBanner: SurfaceLayer = { token: "--c-bad-panel-bg", alpha: 0.85 };
const roseBannerEnd: SurfaceLayer = { token: "--c-bad-panel-bg-2", alpha: 0.7 };
const roseButton: SurfaceLayer = { token: "--c-bad-panel-bg", alpha: 0.55 };
const roseButtonHover: SurfaceLayer = { token: "--c-bad-panel-bg-2", alpha: 0.65 };

export const STATUS_SITES: StatusSite[] = [
  // ControlsPanel: DoneSummaryBlock
  { id: "done label", where: "ControlsPanel DoneSummaryBlock", fg: { token: "--c-ok-fg" }, base: "card", layers: [{ palette: "emerald-500", alpha: 0.05 }] },
  { id: "done see-below hover", where: "ControlsPanel DoneSummaryBlock", fg: { token: "--c-ok-fg-soft" }, base: "card", layers: [emerald5] },
  { id: "done profit/ROI loss", where: "ControlsPanel DoneSummaryBlock", fg: { token: "--c-bad-fg" }, base: "card", layers: [emerald5] },
  { id: "done dry streak", where: "ControlsPanel DoneSummaryBlock", fg: { token: "--c-warn-fg" }, base: "card", layers: [emerald5] },
  // ControlsPanel: other
  { id: "memory hint", where: "ControlsPanel", fg: { token: "--c-warn-fg" }, base: "card", layers: [{ palette: "amber-500", alpha: 0.1 }] },
  { id: "reference-shape note", where: "ControlsPanel", fg: { token: "--c-warn-label" }, base: "card" },
  { id: "blocked run button title", where: "ControlsPanel", fg: { token: "--c-bad-panel-fg" }, base: "card", layers: [roseButton] },
  { id: "blocked run button hover", where: "ControlsPanel", fg: { token: "--c-bad-panel-fg" }, base: "card", layers: [roseButtonHover] },
  { id: "blocked run button subtitle", where: "ControlsPanel", fg: { token: "--c-bad-panel-fg-3", alpha: 0.8 }, base: "card", layers: [roseButton] },
  // page.tsx
  { id: "feasibility banner title (gradient start)", where: "page", fg: { token: "--c-bad-panel-fg" }, base: "page", layers: [roseBanner] },
  { id: "feasibility banner title (gradient end)", where: "page", fg: { token: "--c-bad-panel-fg" }, base: "page", layers: [roseBannerEnd] },
  { id: "feasibility banner hint (gradient start)", where: "page", fg: { token: "--c-bad-panel-fg-2", alpha: 0.85 }, base: "page", layers: [roseBanner] },
  { id: "feasibility banner hint (gradient end)", where: "page", fg: { token: "--c-bad-panel-fg-2", alpha: 0.85 }, base: "page", layers: [roseBannerEnd] },
  { id: "feasibility banner count (gradient start)", where: "page", fg: { token: "--c-bad-panel-fg-3", alpha: 0.9 }, base: "page", layers: [roseBanner] },
  { id: "feasibility banner count (gradient end)", where: "page", fg: { token: "--c-bad-panel-fg-3", alpha: 0.9 }, base: "page", layers: [roseBannerEnd] },
  { id: "feasibility banner badge", where: "page", fg: { token: "--c-bad-panel-fg-2" }, base: "page", layers: [roseBanner, { palette: "rose-500", alpha: 0.3 }] },
  { id: "feasibility banner button", where: "page", fg: { token: "--c-bad-panel-fg" }, base: "page", layers: [roseBanner, { palette: "rose-500", alpha: 0.3 }] },
  { id: "sanity badge", where: "page", fg: { token: "--c-warn-fg-strong" }, base: "card", layers: [amber5, { palette: "amber-400", alpha: 0.3 }] },
  { id: "run error box", where: "page, CashApp", fg: { token: "--c-err-fg" }, base: "page", layers: [{ palette: "red-500", alpha: 0.1 }] },
  // ScheduleEditor
  { id: "payout select, disabled structure", where: "ScheduleEditor", fg: { token: "--c-bad-fg" }, base: "card", layers: [{ palette: "rose-500", alpha: 0.1 }] },
  { id: "row banner title", where: "ScheduleEditor", fg: { token: "--c-bad-panel-fg" }, base: "card", layers: [rosePanelRow] },
  { id: "row banner mark", where: "ScheduleEditor", fg: { token: "--c-bad-fg" }, base: "card", layers: [rosePanelRow] },
  { id: "row banner detail", where: "ScheduleEditor", fg: { token: "--c-bad-panel-fg-3", alpha: 0.8 }, base: "card", layers: [rosePanelRow] },
  { id: "row banner strong button", where: "ScheduleEditor", fg: { token: "--c-bad-panel-fg" }, base: "card", layers: [rosePanelRow, { palette: "rose-500", alpha: 0.25 }] },
  { id: "row banner strong button hover", where: "ScheduleEditor", fg: { token: "--c-bad-panel-fg" }, base: "card", layers: [rosePanelRow, { palette: "rose-500", alpha: 0.4 }] },
  { id: "row banner soft button", where: "ScheduleEditor", fg: { token: "--c-bad-panel-fg" }, base: "card", layers: [rosePanelRow, { palette: "rose-500", alpha: 0.15 }] },
  { id: "row banner soft button hover", where: "ScheduleEditor", fg: { token: "--c-bad-panel-fg" }, base: "card", layers: [rosePanelRow, { palette: "rose-500", alpha: 0.3 }] },
  // ConvergenceChart
  { id: "tournaments pill", where: "ConvergenceChart RangeBandValue", fg: { token: "--c-info-fg" }, base: "card", layers: [{ palette: "sky-300", alpha: 0.15 }] },
  { id: "exact box text", where: "ConvergenceChart", fg: { token: "--c-ok-fg-soft" }, base: "card", layers: [{ palette: "emerald-400", alpha: 0.05 }] },
  { id: "exact box value", where: "ConvergenceChart", fg: { token: "--c-ok-fg-strong" }, base: "card", layers: [{ palette: "emerald-400", alpha: 0.05 }] },
  { id: "out-of-box / noise warning", where: "ConvergenceChart", fg: { token: "--c-warn-fg-soft" }, base: "card", layers: [{ palette: "amber-400", alpha: 0.05 }] },
  { id: "ocean-ko upper-bound note", where: "ConvergenceChart, ProveEdgeCard", fg: { token: "--c-ocean-fg" }, base: "card" },
  { id: "AFS label", where: "ConvergenceChart, ProveEdgeCard", fg: { token: "--c-ok-label" }, base: "card" },
  { id: "ROI label", where: "ConvergenceChart", fg: { token: "--c-warn-label" }, base: "card" },
  { id: "rake label", where: "ConvergenceChart, ProveEdgeCard", fg: { token: "--c-orange-label" }, base: "card" },
  { id: "CI / mix freeze label", where: "ConvergenceChart, ProveEdgeCard", fg: { token: "--c-info-label" }, base: "card" },
  { id: "mix PKO label", where: "ConvergenceChart", fg: { token: "--c-fuchsia-label" }, base: "card" },
  { id: "mix Mystery label", where: "ConvergenceChart", fg: { token: "--c-purple-label" }, base: "card" },
  { id: "exact breakdown heading", where: "ConvergenceChart", fg: { token: "--c-ok-label" }, base: "card" },
  { id: "var-share card label", where: "ConvergenceChart", fg: { token: "--c-ok-label-soft" }, base: "card", layers: [{ palette: "emerald-400", alpha: 0.1 }] },
  { id: "var-share card value", where: "ConvergenceChart", fg: { token: "--c-ok-fg-soft" }, base: "card", layers: [{ palette: "emerald-400", alpha: 0.1 }] },
  { id: "var-share table cell", where: "ConvergenceChart", fg: { token: "--c-ok-fg" }, base: "card" },
  // ProveEdgeCard / StatCards / diagnostics / results
  { id: "prove-edge warning", where: "ProveEdgeCard", fg: { token: "--c-warn-fg-soft", alpha: 0.95 }, base: "card", layers: [{ palette: "amber-400", alpha: 0.05 }] },
  { id: "thin-sample pill", where: "StatCards", fg: { token: "--c-warn-fg-soft", alpha: 0.85 }, base: "card", layers: [{ palette: "amber-400", alpha: 0.1 }] },
  { id: "PD match label", where: "StatCards", fg: { token: "--c-pd-fg" }, base: "card", layers: [{ css: "rgba(232,121,249,0.14)" }] },
  { id: "PD match precision", where: "StatCards", fg: { token: "--c-pd-fg" }, base: "card", layers: [{ css: "rgba(232,121,249,0.1)" }] },
  { id: "PD delta, matching", where: "StatCards", fg: { token: "--c-pd-delta-fg" }, base: "card", layers: [{ css: "rgba(232,121,249,0.1)" }], minRatio: 4 },
  { id: "PD table, comparison column", where: "PrimedopeDiagnostics", fg: { token: "--c-pd-theirs-fg" }, base: "card" },
  { id: "calibration notice", where: "PrimedopeDiagnostics", fg: { token: "--c-warn-fg-soft" }, base: "card", layers: [{ palette: "amber-500", alpha: 0.1 }] },
  { id: "diagnostics note", where: "PrimedopeDiagnostics", fg: { token: "--c-warn-label" }, base: "card" },
  { id: "heavy-tail badge", where: "ResultsPanels", fg: { token: "--c-warn-label" }, base: "card" },
  { id: "hide-jackpots label", where: "ResultsView", fg: { token: "--c-warn-label" }, base: "card" },
  { id: "rakeback label", where: "ResultsView", fg: { token: "--c-lime-label" }, base: "card" },
  { id: "recomputing label", where: "ResultsView", fg: { token: "--c-indigo-label" }, base: "card" },
  { id: "leaderboard cashflow label", where: "ResultsView", fg: { token: "--c-cyan-label" }, base: "card" },
];

export function tabSites(): StatusSite[] {
  return (Object.keys(FORMAT_TAB_ACCENTS) as (keyof typeof FORMAT_TAB_ACCENTS)[]).map(
    (format) => {
      const accent = FORMAT_TAB_ACCENTS[format];
      const token = /^var\((--[a-z0-9-]+)\)$/.exec(accent.text)?.[1] ?? accent.text;
      return {
        id: `format tab "${format}"`,
        where: "ConvergenceChart tabs",
        fg: { token },
        base: "card",
        layers: [{ token: "--c-bg-elev", alpha: 0.8 }, { css: accent.bg }],
      } satisfies StatusSite;
    },
  );
}

/** Tokens whose dark value must stay the exact Tailwind shade the component
 *  used before the token existed, so the dark theme does not move. */
export const DARK_PARITY: Record<string, { shade?: string; css?: string; alpha?: number }> = {
  "--c-ok-fg": { shade: "emerald-300" },
  "--c-ok-fg-soft": { shade: "emerald-200" },
  "--c-ok-fg-strong": { shade: "emerald-100" },
  "--c-ok-label": { shade: "emerald-400", alpha: 0.8 },
  "--c-ok-label-soft": { shade: "emerald-200", alpha: 0.8 },
  "--c-warn-fg": { shade: "amber-300" },
  "--c-warn-fg-soft": { shade: "amber-200" },
  "--c-warn-fg-strong": { shade: "amber-100" },
  "--c-warn-label": { shade: "amber-400", alpha: 0.8 },
  "--c-bad-fg": { shade: "rose-300" },
  "--c-err-fg": { shade: "red-300" },
  "--c-bad-panel-bg": { shade: "rose-950" },
  "--c-bad-panel-bg-2": { shade: "rose-900" },
  "--c-bad-panel-fg": { shade: "rose-50" },
  "--c-bad-panel-fg-2": { shade: "rose-100" },
  "--c-bad-panel-fg-3": { shade: "rose-200" },
  "--c-info-fg": { shade: "sky-200" },
  "--c-info-label": { shade: "sky-400", alpha: 0.8 },
  "--c-ocean-fg": { shade: "teal-300" },
  "--c-orange-label": { shade: "orange-400", alpha: 0.8 },
  "--c-fuchsia-label": { shade: "fuchsia-400", alpha: 0.8 },
  "--c-purple-label": { shade: "purple-400", alpha: 0.8 },
  "--c-lime-label": { shade: "lime-400", alpha: 0.8 },
  "--c-indigo-label": { shade: "indigo-300", alpha: 0.8 },
  "--c-cyan-label": { shade: "cyan-300", alpha: 0.8 },
  "--c-pd-fg": { css: "#f0abfc" },
  "--c-pd-delta-fg": { css: "rgba(232,121,249,0.75)" },
  "--c-pd-theirs-fg": { css: "#60a5fa" },
};

export interface SiteResult {
  id: string;
  where: string;
  token: string;
  theme: ThemeName;
  fg: Rgb;
  bg: Rgb;
  ratio: number;
  min: number;
}

function tokenColor(tokens: ThemeTokens, name: string): Rgba {
  const raw = tokens[name];
  if (raw === undefined) throw new Error(`token ${name} is not defined`);
  return parseColor(raw);
}

export function evaluateSite(
  site: StatusSite,
  theme: ThemeName,
  tokens: ThemeTokens,
  palette: Palette,
): SiteResult {
  const page = tokenColor(tokens, "--c-bg");
  const pageRgb: Rgb = { r: page.r, g: page.g, b: page.b };
  let bg: Rgb =
    site.base === "page" ? pageRgb : over(tokenColor(tokens, "--c-bg-elev"), pageRgb, 0.6);
  for (const layer of site.layers ?? []) {
    let colour: Rgba;
    if (layer.palette !== undefined) {
      const p = palette[layer.palette];
      if (!p) throw new Error(`palette colour ${layer.palette} not found`);
      colour = { ...p, a: 1 };
    } else if (layer.token !== undefined) {
      colour = tokenColor(tokens, layer.token);
    } else if (layer.css !== undefined) {
      colour = parseColor(layer.css);
    } else {
      throw new Error("empty surface layer");
    }
    bg = over(colour, bg, layer.alpha ?? 1);
  }
  const fg = over(tokenColor(tokens, site.fg.token), bg, site.fg.alpha ?? 1);
  return {
    id: site.id,
    where: site.where,
    token: site.fg.token,
    theme,
    fg,
    bg,
    ratio: contrastRatio(fg, bg),
    min: site.minRatio ?? MIN_TEXT_CONTRAST,
  };
}

/** Every site on the surface it is drawn on, plus the same site on the bare
 *  page colour: the darkest ordinary light surface, so a card whose fill turns
 *  out slightly darker than `bg-elev/60` still holds. */
export function evaluateAllSites(
  themes: Record<ThemeName, ThemeTokens>,
  palette: Palette,
): SiteResult[] {
  const out: SiteResult[] = [];
  for (const theme of ["light", "dark"] as const) {
    for (const site of [...STATUS_SITES, ...tabSites()]) {
      out.push(evaluateSite(site, theme, themes[theme], palette));
      if (site.base === "card") {
        const onPage: StatusSite = { ...site, base: "page", id: `${site.id} (on page colour)` };
        out.push(evaluateSite(onPage, theme, themes[theme], palette));
      }
    }
  }
  return out;
}
