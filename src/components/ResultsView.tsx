"use client";

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ReactEventHandler,
} from "react";
import type uPlot from "uplot";
import type {
  FinishModelId,
  SimulationInput,
  SimulationResult,
  TournamentRow,
} from "@/lib/sim/types";
import { rankedRunIndices, type RunMode } from "@/lib/trajectorySelection";
import { useT, useLocale } from "@/lib/i18n/LocaleProvider";
import { useAdvancedMode } from "@/lib/ui/AdvancedModeProvider";
import { useLocalStorageState } from "@/lib/ui/useLocalStorageState";
import type { DictKey } from "@/lib/i18n/dict";
import { STANDARD_PRESETS } from "@/lib/sim/modelPresets";
import {
  DEFAULT_EXTREME_STYLES,
  DEFAULT_LINE_STYLE_PRESET,
  LINE_STYLE_PRESETS,
  LINE_STYLE_PRESET_META,
  LINE_STYLE_PRESET_ORDER,
  PRIMEDOPE_PANE_PRESET,
  applyLineStyleOverrides,
  isLineEnabled,
  loadExtremeStyles,
  loadLineStylePreset,
  loadLineStyleOverrides,
  saveExtremeStyles,
  saveLineStylePreset,
  saveLineStyleOverrides,
  type ExtremeKey,
  type ExtremeStyles,
  type LineStyle,
  type LineStylePreset,
  type LineStylePresetId,
  type LineStyleOverrides,
  type OverridableLineKey,
} from "@/lib/lineStyles";
import {
  buildRefLine,
  DEFAULT_REF_LINES,
  loadRefLines,
  roiLabel,
  saveRefLines,
  type RefLineConfig,
} from "@/lib/results/refLines";
import {
  computeSatelliteStats,
  hasSatelliteRow,
  isSatelliteOnlySchedule,
} from "@/lib/results/satellite";
import {
  computeExpectedRakebackCurve,
  shiftResultByRakeback,
  stripJackpots,
} from "@/lib/results/trajectoryTransforms";
import { visualDistanceToSeries } from "@/lib/results/trajectoryHitTest";
import type { ControlsState } from "./ControlsPanel";
import { UplotChart, type CursorInfo } from "./charts/UplotChart";
import { DistributionChart } from "./charts/DistributionChart";
import { ConvergenceChart } from "./charts/ConvergenceChart";
import { DecompositionChart } from "./charts/DecompositionChart";
import {
  BigStat,
  MiniStat,
  StatGroup,
} from "./results/StatCards";
import {
  OurModelWeaknessCard,
  PrimeDopeWeaknessCard,
  SettingsDumpCard,
} from "./results/ResultsPanels";
import { Card } from "./ui/Section";
import { InfoTooltip } from "./ui/Tooltip";
import type { AlignedData, Options } from "uplot";

// Typed map FinishModelId → DictKey. Adding a new FinishModelId without
// a dict entry is a compile error instead of a runtime "Cannot read
// properties of undefined (reading 'ru')" crash in LocaleProvider.
const FINISH_MODEL_LABEL_KEY: Record<FinishModelId, DictKey> = {
  "power-law": "model.power-law",
  "linear-skill": "model.linear-skill",
  "stretched-exp": "model.stretched-exp",
  "plackett-luce": "model.plackett-luce",
  uniform: "model.uniform",
  empirical: "model.empirical",
  "freeze-realdata-step": "model.freeze-realdata-step",
  "freeze-realdata-linear": "model.freeze-realdata-linear",
  "freeze-realdata-tilt": "model.freeze-realdata-tilt",
  "pko-realdata-step": "model.pko-realdata-step",
  "pko-realdata-linear": "model.pko-realdata-linear",
  "pko-realdata-tilt": "model.pko-realdata-tilt",
  "mystery-realdata-step": "model.mystery-realdata-step",
  "mystery-realdata-linear": "model.mystery-realdata-linear",
  "mystery-realdata-tilt": "model.mystery-realdata-tilt",
  "powerlaw-realdata-influenced": "model.powerlaw-realdata-influenced",
};

interface Props {
  result: SimulationResult;
  compareResult?: SimulationResult | null;
  bankroll?: number;
  schedule?: TournamentRow[];
  scheduleRepeats?: number;
  compareMode?: "random" | "primedope";
  modelPresetId?: string;
  finishModelId?: FinishModelId;
  finishModel?: SimulationInput["finishModel"];
  settings?: ControlsState;
  elapsedMs?: number | null;
  availableRuns?: number;
  activeRunIdx?: number;
  onSelectRun?: (idx: number) => void;
  backgroundStatus?: "idle" | "computing" | "full";
  onUsePdPayoutsChange?: (v: boolean) => void;
  onUsePdFinishModelChange?: (v: boolean) => void;
  onUsePdRakeMathChange?: (v: boolean) => void;
  pdOverrideResult?: SimulationResult | null;
  pdOverrideStatus?: "idle" | "running" | "done" | "error";
  pdOverrideProgress?: number;
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

type UnitMode = "money" | "abi";

interface UnitCtxValue extends MoneyFmt {
  unit: UnitMode;
  setUnit: (v: UnitMode) => void;
}

const defaultMoneyFmt: MoneyFmt = { money, compactMoney };
const MoneyFmtContext = createContext<UnitCtxValue>({
  ...defaultMoneyFmt,
  unit: "abi",
  setUnit: () => {},
});
const useMoneyFmt = () => useContext(MoneyFmtContext);

// ABI value for the current result — exposed via context so per-widget
// UnitScope providers can build their own ABI-denominated formatters
// without threading the scalar through every sub-component.
const AbiContext = createContext<number>(1);

/**
 * Per-widget unit toggle scope. Owns its own `money`/`abi` state, defaulting
 * to ABI, persisted under `tvs.unit.<id>.v1`. Any InlineUnitToggle rendered
 * inside will flip only this scope — sibling widgets stay independent.
 */
function UnitScope({ id, children }: { id: string; children: ReactNode }) {
  const abi = useContext(AbiContext);
  const storageKey = `tvs.unit.${id}.v1`;
  // Hydrate from localStorage lazily so SSR markup matches the first render
  // (default "abi") and we don't need a setState-in-effect for persistence.
  const [unit, setUnit] = useState<UnitMode>(() => {
    if (typeof localStorage === "undefined") return "abi";
    try {
      const v = localStorage.getItem(storageKey);
      return v === "money" || v === "abi" ? v : "abi";
    } catch {
      return "abi";
    }
  });
  // Persist whenever the user flips the toggle. useState setter `setUnit` is
  // referentially stable, so wrapping it in useCallback would be noise —
  // instead the context value closes over the stable setter directly.
  const persist = (v: UnitMode) => {
    setUnit(v);
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(storageKey, v);
    } catch {}
  };
  const value = useMemo<UnitCtxValue>(() => {
    const fmt = unit === "abi" ? makeAbiMoney(abi) : defaultMoneyFmt;
    return { ...fmt, unit, setUnit: persist };
    // persist closes over `storageKey` + stable setter; safe to ignore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit, abi, storageKey]);
  return (
    <MoneyFmtContext.Provider value={value}>
      {children}
    </MoneyFmtContext.Provider>
  );
}
const intFmt = (v: number) =>
  v.toLocaleString(undefined, { maximumFractionDigits: 0 });

/**
 * Delta displayed on the PD-badge row: how much PD's value differs from ours,
 * relative to ours. Positive ⇒ PD is higher (PD row shows ▲X%, matching how a
 * reader naturally parses "freezeouts are 13% more").
 */
function pctDelta(cur: number, pd: number): number | null {
  if (!Number.isFinite(cur) || !Number.isFinite(pd)) return null;
  const anchor = Math.abs(cur) > 1e-9 ? Math.abs(cur) : Math.abs(pd);
  if (anchor < 1e-9) return null;
  return (pd - cur) / anchor;
}

function mergedHistogramDomain(
  ...histograms: Array<{ binEdges: readonly number[] } | null | undefined>
): [number, number] | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (const hist of histograms) {
    const edges = hist?.binEdges;
    if (!edges || edges.length < 2) continue;
    lo = Math.min(lo, edges[0]);
    hi = Math.max(hi, edges[edges.length - 1]);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return undefined;
  return [lo, hi];
}

function histogramOfValues(
  values: ArrayLike<number>,
  bins = 40,
): { binEdges: number[]; counts: number[] } {
  const n = values.length;
  if (n === 0) return { binEdges: [0, 1], counts: [0] };
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    return { binEdges: [0, 1], counts: [0] };
  }
  if (hi === lo) {
    const span = Math.max(1, Math.abs(hi) * 0.1);
    lo -= span / 2;
    hi += span / 2;
  }
  const span = hi - lo;
  const edges = new Array<number>(bins + 1);
  for (let i = 0; i <= bins; i++) edges[i] = lo + (span * i) / bins;
  const counts = new Array<number>(bins).fill(0);
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    const raw = ((v - lo) / span) * bins;
    const idx = Math.max(0, Math.min(bins - 1, Math.floor(raw)));
    counts[idx]++;
  }
  return { binEdges: edges, counts };
}

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
    mean: "#fde047",
    p0015: "rgba(96,165,250,0.08)",
    p025: "rgba(96,165,250,0.18)",
    p15: "rgba(96,165,250,0.34)",
    paths: "rgba(96,165,250,0.24)",
  },
};


function TrajectoryPlot({
  assets,
  height,
  visibleRuns,
  trimTopPct = 0,
  trimBotPct = 0,
}: {
  assets: ReturnType<typeof buildTrajectoryAssets>;
  height: number;
  visibleRuns: number;
  trimTopPct?: number;
  trimBotPct?: number;
}) {
  const t = useT();
  const { compactMoney } = useMoneyFmt();
  const [cursor, setCursor] = useState<CursorInfo | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [plotReadyNonce, setPlotReadyNonce] = useState(0);
  const handlePlotReady = useCallback((plot: uPlot | null) => {
    plotRef.current = plot;
    if (plot) setPlotReadyNonce((n) => n + 1);
  }, []);
  const xs = assets.data[0] as ArrayLike<number>;
  const xMin = Number(xs[0] ?? 0);
  const xMax = Number(xs[xs.length - 1] ?? xMin);
  const [xZoomed, setXZoomed] = useState(false);
  const handleScaleChange = useCallback(
    (scaleKey: string, min: number | null, max: number | null) => {
      if (scaleKey !== "x") return;
      if (min == null || max == null || !Number.isFinite(min) || !Number.isFinite(max)) {
        setXZoomed((prev) => (prev ? false : prev));
        return;
      }
      const span = Math.max(1, xMax - xMin);
      const eps = span * 1e-6;
      const next = Math.abs(min - xMin) > eps || Math.abs(max - xMax) > eps;
      setXZoomed((prev) => (prev === next ? prev : next));
    },
    [xMin, xMax],
  );
  const resetZoom = useCallback(() => {
    const plot = plotRef.current;
    if (!plot) return;
    plot.setScale("x", { min: xMin, max: xMax });
  }, [xMin, xMax]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setXZoomed((prev) => (prev ? false : prev));
    });
    return () => cancelAnimationFrame(frame);
  }, [assets, xMin, xMax]);

  // Single source of truth for which series are currently visible.
  // Both the imperative visibility effect (flipping uPlot `show`) and the
  // hover nearest-line lookup read the same predicates — keeping them in
  // sync used to require mirroring two identical blocks.
  const visibilityGate = useMemo(() => {
    const showBands = visibleRuns > 0;
    const loQ = trimBotPct / 100;
    const hiQ = 1 - trimTopPct / 100;
    // Percentile gates mirror `computeYRange` — when trim cuts a band
    // out of the Y-range, hide the series too. Otherwise the line keeps
    // drawing past the axis frame and looks like a clipped smear.
    const includeP9985 = trimTopPct < 0.15;
    const includeP975 = trimTopPct < 2.5;
    const includeP85 = trimTopPct < 15;
    const includeP0015 = trimBotPct < 0.15;
    const includeP025 = trimBotPct < 2.5;
    const includeP15 = trimBotPct < 15;
    const includeBest = showBands && trimTopPct <= 0;
    const includeWorst = showBands && trimBotPct <= 0;
    const qByRank = assets.visibility.pathProfitQuantile;
    const isPathVisible = (rank: number): boolean => {
      if (rank >= visibleRuns) return false;
      const q = qByRank[rank] ?? 0;
      return q >= loQ && q <= hiQ;
    };
    const isBandVisible = (pct: number): boolean => {
      if (!showBands) return false;
      if (pct >= 0.99) return includeP9985;
      if (pct >= 0.9) return includeP975;
      if (pct >= 0.5) return includeP85;
      if (pct <= 0.01) return includeP0015;
      if (pct <= 0.1) return includeP025;
      return includeP15;
    };
    return { showBands, includeBest, includeWorst, isPathVisible, isBandVisible };
  }, [assets, visibleRuns, trimTopPct, trimBotPct]);
  const representativeBand = useMemo(
    () =>
      assets.mainLines.find((line) => line.kind === "band" && line.percentile === 0.15)
      ?? assets.mainLines.find((line) => line.kind === "band" && line.percentile === 0.85)
      ?? assets.mainLines.find((line) => line.kind === "band"),
    [assets.mainLines],
  );
  const legendItems = useMemo(() => {
    const ev = assets.mainLines.find((line) => line.label === "EV");
    const best = assets.mainLines.find((line) => line.kind === "best" && line.variant === "real")
      ?? assets.mainLines.find((line) => line.kind === "best");
    const overlay = assets.overlayLabel
      ? assets.mainLines.find((line) => line.label.startsWith(assets.overlayLabel ?? ""))
      : null;

    return [
      ev && {
        key: "ev",
        label: t("chart.traj.legend.ev"),
        color: ev.color,
        dash: true,
      },
      visibleRuns > 0 && {
        key: "runs",
        label: fmt(t("chart.traj.legend.runs"), {
          n: Math.min(visibleRuns, assets.visibility.pathSeriesIdx.length).toLocaleString(),
        }),
        color: assets.visibility.pathBasePreset.stroke,
      },
      visibilityGate.showBands && representativeBand && {
        key: "bands",
        label: t("chart.traj.legend.bands"),
        color: representativeBand.color,
      },
      visibilityGate.includeBest && best && {
        key: "extremes",
        label: t("chart.traj.legend.extremes"),
        color: best.color,
      },
      overlay && {
        key: "overlay",
        label: fmt(t("chart.traj.legend.overlay"), { label: assets.overlayLabel ?? "" }),
        color: overlay.color,
        dash: true,
      },
    ].filter(Boolean) as Array<{ key: string; label: string; color: string; dash?: boolean }>;
  }, [assets, representativeBand, t, visibleRuns, visibilityGate]);

  // Imperative visibility layer: instead of rebuilding the uPlot instance
  // on every slider tick, flip `show` on the pre-built path/band/best/worst
  // series. `plot.batch` collapses all the per-series toggles into a single
  // redraw, so a 0→500 drag costs one repaint, not five hundred.
  //
  // Also recalibrates per-path stroke/width for the *current* visible count —
  // trimming 500 → 5 survivors would otherwise leave them at mid-density ink
  // (near-invisible). Stroke + lineWidth are applied at draw time by uPlot,
  // so mutating `plot.series[i].stroke` and `.width` before the batch-close
  // redraw is enough to restyle without rebuilding the chart.
  useLayoutEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    const vis = assets.visibility;
    const { includeBest, includeWorst, isPathVisible, isBandVisible } = visibilityGate;
    if (plot.series.length !== assets.data.length) {
      // During an options rebuild React can briefly run this parent layout
      // effect against the previous uPlot instance. Wait for UplotChart's
      // onReady callback to hand us the matching instance instead.
      return;
    }
    const plotData = plot.data as AlignedData | undefined;
    const plotDataInSync =
      plotData?.length === assets.data.length &&
      assets.data.every((seriesData, idx) => {
        const currentData = plotData[idx] as ArrayLike<unknown> | undefined;
        return (
          currentData != null &&
          seriesData != null &&
          currentData.length === seriesData.length
        );
      });
    if (!plotDataInSync) {
      plot.setData(assets.data);
    }

    let visiblePathCount = 0;
    for (let r = 0; r < vis.pathSeriesIdx.length; r++) {
      if (isPathVisible(r)) visiblePathCount++;
    }
    const baseStyle = pathStyleForCount(
      vis.pathBasePreset,
      Math.max(1, visiblePathCount),
    );
    const [baseR, baseG, baseB] = parseRgb(baseStyle.stroke);
    const baseAlpha =
      Number(baseStyle.stroke.match(/rgba?\([^)]*?,([^,)]+)\)/i)?.[1] ?? 0.4);

    const safeSetSeries = (idx: number, show: boolean) => {
      if (!Number.isInteger(idx) || idx <= 0 || idx >= plot.series.length) return;
      plot.setSeries(idx, { show }, false);
    };

    plot.batch(() => {
      // uPlot wraps `series[i].stroke` in fnOrSelf at init, so after init
      // it's a function, not the raw string. Assigning a string here makes
      // the next redraw throw "s.stroke is not a function". Wrap in a thunk
      // to stay compatible with uPlot's call-site.
      const plotSeries = plot.series as Array<{ stroke?: unknown; width?: number }>;
      for (let r = 0; r < vis.pathSeriesIdx.length; r++) {
        const sIdx = vis.pathSeriesIdx[r];
        const visible = isPathVisible(r);
        if (visible) {
          const pol = vis.pathPolarityByRank[r] ?? 0;
          const boost = pol >= 0.98 ? 1.2 : 1;
          const alpha = Math.min(0.95, baseAlpha * boost);
          const width = baseStyle.width * boost;
          const s = plotSeries[sIdx];
          if (s) {
            const color = `rgba(${baseR},${baseG},${baseB},${alpha.toFixed(3)})`;
            s.stroke = () => color;
            s.width = width;
          }
        }
        safeSetSeries(sIdx, visible);
      }
      for (const { idx, percentile } of vis.bands) {
        safeSetSeries(idx, isBandVisible(percentile));
      }
      for (const sIdx of vis.bestSeriesIdxs) {
        safeSetSeries(sIdx, includeBest);
      }
      for (const sIdx of vis.worstSeriesIdxs) {
        safeSetSeries(sIdx, includeWorst);
      }
      for (const sIdx of vis.overlayBestSeriesIdxs) {
        safeSetSeries(sIdx, includeBest);
      }
      for (const sIdx of vis.overlayWorstSeriesIdxs) {
        safeSetSeries(sIdx, includeWorst);
      }
    });
    plot.redraw(false);
  }, [assets, visibilityGate, plotReadyNonce]);

  const idx = cursor?.idx;
  const tournaments = idx != null ? Math.round(xs[idx] ?? 0) : 0;
  const { showBands, includeBest, includeWorst, isPathVisible, isBandVisible } = visibilityGate;

  let nearest: TrajectoryLineMeta | null = null;
  let nearestVal = 0;
  let nearestVisual: TrajectoryLineMeta | null = null;
  let nearestVisualVal = 0;
  if (cursor && idx != null) {
    let bestDist = Infinity;
    let bestVisualPxDist = Infinity;
    for (const line of assets.mainLines) {
      if (line.kind === "path") {
        if (!isPathVisible(line.rank ?? 0)) continue;
      } else if (line.kind === "band") {
        if (line.percentile == null) {
          if (!showBands) continue;
        } else if (!isBandVisible(line.percentile)) {
          continue;
        }
      } else if (line.kind === "best") {
        if (!includeBest) continue;
      } else if (line.kind === "worst") {
        if (!includeWorst) continue;
      }
      const arr = assets.data[line.seriesIdx] as ArrayLike<number | null> | undefined;
      if (!arr) continue;
      const v = arr[idx];
      const hasVisibleValue = v != null && Number.isFinite(v);
      const tooltipValue = hasVisibleValue ? Number(v) : cursor.valY;
      if (hasVisibleValue) {
        const d = Math.abs(v - cursor.valY);
        if (d < bestDist) {
          bestDist = d;
          nearest = line;
          nearestVal = tooltipValue;
        }
      }
      const isHighlightable =
        line.kind === "path" ||
        line.kind === "best" ||
        line.kind === "worst" ||
        line.kind === "band";
      if (isHighlightable) {
        const pxDist = visualDistanceToSeries(
          cursor,
          assets.data[0] as ArrayLike<number>,
          arr,
        );
        if (pxDist < bestVisualPxDist) {
          bestVisualPxDist = pxDist;
          nearestVisual = line;
          nearestVisualVal = tooltipValue;
        }
      }
    }
    // Trust the visual hit-test over the value-only nearest line. That keeps
    // thin interval boundaries hoverable instead of letting nearby path
    // trajectories steal focus at the same x-index.
    if (nearestVisual) {
      const visualHitPx =
        nearestVisual.kind === "band"
          ? TRAJECTORY_BAND_HIT_PX
          : TRAJECTORY_PATH_HIT_PX;
      if (bestVisualPxDist <= visualHitPx) {
        nearest = nearestVisual;
        nearestVal = nearestVisualVal;
      } else {
        nearestVisual = null;
      }
    }
  }

  // Draw a bright highlight line on top of the focused path using a canvas
  // that sits inside uPlot's .over element for perfect alignment.
  const focusedLine =
    nearestVisual &&
    (nearestVisual.kind === "path" ||
      nearestVisual.kind === "best" ||
      nearestVisual.kind === "worst")
      ? nearestVisual
      : null;
  const focusedSeriesIdx = focusedLine?.seriesIdx ?? null;
  const focusedStatsSeriesIdx =
    focusedLine &&
    (focusedLine.kind === "path" || focusedLine.variant === "real")
      ? focusedLine.seriesIdx
      : null;
  const hlCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const cumBuyIn = tournaments * assets.buyInPerTourney;
  const roi = cumBuyIn > 0 ? nearestVal / cumBuyIn : 0;

  // Defer the series index used for O(N) path stats so it doesn't
  // recompute synchronously on every mousemove over the chart.
  const deferredFocusedIdx = useDeferredValue(focusedStatsSeriesIdx);
  // Compute on-the-fly run stats from the focused path for the detail strip.
  // Uses samplePaths.x to convert checkpoint indices to tournament counts.
  const focusedPathStats = useMemo(() => {
    if (deferredFocusedIdx == null) return null;
    const dataArr = assets.data[deferredFocusedIdx] as ArrayLike<number> | undefined;
    if (!dataArr || dataArr.length === 0) return null;
    const xArr = assets.data[0] as ArrayLike<number> | undefined;
    const len = dataArr.length;
    const finalProfit = dataArr[len - 1] ?? 0;
    const tourneyAt = (i: number) => (xArr ? (xArr[i] ?? i) : i);

    // Max drawdown: deepest drop from a running peak.
    let peak = -Infinity;
    let maxDD = 0;
    let ddStart = 0;
    let ddEnd = 0;
    let curPeakIdx = 0;
    for (let i = 0; i < len; i++) {
      const v = dataArr[i];
      if (v == null || !Number.isFinite(v)) continue;
      if (v > peak) { peak = v; curPeakIdx = i; }
      const dd = peak - v;
      if (dd > maxDD) { maxDD = dd; ddStart = curPeakIdx; ddEnd = i; }
    }
    const ddTourneys = Math.round(tourneyAt(ddEnd) - tourneyAt(ddStart));

    // Longest losing streak: consecutive declining checkpoints → in tournament units.
    let longestLosing = 0;
    let losingStartIdx = 0;
    let losingEndIdx = 0;
    let curLosingStart = 0;
    let curLosing = 0;
    for (let i = 1; i < len; i++) {
      const prev = dataArr[i - 1];
      const cur = dataArr[i];
      if (prev == null || cur == null) continue;
      if (cur < prev) {
        if (curLosing === 0) curLosingStart = i - 1;
        curLosing++;
        if (curLosing > longestLosing) {
          longestLosing = curLosing;
          losingStartIdx = curLosingStart;
          losingEndIdx = i;
        }
      } else curLosing = 0;
    }
    const losingTourneys = longestLosing > 0
      ? Math.round(tourneyAt(losingEndIdx) - tourneyAt(losingStartIdx))
      : 0;

    // Longest breakeven-or-worse: consecutive checkpoints at or below running peak.
    // Track the peak index that anchors the longest stretch — used by the
    // canvas overlay to mark the peak point and the below-peak x-range.
    let longestBE = 0;
    let beAnchorPeakIdx = 0;
    let beEndIdx = 0;
    let curBE = 0;
    let curBEAnchorPeakIdx = 0;
    peak = -Infinity;
    for (let i = 0; i < len; i++) {
      const v = dataArr[i];
      if (v == null || !Number.isFinite(v)) continue;
      if (v > peak) {
        peak = v;
        curBE = 0;
        curBEAnchorPeakIdx = i;
      } else {
        curBE++;
        if (curBE > longestBE) {
          longestBE = curBE;
          beAnchorPeakIdx = curBEAnchorPeakIdx;
          beEndIdx = i;
        }
      }
    }
    const beTourneys = longestBE > 0
      ? Math.round(tourneyAt(beEndIdx) - tourneyAt(beAnchorPeakIdx))
      : 0;
    const peakValue = longestBE > 0 ? dataArr[beAnchorPeakIdx] ?? null : null;

    return {
      finalProfit,
      maxDD,
      ddTourneys,
      ddStartIdx: maxDD > 0 ? ddStart : -1,
      ddEndIdx: maxDD > 0 ? ddEnd : -1,
      ddPeakValue: maxDD > 0 ? (dataArr[ddStart] ?? null) : null,
      losingTourneys,
      beTourneys,
      peakValue,
    };
  }, [deferredFocusedIdx, assets.data]);

  // Canvas overlay: base highlight of the focused path + deepest drawdown.
  // Draws on uPlot's .over element so everything stays in plot coordinates.
  // Layering (back → front):
  //   1. Amber stroke of the full focused path
  //   2. Red stroke of the deepest peak-to-trough drawdown segment
  //   3. Red dot at the drawdown's anchor peak
  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    let canvas = hlCanvasRef.current;
    if (!canvas || !plot.over.contains(canvas)) {
      canvas = document.createElement("canvas");
      canvas.style.position = "absolute";
      canvas.style.left = "0";
      canvas.style.top = "0";
      canvas.style.pointerEvents = "none";
      canvas.style.zIndex = "5";
      plot.over.appendChild(canvas);
      hlCanvasRef.current = canvas;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = plot.over.clientWidth;
    const h = plot.over.clientHeight;
    const dpr = devicePixelRatio;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (focusedSeriesIdx == null) return;
    const dataArr = assets.data[focusedSeriesIdx] as ArrayLike<number> | undefined;
    const xArr = assets.data[0] as ArrayLike<number>;
    if (!dataArr || !xArr) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();

    const strokeSegment = (
      startIdx: number,
      endIdx: number,
      stroke: string,
      width: number,
    ) => {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.lineJoin = "round";
      ctx.beginPath();
      let started = false;
      for (let i = startIdx; i <= endIdx; i++) {
        const xVal = xArr[i];
        const yVal = dataArr[i];
        if (xVal == null || yVal == null || !Number.isFinite(yVal)) continue;
        const px = plot.valToPos(xVal, "x", false);
        const py = plot.valToPos(yVal, "y", false);
        if (!started) { ctx.moveTo(px, py); started = true; }
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    };

    // Base: full path in amber.
    strokeSegment(0, xArr.length - 1, "rgba(253,230,138,0.9)", 2.5);

    // Stats-driven highlights. Only when mouse is actually focusing a path
    // (deferredFocusedIdx matches focusedStatsSeriesIdx) to avoid flicker
    // during fast scrubs across different paths.
    if (
      focusedPathStats &&
      deferredFocusedIdx === focusedStatsSeriesIdx
    ) {
      const { ddStartIdx, ddEndIdx, ddPeakValue } = focusedPathStats;

      if (ddStartIdx >= 0 && ddEndIdx > ddStartIdx) {
        strokeSegment(ddStartIdx, ddEndIdx, "rgba(248,113,113,0.95)", 3);
      }
      if (ddStartIdx >= 0 && ddPeakValue != null) {
        const xVal = xArr[ddStartIdx];
        if (xVal != null) {
          const px = plot.valToPos(xVal, "x", false);
          const py = plot.valToPos(ddPeakValue, "y", false);
          ctx.save();
          ctx.fillStyle = "rgba(248,113,113,1)";
          ctx.strokeStyle = "rgba(255,255,255,0.95)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(px, py, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      }
    }
    ctx.restore();
  }, [focusedSeriesIdx, focusedStatsSeriesIdx, assets.data, focusedPathStats, deferredFocusedIdx]);

  const kindLabel = (line: TrajectoryLineMeta): string => {
    switch (line.kind) {
      case "mean": return t("chart.traj.kind.mean");
      case "band": return t("chart.traj.kind.band");
      case "best": return t(line.variant === "agg" ? "chart.traj.kind.bestAgg" : "chart.traj.kind.bestReal");
      case "worst": return t(line.variant === "agg" ? "chart.traj.kind.worstAgg" : "chart.traj.kind.worstReal");
      case "path": return t("chart.traj.kind.path");
      case "ref": return t("chart.traj.kind.ref");
    }
  };
  const tooltipLabel = (line: TrajectoryLineMeta): string => {
    if (line.kind !== "band" || line.percentile == null) return line.label;
    return fmt(t("chart.traj.band.title"), {
      coverage: formatTrajectoryBandCoverage(line.percentile),
      side: t(trajectoryBandSideKey(line.percentile)),
    });
  };
  const likelihood = (line: TrajectoryLineMeta): string | null => {
    if (line.kind === "ref") return null;
    // Path lines don't get a likelihood line — each is just one of many runs.
    if (line.kind === "path") return null;
    if (line.kind === "best") {
      return t(line.variant === "agg" ? "chart.traj.likelihood.bestAgg" : "chart.traj.likelihood.bestReal");
    }
    if (line.kind === "worst") {
      return t(line.variant === "agg" ? "chart.traj.likelihood.worstAgg" : "chart.traj.likelihood.worstReal");
    }
    if (line.percentile != null) {
      const pct = line.percentile;
      if (pct === 0.5) return t("chart.traj.likelihood.median");
      const tail = pct < 0.5 ? pct : 1 - pct;
      const key = pct < 0.5
        ? "chart.traj.likelihood.below"
        : "chart.traj.likelihood.above";
      return fmt(t(key), { pct: (tail * 100).toFixed(1) });
    }
    return null;
  };

  return (
    <div className="relative w-full">
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {legendItems.map((item) => (
              <span
                key={item.key}
                className="inline-flex max-w-full items-center gap-1.5 rounded border border-[color:var(--color-border)]/55 bg-[color:var(--color-bg)]/55 px-2 py-1 text-[10px] font-medium text-[color:var(--color-fg-muted)]"
              >
                <span
                  className={`inline-block h-0 w-5 border-t-2 ${item.dash ? "border-dashed" : ""}`}
                  style={{ borderColor: item.color }}
                  aria-hidden
                />
                <span className="truncate">{item.label}</span>
              </span>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-[color:var(--color-fg-dim)]">
            <span>{t("chart.traj.zoomHint")}</span>
            {visibleRuns > 0 && (
              <>
                <span className="text-[color:var(--color-border-strong)]">/</span>
                <span className="inline-flex items-center gap-1">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{
                      background: "rgba(248,113,113,1)",
                      boxShadow: "0 0 0 1px rgba(255,255,255,0.9)",
                    }}
                    aria-hidden
                  />
                  {t("chart.traj.hoverHint.peak")}
                </span>
                <span className="inline-flex items-center gap-1">
                  <span
                    className="inline-block h-[3px] w-3 rounded-sm"
                    style={{ background: "rgba(248,113,113,0.95)" }}
                    aria-hidden
                  />
                  {t("chart.traj.hoverHint.maxDd")}
                </span>
              </>
            )}
            {visibilityGate.showBands && representativeBand && (
              <>
                <span className="text-[color:var(--color-border-strong)]">/</span>
                <span className="inline-flex items-center gap-1">
                  <span
                    className="inline-block h-0 w-3 border-t-2"
                    style={{ borderColor: representativeBand.color }}
                    aria-hidden
                  />
                  {t("chart.traj.hoverHint.band")}
                </span>
              </>
            )}
          </div>
        </div>
        {xZoomed && (
          <button
            type="button"
            onClick={resetZoom}
            className="shrink-0 rounded border border-[color:var(--color-accent)]/50 bg-[color:var(--color-bg)]/85 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-[color:var(--color-accent)] shadow-sm transition hover:bg-[color:var(--color-accent)] hover:text-black"
            title={t("chart.traj.resetZoom")}
          >
            {t("chart.traj.resetZoom")}
          </button>
        )}
      </div>
      <UplotChart
        data={assets.data}
        options={assets.opts}
        height={height}
        onCursor={setCursor}
        onPlotReady={handlePlotReady}
        onScaleChange={handleScaleChange}
        onDoubleClick={resetZoom}
      />
      {cursor && idx != null && nearest && (
        <div
          className="pointer-events-none z-10 mt-2 min-w-[220px] overflow-hidden rounded-md border border-[color:var(--color-border-strong)] bg-[color:var(--color-bg)]/95 text-[11px] shadow-xl backdrop-blur"
        >
          <div
            className="flex items-center gap-2 px-3 py-1.5"
            style={{
              background: `linear-gradient(90deg, ${nearest.color}22 0%, transparent 70%)`,
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <span
              className="inline-block h-2.5 w-3 rounded-sm"
              style={{ background: nearest.color }}
            />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg)]">
              {tooltipLabel(nearest)}
            </span>
            <span className="ml-auto text-[9px] text-[color:var(--color-fg-dim)]">
              {kindLabel(nearest)}
            </span>
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 py-2 tabular-nums">
            <span className="text-[color:var(--color-fg-dim)]">tournaments</span>
            <span className="text-right font-semibold text-[color:var(--color-fg)]">
              {tournaments.toLocaleString()}
            </span>
            <span className="text-[color:var(--color-fg-dim)]">profit</span>
            <span
              className="text-right font-semibold"
              style={{
                color:
                  nearestVal >= 0
                    ? "var(--color-success)"
                    : "var(--color-danger)",
              }}
            >
              {compactMoney(nearestVal)}
            </span>
            <span className="text-[color:var(--color-fg-dim)]">ROI</span>
            <span
              className="text-right font-semibold"
              style={{
                color:
                  cumBuyIn > 0 && roi >= 0
                    ? "var(--color-success)"
                    : cumBuyIn > 0
                      ? "var(--color-danger)"
                      : "var(--color-fg)",
              }}
            >
              {cumBuyIn > 0 ? `${(roi * 100).toFixed(1)}%` : "—"}
            </span>
          </div>
          {likelihood(nearest) && (
            <div className="border-t border-[color:var(--color-border)]/50 px-3 py-1 text-[10px] text-[color:var(--color-fg-dim)]">
              {likelihood(nearest)}
            </div>
          )}
          {focusedPathStats && (
            <div className="border-t border-[color:var(--color-border)]/50 px-3 py-2">
              <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
                {t("chart.traj.runStats")}
              </div>
              {/* Hero row: max DD — one number shown in $ with an ABI pill. */}
              <div className="mb-1.5 rounded-sm bg-[color:var(--color-danger)]/8 px-2 py-1.5">
                <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-[color:var(--color-danger)]">
                  <span
                    className="inline-block h-0.5 w-3 rounded-full"
                    style={{ background: "rgba(248,113,113,0.95)" }}
                    aria-hidden
                  />
                  {t("chart.traj.maxDD")}
                </div>
                <div className="mt-0.5 flex items-baseline gap-1.5 tabular-nums">
                  <span className="text-[13px] font-bold text-[color:var(--color-danger)]">
                    {compactMoney(focusedPathStats.maxDD)}
                  </span>
                  {assets.buyInPerTourney > 0 && (
                    <span className="rounded-sm bg-[color:var(--color-danger)]/12 px-1 py-0.5 text-[9px] font-semibold text-[color:var(--color-danger)]">
                      {(focusedPathStats.maxDD / assets.buyInPerTourney).toFixed(1)}{" "}
                      {t("chart.traj.abi")}
                    </span>
                  )}
                </div>
                {focusedPathStats.ddTourneys > 0 && (
                  <div className="mt-0.5 text-[9px] text-[color:var(--color-fg-dim)]">
                    {fmt(t("chart.traj.ddDuration"), {
                      n: focusedPathStats.ddTourneys.toLocaleString(),
                    })}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums">
                <span className="text-[color:var(--color-fg-dim)]">
                  {t("chart.traj.finalProfit")}
                </span>
                <span
                  className="text-right font-semibold"
                  style={{
                    color:
                      focusedPathStats.finalProfit >= 0
                        ? "var(--color-success)"
                        : "var(--color-danger)",
                  }}
                >
                  {compactMoney(focusedPathStats.finalProfit)}
                </span>
                <span className="text-[color:var(--color-fg-dim)]">
                  {t("chart.traj.longestLosing")}
                </span>
                <span className="text-right text-[color:var(--color-fg)]">
                  {focusedPathStats.losingTourneys.toLocaleString()}{" "}
                  {t("chart.traj.tourneys")}
                </span>
                <span className="text-[color:var(--color-fg-dim)]">
                  {t("chart.traj.longestBE")}
                </span>
                <span className="text-right text-[color:var(--color-fg)]">
                  {focusedPathStats.beTourneys.toLocaleString()}{" "}
                  {t("chart.traj.tourneys")}
                </span>
              </div>
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
  /** For best/worst lines: "real" = single sample path, "agg" = pointwise envelope. */
  variant?: "real" | "agg";
  /** Display rank for path lines — the i-th most-preferred run to show.
   *  Undefined for non-path lines. Used to skip hidden paths in the cursor
   *  tooltip so it never highlights an invisible series. */
  rank?: number;
}

/** Extract r,g,b from a CSS color string — supports rgb/rgba/#rrggbb. Returns
 *  [200,200,200] as a soft fallback so path rendering never crashes on an
 *  unexpected preset value. */
function parseRgb(css: string): [number, number, number] {
  const m = css.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  const hex = css.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  }
  return [200, 200, 200];
}

const TRAJECTORY_PATH_HIT_PX = 20;
const TRAJECTORY_BAND_HIT_PX = 18;

/** Per-run path color + width scaled to the number of visible runs.
 *  Few runs → brighter, thicker, visually distinct. Many runs → faint,
 *  thinner, so the envelope underneath still reads through the crowd. */
function pathStyleForCount(
  base: LineStyle,
  count: number,
): { stroke: string; width: number } {
  const [r, g, b] = parseRgb(base.stroke);
  const n = Math.max(1, count);
  const alpha = Math.min(0.9, Math.max(0.04, 0.9 / Math.sqrt(n)));
  const width = Math.min(1.6, Math.max(0.55, 1.55 - 0.115 * Math.log2(n)));
  return { stroke: `rgba(${r},${g},${b},${alpha.toFixed(3)})`, width };
}

function formatTrajectoryBandCoverage(percentile: number): string {
  const centralPct = (1 - 2 * Math.min(percentile, 1 - percentile)) * 100;
  const rounded =
    Math.abs(centralPct - Math.round(centralPct)) < 0.05
      ? Math.round(centralPct).toString()
      : centralPct.toFixed(1);
  return `${rounded}%`;
}

function trajectoryBandSideKey(
  percentile: number,
): "chart.traj.band.side.lower" | "chart.traj.band.side.upper" {
  return percentile < 0.5
    ? "chart.traj.band.side.lower"
    : "chart.traj.band.side.upper";
}

/** Metadata for the imperative visibility layer: which uPlot series indices
 *  correspond to path runs (in rank order), percentile bands, and best/worst
 *  highlight lines. The trajectory chart keeps these series alive across
 *  slider drags and calls `plot.setSeries(i, { show })` to toggle them,
 *  avoiding a full uPlot teardown on every frame. */
interface TrajectoryVisibilityMap {
  pathSeriesIdx: number[];
  pathProfitQuantile: number[];
  /** |2q−1| per rank — drives the ±polarity boost applied on top of the
   *  density-calibrated baseline alpha/width. Kept parallel to `pathSeriesIdx`
   *  so the trim-aware restyler can recompute strokes without hitting the
   *  full-index profit sort again. */
  pathPolarityByRank: Float64Array;
  /** Base LineStyle for the path family (preset.path). The visibility effect
   *  reruns `pathStyleForCount` with the current visible count and mutates
   *  each path series' stroke/width — so trimming from 500 → 5 actually
   *  brightens the survivors instead of leaving them at mid-density ink. */
  pathBasePreset: LineStyle;
  /** Each band tagged by its percentile so the visibility layer can gate
   *  it by the same trim thresholds that `computeYRange` uses. Without
   *  this, the Y-range drops clipped tails but the series keep drawing —
   *  you see lines leaving the axis frame. */
  bands: { idx: number; percentile: number }[];
  bestSeriesIdxs: number[];
  worstSeriesIdxs: number[];
  overlayBestSeriesIdxs: number[];
  overlayWorstSeriesIdxs: number[];
}

function buildTrajectoryAssets(
  r: SimulationResult,
  hue: AccentHue,
  yRange?: { min: number; max: number },
  overlay?: SimulationResult | null,
  axisFmt: (v: number) => string = compactMoney,
  preset: LineStylePreset = LINE_STYLE_PRESETS[DEFAULT_LINE_STYLE_PRESET],
  maxPathCount: number = 1000,
  refLines: RefLineConfig[] = DEFAULT_REF_LINES,
  lineOverrides: LineStyleOverrides = {},
  runMode: RunMode = "random",
  extremeStyles: ExtremeStyles = DEFAULT_EXTREME_STYLES,
  overlayLabel: string = "PrimeDope",
): {
  data: AlignedData;
  opts: Omit<Options, "width" | "height">;
  refStartIdx: number;
  buyInPerTourney: number;
  mainLines: TrajectoryLineMeta[];
  visibility: TrajectoryVisibilityMap;
  overlayLabel: string | null;
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

  // Build *all* path series up front (capped at maxPathCount), so the
  // "runs shown" slider only toggles visibility instead of recreating the
  // uPlot instance. The imperative visibility layer in TrajectoryPlot
  // hides the trailing paths + bands + best/worst when the user drags the
  // slider — driven by plot.setSeries() on a stable series layout.
  const rankedIndices = rankedRunIndices(r.samplePaths.paths, runMode);
  const builtPathCount = Math.min(maxPathCount, rankedIndices.length);
  // Fix the per-path alpha/width to a mid-density compromise so the chart
  // still reads when most paths are hidden. The slider used to scale these
  // live, which forced an options rebuild on every tick.
  const pathStyle = pathStyleForCount(
    preset.path,
    Math.max(1, Math.min(builtPathCount, 80)),
  );
  const [pathR, pathG, pathB] = parseRgb(pathStyle.stroke);
  const basePathAlpha =
    Number(pathStyle.stroke.match(/rgba?\([^)]*?,([^,)]+)\)/i)?.[1] ?? 0.4);
  // Profit-rank by final value so paths near the poles pop against the
  // middle mass — alpha grows with polarity², width gets a linear boost.
  // Median paths stay faint so the envelope still reads.
  const totalPaths = r.samplePaths.paths.length;
  const profitPolarity = new Float64Array(totalPaths);
  const profitQuantile = new Float64Array(totalPaths);
  if (totalPaths > 0) {
    const order: { idx: number; v: number }[] = new Array(totalPaths);
    for (let i = 0; i < totalPaths; i++) {
      const p = r.samplePaths.paths[i];
      order[i] = { idx: i, v: p.length > 0 ? p[p.length - 1] : 0 };
    }
    order.sort((a, b) => a.v - b.v);
    const denom = Math.max(1, totalPaths - 1);
    for (let k = 0; k < totalPaths; k++) {
      const q = k / denom;
      profitQuantile[order[k].idx] = q;
      profitPolarity[order[k].idx] = Math.abs(2 * q - 1);
    }
  }
  const pathSeriesIdx: number[] = [];
  const pathProfitQuantile: number[] = [];
  const pathPolarityList: number[] = [];
  const bands: { idx: number; percentile: number }[] = [];
  const bestSeriesIdxs: number[] = [];
  const worstSeriesIdxs: number[] = [];
  const overlayBestSeriesIdxs: number[] = [];
  const overlayWorstSeriesIdxs: number[] = [];

  // EV reference line — straight slope from 0 to expected profit.
  // Uses the preset's ev style (dashed by default). Toggled via Customize.
  if (isLineEnabled("ev", lineOverrides)) {
    const evSlope = r.expectedProfit / (x[x.length - 1] || 1);
    const evIdx = pushSeries(buildRefLine(x, evSlope), {
      stroke: preset.ev.stroke,
      width: preset.ev.width,
      dash: preset.ev.dash,
    });
    mainLines.push({
      label: "EV",
      color: preset.ev.stroke,
      seriesIdx: evIdx,
      kind: "ref",
    });
  }

  {
    const p0015Idx = pushSeries(r.envelopes.p0015, {
      show: false,
      stroke: preset.bandExtreme.stroke,
      width: preset.bandExtreme.width,
    });
    const p9985Idx = pushSeries(r.envelopes.p9985, {
      show: false,
      stroke: preset.bandExtreme.stroke,
      width: preset.bandExtreme.width,
    });
    const p025Idx = pushSeries(r.envelopes.p025, {
      show: false,
      stroke: preset.bandWide.stroke,
      width: preset.bandWide.width,
    });
    const p975Idx = pushSeries(r.envelopes.p975, {
      show: false,
      stroke: preset.bandWide.stroke,
      width: preset.bandWide.width,
    });
    const p15Idx = pushSeries(r.envelopes.p15, {
      show: false,
      stroke: preset.bandNarrow.stroke,
      width: preset.bandNarrow.width,
    });
    const p85Idx = pushSeries(r.envelopes.p85, {
      show: false,
      stroke: preset.bandNarrow.stroke,
      width: preset.bandNarrow.width,
    });
    bands.push(
      { idx: p0015Idx, percentile: 0.0015 },
      { idx: p9985Idx, percentile: 0.9985 },
      { idx: p025Idx, percentile: 0.025 },
      { idx: p975Idx, percentile: 0.975 },
      { idx: p15Idx, percentile: 0.15 },
      { idx: p85Idx, percentile: 0.85 },
    );
    mainLines.push(
      { label: "p0.15", color: preset.bandExtreme.stroke, seriesIdx: p0015Idx, percentile: 0.0015, kind: "band" },
      { label: "p99.85", color: preset.bandExtreme.stroke, seriesIdx: p9985Idx, percentile: 0.9985, kind: "band" },
      { label: "p2.5", color: preset.bandWide.stroke, seriesIdx: p025Idx, percentile: 0.025, kind: "band" },
      { label: "p97.5", color: preset.bandWide.stroke, seriesIdx: p975Idx, percentile: 0.975, kind: "band" },
      { label: "p15", color: preset.bandNarrow.stroke, seriesIdx: p15Idx, percentile: 0.15, kind: "band" },
      { label: "p85", color: preset.bandNarrow.stroke, seriesIdx: p85Idx, percentile: 0.85, kind: "band" },
    );
  }

  for (let rank = 0; rank < builtPathCount; rank++) {
    const runIdx = rankedIndices[rank];
    const pol = profitPolarity[runIdx];
    // Only the top/bottom ~1% by profit get a small (+20%) bump — every other
    // path renders at the baseline stroke so the bulk reads as a flat flock.
    const boost = pol >= 0.98 ? 1.2 : 1;
    const alpha = Math.min(0.95, basePathAlpha * boost);
    const width = pathStyle.width * boost;
    const stroke = `rgba(${pathR},${pathG},${pathB},${alpha.toFixed(3)})`;
    const idx = pushSeries(r.samplePaths.paths[runIdx], { show: false, stroke, width });
    pathSeriesIdx.push(idx);
    pathProfitQuantile.push(profitQuantile[runIdx]);
    pathPolarityList.push(pol);
    mainLines.push({
      label: `Run ${runIdx + 1}`,
      color: stroke,
      seriesIdx: idx,
      kind: "path",
      rank,
    });
  }

  // Real = solid bold; aggregated = lighter dashed. On the PrimeDope pane
  // (`hue === "magenta"`) we override to blue so the overlay reads as "same
  // entity" across both views; the main pane takes user-picked colors from
  // the inline toolbar toggles.
  const isPdPane = hue === "magenta";
  const realStroke = (key: "realBest" | "realWorst") =>
    isPdPane ? "#60a5fa" : extremeStyles[key].color;
  const aggStroke = (key: "aggBest" | "aggWorst") =>
    isPdPane ? "#93c5fd" : extremeStyles[key].color;
  const realWidth = 2.25;
  const aggWidth = 2;
  const aggDash: number[] = [10, 5];
  if (extremeStyles.realBest.enabled) {
    const stroke = realStroke("realBest");
    const idx = pushSeries(r.samplePaths.best, { show: false, stroke, width: realWidth });
    bestSeriesIdxs.push(idx);
    mainLines.push({ label: "Real best run", color: stroke, seriesIdx: idx, kind: "best", variant: "real" });
  }
  if (extremeStyles.aggBest.enabled) {
    const stroke = aggStroke("aggBest");
    const idx = pushSeries(r.envelopes.max, { show: false, stroke, width: aggWidth, dash: aggDash });
    bestSeriesIdxs.push(idx);
    mainLines.push({ label: "Aggregated best", color: stroke, seriesIdx: idx, kind: "best", variant: "agg" });
  }
  if (extremeStyles.realWorst.enabled) {
    const stroke = realStroke("realWorst");
    const idx = pushSeries(r.samplePaths.worst, { show: false, stroke, width: realWidth });
    worstSeriesIdxs.push(idx);
    mainLines.push({ label: "Real worst run", color: stroke, seriesIdx: idx, kind: "worst", variant: "real" });
  }
  if (extremeStyles.aggWorst.enabled) {
    const stroke = aggStroke("aggWorst");
    const idx = pushSeries(r.envelopes.min, { show: false, stroke, width: aggWidth, dash: aggDash });
    worstSeriesIdxs.push(idx);
    mainLines.push({ label: "Aggregated worst", color: stroke, seriesIdx: idx, kind: "worst", variant: "agg" });
  }

  // Optional p5/p95 envelope lines — hidden by default, toggled from the
  // line-style popup. Drawn regardless of `visibleRuns` since they're
  // percentile envelopes, not sample paths.
  if (isLineEnabled("p05", lineOverrides) && r.envelopes.p05) {
    const p05Idx = pushSeries(r.envelopes.p05, {
      stroke: preset.p05.stroke,
      width: preset.p05.width,
      dash: preset.p05.dash,
    });
    mainLines.push({
      label: "p5",
      color: preset.p05.stroke,
      seriesIdx: p05Idx,
      percentile: 0.05,
      kind: "band",
    });
  }
  if (isLineEnabled("p95", lineOverrides) && r.envelopes.p95) {
    const p95Idx = pushSeries(r.envelopes.p95, {
      stroke: preset.p95.stroke,
      width: preset.p95.width,
      dash: preset.p95.dash,
    });
    mainLines.push({
      label: "p95",
      color: preset.p95.stroke,
      seriesIdx: p95Idx,
      percentile: 0.95,
      kind: "band",
    });
  }

  // Bankroll ruin line removed — it stretched the y-axis far below the
  // data envelope, wasting vertical space on both panes. The bankroll
  // value is still shown in the stats widgets.

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

  // Neutral zero line — a simple straight rule at y=0. Drawn once, solid,
  // in a muted grey so it reads as an axis reference rather than another
  // data series. Removes the prior optical doubling where a separate dashed
  // EV series rode right on top of the empirical mean at large N.
  const zeroLineIdx = pushSeries(buildRefLine(x, 0), {
    stroke: "#6b7280",
    width: 1,
    label: "zero",
  });
  mainLines.push({
    label: "zero",
    color: "#6b7280",
    seriesIdx: zeroLineIdx,
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
    // Overlay mirrors whichever main lines are currently enabled — best/worst
    // (if visible runs > 0) and the p05/p95 envelope toggles. Mean and EV are
    // intentionally excluded: mean overlays add no new info (centers coincide
    // by construction) and PD's near-zero EV read as a mysterious dashed zero
    // line that users misread as a bug.
    const overlayColor = "#60a5fa";
    const overlayWidth = 1.75;
    const pushOverlay = (
      src: Float64Array,
      label: string,
      kind: TrajectoryLineMeta["kind"],
      dash?: number[],
    ): number => {
      const idx = pushSeries(resample(src), {
        stroke: overlayColor,
        width: overlayWidth,
        dash,
        label,
      });
      mainLines.push({ label, color: overlayColor, seriesIdx: idx, kind });
      return idx;
    };
    // Blue hue family for PD overlay extremes — keeps the "this is PD"
    // signal while matching the real-vs-agg language of the main lines. All
    // overlay lines are dashed on this pane so the user can tell at a glance
    // which curves belong to the PD reference vs the primary simulation;
    // the PD pane on the right renders the same colors without dashes.
    const pushOverlayExtreme = (
      src: Float64Array,
      label: string,
      kind: TrajectoryLineMeta["kind"],
      variant: "real" | "agg",
    ): number => {
      const stroke = variant === "real" ? "#3b82f6" : "#93c5fd";
      const width = variant === "real" ? 2.25 : 2;
      const dash = variant === "real" ? [12, 7] : [18, 9];
      const idx = pushSeries(resample(src), { show: false, stroke, width, dash, label });
      mainLines.push({ label, color: stroke, seriesIdx: idx, kind, variant });
      return idx;
    };
    if (extremeStyles.realBest.enabled) {
      overlayBestSeriesIdxs.push(
        pushOverlayExtreme(overlay.samplePaths.best as Float64Array, `${overlayLabel} real best`, "best", "real"),
      );
    }
    if (extremeStyles.aggBest.enabled) {
      overlayBestSeriesIdxs.push(
        pushOverlayExtreme(overlay.envelopes.max as Float64Array, `${overlayLabel} agg best`, "best", "agg"),
      );
    }
    if (extremeStyles.realWorst.enabled) {
      overlayWorstSeriesIdxs.push(
        pushOverlayExtreme(overlay.samplePaths.worst as Float64Array, `${overlayLabel} real worst`, "worst", "real"),
      );
    }
    if (extremeStyles.aggWorst.enabled) {
      overlayWorstSeriesIdxs.push(
        pushOverlayExtreme(overlay.envelopes.min as Float64Array, `${overlayLabel} agg worst`, "worst", "agg"),
      );
    }
    if (isLineEnabled("p05", lineOverrides) && overlay.envelopes.p05) {
      pushOverlay(overlay.envelopes.p05, `${overlayLabel} p5`, "band", [10, 6]);
    }
    if (isLineEnabled("p95", lineOverrides) && overlay.envelopes.p95) {
      pushOverlay(overlay.envelopes.p95, `${overlayLabel} p95`, "band", [10, 6]);
    }
  }

  return {
    refStartIdx,
    buyInPerTourney,
    mainLines,
    overlayLabel: overlay ? overlayLabel : null,
    visibility: {
      pathSeriesIdx,
      pathProfitQuantile,
      pathPolarityByRank: Float64Array.from(pathPolarityList),
      pathBasePreset: preset.path,
      bands,
      bestSeriesIdxs,
      worstSeriesIdxs,
      overlayBestSeriesIdxs,
      overlayWorstSeriesIdxs,
    },
    data: series as AlignedData,
    opts: {
      scales: {
        x: { time: false },
        // Explicit literal range + auto:false, so every pane in a twin view
        // gets the SAME pixel-to-$ mapping regardless of which envelope curve
        // happens to be the global min/max. Closure-based `range: () => [...]`
        // was causing uPlot to re-evaluate against its own autoRange on some
        // refreshes, leaving the two panes with slightly different y-extents
        // and making the PrimeDope overlay appear to float relative to the
        // right pane.
        y: yRange
          ? {
              auto: false,
              range: [yRange.min, yRange.max] as [number, number],
            }
          : { auto: true },
      },
      axes: [
        {
          stroke: "#94a3b8",
          grid: { stroke: "rgba(148,163,184,0.13)", width: 1 },
          ticks: { stroke: "rgba(148,163,184,0.24)" },
        },
        {
          stroke: "#94a3b8",
          grid: { stroke: "rgba(148,163,184,0.16)", width: 1 },
          ticks: { stroke: "rgba(148,163,184,0.26)" },
          size: 72,
          values: (_u, splits) => splits.map(axisFmt),
        },
      ],
      series: uplotSeries,
      legend: { show: false },
      focus: { alpha: 1 },
      cursor: {
        drag: { x: true, y: false },
        focus: { prox: 0 },
      },
    },
  };
}

// Y-axis fits the visible mass (p025/p975 ≈ 95% coverage + mean) PLUS every
// path the user has actually revealed via the visibleRuns slider. p0015/p9985
// are deliberately excluded as a baseline: on heavy-tailed PKO/Mystery
// distributions their ±3σ tail reaches jackpot territory ($25k+) while the
// bulk of paths live in a few $k. But once the user raises visibleRuns toward
// the cap, the rendered flock extends past p975 (5% of N paths fall outside),
// so we union in the min/max of exactly the paths `TrajectoryPlot` will show.
function computeYRange(
  results: readonly SimulationResult[],
  extremeStyles: ExtremeStyles,
  visibleRuns: number,
  runMode: RunMode,
  trimTopPct: number = 0,
  trimBotPct: number = 0,
): { min: number; max: number } {
  let lo = Infinity;
  let hi = -Infinity;
  const min = (a: Float64Array | readonly number[]) => {
    for (const v of a) if (v < lo) lo = v;
  };
  const max = (a: Float64Array | readonly number[]) => {
    for (const v of a) if (v > hi) hi = v;
  };
  const wantHi =
    extremeStyles.realBest.enabled || extremeStyles.aggBest.enabled;
  const wantLo =
    extremeStyles.realWorst.enabled || extremeStyles.aggWorst.enabled;
  // Envelope inclusion gated by trim %: trimming past a percentile band's
  // tail end drops that band from the Y-range so the axis can actually shrink.
  const includeP9985 = trimTopPct < 0.15;
  const includeP975 = trimTopPct < 2.5;
  const includeP85 = trimTopPct < 15;
  const includeP0015 = trimBotPct < 0.15;
  const includeP025 = trimBotPct < 2.5;
  const includeP15 = trimBotPct < 15;
  for (const r of results) {
    if (wantHi && includeP9985) max(r.envelopes.p9985);
    if (wantLo && includeP0015) min(r.envelopes.p0015);
    if (includeP025) min(r.envelopes.p025);
    if (includeP975) max(r.envelopes.p975);
    if (includeP15) min(r.envelopes.p15);
    if (includeP85) max(r.envelopes.p85);
    min(r.envelopes.mean);
    max(r.envelopes.mean);
    if (extremeStyles.realBest.enabled && trimTopPct <= 0) max(r.samplePaths.best);
    if (extremeStyles.realWorst.enabled && trimBotPct <= 0) min(r.samplePaths.worst);
    if (extremeStyles.aggBest.enabled && trimTopPct <= 0) max(r.envelopes.max);
    if (extremeStyles.aggWorst.enabled && trimBotPct <= 0) min(r.envelopes.min);
    if (visibleRuns > 0 && r.samplePaths.paths.length > 0) {
      const total = r.samplePaths.paths.length;
      const order: { idx: number; v: number }[] = new Array(total);
      for (let i = 0; i < total; i++) {
        const p = r.samplePaths.paths[i];
        order[i] = { idx: i, v: p.length > 0 ? p[p.length - 1] : 0 };
      }
      order.sort((a, b) => a.v - b.v);
      const qDenom = Math.max(1, total - 1);
      const quantileByIdx = new Float64Array(total);
      for (let k = 0; k < total; k++) {
        quantileByIdx[order[k].idx] = k / qDenom;
      }
      const loQ = trimBotPct / 100;
      const hiQ = 1 - trimTopPct / 100;
      const ranked = rankedRunIndices(r.samplePaths.paths, runMode);
      const cap = Math.min(visibleRuns, ranked.length);
      for (let k = 0; k < cap; k++) {
        const runIdx = ranked[k];
        const q = quantileByIdx[runIdx];
        if (q < loQ || q > hiQ) continue;
        const p = r.samplePaths.paths[runIdx];
        for (let i = 0; i < p.length; i++) {
          const v = p[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) {
    return { min: -1, max: 1 };
  }
  const pad = (hi - lo) * 0.08;
  return { min: lo - pad, max: hi + pad };
}

function ResultsViewImpl({
  result,
  compareResult,
  bankroll = 0,
  schedule,
  scheduleRepeats,
  compareMode = "primedope",
  modelPresetId,
  finishModelId,
  finishModel,
  settings,
  elapsedMs,
  availableRuns = 0,
  activeRunIdx = 0,
  onSelectRun,
  backgroundStatus = "idle",
  onUsePdPayoutsChange,
  onUsePdFinishModelChange,
  onUsePdRakeMathChange,
  pdOverrideResult,
  pdOverrideStatus = "idle",
  pdOverrideProgress = 0,
}: Props) {
  const t = useT();
  const { advanced } = useAdvancedMode();

  const pdChart = pdOverrideResult ?? result.comparison;
  // When comparing against PrimeDope on a PKO schedule, the right pane
  // actually shows "same schedule, bounties stripped" because PrimeDope
  // has no PKO support — useSimulation swaps the pass. Detect from the
  // schedule so we can relabel the pane and explain the substitution.
  const hasPko = (schedule ?? []).some(
    (r) => (r.bountyFraction ?? 0) > 0,
  );
  const pdPkoFallback = compareMode === "primedope" && hasPko;
  const overlayLabel = pdPkoFallback ? t("chart.overlay.freezeouts") : "PrimeDope";

  // Default ON in compare mode: the whole point of the side-by-side view is
  // to see how the two models differ, and the tail-level differences live in
  // the histograms (max-DD, final profit), not the trajectory fan.
  const [overlayPd, setOverlayPd] = useState(true);

  // Shared RB view switch — drives trajectory + profit-histogram + scalar-
  // shiftable stats (BigStat expectedProfit / probProfit, and their PD twins).
  // Engine bakes RB into everything, so default matches engine output when
  // RB > 0; toggling OFF reveals the game-only view. Drawdown / streak stats
  // stay as engine output since RB reshapes those nonlinearly.
  const rbFrac = Math.max(0, (settings?.rakebackPct ?? 0) / 100);
  // Rakeback %, schedule, and repeats all feed a chain of heavy post-hoc
  // memos below (share-curve rebuild + shifted trajectory/distribution
  // clones on the stored chart assets).
  // Typing in the rakeback field or clicking through the buy-in / format
  // dropdown would otherwise block the keystroke on that whole chain.
  // Defer the values so the input frame commits first; React then re-runs
  // the heavy memos behind the input. `rbRecomputing` drives a small
  // "пересчёт…" badge so the gap between click and visible update isn't
  // read as "frozen".
  const deferredRbFrac = useDeferredValue(rbFrac);
  const deferredSchedule = useDeferredValue(schedule);
  const deferredScheduleRepeats = useDeferredValue(scheduleRepeats);
  const rbRecomputing =
    rbFrac !== deferredRbFrac ||
    schedule !== deferredSchedule ||
    scheduleRepeats !== deferredScheduleRepeats;
  const rakebackCurve = useMemo(
    () =>
      deferredSchedule && deferredScheduleRepeats != null
        ? computeExpectedRakebackCurve(
            deferredSchedule,
            deferredScheduleRepeats,
            deferredRbFrac,
            result.samplePaths.x,
            advanced,
          )
        : null,
    [
      advanced,
      deferredSchedule,
      deferredScheduleRepeats,
      deferredRbFrac,
      result.samplePaths.x,
    ],
  );
  const pdRakebackCurve = useMemo(
    () =>
      pdChart && deferredSchedule && deferredScheduleRepeats != null
        ? computeExpectedRakebackCurve(
            deferredSchedule,
            deferredScheduleRepeats,
            deferredRbFrac,
            pdChart.samplePaths.x,
            advanced,
          )
        : null,
    [advanced, pdChart, deferredSchedule, deferredScheduleRepeats, deferredRbFrac],
  );
  // Four independent region toggles — each controls whether its region
  // shows RB baked in (engine default) or subtracts it for the game-only view.
  // All default to rbFrac > 0 so initial view matches engine output.
  const [rbTraj, setRbTraj] = useState<boolean>(rbFrac > 0);
  const [rbStats, setRbStats] = useState<boolean>(rbFrac > 0);
  const [rbDist, setRbDist] = useState<boolean>(rbFrac > 0);
  // Mystery / mystery-royale jackpot runs are a handful of samples out of
  // hundreds of thousands, but their ratio ≥ 100× mean envelope blows up
  // the distribution x-axis and the trajectory y-axis. Toggle strips them
  // from both charts using the deterministic `jackpotMask` stored on the
  // result. Only surfaced when the schedule contains a mystery row so
  // non-mystery runs don't see a dead checkbox.
  const hasMysteryRow = useMemo(
    () =>
      schedule?.some(
        (r) =>
          r.gameType === "mystery" || r.gameType === "mystery-royale",
      ) ?? false,
    [schedule],
  );
  const hideJackpotsTouchedRef = useRef(false);
  const [hideJackpots, setHideJackpotsState] = useState<boolean>(true);
  const deferredHideJackpots = useDeferredValue(hideJackpots);
  const setHideJackpots = useCallback((next: boolean) => {
    hideJackpotsTouchedRef.current = true;
    setHideJackpotsState(next);
  }, []);
  useEffect(() => {
    if (hasMysteryRow && !hideJackpotsTouchedRef.current) {
      // Mystery/BR tails are real data, but one early jackpot can make the
      // default fan unreadable. Keep the raw run available behind the checkbox.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronizes the default with the detected schedule format until the user touches it.
      setHideJackpotsState(true);
    }
  }, [hasMysteryRow]);
  // rbFrac change resets each region toggle back to default. Users can flip
  // individual regions after; a new rbFrac (e.g. rakeback % edit in controls)
  // wipes those overrides. Four sets in one pass — React batches them.
  useEffect(() => {
    const on = rbFrac > 0;
    /* eslint-disable react-hooks/set-state-in-effect */
    setRbTraj(on);
    setRbStats(on);
    setRbDist(on);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [rbFrac]);
  // Build chart-facing variants separately from stats-facing variants so chart
  // filters like "hide jackpots" never leak into the scalar stats panels.
  const resultForCharts = useMemo(
    () => (deferredHideJackpots ? stripJackpots(result) : result),
    [result, deferredHideJackpots],
  );
  const pdChartForCharts = useMemo(
    () => (deferredHideJackpots && pdChart ? stripJackpots(pdChart) : pdChart),
    [pdChart, deferredHideJackpots],
  );
  const resultChartsNoRb = useMemo(
    () =>
      rakebackCurve
        ? shiftResultByRakeback(resultForCharts, rakebackCurve, -1)
        : resultForCharts,
    [resultForCharts, rakebackCurve],
  );
  const pdChartChartsNoRb = useMemo(
    () =>
      pdChartForCharts && pdRakebackCurve
        ? shiftResultByRakeback(pdChartForCharts, pdRakebackCurve, -1)
        : pdChartForCharts,
    [pdChartForCharts, pdRakebackCurve],
  );
  const resultStatsNoRb = useMemo(
    () => (rakebackCurve ? shiftResultByRakeback(result, rakebackCurve, -1) : result),
    [result, rakebackCurve],
  );
  const pdChartStatsNoRb = useMemo(
    () =>
      pdChart && pdRakebackCurve
        ? shiftResultByRakeback(pdChart, pdRakebackCurve, -1)
        : pdChart,
    [pdChart, pdRakebackCurve],
  );
  const pickChartResult = (on: boolean) =>
    on ? resultForCharts : resultChartsNoRb;
  const pickChartPd = (on: boolean) =>
    on ? pdChartForCharts : pdChartChartsNoRb;
  const displayResultTraj = pickChartResult(rbTraj);
  const displayPdChartTraj = pickChartPd(rbTraj);
  const displayResultStats = rbStats ? result : resultStatsNoRb;
  const displayPdChartStats = rbStats ? pdChart : pdChartStatsNoRb;
  const displayResultDist = pickChartResult(rbDist);
  const displayPdChartDist = pickChartPd(rbDist);
  // Keep drawdown / streak / recovery views on the engine's full-sample
  // output. Recomputing them from stored hi-res paths would silently switch
  // the UI from "all samples" to "~1000 saved samples" and overstate
  // precision.
  const displayResultStreaks = result;
  const displayPdChartStreaks = pdChart;

  // Freeze the profit-dist x domain across both RB states so toggling
  // rbDist translates the bars inside a stable axis instead of auto-rescaling.
  const distProfitXDomain = useMemo<[number, number] | undefined>(() => {
    if (!rakebackCurve) return undefined;
    return mergedHistogramDomain(
      result.histogram,
      resultChartsNoRb.histogram,
      pdChart?.histogram,
      pdChartChartsNoRb?.histogram,
    );
  }, [
    rakebackCurve,
    result,
    resultChartsNoRb,
    pdChart,
    pdChartChartsNoRb,
  ]);
  const streakDrawdownXDomain = useMemo<[number, number] | undefined>(
    () =>
      mergedHistogramDomain(
        displayResultStreaks.drawdownHistogram,
        displayPdChartStreaks?.drawdownHistogram,
      ),
    [displayResultStreaks, displayPdChartStreaks],
  );
  const streakBreakevenXDomain = useMemo<[number, number] | undefined>(() => {
    return mergedHistogramDomain(
      displayResultStreaks.longestBreakevenHistogram,
      displayPdChartStreaks?.longestBreakevenHistogram,
    );
  }, [displayResultStreaks, displayPdChartStreaks]);
  const streakRecoveryXDomain = useMemo<[number, number] | undefined>(() => {
    return mergedHistogramDomain(
      displayResultStreaks.recoveryHistogram,
      displayPdChartStreaks?.recoveryHistogram,
    );
  }, [displayResultStreaks, displayPdChartStreaks]);

  const shiftedStats = displayResultStats.stats;
  const shiftedPdStats = displayPdChartStats?.stats;
  const s = result.stats;
  const pdStats = pdChart?.stats;
  const pdExpectedProfit = displayPdChartStats?.expectedProfit;
  const pdBadgeLabel = pdPkoFallback ? t("stat.pd.badge.freezeouts") : undefined;
  const roi = shiftedStats.mean / displayResultStats.totalBuyIn;
  const expectedProfitRangeRatio =
    Math.abs(shiftedStats.max - shiftedStats.min) > 1e-9
      ? (displayResultStats.expectedProfit - shiftedStats.min) /
        (shiftedStats.max - shiftedStats.min)
      : 0.5;
  const bankrollSafetyRatio =
    Number.isFinite(s.minBankrollRoR5pct) &&
    Number.isFinite(s.minBankrollRoR1pct) &&
    s.minBankrollRoR1pct > s.minBankrollRoR5pct
      ? (bankroll - s.minBankrollRoR5pct) /
        (s.minBankrollRoR1pct - s.minBankrollRoR5pct)
      : 0.5;
  const modelPreset = modelPresetId
    ? STANDARD_PRESETS.find((p) => p.id === modelPresetId)
    : undefined;
  const modelLabel = modelPreset
    ? t(modelPreset.labelKey)
    : finishModelId
    ? t(FINISH_MODEL_LABEL_KEY[finishModelId])
    : t("twin.runA");

  const abi = useMemo(() => {
    const xs = result.samplePaths.x;
    const lastX = xs[xs.length - 1] || 1;
    return result.totalBuyIn / lastX;
  }, [result]);
  const [unit, setUnit] = useState<UnitMode>("abi");
  const moneyFmt = useMemo<UnitCtxValue>(() => {
    const fmt = unit === "abi" ? makeAbiMoney(abi) : defaultMoneyFmt;
    return { ...fmt, unit, setUnit };
  }, [unit, abi]);
  // Shadow the module-level formatter inside ResultsView so existing
  // money(...) call sites pick up the unit-aware pair.
  const { money } = moneyFmt;
  const tourneysWord = t("unit.tourneys");

  const [lineStylePresetId, setLineStylePresetId] =
    useLocalStorageState<LineStylePresetId>(
      "tvs.lineStylePreset.v1",
      loadLineStylePreset,
      saveLineStylePreset,
      DEFAULT_LINE_STYLE_PRESET,
    );
  const [lineOverrides, setLineOverrides] =
    useLocalStorageState<LineStyleOverrides>(
      "tvs.lineStyleOverrides.v1",
      loadLineStyleOverrides,
      saveLineStyleOverrides,
      {},
    );
  const linePreset = useMemo(
    () => applyLineStyleOverrides(LINE_STYLE_PRESETS[lineStylePresetId], lineOverrides),
    [lineStylePresetId, lineOverrides],
  );
  const maxRunsAvailable = displayResultTraj.samplePaths.paths.length;
  const runsCap = Math.min(1000, maxRunsAvailable);
  const maxRuns = runsCap;
  // Desired slider value is preserved even when a new sim lowers maxRuns
  // temporarily — we re-clamp on each render instead of mutating state in
  // an effect (which would trip react-hooks/set-state-in-effect).
  const [desiredVisibleRuns, setDesiredVisibleRuns] = useState(Math.min(100, maxRuns));
  const visibleRuns = Math.min(desiredVisibleRuns, maxRuns);
  const setVisibleRuns = setDesiredVisibleRuns;
  const [runMode, setRunMode] = useState<RunMode>("random");
  const deferredRunMode = useDeferredValue(runMode);
  const [trimTopPct, setTrimTopPct] = useState<number>(0);
  const [trimBotPct, setTrimBotPct] = useState<number>(0);
  const effectiveTrimTopPct = advanced ? trimTopPct : 0;
  const effectiveTrimBotPct = advanced ? trimBotPct : 0;
  const deferredTrimTopPct = useDeferredValue(effectiveTrimTopPct);
  const deferredTrimBotPct = useDeferredValue(effectiveTrimBotPct);
  // Heavy trajectory rebuild (uPlot series allocation + path binding) lags
  // on every drag tick when maxRuns is in the hundreds. useDeferredValue keeps
  // the slider input responsive by letting the chart catch up asynchronously.
  const deferredVisibleRuns = useDeferredValue(visibleRuns);

  const [refLines, setRefLines] = useLocalStorageState<RefLineConfig[]>(
    "tvs.refLines.v1",
    loadRefLines,
    saveRefLines,
    DEFAULT_REF_LINES,
  );

  // Stabilize the TrajectoryCard toolbar so unrelated re-renders (schedule
  // keystrokes, language switches) don't recreate this JSX subtree — combined
  // with memo(TrajectoryCard) this skips reconciliation for the whole card.
  const trajectoryToolbar = useMemo(
    () => (
      <div className="flex flex-col gap-2.5 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-[color:var(--color-border)]/80 bg-[color:var(--color-bg-elev)]/55 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
          <div className="rounded-sm border border-[color:var(--color-border)]/70 bg-[color:var(--color-bg)]/70 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-[color:var(--color-fg-dim)]">
            {t("lineStyle.label")}
          </div>
          <LineStylePresetPicker
            value={lineStylePresetId}
            onChange={setLineStylePresetId}
          />
          <LineStyleCustomizer
            preset={LINE_STYLE_PRESETS[lineStylePresetId]}
            overrides={lineOverrides}
            onChange={setLineOverrides}
            t={t}
          />
          <RefLineCustomizer value={refLines} onChange={setRefLines} t={t} />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-[color:var(--color-border)]/80 bg-[color:var(--color-bg-elev)]/55 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
          {advanced && (
            <>
              <TrimPctSlider
                label={t("runs.trim.worst")}
                value={trimBotPct}
                onChange={setTrimBotPct}
              />
              <TrimPctSlider
                label={t("runs.trim.best")}
                value={trimTopPct}
                onChange={setTrimTopPct}
              />
            </>
          )}
          <div className="rounded-sm border border-[color:var(--color-border)]/70 bg-[color:var(--color-bg)]/70 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-[color:var(--color-fg-dim)]">
            {t("runs.label")}
          </div>
          <input
            type="range"
            min={0}
            max={maxRuns}
            step={1}
            value={visibleRuns}
            onChange={(e) => setVisibleRuns(Number(e.target.value))}
            className="h-1.5 w-28 cursor-pointer accent-[color:var(--color-accent)]"
            aria-label={t("runs.label")}
          />
          {advanced ? (
            <>
              <input
                type="number"
                min={0}
                max={maxRuns}
                step={1}
                value={visibleRuns}
                onChange={(e) => {
                  const raw = Number(e.target.value);
                  if (!Number.isFinite(raw)) return;
                  setVisibleRuns(Math.max(0, Math.min(maxRuns, Math.round(raw))));
                }}
                className="w-14 rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/75 px-1 py-1 text-center font-mono text-[11px] tabular-nums text-[color:var(--color-fg)] focus:border-[color:var(--color-accent)] focus:outline-none"
                aria-label={t("runs.label")}
                title={`max ${maxRuns} (captured paths)`}
              />
              <span className="font-mono text-[10px] tabular-nums text-[color:var(--color-fg-dim)]">
                /{maxRuns}
              </span>
            </>
          ) : (
            <span className="min-w-[4.5rem] rounded-sm border border-[color:var(--color-border)]/60 bg-[color:var(--color-bg)]/55 px-2 py-1 text-right font-mono text-[11px] tabular-nums text-[color:var(--color-fg-muted)]">
              {visibleRuns}/{maxRuns}
            </span>
          )}
          <RunModeSlider value={runMode} onChange={setRunMode} t={t} />
          <InlineUnitToggle />
        </div>
      </div>
    ),
    [
      t,
      lineStylePresetId,
      setLineStylePresetId,
      lineOverrides,
      setLineOverrides,
      refLines,
      setRefLines,
      advanced,
      trimBotPct,
      setTrimBotPct,
      trimTopPct,
      setTrimTopPct,
      maxRuns,
      visibleRuns,
      setVisibleRuns,
      runMode,
      setRunMode,
    ],
  );

  return (
    <AbiContext.Provider value={abi}>
    <MoneyFmtContext.Provider value={moneyFmt}>
    <div className="flex flex-col gap-5">
      {advanced && availableRuns > 0 && onSelectRun ? (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--color-fg-dim)]">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">
            {t("seedBatch.label")}
          </span>
          <button
            type="button"
            onClick={() => onSelectRun(Math.max(0, activeRunIdx - 1))}
            disabled={activeRunIdx <= 0}
            className="border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-2 py-0.5 font-mono text-[11px] text-[color:var(--color-fg)] hover:border-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={t("seedBatch.prev")}
          >
            ‹
          </button>
          <span className="font-mono tabular-nums text-[color:var(--color-fg)]">
            {activeRunIdx + 1}/{availableRuns}
          </span>
          <button
            type="button"
            onClick={() =>
              onSelectRun(Math.min(availableRuns - 1, activeRunIdx + 1))
            }
            disabled={activeRunIdx >= availableRuns - 1}
            className="border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-2 py-0.5 font-mono text-[11px] text-[color:var(--color-fg)] hover:border-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={t("seedBatch.next")}
          >
            ›
          </button>
          {backgroundStatus === "computing" ? (
            <span className="italic">{t("seedBatch.computing")}</span>
          ) : backgroundStatus === "full" ? (
            <span>{t("seedBatch.full")}</span>
          ) : null}
        </div>
      ) : null}
      {(rakebackCurve || hasMysteryRow || rbRecomputing) && (
        <div className="flex items-center justify-between gap-4 -mb-1">
          <div
            className={`flex items-center gap-1.5 text-[11px] text-[color:var(--color-fg-muted)] transition-opacity duration-150 ${
              rbRecomputing ? "opacity-100" : "opacity-0"
            }`}
            aria-live="polite"
          >
            <span
              className="inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-400"
              aria-hidden
            />
            <span className="uppercase tracking-wider text-indigo-300/80">
              {t("chart.recomputing")}
            </span>
          </div>
          <div className="flex items-center gap-4">
          {hasMysteryRow && (
            <label
              className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[color:var(--color-fg-muted)]"
              title={t("chart.hideJackpots.title")}
            >
              <input
                type="checkbox"
                checked={hideJackpots}
                onChange={(e) => setHideJackpots(e.target.checked)}
                className="h-3.5 w-3.5 accent-amber-400"
              />
              <span className="uppercase tracking-wider text-amber-400/80">
                {t("chart.hideJackpots")}
              </span>
            </label>
          )}
          {rakebackCurve && (
            <label
              className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[color:var(--color-fg-muted)]"
              title={t("chart.trajectory.withRakeback.title")}
            >
              <input
                type="checkbox"
                checked={rbTraj}
                onChange={(e) => setRbTraj(e.target.checked)}
                className="h-3.5 w-3.5 accent-lime-400"
              />
              <span className="uppercase tracking-wider text-lime-400/80">
                {t("chart.trajectory.withRakeback")}
              </span>
            </label>
          )}
          </div>
        </div>
      )}
      <UnitScope id="trajectory">
        <TrajectoryCard
          settings={settings}
          result={result}
          displayResult={displayResultTraj}
          compareResult={compareResult ?? null}
          bankroll={bankroll}
          overlayPd={overlayPd}
          setOverlayPd={setOverlayPd}
          pdChart={pdChart ?? null}
          displayPdChart={displayPdChartTraj ?? null}
          showWithRakeback={rbTraj}
          pdPkoFallback={pdPkoFallback}
          compareMode={compareMode}
          schedule={schedule}
          scheduleRepeats={scheduleRepeats}
          modelLabel={modelLabel}
          linePreset={linePreset}
          lineOverrides={lineOverrides}
          visibleRuns={deferredVisibleRuns}
          runMode={deferredRunMode}
          trimTopPct={deferredTrimTopPct}
          trimBotPct={deferredTrimBotPct}
          refLines={refLines}
          toolbar={trajectoryToolbar}
          pdPresetFlip={modelPresetId === "primedope" && compareMode === "primedope"}
          honestLabel={
            finishModelId
              ? t(FINISH_MODEL_LABEL_KEY[finishModelId])
              : t("twin.runB")
          }
          modelPresetId={modelPresetId}
          usePdPayouts={settings?.usePrimedopePayouts ?? true}
          onUsePdPayoutsChange={onUsePdPayoutsChange}
          usePdFinishModel={settings?.usePrimedopeFinishModel ?? true}
          onUsePdFinishModelChange={onUsePdFinishModelChange}
          usePdRakeMath={settings?.usePrimedopeRakeMath ?? true}
          onUsePdRakeMathChange={onUsePdRakeMathChange}
          pdOverrideStatus={pdOverrideStatus}
          pdOverrideProgress={pdOverrideProgress}
        />
      </UnitScope>

      {hasSatelliteRow(schedule) &&
        !isSatelliteOnlySchedule(schedule) &&
        scheduleRepeats != null && (
          <SatelliteCard
            result={result}
            schedule={schedule!}
            scheduleRepeats={scheduleRepeats}
            bankroll={bankroll}
            allSatellite={false}
          />
        )}


      {advanced && (
        <CollapsibleSection
          id="pdReport"
          title={t("section.primedopeReport")}
          showUnitToggle={false}
        >
          <PrimedopeReportCard result={result} />
        </CollapsibleSection>
      )}

      {advanced && (
        <CollapsibleSection
          id="settingsDump"
          title={t("section.settingsDump")}
          showUnitToggle={false}
        >
          <SettingsDumpCard settings={settings} schedule={schedule} result={result} elapsedMs={elapsedMs} />
        </CollapsibleSection>
      )}

      {advanced && result.comparison && compareMode === "primedope" && (
        <CollapsibleSection
          id="pdDiff"
          title={pdPkoFallback ? t("section.pdDiff.freezeouts") : t("section.pdDiff")}
        >
          <PrimedopeDiff
            primary={result}
            other={result.comparison}
            theirsLabel={pdPkoFallback ? t("chart.overlay.freezeouts") : undefined}
            title={pdPkoFallback ? t("pd.title.freezeouts") : undefined}
            subtitle={pdPkoFallback ? t("pd.subtitle.freezeouts") : undefined}
            hasBounty={hasPko}
          />
        </CollapsibleSection>
      )}

      {rakebackCurve && (
        <div className="flex items-center justify-end -mb-1">
          <label
            className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[color:var(--color-fg-muted)]"
            title={t("chart.rakeback.profitOnly.title")}
          >
            <input
              type="checkbox"
              checked={rbStats}
              onChange={(e) => setRbStats(e.target.checked)}
              className="h-3.5 w-3.5 accent-lime-400"
            />
            <span className="uppercase tracking-wider text-lime-400/80">
              {t("chart.trajectory.withRakeback")}
            </span>
          </label>
        </div>
      )}
      {rakebackCurve && (
        <div className="-mt-1 mb-1 text-right text-[10px] leading-snug text-[color:var(--color-fg-dim)]">
          {t("chart.rakeback.fullSampleNote")}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <BigStat
          suit="club"
          label={t("stat.expectedProfit")}
          value={money(displayResultStats.expectedProfit)}
          rangeSubline={{
            label: t("stat.range.spread"),
            fromLabel: t("stat.range.from"),
            toLabel: t("stat.range.to"),
            pointLabel: t("stat.range.pointEv"),
            pointHint: t("stat.range.pointHint"),
            minValue: money(shiftedStats.min),
            maxValue: money(shiftedStats.max),
            anchorRatio: expectedProfitRangeRatio,
          }}
          sub={t("stat.expectedProfit.sub")
            .replace("{min}", money(shiftedStats.min))
            .replace("{max}", money(shiftedStats.max))}
          tip={t("stat.expectedProfit.tip")
            .replace("{mean}", money(shiftedStats.mean))
            .replace("{roi}", `${(roi * 100).toFixed(1)}%`)
            .replace("{median}", money(shiftedStats.median))}
          tone={displayResultStats.expectedProfit >= 0 ? "pos" : "neg"}
          pdValue={pdExpectedProfit != null ? money(pdExpectedProfit) : undefined}
          pdDelta={
            pdExpectedProfit != null
              ? pctDelta(displayResultStats.expectedProfit, pdExpectedProfit)
              : null
          }
          pdLabel={pdBadgeLabel}
        />
        <BigStat
          suit="spade"
          label={t("stat.probProfit")}
          value={pct(shiftedStats.probProfit)}
          outcomeSubline={{
            label: t("stat.probProfit.outcome"),
            leftLabel: t("stat.probProfit.outcome.down"),
            rightLabel: t("stat.probProfit.outcome.up"),
            leftValue: pct(1 - shiftedStats.probProfit),
            rightValue: pct(shiftedStats.probProfit),
            ratio: shiftedStats.probProfit,
          }}
          sub={t("stat.probProfit.sub").replace(
            "{n}",
            intFmt(shiftedStats.tournamentsFor95ROI),
          )}
          tip={t("stat.tFor95.sub")}
          pdValue={shiftedPdStats ? pct(shiftedPdStats.probProfit) : undefined}
          pdDelta={
            shiftedPdStats
              ? pctDelta(shiftedStats.probProfit, shiftedPdStats.probProfit)
              : null
          }
          pdLabel={pdBadgeLabel}
        />
        <BigStat
          suit="heart"
          label={t("stat.riskOfRuin")}
          value={pct(s.riskOfRuin)}
          rangeSubline={
            s.riskOfRuin === 0 && result.stats.minBankrollRoR1pct === 0
              ? undefined
              : {
                  label: t("stat.riskOfRuin.range"),
                  fromLabel: t("stat.riskOfRuin.range.from"),
                  toLabel: t("stat.riskOfRuin.range.to"),
                  pointLabel: t("stat.riskOfRuin.range.point"),
                  pointHint: t("stat.riskOfRuin.range.hint"),
                  minValue: money(s.minBankrollRoR5pct),
                  maxValue: money(s.minBankrollRoR1pct),
                  anchorRatio: bankrollSafetyRatio,
                }
          }
          sub={
            s.riskOfRuin === 0 && result.stats.minBankrollRoR1pct === 0
              ? t("stat.bankrollOff")
              : t("stat.riskOfRuin.sub")
          }
          tip={
            s.riskOfRuin === 0 && result.stats.minBankrollRoR1pct === 0
              ? undefined
              : t("stat.riskOfRuin.tip")
                  .replace("{br1}", money(s.minBankrollRoR1pct))
                  .replace("{br5}", money(s.minBankrollRoR5pct))
          }
          tone={s.riskOfRuin > 0.05 ? "neg" : undefined}
          pdValue={pdStats ? pct(pdStats.riskOfRuin) : undefined}
          pdDelta={pdStats ? pctDelta(s.riskOfRuin, pdStats.riskOfRuin) : null}
          emphasizeTail
          pdLabel={pdBadgeLabel}
        />
      </div>

      {result.battleRoyaleLeaderboard && (
        <BattleRoyaleLeaderboardSection
          leaderboard={result.battleRoyaleLeaderboard}
          gameExpectedProfit={displayResultStats.expectedProfit}
        />
      )}

      <StatGroup title={t("statGroup.drawdowns")}>
        <MiniStat
          suit="heart"
          label={t("stat.ddWorst")}
          value={
            unit === "abi"
              ? `${money(s.maxDrawdownWorst)} · ${Math.round(s.longestBreakevenMean)} ${tourneysWord}`
              : `${money(s.maxDrawdownWorst)} · ${(s.maxDrawdownWorst / abi).toFixed(1)} ABI · ${Math.round(s.longestBreakevenMean)} ${tourneysWord}`
          }
          tone="neg"
          tip={t("stat.ddWorst.tip")}
          pdValue={
            pdStats
              ? unit === "abi"
                ? money(pdStats.maxDrawdownWorst)
                : `${money(pdStats.maxDrawdownWorst)} · ${(pdStats.maxDrawdownWorst / abi).toFixed(1)} ABI`
              : undefined
          }
          pdDelta={
            pdStats ? pctDelta(s.maxDrawdownWorst, pdStats.maxDrawdownWorst) : null
          }
          emphasizeTail
          pdLabel={pdBadgeLabel}
        />
        <MiniStat
          suit="heart"
          label={t("stat.ddMedian")}
          value={money(s.maxDrawdownMedian)}
          tip={t("stat.ddMedian.tip")}
          pdValue={pdStats ? money(pdStats.maxDrawdownMedian) : undefined}
          pdDelta={
            pdStats
              ? pctDelta(s.maxDrawdownMedian, pdStats.maxDrawdownMedian)
              : null
          }
          pdLabel={pdBadgeLabel}
        />
        <MiniStat
          suit="heart"
          label={t("stat.ddP95")}
          value={money(s.maxDrawdownP95)}
          tone="neg"
          tip={t("stat.ddP95.tip")}
          pdValue={pdStats ? money(pdStats.maxDrawdownP95) : undefined}
          pdDelta={
            pdStats ? pctDelta(s.maxDrawdownP95, pdStats.maxDrawdownP95) : null
          }
          emphasizeTail
          pdLabel={pdBadgeLabel}
        />
        <MiniStat
          suit="heart"
          label={t("stat.ddP99")}
          value={money(s.maxDrawdownP99)}
          tone="neg"
          tip={t("stat.ddP99.tip")}
          pdValue={pdStats ? money(pdStats.maxDrawdownP99) : undefined}
          pdDelta={
            pdStats ? pctDelta(s.maxDrawdownP99, pdStats.maxDrawdownP99) : null
          }
          emphasizeTail
          pdLabel={pdBadgeLabel}
        />
      </StatGroup>

      <StatGroup title={t("statGroup.streaks")}>
        <MiniStat
          suit="diamond"
          label={t("stat.longestBE")}
          value={`${Math.round(s.longestBreakevenMean)} ${tourneysWord}`}
          tip={t("stat.longestBE.tip")}
          pdValue={
            pdStats
              ? `${Math.round(pdStats.longestBreakevenMean)} ${tourneysWord}`
              : undefined
          }
          pdDelta={
            pdStats
              ? pctDelta(s.longestBreakevenMean, pdStats.longestBreakevenMean)
              : null
          }
          pdLabel={pdBadgeLabel}
        />
        <MiniStat
          suit="diamond"
          label={t("stat.avgBEStreak")}
          value={`${Math.round(s.breakevenStreakMean)} ${tourneysWord}`}
          tip={t("stat.avgBEStreak.tip")}
        />
        <MiniStat
          suit="diamond"
          label={t("stat.cashlessMean")}
          value={`${Math.round(s.longestCashlessMean)} ${tourneysWord}`}
          tip={t("stat.cashlessMean.tip")}
          pdValue={
            pdStats
              ? `${Math.round(pdStats.longestCashlessMean)} ${tourneysWord}`
              : undefined
          }
          pdDelta={
            pdStats
              ? pctDelta(s.longestCashlessMean, pdStats.longestCashlessMean)
              : null
          }
          pdLabel={pdBadgeLabel}
        />
        <MiniStat
          suit="heart"
          label={t("stat.cashlessWorst")}
          value={`${s.longestCashlessWorst} ${tourneysWord}`}
          tone="neg"
          tip={t("stat.cashlessWorst.tip")}
          pdValue={
            pdStats ? `${pdStats.longestCashlessWorst} ${tourneysWord}` : undefined
          }
          pdDelta={
            pdStats
              ? pctDelta(s.longestCashlessWorst, pdStats.longestCashlessWorst)
              : null
          }
          emphasizeTail
          pdLabel={pdBadgeLabel}
        />
        <MiniStat
          suit="diamond"
          label={t("stat.recoveryMedian")}
          value={
            Number.isFinite(s.recoveryMedian)
              ? `${Math.round(s.recoveryMedian)} ${tourneysWord}`
              : "—"
          }
          tip={t("stat.recoveryMedian.tip")}
          pdValue={
            pdStats && Number.isFinite(pdStats.recoveryMedian)
              ? `${Math.round(pdStats.recoveryMedian)} ${tourneysWord}`
              : undefined
          }
          pdDelta={
            pdStats ? pctDelta(s.recoveryMedian, pdStats.recoveryMedian) : null
          }
          pdLabel={pdBadgeLabel}
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
          tip={t("stat.recoveryP90.tip")}
          pdValue={
            pdStats && Number.isFinite(pdStats.recoveryP90)
              ? `${Math.round(pdStats.recoveryP90)} ${tourneysWord}`
              : undefined
          }
          pdDelta={pdStats ? pctDelta(s.recoveryP90, pdStats.recoveryP90) : null}
          emphasizeTail
          pdLabel={pdBadgeLabel}
        />
        <MiniStat
          suit="heart"
          label={t("stat.recoveryUnrecovered")}
          value={pct(s.recoveryUnrecoveredShare)}
          tone={s.recoveryUnrecoveredShare > 0.05 ? "neg" : undefined}
          tip={t("stat.recoveryUnrecovered.tip")}
          pdValue={pdStats ? pct(pdStats.recoveryUnrecoveredShare) : undefined}
          pdDelta={
            pdStats
              ? pctDelta(
                  s.recoveryUnrecoveredShare,
                  pdStats.recoveryUnrecoveredShare,
                )
              : null
          }
          emphasizeTail
          pdLabel={pdBadgeLabel}
        />
      </StatGroup>

      {rakebackCurve && (
        <div className="flex items-center justify-end -mb-1">
          <label
            className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[color:var(--color-fg-muted)]"
            title={t("chart.rakeback.profitOnly.title")}
          >
            <input
              type="checkbox"
              checked={rbDist}
              onChange={(e) => setRbDist(e.target.checked)}
              className="h-3.5 w-3.5 accent-lime-400"
            />
            <span className="uppercase tracking-wider text-lime-400/80">
              {t("chart.trajectory.withRakeback")}
            </span>
          </label>
        </div>
      )}
      {rakebackCurve && (
        <div className="-mt-3 mb-1 text-right text-[10px] leading-snug text-[color:var(--color-fg-dim)]">
          {t("chart.rakeback.fullSampleNote")}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <UnitScope id="dist.profit">
          <MoneyDistributionCard
            title={t("chart.dist")}
            subtitle={`${result.samples.toLocaleString()} ${t("app.samples")} · 60 bins`}
            binEdges={displayResultDist.histogram.binEdges}
            counts={displayResultDist.histogram.counts}
            color="#34d399"
            yAsPct
            xDomain={distProfitXDomain}
            overlay={
              overlayPd && displayPdChartDist
                ? {
                    binEdges: displayPdChartDist.histogram.binEdges,
                    counts: displayPdChartDist.histogram.counts,
                    label: overlayLabel,
                  }
                : null
            }
          />
        </UnitScope>
        <UnitScope id="dist.drawdown">
          <div className="flex flex-col gap-1.5">
            <MoneyDistributionCard
              title={t("chart.ddDist")}
              subtitle={t("chart.ddDist.sub")}
              binEdges={displayResultStreaks.drawdownHistogram.binEdges}
              counts={displayResultStreaks.drawdownHistogram.counts}
              color="#f87171"
              yAsPct
              xDomain={streakDrawdownXDomain}
              overlay={
                overlayPd && displayPdChartStreaks
                  ? {
                      binEdges: displayPdChartStreaks.drawdownHistogram.binEdges,
                      counts: displayPdChartStreaks.drawdownHistogram.counts,
                      label: overlayLabel,
                    }
                  : null
              }
            />
          </div>
        </UnitScope>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Card className="p-5">
          <ChartHeader
            title={t("chart.convergence")}
            subtitle={t("chart.convergence.sub")}
            showUnitToggle={false}
          />
          <ConvergenceChart schedule={schedule} finishModel={finishModel} />
        </Card>
        {result.downswings.length > 0 && (
          <UnitScope id="downswings">
            <div className="flex flex-col gap-1.5">
            <DownswingsCard
              downswings={displayResultStreaks.downswings}
              upswings={displayResultStreaks.upswings}
              tourneysWord={tourneysWord}
              streaks={
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:grid-rows-[auto_1fr_auto_auto]">
                  <div className="flex flex-col gap-1.5 sm:grid sm:grid-rows-subgrid sm:row-span-4">
                    <ChartHeader
                      title={t("chart.longestBE")}
                      showUnitToggle={false}
                      tip={t("chart.longestBE.tip")}
                    />
                    <DistributionChart
                      binEdges={displayResultStreaks.longestBreakevenHistogram.binEdges}
                      counts={displayResultStreaks.longestBreakevenHistogram.counts}
                      color="#fbbf24"
                      unitLabel="tourneys"
                      yAsPct
                      xDomain={streakBreakevenXDomain}
                      overlay={
                        overlayPd && displayPdChartStreaks
                          ? {
                              binEdges:
                                displayPdChartStreaks.longestBreakevenHistogram.binEdges,
                              counts:
                                displayPdChartStreaks.longestBreakevenHistogram.counts,
                              color: "#f472b6",
                              label: overlayLabel,
                            }
                          : undefined
                      }
                    />
                    <div className="text-[10px] leading-snug text-[color:var(--color-fg-dim)]">
                      {t("chart.longestBE.sub")}
                    </div>
                    <div />
                  </div>
                  <div className="flex flex-col gap-1.5 sm:grid sm:grid-rows-subgrid sm:row-span-4">
                    <ChartHeader
                      title={t("chart.longestCashless")}
                      showUnitToggle={false}
                      tip={t("chart.longestCashless.tip")}
                    />
                    <DistributionChart
                      binEdges={displayResultStreaks.longestCashlessHistogram.binEdges}
                      counts={displayResultStreaks.longestCashlessHistogram.counts}
                      color="#f87171"
                      unitLabel="tourneys"
                      yAsPct
                      overlay={
                        overlayPd && pdChart
                          ? {
                              binEdges:
                                pdChart.longestCashlessHistogram.binEdges,
                              counts:
                                pdChart.longestCashlessHistogram.counts,
                              color: "#38bdf8",
                              label: overlayLabel,
                            }
                          : undefined
                      }
                    />
                    <div className="text-[10px] leading-snug text-[color:var(--color-fg-dim)]">
                      {t("chart.longestCashless.sub")}
                      {rakebackCurve && (
                        <>
                          {" · "}
                          <span className="text-[color:var(--color-fg-muted)]">
                            {t("chart.longestCashless.rbNote")}
                          </span>
                        </>
                      )}
                    </div>
                    <div />
                  </div>
                  <div className="flex flex-col gap-1.5 sm:grid sm:grid-rows-subgrid sm:row-span-4">
                    <ChartHeader
                      title={t("chart.recovery")}
                      showUnitToggle={false}
                      tip={t("chart.recovery.tip")}
                    />
                    <DistributionChart
                      binEdges={displayResultStreaks.recoveryHistogram.binEdges}
                      counts={displayResultStreaks.recoveryHistogram.counts}
                      color="#34d399"
                      unitLabel="tourneys"
                      yAsPct
                      xDomain={streakRecoveryXDomain}
                      overlay={
                        overlayPd && displayPdChartStreaks
                          ? {
                              binEdges: displayPdChartStreaks.recoveryHistogram.binEdges,
                              counts: displayPdChartStreaks.recoveryHistogram.counts,
                              color: "#e879f9",
                              label: overlayLabel,
                            }
                          : undefined
                      }
                    />
                    <div className="text-[10px] leading-snug text-[color:var(--color-fg-dim)]">
                      {t("chart.recovery.sub")}
                      {" · "}
                      {fmt(t("chart.recovery.unrecovered"), {
                        pct: pct(displayResultStreaks.stats.recoveryUnrecoveredShare),
                      })}
                    </div>
                    <div />
                  </div>
                </div>
              }
            />
            </div>
          </UnitScope>
        )}
      </div>


      {advanced && (
        <CollapsibleSection id="decomp" title={t("chart.decomp")} showUnitToggle={false}>
          <Card className="p-5">
            <ChartHeader
              title={t("chart.decomp")}
              subtitle={t("chart.decomp.sub")}
              showUnitToggle={false}
            />
            <DecompositionChart rows={result.decomposition} />
            <ChartHelp text={t("chart.decomp.help")} />
          </Card>
        </CollapsibleSection>
      )}

      <CollapsibleSection
        id="pdWeakness"
        title={t("section.pdWeakness")}
        showUnitToggle={false}
      >
        <PrimeDopeWeaknessCard />
      </CollapsibleSection>

      <CollapsibleSection
        id="ourWeakness"
        title={t("section.ourWeakness")}
        showUnitToggle={false}
      >
        <OurModelWeaknessCard />
      </CollapsibleSection>
    </div>
    </MoneyFmtContext.Provider>
    </AbiContext.Provider>
  );
}

export const ResultsView = memo(ResultsViewImpl);

// ---------------------------------------------------------------------
// Satellite mode
// ---------------------------------------------------------------------
// Ticket-cliff satellites pay the same ticket to every cashing place and
// nothing to everyone else. Per-sample trajectories become step functions
// (long flat losses punctuated by vertical cash spikes), which reads as
// "broken" in the bankroll trajectory chart even though the math is right.
// When the run's schedule is entirely made of satellite rows we swap the
// TrajectoryCard for this alternate widget: KPI strip (expected seats,
// cash rate, shots per seat, net $) + a seats-per-session histogram.

function SatelliteCard({
  result,
  schedule,
  scheduleRepeats,
  bankroll,
  allSatellite,
}: {
  result: SimulationResult;
  schedule: TournamentRow[];
  scheduleRepeats: number;
  bankroll: number;
  allSatellite: boolean;
}) {
  const t = useT();
  const { money } = useMoneyFmt();
  const stats = useMemo(
    () => computeSatelliteStats(result, schedule, scheduleRepeats),
    [result, schedule, scheduleRepeats],
  );
  if (!stats) return null;
  return (
    <Card className="p-5">
      <ChartHeader
        title={t("chart.satellite")}
        subtitle={
          bankroll > 0
            ? `${t("chart.satellite.sub")} · bankroll ${money(bankroll)}`
            : t("chart.satellite.sub")
        }
        showUnitToggle={false}
      />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniStat
          label={t("sat.kpi.expectedSeats")}
          value={stats.expectedSeats.toFixed(1)}
          suit="spade"
        />
        <MiniStat
          label={t("sat.kpi.cashRate")}
          value={`${(stats.cashRate * 100).toFixed(2)}%`}
          suit="heart"
        />
        <MiniStat
          label={t("sat.kpi.shotsPerSeat")}
          value={
            Number.isFinite(stats.shotsPerSeat)
              ? stats.shotsPerSeat.toFixed(1)
              : "∞"
          }
          suit="club"
        />
        <MiniStat
          label={t("sat.kpi.netPerSession")}
          value={money(stats.netPerSession)}
          tone={stats.netPerSession >= 0 ? "pos" : "neg"}
          suit="diamond"
        />
      </div>
      <div className="mb-2 flex items-end justify-between gap-3 text-[10px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
        <span>{t("chart.satellite.hist")}</span>
        <span className="normal-case tracking-normal">
          {stats.tourneysPerSession.toLocaleString("ru-RU")}{" "}
          {t("sat.perSession")}
        </span>
      </div>
      <DistributionChart
        binEdges={stats.histogram.binEdges}
        counts={stats.histogram.counts}
        color="#4ade80"
        height={260}
        unitLabel="seats"
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[11px]">
        <div className="text-[color:var(--color-fg-dim)]">
          {allSatellite
            ? t("chart.satellite.note")
            : t("chart.satellite.mixedNote")}
        </div>
        <div className="font-mono text-[color:var(--color-fg-muted)]">
          P5–P95: {stats.seatsP05.toFixed(0)}–{stats.seatsP95.toFixed(0)}{" "}
          <span className="text-[color:var(--color-fg-dim)]">·</span>{" "}
          {t("sat.kpi.seats")}: {stats.seats}
          {stats.rowCount > 1 ? ` ×${stats.rowCount}` : ""}{" "}
          <span className="text-[color:var(--color-fg-dim)]">·</span>{" "}
          {t("sat.kpi.seatPrice")}: {money(stats.seatPrice)}
        </div>
      </div>
    </Card>
  );
}

function BattleRoyaleLeaderboardSection({
  leaderboard,
  gameExpectedProfit,
}: {
  leaderboard: NonNullable<SimulationResult["battleRoyaleLeaderboard"]>;
  gameExpectedProfit: number;
}) {
  const t = useT();
  const { money } = useMoneyFmt();
  const payoutHistogram = useMemo(
    () => histogramOfValues(leaderboard.payouts, 40),
    [leaderboard.payouts],
  );
  const payoutDomain = useMemo(
    () => mergedHistogramDomain(payoutHistogram),
    [payoutHistogram],
  );
  const meanPointsPerWindow =
    leaderboard.stats.meanWindows > 0
      ? leaderboard.stats.meanPoints / leaderboard.stats.meanWindows
      : 0;
  const meanKoPerWindow =
    leaderboard.stats.meanWindows > 0
      ? leaderboard.stats.meanKnockouts / leaderboard.stats.meanWindows
      : 0;
  const meanFirstPerWindow =
    leaderboard.stats.meanWindows > 0
      ? leaderboard.stats.meanFirsts / leaderboard.stats.meanWindows
      : 0;
  const meanTop3PerWindow =
    leaderboard.stats.meanWindows > 0
      ? (leaderboard.stats.meanFirsts +
          leaderboard.stats.meanSeconds +
          leaderboard.stats.meanThirds) /
        leaderboard.stats.meanWindows
      : 0;
  const directPromoMean = leaderboard.sourceMix.directRakebackMean;
  const promoTotal = directPromoMean + leaderboard.stats.meanPayout;
  const directPromoShare = promoTotal > 0 ? directPromoMean / promoTotal : 0;
  const leaderboardPromoShare =
    promoTotal > 0 ? leaderboard.stats.meanPayout / promoTotal : 0;
  const totalExpectedWithPromo = gameExpectedProfit + leaderboard.stats.meanPayout;
  const subtitle = t("chart.brLeaderboard.sub")
    .replace("{participants}", leaderboard.config.participants.toLocaleString("ru-RU"))
    .replace(
      "{window}",
      leaderboard.config.windowTournaments.toLocaleString("ru-RU"),
    )
    .replace("{paid}", String(leaderboard.config.maxPaidRank));
  const note = t("chart.brLeaderboard.note");
  return (
    <CollapsibleSection
      id="battleRoyaleLeaderboard"
      title={t("chart.brLeaderboard.title")}
      showUnitToggle={false}
      defaultOpen
    >
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <Card className="p-5">
          <ChartHeader
            title={t("chart.brLeaderboard.title")}
            subtitle={subtitle}
            showUnitToggle={false}
          />
          <div className="mb-4 text-[11px] leading-snug text-[color:var(--color-fg-dim)]">
            {note}
          </div>
          <StatGroup title={t("chart.brLeaderboard.groupSettlement")}>
            <MiniStat
              suit="diamond"
              label={t("chart.brLeaderboard.meanPayout")}
              value={money(leaderboard.stats.meanPayout)}
              tone={leaderboard.stats.meanPayout >= 0 ? "pos" : "neg"}
            />
            <MiniStat
              suit="club"
              label={t("chart.brLeaderboard.directRb")}
              value={money(directPromoMean)}
              tone={directPromoMean >= 0 ? "pos" : "neg"}
            />
            <MiniStat
              suit="club"
              label={t("chart.brLeaderboard.totalWithPromo")}
              value={money(totalExpectedWithPromo)}
              tone={totalExpectedWithPromo >= 0 ? "pos" : "neg"}
            />
            <MiniStat
              suit="spade"
              label={t("chart.brLeaderboard.promoSplit")}
              value={`${pct(directPromoShare)} / ${pct(leaderboardPromoShare)}`}
            />
            <MiniStat
              suit="spade"
              label={t("chart.brLeaderboard.paidShare")}
              value={pct(leaderboard.stats.paidWindowShare)}
            />
            <MiniStat
              suit="spade"
              label={t("chart.brLeaderboard.meanRank")}
              value={`#${leaderboard.stats.meanRank.toFixed(1)}`}
            />
            <MiniStat
              suit="heart"
              label={t("chart.brLeaderboard.p95")}
              value={money(leaderboard.stats.p95Payout)}
              tone="neg"
            />
            <MiniStat
              suit="heart"
              label={t("chart.brLeaderboard.p99")}
              value={money(leaderboard.stats.p99Payout)}
              tone="neg"
            />
          </StatGroup>
          <div className="mt-4" />
          <StatGroup title={t("chart.brLeaderboard.groupScoring")}>
            <MiniStat
              suit="club"
              label={t("chart.brLeaderboard.pointsPerWindow")}
              value={meanPointsPerWindow.toFixed(1)}
            />
            <MiniStat
              suit="diamond"
              label={t("chart.brLeaderboard.koPerWindow")}
              value={meanKoPerWindow.toFixed(2)}
            />
            <MiniStat
              suit="spade"
              label={t("chart.brLeaderboard.firstPerWindow")}
              value={meanFirstPerWindow.toFixed(2)}
            />
            <MiniStat
              suit="spade"
              label={t("chart.brLeaderboard.top3PerWindow")}
              value={meanTop3PerWindow.toFixed(2)}
            />
          </StatGroup>
          <div className="mt-4 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-fg-dim)]">
            <span>
              {t("chart.brLeaderboard.meanWindows")}:{" "}
              {leaderboard.stats.meanWindows.toFixed(1)}
            </span>
            <span>·</span>
            <span>
              {t("chart.brLeaderboard.meanPaidWindows")}:{" "}
              {leaderboard.stats.meanPaidWindows.toFixed(1)}
            </span>
            <span>·</span>
            <span>
              {leaderboard.config.awardPartialWindow
                ? t("chart.brLeaderboard.partialYes")
                : t("chart.brLeaderboard.partialNo")}
            </span>
          </div>
          {leaderboard.sourceMix.rows.length > 0 && (
            <div className="mt-4 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/45 p-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--color-fg-dim)]">
                {t("chart.brLeaderboard.rowMix")}
              </div>
              <div className="mt-2 space-y-2">
                {leaderboard.sourceMix.rows.map((row) => (
                  <div
                    key={row.rowId}
                    className="flex flex-wrap items-center justify-between gap-2 text-[11px]"
                  >
                    <div className="font-medium text-[color:var(--color-fg)]">
                      {row.label}
                    </div>
                    <div className="text-[color:var(--color-fg-dim)]">
                      {t("chart.brLeaderboard.rowMixLine")
                        .replace("{count}", row.tournaments.toLocaleString("ru-RU"))
                        .replace(
                          "{direct}",
                          `${Math.round(row.directShare * 100)}%`,
                        )
                        .replace(
                          "{leaderboard}",
                          `${Math.round(row.leaderboardShare * 100)}%`,
                        )
                        .replace("{directEv}", money(row.directRakebackMean))
                        .replace(
                          "{leaderEv}",
                          money(row.leaderboardMeanTarget),
                        )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <UnitScope id="battleRoyaleLeaderboard.payouts">
          <MoneyDistributionCard
            title={t("chart.brLeaderboard.dist")}
            subtitle={t("chart.brLeaderboard.dist.sub")
              .replace(
                "{samples}",
                leaderboard.payouts.length.toLocaleString("ru-RU"),
              )
              .replace(
                "{windows}",
                leaderboard.stats.meanWindows.toFixed(1),
              )}
            binEdges={payoutHistogram.binEdges}
            counts={payoutHistogram.counts}
            color="#f59e0b"
            overlay={null}
            yAsPct
            xDomain={payoutDomain}
          />
        </UnitScope>
      </div>
    </CollapsibleSection>
  );
}

/**
 * Trajectory Card. Lives inside its own UnitScope so flipping the unit
 * toggle in the card header only affects this widget's formatters (the
 * trajectory hover tooltip and bankroll/subtitle text).
 */
const TrajectoryCard = memo(function TrajectoryCard({
  settings,
  result,
  displayResult,
  compareResult,
  bankroll,
  overlayPd,
  setOverlayPd,
  pdChart,
  displayPdChart,
  showWithRakeback,
  pdPkoFallback,
  compareMode,
  schedule,
  scheduleRepeats,
  modelLabel,
  linePreset,
  lineOverrides,
  visibleRuns,
  runMode,
  trimTopPct,
  trimBotPct,
  refLines,
  pdPresetFlip,
  honestLabel,
  modelPresetId,
  usePdPayouts,
  onUsePdPayoutsChange,
  usePdFinishModel,
  onUsePdFinishModelChange,
  usePdRakeMath,
  onUsePdRakeMathChange,
  pdOverrideStatus,
  pdOverrideProgress,
  toolbar,
}: {
  settings?: ControlsState;
  result: SimulationResult;
  displayResult: SimulationResult;
  compareResult: SimulationResult | null;
  bankroll: number;
  overlayPd: boolean;
  setOverlayPd: (v: boolean) => void;
  pdChart: SimulationResult | null;
  displayPdChart: SimulationResult | null;
  showWithRakeback: boolean;
  pdPkoFallback: boolean;
  compareMode: "random" | "primedope";
  schedule: TournamentRow[] | undefined;
  scheduleRepeats: number | undefined;
  modelLabel: string;
  linePreset: LineStylePreset;
  lineOverrides: LineStyleOverrides;
  visibleRuns: number;
  runMode: RunMode;
  trimTopPct: number;
  trimBotPct: number;
  refLines: RefLineConfig[];
  pdPresetFlip: boolean;
  honestLabel: string;
  modelPresetId?: string;
  usePdPayouts: boolean;
  onUsePdPayoutsChange?: (v: boolean) => void;
  usePdFinishModel: boolean;
  onUsePdFinishModelChange?: (v: boolean) => void;
  usePdRakeMath: boolean;
  onUsePdRakeMathChange?: (v: boolean) => void;
  pdOverrideStatus?: "idle" | "running" | "done" | "error";
  pdOverrideProgress?: number;
  toolbar?: React.ReactNode;
}) {
  const t = useT();
  const { compactMoney } = useMoneyFmt();
  const { advanced } = useAdvancedMode();
  const overlayLabel = pdPkoFallback ? t("chart.overlay.freezeouts") : "PrimeDope";
  const overlayLegendKey: DictKey = pdPkoFallback
    ? "chart.legend.noKoOverlay"
    : compareMode === "primedope"
      ? "chart.legend.pdOverlay"
      : "chart.legend.genericOverlay";
  const overlayLegend =
    overlayPd && !pdPresetFlip ? (
      <OverlayLegendChip label={t(overlayLegendKey)} />
    ) : null;
  const hasBounty = (schedule ?? []).some(
    (r) => (r.bountyFraction ?? 0) > 0,
  );
  const [extremeStyles, setExtremeStyles] = useLocalStorageState<ExtremeStyles>(
    "tvs.extremeStyles.v1",
    loadExtremeStyles,
    saveExtremeStyles,
    DEFAULT_EXTREME_STYLES,
  );
  const setExtremeKey = (k: ExtremeKey, patch: Partial<ExtremeStyles[ExtremeKey]>) =>
    setExtremeStyles({ ...extremeStyles, [k]: { ...extremeStyles[k], ...patch } });
  // Y-axis fits exactly the visible series (#96). Toggling an extreme line
  // expands the axis to fit it; toggling off snaps back to the main mass.
  // Without this uPlot would auto-scale over all series we feed it — including
  // the 1000 sample paths, whose jackpot outliers on Mystery/BR stretch the
  // axis even when extremes are hidden.
  const effectiveYRange = useMemo(
    () =>
      computeYRange(
        displayPdChart ? [displayResult, displayPdChart] : [displayResult],
        extremeStyles,
        visibleRuns,
        runMode,
        trimTopPct,
        trimBotPct,
      ),
    [displayResult, displayPdChart, extremeStyles, visibleRuns, runMode, trimTopPct, trimBotPct],
  );
  const oursCapKey: DictKey =
    modelPresetId === "naive"
      ? "chart.trajectory.ours.cap.naive"
      : modelPresetId === "realistic-solo"
        ? "chart.trajectory.ours.cap.realisticSolo"
        : modelPresetId === "steady-reg"
          ? "chart.trajectory.ours.cap.steadyReg"
          : modelPresetId && modelPresetId !== "primedope"
            ? "chart.trajectory.ours.cap.custom"
            : "chart.trajectory.ours.cap";
  // Build chart assets with the full cap, NOT the current slider value —
  // the slider is applied imperatively in TrajectoryPlot. Keeping it out
  // of the memo deps is the whole point of this refactor: dragging the
  // slider must not tear down and rebuild uPlot.
  // Stable axis formatter ref — avoids rebuilding the entire chart when
  // unit mode toggles (compactMoney identity changes). The formatter is
  // only called by uPlot during paint, so a ref indirection is safe.
  const axisFmtRef = useRef(compactMoney);
  useLayoutEffect(() => {
    axisFmtRef.current = compactMoney;
  }, [compactMoney]);
  // uPlot reads this during paint, not React render — the ref indirection is
  // intentional so a unit-mode toggle doesn't rebuild the whole chart.
  const stableAxisFmt = useMemo(() => (v: number) => axisFmtRef.current(v), []);
  // `displayResult` / `displayPdChart` / `showWithRakeback` are owned by the
  // parent (ResultsView) so the toggle is shared with BigStats + profit
  // histogram. Only `compareResult` (an internal twin-run input) needs its
  // own shift pipeline here.
  const rbFrac = Math.max(0, (settings?.rakebackPct ?? 0) / 100);
  const compareRakebackCurve = useMemo(
    () =>
      compareResult && schedule && scheduleRepeats != null
        ? computeExpectedRakebackCurve(
            schedule,
            scheduleRepeats,
            rbFrac,
            compareResult.samplePaths.x,
            advanced,
          )
        : null,
    [advanced, compareResult, schedule, scheduleRepeats, rbFrac],
  );
  const displayCompareResult = useMemo(
    () =>
      compareResult && !showWithRakeback && compareRakebackCurve
        ? shiftResultByRakeback(compareResult, compareRakebackCurve, -1)
        : compareResult,
    [compareResult, showWithRakeback, compareRakebackCurve],
  );
  const maxPathCount = Math.min(1000, displayResult.samplePaths.paths.length);
  const primary = useMemo(
    () =>
      buildTrajectoryAssets(
        displayResult,
        "felt",
        effectiveYRange,
        overlayPd ? displayPdChart : null,
        // eslint-disable-next-line react-hooks/refs
        stableAxisFmt,
        linePreset,
        maxPathCount,
        refLines,
        lineOverrides,
        runMode,
        extremeStyles,
        overlayLabel,
      ),
    [displayResult, effectiveYRange, overlayPd, displayPdChart, stableAxisFmt, linePreset, maxPathCount, refLines, lineOverrides, runMode, extremeStyles, overlayLabel],
  );
  const pdPanePreset = PRIMEDOPE_PANE_PRESET;
  const secondaryMaxPathCount = displayPdChart
    ? Math.min(1000, displayPdChart.samplePaths.paths.length)
    : 0;
  const secondary = useMemo(
    () =>
      displayPdChart
        ? buildTrajectoryAssets(
            displayPdChart,
            "magenta",
            effectiveYRange,
            undefined,
            // eslint-disable-next-line react-hooks/refs
            stableAxisFmt,
            pdPanePreset,
            secondaryMaxPathCount,
            refLines,
            lineOverrides,
            runMode,
            extremeStyles,
          )
        : null,
    [displayPdChart, effectiveYRange, stableAxisFmt, pdPanePreset, secondaryMaxPathCount, refLines, lineOverrides, runMode, extremeStyles],
  );
  const compareMaxPathCount = displayCompareResult
    ? Math.min(500, displayCompareResult.samplePaths.paths.length)
    : 0;
  const slotOverlay = useMemo(
    () =>
      displayCompareResult
        ? buildTrajectoryAssets(
            displayCompareResult,
            "magenta",
            undefined,
            undefined,
            // eslint-disable-next-line react-hooks/refs
            stableAxisFmt,
            pdPanePreset,
            compareMaxPathCount,
            refLines,
            lineOverrides,
            runMode,
            extremeStyles,
          )
        : null,
    [displayCompareResult, stableAxisFmt, pdPanePreset, compareMaxPathCount, refLines, lineOverrides, runMode, extremeStyles],
  );

  const extremeRows: Array<{ key: ExtremeKey; labelKey: DictKey }> = [
    { key: "realBest", labelKey: "chart.traj.extreme.realBest" },
    { key: "realWorst", labelKey: "chart.traj.extreme.realWorst" },
    { key: "aggBest", labelKey: "chart.traj.extreme.aggBest" },
    { key: "aggWorst", labelKey: "chart.traj.extreme.aggWorst" },
  ];
  const extremesToggles = (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--color-fg-muted)]">
      {extremeRows.map(({ key, labelKey }) => {
        const s = extremeStyles[key];
        const hex = /^#([0-9a-f]{3}){1,2}$/i.test(s.color) ? s.color : "#22c55e";
        return (
          <label
            key={key}
            className="flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] transition-colors"
            style={{
              borderColor: s.enabled
                ? `${hex}66`
                : "color-mix(in srgb, var(--color-border) 88%, transparent)",
              backgroundColor: s.enabled
                ? "color-mix(in srgb, var(--color-bg-elev) 82%, transparent)"
                : "color-mix(in srgb, var(--color-bg) 62%, transparent)",
              color: s.enabled
                ? "var(--color-fg)"
                : "var(--color-fg-muted)",
            }}
          >
            <input
              type="checkbox"
              checked={s.enabled}
              onChange={(e) => setExtremeKey(key, { enabled: e.target.checked })}
              className="h-3.5 w-3.5 rounded-sm accent-[color:var(--color-accent)]"
            />
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm border border-white/10"
              style={{ backgroundColor: hex }}
              aria-hidden
            />
            <span className="whitespace-nowrap">{t(labelKey)}</span>
            <DebouncedColorInput
              value={hex}
              disabled={!s.enabled}
              onChange={(v) => setExtremeKey(key, { color: v })}
              aria-label={t(labelKey)}
            />
          </label>
        );
      })}
    </div>
  );

  // All-satellite schedules swap the $ trajectory for a seats-per-session
  // histogram + KPI strip (trajectories are step functions for flat payouts
  // and read as "broken"). Hooks above still run; this branch only changes
  // the rendered tree.
  if (isSatelliteOnlySchedule(schedule) && scheduleRepeats != null) {
    return (
      <SatelliteCard
        result={result}
        schedule={schedule}
        scheduleRepeats={scheduleRepeats}
        bankroll={bankroll}
        allSatellite
      />
    );
  }

  if (secondary) {
    return (
      <Card className="p-5">
        <ChartHeader
          title={t("chart.trajectory")}
          subtitle=""
          showUnitToggle={false}
        />
        {toolbar}
        {extremesToggles}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartPane
            label={modelLabel}
            sublabel={null}
            hueDot="#34d399"
            itmRate={result.stats.itmRate}
            itmCashOnly={hasBounty}
            caption={
              compareMode === "primedope"
                ? t(oursCapKey)
                : t("twin.runA.cap")
            }
            action={overlayLegend}
          >
            <TrajectoryPlot assets={primary} height={540} visibleRuns={visibleRuns} trimTopPct={trimTopPct} trimBotPct={trimBotPct} />
          </ChartPane>
          <ChartPane
            label={
              pdPresetFlip
                ? honestLabel
                : pdPkoFallback
                ? t("chart.trajectory.noKoLabel")
                : "PrimeDope"
            }
            hueDot="#60a5fa"
            itmRate={pdChart?.stats.itmRate}
            itmCashOnly={hasBounty && !pdPkoFallback}
            caption={
              pdPresetFlip
                ? t("twin.runB.cap")
                : pdPkoFallback
                ? t("chart.trajectory.noKoCap")
                : compareMode === "primedope"
                ? t("chart.trajectory.theirs.cap")
                : t("twin.runB.cap")
            }
            action={
              compareMode === "primedope" &&
              !pdPkoFallback &&
              schedule &&
              scheduleRepeats ? (
                <div className="flex items-center gap-2">
                  <PdCompareToggles
                    usePdPayouts={usePdPayouts}
                    onUsePdPayoutsChange={onUsePdPayoutsChange}
                    usePdFinishModel={usePdFinishModel}
                    onUsePdFinishModelChange={onUsePdFinishModelChange}
                    usePdRakeMath={usePdRakeMath}
                    onUsePdRakeMathChange={onUsePdRakeMathChange}
                    pdOverrideStatus={pdOverrideStatus}
                    pdOverrideProgress={pdOverrideProgress}
                  />
                  {advanced && (
                    <CopyPdDiagButton
                      settings={settings}
                      schedule={schedule}
                      scheduleRepeats={scheduleRepeats}
                      bankroll={bankroll}
                      result={result}
                      pdChart={pdChart}
                      pdOverrideStatus={pdOverrideStatus ?? "idle"}
                      usePdPayouts={usePdPayouts}
                      usePdFinishModel={usePdFinishModel}
                      usePdRakeMath={usePdRakeMath}
                    />
                  )}
                </div>
              ) : null
            }
          >
            <TrajectoryPlot assets={secondary} height={540} visibleRuns={visibleRuns} trimTopPct={trimTopPct} trimBotPct={trimBotPct} />
            {compareMode === "primedope" && !pdPkoFallback && schedule && scheduleRepeats != null && scheduleRepeats > 0 && (
              <div className="mt-1 flex justify-start">
                <PrimedopeReproduceButton
                  schedule={schedule}
                  scheduleRepeats={scheduleRepeats}
                />
              </div>
            )}
          </ChartPane>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label
            className={`flex items-center gap-2 text-[11px] text-[color:var(--color-fg-muted)] ${
              pdPresetFlip ? "cursor-not-allowed opacity-50" : "cursor-pointer"
            }`}
          >
            <input
              type="checkbox"
              checked={overlayPd && !pdPresetFlip}
              disabled={pdPresetFlip}
              onChange={(e) => setOverlayPd(e.target.checked)}
              className="h-3.5 w-3.5 accent-[color:var(--color-accent)]"
            />
            <span className="font-semibold text-[color:var(--color-fg)]">
              {pdPkoFallback
                ? t("chart.trajectory.overlayNoKo")
                : t("chart.trajectory.overlay")}
            </span>
            <span className="text-[color:var(--color-fg-dim)]">
              —{" "}
              {pdPkoFallback
                ? t("chart.trajectory.overlayNoKoHint")
                : t("chart.trajectory.overlayHint")}
            </span>
          </label>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <ChartHeader
        title={t("chart.trajectory")}
        subtitle=""
        showUnitToggle={false}
      />
      {toolbar}
      {extremesToggles}
      {compareMode === "primedope" && !pdPkoFallback && schedule && scheduleRepeats ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <PdCompareToggles
            usePdPayouts={usePdPayouts}
            onUsePdPayoutsChange={onUsePdPayoutsChange}
            usePdFinishModel={usePdFinishModel}
            onUsePdFinishModelChange={onUsePdFinishModelChange}
            usePdRakeMath={usePdRakeMath}
            onUsePdRakeMathChange={onUsePdRakeMathChange}
            pdOverrideStatus={pdOverrideStatus}
            pdOverrideProgress={pdOverrideProgress}
          />
        </div>
      ) : null}
      <TrajectoryPlot assets={primary} height={440} visibleRuns={visibleRuns} trimTopPct={trimTopPct} trimBotPct={trimBotPct} />
      {slotOverlay && (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
            <span className="inline-block h-1.5 w-3 rounded-sm bg-[#60a5fa]" />
            {t("slot.saved")}
          </div>
          <TrajectoryPlot assets={slotOverlay} height={240} visibleRuns={visibleRuns} trimTopPct={trimTopPct} trimBotPct={trimBotPct} />
        </div>
      )}
    </Card>
  );
});

/**
 * Money-denominated histogram card. Reads the current unit from its
 * enclosing UnitScope so the header toggle and the scaleBy arg stay
 * in lockstep for this single widget.
 */
function MoneyDistributionCard({
  title,
  subtitle,
  binEdges,
  counts,
  color,
  overlay,
  yAsPct,
  xDomain,
}: {
  title: string;
  subtitle: string;
  binEdges: number[];
  counts: number[];
  color: string;
  overlay: {
    binEdges: number[];
    counts: number[];
    label: string;
  } | null;
  yAsPct?: boolean;
  xDomain?: [number, number];
}) {
  const abi = useContext(AbiContext);
  const { unit } = useMoneyFmt();
  return (
    <Card className="p-5">
      <ChartHeader title={title} subtitle={subtitle} />
      <DistributionChart
        binEdges={binEdges}
        counts={counts}
        color={color}
        scaleBy={unit === "abi" ? abi : undefined}
        unitLabel={unit === "abi" ? "ABI" : "$"}
        overlay={overlay}
        yAsPct={yAsPct}
        xDomain={xDomain}
      />
    </Card>
  );
}

function DownswingsCard({
  downswings,
  upswings,
  tourneysWord,
  streaks,
}: {
  downswings: SimulationResult["downswings"];
  upswings: SimulationResult["upswings"];
  tourneysWord: string;
  streaks?: React.ReactNode;
}) {
  const t = useT();
  const { money } = useMoneyFmt();
  const renderRow = (
    rank: number,
    magnitude: number,
    magnitudeColor: string,
    finalProfit: number,
    longestBreakeven: number,
  ) => (
    <tr
      key={rank}
      className="border-b border-[color:var(--color-border)]/60 last:border-b-0"
    >
      <td className="py-2 pr-3 text-[color:var(--color-fg-muted)]">#{rank}</td>
      <td
        className="py-2 px-3 text-right tabular-nums whitespace-nowrap"
        style={{ color: magnitudeColor }}
      >
        {money(magnitude)}
      </td>
      <td
        className={`py-2 px-3 text-right tabular-nums whitespace-nowrap ${finalProfit >= 0 ? "text-[color:var(--color-success)]" : "text-[color:var(--color-fg)]"}`}
      >
        {money(finalProfit)}
      </td>
      <td className="py-2 pl-3 text-right tabular-nums whitespace-nowrap text-[color:var(--color-fg-muted)]">
        {Math.round(longestBreakeven)} {tourneysWord}
      </td>
    </tr>
  );
  return (
    <Card className="p-5">
      <ChartHeader title={t("dd.title")} subtitle={t("dd.sub")} />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="overflow-x-auto">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[color:var(--color-danger)]">
            {t("dd.worstDown")}
          </div>
          <table className="w-full min-w-[320px] text-sm">
            <thead>
              <tr className="border-b-2 border-[color:var(--color-border)] text-[11px] uppercase tracking-wider text-[color:var(--color-fg-muted)]">
                <th className="py-2 pr-3 text-left font-semibold">{t("dd.rank")}</th>
                <th className="py-2 px-3 text-right font-semibold">{t("dd.depth")}</th>
                <th className="py-2 px-3 text-right font-semibold">{t("dd.final")}</th>
                <th className="py-2 pl-3 text-right font-semibold">
                  {t("dd.breakeven")}
                </th>
              </tr>
            </thead>
            <tbody>
              {downswings.map((d) =>
                renderRow(
                  d.rank,
                  -d.depth,
                  "var(--color-danger)",
                  d.finalProfit,
                  d.longestBreakeven,
                ),
              )}
            </tbody>
          </table>
        </div>
        <div className="overflow-x-auto">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[color:var(--color-success)]">
            {t("dd.bestUp")}
          </div>
          <table className="w-full min-w-[320px] text-sm">
            <thead>
              <tr className="border-b-2 border-[color:var(--color-border)] text-[11px] uppercase tracking-wider text-[color:var(--color-fg-muted)]">
                <th className="py-2 pr-3 text-left font-semibold">{t("dd.rank")}</th>
                <th className="py-2 px-3 text-right font-semibold">{t("dd.height")}</th>
                <th className="py-2 px-3 text-right font-semibold">{t("dd.final")}</th>
                <th className="py-2 pl-3 text-right font-semibold">
                  {t("dd.breakeven")}
                </th>
              </tr>
            </thead>
            <tbody>
              {upswings.map((u) =>
                renderRow(
                  u.rank,
                  u.height,
                  "var(--color-success)",
                  u.finalProfit,
                  u.longestBreakeven,
                ),
              )}
            </tbody>
          </table>
        </div>
      </div>
      {streaks && <div className="mt-6">{streaks}</div>}
    </Card>
  );
}

function TrimPctSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-md border border-[color:var(--color-border)]/70 bg-[color:var(--color-bg)]/55 px-2 py-1"
      title={label}
    >
      <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[color:var(--color-fg-dim)]">
        {label}
      </span>
      <input
        type="range"
        min={0}
        max={40}
        step={0.5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-16 cursor-pointer accent-[color:var(--color-accent)]"
        aria-label={label}
      />
      <span className="min-w-[2.5rem] whitespace-nowrap text-right font-mono text-[10px] tabular-nums text-[color:var(--color-fg-muted)]">
        {value.toFixed(1)}%
      </span>
    </div>
  );
}

function RunModeSlider({
  value,
  onChange,
  t,
}: {
  value: RunMode;
  onChange: (v: RunMode) => void;
  t: ReturnType<typeof useT>;
}) {
  const modes: RunMode[] = ["worst", "random", "best"];
  return (
    <div
      className="inline-flex max-w-full overflow-hidden rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/70 shadow-sm"
      role="radiogroup"
      aria-label={t("runs.mode.title")}
      title={t("runs.mode.title")}
    >
      {modes.map((m, i) => {
        const active = m === value;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(m)}
            className={
              "px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors " +
              (active
                ? "bg-[color:var(--color-accent)] text-[color:var(--color-bg)]"
                : "bg-transparent text-[color:var(--color-fg-muted)] hover:bg-[color:var(--color-bg-elev-2)] hover:text-[color:var(--color-fg)]") +
              (i > 0 ? " border-l border-[color:var(--color-border)]" : "")
            }
          >
            {t(`runs.mode.${m}` as DictKey)}
          </button>
        );
      })}
    </div>
  );
}

function LineStylePresetPicker({
  value,
  onChange,
}: {
  value: LineStylePresetId;
  onChange: (v: LineStylePresetId) => void;
}) {
  const t = useT();
  const active = LINE_STYLE_PRESETS[value];
  const activeMeta = LINE_STYLE_PRESET_META[value];
  return (
    <div className="flex min-w-0 items-center gap-2">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as LineStylePresetId)}
        className="min-w-[8.5rem] rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/85 px-3 py-1 text-[11px] font-semibold text-[color:var(--color-fg)] shadow-sm outline-none hover:border-[color:var(--color-accent)] focus:border-[color:var(--color-accent)]"
        title={t(activeMeta.descriptionKey)}
      >
        {LINE_STYLE_PRESET_ORDER.map((id) => (
          <option key={id} value={id}>
            {t(LINE_STYLE_PRESET_META[id].labelKey)}
          </option>
        ))}
      </select>
      {/* Mini preview: mean stroke + dashed EV stroke so you can see the
          style without running a sim. */}
      <span className="inline-flex shrink-0 items-center rounded-md border border-[color:var(--color-border)]/70 bg-[color:var(--color-bg)]/70 px-2 py-1 shadow-sm">
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
      </span>
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
  // Real/agg best/worst live inline next to the toolbar, so the Customize
  // dropdown only covers the three residual lines: EV reference and the
  // p5/p95 percentile envelopes.
  const CUSTOMIZER_KEYS: OverridableLineKey[] = ["ev", "p05", "p95"];
  const labelKey = (k: OverridableLineKey): DictKey =>
    ({
      mean: "lineStyle.line.mean",
      ev: "lineStyle.line.ev",
      best: "lineStyle.line.best",
      worst: "lineStyle.line.worst",
      p05: "lineStyle.line.p05",
      p95: "lineStyle.line.p95",
    })[k] as DictKey;

  const setKey = (
    k: OverridableLineKey,
    patch: { stroke?: string; width?: number; enabled?: boolean },
  ) => {
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

  const hasAny = CUSTOMIZER_KEYS.some((k) => overrides[k]);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useCloseDetailsOnOutsideClick(detailsRef);

  return (
    <details ref={detailsRef} className="group relative">
      <summary className="cursor-pointer select-none rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/85 px-3 py-1 text-[11px] font-semibold text-[color:var(--color-fg)] shadow-sm hover:border-[color:var(--color-accent)]">
        {t("lineStyle.customize")}
      </summary>
      <div
        className="absolute left-0 top-full z-10 mt-1 hidden rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-3 shadow-lg group-open:block"
        style={{ width: "min(22rem, calc(100vw - 4rem))" }}
      >
        <div className="flex flex-col gap-2">
          {CUSTOMIZER_KEYS.map((k) => {
            const base = preset[k];
            const ov = overrides[k] ?? {};
            const stroke = ov.stroke ?? base.stroke;
            const width = ov.width ?? base.width;
            const enabled = isLineEnabled(k, overrides);
            // color input needs a hex value — fall back to preset color if it's a named/rgba.
            const hex = /^#([0-9a-f]{3}){1,2}$/i.test(stroke) ? stroke : "#34d399";
            return (
              <div key={k} className="flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setKey(k, { enabled: e.target.checked })}
                  className="h-3 w-3 cursor-pointer accent-[color:var(--color-accent)]"
                  aria-label={t(labelKey(k))}
                />
                <span
                  className="min-w-0 flex-1 truncate text-[color:var(--color-fg-dim)] sm:min-w-[8rem]"
                  title={t(labelKey(k))}
                >
                  {t(labelKey(k))}
                </span>
                <DebouncedColorInput
                  value={hex}
                  disabled={!enabled}
                  onChange={(v) => setKey(k, { stroke: v })}
                  aria-label={t(labelKey(k))}
                />
                <input
                  type="range"
                  min={0.5}
                  max={4}
                  step={0.25}
                  value={width}
                  disabled={!enabled}
                  onChange={(e) => setKey(k, { width: Number(e.target.value) })}
                  className="min-w-0 flex-1 disabled:opacity-40"
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
  showUnitToggle = true,
  defaultOpen = false,
}: {
  id: string;
  title: string;
  children: ReactNode;
  showUnitToggle?: boolean;
  defaultOpen?: boolean;
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
      el.open = v == null ? defaultOpen : v === "1";
    } catch {}
  }, [storageKey, defaultOpen]);
  const onToggle: ReactEventHandler<HTMLDetailsElement> = (e) => {
    try {
      localStorage.setItem(
        storageKey,
        e.currentTarget.open ? "1" : "0",
      );
    } catch {}
  };
  return (
    <UnitScope id={`collapse.${id}`}>
      <details
        ref={ref}
        onToggle={onToggle}
        className="group rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev-1)]"
      >
        <summary className="flex cursor-pointer select-none items-center gap-3 px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-fg-dim)] hover:text-[color:var(--color-fg)]">
          <span>{title}</span>
          <span className="ml-auto">
            {showUnitToggle && <InlineUnitToggle />}
          </span>
          <span className="text-[10px] transition-transform group-open:rotate-90">
            ▶
          </span>
        </summary>
        <div className="border-t border-[color:var(--color-border)] p-0">
          {children}
        </div>
      </details>
    </UnitScope>
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
      <summary className="cursor-pointer select-none rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/85 px-3 py-1 text-[11px] font-semibold text-[color:var(--color-fg)] shadow-sm hover:border-[color:var(--color-accent)]">
        {t("refLines.label")}
      </summary>
      <div
        className="absolute left-0 top-full z-10 mt-1 hidden w-[15rem] rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-3 shadow-lg group-open:block sm:w-80"
      >
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
                <DebouncedColorInput
                  value={hex}
                  onChange={(v) => setAt(i, { color: v })}
                  aria-label={t("refLines.color")}
                />
                <span className="text-[color:var(--color-fg-dim)]">ROI</span>
                <input
                  type="number"
                  value={pctValue}
                  step={5}
                  min={-99}
                  max={10_000}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    if (!Number.isFinite(raw)) return;
                    if (raw < -99 || raw > 10_000) return;
                    const nextRoi = raw / 100;
                    setAt(i, { roi: nextRoi, label: roiLabel(nextRoi) });
                  }}
                  className="w-14 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev-2)] px-1 py-0.5 text-center font-mono tabular-nums text-[color:var(--color-fg)]"
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

/**
 * Context-bound unit toggle. Reads the current money/abi mode from
 * MoneyFmtContext so any widget can drop it in without prop-drilling.
 * Swallows click events so placing it inside a <summary> won't also
 * toggle the enclosing <details>.
 */
function InlineUnitToggle() {
  const { unit, setUnit } = useMoneyFmt();
  const t = useT();
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <span onClick={stop} onMouseDown={stop}>
      <UnitToggle value={unit} onChange={setUnit} t={t} />
    </span>
  );
}

function UnitToggle({
  value,
  onChange,
  t,
}: {
  value: UnitMode;
  onChange: (v: UnitMode) => void;
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
    <div className="inline-flex shrink-0 items-stretch overflow-hidden rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/70 shadow-sm">
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
      tone: "#60a5fa",
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

function OverlayLegendChip({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)]">
      <span
        className="inline-block h-[1px] w-6 border-t-2 border-dashed"
        style={{ borderColor: "#60a5fa" }}
      />
      <span>{label}</span>
    </div>
  );
}

function ChartPane({
  label,
  sublabel,
  hueDot,
  caption,
  children,
  action,
  itmRate,
  itmCashOnly,
}: {
  label: string;
  sublabel?: string | null;
  hueDot: string;
  caption: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  itmRate?: number;
  itmCashOnly?: boolean;
}) {
  const t = useT();
  const itmLabel = itmCashOnly ? t("chart.itmBadge.cash") : "ITM";
  const itmTitle = itmCashOnly
    ? t("chart.itmBadge.cash.tip")
    : `In-the-money rate: ${itmRate != null ? (itmRate * 100).toFixed(2) : "—"}%`;
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
        {itmRate != null && (
          <span
            className="flex items-center gap-1.5 text-[10px] tabular-nums text-[color:var(--color-fg-dim)]"
            title={itmTitle}
          >
            <span>{itmLabel} {(itmRate * 100).toFixed(1)}%</span>
            <span className="relative inline-block h-1.5 w-14 overflow-hidden rounded bg-[color:var(--color-border)]">
              <span
                className="absolute inset-y-0 left-0"
                style={{
                  width: `${Math.min(100, itmRate * 100 * 3)}%`,
                  background: hueDot,
                }}
              />
            </span>
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
      : r.payoutStructure === "battle-royale"
      ? (3 / 18) * 100
      : r.payoutStructure === "mtt-top-heavy"
      ? 12
      : r.payoutStructure === "mtt-gg"
      ? 18
      : r.payoutStructure === "mtt-gg-bounty"
      ? 11.5
      : r.payoutStructure === "mtt-gg-mystery"
      ? 13
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

function PdCompareToggles({
  usePdPayouts,
  onUsePdPayoutsChange,
  usePdFinishModel,
  onUsePdFinishModelChange,
  usePdRakeMath,
  onUsePdRakeMathChange,
  pdOverrideStatus,
  pdOverrideProgress,
}: {
  usePdPayouts: boolean;
  onUsePdPayoutsChange?: (v: boolean) => void;
  usePdFinishModel: boolean;
  onUsePdFinishModelChange?: (v: boolean) => void;
  usePdRakeMath: boolean;
  onUsePdRakeMathChange?: (v: boolean) => void;
  pdOverrideStatus?: "idle" | "running" | "done" | "error";
  pdOverrideProgress?: number;
}) {
  const t = useT();
  const row = (
    checked: boolean,
    onChange: ((v: boolean) => void) | undefined,
    labelKey: DictKey,
    hintKey: DictKey,
  ) =>
    onChange ? (
      <div className="flex items-center gap-1">
        <label className="flex cursor-pointer items-center gap-1 text-[10px] text-[color:var(--color-fg-muted)]">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            className="h-3 w-3 accent-[color:var(--color-accent)]"
          />
          <span>{t(labelKey)}</span>
        </label>
        <InfoTooltip content={t(hintKey)} />
      </div>
    ) : null;
  return (
    <div className="flex items-center gap-2">
      {row(
        usePdPayouts,
        onUsePdPayoutsChange,
        "chart.trajectory.pdPayouts",
        "chart.trajectory.pdPayouts.hint",
      )}
      {row(
        usePdFinishModel,
        onUsePdFinishModelChange,
        "chart.trajectory.pdFinishModel",
        "chart.trajectory.pdFinishModel.hint",
      )}
      {row(
        usePdRakeMath,
        onUsePdRakeMathChange,
        "chart.trajectory.pdRakeMath",
        "chart.trajectory.pdRakeMath.hint",
      )}
      {pdOverrideStatus === "running" && (
        <div className="h-1 w-16 overflow-hidden rounded-sm bg-[color:var(--color-bg-elev-2)]">
          <div
            className="h-full bg-[color:var(--color-accent)] transition-[width] duration-100"
            style={{
              width: `${Math.max(2, Math.min(100, (pdOverrideProgress ?? 0) * 100))}%`,
            }}
          />
        </div>
      )}
    </div>
  );
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
      className="inline-flex items-center gap-1 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-[color:var(--color-fg-dim)] hover:border-[color:var(--color-border-strong)] hover:text-[color:var(--color-fg)]"
    >
      <svg width="8" height="8" viewBox="0 0 24 24" fill="none">
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

function CopyPdDiagButton({
  settings,
  schedule,
  scheduleRepeats,
  bankroll,
  result,
  pdChart,
  pdOverrideStatus,
  usePdPayouts,
  usePdFinishModel,
  usePdRakeMath,
}: {
  settings?: ControlsState;
  schedule: TournamentRow[];
  scheduleRepeats: number;
  bankroll: number;
  result: SimulationResult;
  pdChart: SimulationResult | null | undefined;
  pdOverrideStatus: "idle" | "running" | "done" | "error";
  usePdPayouts: boolean;
  usePdFinishModel: boolean;
  usePdRakeMath: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const handleClick = async () => {
    const statSummary = (r: SimulationResult | null | undefined) => {
      if (!r) return null;
      const s = r.stats as Record<string, unknown>;
      const num = (k: string) =>
        typeof s[k] === "number" ? (s[k] as number) : undefined;
      const round = (v: number | undefined) =>
        v == null ? undefined : Math.round(v);
      const fix4 = (v: number | undefined) =>
        v == null ? undefined : Number(v.toFixed(4));
      return {
        mean: round(num("mean")),
        stdDev: round(num("stdDev")),
        median: round(num("median")),
        min: round(num("min")),
        max: round(num("max")),
        p01: round(num("p01")),
        p05: round(num("p05")),
        p95: round(num("p95")),
        p99: round(num("p99")),
        maxDrawdownMean: round(num("maxDrawdownMean")),
        maxDrawdownMedian: round(num("maxDrawdownMedian")),
        maxDrawdownP95: round(num("maxDrawdownP95")),
        maxDrawdownP99: round(num("maxDrawdownP99")),
        maxDrawdownWorst: round(num("maxDrawdownWorst")),
        minBankrollRoR1pct: round(num("minBankrollRoR1pct")),
        minBankrollRoR5pct: round(num("minBankrollRoR5pct")),
        itmRate: fix4(num("itmRate")),
        probProfit: fix4(num("probProfit")),
        riskOfRuin: fix4(num("riskOfRuin")),
        sigmaPerTourneyEmpirical: (() => {
          const v = num("sigmaPerTournamentEmpirical");
          return v == null ? undefined : Number(v.toFixed(2));
        })(),
        sigmaPerTourneyMath: (() => {
          const v = num("sigmaPerTournamentMath");
          return v == null ? undefined : Number(v.toFixed(2));
        })(),
        spreadMaxMinusMean:
          num("max") != null && num("mean") != null
            ? Math.round((num("max") as number) - (num("mean") as number))
            : undefined,
      };
    };
    const dump = {
      timestamp: new Date().toISOString(),
      scheduleRepeats,
      bankroll,
      schedule: schedule.map((r) => ({
        players: r.players,
        buyIn: r.buyIn,
        rake: r.rake,
        roi: r.roi,
        payoutStructure: r.payoutStructure,
        count: r.count,
        bountyFraction: r.bountyFraction,
      })),
      pdFlagsFromProps: {
        usePdPayouts,
        usePdFinishModel,
        usePdRakeMath,
      },
      settingsPdFlags: settings
        ? {
            compareWithPrimedope: settings.compareWithPrimedope,
            usePrimedopePayouts: settings.usePrimedopePayouts,
            usePrimedopeFinishModel: settings.usePrimedopeFinishModel,
            usePrimedopeRakeMath: settings.usePrimedopeRakeMath,
            compareMode: settings.compareMode,
            modelPresetId: settings.modelPresetId,
            samples: settings.samples,
            seed: settings.seed,
          }
        : null,
      pdOverrideStatus,
      primary: statSummary(result),
      pdPane: statSummary(pdChart ?? null),
      comparisonPresent: !!result.comparison,
      pdOverrideVsComparison:
        pdChart && result.comparison
          ? pdChart === result.comparison
            ? "same-as-result.comparison"
            : "pdOverrideResult-different-from-result.comparison"
          : null,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(dump, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* noop */
    }
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      title="Copy PD diagnostic logs to clipboard"
      className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-[color:var(--color-fg-muted)] hover:border-[color:var(--color-border-strong)] hover:text-[color:var(--color-fg)]"
    >
      {copied ? "copied ✓" : "copy PD logs"}
    </button>
  );
}

function ChartHeader({
  title,
  subtitle,
  showUnitToggle = true,
  tip,
}: {
  title: string;
  subtitle?: string;
  /** Hide the money/ABI toggle on charts whose axes aren't in money. */
  showUnitToggle?: boolean;
  /** Optional help tooltip surfaced as a "?" button next to the title. */
  tip?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex w-full items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-1.5">
          <div className="text-sm font-semibold text-[color:var(--color-fg)]">
            {title}
          </div>
          {tip && <InfoTooltip content={tip} />}
        </div>
        {subtitle && <div className="text-xs text-[color:var(--color-fg-dim)]">{subtitle}</div>}
      </div>
      {showUnitToggle && <InlineUnitToggle />}
    </div>
  );
}

function PrimedopeDiff({
  primary,
  other,
  theirsLabel,
  title,
  subtitle,
  hasBounty,
}: {
  primary: SimulationResult;
  other: SimulationResult;
  theirsLabel?: string;
  title?: string;
  subtitle?: string;
  /** When true, the primary schedule has bounty tournaments (PKO / Mystery /
   * BR). The "Cash-in rate" row gets relabeled to "Cash-ITM (excl. bounties)"
   * with a footnote — raw ITM comparison against a no-bounty schedule is
   * apples-to-oranges because bounties are a separate EV channel. */
  hasBounty?: boolean;
}) {
  const t = useT();
  const { money } = useMoneyFmt();
  const ours = primary.stats;
  const theirs = other.stats;
  const pctPp = (a: number, b: number) =>
    `${((a - b) * 100).toFixed(2)} процентных пунктов`;
  const ratioPct = (a: number, b: number) =>
    `${((a / Math.max(1e-9, b) - 1) * 100).toFixed(1)} %`;
  const diffMoney = (a: number, b: number) =>
    `${a - b >= 0 ? "+" : "−"}${money(Math.abs(a - b))}`;
  const rows: {
    label: string;
    ours: string;
    theirs: string;
    delta: string;
    highlight?: boolean;
  }[] = [
    {
      label: t("pd.row.ev"),
      ours: money(primary.expectedProfit),
      theirs: money(other.expectedProfit),
      delta: diffMoney(primary.expectedProfit, other.expectedProfit),
      highlight: true,
    },
    {
      label: hasBounty ? t("pd.row.itm.cash") : t("pd.row.itm"),
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
      ours: `${Math.round(ours.longestBreakevenMean)} турниров`,
      theirs: `${Math.round(theirs.longestBreakevenMean)} турниров`,
      delta: `${Math.round(ours.longestBreakevenMean - theirs.longestBreakevenMean)} турниров`,
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
            {title ?? t("pd.title")}
          </div>
          <div className="text-xs text-[color:var(--color-fg-dim)]">
            {subtitle ?? t("pd.subtitle")}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider">
          <span className="flex items-center gap-1 text-[color:var(--color-fg-muted)]">
            <span className="inline-block h-1.5 w-3 rounded-sm bg-[#34d399]" />{" "}
            {t("pd.ours")}
          </span>
          <span className="flex items-center gap-1 text-[color:var(--color-fg-muted)]">
            <span className="inline-block h-1.5 w-3 rounded-sm bg-[#60a5fa]" />{" "}
            {theirsLabel ?? t("pd.theirs")}
          </span>
        </div>
      </div>
      <div className="mb-3 rounded border border-[color:var(--color-accent)]/30 bg-[color:var(--color-accent)]/6 px-3 py-2 text-[11px] leading-relaxed">
        <div className="font-semibold text-[color:var(--color-accent)]">
          {t("pd.evDelta.title")}
        </div>
        <div className="mt-0.5 text-[color:var(--color-fg-muted)]">
          {t("pd.evDelta.body")}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-[color:var(--color-border)] text-[10px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
              <th className="py-2 text-left font-medium">{t("pd.metric")}</th>
              <th className="py-2 text-right font-medium">{t("pd.ours")}</th>
              <th className="py-2 text-right font-medium">{theirsLabel ?? "primedope"}</th>
              <th className="py-2 text-right font-medium">{t("pd.delta")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.label}
                className={
                  r.highlight
                    ? "border-b border-[color:var(--color-border)] bg-[color:var(--color-accent)]/8"
                    : "border-b border-[color:var(--color-border)]/60 last:border-b-0"
                }
              >
                <td
                  className={
                    r.highlight
                      ? "py-2.5 font-semibold text-[color:var(--color-fg)]"
                      : "py-2 text-[color:var(--color-fg-muted)]"
                  }
                >
                  {r.label}
                </td>
                <td className="py-2 text-right font-semibold tabular-nums text-[color:var(--color-fg)]">
                  {r.ours}
                </td>
                <td className="py-2 text-right tabular-nums text-[#60a5fa]">
                  {r.theirs}
                </td>
                <td
                  className={
                    r.highlight
                      ? "py-2 text-right font-semibold tabular-nums text-[color:var(--color-accent)]"
                      : "py-2 text-right tabular-nums text-[color:var(--color-fg-muted)]"
                  }
                >
                  {r.delta}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasBounty && (
        <div className="mt-3 rounded border border-[color:var(--color-border)]/60 bg-[color:var(--color-bg-elev)]/40 px-3 py-2 text-[11px] leading-relaxed text-[color:var(--color-fg-muted)]">
          {t("pd.row.itm.cashNote")}
        </div>
      )}
    </Card>
  );
}

function DebouncedColorInput({
  value,
  disabled,
  onChange,
  ...rest
}: {
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type">) {
  // Uncontrolled: native <input type="color"> tracks its own in-flight value
  // during drag. We debounce the upstream onChange so each drag tick does not
  // trigger a full ResultsView re-render. `key={value}` forces a reset if the
  // prop changes externally (rare), sidestepping the controlled-vs-uncontrolled
  // mirror pattern that tripped the hooks lint rules.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <input
      key={value}
      type="color"
      defaultValue={value}
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.value;
        latestRef.current = v;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          onChangeRef.current(latestRef.current);
        }, 120);
      }}
      onBlur={() => {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        if (latestRef.current !== value) onChangeRef.current(latestRef.current);
      }}
      className="h-5 w-5 cursor-pointer rounded-[5px] border border-[color:var(--color-border)] bg-transparent p-0 shadow-sm disabled:opacity-40"
      {...rest}
    />
  );
}
