"use client";

import { useMemo } from "react";
import type { AlignedData, Options } from "uplot";
import { UplotChart } from "./UplotChart";
import { darkAxes } from "./common";

interface Props {
  x: number[];
  mean: Float64Array;
  seLo: Float64Array;
  seHi: Float64Array;
  height?: number;
}

export function ConvergenceChart({ x, mean, seLo, seHi, height = 220 }: Props) {
  const data = useMemo<AlignedData>(
    () => [x, mean, seLo, seHi] as AlignedData,
    [x, mean, seLo, seHi],
  );

  const opts = useMemo<Omit<Options, "width" | "height">>(
    () => ({
      scales: { x: { time: false } },
      axes: darkAxes,
      series: [
        {},
        { stroke: "#a5b4fc", width: 2 },
        { stroke: "rgba(129,140,248,0.3)", width: 1 },
        { stroke: "rgba(129,140,248,0.3)", width: 1 },
      ],
      legend: { show: false },
    }),
    [],
  );

  return <UplotChart data={data} options={opts} height={height} />;
}
