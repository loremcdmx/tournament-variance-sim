import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type uPlot from "uplot";
import { UplotChart, type CursorInfo } from "@/components/charts/UplotChart";
import { useT } from "@/lib/i18n/LocaleProvider";
import { useLocalStorageState } from "@/lib/ui/useLocalStorageState";
import {
  DEFAULT_LINE_STYLE_PRESET,
  LINE_STYLE_PRESETS,
  loadLineStylePreset,
  saveLineStylePreset,
  type LineStyle,
} from "@/lib/lineStyles";
import { visualDistanceToSeries } from "@/lib/results/trajectoryHitTest";
import type { CashResult } from "@/lib/sim/cashTypes";
import { rankedRunIndices, type RunMode } from "@/lib/trajectorySelection";
import {
  type CashMoneyUnit,
  type SuitAccent,
  CASH_ACCENT_META,
  CashChartFrame,
  ChartTitle,
  MiniChartTitle,
  UnitToggle,
  convertCashMoney,
  formatRiskThreshold,
} from "./CashResultsShared";

type ChartAxes = Exclude<
  NonNullable<Parameters<typeof UplotChart>[0]["options"]>["axes"],
  undefined
>;

function cashAxes(
  xLabel: string,
  yLabel: string,
  ySize: number = 55,
): ChartAxes {
  return [
    {
      label: xLabel,
      stroke: "#a4afc2",
      grid: { stroke: "rgba(148,163,184,0.1)", width: 1 },
      ticks: { stroke: "rgba(148,163,184,0.22)" },
    },
    {
      label: yLabel,
      size: ySize,
      stroke: "#aeb8cb",
      grid: { stroke: "rgba(148,163,184,0.14)", width: 1 },
      ticks: { stroke: "rgba(148,163,184,0.26)" },
    },
  ];
}

function cashPctAxes(
  xLabel: string,
  yLabel: string,
): ChartAxes {
  return [
    {
      label: xLabel,
      stroke: "#a4afc2",
      grid: { stroke: "rgba(148,163,184,0.1)", width: 1 },
      ticks: { stroke: "rgba(148,163,184,0.22)" },
    },
    {
      label: yLabel,
      size: 64,
      stroke: "#aeb8cb",
      grid: { stroke: "rgba(148,163,184,0.14)", width: 1 },
      ticks: { stroke: "rgba(148,163,184,0.26)" },
      values: (_u, splits) => splits.map((value) => `${Math.round(value * 100)}%`),
    },
  ];
}

const CASH_TRAJECTORY_RUN_CAP = 120;
const CASH_PATH_HIT_PX = 20;

type CashTrajectoryLineKind = "mean" | "band" | "path" | "ref";

interface CashTrajectoryLineMeta {
  label: string;
  color: string;
  seriesIdx: number;
  kind: CashTrajectoryLineKind;
  percentile?: number;
  rank?: number;
}

function parseRgb(css: string): [number, number, number] {
  const rgba = css.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
  const hex = css.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  }
  return [200, 200, 200];
}

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

function buildLinearRef(x: readonly number[], slopePerX: number): number[] {
  return x.map((value) => value * slopePerX);
}

function alignCashPathToEnvX(
  envX: readonly number[],
  hiX: ArrayLike<number>,
  path: ArrayLike<number>,
): number[] {
  const out = new Array<number>(envX.length);
  let j = 0;
  for (let i = 0; i < envX.length; i++) {
    const target = envX[i];
    while (j + 1 < hiX.length && hiX[j + 1] <= target) j++;
    out[i] = path[j] ?? 0;
  }
  return out;
}

function formatBb(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatUsd(value: number): string {
  return "$" + value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function TrajectoryToolbar({
  visibleRuns,
  maxVisibleRuns,
  onVisibleRunsChange,
  runMode,
  onRunModeChange,
  moneyUnit,
  onMoneyUnitChange,
  riskThresholdBb,
  bbSize,
}: {
  visibleRuns: number;
  maxVisibleRuns: number;
  onVisibleRunsChange: (next: number) => void;
  runMode: RunMode;
  onRunModeChange: (next: RunMode) => void;
  moneyUnit: CashMoneyUnit;
  onMoneyUnitChange: (next: CashMoneyUnit) => void;
  riskThresholdBb: number;
  bbSize: number;
}) {
  const t = useT();
  return (
    <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-sm border border-[color:var(--color-border)]/75 bg-[color:var(--color-bg)]/42 px-3 py-2">
        <span className="eyebrow text-[10px] tracking-[0.14em] text-[color:var(--color-fg-muted)]">
          {t("cash.toolbar.runs")}
        </span>
        <input
          type="range"
          min={0}
          max={maxVisibleRuns}
          step={1}
          value={visibleRuns}
          onChange={(e) => onVisibleRunsChange(Number(e.target.value))}
          className="h-1.5 w-32 cursor-pointer accent-[color:var(--color-accent)]"
          aria-label={t("cash.toolbar.runs")}
        />
        <span className="min-w-[4.5rem] rounded-sm border border-[color:var(--color-border)]/60 bg-[color:var(--color-bg)]/55 px-2 py-1 text-right font-mono text-[11px] tabular-nums text-[color:var(--color-fg-muted)]">
          {visibleRuns}/{maxVisibleRuns}
        </span>
        <span className="hidden text-[color:var(--color-border-strong)] xl:inline">
          /
        </span>
        <RunModeToggle value={runMode} onChange={onRunModeChange} />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-sm border border-[color:var(--color-border)]/75 bg-[color:var(--color-bg)]/42 px-3 py-2">
        <span className="eyebrow text-[10px] tracking-[0.14em] text-[color:var(--color-fg-muted)]">
          {t("cash.toolbar.units")}
        </span>
        <UnitToggle
          value={moneyUnit}
          onChange={onMoneyUnitChange}
          options={[
            { value: "bb", label: t("cash.unit.bb") },
            { value: "usd", label: t("cash.unit.usd") },
          ]}
        />
        <span className="rounded-sm border border-[color:var(--color-heart)]/35 bg-[color:var(--color-heart)]/10 px-2 py-1 font-mono text-[11px] tabular-nums text-[color:var(--color-heart)]">
          {formatRiskThreshold(riskThresholdBb, moneyUnit, bbSize)}
        </span>
      </div>
    </div>
  );
}

export function TrajectoryChart({
  result,
  bbSize,
  visibleRuns,
  runMode,
  moneyUnit,
  riskThresholdBb,
}: {
  result: CashResult;
  bbSize: number;
  visibleRuns: number;
  runMode: RunMode;
  moneyUnit: CashMoneyUnit;
  riskThresholdBb: number;
}) {
  const t = useT();
  const [linePresetId] = useLocalStorageState(
    "tvs.lineStylePreset.v1",
    loadLineStylePreset,
    saveLineStylePreset,
    DEFAULT_LINE_STYLE_PRESET,
  );
  const [cursor, setCursor] = useState<CursorInfo | null>(null);
  const [xZoomed, setXZoomed] = useState(false);
  const plotRef = useRef<uPlot | null>(null);
  const hlCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const linePreset = LINE_STYLE_PRESETS[linePresetId];
  const maxRuns = Math.min(CASH_TRAJECTORY_RUN_CAP, result.samplePaths.paths.length);
  const clampedVisibleRuns =
    maxRuns <= 0 ? 0 : Math.max(1, Math.min(visibleRuns, maxRuns));
  const deferredVisibleRuns = useDeferredValue(clampedVisibleRuns);

  const assets = useMemo(() => {
    const env = result.envelopes;
    const x = Array.from(env.x, (h) => h);
    const convert = (v: number) => convertCashMoney(v, moneyUnit, bbSize);
    const data: Array<(number | null)[]> = [x];
    const rawBbData: Array<(number | null)[]> = [x];
    const noPoints = { show: false as const };
    const series: NonNullable<Parameters<typeof UplotChart>[0]["options"]>["series"] = [
      {},
    ];
    const lines: CashTrajectoryLineMeta[] = [];
    const pushSeries = (
      rawBb: number[],
      opt: NonNullable<Parameters<typeof UplotChart>[0]["options"]>["series"][number],
      meta: Omit<CashTrajectoryLineMeta, "seriesIdx">,
    ) => {
      const idx = data.length;
      data.push(rawBb.map(convert));
      rawBbData.push(rawBb);
      series.push(opt);
      lines.push({ ...meta, seriesIdx: idx });
    };

    const maxX = Math.max(1, x[x.length - 1] ?? 1);
    pushSeries(
      buildLinearRef(x, result.stats.expectedEvBb / maxX),
      {
        stroke: linePreset.ev.stroke,
        width: linePreset.ev.width,
        dash: linePreset.ev.dash,
        points: noPoints,
        label: "EV",
      },
      { label: "EV", color: linePreset.ev.stroke, kind: "ref" },
    );
    pushSeries(
      Array.from(env.p025),
      {
        stroke: linePreset.bandWide.stroke,
        width: linePreset.bandWide.width,
        dash: linePreset.bandWide.dash,
        points: noPoints,
        label: "p2.5",
      },
      { label: "p2.5", color: linePreset.bandWide.stroke, kind: "band", percentile: 0.025 },
    );
    pushSeries(
      Array.from(env.p975),
      {
        stroke: linePreset.bandWide.stroke,
        width: linePreset.bandWide.width,
        dash: linePreset.bandWide.dash,
        points: noPoints,
        label: "p97.5",
      },
      { label: "p97.5", color: linePreset.bandWide.stroke, kind: "band", percentile: 0.975 },
    );
    pushSeries(
      Array.from(env.p15),
      {
        stroke: linePreset.bandNarrow.stroke,
        width: linePreset.bandNarrow.width,
        points: noPoints,
        label: "p15",
      },
      { label: "p15", color: linePreset.bandNarrow.stroke, kind: "band", percentile: 0.15 },
    );
    pushSeries(
      Array.from(env.p85),
      {
        stroke: linePreset.bandNarrow.stroke,
        width: linePreset.bandNarrow.width,
        points: noPoints,
        label: "p85",
      },
      { label: "p85", color: linePreset.bandNarrow.stroke, kind: "band", percentile: 0.85 },
    );
    pushSeries(
      Array.from(env.mean),
      {
        stroke: linePreset.mean.stroke,
        width: linePreset.mean.width,
        points: noPoints,
        label: "mean",
      },
      { label: "mean", color: linePreset.mean.stroke, kind: "mean" },
    );
    pushSeries(
      Array.from(env.p05),
      {
        stroke: linePreset.p05.stroke,
        width: linePreset.p05.width,
        dash: linePreset.p05.dash,
        points: noPoints,
        label: "p5",
      },
      { label: "p5", color: linePreset.p05.stroke, kind: "band", percentile: 0.05 },
    );
    pushSeries(
      Array.from(env.p95),
      {
        stroke: linePreset.p95.stroke,
        width: linePreset.p95.width,
        dash: linePreset.p95.dash,
        points: noPoints,
        label: "p95",
      },
      { label: "p95", color: linePreset.p95.stroke, kind: "band", percentile: 0.95 },
    );
    pushSeries(
      new Array<number>(x.length).fill(-riskThresholdBb),
      {
        stroke: "rgba(255,145,118,0.9)",
        width: 1.4,
        dash: [6, 5],
        points: noPoints,
        label: "risk",
      },
      { label: formatRiskThreshold(riskThresholdBb, moneyUnit, bbSize), color: "rgba(255,145,118,0.9)", kind: "ref" },
    );

    const ranked = rankedRunIndices(result.samplePaths.paths, runMode);
    const pathCount = Math.min(deferredVisibleRuns, ranked.length);
    const pathStyle = pathStyleForCount(linePreset.path, Math.max(1, pathCount));
    const [pathR, pathG, pathB] = parseRgb(pathStyle.stroke);
    const baseAlphaMatch = pathStyle.stroke.match(
      /rgba\(\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([0-9.]+)\)/i,
    );
    const baseAlpha = baseAlphaMatch ? Number(baseAlphaMatch[1]) : 0.4;
    const hiX = result.samplePaths.x;
    const pathFinals = result.samplePaths.paths.map((path, idx) => ({
      idx,
      final: path[path.length - 1] ?? 0,
    }));
    pathFinals.sort((a, b) => a.final - b.final || a.idx - b.idx);
    const polarity = new Float64Array(result.samplePaths.paths.length);
    const denom = Math.max(1, pathFinals.length - 1);
    for (let k = 0; k < pathFinals.length; k++) {
      const q = k / denom;
      polarity[pathFinals[k].idx] = Math.abs(2 * q - 1);
    }

    for (let rank = 0; rank < pathCount; rank++) {
      const runIdx = ranked[rank];
      const boost = polarity[runIdx] >= 0.98 ? 1.2 : 1;
      const alpha = Math.min(0.95, baseAlpha * boost);
      const width = pathStyle.width * boost;
      const stroke = `rgba(${pathR},${pathG},${pathB},${alpha.toFixed(3)})`;
      pushSeries(
        alignCashPathToEnvX(x, hiX, result.samplePaths.paths[runIdx]),
        {
          stroke,
          width,
          points: noPoints,
          label: `Run ${result.samplePaths.sampleIndices[runIdx] + 1}`,
        },
        {
          label: `Run ${result.samplePaths.sampleIndices[runIdx] + 1}`,
          color: stroke,
          kind: "path",
          rank,
        },
      );
    }

    const axes = cashAxes(
      t("cash.axis.hands"),
      moneyUnit === "usd" ? t("cash.axis.usd") : t("cash.axis.bb"),
      64,
    );

    return {
      data: data as unknown as Parameters<typeof UplotChart>[0]["data"],
      rawBbData,
      lines,
      xMin: Number(x[0] ?? 0),
      xMax: Number(x[x.length - 1] ?? 0),
      options: {
        series,
        cursor: { show: true, points: { show: false } },
        legend: { show: false },
        scales: { x: { time: false }, y: { auto: true } },
        axes: axes.map((axis, axisIdx) =>
          axisIdx === 1
            ? {
                ...axis,
                values: (_u: uPlot, splits: number[]) =>
                  splits.map((value) =>
                    moneyUnit === "usd" ? formatUsd(value) : formatBb(value),
                  ),
              }
            : axis,
        ),
      } satisfies Omit<Parameters<typeof UplotChart>[0]["options"], "width" | "height">,
    };
  }, [
    bbSize,
    deferredVisibleRuns,
    linePreset,
    moneyUnit,
    result,
    riskThresholdBb,
    runMode,
    t,
  ]);

  const legendItems = useMemo(
    () =>
      [
        {
          key: "ev",
          label: t("chart.traj.legend.ev"),
          color: linePreset.ev.stroke,
          dash: true,
        },
        deferredVisibleRuns > 0 && {
          key: "runs",
          label: t("chart.traj.legend.runs").replace(
            "{n}",
            deferredVisibleRuns.toLocaleString(),
          ),
          color: linePreset.path.stroke,
        },
        {
          key: "bands",
          label: t("chart.traj.legend.bands"),
          color: linePreset.bandNarrow.stroke,
        },
      ].filter(Boolean) as Array<{
        key: string;
        label: string;
        color: string;
        dash?: boolean;
      }>,
    [deferredVisibleRuns, linePreset, t],
  );

  const handlePlotReady = useCallback((plot: uPlot | null) => {
    plotRef.current = plot;
  }, []);
  const handleScaleChange = useCallback(
    (scaleKey: string, min: number | null, max: number | null) => {
      if (scaleKey !== "x") return;
      if (min == null || max == null || !Number.isFinite(min) || !Number.isFinite(max)) {
        setXZoomed(false);
        return;
      }
      const span = Math.max(1, assets.xMax - assets.xMin);
      const eps = span * 1e-6;
      setXZoomed(
        Math.abs(min - assets.xMin) > eps || Math.abs(max - assets.xMax) > eps,
      );
    },
    [assets.xMax, assets.xMin],
  );
  const resetZoom = useCallback(() => {
    const plot = plotRef.current;
    if (!plot) return;
    plot.setScale("x", { min: assets.xMin, max: assets.xMax });
  }, [assets.xMax, assets.xMin]);

  const idx = cursor?.idx;
  let nearest: CashTrajectoryLineMeta | null = null;
  let nearestDisplayVal = 0;
  let nearestRawBbVal = 0;
  let nearestPath: CashTrajectoryLineMeta | null = null;
  let nearestPathDisplayVal = 0;
  let nearestPathRawBbVal = 0;
  if (cursor && idx != null) {
    let bestDist = Infinity;
    let bestPathPxDist = Infinity;
    for (const line of assets.lines) {
      const displayArr = assets.data[line.seriesIdx] as ArrayLike<number | null> | undefined;
      const rawBbArr = assets.rawBbData[line.seriesIdx] as ArrayLike<number | null> | undefined;
      if (!displayArr || !rawBbArr) continue;
      const displayVal = displayArr[idx];
      const rawBbVal = rawBbArr[idx];
      const hasVisibleValue =
        displayVal != null &&
        rawBbVal != null &&
        Number.isFinite(displayVal) &&
        Number.isFinite(rawBbVal);
      if (hasVisibleValue) {
        const d = Math.abs(Number(displayVal) - cursor.valY);
        if (d < bestDist) {
          bestDist = d;
          nearest = line;
          nearestDisplayVal = Number(displayVal);
          nearestRawBbVal = Number(rawBbVal);
        }
      }
      if (line.kind === "path") {
        const pxDist = visualDistanceToSeries(
          cursor,
          assets.data[0] as ArrayLike<number>,
          displayArr,
        );
        if (pxDist < bestPathPxDist) {
          bestPathPxDist = pxDist;
          nearestPath = line;
          nearestPathDisplayVal = hasVisibleValue ? Number(displayVal) : cursor.valY;
          nearestPathRawBbVal = hasVisibleValue ? Number(rawBbVal) : 0;
        }
      }
    }
    if (nearestPath && bestPathPxDist <= CASH_PATH_HIT_PX) {
      nearest = nearestPath;
      nearestDisplayVal = nearestPathDisplayVal;
      nearestRawBbVal = nearestPathRawBbVal;
    }
  }

  const focusedSeriesIdx = nearest?.kind === "path" ? nearest.seriesIdx : null;
  const focusedPathStats = useMemo(() => {
    if (focusedSeriesIdx == null) return null;
    const yArr = assets.rawBbData[focusedSeriesIdx] as ArrayLike<number> | undefined;
    const xArr = assets.data[0] as ArrayLike<number> | undefined;
    if (!yArr || !xArr || yArr.length === 0) return null;

    let peak = -Infinity;
    let maxDd = 0;
    let ddStart = 0;
    let ddEnd = 0;
    let curPeakIdx = 0;
    for (let i = 0; i < yArr.length; i++) {
      const value = yArr[i];
      if (!Number.isFinite(value)) continue;
      if (value > peak) {
        peak = value;
        curPeakIdx = i;
      }
      const dd = peak - value;
      if (dd > maxDd) {
        maxDd = dd;
        ddStart = curPeakIdx;
        ddEnd = i;
      }
    }

    let longestBelowPeak = 0;
    let belowPeakStart = 0;
    let belowPeakEnd = 0;
    peak = -Infinity;
    let streakStart = 0;
    let streakLen = 0;
    for (let i = 0; i < yArr.length; i++) {
      const value = yArr[i];
      if (!Number.isFinite(value)) continue;
      if (value > peak) {
        peak = value;
        streakStart = i;
        streakLen = 0;
      } else {
        streakLen++;
        if (streakLen > longestBelowPeak) {
          longestBelowPeak = streakLen;
          belowPeakStart = streakStart;
          belowPeakEnd = i;
        }
      }
    }

    const handAt = (i: number) => Math.round(xArr[i] ?? 0);
    return {
      finalBb: yArr[yArr.length - 1] ?? 0,
      maxDd,
      ddStart,
      ddEnd,
      ddHands: Math.max(0, handAt(ddEnd) - handAt(ddStart)),
      belowPeakHands:
        longestBelowPeak > 0
          ? Math.max(0, handAt(belowPeakEnd) - handAt(belowPeakStart))
          : 0,
    };
  }, [assets.data, assets.rawBbData, focusedSeriesIdx]);

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
    const width = plot.over.clientWidth;
    const height = plot.over.clientHeight;
    const dpr = devicePixelRatio;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (focusedSeriesIdx == null) return;
    const xArr = assets.data[0] as ArrayLike<number>;
    const yArr = assets.data[focusedSeriesIdx] as ArrayLike<number>;
    if (!xArr || !yArr) return;

    const strokeSegment = (
      startIdx: number,
      endIdx: number,
      stroke: string,
      lineWidth: number,
    ) => {
      ctx.save();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.lineJoin = "round";
      ctx.beginPath();
      let started = false;
      for (let i = startIdx; i <= endIdx; i++) {
        const xVal = xArr[i];
        const yVal = yArr[i];
        if (xVal == null || yVal == null || !Number.isFinite(yVal)) continue;
        const px = plot.valToPos(xVal, "x", false);
        const py = plot.valToPos(yVal, "y", false);
        if (!started) {
          ctx.moveTo(px, py);
          started = true;
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.stroke();
      ctx.restore();
    };

    strokeSegment(0, xArr.length - 1, "rgba(253,230,138,0.9)", 2.5);
    if (focusedPathStats && focusedPathStats.ddEnd > focusedPathStats.ddStart) {
      strokeSegment(
        focusedPathStats.ddStart,
        focusedPathStats.ddEnd,
        "rgba(248,113,113,0.95)",
        3,
      );
    }
  }, [assets.data, focusedPathStats, focusedSeriesIdx]);

  const kindLabel = (line: CashTrajectoryLineMeta): string => {
    switch (line.kind) {
      case "mean":
        return t("chart.traj.kind.mean");
      case "band":
        return t("chart.traj.kind.band");
      case "path":
        return t("chart.traj.kind.path");
      case "ref":
        return t("chart.traj.kind.ref");
    }
  };

  const hands = idx != null ? Math.round((assets.data[0] as number[])[idx] ?? 0) : 0;
  const winrateSoFar = hands > 0 ? (nearestRawBbVal / hands) * 100 : null;

  return (
    <CashChartFrame>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 border-b border-[color:var(--color-border)] pb-3">
          <div className="flex flex-wrap items-center gap-2">
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
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-[color:var(--color-fg-dim)]">
            <span>{t("chart.traj.zoomHint")}</span>
            <span className="text-[color:var(--color-border-strong)]">/</span>
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block h-[3px] w-3 rounded-sm"
                style={{ background: "rgba(248,113,113,0.95)" }}
                aria-hidden
              />
              {t("chart.traj.hoverHint.maxDd")}
            </span>
          </div>
        </div>

        {xZoomed && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={resetZoom}
              className="rounded border border-[color:var(--color-accent)]/50 bg-[color:var(--color-bg)]/85 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-[color:var(--color-accent)] shadow-sm transition hover:bg-[color:var(--color-accent)] hover:text-black"
              title={t("chart.traj.resetZoom")}
            >
              {t("chart.traj.resetZoom")}
            </button>
          </div>
        )}

        <UplotChart
          data={assets.data}
          options={assets.options}
          height={360}
          onCursor={setCursor}
          onPlotReady={handlePlotReady}
          onScaleChange={handleScaleChange}
          onDoubleClick={resetZoom}
        />

        {cursor && idx != null && nearest && (
          <div className="overflow-hidden rounded-md border border-[color:var(--color-border-strong)] bg-[color:var(--color-bg)]/95 text-[11px] shadow-xl backdrop-blur">
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
                {nearest.label}
              </span>
              <span className="ml-auto text-[9px] text-[color:var(--color-fg-dim)]">
                {kindLabel(nearest)}
              </span>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 py-2 tabular-nums">
              <span className="text-[color:var(--color-fg-dim)]">{t("cash.hands.label")}</span>
              <span className="text-right font-semibold text-[color:var(--color-fg)]">
                {hands.toLocaleString()}
              </span>
              <span className="text-[color:var(--color-fg-dim)]">
                {t("cash.chart.trajectory.bankrollBb")}
              </span>
              <span
                className="text-right font-semibold"
                style={{
                  color:
                    nearestRawBbVal >= 0
                      ? "var(--color-success)"
                      : "var(--color-danger)",
                }}
              >
                {formatBb(nearestRawBbVal)}
              </span>
              <span className="text-[color:var(--color-fg-dim)]">
                {t("cash.chart.trajectory.bankrollUsd")}
              </span>
              <span
                className="text-right font-semibold"
                style={{
                  color:
                    nearestRawBbVal >= 0
                      ? "var(--color-success)"
                      : "var(--color-danger)",
                }}
              >
                {formatUsd(nearestRawBbVal * bbSize)}
              </span>
              <span className="text-[color:var(--color-fg-dim)]">
                {moneyUnit === "usd"
                  ? t("cash.chart.trajectory.bankrollUsd")
                  : t("cash.chart.trajectory.bankrollBb")}
              </span>
              <span
                className="text-right font-semibold"
                style={{
                  color:
                    nearestDisplayVal >= 0
                      ? "var(--color-success)"
                      : "var(--color-danger)",
                }}
              >
                {moneyUnit === "usd"
                  ? formatUsd(nearestDisplayVal)
                  : formatBb(nearestDisplayVal)}
              </span>
              <span className="text-[color:var(--color-fg-dim)]">
                {t("cash.wrBb100.label")}
              </span>
              <span
                className="text-right font-semibold"
                style={{
                  color:
                    winrateSoFar != null && winrateSoFar >= 0
                      ? "var(--color-success)"
                      : "var(--color-danger)",
                }}
              >
                {winrateSoFar != null ? `${winrateSoFar.toFixed(2)}` : "—"}
              </span>
            </div>
            {focusedPathStats && (
              <div className="border-t border-[color:var(--color-border)]/50 px-3 py-2">
                <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
                  {t("chart.traj.runStats")}
                </div>
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
                      {formatBb(focusedPathStats.maxDd)} BB
                    </span>
                    <span className="rounded-sm bg-[color:var(--color-danger)]/12 px-1 py-0.5 text-[9px] font-semibold text-[color:var(--color-danger)]">
                      {formatUsd(focusedPathStats.maxDd * bbSize)}
                    </span>
                  </div>
                  {focusedPathStats.ddHands > 0 && (
                    <div className="mt-0.5 text-[9px] text-[color:var(--color-fg-dim)]">
                      {focusedPathStats.ddHands.toLocaleString()} {t("cash.hands.label").toLowerCase()}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums">
                  <span className="text-[color:var(--color-fg-dim)]">
                    {t("cash.chart.trajectory.finalBankroll")}
                  </span>
                  <span
                    className="text-right font-semibold"
                    style={{
                      color:
                        focusedPathStats.finalBb >= 0
                          ? "var(--color-success)"
                          : "var(--color-danger)",
                    }}
                  >
                    {formatBb(focusedPathStats.finalBb)} BB
                  </span>
                  <span className="text-[color:var(--color-fg-dim)]">
                    {t("chart.traj.longestBE")}
                  </span>
                  <span className="text-right text-[color:var(--color-fg)]">
                    {focusedPathStats.belowPeakHands.toLocaleString()} {t("cash.hands.label").toLowerCase()}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </CashChartFrame>
  );
}

function RunModeToggle({
  value,
  onChange,
}: {
  value: RunMode;
  onChange: (next: RunMode) => void;
}) {
  const t = useT();
  const modes: RunMode[] = ["worst", "random", "best"];
  return (
    <div
      className="inline-flex max-w-full overflow-hidden rounded-md border border-[color:var(--color-border)]"
      role="radiogroup"
      aria-label={t("runs.mode.title")}
      title={t("runs.mode.title")}
    >
      {modes.map((mode, idx) => {
        const active = mode === value;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(mode)}
            className={
              "px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors " +
              (active
                ? "bg-[color:var(--color-accent)] text-[color:var(--color-bg)]"
                : "bg-[color:var(--color-bg-elev)] text-[color:var(--color-fg-muted)] hover:bg-[color:var(--color-bg-elev-2)] hover:text-[color:var(--color-fg)]") +
              (idx > 0 ? " border-l border-[color:var(--color-border)]" : "")
            }
          >
            {t(`runs.mode.${mode}`)}
          </button>
        );
      })}
    </div>
  );
}

export function HistogramChart({
  hist,
  xLabel,
  yLabel,
  tone,
}: {
  hist: { binEdges: number[]; counts: number[] };
  xLabel: string;
  yLabel: string;
  tone: SuitAccent;
}) {
  const palette = CASH_ACCENT_META[tone];
  const data = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < hist.counts.length; i++) {
      xs.push((hist.binEdges[i] + hist.binEdges[i + 1]) / 2);
      ys.push(hist.counts[i]);
    }
    return [xs, ys] as Parameters<typeof UplotChart>[0]["data"];
  }, [hist]);

  return (
    <CashChartFrame>
      <UplotChart
        data={data}
        options={{
          series: [
            {},
            {
              stroke: palette.chartStroke,
              fill: palette.chartFill,
              width: 2,
              points: { show: false },
            },
          ],
          cursor: { show: true, points: { show: false } },
          legend: { show: false },
          scales: {
            x: { time: false },
            y: { range: (_u, _min, max) => [0, max * 1.05] },
          },
          axes: cashAxes(xLabel, yLabel),
        }}
        height={220}
      />
    </CashChartFrame>
  );
}

export function CashOddsChart({ result }: { result: CashResult }) {
  const t = useT();
  const data = useMemo(
    () =>
      [
        Array.from(result.oddsOverDistance.x),
        Array.from(result.oddsOverDistance.profitShare),
        Array.from(result.oddsOverDistance.belowThresholdNowShare),
      ] as Parameters<typeof UplotChart>[0]["data"],
    [result],
  );

  return (
    <CashChartFrame>
      <UplotChart
        data={data}
        options={{
          series: [
            {},
            {
              stroke: CASH_ACCENT_META.club.chartStroke,
              width: 2.35,
              points: { show: false },
            },
            {
              stroke: CASH_ACCENT_META.heart.chartStroke,
              width: 2.35,
              points: { show: false },
            },
          ],
          cursor: { show: true, points: { show: false } },
          legend: { show: false },
          scales: {
            x: { time: false },
            y: { range: () => [0, 1] },
          },
          axes: cashPctAxes(t("cash.axis.hands"), t("cash.axis.share")),
        }}
        height={240}
      />
    </CashChartFrame>
  );
}

export function CashConvergenceChart({ result }: { result: CashResult }) {
  const t = useT();
  const data = useMemo(
    () =>
      [
        Array.from(result.convergence.x),
        Array.from(result.convergence.seLo),
        Array.from(result.convergence.mean),
        Array.from(result.convergence.seHi),
      ] as Parameters<typeof UplotChart>[0]["data"],
    [result],
  );

  return (
    <CashChartFrame>
      <UplotChart
        data={data}
        options={{
          series: [
            {},
            {
              stroke: "rgba(118,176,255,0.7)",
              width: 1.25,
              points: { show: false },
            },
            {
              stroke: "#9cc3ff",
              width: 2.35,
              points: { show: false },
            },
            {
              stroke: "rgba(118,176,255,0.7)",
              width: 1.25,
              points: { show: false },
            },
          ],
          cursor: { show: true, points: { show: false } },
          legend: { show: false },
          scales: { x: { time: false } },
          axes: cashAxes(t("cash.axis.samples"), t("cash.axis.winrate")),
        }}
        height={220}
      />
    </CashChartFrame>
  );
}

export function DiagnosticsDisclosure({ result }: { result: CashResult }) {
  const t = useT();
  return (
    <details className="data-surface-card rounded-sm border border-[color:var(--color-border)]/75 bg-[color:var(--color-bg-elev)]/68">
      <summary className="cursor-pointer list-none px-4 py-4 [&::-webkit-details-marker]:hidden">
        <div className="flex items-start justify-between gap-3">
          <ChartTitle
            suit="spade"
            title={t("cash.section.diagnostics.title")}
            note={t("cash.section.diagnostics.note")}
          />
          <span className="mt-0.5 text-[11px] text-[color:var(--color-fg-dim)]">
            ▾
          </span>
        </div>
      </summary>
      <div className="px-4 pb-4">
        <MiniChartTitle
          suit="spade"
          title={t("cash.chart.convergence.title")}
          note={t("cash.chart.convergence.note")}
        />
        <div className="mt-3">
          <CashConvergenceChart result={result} />
        </div>
      </div>
    </details>
  );
}
