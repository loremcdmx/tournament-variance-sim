"use client";

import { useMemo } from "react";
import type { AlignedData, Options } from "uplot";
import { UplotChart } from "./UplotChart";
import { darkAxes } from "./common";
import { barsPath } from "./barsPath";

interface Props {
  binEdges: number[];
  counts: number[];
  color?: string;
  height?: number;
}

export function DistributionChart({
  binEdges,
  counts,
  color = "#818cf8",
  height = 260,
}: Props) {
  const data = useMemo<AlignedData>(() => {
    const centers = new Array<number>(counts.length);
    for (let i = 0; i < counts.length; i++)
      centers[i] = (binEdges[i] + binEdges[i + 1]) / 2;
    return [centers, counts];
  }, [binEdges, counts]);

  const opts = useMemo<Omit<Options, "width" | "height">>(
    () => ({
      scales: { x: { time: false } },
      axes: darkAxes,
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
    [color],
  );

  return <UplotChart data={data} options={opts} height={height} />;
}
