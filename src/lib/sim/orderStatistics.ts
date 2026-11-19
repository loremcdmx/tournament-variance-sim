/**
 * Order statistics without the sort. `selectSortedRanks` returns the values a
 * full ascending `Float64Array.prototype.sort` would leave at a few given
 * positions, in about one pass per rank group instead of O(n log n). The
 * envelope percentiles need eight positions out of up to 200 000 values, 241
 * times per run, and those sorts were most of the single-threaded build step.
 *
 * The answer is the same number, bit for bit: an order statistic does not
 * depend on how it is found. The two cases where the typed-array sort orders
 * values a `<` comparison cannot tell apart are handled explicitly: -0 sorts
 * before +0 (the sign of a zero result is recounted), and a NaN sorts last
 * (the caller must not pass one).
 */

/**
 * Floyd-Rivest selection: afterwards `values[k]` is the k-th smallest of
 * `values[left..right]`, nothing to its left is larger and nothing to its
 * right is smaller. The pivot comes from a small sample around where the
 * target should sit, so one partition pass usually ends the search and most
 * comparisons fall on the same side.
 */
function floydRivestSelect(
  values: Float64Array,
  left: number,
  right: number,
  k: number,
): void {
  while (right > left) {
    if (right - left > 600) {
      const n = right - left + 1;
      const i = k - left + 1;
      const z = Math.log(n);
      const s = 0.5 * Math.exp((2 * z) / 3);
      const sd = 0.5 * Math.sqrt((z * s * (n - s)) / n) * (i - n / 2 < 0 ? -1 : 1);
      const newLeft = Math.max(left, Math.floor(k - (i * s) / n + sd));
      const newRight = Math.min(right, Math.floor(k + ((n - i) * s) / n + sd));
      floydRivestSelect(values, newLeft, newRight, k);
    }
    const t = values[k];
    let i = left;
    let j = right;
    values[k] = values[left];
    values[left] = t;
    if (values[right] > t) {
      values[left] = values[right];
      values[right] = t;
    }
    while (i < j) {
      const tmp = values[i];
      values[i] = values[j];
      values[j] = tmp;
      i++;
      j--;
      while (values[i] < t) i++;
      while (values[j] > t) j--;
    }
    // A real swap, not a write of `t`: the element at `left` can be the other
    // zero, and the sign recount below needs every element kept as it was.
    if (values[left] === t) {
      const tmp = values[left];
      values[left] = values[j];
      values[j] = tmp;
    } else {
      j++;
      const tmp = values[j];
      values[j] = values[right];
      values[right] = tmp;
    }
    if (j <= k) left = j + 1;
    if (k <= j) right = j - 1;
  }
}

/**
 * Ranks `ranks[rLo..rHi]` all lie inside `[lo, hi]`. Settle the one nearest
 * the middle of that range first: it costs a pass either way, and it leaves
 * the others the shortest ranges to search.
 */
function selectRankRange(
  values: Float64Array,
  offset: number,
  lo: number,
  hi: number,
  ranks: Int32Array,
  rLo: number,
  rHi: number,
  out: Float64Array,
): void {
  if (rLo > rHi) return;
  const middle = (lo + hi) / 2;
  let m = rLo;
  for (let r = rLo + 1; r <= rHi; r++) {
    if (Math.abs(ranks[r] - middle) < Math.abs(ranks[m] - middle)) m = r;
  }
  const k = ranks[m];
  floydRivestSelect(values, offset + lo, offset + hi, offset + k);
  const v = values[offset + k];
  let below = m;
  while (below >= rLo && ranks[below] === k) out[below--] = v;
  let above = m + 1;
  while (above <= rHi && ranks[above] === k) out[above++] = v;
  selectRankRange(values, offset, lo, k - 1, ranks, rLo, below, out);
  selectRankRange(values, offset, k + 1, hi, ranks, above, rHi, out);
}

/**
 * Writes `out[r]` = the value at sorted position `ranks[r]` of
 * `values[offset .. offset + n)`. `ranks` is non-decreasing, each in
 * `[0, n)`. Reorders that slice of `values`, which must hold no NaN.
 */
export function selectSortedRanks(
  values: Float64Array,
  offset: number,
  n: number,
  ranks: Int32Array,
  out: Float64Array,
): void {
  const R = ranks.length;
  if (R === 0 || n === 0) return;
  selectRankRange(values, offset, 0, n - 1, ranks, 0, R - 1, out);

  // The sort puts every -0 before every +0; `<` sees them as equal.
  let zeroSeen = false;
  for (let r = 0; r < R; r++) if (out[r] === 0) zeroSeen = true;
  if (zeroSeen) {
    let belowPositiveZero = 0;
    for (let i = offset; i < offset + n; i++) {
      const v = values[i];
      if (v < 0 || (v === 0 && 1 / v < 0)) belowPositiveZero++;
    }
    for (let r = 0; r < R; r++) {
      if (out[r] === 0) out[r] = ranks[r] < belowPositiveZero ? -0 : 0;
    }
  }
}
