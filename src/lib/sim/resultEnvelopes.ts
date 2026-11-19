/**
 * Percentile envelopes over the checkpoint path matrix, upsampled onto the
 * hi-res grid the sample curves live on. The per-column percentiles dominate
 * build wall-clock for large S, so this owns the "envelopes" progress phase.
 */
import type { BuildProgressCb } from "./engineTypes";
import { upsampleToGrid } from "./grids";
import { selectSortedRanks } from "./orderStatistics";

export function buildEnvelopes(
  pathMatrix: Float64Array,
  S: number,
  K1: number,
  checkpointIdx: Int32Array,
  hiCheckpointIdx: Int32Array,
  onBuildProgress?: BuildProgressCb,
) {
  const mean_ = new Float64Array(K1);
  const envP05 = new Float64Array(K1);
  const envP95 = new Float64Array(K1);
  const p15 = new Float64Array(K1);
  const p85 = new Float64Array(K1);
  const p025 = new Float64Array(K1);
  const p975 = new Float64Array(K1);
  const p0015 = new Float64Array(K1);
  const p9985 = new Float64Array(K1);

  // Envelope percentiles: sorting K1 full columns of a 1M-sample run is
  // ≈80 × O(S log S) ≈ 1.6 B ops — freezes the worker at 99% for tens of
  // seconds. Subsample uniformly for the quantile computation (mean still
  // runs on the full S, which is just an additive loop and cheap).
  // Accuracy at the reported percentiles: p0015 / p9985 need ≥ 1 / (1-p)
  // samples minimum, so we cap at ≥ 20k; 50k keeps all six percentiles
  // within ~0.3 σ of the exact answer and runs in ~200 ms total.
  const ENV_CAP = 200_000;
  const envS = Math.min(S, ENV_CAP);
  const envStride = S / envS;
  const quantiles = [p0015, p025, envP05, p15, p85, envP95, p975, p9985];
  const ranks = Int32Array.from(
    [0.0015, 0.025, 0.05, 0.15, 0.85, 0.95, 0.975, 0.9985],
    (p) => Math.floor(p * (envS - 1)),
  );
  const picked = new Float64Array(ranks.length);
  // The matrix is row-major (one sample after another), so reading it one
  // column at a time misses the cache on every value. Take a block of
  // neighbouring columns per pass over the rows instead; each column still
  // receives its samples in ascending order, so the means add up in the same
  // order as before.
  const blockCols = Math.max(1, Math.min(32, K1, Math.floor(2_000_000 / envS)));
  const block = new Float64Array(blockCols * envS);
  const acc = new Float64Array(blockCols);
  // Emit build-progress every ~8 columns so the main thread sees steady
  // motion through the dominant build phase.
  const envEmitStride = Math.max(1, Math.floor(K1 / 10));
  for (let j0 = 0; j0 < K1; j0 += blockCols) {
    const cols = Math.min(blockCols, K1 - j0);
    acc.fill(0);
    // Mean on the full S (cheap accumulator, no sort needed); percentiles on
    // a stratified subsample of size envS.
    if (envS === S) {
      for (let s = 0; s < S; s++) {
        const base = s * K1 + j0;
        for (let c = 0; c < cols; c++) {
          const v = pathMatrix[base + c];
          acc[c] += v;
          block[c * envS + s] = v;
        }
      }
    } else {
      for (let s = 0; s < S; s++) {
        const base = s * K1 + j0;
        for (let c = 0; c < cols; c++) acc[c] += pathMatrix[base + c];
      }
      for (let s = 0; s < envS; s++) {
        const base = Math.min(S - 1, (s * envStride) | 0) * K1 + j0;
        for (let c = 0; c < cols; c++) block[c * envS + s] = pathMatrix[base + c];
      }
    }
    for (let c = 0; c < cols; c++) {
      const j = j0 + c;
      mean_[j] = acc[c] / S;
      const offset = c * envS;
      // A NaN in the column makes its sum NaN; only the sort knows where a
      // NaN goes, so such a column takes the old route.
      if (acc[c] !== acc[c]) {
        const col = block.subarray(offset, offset + envS).sort();
        for (let r = 0; r < ranks.length; r++) quantiles[r][j] = col[ranks[r]];
      } else {
        selectSortedRanks(block, offset, envS, ranks, picked);
        for (let r = 0; r < ranks.length; r++) quantiles[r][j] = picked[r];
      }
      if (onBuildProgress && j > 0 && j % envEmitStride === 0) {
        onBuildProgress(0.10 + 0.70 * ((j + 1) / K1), "envelopes");
      }
    }
  }
  onBuildProgress?.(0.82, "envelopes");

  return {
    mean: upsampleToGrid(mean_, checkpointIdx, hiCheckpointIdx),
    p05: upsampleToGrid(envP05, checkpointIdx, hiCheckpointIdx),
    p95: upsampleToGrid(envP95, checkpointIdx, hiCheckpointIdx),
    p15: upsampleToGrid(p15, checkpointIdx, hiCheckpointIdx),
    p85: upsampleToGrid(p85, checkpointIdx, hiCheckpointIdx),
    p025: upsampleToGrid(p025, checkpointIdx, hiCheckpointIdx),
    p975: upsampleToGrid(p975, checkpointIdx, hiCheckpointIdx),
    p0015: upsampleToGrid(p0015, checkpointIdx, hiCheckpointIdx),
    p9985: upsampleToGrid(p9985, checkpointIdx, hiCheckpointIdx),
  };
}

type EnvelopeCurves = ReturnType<typeof buildEnvelopes>;

/**
 * The percentiles and the mean are sorted on the checkpoint grid and read
 * linearly onto the finer plot grid, while the minimum and maximum are exact at
 * every plot point. Between two checkpoints an interpolated curve can leave the
 * range the runs really covered (p0.15 under the worst run), so pull each curve
 * back inside it. Curves already inside are not touched.
 */
export function clampEnvelopesToExtrema(
  curves: EnvelopeCurves,
  lo: Float64Array,
  hi: Float64Array,
): void {
  for (const curve of Object.values(curves)) {
    for (let j = 0; j < curve.length; j++) {
      if (curve[j] < lo[j]) curve[j] = lo[j];
      else if (curve[j] > hi[j]) curve[j] = hi[j];
    }
  }
}
