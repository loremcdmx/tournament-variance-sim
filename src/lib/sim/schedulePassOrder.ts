/**
 * Schedule interleaving. Turns per-row play counts into the order in which
 * rows fire inside one schedule pass, keeping every row as close as possible
 * to its share of the pass at all times. Pure combinatorics over integers —
 * no calibration, no engine types — so it sits apart from the compile stage
 * that consumes it.
 */

interface PassOrderCursor {
  rowIdx: number;
  count: number;
  emitted: number;
}

function comparePassOrderCursor(
  a: PassOrderCursor,
  b: PassOrderCursor,
): number {
  // The row with the smallest emitted/count ratio is furthest below its
  // ideal schedule share and should fire next. Ties preserve schedule order.
  const left = a.emitted * b.count;
  const right = b.emitted * a.count;
  if (left !== right) return left - right;
  return a.rowIdx - b.rowIdx;
}

export function buildSchedulePassOrder(counts: readonly number[]): number[] {
  const total = counts.reduce((acc, n) => acc + n, 0);
  const order = new Array<number>(total);
  const heap: PassOrderCursor[] = [];

  const siftUp = (idx: number) => {
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (comparePassOrderCursor(heap[idx], heap[parent]) >= 0) break;
      const tmp = heap[idx];
      heap[idx] = heap[parent];
      heap[parent] = tmp;
      idx = parent;
    }
  };

  const siftDown = (idx: number) => {
    for (;;) {
      let best = idx;
      const left = idx * 2 + 1;
      const right = left + 1;
      if (
        left < heap.length &&
        comparePassOrderCursor(heap[left], heap[best]) < 0
      ) {
        best = left;
      }
      if (
        right < heap.length &&
        comparePassOrderCursor(heap[right], heap[best]) < 0
      ) {
        best = right;
      }
      if (best === idx) break;
      const tmp = heap[idx];
      heap[idx] = heap[best];
      heap[best] = tmp;
      idx = best;
    }
  };

  const push = (cursor: PassOrderCursor) => {
    heap.push(cursor);
    siftUp(heap.length - 1);
  };

  const pop = (): PassOrderCursor => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      siftDown(0);
    }
    return top;
  };

  counts.forEach((count, rowIdx) => {
    if (count > 0) push({ rowIdx, count, emitted: 0 });
  });

  for (let i = 0; i < total; i++) {
    const cursor = pop();
    order[i] = cursor.rowIdx;
    cursor.emitted += 1;
    if (cursor.emitted < cursor.count) push(cursor);
  }

  return order;
}
