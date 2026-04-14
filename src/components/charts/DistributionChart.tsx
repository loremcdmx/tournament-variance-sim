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
}: Props) {
  const divisor = scaleBy && scaleBy > 0 ? scaleBy : 1;
  const data = useMemo<AlignedData>(() => {
    const centers = new Array<number>(counts.length);
    for (let i = 0; i < counts.length; i++)
      centers[i] = ((binEdges[i] + binEdges[i + 1]) / 2) / divisor;
    return [centers, counts];
  }, [binEdges, counts, divisor]);

  const opts = useMemo<Omit<Options, "width" | "height">>(
    () => ({
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
      series: [
        {},
        {
          stroke: color,
          fill: color + "59",
          width: 1,
          paths: barsPath(),
        },
      ],
      legend: { show: false },
    }),
    [color, unitLabel],
  );

  return <UplotChart data={data} options={opts} height={height} />;
}
