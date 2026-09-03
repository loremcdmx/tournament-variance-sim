/**
 * Peak-memory projection for the build phase, where every shard buffer
 * coexists with the full merged copy (`mergeShards`). `pathMatrix`
 * (samples × (K+1) × 8 B, K ≤ 240) dominates; the per-row and per-sample
 * scalars are small change. Measured ≈ 2145 B/sample per copy at 1M samples,
 * i.e. ≈ 4.4 GB per pass and twice that for a twin run.
 *
 * Pure — the UI only needs "should I warn, and with what number".
 */

export const MEMORY_HINT_THRESHOLD_BYTES = 1.5e9;

const CHECKPOINT_CAP = 240;
const PER_SAMPLE_SCALARS_BYTES = 64;

export function projectedBuildBytes(p: {
  samples: number;
  tournamentsPerSample: number;
  rowCount: number;
  passCount: number;
}): number {
  const K1 = Math.min(CHECKPOINT_CAP, Math.max(1, p.tournamentsPerSample)) + 1;
  const perSample = K1 * 8 + 8 * Math.max(0, p.rowCount) + PER_SAMPLE_SCALARS_BYTES;
  return Math.max(0, p.samples) * perSample * 2 * Math.max(1, p.passCount);
}

/** Decimal-GB label for the hint, or null when the run is comfortably small. */
export function memoryHintGb(bytes: number): string | null {
  if (!(bytes > MEMORY_HINT_THRESHOLD_BYTES)) return null;
  return (bytes / 1e9).toFixed(1);
}
