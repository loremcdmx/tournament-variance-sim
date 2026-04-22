"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type uPlot from "uplot";
import type { SimulationResult } from "@/lib/sim/types";
import { rankedRunIndices, type RunMode } from "@/lib/trajectorySelection";
import { useT } from "@/lib/i18n/LocaleProvider";
import {
  DEFAULT_EXTREME_STYLES,
  DEFAULT_LINE_STYLE_PRESET,
  LINE_STYLE_PRESETS,
  isLineEnabled,
  type ExtremeStyles,
  type LineStyle,
  type LineStyleOverrides,
  type LineStylePreset,
} from "@/lib/lineStyles";
import {
  buildRefLine,
  DEFAULT_REF_LINES,
  type RefLineConfig,
} from "@/lib/results/refLines";
import { visualDistanceToSeries } from "@/lib/results/trajectoryHitTest";
import { UplotChart, type CursorInfo } from "@/components/charts/UplotChart";
import type { AlignedData, Options } from "uplot";

function fmt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

const defaultCompactMoney = (v: number) => {
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  if (abs === 0) return "$0";
  return `${sign}$${abs.toFixed(0)}`;
};

type AccentHue = "felt" | "magenta";

export function TrajectoryPlot({
  assets,
  height,
  visibleRuns,
  trimTopPct = 0,
  trimBotPct = 0,
  compactMoney,
}: {
  assets: ReturnType<typeof buildTrajectoryAssets>;
  height: number;
  visibleRuns: number;
  trimTopPct?: number;
  trimBotPct?: number;
  compactMoney: (v: number) => string;
}) {
  const t = useT();
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
      nearestVisual.kind === "band" ||
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

    if (focusedSeriesIdx == null || !focusedLine) return;
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

    if (focusedLine.kind === "band") {
      const { dash, glowWidth, lineWidth } = trajectoryBandOverlayStyle(
        focusedLine.percentile,
      );
      ctx.setLineDash(dash ?? []);
      strokeSegment(
        0,
        xArr.length - 1,
        rgbaWithAlpha(focusedLine.color, 0.2),
        glowWidth,
      );
      ctx.setLineDash(dash ?? []);
      strokeSegment(0, xArr.length - 1, focusedLine.color, lineWidth);
      if (idx != null) {
        const xVal = xArr[idx];
        const yVal = dataArr[idx];
        if (xVal != null && yVal != null && Number.isFinite(yVal)) {
          const px = plot.valToPos(xVal, "x", false);
          const py = plot.valToPos(yVal, "y", false);
          ctx.save();
          ctx.setLineDash([]);
          ctx.fillStyle = "rgba(10,12,16,0.96)";
          ctx.strokeStyle = focusedLine.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(px, py, 4.75, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      }
      ctx.restore();
      return;
    }

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
  }, [
    focusedSeriesIdx,
    focusedLine,
    focusedStatsSeriesIdx,
    assets.data,
    focusedPathStats,
    deferredFocusedIdx,
    idx,
  ]);

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

function rgbaWithAlpha(css: string, alpha: number): string {
  const [r, g, b] = parseRgb(css);
  return `rgba(${r},${g},${b},${alpha})`;
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

function trajectoryBandOverlayStyle(percentile: number | null | undefined): {
  dash?: number[];
  glowWidth: number;
  lineWidth: number;
} {
  if (percentile == null) return { glowWidth: 6.5, lineWidth: 2.25 };
  const tail = Math.min(percentile, 1 - percentile);
  if (tail <= 0.002) return { dash: [2, 6], glowWidth: 6.25, lineWidth: 2.1 };
  if (tail <= 0.03) return { dash: [6, 4], glowWidth: 6.75, lineWidth: 2.25 };
  return { glowWidth: 7.25, lineWidth: 2.5 };
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

export function buildTrajectoryAssets(
  r: SimulationResult,
  hue: AccentHue,
  yRange?: { min: number; max: number },
  overlay?: SimulationResult | null,
  axisFmt: (v: number) => string = defaultCompactMoney,
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
export function computeYRange(
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
