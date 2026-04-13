import type { Options } from "uplot";

export function barsPath(): NonNullable<
  NonNullable<Options["series"]>[number] extends infer S
    ? S extends { paths?: infer P }
      ? P
      : never
    : never
> {
  return (u, seriesIdx, idx0, idx1) => {
    const series = u.series[seriesIdx];
    const fill = new Path2D();
    const stroke = new Path2D();
    const xData = u.data[0] as number[];
    const yData = u.data[seriesIdx] as number[];
    for (let i = idx0; i <= idx1; i++) {
      const x = xData[i];
      const y = yData[i];
      if (y == null) continue;
      const prev = i > 0 ? xData[i - 1] : x - (xData[i + 1] - x);
      const next = i < xData.length - 1 ? xData[i + 1] : x + (x - prev);
      const halfLeft = (x - prev) / 2;
      const halfRight = (next - x) / 2;
      const x0 = u.valToPos(x - halfLeft, "x", true);
      const x1 = u.valToPos(x + halfRight, "x", true);
      const y0 = u.valToPos(0, series.scale!, true);
      const y1 = u.valToPos(y, series.scale!, true);
      fill.rect(x0, y0, x1 - x0, y1 - y0);
      stroke.rect(x0, y0, x1 - x0, y1 - y0);
    }
    return { fill, stroke };
  };
}
