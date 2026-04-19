"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { AlignedData, Options } from "uplot";
import { UplotChart, type CursorInfo } from "./UplotChart";
import { barsPath } from "./barsPath";
import { useT } from "@/lib/i18n/LocaleProvider";

interface Props {
  binEdges: number[];
  counts: number[];
  color?: string;
  height?: number;
  /** When set, divides x by this to display in average buy-ins. */
  scaleBy?: number;
  unitLabel?: "$" | "ABI" | "tourneys" | "seats";
  /**
   * Show the Y axis as a percentage of total mass instead of raw sample
   * counts. Each bar and the overlay (if any) are normalised by the sum of
   * their own counts, so the chart reads "what fraction of runs land here"
   * regardless of how many samples were actually simulated.
   */
  yAsPct?: boolean;
  /** Optional second histogram (different binning) — drawn as a line on
   *  top of the bars. Resampled onto the primary bins via CDF interp so
   *  the curves are mass-comparable regardless of bin widths. */
  overlay?: {
    binEdges: number[];
    counts: number[];
    color?: string;
    label?: string;
  } | null;
  /**
   * Pin the x-axis domain (in raw units, before `scaleBy` division). Useful
   * when the parent toggles between two histograms whose edges shift (e.g.
   * rakeback on/off) and wants the bars to translate inside a stable axis
   * instead of the axis auto-rescaling around them.
   */
  xDomain?: [number, number];
}

function resampleOntoBins(
  srcEdges: number[],
  srcCounts: number[],
  dstEdges: number[],
): number[] {
  // CDF over srcEdges (length = srcCounts.length + 1)
  const cdf = new Float64Array(srcEdges.length);
  for (let i = 0; i < srcCounts.length; i++) cdf[i + 1] = cdf[i] + srcCounts[i];
  const cdfTotal = cdf[cdf.length - 1] || 1;
  const lastEdge = srcEdges[srcEdges.length - 1];
  const interp = (x: number): number => {
    if (x <= srcEdges[0]) return 0;
    if (x >= lastEdge) return cdfTotal;
    let lo = 0;
    let hi = srcEdges.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (srcEdges[mid] <= x) lo = mid;
      else hi = mid;
    }
    const span = srcEdges[hi] - srcEdges[lo];
    const t = span > 0 ? (x - srcEdges[lo]) / span : 0;
    return cdf[lo] + t * (cdf[hi] - cdf[lo]);
  };
  const out = new Array<number>(dstEdges.length - 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = interp(dstEdges[i + 1]) - interp(dstEdges[i]);
  }
  return out;
}

const compactNum = (v: number, prefix = ""): string => {
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}${prefix}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${prefix}${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  if (abs === 0) return `${prefix}0`;
  return `${sign}${prefix}${abs.toFixed(abs < 10 ? 1 : 0)}`;
};

const formatEdge = (v: number, unitLabel: Props["unitLabel"]): string => {
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  const nice = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 10_000) return `${(n / 1_000).toFixed(0)}k`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    if (n >= 100) return n.toFixed(0);
    if (n >= 10) return n.toFixed(0);
    return n.toFixed(n < 1 ? 2 : 1);
  };
  switch (unitLabel) {
    case "$":
      return `${sign}$${nice(abs)}`;
    case "ABI":
      return `${sign}${nice(abs)} BI`;
    case "seats":
      return `${sign}${nice(abs)}`;
    case "tourneys":
    default:
      return `${sign}${nice(abs)}`;
  }
};

function DistributionChartImpl({
  binEdges,
  counts,
  color = "#818cf8",
  height = 260,
  scaleBy,
  unitLabel = "$",
  yAsPct = false,
  overlay,
  xDomain,
}: Props) {
  const t = useT();
  const divisor = scaleBy && scaleBy > 0 ? scaleBy : 1;
  const overlayColor = overlay?.color ?? "#60a5fa";
  const [cursor, setCursor] = useState<CursorInfo | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerW, setContainerW] = useState(0);
  const [containerH, setContainerH] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      setContainerW(el.clientWidth);
      setContainerH(el.clientHeight);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // When overlaying, extend primary x-range to cover the overlay's tails so
  // we don't clip a long PD tail off either edge and under-report its mass.
  // Append zero-count primary bins at the same bin width on the side(s) where
  // overlay extends past primary, capped so a wild outlier can't flatten the
  // chart. Symmetric left-extension is what lets the first visible overlay
  // bin settle smoothly to 0 instead of starting mid-air.
  const merged = useMemo(() => {
    if (!overlay || binEdges.length < 2) return { edges: binEdges, counts };
    const primaryFirst = binEdges[0];
    const primaryLast = binEdges[binEdges.length - 1];
    const overlayFirst = overlay.binEdges[0];
    const overlayLast = overlay.binEdges[overlay.binEdges.length - 1];
    const stepRight =
      binEdges[binEdges.length - 1] - binEdges[binEdges.length - 2];
    const stepLeft = binEdges[1] - binEdges[0];

    const rightEdges: number[] = [];
    const rightCounts: number[] = [];
    if (overlayLast > primaryLast) {
      const maxExtended = Math.min(overlayLast, primaryLast * 5);
      let cur = primaryLast;
      while (cur < maxExtended && rightEdges.length < 120) {
        const next = Math.min(maxExtended, cur + stepRight);
        if (next <= cur) break;
        rightEdges.push(next);
        rightCounts.push(0);
        cur = next;
      }
    }

    const leftEdges: number[] = [];
    const leftCounts: number[] = [];
    if (overlayFirst < primaryFirst) {
      const primaryRange = Math.max(1e-9, primaryLast - primaryFirst);
      const minExtended = Math.max(overlayFirst, primaryFirst - primaryRange * 4);
      let cur = primaryFirst;
      while (cur > minExtended && leftEdges.length < 120) {
        const prev = Math.max(minExtended, cur - stepLeft);
        if (prev >= cur) break;
        leftEdges.push(prev);
        leftCounts.push(0);
        cur = prev;
      }
      leftEdges.reverse();
    }

    if (leftEdges.length === 0 && rightEdges.length === 0) {
      return { edges: binEdges, counts };
    }
    return {
      edges: [...leftEdges, ...binEdges, ...rightEdges],
      counts: [...leftCounts, ...counts, ...rightCounts],
    };
  }, [binEdges, counts, overlay]);

  const data = useMemo<AlignedData>(() => {
    const sumOf = (arr: number[]): number => {
      let t = 0;
      for (let i = 0; i < arr.length; i++) t += arr[i];
      return t;
    };
    const normalize = (arr: number[], denom: number): number[] => {
      if (!yAsPct) return arr;
      if (denom <= 0) return arr;
      const out = new Array<number>(arr.length);
      for (let i = 0; i < arr.length; i++) out[i] = (arr[i] / denom) * 100;
      return out;
    };
    const centers = new Array<number>(merged.counts.length);
    for (let i = 0; i < merged.counts.length; i++)
      centers[i] = ((merged.edges[i] + merged.edges[i + 1]) / 2) / divisor;
    const primary = normalize(merged.counts, sumOf(counts));
    if (overlay) {
      const resampled = resampleOntoBins(
        overlay.binEdges,
        overlay.counts,
        merged.edges,
      );
      const overlayDenom = sumOf(overlay.counts);
      const overlayY = normalize(resampled, overlayDenom);
      // Tail-smooth the overlay line only. The raw counts carry Poisson noise
      // (√100 ≈ 10% relative at 5k samples / 50 bins → 4-5 visible hedgehog
      // peaks on the PD line). A centred 3-point [1,2,1] filter flattens that
      // without distorting the distribution shape. Primary bars keep their
      // raw counts — bars are expected to be discrete, lines are expected
      // to be smooth.
      const smoothed = new Array<number>(overlayY.length);
      for (let i = 0; i < overlayY.length; i++) {
        const prev = i > 0 ? overlayY[i - 1] : overlayY[i];
        const next = i < overlayY.length - 1 ? overlayY[i + 1] : overlayY[i];
        smoothed[i] = (prev + 2 * overlayY[i] + next) / 4;
      }
      const withGaps: (number | null)[] = smoothed.slice();
      let i = 0;
      while (i < withGaps.length && (withGaps[i] ?? 0) <= 0) withGaps[i++] = null;
      let j = withGaps.length - 1;
      while (j >= 0 && (withGaps[j] ?? 0) <= 0) withGaps[j--] = null;
      return [centers, primary, withGaps as unknown as number[]];
    }
    return [centers, primary];
  }, [merged, counts, divisor, overlay, yAsPct]);

  const opts = useMemo<Omit<Options, "width" | "height">>(
    () => {
      const series: Options["series"] = [
        {},
        {
          stroke: color,
          fill: color + "59",
          width: 1,
          paths: barsPath(),
        },
      ];
      if (overlay) {
        series.push({
          stroke: overlayColor,
          width: 2.25,
          dash: [10, 6],
          label: overlay.label ?? "PrimeDope",
        });
      }
      const xScale: NonNullable<Options["scales"]>[string] = { time: false };
      if (xDomain) {
        const [lo, hi] = xDomain;
        xScale.range = () => [lo / divisor, hi / divisor];
      }
      return {
        scales: { x: xScale },
        axes: [
          {
            stroke: "#8a8a95",
            grid: { stroke: "rgba(128,128,128,0.15)" },
            ticks: { stroke: "rgba(128,128,128,0.2)" },
            values: (_u, splits) =>
              splits.map((v) =>
                unitLabel === "$"
                  ? compactNum(v, "$")
                  : unitLabel === "ABI"
                    ? `${compactNum(v)} BI`
                    : unitLabel === "seats"
                      ? compactNum(v)
                      : compactNum(v),
              ),
          },
          {
            stroke: "#8a8a95",
            grid: { stroke: "rgba(128,128,128,0.15)" },
            ticks: { stroke: "rgba(128,128,128,0.2)" },
            values: yAsPct
              ? (_u, splits) =>
                  splits.map((v) =>
                    v >= 10 ? `${v.toFixed(0)}%` : `${v.toFixed(1)}%`,
                  )
              : undefined,
          },
        ],
        series,
        legend: { show: false },
      };
    },
    [color, unitLabel, overlay, overlayColor, yAsPct, xDomain, divisor],
  );

  // Precompute totals + cumulative counts for the hover tooltip. Runs once
  // per (counts, overlay) change, so the hover handler itself stays O(1).
  const hoverStats = useMemo(() => {
    let primaryTotal = 0;
    for (let i = 0; i < merged.counts.length; i++)
      primaryTotal += merged.counts[i];
    const primaryCum = new Array<number>(merged.counts.length);
    let acc = 0;
    for (let i = 0; i < merged.counts.length; i++) {
      acc += merged.counts[i];
      primaryCum[i] = acc;
    }
    let overlayResampled: number[] | null = null;
    let overlayTotal = 0;
    if (overlay) {
      overlayResampled = resampleOntoBins(
        overlay.binEdges,
        overlay.counts,
        merged.edges,
      );
      for (let i = 0; i < overlay.counts.length; i++)
        overlayTotal += overlay.counts[i];
    }
    return { primaryTotal, primaryCum, overlayResampled, overlayTotal };
  }, [merged, overlay]);

  const binIdx =
    cursor &&
    cursor.idx != null &&
    cursor.idx >= 0 &&
    cursor.idx < merged.counts.length
      ? cursor.idx
      : null;

  const tip = useMemo(() => {
    if (binIdx == null) return null;
    const lo = merged.edges[binIdx] / divisor;
    const hi = merged.edges[binIdx + 1] / divisor;
    const rangeLabel = `${formatEdge(lo, unitLabel)} – ${formatEdge(hi, unitLabel)}`;
    const count = merged.counts[binIdx] ?? 0;
    const share =
      hoverStats.primaryTotal > 0 ? count / hoverStats.primaryTotal : 0;
    const cumShare =
      hoverStats.primaryTotal > 0
        ? hoverStats.primaryCum[binIdx] / hoverStats.primaryTotal
        : 0;
    const isLastBin = binIdx === merged.counts.length - 1;
    let overlayShare: number | null = null;
    if (hoverStats.overlayResampled && hoverStats.overlayTotal > 0) {
      overlayShare =
        hoverStats.overlayResampled[binIdx] / hoverStats.overlayTotal;
    }
    return { rangeLabel, count, share, cumShare, isLastBin, overlayShare };
  }, [binIdx, merged, divisor, unitLabel, hoverStats]);

  return (
    <div ref={containerRef} className="relative w-full">
      <UplotChart
        data={data}
        options={opts}
        height={height}
        onCursor={setCursor}
      />
      {overlay && (
        <div className="mt-1 flex items-center gap-3 text-[10px] text-[color:var(--color-fg-dim)]">
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-3 rounded-sm" style={{ background: color }} />
            <span>{t("hist.legend.ours")}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-[1px] w-4 border-t-[1.5px] border-dashed" style={{ borderColor: overlayColor }} />
            <span style={{ color: overlayColor }}>{overlay.label ?? "PrimeDope"}</span>
          </span>
        </div>
      )}
      {cursor && tip && (
        <div
          className="pointer-events-none absolute z-10 min-w-[160px] max-w-[200px] rounded border border-[color:var(--color-border-strong)] bg-[color:var(--color-bg)]/95 px-2.5 py-1.5 text-[11px] shadow-xl backdrop-blur"
          style={{
            ...(containerW > 0 && cursor.left < containerW / 2
              ? { right: 6 }
              : { left: 6 }),
            ...(containerH > 0 && cursor.top < containerH / 2
              ? { bottom: 6 }
              : { top: 6 }),
          }}
        >
          <div className="mb-1.5 flex items-center gap-2 border-b border-[color:var(--color-border)]/50 pb-1">
            <span
              className="inline-block h-2 w-3 rounded-sm"
              style={{ background: color }}
            />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg)]">
              {t("hist.tooltip.range")}
            </span>
            <span className="ml-auto font-mono text-[10px] text-[color:var(--color-fg)]">
              {tip.rangeLabel}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums">
            <span className="text-[color:var(--color-fg-dim)]">
              {t("hist.tooltip.share")}
            </span>
            <span className="text-right font-semibold text-[color:var(--color-fg)]">
              {(tip.share * 100).toFixed(tip.share < 0.01 ? 2 : 1)}%
            </span>
            <span className="text-[color:var(--color-fg-dim)]">
              {t("hist.tooltip.count")}
            </span>
            <span className="text-right text-[color:var(--color-fg)]">
              {tip.count.toLocaleString()}
            </span>
            <span className="text-[color:var(--color-fg-dim)]">
              {t("hist.tooltip.cumulative")}
            </span>
            <span className="text-right text-[color:var(--color-fg)]">
              {(tip.cumShare * 100).toFixed(tip.cumShare >= 0.995 ? 2 : 1)}%
            </span>
            {tip.overlayShare != null && (
              <>
                <span
                  className="text-[color:var(--color-fg-dim)]"
                  style={{ color: overlayColor }}
                >
                  {overlay?.label ?? "overlay"}
                </span>
                <span className="text-right" style={{ color: overlayColor }}>
                  {(tip.overlayShare * 100).toFixed(
                    tip.overlayShare < 0.01 ? 2 : 1,
                  )}
                  %
                </span>
              </>
            )}
          </div>
          {tip.isLastBin && (
            <div className="mt-1 border-t border-[color:var(--color-border)]/50 pt-1 text-[9px] italic text-[color:var(--color-fg-dim)]">
              {t("hist.tooltip.overflow")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const DistributionChart = memo(DistributionChartImpl);
