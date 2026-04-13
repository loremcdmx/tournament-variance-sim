"use client";

import { useMemo } from "react";
import type { AlignedData, Options } from "uplot";
import { UplotChart } from "./UplotChart";
import { darkAxes } from "./common";

interface Props {
  deltas: number[];
  profits: number[];
  height?: number;
}

export function SensitivityChart({ deltas, profits, height = 220 }: Props) {
  const data = useMemo<AlignedData>(
    () => [deltas, profits] as AlignedData,
    [deltas, profits],
  );
  const opts = useMemo<Omit<Options, "width" | "height">>(
    () => ({
      scales: { x: { time: false } },
      axes: darkAxes,
      series: [
        {},
        {
          stroke: "#818cf8",
          fill: "rgba(129,140,248,0.12)",
          width: 2,
          points: { show: true, size: 6, stroke: "#a5b4fc" },
        },
      ],
      legend: { show: false },
    }),
    [],
  );
  return <UplotChart data={data} options={opts} height={height} />;
}
