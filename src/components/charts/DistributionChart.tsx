"use client";

import { useMemo } from "react";
import type { AlignedData, Options } from "uplot";
import { UplotChart } from "./UplotChart";
import { barsPath } from "./barsPath";

interface Props {
  binEdges: number[];
  counts: number[];
  color?: string;
  height?: number;
  /** When set, divides x by this to display in average buy-ins. */
  scaleBy?: number;
  unitLabel?: "$" | "ABI";
  /** Optional second histogram (different binning) — drawn as a line on
   *  top of the bars. Resampled onto the primary bins via CDF interp so
   *  the curves are mass-comparable regardless of bin widths. */
  overlay?: {
    binEdges: number[];
    counts: number[];
    color?: string;
    label?: string;
  } | null;
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

export function DistributionChart({
  binEdges,
  counts,
  color = "#818cf8",
  height = 260,
  scaleBy,
  unitLabel = "$",
  overlay,
}: Props) {
  const divisor = scaleBy && scaleBy > 0 ? scaleBy : 1;
  const overlayColor = overlay?.color ?? "#f472b6";
  const data = useMemo<AlignedData>(() => {
    const centers = new Array<number>(counts.length);
    for (let i = 0; i < counts.length; i++)
      centers[i] = ((binEdges[i] + binEdges[i + 1]) / 2) / divisor;
    if (overlay) {
      const resampled = resampleOntoBins(overlay.binEdges, overlay.counts, binEdges);
      return [centers, counts, resampled];
    }
    return [centers, counts];
  }, [binEdges, counts, divisor, overlay]);

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
          label: overlay.label ?? "PrimeDope",
        });
      }
      return {
        scales: { x: { time: false } },
        axes: [
          {
            stroke: "#8a8a95",
            grid: { stroke: "rgba(128,128,128,0.15)" },
            ticks: { stroke: "rgba(128,128,128,0.2)" },
            values: (_u, splits) =>
              splits.map((v) =>
                unitLabel === "$" ? compactNum(v, "$") : `${compactNum(v)} BI`,
              ),
          },
          {
            stroke: "#8a8a95",
            grid: { stroke: "rgba(128,128,128,0.15)" },
            ticks: { stroke: "rgba(128,128,128,0.2)" },
          },
        ],
        series,
        legend: { show: false },
      };
    },
    [color, unitLabel, overlay, overlayColor],
  );

  return <UplotChart data={data} options={opts} height={height} />;
}
