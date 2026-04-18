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
  onPlotReady?: (plot: uPlot | null) => void;
  onScaleChange?: (scaleKey: string, min: number | null, max: number | null) => void;
  onDoubleClick?: () => void;
}

/**
 * Thin uPlot wrapper. Two-tier update strategy:
 *
 * - Plot is (re)created only when `options` or `height` change — these
 *   govern the series shape and overall chart structure, which uPlot can't
 *   patch in place.
 * - Data-only changes take the fast path: `plot.setData(data)`.
 *
 * Callers that need to toggle series visibility without a full rebuild can
 * subscribe via `onPlotReady` and drive `plot.setSeries(i, { show })`
 * imperatively.
 */
export function UplotChart({
  data,
  options,
  height = 320,
  onCursor,
  onPlotReady,
  onScaleChange,
  onDoubleClick,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const onCursorRef = useRef(onCursor);
  const onPlotReadyRef = useRef(onPlotReady);
  const onScaleChangeRef = useRef(onScaleChange);
  const onDoubleClickRef = useRef(onDoubleClick);
  const dataRef = useRef(data);

  useEffect(() => {
    onCursorRef.current = onCursor;
  }, [onCursor]);
  useEffect(() => {
    onPlotReadyRef.current = onPlotReady;
  }, [onPlotReady]);
  useEffect(() => {
    onScaleChangeRef.current = onScaleChange;
  }, [onScaleChange]);
  useEffect(() => {
    onDoubleClickRef.current = onDoubleClick;
  }, [onDoubleClick]);

  // Plot lifecycle — recreated only on options/height change.
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
        setScale: [
          ...(options.hooks?.setScale ?? []),
          (u: uPlot, key: string) => {
            const cb = onScaleChangeRef.current;
            if (!cb) return;
            const scale = u.scales[key];
            cb(key, scale?.min ?? null, scale?.max ?? null);
          },
        ],
      },
    };
    const plot = new uPlot(opts, dataRef.current, host);
    plotRef.current = plot;
    onPlotReadyRef.current?.(plot);

    const ro = new ResizeObserver(() => {
      const w = host.clientWidth || 600;
      plot.setSize({ width: w, height });
    });
    ro.observe(host);

    const onLeave = () => onCursorRef.current?.(null);
    const onDblClick = () => onDoubleClickRef.current?.();
    host.addEventListener("mouseleave", onLeave);
    host.addEventListener("dblclick", onDblClick);

    return () => {
      ro.disconnect();
      host.removeEventListener("mouseleave", onLeave);
      host.removeEventListener("dblclick", onDblClick);
      onPlotReadyRef.current?.(null);
      plot.destroy();
      plotRef.current = null;
    };
  }, [options, height]);

  // Data-only fast path — no rebuild, no series re-layout.
  useEffect(() => {
    dataRef.current = data;
    const plot = plotRef.current;
    if (!plot) return;
    plot.setData(data);
  }, [data]);

  return <div ref={hostRef} className="relative w-full" />;
}
