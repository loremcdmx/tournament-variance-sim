"use client";

import { useEffect, useRef } from "react";
import uPlot, { type Options, type AlignedData } from "uplot";
import "uplot/dist/uPlot.min.css";

export interface CursorInfo {
  idx: number;
  left: number;
  top: number;
  valY: number;
}

interface Props {
  data: AlignedData;
  options: Omit<Options, "width" | "height">;
  height?: number;
  onCursor?: (info: CursorInfo | null) => void;
}

/** Thin wrapper: sizes to its container, rebuilds on data/options change. */
export function UplotChart({ data, options, height = 320, onCursor }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const onCursorRef = useRef(onCursor);

  useEffect(() => {
    onCursorRef.current = onCursor;
  }, [onCursor]);

  useEffect(() => {
    if (!hostRef.current) return;
    const host = hostRef.current;
    const width = host.clientWidth || 600;
    const opts: Options = {
      ...options,
      width,
      height,
      hooks: {
        ...(options.hooks ?? {}),
        setCursor: [
          ...(options.hooks?.setCursor ?? []),
          (u: uPlot) => {
            const cb = onCursorRef.current;
            if (!cb) return;
            const { idx, left, top } = u.cursor;
            if (idx == null || left == null || left < 0) {
              cb(null);
              return;
            }
            const tp = top ?? 0;
            const valY = u.posToVal(tp, "y");
            cb({ idx, left, top: tp, valY });
          },
        ],
      },
    };
    const plot = new uPlot(opts, data, host);
    plotRef.current = plot;

    const ro = new ResizeObserver(() => {
      const w = host.clientWidth || 600;
      plot.setSize({ width: w, height });
    });
    ro.observe(host);

    const onLeave = () => onCursorRef.current?.(null);
    host.addEventListener("mouseleave", onLeave);

    return () => {
      ro.disconnect();
      host.removeEventListener("mouseleave", onLeave);
      plot.destroy();
      plotRef.current = null;
    };
    // We intentionally re-create the plot on any options/data change for simplicity.
  }, [data, options, height]);

  return <div ref={hostRef} className="relative w-full" />;
}
