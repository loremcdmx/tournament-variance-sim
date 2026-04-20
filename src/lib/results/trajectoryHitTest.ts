export interface PlotCursorProjection {
  left: number;
  top: number;
  plotWidth: number;
  plotHeight: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

function pointToSegmentDistancePx(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function cursorValToPos(
  cursor: PlotCursorProjection,
  value: number,
  scale: "x" | "y",
): number {
  const min = scale === "x" ? cursor.xMin : cursor.yMin;
  const max = scale === "x" ? cursor.xMax : cursor.yMax;
  const size = scale === "x" ? cursor.plotWidth : cursor.plotHeight;
  const span = max - min;
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(span) ||
    !Number.isFinite(size) ||
    span === 0
  ) {
    return NaN;
  }
  const t = (value - min) / span;
  return scale === "x" ? t * size : (1 - t) * size;
}

function clipSegmentToPlotRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  height: number,
): [number, number, number, number] | null {
  if (
    !Number.isFinite(ax) ||
    !Number.isFinite(ay) ||
    !Number.isFinite(bx) ||
    !Number.isFinite(by) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };

  if (
    !clip(-dx, ax) ||
    !clip(dx, width - ax) ||
    !clip(-dy, ay) ||
    !clip(dy, height - ay)
  ) {
    return null;
  }

  return [
    ax + t0 * dx,
    ay + t0 * dy,
    ax + t1 * dx,
    ay + t1 * dy,
  ];
}

export function visualDistanceToSeries(
  cursor: PlotCursorProjection,
  xArr: ArrayLike<number>,
  yArr: ArrayLike<number>,
  centerIdx: number,
): number {
  const len = Math.min(xArr.length, yArr.length);
  if (len <= 0) return Infinity;
  const lo = Math.max(0, centerIdx - 2);
  const hi = Math.min(len - 1, centerIdx + 2);
  let best = Infinity;
  for (let i = lo; i < hi; i++) {
    const x0 = xArr[i];
    const y0 = yArr[i];
    const x1 = xArr[i + 1];
    const y1 = yArr[i + 1];
    if (
      x0 == null ||
      y0 == null ||
      x1 == null ||
      y1 == null ||
      !Number.isFinite(x0) ||
      !Number.isFinite(y0) ||
      !Number.isFinite(x1) ||
      !Number.isFinite(y1)
    ) {
      continue;
    }
    const clipped = clipSegmentToPlotRect(
      cursorValToPos(cursor, x0, "x"),
      cursorValToPos(cursor, y0, "y"),
      cursorValToPos(cursor, x1, "x"),
      cursorValToPos(cursor, y1, "y"),
      cursor.plotWidth,
      cursor.plotHeight,
    );
    if (!clipped) continue;
    const d = pointToSegmentDistancePx(cursor.left, cursor.top, ...clipped);
    if (Number.isFinite(d) && d < best) best = d;
  }
  if (best < Infinity) return best;

  const idx = Math.max(0, Math.min(len - 1, centerIdx));
  const x = xArr[idx];
  const y = yArr[idx];
  if (
    x == null ||
    y == null ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    return Infinity;
  }
  const px = cursorValToPos(cursor, x, "x");
  const py = cursorValToPos(cursor, y, "y");
  if (px < 0 || px > cursor.plotWidth || py < 0 || py > cursor.plotHeight) {
    return Infinity;
  }
  return Math.hypot(cursor.left - px, cursor.top - py);
}
