export interface PlotCursorProjection {
  idx: number;
  left: number;
  top: number;
  plotWidth: number;
  plotHeight: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

const HIT_TEST_X_WINDOW_PX = 36;

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

function valToPos(
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
    span === 0 ||
    size <= 0
  ) {
    return NaN;
  }
  const t = (value - min) / span;
  return scale === "x" ? t * size : (1 - t) * size;
}

function cursorPosToVal(
  cursor: PlotCursorProjection,
  pos: number,
  scale: "x" | "y",
): number {
  const min = scale === "x" ? cursor.xMin : cursor.yMin;
  const max = scale === "x" ? cursor.xMax : cursor.yMax;
  const size = scale === "x" ? cursor.plotWidth : cursor.plotHeight;
  const span = max - min;
  if (
    !Number.isFinite(pos) ||
    !Number.isFinite(span) ||
    !Number.isFinite(size) ||
    span === 0 ||
    size <= 0
  ) {
    return NaN;
  }
  const t = scale === "x" ? pos / size : 1 - pos / size;
  return min + t * span;
}

function lowerBoundX(xArr: ArrayLike<number>, len: number, target: number): number {
  let lo = 0;
  let hi = len;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const val = xArr[mid];
    if (Number.isFinite(val) && val < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
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

function segmentSearchBounds(
  cursor: PlotCursorProjection,
  xArr: ArrayLike<number>,
  len: number,
): [number, number] {
  const fallback: [number, number] = [
    Math.max(0, cursor.idx - 8),
    Math.min(len - 1, cursor.idx + 8),
  ];
  const xAtCursor = cursorPosToVal(cursor, cursor.left, "x");
  const xSpan = cursor.xMax - cursor.xMin;
  if (
    !Number.isFinite(xAtCursor) ||
    !Number.isFinite(xSpan) ||
    xSpan === 0 ||
    cursor.plotWidth <= 0
  ) {
    return fallback;
  }

  const xPad = Math.abs(xSpan / cursor.plotWidth) * HIT_TEST_X_WINDOW_PX;
  if (!Number.isFinite(xPad) || xPad <= 0) return fallback;

  const lo = Math.max(0, lowerBoundX(xArr, len, xAtCursor - xPad) - 1);
  const hi = Math.min(len - 1, lowerBoundX(xArr, len, xAtCursor + xPad) + 1);
  return hi > lo ? [lo, hi] : fallback;
}

export function visualDistanceToSeries(
  cursor: PlotCursorProjection,
  xArr: ArrayLike<number>,
  yArr: ArrayLike<number | null>,
): number {
  const len = Math.min(xArr.length, yArr.length);
  if (len <= 0) return Infinity;
  const [lo, hi] = segmentSearchBounds(cursor, xArr, len);
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
      valToPos(cursor, x0, "x"),
      valToPos(cursor, y0, "y"),
      valToPos(cursor, x1, "x"),
      valToPos(cursor, y1, "y"),
      cursor.plotWidth,
      cursor.plotHeight,
    );
    if (!clipped) continue;
    const d = pointToSegmentDistancePx(cursor.left, cursor.top, ...clipped);
    if (Number.isFinite(d) && d < best) best = d;
  }

  if (best < Infinity) return best;

  const idx = Math.max(0, Math.min(len - 1, cursor.idx));
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
  const px = valToPos(cursor, x, "x");
  const py = valToPos(cursor, y, "y");
  if (px < 0 || px > cursor.plotWidth || py < 0 || py > cursor.plotHeight) {
    return Infinity;
  }
  return Math.hypot(cursor.left - px, cursor.top - py);
}
