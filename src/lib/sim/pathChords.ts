/**
 * Horizontal chords of one checkpointed profit path: for every checkpoint the
 * furthest later point where the path, read as straight segments between
 * checkpoints, is back at the same level ("playing for nothing"), and the
 * first one. `simulateShard` runs this once per sample, so its cost is a fixed
 * tax on every sample whatever the schedule length.
 *
 * `scanPathChordsReference` is the definition: two scans over the later
 * segments for each starting checkpoint, O(K²). `scanPathChords` returns the
 * same numbers from a suffix-range binary search and two monotonic stacks,
 * O(K log K). A path that holds a NaN goes through the reference scan, where
 * a segment touching the NaN matches nothing.
 */

export interface PathChordScratch {
  /** segLo[j] / segHi[j]: the lower and upper end of segment (j-1, j). */
  segLo: Float64Array;
  segHi: Float64Array;
  /** sufMin[j] / sufMax[j]: the extremes of the path from checkpoint j on. */
  sufMin: Float64Array;
  sufMax: Float64Array;
  /** Next later checkpoint at or below (at or above) this one's level, 0 if none. */
  nextLe: Int32Array;
  nextGe: Int32Array;
  stack: Int32Array;
  /** Outputs of the last scan, in checkpoint-grid steps. */
  longestChord: number;
  firstReturnSum: number;
  firstReturnCount: number;
}

export function createPathChordScratch(K1: number): PathChordScratch {
  return {
    segLo: new Float64Array(K1),
    segHi: new Float64Array(K1),
    sufMin: new Float64Array(K1),
    sufMax: new Float64Array(K1),
    nextLe: new Int32Array(K1),
    nextGe: new Int32Array(K1),
    stack: new Int32Array(K1),
    longestChord: 0,
    firstReturnSum: 0,
    firstReturnCount: 0,
  };
}

/**
 * Scan the K1 checkpoints at `path[base .. base + K1)`. Adds every starting
 * point's furthest chord to `chordCounts[length]` and leaves the longest chord
 * and the first-return sum and count in `scratch`.
 */
export function scanPathChords(
  path: Float64Array,
  base: number,
  K1: number,
  chordCounts: Int32Array,
  scratch: PathChordScratch,
): void {
  const K = K1 - 1;
  const { sufMin, sufMax, nextLe, nextGe, stack } = scratch;

  // Consecutive segments share an endpoint, so the levels covered by segments
  // j..K are exactly [sufMin[j-1], sufMax[j-1]].
  let lo = path[base + K];
  let hi = lo;
  let hasNaN = lo !== lo;
  sufMin[K] = lo;
  sufMax[K] = hi;
  for (let j = K - 1; j >= 0; j--) {
    const v = path[base + j];
    if (v !== v) hasNaN = true;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    sufMin[j] = lo;
    sufMax[j] = hi;
  }
  if (hasNaN) {
    scanPathChordsReference(path, base, K1, chordCounts, scratch);
    return;
  }

  let top = 0;
  for (let i = K; i >= 0; i--) {
    const v = path[base + i];
    while (top > 0 && path[base + stack[top - 1]] > v) top--;
    nextLe[i] = top > 0 ? stack[top - 1] : 0;
    stack[top++] = i;
  }
  top = 0;
  for (let i = K; i >= 0; i--) {
    const v = path[base + i];
    while (top > 0 && path[base + stack[top - 1]] < v) top--;
    nextGe[i] = top > 0 ? stack[top - 1] : 0;
    stack[top++] = i;
  }

  let longestChord = 0;
  let firstReturnSum = 0;
  let firstReturnCount = 0;
  for (let ii = 0; ii < K; ii++) {
    const Pi = path[base + ii];
    const nextV = path[base + ii + 1];

    // Furthest segment that covers the level: "some segment from jj on covers
    // it" only switches off once as jj grows, and segment ii+1 always does.
    let a = ii + 1;
    let b = K;
    while (a < b) {
      const mid = (a + b + 1) >> 1;
      if (sufMin[mid - 1] <= Pi && Pi <= sufMax[mid - 1]) a = mid;
      else b = mid - 1;
    }
    // A segment that only leaves the level at its own left end is no return.
    const chordLen = a === ii + 1 && nextV !== Pi ? 0 : a - ii;
    if (chordLen > 0) chordCounts[chordLen]++;
    if (chordLen > longestChord) longestChord = chordLen;

    let firstLen = 0;
    if (nextV === Pi) firstLen = 1;
    else {
      const jj = nextV > Pi ? nextLe[ii] : nextGe[ii];
      if (jj > 0) firstLen = jj - ii;
    }
    if (firstLen > 0) {
      firstReturnSum += firstLen;
      firstReturnCount++;
    }
  }
  scratch.longestChord = longestChord;
  scratch.firstReturnSum = firstReturnSum;
  scratch.firstReturnCount = firstReturnCount;
}

export function scanPathChordsReference(
  path: Float64Array,
  base: number,
  K1: number,
  chordCounts: Int32Array,
  scratch: PathChordScratch,
): void {
  const K = K1 - 1;
  const { segLo, segHi } = scratch;
  for (let jj = 1; jj < K1; jj++) {
    const a = path[base + jj - 1];
    const b = path[base + jj];
    segLo[jj] = a < b ? a : b;
    segHi[jj] = a < b ? b : a;
  }
  let longestChord = 0;
  let firstReturnSum = 0;
  let firstReturnCount = 0;
  for (let ii = 0; ii < K1 - 1; ii++) {
    const Pi = path[base + ii];
    let chordLen = 0;
    for (let jj = K1 - 1; jj > ii; jj--) {
      if (segLo[jj] <= Pi && Pi <= segHi[jj]) {
        if (jj === ii + 1) {
          const a = path[base + jj - 1];
          const b = path[base + jj];
          if (a === Pi && b !== Pi) break;
        }
        chordLen = jj - ii;
        break;
      }
    }
    if (chordLen > 0 && chordLen <= K) chordCounts[chordLen]++;
    if (chordLen > longestChord) longestChord = chordLen;

    let firstLen = 0;
    for (let jj = ii + 1; jj < K1; jj++) {
      if (segLo[jj] <= Pi && Pi <= segHi[jj]) {
        if (jj === ii + 1) {
          const a = path[base + jj - 1];
          const b = path[base + jj];
          if (a === Pi && b !== Pi) continue;
        }
        firstLen = jj - ii;
        break;
      }
    }
    if (firstLen > 0) {
      firstReturnSum += firstLen;
      firstReturnCount++;
    }
  }
  scratch.longestChord = longestChord;
  scratch.firstReturnSum = firstReturnSum;
  scratch.firstReturnCount = firstReturnCount;
}

/**
 * First return to each starting checkpoint's level, read at every tournament
 * of `trace` (the profit after 0..N tournaments). On the checkpoint grid a
 * return can only be seen from the second checkpoint on, so above 240
 * tournaments the grid read the average 1.4x too long at 1 000 tournaments
 * and 4.6x at 20 000, growing with the grid step alone.
 *
 * One sweep over the trace. A start settles at the first tournament whose
 * step reaches its level (the grid scan's "segment covers the level" at a
 * one-tournament grid); the step out of the start counts only when it ends on
 * the level. Open starts the path is below wait on one stack, those it is
 * above on another. Every open level on the "below" stack is above the path,
 * and a start opens at the path, so a new one is the lowest there and the
 * stack stays sorted with the lowest level on top; the "above" stack mirrors
 * it. Starts are checkpoints 0..K-1; leaves the sum (in tournaments) and the
 * count of the starts that came back in `scratch`.
 */
export function scanFirstReturns(
  trace: Float64Array,
  N: number,
  checkpointIdx: Int32Array,
  K: number,
  scratch: FirstReturnScratch,
): void {
  const { belowLevel, belowStart, aboveLevel, aboveStart } = scratch;
  let below = 0;
  let above = 0;
  let sum = 0;
  let count = 0;
  let nextStart = 0;
  let pendingAt = K > 0 ? checkpointIdx[0] : -1;
  for (let t = 1; t <= N; t++) {
    const p = trace[t];
    while (below > 0 && p >= belowLevel[below - 1]) {
      below--;
      sum += t - belowStart[below];
      count++;
    }
    while (above > 0 && p <= aboveLevel[above - 1]) {
      above--;
      sum += t - aboveStart[above];
      count++;
    }
    if (t - 1 === pendingAt) {
      // A NaN on either side matches nothing, as in the grid scan.
      const level = trace[pendingAt];
      if (p === level) {
        sum += 1;
        count++;
      } else if (p > level) {
        aboveLevel[above] = level;
        aboveStart[above++] = pendingAt;
      } else if (p < level) {
        belowLevel[below] = level;
        belowStart[below++] = pendingAt;
      }
      nextStart++;
      pendingAt = nextStart < K ? checkpointIdx[nextStart] : -1;
    }
  }
  scratch.firstReturnSum = sum;
  scratch.firstReturnCount = count;
}

export interface FirstReturnScratch {
  belowLevel: Float64Array;
  belowStart: Int32Array;
  aboveLevel: Float64Array;
  aboveStart: Int32Array;
  firstReturnSum: number;
  firstReturnCount: number;
}

export function createFirstReturnScratch(K: number): FirstReturnScratch {
  return {
    belowLevel: new Float64Array(K),
    belowStart: new Int32Array(K),
    aboveLevel: new Float64Array(K),
    aboveStart: new Int32Array(K),
    firstReturnSum: 0,
    firstReturnCount: 0,
  };
}
