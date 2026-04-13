"use client";

import { useEffect, useRef } from "react";
import uPlot, { type Options, type AlignedData } from "uplot";
import "uplot/dist/uPlot.min.css";

interface Props {
  data: AlignedData;
  options: Omit<Options, "width" | "height">;
  height?: number;
}

/** Thin wrapper: sizes to its container, rebuilds on data/options change. */
export function UplotChart({ data, options, height = 320 }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const host = hostRef.current;
    const width = host.clientWidth || 600;
    const opts: Options = { ...options, width, height };
    const plot = new uPlot(opts, data, host);
    plotRef.current = plot;

    const ro = new ResizeObserver(() => {
      const w = host.clientWidth || 600;
      plot.setSize({ width: w, height });
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
    // We intentionally re-create the plot on any options/data change for simplicity.
  }, [data, options, height]);

  return <div ref={hostRef} className="w-full" />;
}
