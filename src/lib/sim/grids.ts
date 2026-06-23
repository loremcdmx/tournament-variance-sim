import type { CheckpointGrid } from "./engineTypes";

/**
 * Checkpoint grids for trajectory capture. The low-res grid (K ≤ 240) backs
 * the envelope/percentile sorts; the hi-res grid (K ≤ 4000) backs the handful
 * of visible sample curves. `upsampleToGrid` lifts a low-res series onto the
 * hi-res grid so both line up on one chart x-axis. Pure — no RNG, no state.
 */

export function makeCheckpointGrid(N: number): CheckpointGrid {
  const K = Math.min(240, N);
  const checkpointIdx = new Int32Array(K + 1);
  for (let j = 0; j <= K; j++) checkpointIdx[j] = Math.round((j * N) / K);
  return { K, checkpointIdx };
}

// Hi-res grid for the visible sample paths + best/worst curves. At K=80 each
// checkpoint averages N/80 tournaments, so a single big cash spreads over ~13
// finishes and the line reads as a gentle slope instead of a staircase. We
// capture a second set of checkpoints at up to 4000 points for the handful of
// sample curves actually rendered — envelope sorts still run on the K=80 grid,
// so compute/memory stay bounded while the chart regains real vertical candles.
const MAX_HIRES_POINTS = 4000;
export function makeHiResGrid(N: number): CheckpointGrid {
  const K = Math.min(MAX_HIRES_POINTS, N);
  const checkpointIdx = new Int32Array(K + 1);
  for (let j = 0; j <= K; j++) checkpointIdx[j] = Math.round((j * N) / K);
  return { K, checkpointIdx };
}

/** Linear interpolation of an arbitrary series from one checkpoint grid to
 * another. Both grids must cover the same [0, N] interval; the destination
 * grid is usually a refinement (upsample), but equal-length passthrough and
 * coarsening also work. */
export function upsampleToGrid(
  src: Float64Array,
  srcIdx: Int32Array,
  dstIdx: Int32Array,
): Float64Array {
  const out = new Float64Array(dstIdx.length);
  let lo = 0;
  const last = srcIdx.length - 1;
  for (let d = 0; d < dstIdx.length; d++) {
    const xd = dstIdx[d];
    while (lo < last && srcIdx[lo + 1] <= xd) lo++;
    if (lo >= last) {
      out[d] = src[last];
      continue;
    }
    const x0 = srcIdx[lo];
    const x1 = srcIdx[lo + 1];
    const span = x1 - x0;
    const t = span > 0 ? (xd - x0) / span : 0;
    out[d] = src[lo] * (1 - t) + src[lo + 1] * t;
  }
  return out;
}
