// Re-derive drawdown / breakeven / cashless / recovery stats from stored
// hi-res sample paths, with an optional cumulative rakeback curve shift.
// Used by the UI to toggle "with RB" vs "without RB" views on widgets that
// depend on path shape (not just sample mean), since those cannot be
// reverse-engineered from scalar result aggregates.
//
// Resolution caveat: engine stores ~1000 hi-res paths on a grid of up to
// 4000 checkpoints. For typical N=500 schedules each checkpoint is exactly
// one tournament; for N>4000 the cashless streak resolution degrades.

export interface PathStreakStats {
  maxDrawdown: number;
  maxRunUp: number;
  longestBreakeven: number;
  longestCashless: number;
  recovery: number;
  recovered: boolean;
  finalProfit: number;
}

export interface StreakAggregate {
  drawdownHistogram: { binEdges: number[]; counts: number[] };
  longestBreakevenHistogram: { binEdges: number[]; counts: number[] };
  longestCashlessHistogram: { binEdges: number[]; counts: number[] };
  recoveryHistogram: { binEdges: number[]; counts: number[] };
  stats: {
    maxDrawdownMean: number;
    maxDrawdownMedian: number;
    maxDrawdownP95: number;
    maxDrawdownP99: number;
    maxDrawdownWorst: number;
    longestBreakevenMean: number;
    longestBreakevenWorst: number;
    longestCashlessMean: number;
    longestCashlessWorst: number;
    recoveryMedian: number;
    recoveryP90: number;
    recoveryUnrecoveredShare: number;
  };
  perSample: PathStreakStats[];
}

export function computePathStreakStats(
  path: Float64Array,
  xHi: readonly number[],
  rbShift: Float64Array | null,
  chordCountsAccum: Int32Array | null,
  stride: number,
): PathStreakStats {
  const n = path.length;
  if (n === 0) {
    return {
      maxDrawdown: 0,
      maxRunUp: 0,
      longestBreakeven: 0,
      longestCashless: 0,
      recovery: 0,
      recovered: true,
      finalProfit: 0,
    };
  }

  const get = rbShift
    ? (i: number) => path[i] + rbShift[i]
    : (i: number) => path[i];

  let runningMax = get(0);
  let maxDrawdown = 0;
  let maxDdTroughIdx = 0;
  let maxDdPeakIdx = 0;
  let runningMaxIdx = 0;
  let runningMin = get(0);
  let maxRunUp = 0;

  let longestCashless = 0;
  let curCashless = 0;

  for (let i = 0; i < n; i++) {
    const v = get(i);
    if (v >= runningMax) {
      runningMax = v;
      runningMaxIdx = i;
    } else {
      const dd = runningMax - v;
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
        maxDdTroughIdx = i;
        maxDdPeakIdx = runningMaxIdx;
      }
    }
    if (v < runningMin) runningMin = v;
    const ru = v - runningMin;
    if (ru > maxRunUp) maxRunUp = ru;
    if (i > 0) {
      const delta = get(i) - get(i - 1);
      if (delta <= 0) {
        curCashless += xHi[i] - xHi[i - 1];
        if (curCashless > longestCashless) longestCashless = curCashless;
      } else {
        curCashless = 0;
      }
    }
  }

  // Longest horizontal chord between two points at the same Y — mirrors
  // engine.ts's breakeven chord definition. For every starting index ii
  // we scan jj descending so the first enclosing segment is the furthest,
  // record that chord's length into the shared counts accumulator, and
  // track the per-sample max for ranking. STRIDE downsamples both loops
  // to keep the n² scan manageable on the hi-res grid.
  let longestChordGrid = 0;
  for (let ii = 0; ii < n - 1; ii += stride) {
    const Pi = get(ii);
    let chordLen = 0;
    for (let jj = n - 1; jj > ii; jj -= stride) {
      const a = get(jj - 1);
      const b = get(jj);
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      if (lo <= Pi && Pi <= hi) {
        if (jj === ii + 1 && a === Pi && b !== Pi) break;
        chordLen = jj - ii;
        break;
      }
    }
    if (chordLen > 0 && chordCountsAccum && chordLen < chordCountsAccum.length) {
      chordCountsAccum[chordLen]++;
    }
    if (chordLen > longestChordGrid) longestChordGrid = chordLen;
  }
  const span = n > 1 ? xHi[n - 1] - xHi[0] : 0;
  const longestBreakeven = n > 1 ? (longestChordGrid / (n - 1)) * span : 0;

  let recovery = 0;
  let recovered = true;
  if (maxDrawdown > 0) {
    const peakValue = get(maxDdPeakIdx);
    let found = -1;
    for (let i = maxDdTroughIdx + 1; i < n; i++) {
      if (get(i) >= peakValue) {
        found = i;
        break;
      }
    }
    if (found >= 0) {
      recovery = xHi[found] - xHi[maxDdTroughIdx];
      recovered = true;
    } else {
      recovered = false;
      recovery = xHi[n - 1] - xHi[maxDdTroughIdx];
    }
  }

  return {
    maxDrawdown,
    maxRunUp,
    longestBreakeven,
    longestCashless,
    recovery,
    recovered,
    finalProfit: get(n - 1),
  };
}

function histogramOf(
  values: number[],
  bins: number,
  pinLoToZero = true,
): { binEdges: number[]; counts: number[] } {
  if (values.length === 0) {
    return { binEdges: [0, 1], counts: [0] };
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (pinLoToZero && lo > 0) lo = 0;
  if (hi <= lo) hi = lo + 1;
  const edges = new Array<number>(bins + 1);
  const step = (hi - lo) / bins;
  for (let i = 0; i <= bins; i++) edges[i] = lo + i * step;
  const counts = new Array<number>(bins).fill(0);
  for (const v of values) {
    let idx = Math.floor((v - lo) / step);
    if (idx < 0) idx = 0;
    if (idx >= bins) idx = bins - 1;
    counts[idx]++;
  }
  return { binEdges: edges, counts };
}

// Mirror of engine.ts histogramFromCounts: builds a decay-shape histogram
// from integer-length chord counts. Anchors the visible range to median×10
// (capped by p999 and maxLen) so the knee of the near-geometric streak
// distribution is visible instead of a single long-tail outlier crushing
// the bulk into bin 0.
function histogramFromCounts(
  countsByLen: Int32Array,
  bins: number,
  scale: number,
): { binEdges: number[]; counts: number[] } {
  let maxLen = 0;
  let total = 0;
  for (let i = 1; i < countsByLen.length; i++) {
    const c = countsByLen[i];
    if (c > 0) {
      total += c;
      if (i > maxLen) maxLen = i;
    }
  }
  if (maxLen === 0 || total === 0) {
    return { binEdges: [0, 1], counts: new Array(bins).fill(0) };
  }
  const pctLen = (p: number): number => {
    const target = total * p;
    let cum = 0;
    for (let i = 1; i <= maxLen; i++) {
      cum += countsByLen[i];
      if (cum >= target) return i;
    }
    return maxLen;
  };
  const medianLen = pctLen(0.5);
  const p999Len = pctLen(0.999);
  let hi = Math.min(maxLen, p999Len, Math.max(medianLen * 10, 20));
  if (hi < 1) hi = 1;
  const w = hi <= bins ? 1 : Math.ceil(hi / bins);
  const nBins = Math.max(1, Math.ceil(hi / w));
  hi = nBins * w;
  const binEdges: number[] = new Array(nBins + 1);
  for (let i = 0; i <= nBins; i++) binEdges[i] = i * w * scale;
  const counts: number[] = new Array(nBins).fill(0);
  for (let len = 1; len <= maxLen; len++) {
    const c = countsByLen[len];
    if (c === 0) continue;
    let b = len >= hi ? nBins - 1 : Math.floor(len / w);
    if (b < 0) b = 0;
    else if (b >= nBins) b = nBins - 1;
    counts[b] += c;
  }
  return { binEdges, counts };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

export function aggregateStreaks(
  paths: readonly Float64Array[],
  xHi: readonly number[],
  rbShift: Float64Array | null,
): StreakAggregate {
  const n = paths.length > 0 ? paths[0].length : 0;
  // Shared chord-length histogram accumulator — one slot per possible
  // chord length in grid units. Downsampling stride keeps the O(n²) scan
  // bounded while preserving the decay shape.
  const stride = Math.max(1, Math.floor(n / 240));
  const chordCounts = new Int32Array(n + 1);
  const perSample: PathStreakStats[] = paths.map((p) =>
    computePathStreakStats(p, xHi, rbShift, chordCounts, stride),
  );
  const S = perSample.length;

  const maxDDs: number[] = perSample.map((s) => s.maxDrawdown);
  const longestBEs: number[] = perSample.map((s) => s.longestBreakeven);
  const longestCashlesses: number[] = perSample.map((s) => s.longestCashless);
  const recoveriesRecovered: number[] = perSample
    .filter((s) => s.recovered && s.maxDrawdown > 0)
    .map((s) => s.recovery);

  const ddSorted = maxDDs.slice().sort((a, b) => a - b);
  const recSorted = recoveriesRecovered.slice().sort((a, b) => a - b);

  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const mean = (arr: number[]) => (arr.length > 0 ? sum(arr) / arr.length : 0);
  const worst = (arr: number[]) =>
    arr.length > 0 ? Math.max(...arr) : 0;

  const unrecoveredShare =
    S > 0
      ? perSample.filter((s) => !s.recovered && s.maxDrawdown > 0).length / S
      : 0;

  // Chord-count → tournament units: each grid step spans (xHi span) / (n-1)
  // tournaments. This matches engine's N/K scaling.
  const chordScale = n > 1 ? (xHi[n - 1] - xHi[0]) / (n - 1) : 1;

  return {
    drawdownHistogram: histogramOf(maxDDs, 50, false),
    longestBreakevenHistogram: histogramFromCounts(chordCounts, 60, chordScale),
    longestCashlessHistogram: histogramOf(longestCashlesses, 50, true),
    recoveryHistogram: histogramOf(recoveriesRecovered, 50, true),
    stats: {
      maxDrawdownMean: mean(maxDDs),
      maxDrawdownMedian: percentile(ddSorted, 0.5),
      maxDrawdownP95: percentile(ddSorted, 0.95),
      maxDrawdownP99: percentile(ddSorted, 0.99),
      maxDrawdownWorst: worst(maxDDs),
      longestBreakevenMean: mean(longestBEs),
      longestBreakevenWorst: worst(longestBEs),
      longestCashlessMean: mean(longestCashlesses),
      longestCashlessWorst: worst(longestCashlesses),
      recoveryMedian: percentile(recSorted, 0.5),
      recoveryP90: percentile(recSorted, 0.9),
      recoveryUnrecoveredShare: unrecoveredShare,
    },
    perSample,
  };
}
