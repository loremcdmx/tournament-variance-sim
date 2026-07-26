/**
 * Percentile envelopes over the checkpoint path matrix, upsampled onto the
 * hi-res grid the sample curves live on. The column sorts dominate build
 * wall-clock for large S, so this owns the "envelopes" progress phase.
 */
import type { BuildProgressCb } from "./engineTypes";
import { upsampleToGrid } from "./grids";

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
  const col = new Float64Array(envS);
  // Emit build-progress every ~8 columns so the main thread sees steady
  // motion through the dominant build phase (envelope sorts are ~65 % of
  // buildResult wall time for large S).
  const envEmitStride = Math.max(1, Math.floor(K1 / 10));
  for (let j = 0; j < K1; j++) {
    // Mean on the full S (cheap accumulator, no sort needed).
    let acc = 0;
    for (let s = 0; s < S; s++) acc += pathMatrix[s * K1 + j];
    mean_[j] = acc / S;
    // Percentiles on a stratified subsample of size envS.
    for (let s = 0; s < envS; s++) {
      const src = Math.min(S - 1, (s * envStride) | 0);
      col[s] = pathMatrix[src * K1 + j];
    }
    col.sort();
    envP05[j] = col[Math.floor(0.05 * (envS - 1))];
    envP95[j] = col[Math.floor(0.95 * (envS - 1))];
    p15[j] = col[Math.floor(0.15 * (envS - 1))];
    p85[j] = col[Math.floor(0.85 * (envS - 1))];
    p025[j] = col[Math.floor(0.025 * (envS - 1))];
    p975[j] = col[Math.floor(0.975 * (envS - 1))];
    p0015[j] = col[Math.floor(0.0015 * (envS - 1))];
    p9985[j] = col[Math.floor(0.9985 * (envS - 1))];
    if (onBuildProgress && j > 0 && j % envEmitStride === 0) {
      onBuildProgress(0.10 + 0.70 * ((j + 1) / K1), "envelopes");
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
