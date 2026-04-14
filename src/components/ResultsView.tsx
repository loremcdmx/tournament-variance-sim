"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ReactEventHandler,
} from "react";
import type { SimulationResult, TournamentRow } from "@/lib/sim/types";
import { useT, useLocale } from "@/lib/i18n/LocaleProvider";
import type { DictKey } from "@/lib/i18n/dict";
import { STANDARD_PRESETS } from "@/lib/sim/modelPresets";
import {
  DEFAULT_LINE_STYLE_PRESET,
  LINE_STYLE_PRESETS,
  LINE_STYLE_PRESET_ORDER,
  OVERRIDABLE_LINE_KEYS,
  PRIMEDOPE_PANE_PRESET,
  applyLineStyleOverrides,
  loadLineStylePreset,
  loadLineStyleOverrides,
  saveLineStylePreset,
  saveLineStyleOverrides,
  type LineStylePreset,
  type LineStylePresetId,
  type LineStyleOverrides,
  type OverridableLineKey,
} from "@/lib/lineStyles";
import type { ControlsState } from "./ControlsPanel";
import { UplotChart } from "./charts/UplotChart";
import { DistributionChart } from "./charts/DistributionChart";
import { ConvergenceChart } from "./charts/ConvergenceChart";
import { DecompositionChart } from "./charts/DecompositionChart";
import { SensitivityChart } from "./charts/SensitivityChart";
import { Card } from "./ui/Section";
import { InfoTooltip } from "./ui/Tooltip";
import type { AlignedData, Options } from "uplot";

interface Props {
  result: SimulationResult;
  compareResult?: SimulationResult | null;
  bankroll?: number;
  schedule?: TournamentRow[];
  scheduleRepeats?: number;
  compareMode?: "random" | "primedope";
  modelPresetId?: string;
  finishModelId?: string;
  settings?: ControlsState;
  elapsedMs?: number | null;
}

function buildSettingsSummary(c: ControlsState | undefined): string | null {
  if (!c) return null;
  const parts: string[] = [];
  parts.push(c.alphaOverride == null ? "α=auto" : `α=${c.alphaOverride.toFixed(2)}`);
  if (c.roiStdErr > 0) parts.push(`σROI=${(c.roiStdErr * 100).toFixed(1)}%`);
  if (c.roiShockPerTourney > 0) parts.push(`shock/t=${(c.roiShockPerTourney * 100).toFixed(1)}%`);
  if (c.roiShockPerSession > 0) parts.push(`shock/s=${(c.roiShockPerSession * 100).toFixed(1)}%`);
  if (c.roiDriftSigma > 0) parts.push(`drift=${(c.roiDriftSigma * 100).toFixed(1)}%`);
  if (c.tiltFastGain !== 0) parts.push(`tilt-fast=${(c.tiltFastGain * 100).toFixed(0)}%`);
  if (c.tiltSlowGain !== 0) parts.push(`tilt-slow=${(c.tiltSlowGain * 100).toFixed(0)}%`);
  return parts.join(" · ");
}

function fmt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

const compactMoney = (v: number) => {
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  if (abs === 0) return "$0";
  return `${sign}$${abs.toFixed(0)}`;
};
const money = (v: number) => {
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

// Unit-aware money formatters. The module-level `money` / `compactMoney`
// defined above stay as the USD defaults; the Context lets ResultsView
// swap them for ABI-denominated versions without threading props through
// every helper card.
function makeAbiMoney(abi: number) {
  const safe = abi > 0 ? abi : 1;
  const fmt = (v: number, digits: number) => {
    const sign = v < 0 ? "−" : "";
    const n = Math.abs(v) / safe;
    return `${sign}${n.toFixed(digits)} ABI`;
  };
  return {
    money: (v: number) => fmt(v, Math.abs(v) / safe >= 100 ? 0 : 1),
    compactMoney: (v: number) => {
      const sign = v < 0 ? "−" : "";
      const n = Math.abs(v) / safe;
      if (n >= 1000) return `${sign}${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k ABI`;
      if (n >= 100) return `${sign}${n.toFixed(0)} ABI`;
      if (n === 0) return "0 ABI";
      return `${sign}${n.toFixed(1)} ABI`;
    },
  };
}

interface MoneyFmt {
  money: (v: number) => string;
  compactMoney: (v: number) => string;
}

const defaultMoneyFmt: MoneyFmt = { money, compactMoney };
const MoneyFmtContext = createContext<MoneyFmt>(defaultMoneyFmt);
const useMoneyFmt = () => useContext(MoneyFmtContext);
const intFmt = (v: number) =>
  v.toLocaleString(undefined, { maximumFractionDigits: 0 });

type AccentHue = "felt" | "magenta";

const HUES: Record<AccentHue, {
  mean: string;
  p0015: string;
  p025: string;
  p15: string;
  paths: string;
}> = {
  felt: {
    mean: "#34d399",
    p0015: "rgba(16,185,129,0.10)",
    p025: "rgba(16,185,129,0.20)",
    p15: "rgba(16,185,129,0.38)",
    paths: "rgba(148,163,184,0.25)",
  },
  magenta: {
    mean: "#f472b6",
    p0015: "rgba(236,72,153,0.08)",
    p025: "rgba(236,72,153,0.18)",
    p15: "rgba(236,72,153,0.34)",
    paths: "rgba(236,72,153,0.24)",
  },
};


export interface RefLineSpec {
  roi: number;
  label: string;
  color: string;
}

export interface RefLineConfig extends RefLineSpec {
  enabled: boolean;
}

const DEFAULT_REF_LINES: RefLineConfig[] = [
  { roi: -1.0, label: "ROI −100%", color: "#dc2626", enabled: true },
  { roi: -0.2, label: "ROI −20%", color: "#fb923c", enabled: true },
  { roi: 0.2, label: "ROI +20%", color: "#a3e635", enabled: true },
  { roi: 0.5, label: "ROI +50%", color: "#22d3ee", enabled: true },
];

const REF_LINES_STORAGE_KEY = "tvs.refLines.v1";

function loadRefLines(): RefLineConfig[] {
  if (typeof localStorage === "undefined") return DEFAULT_REF_LINES;
  try {
    const raw = localStorage.getItem(REF_LINES_STORAGE_KEY);
    if (!raw) return DEFAULT_REF_LINES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_REF_LINES;
    return parsed
      .filter(
        (r): r is RefLineConfig =>
          r &&
          typeof r.roi === "number" &&
          Number.isFinite(r.roi) &&
          typeof r.label === "string" &&
          typeof r.color === "string" &&
          typeof r.enabled === "boolean",
      )
      .slice(0, 16);
  } catch {
    return DEFAULT_REF_LINES;
  }
}

function saveRefLines(v: RefLineConfig[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(REF_LINES_STORAGE_KEY, JSON.stringify(v));
  } catch {}
}

function roiLabel(roi: number): string {
  const pct = Math.round(roi * 100);
  if (pct === 0) return "ROI 0%";
  const sign = pct > 0 ? "+" : "−";
  return `ROI ${sign}${Math.abs(pct)}%`;
}

function buildRefLine(x: ArrayLike<number>, slopePerX: number): Float64Array {
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] * slopePerX;
  return out;
}

function TrajectoryPlot({
  assets,
  height,
}: {
  assets: ReturnType<typeof buildTrajectoryAssets>;
  height: number;
}) {
  const { compactMoney } = useMoneyFmt();
  const [cursor, setCursor] = useState<{
    idx: number;
    left: number;
    top: number;
    valY: number;
  } | null>(null);
  const xs = assets.data[0] as ArrayLike<number>;
  const idx = cursor?.idx;
  const tournaments = idx != null ? Math.round(xs[idx] ?? 0) : 0;

  let nearest: TrajectoryLineMeta | null = null;
  let nearestVal = 0;
  if (cursor && idx != null) {
    let bestDist = Infinity;
    for (const line of assets.mainLines) {
      const arr = assets.data[line.seriesIdx] as ArrayLike<number> | undefined;
      if (!arr) continue;
      const v = arr[idx];
      if (v == null || !Number.isFinite(v)) continue;
      const d = Math.abs(v - cursor.valY);
      if (d < bestDist) {
        bestDist = d;
        nearest = line;
        nearestVal = v;
      }
    }
  }

  const cumBuyIn = tournaments * assets.buyInPerTourney;
  const roi = cumBuyIn > 0 ? nearestVal / cumBuyIn : 0;

  const kindLabel = (k: TrajectoryLineMeta["kind"]): string => {
    switch (k) {
      case "mean": return "expected (mean)";
      case "band": return "percentile band";
      case "best": return "luckiest sim";
      case "worst": return "unluckiest sim";
      case "path": return "individual sim";
      case "ref": return "ROI reference";
    }
  };
  const likelihood = (line: TrajectoryLineMeta): string | null => {
    if (line.kind === "ref") return null;
    if (line.kind === "path") return "1 of N sample paths";
    if (line.kind === "best") return "≈ top 1/N sims";
    if (line.kind === "worst") return "≈ bottom 1/N sims";
    if (line.percentile != null) {
      const pct = line.percentile;
      if (pct === 0.5) return "50% above / 50% below";
      const tail = pct < 0.5 ? pct : 1 - pct;
      const side = pct < 0.5 ? "below" : "above";
      return `~${(tail * 100).toFixed(2)}% of runs ${side} this`;
    }
    return null;
  };

  return (
    <div className="relative w-full">
      <UplotChart
        data={assets.data}
        options={assets.opts}
        height={height}
        onCursor={setCursor}
      />
      {cursor && idx != null && nearest && (
        <div
          className="pointer-events-none absolute z-10 min-w-[200px] rounded border border-[color:var(--color-border-strong)] bg-[color:var(--color-bg)]/95 px-3 py-2 text-[11px] shadow-xl backdrop-blur"
          style={{
            left: Math.min(cursor.left + 12, 9999),
            top: 8,
          }}
        >
          <div className="mb-1.5 flex items-center gap-2 border-b border-[color:var(--color-border)]/50 pb-1">
            <span
              className="inline-block h-2 w-3 rounded-sm"
              style={{ background: nearest.color }}
            />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg)]">
              {nearest.label}
            </span>
            <span className="ml-auto text-[9px] text-[color:var(--color-fg-dim)]">
              {kindLabel(nearest.kind)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums">
            <span className="text-[color:var(--color-fg-dim)]">tournaments</span>
            <span className="text-right font-semibold text-[color:var(--color-fg)]">
              {tournaments.toLocaleString()}
            </span>
            <span className="text-[color:var(--color-fg-dim)]">profit</span>
            <span className="text-right font-semibold text-[color:var(--color-fg)]">
              {compactMoney(nearestVal)}
            </span>
            <span className="text-[color:var(--color-fg-dim)]">ROI</span>
            <span className="text-right font-semibold text-[color:var(--color-fg)]">
              {cumBuyIn > 0 ? `${(roi * 100).toFixed(1)}%` : "—"}
            </span>
            <span className="text-[color:var(--color-fg-dim)]">buy-in spent</span>
            <span className="text-right text-[color:var(--color-fg-muted)]">
              {compactMoney(cumBuyIn)}
            </span>
          </div>
          {likelihood(nearest) && (
            <div className="mt-1.5 border-t border-[color:var(--color-border)]/50 pt-1 text-[10px] text-[color:var(--color-fg-dim)]">
              {likelihood(nearest)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface TrajectoryLineMeta {
  label: string;
  color: string;
  seriesIdx: number;
  /** Probability that a real run lands at-or-below this line, if applicable. */
  percentile?: number;
  /** Free-form "what kind of line" tag for the tooltip. */
  kind: "mean" | "band" | "best" | "worst" | "path" | "ref";
}

function buildTrajectoryAssets(
  r: SimulationResult,
  bankroll: number,
  hue: AccentHue,
  yRange?: { min: number; max: number },
  overlay?: SimulationResult | null,
  axisFmt: (v: number) => string = compactMoney,
  preset: LineStylePreset = LINE_STYLE_PRESETS[DEFAULT_LINE_STYLE_PRESET],
  visibleRuns: number = 20,
  refLines: RefLineConfig[] = DEFAULT_REF_LINES,
): {
  data: AlignedData;
  opts: Omit<Options, "width" | "height">;
  refStartIdx: number;
  buyInPerTourney: number;
  mainLines: TrajectoryLineMeta[];
} {
  const x = r.samplePaths.x;
  // Lockstep builders: every series push is mirrored by a uplot series push,
  // and indices come straight from series.length so anything conditional
  // (best/worst, bankroll, ref lines) just works.
  const series: (Float64Array | number[])[] = [x];
  const uplotSeries: Options["series"] = [{}];
  const mainLines: TrajectoryLineMeta[] = [];
  const pushSeries = (
    data: Float64Array | number[],
    opt: NonNullable<Options["series"]>[number],
  ): number => {
    const idx = series.length;
    series.push(data);
    uplotSeries.push(opt);
    return idx;
  };

  // "Runs shown = 0" should give a clean chart: no sample paths, no best/worst,
  // and no percentile envelope curves either (the six p-lines look like spaghetti
  // and the user counts them as "runs"). Mean/EV/ref/bankroll always stay.
  const pathCount = Math.max(
    0,
    Math.min(visibleRuns, r.samplePaths.paths.length),
  );
  const showBands = pathCount > 0;

  const meanIdx = pushSeries(r.envelopes.mean, {
    stroke: preset.mean.stroke,
    width: preset.mean.width,
    dash: preset.mean.dash,
  });
  mainLines.push({
    label: "Mean",
    color: preset.mean.stroke,
    seriesIdx: meanIdx,
    percentile: 0.5,
    kind: "mean",
  });

  if (showBands) {
    const p0015Idx = pushSeries(r.envelopes.p0015, {
      stroke: preset.bandExtreme.stroke,
      width: preset.bandExtreme.width,
    });
    const p9985Idx = pushSeries(r.envelopes.p9985, {
      stroke: preset.bandExtreme.stroke,
      width: preset.bandExtreme.width,
    });
    const p025Idx = pushSeries(r.envelopes.p025, {
      stroke: preset.bandWide.stroke,
      width: preset.bandWide.width,
    });
    const p975Idx = pushSeries(r.envelopes.p975, {
      stroke: preset.bandWide.stroke,
      width: preset.bandWide.width,
    });
    const p15Idx = pushSeries(r.envelopes.p15, {
      stroke: preset.bandNarrow.stroke,
      width: preset.bandNarrow.width,
    });
    const p85Idx = pushSeries(r.envelopes.p85, {
      stroke: preset.bandNarrow.stroke,
      width: preset.bandNarrow.width,
    });
    mainLines.push(
      { label: "p0.15", color: preset.bandExtreme.stroke, seriesIdx: p0015Idx, percentile: 0.0015, kind: "band" },
      { label: "p99.85", color: preset.bandExtreme.stroke, seriesIdx: p9985Idx, percentile: 0.9985, kind: "band" },
      { label: "p2.5", color: preset.bandWide.stroke, seriesIdx: p025Idx, percentile: 0.025, kind: "band" },
      { label: "p97.5", color: preset.bandWide.stroke, seriesIdx: p975Idx, percentile: 0.975, kind: "band" },
      { label: "p15", color: preset.bandNarrow.stroke, seriesIdx: p15Idx, percentile: 0.15, kind: "band" },
      { label: "p85", color: preset.bandNarrow.stroke, seriesIdx: p85Idx, percentile: 0.85, kind: "band" },
    );
  }
  for (let i = 0; i < pathCount; i++) {
    const idx = pushSeries(r.samplePaths.paths[i], {
      stroke: preset.path.stroke,
      width: preset.path.width,
    });
    mainLines.push({
      label: `Run ${i + 1}`,
      color: preset.path.stroke,
      seriesIdx: idx,
      kind: "path",
    });
  }

  // Best/worst are also "runs" — when the user drags "runs shown" to 0 they
  // should disappear too, otherwise the chart still has two highlighted sims.
  if (pathCount > 0) {
    const bestIdx = pushSeries(r.samplePaths.best, {
      stroke: preset.best.stroke,
      width: preset.best.width,
      dash: preset.best.dash,
    });
    const worstIdx = pushSeries(r.samplePaths.worst, {
      stroke: preset.worst.stroke,
      width: preset.worst.width,
      dash: preset.worst.dash,
    });
    mainLines.push({ label: "Best run", color: preset.best.stroke, seriesIdx: bestIdx, kind: "best" });
    mainLines.push({ label: "Worst run", color: preset.worst.stroke, seriesIdx: worstIdx, kind: "worst" });
  }

  if (bankroll > 0) {
    pushSeries(new Array<number>(x.length).fill(-bankroll), {
      stroke: preset.bankrollLine.stroke,
      width: preset.bankrollLine.width,
      dash: preset.bankrollLine.dash,
    });
  }

  // Reference ROI slope lines: profit(i) = roi * cumulative buy-in at i.
  // x[N-1] is the total tournament count per sample; total buy-in is r.totalBuyIn.
  const lastX = x[x.length - 1] || 1;
  const buyInPerTourney = r.totalBuyIn / lastX;
  const refStartIdx = series.length;
  for (const ref of refLines) {
    if (!ref.enabled) continue;
    const idx = pushSeries(buildRefLine(x, ref.roi * buyInPerTourney), {
      stroke: ref.color,
      width: preset.refLine.width,
      dash: preset.refLine.dash,
      label: ref.label,
    });
    mainLines.push({
      label: ref.label,
      color: ref.color,
      seriesIdx: idx,
      kind: "ref",
    });
  }

  // EV line — the calibrated expected profit slope, drawn perfectly
  // straight from (0,0) to (lastX, expectedProfit). This is what the
  // sim is *supposed* to converge to: the schedule's total target EV.
  const evSlope = r.expectedProfit / lastX;
  const evLineIdx = pushSeries(buildRefLine(x, evSlope), {
    stroke: preset.ev.stroke,
    width: preset.ev.width,
    dash: preset.ev.dash,
    label: "EV",
  });
  mainLines.push({
    label: "EV",
    color: preset.ev.stroke,
    seriesIdx: evLineIdx,
    kind: "ref",
  });

  // `hue` is only used for tinting the legacy tooltip swatches for the
  // best/worst paths on the comparison pane — the actual envelope and
  // line colors all come from the line-style preset now.
  void HUES[hue];

  // Overlay must align to primary's x axis. uPlot uses one x per chart, so
  // we resample the overlay envelopes onto primary's x-grid by index — they
  // share the same checkpoint count (both passes use the same N), but if the
  // grids ever diverge we fall back to a linear interp on tournament index.
  if (overlay && overlay.envelopes.mean.length > 0) {
    const ox = overlay.envelopes.x;
    // Resample overlay onto primary's x-axis by linearly interpolating in
    // *tournament-index* space (x[i] is a real tournament count, not a
    // fraction). The previous implementation stretched overlay to primary's
    // full extent via x[i]/oxLast, which was wrong whenever the two passes
    // had different totals or non-identical checkpoint grids — PD's curve
    // ended up shifted and squashed instead of aligned tournament-to-tournament.
    const resample = (src: Float64Array): Float64Array => {
      if (src.length === x.length && ox.length === x.length) {
        let same = true;
        for (let i = 0; i < x.length; i++) {
          if (ox[i] !== x[i]) {
            same = false;
            break;
          }
        }
        if (same) return src;
      }
      const out = new Float64Array(x.length);
      const oxLen = ox.length;
      const oxFirst = ox[0];
      const oxLast = ox[oxLen - 1];
      for (let i = 0; i < x.length; i++) {
        const xi = x[i];
        if (xi <= oxFirst) {
          out[i] = src[0];
          continue;
        }
        if (xi >= oxLast) {
          out[i] = src[oxLen - 1];
          continue;
        }
        let lo = 0;
        let hi = oxLen - 1;
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (ox[mid] <= xi) lo = mid;
          else hi = mid;
        }
        const span = ox[hi] - ox[lo];
        const frac = span > 0 ? (xi - ox[lo]) / span : 0;
        out[i] = src[lo] * (1 - frac) + src[hi] * frac;
      }
      return out;
    };
    const overlayStart = series.length;
    series.push(resample(overlay.envelopes.mean));
    series.push(resample(overlay.envelopes.p025));
    series.push(resample(overlay.envelopes.p975));
    const overlayColor = "#f472b6";
    uplotSeries.push({
      stroke: overlayColor,
      width: 2.5,
      label: "PrimeDope mean",
    });
    uplotSeries.push({
      stroke: overlayColor,
      width: 1.75,
      dash: [6, 4],
      label: "PrimeDope p2.5",
    });
    uplotSeries.push({
      stroke: overlayColor,
      width: 1.75,
      dash: [6, 4],
      label: "PrimeDope p97.5",
    });
    mainLines.push({
      label: "PrimeDope mean",
      color: overlayColor,
      seriesIdx: overlayStart,
      percentile: 0.5,
      kind: "mean",
    });
    mainLines.push({
      label: "PrimeDope p2.5",
      color: overlayColor,
      seriesIdx: overlayStart + 1,
      percentile: 0.025,
      kind: "band",
    });
    mainLines.push({
      label: "PrimeDope p97.5",
      color: overlayColor,
      seriesIdx: overlayStart + 2,
      percentile: 0.975,
      kind: "band",
    });
  }

  return {
    refStartIdx,
    buyInPerTourney,
    mainLines,
    data: series as AlignedData,
    opts: {
      scales: {
        x: { time: false },
        y: yRange
          ? { auto: false, range: () => [yRange.min, yRange.max] }
          : { auto: true },
      },
      axes: [
        {
          stroke: "#8a8a95",
          grid: { stroke: "rgba(128,128,128,0.15)" },
          ticks: { stroke: "rgba(128,128,128,0.2)" },
        },
        {
          stroke: "#8a8a95",
          grid: { stroke: "rgba(128,128,128,0.15)" },
          ticks: { stroke: "rgba(128,128,128,0.2)" },
          size: 56,
          values: (_u, splits) => splits.map(axisFmt),
        },
      ],
      series: uplotSeries,
      legend: { show: false },
      cursor: { drag: { x: true, y: false } },
    },
  };
}

function unionYRange(
  a: SimulationResult,
  b: SimulationResult,
  bankroll: number,
): { min: number; max: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of [a, b]) {
    for (const v of r.envelopes.p0015) {
      if (v < lo) lo = v;
    }
    for (const v of r.envelopes.p9985) {
      if (v > hi) hi = v;
    }
    for (const v of r.samplePaths.worst) {
      if (v < lo) lo = v;
    }
    for (const v of r.samplePaths.best) {
      if (v > hi) hi = v;
    }
  }
  if (bankroll > 0 && -bankroll < lo) lo = -bankroll;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) {
    return { min: -1, max: 1 };
  }
  const pad = (hi - lo) * 0.05;
  return { min: lo - pad, max: hi + pad };
}

export function ResultsView({
  result,
  compareResult,
  bankroll = 0,
  schedule,
  scheduleRepeats,
  compareMode = "primedope",
  modelPresetId,
  finishModelId,
  settings,
  elapsedMs,
}: Props) {
  const t = useT();

  const pdChart = result.comparison;

  const yRange = useMemo(
    () =>
      pdChart ? unionYRange(result, pdChart, bankroll) : undefined,
    [result, pdChart, bankroll],
  );

  const [overlayPd, setOverlayPd] = useState(false);

  const s = result.stats;
  const roi = s.mean / result.totalBuyIn;
  const modelPreset = modelPresetId
    ? STANDARD_PRESETS.find((p) => p.id === modelPresetId)
    : undefined;
  const modelLabel = modelPreset
    ? t(modelPreset.labelKey)
    : finishModelId
    ? t(`model.${finishModelId}` as DictKey)
    : t("twin.runA");
  const settingsSummary = buildSettingsSummary(settings);

  const abi = useMemo(() => {
    const xs = result.samplePaths.x;
    const lastX = xs[xs.length - 1] || 1;
    return result.totalBuyIn / lastX;
  }, [result]);
  const [unit, setUnit] = useState<"money" | "abi">("money");
  const moneyFmt = useMemo<MoneyFmt>(
    () => (unit === "abi" ? makeAbiMoney(abi) : defaultMoneyFmt),
    [unit, abi],
  );
  // Shadow the module-level formatters inside ResultsView so existing
  // money(...) / compactMoney(...) call sites pick up the unit-aware pair.
  // eslint-disable-next-line @typescript-eslint/no-shadow
  const { money, compactMoney } = moneyFmt;
  const tourneysWord = t("unit.tourneys");

  const [lineStylePresetId, setLineStylePresetIdRaw] =
    useState<LineStylePresetId>(DEFAULT_LINE_STYLE_PRESET);
  const [lineOverrides, setLineOverridesRaw] = useState<LineStyleOverrides>({});
  // Hydrate from localStorage post-mount so SSR markup matches initial render.
  useEffect(() => {
    setLineStylePresetIdRaw(loadLineStylePreset());
    setLineOverridesRaw(loadLineStyleOverrides());
  }, []);
  const setLineStylePresetId = (id: LineStylePresetId) => {
    setLineStylePresetIdRaw(id);
    saveLineStylePreset(id);
  };
  const setLineOverrides = (ov: LineStyleOverrides) => {
    setLineOverridesRaw(ov);
    saveLineStyleOverrides(ov);
  };
  const linePreset = useMemo(
    () => applyLineStyleOverrides(LINE_STYLE_PRESETS[lineStylePresetId], lineOverrides),
    [lineStylePresetId, lineOverrides],
  );

  const maxRuns = result.samplePaths.paths.length;
  const [visibleRuns, setVisibleRuns] = useState(maxRuns);
  useEffect(() => {
    setVisibleRuns((cur) => Math.min(cur, maxRuns));
  }, [maxRuns]);

  const [refLines, setRefLinesRaw] = useState<RefLineConfig[]>(DEFAULT_REF_LINES);
  useEffect(() => {
    setRefLinesRaw(loadRefLines());
  }, []);
  const setRefLines = (v: RefLineConfig[]) => {
    setRefLinesRaw(v);
    saveRefLines(v);
  };

  const primary = useMemo(
    () =>
      buildTrajectoryAssets(
        result,
        bankroll,
        "felt",
        yRange,
        overlayPd ? pdChart : null,
        compactMoney,
        linePreset,
        visibleRuns,
        refLines,
      ),
    [result, bankroll, yRange, overlayPd, pdChart, compactMoney, linePreset, visibleRuns, refLines],
  );
  const secondary = useMemo(
    () =>
      pdChart
        ? buildTrajectoryAssets(
            pdChart,
            bankroll,
            "magenta",
            yRange,
            undefined,
            compactMoney,
            PRIMEDOPE_PANE_PRESET,
            visibleRuns,
            refLines,
          )
        : null,
    [pdChart, bankroll, yRange, compactMoney, visibleRuns, refLines],
  );
  const slotOverlay = useMemo(
    () =>
      compareResult
        ? buildTrajectoryAssets(
            compareResult,
            bankroll,
            "magenta",
            undefined,
            undefined,
            compactMoney,
            PRIMEDOPE_PANE_PRESET,
            visibleRuns,
            refLines,
          )
        : null,
    [compareResult, bankroll, compactMoney, visibleRuns, refLines],
  );

  return (
    <MoneyFmtContext.Provider value={moneyFmt}>
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-fg-dim)]">
            {t("lineStyle.label")}
          </div>
          <LineStylePresetPicker
            value={lineStylePresetId}
            onChange={setLineStylePresetId}
            t={t}
          />
          <LineStyleCustomizer
            preset={LINE_STYLE_PRESETS[lineStylePresetId]}
            overrides={lineOverrides}
            onChange={setLineOverrides}
            t={t}
          />
          <RefLineCustomizer value={refLines} onChange={setRefLines} t={t} />
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-fg-dim)]">
            {t("runs.label")}
          </div>
          <input
            type="range"
            min={0}
            max={maxRuns}
            step={1}
            value={visibleRuns}
            onChange={(e) => setVisibleRuns(Number(e.target.value))}
            className="h-1 w-28 cursor-pointer accent-[color:var(--color-accent)]"
            aria-label={t("runs.label")}
          />
          <span className="w-10 text-right font-mono text-[11px] tabular-nums text-[color:var(--color-fg-muted)]">
            {visibleRuns}/{maxRuns}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-fg-dim)]">
            {t("unit.displayLabel")}
          </div>
          <UnitToggle value={unit} onChange={setUnit} t={t} />
        </div>
      </div>
      {secondary ? (
        <Card className="p-5">
          <ChartHeader
            title={t("chart.trajectory")}
            subtitle={
              bankroll > 0
                ? `${t("chart.trajectory.sub.vs")} · bankroll ${money(bankroll)}`
                : t("chart.trajectory.sub.vs")
            }
          />
          {compareMode === "primedope" && pdChart && (
            <GapExplainer
              ours={result}
              pd={pdChart}
              money={money}
              t={t}
            />
          )}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-3">
              <ChartPane
                label={modelLabel}
                sublabel={settingsSummary}
                hueDot="#34d399"
                caption={
                  compareMode === "primedope"
                    ? t("chart.trajectory.ours.cap")
                    : t("twin.runA.cap")
                }
              >
                <TrajectoryPlot assets={primary} height={420} />
              </ChartPane>
              {compareMode === "primedope" && (
                <div className="rounded border border-[#34d399]/30 bg-[#34d399]/5 px-3 py-2 text-[11px] leading-relaxed text-[color:var(--color-fg-muted)]">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[#34d399]">
                    ✓ {modelLabel}
                  </div>
                  {t("chart.trajectory.oursFix")}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-3">
              <ChartPane
                label="PrimeDope"
                hueDot="#f472b6"
                caption={
                  compareMode === "primedope"
                    ? t("chart.trajectory.theirs.cap")
                    : t("twin.runB.cap")
                }
                action={
                  compareMode === "primedope" && schedule && scheduleRepeats ? (
                    <PrimedopeReproduceButton
                      schedule={schedule}
                      scheduleRepeats={scheduleRepeats}
                    />
                  ) : null
                }
              >
                <TrajectoryPlot assets={secondary} height={420} />
              </ChartPane>
              {compareMode === "primedope" && (
                <div className="rounded border border-[#f472b6]/30 bg-[#f472b6]/5 px-3 py-2 text-[11px] leading-relaxed text-[color:var(--color-fg-muted)]">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[#f472b6]">
                    ⚠ PrimeDope
                  </div>
                  {t("chart.trajectory.pdWarning")}
                </div>
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-[11px] text-[color:var(--color-fg-muted)]">
              <input
                type="checkbox"
                checked={overlayPd}
                onChange={(e) => setOverlayPd(e.target.checked)}
                className="h-3.5 w-3.5 accent-[color:var(--color-accent)]"
              />
              <span className="font-semibold text-[color:var(--color-fg)]">
                {t("chart.trajectory.overlay")}
              </span>
              <span className="text-[color:var(--color-fg-dim)]">
                — {t("chart.trajectory.overlayHint")}
              </span>
            </label>
            <div className="text-[11px] text-[color:var(--color-fg-dim)]">
              {t("chart.trajectory.sharedY")}
            </div>
          </div>
        </Card>
      ) : (
        <Card className="p-5">
          <ChartHeader
            title={t("chart.trajectory")}
            subtitle={
              bankroll > 0
                ? `${t("chart.trajectory.sub")} · bankroll ${money(bankroll)}`
                : t("chart.trajectory.sub")
            }
          />
          <TrajectoryPlot assets={primary} height={440} />
          {slotOverlay && (
            <div className="mt-4">
              <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
                <span className="inline-block h-1.5 w-3 rounded-sm bg-[#f472b6]" />
                {t("slot.saved")}
              </div>
              <TrajectoryPlot assets={slotOverlay} height={240} />
            </div>
          )}
        </Card>
      )}

      <CollapsibleSection id="verdict" title={t("section.verdict")}>
        <VerdictCard result={result} bankroll={bankroll} />
      </CollapsibleSection>

      <CollapsibleSection id="pdReport" title={t("section.primedopeReport")}>
        <PrimedopeReportCard result={result} />
      </CollapsibleSection>

      <CollapsibleSection id="pdWeakness" title={t("section.pdWeakness")}>
        <PokerDopeWeaknessCard />
      </CollapsibleSection>

      <CollapsibleSection id="settingsDump" title={t("section.settingsDump")}>
        <SettingsDumpCard settings={settings} schedule={schedule} result={result} elapsedMs={elapsedMs} />
      </CollapsibleSection>

      {result.comparison && compareMode === "primedope" && (
        <>
          <CollapsibleSection id="pdVerdict" title={t("section.pdVerdict")}>
            <PDVerdict primary={result} other={result.comparison} />
          </CollapsibleSection>
          <CollapsibleSection id="pdDiff" title={t("section.pdDiff")}>
            <PrimedopeDiff primary={result} other={result.comparison} />
          </CollapsibleSection>
        </>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <BigStat
          suit="club"
          label={t("stat.expectedProfit")}
          value={money(s.mean)}
          sub={`ROI ${(roi * 100).toFixed(1)}%`}
          tone={s.mean >= 0 ? "pos" : "neg"}
        />
        <BigStat
          suit="diamond"
          label={t("stat.stdDev")}
          value={money(s.stdDev)}
          sub={`SE ${money(s.stdDev / Math.sqrt(result.samples))}`}
        />
        <BigStat
          suit="spade"
          label={t("stat.probProfit")}
          value={pct(s.probProfit)}
          sub={`median ${money(s.median)}`}
        />
        <BigStat
          suit="heart"
          label={t("stat.riskOfRuin")}
          value={pct(s.riskOfRuin)}
          sub={
            s.riskOfRuin === 0 && result.stats.minBankrollRoR1pct === 0
              ? t("stat.bankrollOff")
              : `min BR 1% = ${money(s.minBankrollRoR1pct)}`
          }
          tone={s.riskOfRuin > 0.05 ? "neg" : undefined}
        />
        <BigStat
          suit="spade"
          label={t("stat.itmRate")}
          value={pct(s.itmRate)}
          sub={t("stat.itmRate.sub")}
          tip={t("stat.itmRate.tip")}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <MiniStat
          suit="heart"
          label={t("stat.var")}
          value={`${money(s.var95)} / ${money(s.var99)}`}
          tone="neg"
        />
        <MiniStat
          suit="heart"
          label={t("stat.cvar")}
          value={`${money(s.cvar95)} / ${money(s.cvar99)}`}
          tone="neg"
        />
        <MiniStat
          suit="diamond"
          label={t("stat.sharpe")}
          value={s.sharpe.toFixed(3)}
          tone={s.sharpe >= 0 ? "pos" : "neg"}
        />
        <MiniStat
          suit="diamond"
          label={t("stat.sortino")}
          value={s.sortino.toFixed(3)}
          tone={s.sortino >= 0 ? "pos" : "neg"}
        />
        <MiniStat
          suit="diamond"
          label={t("stat.tFor95")}
          value={`${intFmt(s.tournamentsFor95ROI)} ${tourneysWord}`}
        />
        <MiniStat
          suit="heart"
          label={t("stat.avgMaxDD")}
          value={money(s.maxDrawdownMean)}
        />
        <MiniStat
          suit="heart"
          label={t("stat.ddMedian")}
          value={money(s.maxDrawdownMedian)}
        />
        <MiniStat
          suit="heart"
          label={t("stat.ddP95")}
          value={money(s.maxDrawdownP95)}
          tone="neg"
        />
        <MiniStat
          suit="heart"
          label={t("stat.ddP99")}
          value={money(s.maxDrawdownP99)}
          tone="neg"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <MiniStat
          suit="club"
          label={t("stat.bestRun")}
          value={money(s.max)}
          tone="pos"
        />
        <MiniStat
          suit="heart"
          label={t("stat.worstRun")}
          value={money(s.min)}
          tone="neg"
        />
        <MiniStat
          suit="heart"
          label={t("stat.p1p5")}
          value={`${money(s.p01)} / ${money(s.p05)}`}
        />
        <MiniStat
          suit="club"
          label={t("stat.p95p99")}
          value={`${money(s.p95)} / ${money(s.p99)}`}
        />
        <MiniStat
          suit="diamond"
          label={t("stat.longestBE")}
          value={`${Math.round(s.longestBreakevenMean)} ${tourneysWord}`}
        />
        <MiniStat
          suit="heart"
          label={t("stat.minBR5")}
          value={money(s.minBankrollRoR5pct)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MiniStat
          suit="heart"
          label={t("stat.ddBI")}
          value={`${s.maxDrawdownBuyIns.toFixed(1)} BI`}
          tone="neg"
        />
        <MiniStat
          suit="spade"
          label={t("stat.skew")}
          value={s.skewness.toFixed(2)}
          tone={s.skewness >= 0 ? "pos" : "neg"}
        />
        <MiniStat
          suit="spade"
          label={t("stat.kurt")}
          value={s.kurtosis.toFixed(2)}
        />
        <MiniStat
          suit="diamond"
          label={t("stat.kelly")}
          value={s.kellyFraction > 0 ? pct(s.kellyFraction) : "—"}
          tone={s.kellyFraction > 0 ? "pos" : undefined}
        />
        <MiniStat
          suit="diamond"
          label={t("stat.kellyBR")}
          value={
            Number.isFinite(s.kellyBankroll) ? money(s.kellyBankroll) : "—"
          }
        />
        <MiniStat
          suit="club"
          label={t("stat.logG")}
          value={
            bankroll > 0 ? (s.logGrowthRate * 100).toFixed(3) + "%" : "—"
          }
          tone={s.logGrowthRate > 0 ? "pos" : s.logGrowthRate < 0 ? "neg" : undefined}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MiniStat
          suit="diamond"
          label={t("stat.recoveryMedian")}
          value={
            Number.isFinite(s.recoveryMedian)
              ? `${Math.round(s.recoveryMedian)} ${tourneysWord}`
              : "—"
          }
        />
        <MiniStat
          suit="heart"
          label={t("stat.recoveryP90")}
          value={
            Number.isFinite(s.recoveryP90)
              ? `${Math.round(s.recoveryP90)} ${tourneysWord}`
              : "—"
          }
          tone="neg"
        />
        <MiniStat
          suit="heart"
          label={t("stat.recoveryUnrecovered")}
          value={pct(s.recoveryUnrecoveredShare)}
          tone={s.recoveryUnrecoveredShare > 0.05 ? "neg" : undefined}
        />
        <MiniStat
          suit="diamond"
          label={t("stat.cashlessMean")}
          value={`${s.longestCashlessMean.toFixed(1)} ${tourneysWord}`}
        />
        <MiniStat
          suit="heart"
          label={t("stat.cashlessWorst")}
          value={`${s.longestCashlessWorst} ${tourneysWord}`}
          tone="neg"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <ChartHeader
              title={t("chart.dist")}
              subtitle={`${result.samples.toLocaleString()} ${t("app.samples")} · 60 bins`}
            />
          </div>
          <DistributionChart
            binEdges={result.histogram.binEdges}
            counts={result.histogram.counts}
            color="#34d399"
            scaleBy={unit === "abi" ? abi : undefined}
            unitLabel={unit === "abi" ? "ABI" : "$"}
            overlay={
              overlayPd && pdChart
                ? {
                    binEdges: pdChart.histogram.binEdges,
                    counts: pdChart.histogram.counts,
                    label: "PrimeDope",
                  }
                : null
            }
          />
        </Card>
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <ChartHeader
              title={t("chart.ddDist")}
              subtitle={t("chart.ddDist.sub")}
            />
          </div>
          <DistributionChart
            binEdges={result.drawdownHistogram.binEdges}
            counts={result.drawdownHistogram.counts}
            color="#f87171"
            scaleBy={unit === "abi" ? abi : undefined}
            unitLabel={unit === "abi" ? "ABI" : "$"}
            overlay={
              overlayPd && pdChart
                ? {
                    binEdges: pdChart.drawdownHistogram.binEdges,
                    counts: pdChart.drawdownHistogram.counts,
                    label: "PrimeDope",
                  }
                : null
            }
          />
        </Card>
      </div>

      {/* Streak histograms — the grinder's "how bad/long can it get" row */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <Card className="p-5">
          <ChartHeader
            title={t("chart.longestBE")}
            subtitle={t("chart.longestBE.sub")}
          />
          <DistributionChart
            binEdges={result.longestBreakevenHistogram.binEdges}
            counts={result.longestBreakevenHistogram.counts}
            color="#fbbf24"
          />
          <div className="mt-1 text-[11px] text-[color:var(--color-fg-dim)]">
            {t("chart.unit.tourneys")}
          </div>
        </Card>
        <Card className="p-5">
          <ChartHeader
            title={t("chart.longestCashless")}
            subtitle={t("chart.longestCashless.sub")}
          />
          <DistributionChart
            binEdges={result.longestCashlessHistogram.binEdges}
            counts={result.longestCashlessHistogram.counts}
            color="#f87171"
          />
          <div className="mt-1 text-[11px] text-[color:var(--color-fg-dim)]">
            {t("chart.unit.tourneys")}
          </div>
        </Card>
        <Card className="p-5">
          <ChartHeader
            title={t("chart.recovery")}
            subtitle={t("chart.recovery.sub")}
          />
          <DistributionChart
            binEdges={result.recoveryHistogram.binEdges}
            counts={result.recoveryHistogram.counts}
            color="#34d399"
          />
          <div className="mt-1 text-[11px] text-[color:var(--color-fg-dim)]">
            {fmt(t("chart.recovery.unrecovered"), {
              pct: pct(s.recoveryUnrecoveredShare),
            })}
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <ChartHeader
          title={t("chart.convergence")}
          subtitle={t("chart.convergence.sub")}
        />
        <ConvergenceChart
          x={result.convergence.x}
          mean={result.convergence.mean}
          seLo={result.convergence.seLo}
          seHi={result.convergence.seHi}
        />
        <ChartHelp text={t("chart.convergence.help")} />
      </Card>

      <Card className="p-5">
        <ChartHeader
          title={t("chart.sensitivity")}
          subtitle={t("chart.sensitivity.sub")}
        />
        <SensitivityChart
          deltas={result.sensitivity.deltas}
          profits={result.sensitivity.expectedProfits}
        />
        <div className="mt-2 text-[11px] text-[color:var(--color-fg-dim)]">
          {t("sens.note")}
        </div>
        <ChartHelp text={t("chart.sensitivity.help")} />
      </Card>

      <Card className="p-5">
        <ChartHeader
          title={t("chart.decomp")}
          subtitle={t("chart.decomp.sub")}
        />
        <DecompositionChart rows={result.decomposition} />
        <ChartHelp text={t("chart.decomp.help")} />
      </Card>

      {result.downswings.length > 0 && (
        <Card className="p-5">
          <ChartHeader title={t("dd.title")} subtitle={t("dd.sub")} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="border-b border-[color:var(--color-border)] text-[10px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
                  <th className="py-2 text-left font-medium">{t("dd.rank")}</th>
                  <th className="py-2 text-right font-medium">
                    {t("dd.depth")}
                  </th>
                  <th className="py-2 text-right font-medium">
                    {t("dd.final")}
                  </th>
                  <th className="py-2 text-right font-medium">
                    {t("dd.breakeven")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.downswings.map((d) => (
                  <tr
                    key={d.rank}
                    className="border-b border-[color:var(--color-border)]/60 last:border-b-0"
                  >
                    <td className="py-2 text-[color:var(--color-fg-muted)]">
                      #{d.rank}
                    </td>
                    <td className="py-2 text-right tabular-nums text-[color:var(--color-danger)]">
                      {money(-d.depth)}
                    </td>
                    <td
                      className={`py-2 text-right tabular-nums ${d.finalProfit >= 0 ? "text-[color:var(--color-success)]" : "text-[color:var(--color-fg)]"}`}
                    >
                      {money(d.finalProfit)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-[color:var(--color-fg-muted)]">
                      {Math.round(d.longestBreakeven)} {tourneysWord}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
    </MoneyFmtContext.Provider>
  );
}

function LineStylePresetPicker({
  value,
  onChange,
  t,
}: {
  value: LineStylePresetId;
  onChange: (v: LineStylePresetId) => void;
  t: (key: DictKey) => string;
}) {
  const active = LINE_STYLE_PRESETS[value];
  return (
    <div className="flex items-center gap-2">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as LineStylePresetId)}
        className="rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-0.5 text-[11px] font-semibold text-[color:var(--color-fg)] outline-none hover:border-[color:var(--color-accent)] focus:border-[color:var(--color-accent)]"
        title={active.description}
      >
        {LINE_STYLE_PRESET_ORDER.map((id) => (
          <option key={id} value={id}>
            {LINE_STYLE_PRESETS[id].label}
          </option>
        ))}
      </select>
      {/* Mini preview: mean stroke + dashed EV stroke so you can see the
          style without running a sim. */}
      <svg
        width="42"
        height="14"
        viewBox="0 0 42 14"
        aria-hidden
        className="shrink-0"
      >
        <line
          x1="1"
          y1="9"
          x2="41"
          y2="5"
          stroke={active.mean.stroke}
          strokeWidth={active.mean.width}
          strokeLinecap="round"
        />
        <line
          x1="1"
          y1="11"
          x2="41"
          y2="8"
          stroke={active.ev.stroke}
          strokeWidth={active.ev.width}
          strokeDasharray={active.ev.dash?.join(" ") ?? "0"}
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

function LineStyleCustomizer({
  preset,
  overrides,
  onChange,
  t,
}: {
  preset: LineStylePreset;
  overrides: LineStyleOverrides;
  onChange: (ov: LineStyleOverrides) => void;
  t: (key: DictKey) => string;
}) {
  const labelKey = (k: OverridableLineKey): DictKey =>
    ({
      mean: "lineStyle.line.mean",
      ev: "lineStyle.line.ev",
      best: "lineStyle.line.best",
      worst: "lineStyle.line.worst",
    })[k] as DictKey;

  const setKey = (k: OverridableLineKey, patch: { stroke?: string; width?: number }) => {
    const current = overrides[k] ?? {};
    const next: LineStyleOverrides = {
      ...overrides,
      [k]: { ...current, ...patch },
    };
    onChange(next);
  };

  const resetKey = (k: OverridableLineKey) => {
    const next = { ...overrides };
    delete next[k];
    onChange(next);
  };

  const hasAny = OVERRIDABLE_LINE_KEYS.some((k) => overrides[k]);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useCloseDetailsOnOutsideClick(detailsRef);

  return (
    <details ref={detailsRef} className="group relative">
      <summary className="cursor-pointer select-none rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-0.5 text-[11px] font-semibold text-[color:var(--color-fg)] hover:border-[color:var(--color-accent)]">
        {t("lineStyle.customize")}
      </summary>
      <div className="absolute left-0 top-full z-10 mt-1 w-72 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-3 shadow-lg">
        <div className="flex flex-col gap-2">
          {OVERRIDABLE_LINE_KEYS.map((k) => {
            const base = preset[k];
            const ov = overrides[k] ?? {};
            const stroke = ov.stroke ?? base.stroke;
            const width = ov.width ?? base.width;
            // color input needs a hex value — fall back to preset color if it's a named/rgba.
            const hex = /^#([0-9a-f]{3}){1,2}$/i.test(stroke) ? stroke : "#34d399";
            return (
              <div key={k} className="flex items-center gap-2 text-[11px]">
                <span className="w-24 truncate text-[color:var(--color-fg-dim)]">
                  {t(labelKey(k))}
                </span>
                <input
                  type="color"
                  value={hex}
                  onChange={(e) => setKey(k, { stroke: e.target.value })}
                  className="h-5 w-6 cursor-pointer rounded border border-[color:var(--color-border)] bg-transparent p-0"
                  aria-label={t(labelKey(k))}
                />
                <input
                  type="range"
                  min={0.5}
                  max={4}
                  step={0.25}
                  value={width}
                  onChange={(e) => setKey(k, { width: Number(e.target.value) })}
                  className="flex-1"
                  aria-label={t("lineStyle.width")}
                />
                <span className="w-6 text-right tabular-nums text-[color:var(--color-fg-dim)]">
                  {width.toFixed(2)}
                </span>
                <button
                  type="button"
                  onClick={() => resetKey(k)}
                  disabled={!overrides[k]}
                  className="rounded px-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)] hover:text-[color:var(--color-fg)] disabled:opacity-30"
                  title={t("lineStyle.reset")}
                >
                  ×
                </button>
              </div>
            );
          })}
          <button
            type="button"
            onClick={() => onChange({})}
            disabled={!hasAny}
            className="mt-1 self-end rounded border border-[color:var(--color-border)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-fg)] disabled:opacity-30"
          >
            {t("lineStyle.resetAll")}
          </button>
        </div>
      </div>
    </details>
  );
}

function CollapsibleSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  const storageKey = `tvs.collapse.${id}.v1`;
  const ref = useRef<HTMLDetailsElement>(null);
  // Controlled `open` on <details> is historically flaky because the browser
  // toggles the attribute synchronously on click, competing with React's
  // render. Use a ref: hydrate open state post-mount from localStorage, then
  // let the browser own the attribute and just persist changes in onToggle.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof localStorage === "undefined") return;
    try {
      const v = localStorage.getItem(storageKey);
      el.open = v === "1";
    } catch {}
  }, [storageKey]);
  const onToggle: ReactEventHandler<HTMLDetailsElement> = (e) => {
    try {
      localStorage.setItem(
        storageKey,
        e.currentTarget.open ? "1" : "0",
      );
    } catch {}
  };
  return (
    <details
      ref={ref}
      onToggle={onToggle}
      className="group rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev-1)]"
    >
      <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-fg-dim)] hover:text-[color:var(--color-fg)]">
        <span>{title}</span>
        <span className="text-[10px] transition-transform group-open:rotate-90">
          ▶
        </span>
      </summary>
      <div className="border-t border-[color:var(--color-border)] p-0">
        {children}
      </div>
    </details>
  );
}

/**
 * Close a <details> popover when the user clicks outside it. Native <details>
 * only toggles on summary click; without this, the customizer stays pinned
 * open until the user explicitly clicks the summary again.
 */
function useCloseDetailsOnOutsideClick(
  ref: React.RefObject<HTMLDetailsElement | null>,
) {
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const el = ref.current;
      if (!el || !el.open) return;
      const target = e.target as Node | null;
      if (target && !el.contains(target)) el.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      const el = ref.current;
      if (!el || !el.open) return;
      if (e.key === "Escape") el.open = false;
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref]);
}

function RefLineCustomizer({
  value,
  onChange,
  t,
}: {
  value: RefLineConfig[];
  onChange: (v: RefLineConfig[]) => void;
  t: (key: DictKey) => string;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useCloseDetailsOnOutsideClick(detailsRef);
  const setAt = (i: number, patch: Partial<RefLineConfig>) => {
    const next = value.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange(next);
  };
  const removeAt = (i: number) => {
    onChange(value.filter((_, idx) => idx !== i));
  };
  const addLine = () => {
    const next: RefLineConfig[] = [
      ...value,
      { roi: 0, label: roiLabel(0), color: "#94a3b8", enabled: true },
    ];
    onChange(next);
  };
  const reset = () => onChange(DEFAULT_REF_LINES);

  return (
    <details ref={detailsRef} className="group relative">
      <summary className="cursor-pointer select-none rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-0.5 text-[11px] font-semibold text-[color:var(--color-fg)] hover:border-[color:var(--color-accent)]">
        {t("refLines.label")}
      </summary>
      <div className="absolute left-0 top-full z-10 mt-1 w-80 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-3 shadow-lg">
        <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
          <span>{t("refLines.title")}</span>
          <button
            type="button"
            onClick={reset}
            className="rounded border border-[color:var(--color-border)] px-1.5 py-0.5 text-[color:var(--color-fg-dim)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-fg)]"
          >
            {t("lineStyle.resetAll")}
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          {value.map((ref, i) => {
            const hex = /^#([0-9a-f]{3}){1,2}$/i.test(ref.color) ? ref.color : "#94a3b8";
            const pctValue = Math.round(ref.roi * 100);
            return (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  checked={ref.enabled}
                  onChange={(e) => setAt(i, { enabled: e.target.checked })}
                  className="h-3 w-3 cursor-pointer accent-[color:var(--color-accent)]"
                  aria-label={t("refLines.enabled")}
                />
                <input
                  type="color"
                  value={hex}
                  onChange={(e) => setAt(i, { color: e.target.value })}
                  className="h-5 w-6 cursor-pointer rounded border border-[color:var(--color-border)] bg-transparent p-0"
                  aria-label={t("refLines.color")}
                />
                <span className="text-[color:var(--color-fg-dim)]">ROI</span>
                <input
                  type="number"
                  value={pctValue}
                  step={5}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    if (!Number.isFinite(raw)) return;
                    const nextRoi = raw / 100;
                    setAt(i, { roi: nextRoi, label: roiLabel(nextRoi) });
                  }}
                  className="w-14 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev-2)] px-1 py-0.5 text-right font-mono tabular-nums text-[color:var(--color-fg)]"
                  aria-label={t("refLines.roi")}
                />
                <span className="text-[color:var(--color-fg-dim)]">%</span>
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  className="ml-auto rounded px-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)] hover:text-[color:var(--color-danger)]"
                  title={t("refLines.remove")}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={addLine}
          className="mt-2 w-full rounded border border-dashed border-[color:var(--color-border)] py-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-fg)]"
        >
          + {t("refLines.add")}
        </button>
      </div>
    </details>
  );
}

function GapExplainer({
  ours,
  pd,
  money,
  t,
}: {
  ours: SimulationResult;
  pd: SimulationResult;
  money: (v: number) => string;
  t: (key: DictKey) => string;
}) {
  const spreadOurs = Math.max(0, ours.stats.p95 - ours.stats.p05);
  const spreadPd = Math.max(0, pd.stats.p95 - pd.stats.p05);
  const spreadRatio = spreadPd > 1e-6 ? spreadOurs / spreadPd : 0;
  const ddOurs = ours.stats.maxDrawdownP95;
  const ddPd = pd.stats.maxDrawdownP95;
  const ddRatio = ddPd > 1e-6 ? ddOurs / ddPd : 0;
  const fmtRatio = (r: number) =>
    r >= 10 ? r.toFixed(0) : r >= 1.1 ? r.toFixed(1) : r.toFixed(2);
  const fillRatio = (key: DictKey, r: number) =>
    t(key).replace("{ratio}", fmtRatio(r));
  return (
    <div className="mt-3 mb-4 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev-2)]/50 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-fg-dim)]">
        {t("chart.trajectory.gapTitle")}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-0.5">
          <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
            {t("chart.trajectory.gapSpread")}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-bold tabular-nums text-[color:var(--color-fg)]">
              {money(spreadOurs)}
            </span>
            <span className="text-[11px] tabular-nums text-[color:var(--color-fg-dim)]">
              vs {money(spreadPd)}
            </span>
          </div>
          {spreadRatio > 0 && (
            <div className="text-[11px] font-semibold text-[color:var(--color-accent)]">
              {fillRatio("chart.trajectory.gapRatio", spreadRatio)}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
            {t("chart.trajectory.gapDd")}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-bold tabular-nums text-[color:var(--color-fg)]">
              {money(ddOurs)}
            </span>
            <span className="text-[11px] tabular-nums text-[color:var(--color-fg-dim)]">
              vs {money(ddPd)}
            </span>
          </div>
          {ddRatio > 0 && (
            <div className="text-[11px] font-semibold text-[color:var(--color-accent)]">
              {fillRatio("chart.trajectory.gapRatioDeeper", ddRatio)}
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 border-t border-[color:var(--color-border)] pt-2 text-[11px] leading-relaxed text-[color:var(--color-fg-muted)]">
        {t("chart.trajectory.gapExplain")}
      </div>
    </div>
  );
}

function UnitToggle({
  value,
  onChange,
  t,
}: {
  value: "money" | "abi";
  onChange: (v: "money" | "abi") => void;
  t: (key: DictKey) => string;
}) {
  const btn = (mode: "money" | "abi", label: string) => (
    <button
      type="button"
      onClick={() => onChange(mode)}
      className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition ${
        value === mode
          ? "bg-[color:var(--color-accent)] text-[color:var(--color-bg)]"
          : "text-[color:var(--color-fg-dim)] hover:text-[color:var(--color-fg)]"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex shrink-0 items-stretch overflow-hidden rounded border border-[color:var(--color-border)]">
      {btn("money", t("unit.money"))}
      {btn("abi", t("unit.abi"))}
    </div>
  );
}

function ChartHelp({ text }: { text: string }) {
  return (
    <div className="mt-3 rounded border border-[color:var(--color-border)]/50 bg-[color:var(--color-bg-elev-2)]/30 px-3 py-2 text-[11px] leading-relaxed text-[color:var(--color-fg-muted)]">
      {text}
    </div>
  );
}

function PrimedopeReportCard({ result }: { result: SimulationResult }) {
  // PrimeDope-style numeric dump — mirrors the layout of their site so users
  // can put the two side by side and watch deltas as they tweak settings.
  // When the run has a comparison twin (binary-ITM), shows both columns.
  const cols: { label: string; res: SimulationResult; tone: string }[] = [
    { label: "наша α-калибровка", res: result, tone: "#34d399" },
  ];
  if (result.comparison) {
    cols.push({
      label: "PrimeDope (binary-ITM)",
      res: result.comparison,
      tone: "#f472b6",
    });
  }

  const fmt$ = (v: number) =>
    `${v < 0 ? "-" : ""}$${Math.abs(Math.round(v)).toLocaleString()}`;
  const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;

  const buildRows = (r: SimulationResult) => {
    const N = r.tournamentsPerSample;
    const cost = r.totalBuyIn;
    const meanSim = r.stats.mean;
    const sdSim = r.stats.stdDev;
    // Math (analytic) EV from compile-time targets — not affected by MC noise.
    const evMath = r.expectedProfit;
    // Math SD from per-sample MC SE has the same expectation as sdSim, so
    // we report sdSim under both columns; PrimeDope's "math" SD is just the
    // closed-form binomial-ish estimate, which lines up with our sim within
    // a few percent at S ≈ 1000+.
    const ci = (k: number) => ({
      lo: meanSim - k * sdSim,
      hi: meanSim + k * sdSim,
    });
    const ci70 = ci(1.036); // 1.036σ ≈ 70 %
    const ci95 = ci(1.96);
    const ci997 = ci(3);
    const probLoss = 1 - r.stats.probProfit;
    return {
      N,
      cost,
      evMath,
      meanSim,
      sdSim,
      roiMath: cost > 0 ? evMath / cost : 0,
      roiSim: cost > 0 ? meanSim / cost : 0,
      ci70,
      ci95,
      ci997,
      ror50: r.stats.minBankrollRoR50pct,
      ror15: r.stats.minBankrollRoR15pct,
      ror5: r.stats.minBankrollRoR5pct,
      ror1: r.stats.minBankrollRoR1pct,
      ror5Gauss: r.stats.minBankrollRoR5pctGaussian,
      ror1Gauss: r.stats.minBankrollRoR1pctGaussian,
      probLoss,
      neverBelow: r.stats.neverBelowZeroFrac,
    };
  };

  const rows = cols.map((c) => ({ ...c, data: buildRows(c.res) }));

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
        {title}
      </div>
      <div className="grid grid-cols-1 gap-1 font-mono text-[11px]">{children}</div>
    </div>
  );
  const Line = ({ k, v }: { k: string; v: string }) => (
    <div className="flex justify-between gap-3">
      <span className="text-[color:var(--color-fg-dim)]">{k}</span>
      <span className="tabular-nums text-[color:var(--color-fg)]">{v}</span>
    </div>
  );

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
          PrimeDope-style report
        </div>
        <div className="text-[10px] text-[color:var(--color-fg-dim)]">
          формат с сайта PrimeDope — для прямого сравнения
        </div>
      </div>
      <div className={`grid gap-5 ${rows.length === 2 ? "lg:grid-cols-2" : "grid-cols-1"}`}>
        {rows.map((col) => (
          <div key={col.label} className="flex flex-col gap-3 rounded-lg border border-[color:var(--color-border)]/50 bg-[color:var(--color-bg-elev-2)]/30 p-3">
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: col.tone }}
              />
              <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--color-fg)]">
                {col.label}
              </span>
            </div>
            <Section title="Return on investment, EV & SD">
              <Line k="Total tournaments" v={col.data.N.toLocaleString()} />
              <Line k="Sample size" v={col.res.samples.toLocaleString()} />
              <Line k="Sum buy-ins" v={fmt$(col.data.cost)} />
              <Line k="EV (mathematically)" v={fmt$(col.data.evMath)} />
              <Line k="EV (simulated)" v={fmt$(col.data.meanSim)} />
              <Line k="ROI (mathematically)" v={fmtPct(col.data.roiMath)} />
              <Line k="ROI (simulated)" v={fmtPct(col.data.roiSim)} />
              <Line k="SD (simulated)" v={fmt$(col.data.sdSim)} />
            </Section>
            <Section title="Confidence Intervals (simulated)">
              <Line
                k="70%"
                v={`${fmt$(col.data.ci70.lo)} – ${fmt$(col.data.ci70.hi)}`}
              />
              <Line
                k="95%"
                v={`${fmt$(col.data.ci95.lo)} – ${fmt$(col.data.ci95.hi)}`}
              />
              <Line
                k="99.7%"
                v={`${fmt$(col.data.ci997.lo)} – ${fmt$(col.data.ci997.hi)}`}
              />
            </Section>
            <Section title="Bankroll & risk of ruin">
              <Line k="RoR 50%" v={fmt$(col.data.ror50)} />
              <Line k="RoR 15%" v={fmt$(col.data.ror15)} />
              <Line k="RoR 5%" v={fmt$(col.data.ror5)} />
              <Line k="RoR 1%" v={fmt$(col.data.ror1)} />
              <Line k="RoR 5% · Gaussian" v={fmt$(col.data.ror5Gauss)} />
              <Line k="RoR 1% · Gaussian" v={fmt$(col.data.ror1Gauss)} />
              <Line
                k={`Runs that never dipped below 0`}
                v={`${Math.round(col.data.neverBelow * col.res.samples)} / ${col.res.samples.toLocaleString()}`}
              />
              <Line
                k={`Probability of loss after ${col.data.N.toLocaleString()} tournaments`}
                v={fmtPct(col.data.probLoss)}
              />
            </Section>
          </div>
        ))}
      </div>
    </Card>
  );
}

// Findings from hitting PD's live API with pathological inputs. Full dossier
// + raw probe responses: notes/pokerdope_weaknesses.md, scripts/pd_probe.mjs,
// scripts/pd_cache/. Collapsed by default so it doesn't shout at users who
// just want the numbers.
function PokerDopeWeaknessCard() {
  return (
    <Card className="rounded-none border-0 p-4">
      <div className="flex flex-col gap-3 text-[11px] leading-relaxed text-[color:var(--color-fg)]">
        <p className="text-[color:var(--color-fg-dim)]">
          Реальные проблемы калькулятора Primedope, найденные прогоном их API
          напрямую (<code>scripts/pd_probe.mjs</code>). Каждый пункт
          воспроизводим, сырые ответы в <code>scripts/pd_cache/</code>, полный
          разбор в <code>notes/pokerdope_weaknesses.md</code>.
        </p>

        <div className="grid gap-2 lg:grid-cols-2">
          <WeakBlock
            tag="CRITICAL"
            tone="#f87171"
            title="4 независимых краш-вектора в один запрос"
          >
            Бэк PD роняется на: (1) ROI, при котором{" "}
            <code>(1 + ROI) × paid / players ≥ 1</code>; (2){" "}
            <code>buyin = $0.01</code>; (3) <code>places_paid == players</code>;
            (4) <code>rake = 100%</code>. Каждый из них возвращает{" "}
            <code>500</code>, а после пары таких весь <code>prime.php</code>{" "}
            отдаёт <code>502 Bad Gateway</code> всем пользователям на 5–15+
            минут. Подтверждено с независимого IP (Anthropic WebFetch видит тот
            же 502).
          </WeakBlock>

          <WeakBlock
            tag="MODEL"
            tone="#fbbf24"
            title="ITM линейно связан с ROI"
          >
            Их формула <code>itm = (1 + ROI) × paid / players</code>{" "}
            предполагает, что вся доходность берётся из повышенного рейта
            выхода в деньги. Игнорируется концентрация эджа в топ-финишах и
            overflow-ит при ROI выше порога. У нас edge настраивается через
            профиль модели финишей (power-law + shape), а ITM клэмпится.
          </WeakBlock>

          <WeakBlock
            tag="MODEL"
            tone="#fbbf24"
            title="Uniform-внутри-призовой-зоны"
          >
            Все призовые места у них равновероятны — 1-е место = min-cash.
            Для +5% игрока на 1000-max PD даёт SD ≈ $2.8k, а реалистичная
            модель с топ-тяжёлой концентрацией выносит ближе к $4–5k из-за
            редких фин-тейблов.
          </WeakBlock>

          <WeakBlock
            tag="NOISE"
            tone="#60a5fa"
            title="RoR-порог скачет ±14% между рефрешами"
          >
            Три одинаковых запроса baseline со <code>samples=500</code> дали{" "}
            <code>min01percentile</code> −$8113 / −$9307 / −$8981: спред $1195
            на среднем $8800 = 13.6% MC-джиттер. Банкролл, рассчитанный на
            «1% риск ruin», получается разным на каждом клике. У нас 50k
            сэмплов + детерминированный seed.
          </WeakBlock>

          <WeakBlock
            tag="UX"
            tone="#a78bfa"
            title="Sample size 1000 по умолчанию"
          >
            Для стабильных хвостовых квантилей (1%/5%/15% RoR) нужны десятки
            тысяч сэмплов. PD считает на 1000 и нигде не показывает CI на эти
            числа — пользователь не знает, что видит шумовые ±10%.
          </WeakBlock>

          <WeakBlock
            tag="INCONSISTENCY"
            tone="#fb923c"
            title="Рейк тихо меняет SD, хотя EV его игнорирует"
          >
            Один и тот же +10% ROI на 100p/$50/N=1000 даёт SD{" "}
            <code>$5975</code> при rake=0, <code>$5607</code> при rake=11%,{" "}
            <code>$4042</code> при rake=50%. EV при этом константен ($5000).
            Внутри они используют <code>buyin − rake</code> как базу prizepool
            для SD, но <code>buyin</code> как базу для EV — математически
            непоследовательно. Игрок, перешедший с 5% на 15% рейк, получит
            «меньший» требуемый банкролл на ровном месте.
          </WeakBlock>

          <WeakBlock
            tag="QUIRK"
            tone="#2dd4bf"
            title="Running-min RoR без bankroll-management"
          >
            На 20 000 турниров с +10% ROI и $1k банкроллом PD выдаёт{" "}
            <code>RoR = 70.8%</code>: если траектория хоть раз коснулась нуля,
            вы «разорены» навсегда, даже если дальше восстановились. Реальные
            игроки перезаряжают/занимают/понижают стейк — в PD этого нет. У нас
            рядом с running-min показывается ещё и аналитический Brownian
            first-passage, чтобы видеть разрыв.
          </WeakBlock>
        </div>

        <div className="text-[10px] text-[color:var(--color-fg-dim)]">
          Собрано 2026-04-14. Воспроизвести:{" "}
          <code>node scripts/pd_probe.mjs</code> (кеширует ответы).
        </div>
      </div>
    </Card>
  );
}

function WeakBlock({
  tag,
  tone,
  title,
  children,
}: {
  tag: string;
  tone: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-[color:var(--color-border)]/50 bg-[color:var(--color-bg-elev-2)]/30 p-3">
      <div className="flex items-center gap-2">
        <span
          className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-black"
          style={{ background: tone }}
        >
          {tag}
        </span>
        <span className="text-[11px] font-semibold text-[color:var(--color-fg)]">
          {title}
        </span>
      </div>
      <div className="text-[color:var(--color-fg-dim)]">{children}</div>
    </div>
  );
}

function SettingsDumpCard({
  settings,
  schedule,
  result,
  elapsedMs,
}: {
  settings?: ControlsState;
  schedule?: TournamentRow[];
  result: SimulationResult;
  elapsedMs?: number | null;
}) {
  if (!settings || !schedule || schedule.length === 0) return null;
  const r = schedule[0];
  const totalEntries = schedule.reduce((acc, row) => acc + row.count, 0) * settings.scheduleRepeats;
  const elapsedStr =
    elapsedMs == null
      ? "—"
      : elapsedMs < 1000
      ? `${elapsedMs.toFixed(0)} ms`
      : elapsedMs < 60_000
      ? `${(elapsedMs / 1000).toFixed(2)} s`
      : `${Math.floor(elapsedMs / 60_000)}m ${((elapsedMs % 60_000) / 1000).toFixed(1)}s`;
  const rows: Array<[string, string]> = [
    ["compute time", elapsedStr],
    ["samples", settings.samples.toLocaleString()],
    ["scheduleRepeats", settings.scheduleRepeats.toLocaleString()],
    ["totalTournaments", totalEntries.toLocaleString()],
    ["totalBuyIn", `$${result.totalBuyIn.toLocaleString()}`],
    ["bankroll", `$${settings.bankroll.toLocaleString()}`],
    ["—", "—"],
    ["players", r.players.toLocaleString()],
    ["buyIn", `$${r.buyIn}`],
    ["rake", `${(r.rake * 100).toFixed(1)}%`],
    ["bountyFraction", `${((r.bountyFraction ?? 0) * 100).toFixed(0)}%`],
    ["payoutStructure", r.payoutStructure],
    ["assumed ROI", `${(r.roi * 100).toFixed(1)}%`],
    ["lateRegMult", `${r.lateRegMultiplier ?? 1}`],
    ["maxEntries", `${r.maxEntries ?? 1}`],
    ["icmFinalTable", r.icmFinalTable ? "yes" : "no"],
    ["—", "—"],
    ["finishModel", settings.finishModelId],
    ["α (override)", settings.alphaOverride == null ? "auto" : settings.alphaOverride.toFixed(3)],
    ["modelPreset", settings.modelPresetId],
    ["compareMode", settings.compareMode],
    ["—", "—"],
    ["roiStdErr", `${(settings.roiStdErr * 100).toFixed(2)}%`],
    ["roiShockPerTourney", `${(settings.roiShockPerTourney * 100).toFixed(2)}%`],
    ["roiShockPerSession", `${(settings.roiShockPerSession * 100).toFixed(2)}%`],
    ["roiDriftSigma", `${(settings.roiDriftSigma * 100).toFixed(2)}%`],
    ["tiltFastGain", `${(settings.tiltFastGain * 100).toFixed(0)}%`],
    ["tiltFastScale", `${settings.tiltFastScale}`],
    ["tiltSlowGain", `${(settings.tiltSlowGain * 100).toFixed(0)}%`],
    ["tiltSlowThreshold", `${settings.tiltSlowThreshold}`],
  ];
  return (
    <Card className="p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
        Snapshot · settings
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[11px] sm:grid-cols-3 lg:grid-cols-4">
        {rows.map(([k, v], i) => (
          <div key={`${k}-${i}`} className="flex justify-between gap-3">
            <span className="text-[color:var(--color-fg-dim)]">{k}</span>
            <span className="text-[color:var(--color-fg)]">{v}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ChartPane({
  label,
  sublabel,
  hueDot,
  caption,
  children,
  action,
}: {
  label: string;
  sublabel?: string | null;
  hueDot: string;
  caption: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[color:var(--color-border)]/60 bg-[color:var(--color-bg-elev-2)]/30 p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: hueDot }}
        />
        <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--color-fg)]">
          {label}
        </span>
        {sublabel && (
          <span className="text-[10px] font-mono text-[color:var(--color-fg-dim)]">
            {sublabel}
          </span>
        )}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
      <div className="text-[11px] leading-snug text-[color:var(--color-fg-dim)]">
        {caption}
      </div>
    </div>
  );
}

function buildPrimedopeCheatSheet(
  schedule: TournamentRow[],
  scheduleRepeats: number,
  locale: "en" | "ru",
): string {
  const r = schedule[0];
  const totalTourneys = Math.round(
    schedule.reduce((acc, row) => acc + row.count, 0) * scheduleRepeats,
  );
  const paidPct =
    r.payoutStructure === "satellite-ticket"
      ? 10
      : r.payoutStructure === "mtt-flat"
      ? 20
      : r.payoutStructure === "mtt-top-heavy"
      ? 12
      : r.payoutStructure === "mtt-gg"
      ? 18
      : r.payoutStructure === "mtt-sunday-million"
      ? 13.8
      : 15;
  const lines =
    locale === "ru"
      ? [
          `# Введи в PrimeDope вручную:`,
          `Number of tournaments: ${totalTourneys}`,
          `Buy-in: $${r.buyIn}`,
          `Rake: ${(r.rake * 100).toFixed(1)}%`,
          `Field size: ${r.players}`,
          `ROI: ${(r.roi * 100).toFixed(1)}%`,
          `Places paid: ~${paidPct}% поля`,
          ``,
          schedule.length > 1
            ? `⚠ В расписании ${schedule.length} строк — PrimeDope умеет только одну. Скопированы параметры первой строки (${r.label ?? r.id}).`
            : ``,
        ]
      : [
          `# Paste into PrimeDope manually:`,
          `Number of tournaments: ${totalTourneys}`,
          `Buy-in: $${r.buyIn}`,
          `Rake: ${(r.rake * 100).toFixed(1)}%`,
          `Field size: ${r.players}`,
          `ROI: ${(r.roi * 100).toFixed(1)}%`,
          `Places paid: ~${paidPct}% of field`,
          ``,
          schedule.length > 1
            ? `⚠ Your schedule has ${schedule.length} rows — PrimeDope only handles one. The first row's values were copied (${r.label ?? r.id}).`
            : ``,
        ];
  return lines.filter(Boolean).join("\n");
}

function PrimedopeReproduceButton({
  schedule,
  scheduleRepeats,
}: {
  schedule: TournamentRow[];
  scheduleRepeats: number;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [copied, setCopied] = useState(false);
  const handleClick = async () => {
    const cheat = buildPrimedopeCheatSheet(schedule, scheduleRepeats, locale);
    try {
      await navigator.clipboard.writeText(cheat);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // ignore — still open the tab
    }
    window.open(
      "https://www.primedope.com/tournament-variance-calculator/",
      "_blank",
      "noopener,noreferrer",
    );
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      title={t("pd.reproduce.hint")}
      className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-[color:var(--color-fg-muted)] hover:border-[color:var(--color-border-strong)] hover:text-[color:var(--color-fg)]"
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
        <path
          d="M14 3h7v7M10 14L21 3M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {copied ? t("pd.reproduce.copied") : t("pd.reproduce.label")}
    </button>
  );
}

function ChartHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-3">
      <div className="text-sm font-semibold text-[color:var(--color-fg)]">
        {title}
      </div>
      <div className="text-xs text-[color:var(--color-fg-dim)]">{subtitle}</div>
    </div>
  );
}

type StatSuit = "club" | "heart" | "spade" | "diamond";

const SUIT_COLOR: Record<StatSuit, string> = {
  club: "var(--color-club)",
  heart: "var(--color-heart)",
  spade: "var(--color-spade)",
  diamond: "var(--color-diamond)",
};
const SUIT_GLYPH: Record<StatSuit, string> = {
  club: "♣",
  heart: "♥",
  spade: "♠",
  diamond: "♦",
};

function BigStat({
  label,
  value,
  sub,
  tone,
  tip,
  suit = "club",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "pos" | "neg";
  tip?: string;
  suit?: StatSuit;
}) {
  const toneColor =
    tone === "pos"
      ? "var(--color-success)"
      : tone === "neg"
        ? "var(--color-danger)"
        : SUIT_COLOR[suit];
  return (
    <div className="relative flex flex-col gap-1 border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)]/80 px-4 py-4">
      <span
        className="absolute left-0 top-0 h-full w-[3px]"
        style={{ background: SUIT_COLOR[suit] }}
      />
      <span
        className="absolute right-2 top-2 font-mono text-xs opacity-40"
        style={{ color: SUIT_COLOR[suit] }}
      >
        {SUIT_GLYPH[suit]}
      </span>
      <div
        className="eyebrow flex items-center gap-1.5"
        style={{ color: SUIT_COLOR[suit] }}
      >
        {label}
        {tip && <InfoTooltip content={tip} />}
      </div>
      <div
        className="font-mono text-[26px] font-bold leading-none tabular-nums"
        style={{ color: toneColor }}
      >
        {value}
      </div>
      {sub && (
        <div className="text-[11px] text-[color:var(--color-fg-dim)]">
          {sub}
        </div>
      )}
    </div>
  );
}

function VerdictCard({
  result,
  bankroll,
}: {
  result: SimulationResult;
  bankroll: number;
}) {
  const t = useT();
  const { money } = useMoneyFmt();
  const s = result.stats;
  const roi = s.mean / result.totalBuyIn;
  const roiStr = `${(roi * 100).toFixed(1)}%`;

  const lines: { key: string; text: string; tone: "pos" | "neg" | "neutral" }[] =
    [];

  // Line 1 — expected outcome: what this schedule pays on average.
  lines.push({
    key: "ev",
    text: fmt(t(s.mean >= 0 ? "verdict.ev.good" : "verdict.ev.bad"), {
      mean: money(Math.abs(s.mean)),
      roi: roiStr,
    }),
    tone: s.mean >= 0 ? "pos" : "neg",
  });

  // Line 2 — upswings: how big the top 10 % of runs end up. 95th percentile
  // is a realistic "good run" headline, not the lottery winner.
  lines.push({
    key: "upswing",
    text: fmt(t("verdict.streak.upswing"), {
      p95: money(s.p95),
      best: money(s.max),
    }),
    tone: "pos",
  });

  // Line 3 — downswings: tail drawdown. P95 max-DD is the honest "bad
  // month" headline, not the average (which hides it under typical noise).
  lines.push({
    key: "downswing",
    text: fmt(t("verdict.streak.downswing"), {
      ddMean: money(s.maxDrawdownMean),
      ddP95: money(s.maxDrawdownP95),
      ddBi: s.maxDrawdownBuyIns.toFixed(0),
    }),
    tone: s.maxDrawdownP95 > result.totalBuyIn * 0.5 ? "neg" : "neutral",
  });

  // Line 4 — dry spells: how long the fallow stretches run. Breakeven =
  // consecutive tourneys with no net profit; cashless = consecutive non-
  // ITM. Both are the "mental game" numbers a grinder cares about.
  lines.push({
    key: "dry",
    text: fmt(t("verdict.streak.dry"), {
      be: intFmt(Math.round(s.longestBreakevenMean)),
      cashless: intFmt(Math.round(s.longestCashlessMean)),
      cashlessWorst: intFmt(s.longestCashlessWorst),
    }),
    tone: "neutral",
  });

  // Line 5 — bankroll survival (only when a bankroll was set). This is
  // the only line that depends on bankroll being configured.
  if (bankroll > 0) {
    lines.push({
      key: "br-with",
      text: fmt(t("verdict.bankroll.with"), {
        br: money(bankroll),
        ror: pct(s.riskOfRuin),
      }),
      tone: s.riskOfRuin > 0.05 ? "neg" : s.riskOfRuin > 0.01 ? "neutral" : "pos",
    });
  } else if (s.minBankrollRoR1pct > 0) {
    lines.push({
      key: "br-need",
      text: fmt(t("verdict.bankroll.need"), {
        minBR: money(s.minBankrollRoR1pct),
      }),
      tone: "neutral",
    });
  }

  // Monte Carlo run precision — tells user "is this sample count enough?"
  // mcRoiErrorPct is 1.96·σ_MC / |mean|. Three buckets:
  // MC-precision warning (only when the run is too noisy to trust — the
  // good/meh cases would just clutter the streak verdict).
  if (s.mcPrecisionScore < 0.5) {
    const relPct = (v: number) =>
      Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "∞";
    const needSamples = Number.isFinite(s.mcSamplesFor1Pct)
      ? intFmt(s.mcSamplesFor1Pct)
      : "∞";
    lines.push({
      key: "mc",
      text: fmt(t("verdict.precision.bad"), {
        ci: money(s.mcCi95HalfWidthMean),
        rel: relPct(s.mcRoiErrorPct),
        need: needSamples,
      }),
      tone: "neg",
    });
  }

  return (
    <div className="bracketed bracketed-heart relative border border-[color:var(--color-heart)]/60 bg-[color:var(--color-heart)]/[0.04] p-6">
      <div className="mb-4 flex items-center justify-between border-b border-[color:var(--color-heart)]/30 pb-3">
        <div className="flex items-center gap-3">
          <span className="section-num text-2xl text-[color:var(--color-heart)]">
            ♥
          </span>
          <div>
            <div className="eyebrow text-[color:var(--color-heart)]">
              / verdict
            </div>
            <div className="text-base font-bold uppercase tracking-tight text-[color:var(--color-fg)]">
              {t("verdict.title")}
            </div>
          </div>
        </div>
      </div>
      <ul className="flex flex-col gap-3">
        {lines.map((l) => {
          const dot =
            l.tone === "pos"
              ? "bg-[color:var(--color-success)]"
              : l.tone === "neg"
                ? "bg-[color:var(--color-danger)]"
                : "bg-[color:var(--color-fg-dim)]";
          return (
            <li key={l.key} className="flex items-start gap-3">
              <span
                className={`mt-1 inline-block h-4 w-[3px] flex-shrink-0 ${dot}`}
              />
              <span className="text-[14px] leading-relaxed text-[color:var(--color-fg-muted)]">
                {l.text}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const PDV_SUIT_COLOR: Record<"heart" | "diamond" | "spade", string> = {
  heart: "var(--color-heart)",
  diamond: "var(--color-diamond)",
  spade: "var(--color-spade)",
};

function PDVerdictRow({
  label,
  ours,
  theirs,
  delta,
  worse,
  suit,
}: {
  label: string;
  ours: string;
  theirs: string;
  delta: string;
  worse: boolean;
  suit: "heart" | "diamond" | "spade";
}) {
  const color = PDV_SUIT_COLOR[suit];
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-3">
      <div
        className="text-[10px] font-semibold uppercase tracking-[0.15em]"
        style={{ color }}
      >
        {label}
      </div>
      <div className="flex items-baseline gap-3">
        <div className="flex flex-col">
          <span className="text-[9px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
            PrimeDope
          </span>
          <span className="font-mono text-sm tabular-nums text-[color:var(--color-fg-muted)] line-through decoration-[color:var(--color-rival)]/60">
            {theirs}
          </span>
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          className="text-[color:var(--color-fg-dim)]"
        >
          <path
            d="M5 12h14M13 6l6 6-6 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className="flex flex-col">
          <span className="text-[9px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
            reality
          </span>
          <span
            className="font-mono text-lg font-semibold tabular-nums"
            style={{ color }}
          >
            {ours}
          </span>
        </div>
      </div>
      <div
        className="text-[10px] font-medium"
        style={{
          color: worse ? "var(--color-heart)" : "var(--color-club)",
        }}
      >
        {delta}
      </div>
    </div>
  );
}

function PDVerdict({
  primary,
  other,
}: {
  primary: SimulationResult;
  other: SimulationResult;
}) {
  const t = useT();
  const { money } = useMoneyFmt();
  const ours = primary.stats;
  const theirs = other.stats;

  const sigmaRatio = ours.stdDev / Math.max(1e-9, theirs.stdDev);
  const ddRatio =
    ours.maxDrawdownMean / Math.max(1e-9, theirs.maxDrawdownMean);
  const beDelta = Math.round(
    ours.longestBreakevenMean - theirs.longestBreakevenMean,
  );
  const itmPp = (ours.itmRate - theirs.itmRate) * 100;

  const sigmaWorse = sigmaRatio >= 1;
  const ddWorse = ddRatio >= 1;
  const itmWorse = itmPp <= 0;

  const fmtMult = (r: number) => {
    const v = r >= 1 ? r : 1 / r;
    return v.toFixed(v >= 10 ? 0 : v >= 2 ? 1 : 2);
  };
  const fmtDelta = (v: number) => (v >= 0 ? `+${v}` : `${v}`);
  const fmtPp = (v: number) => Math.abs(v).toFixed(1);

  const headlineRatio = Math.max(
    sigmaWorse ? sigmaRatio : 1 / Math.max(1e-9, sigmaRatio),
    ddWorse ? ddRatio : 1 / Math.max(1e-9, ddRatio),
  );

  return (
    <Card className="bracketed-heart overflow-hidden border-[color:var(--color-heart)]/40 p-6">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[color:var(--color-heart)]">♥</span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--color-heart)]">
          {t("pdv.eyebrow")}
        </span>
      </div>
      <h3 className="mb-1 text-[18px] font-black uppercase leading-tight text-[color:var(--color-fg)]">
        {t("pdv.title")}
      </h3>
      <p className="mb-4 text-[13px] leading-relaxed text-[color:var(--color-fg-muted)]">
        {t("pdv.titleReality")}
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <PDVerdictRow
          label={t("pdv.sigma")}
          ours={money(ours.stdDev)}
          theirs={money(theirs.stdDev)}
          delta={fmt(
            sigmaWorse ? t("pdv.sigmaDelta") : t("pdv.sigmaDeltaNeg"),
            { mult: fmtMult(sigmaRatio) },
          )}
          worse={sigmaWorse}
          suit="diamond"
        />
        <PDVerdictRow
          label={t("pdv.worst")}
          ours={money(ours.maxDrawdownMean)}
          theirs={money(theirs.maxDrawdownMean)}
          delta={fmt(
            ddWorse ? t("pdv.worstDelta") : t("pdv.worstDeltaNeg"),
            { mult: fmtMult(ddRatio) },
          )}
          worse={ddWorse}
          suit="heart"
        />
        <PDVerdictRow
          label={t("pdv.breakeven")}
          ours={`${Math.round(ours.longestBreakevenMean)}t`}
          theirs={`${Math.round(theirs.longestBreakevenMean)}t`}
          delta={fmt(
            beDelta >= 0 ? t("pdv.breakevenDelta") : t("pdv.breakevenDeltaNeg"),
            { delta: fmtDelta(beDelta) },
          )}
          worse={beDelta > 0}
          suit="heart"
        />
        <PDVerdictRow
          label={t("pdv.itm")}
          ours={pct(ours.itmRate)}
          theirs={pct(theirs.itmRate)}
          delta={fmt(
            itmWorse ? t("pdv.itmDelta") : t("pdv.itmDeltaNeg"),
            { delta: fmtPp(itmPp) },
          )}
          worse={itmWorse}
          suit="spade"
        />
      </div>

      <div className="mt-5 rounded-lg border border-[color:var(--color-heart)]/30 bg-[color:var(--color-heart)]/5 p-4">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[color:var(--color-heart)]">
          {t("pdv.whyTitle")}
        </div>
        <ul className="flex flex-col gap-2 text-[12.5px] leading-relaxed text-[color:var(--color-fg-muted)]">
          <li className="flex gap-2">
            <span className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full bg-[color:var(--color-heart)]" />
            <span>{t("pdv.why1")}</span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full bg-[color:var(--color-heart)]" />
            <span>{t("pdv.why2")}</span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full bg-[color:var(--color-club)]" />
            <span>{t("pdv.why3")}</span>
          </li>
        </ul>
        <div className="mt-3 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/60 p-3 text-[11.5px] leading-relaxed text-[color:var(--color-fg-muted)]">
          <span className="mr-1 font-semibold text-[color:var(--color-fg)]">
            {t("pdv.externalTitle")}
          </span>
          {t("pdv.externalBody")}{" "}
          <a
            href="https://muchomota.substack.com/p/flaws-in-monte-carlo-simulations"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-dotted underline-offset-2 hover:text-[color:var(--color-fg)]"
          >
            muchomota, Substack 2024
          </a>
        </div>
        <div className="mt-3 border-t border-[color:var(--color-heart)]/20 pt-3 text-[12px] font-medium text-[color:var(--color-fg)]">
          {fmt(
            sigmaWorse || ddWorse ? t("pdv.takeaway") : t("pdv.takeawayNeg"),
            { mult: fmtMult(headlineRatio) },
          )}
        </div>
      </div>
    </Card>
  );
}

function PrimedopeDiff({
  primary,
  other,
}: {
  primary: SimulationResult;
  other: SimulationResult;
}) {
  const t = useT();
  const { money } = useMoneyFmt();
  const ours = primary.stats;
  const theirs = other.stats;
  const pctPp = (a: number, b: number) =>
    `${((a - b) * 100).toFixed(2)} pp`;
  const ratioPct = (a: number, b: number) =>
    `${((a / Math.max(1e-9, b) - 1) * 100).toFixed(1)} %`;
  const diffMoney = (a: number, b: number) =>
    `${a - b >= 0 ? "+" : "−"}${money(Math.abs(a - b))}`;
  const rows: { label: string; ours: string; theirs: string; delta: string }[] = [
    {
      label: t("pd.row.itm"),
      ours: pct(ours.itmRate),
      theirs: pct(theirs.itmRate),
      delta: pctPp(ours.itmRate, theirs.itmRate),
    },
    {
      label: t("pd.row.pprofit"),
      ours: pct(ours.probProfit),
      theirs: pct(theirs.probProfit),
      delta: pctPp(ours.probProfit, theirs.probProfit),
    },
    {
      label: t("pd.row.stdDev"),
      ours: money(ours.stdDev),
      theirs: money(theirs.stdDev),
      delta: ratioPct(ours.stdDev, theirs.stdDev),
    },
    {
      label: t("pd.row.sharpe"),
      ours: ours.sharpe.toFixed(3),
      theirs: theirs.sharpe.toFixed(3),
      delta: (ours.sharpe - theirs.sharpe).toFixed(3),
    },
    {
      label: t("pd.row.dd"),
      ours: money(ours.maxDrawdownMean),
      theirs: money(theirs.maxDrawdownMean),
      delta: ratioPct(ours.maxDrawdownMean, theirs.maxDrawdownMean),
    },
    {
      label: t("pd.row.ddWorst"),
      ours: money(ours.maxDrawdownWorst),
      theirs: money(theirs.maxDrawdownWorst),
      delta: diffMoney(ours.maxDrawdownWorst, theirs.maxDrawdownWorst),
    },
    {
      label: t("pd.row.longestBE"),
      ours: `${Math.round(ours.longestBreakevenMean)}t`,
      theirs: `${Math.round(theirs.longestBreakevenMean)}t`,
      delta: `${Math.round(ours.longestBreakevenMean - theirs.longestBreakevenMean)}t`,
    },
    {
      label: t("pd.row.var95"),
      ours: money(ours.var95),
      theirs: money(theirs.var95),
      delta: diffMoney(ours.var95, theirs.var95),
    },
    {
      label: t("pd.row.cvar"),
      ours: money(ours.cvar95),
      theirs: money(theirs.cvar95),
      delta: ratioPct(ours.cvar95, theirs.cvar95),
    },
    {
      label: t("pd.row.cvar99"),
      ours: money(ours.cvar99),
      theirs: money(theirs.cvar99),
      delta: ratioPct(ours.cvar99, theirs.cvar99),
    },
    {
      label: t("pd.row.worstRun"),
      ours: money(ours.min),
      theirs: money(theirs.min),
      delta: diffMoney(ours.min, theirs.min),
    },
    {
      label: t("pd.row.bestRun"),
      ours: money(ours.max),
      theirs: money(theirs.max),
      delta: diffMoney(ours.max, theirs.max),
    },
    {
      label: t("pd.row.ror"),
      ours: pct(ours.riskOfRuin),
      theirs: pct(theirs.riskOfRuin),
      delta: pctPp(ours.riskOfRuin, theirs.riskOfRuin),
    },
  ];
  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-[color:var(--color-fg)]">
            {t("pd.title")}
          </div>
          <div className="text-xs text-[color:var(--color-fg-dim)]">
            {t("pd.subtitle")}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider">
          <span className="flex items-center gap-1 text-[color:var(--color-fg-muted)]">
            <span className="inline-block h-1.5 w-3 rounded-sm bg-[#34d399]" />{" "}
            {t("pd.ours")}
          </span>
          <span className="flex items-center gap-1 text-[color:var(--color-fg-muted)]">
            <span className="inline-block h-1.5 w-3 rounded-sm bg-[#f472b6]" />{" "}
            {t("pd.theirs")}
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-[color:var(--color-border)] text-[10px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
              <th className="py-2 text-left font-medium">{t("pd.metric")}</th>
              <th className="py-2 text-right font-medium">{t("pd.ours")}</th>
              <th className="py-2 text-right font-medium">{t("pd.theirs")}</th>
              <th className="py-2 text-right font-medium">{t("pd.delta")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.label}
                className="border-b border-[color:var(--color-border)]/60 last:border-b-0"
              >
                <td className="py-2 text-[color:var(--color-fg-muted)]">
                  {r.label}
                </td>
                <td className="py-2 text-right font-semibold tabular-nums text-[color:var(--color-fg)]">
                  {r.ours}
                </td>
                <td className="py-2 text-right tabular-nums text-[#f472b6]">
                  {r.theirs}
                </td>
                <td className="py-2 text-right tabular-nums text-[color:var(--color-fg-muted)]">
                  {r.delta}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function MiniStat({
  label,
  value,
  tone,
  suit = "club",
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg";
  suit?: StatSuit;
}) {
  const toneColor =
    tone === "pos"
      ? "var(--color-success)"
      : tone === "neg"
        ? "var(--color-danger)"
        : "var(--color-fg)";
  return (
    <div
      className="flex flex-col gap-0.5 border-l-2 border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)]/50 px-3 py-2.5"
      style={{ borderLeftColor: SUIT_COLOR[suit] }}
    >
      <div className="eyebrow" style={{ color: SUIT_COLOR[suit] }}>
        {label}
      </div>
      <div
        className="font-mono text-[13px] font-semibold tabular-nums"
        style={{ color: toneColor }}
      >
        {value}
      </div>
    </div>
  );
}
