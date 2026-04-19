/**
 * Pure progress-bar math used by the orchestration in `useSimulation`.
 *
 * The visible bar has two phases:
 *   1. Shard simulate — up to `shardFrac` of the bar, linear in
 *      `shardDone / shardTotal`.
 *   2. Build / finalize — from `shardFrac` up to `cap` (just under 1.0),
 *      linear in the average of in-flight build-progress reports.
 *
 * The final snap to 100% is owned by the `build-result` handler, not
 * this function — `cap < 1.0` reserves room for that last tick so the
 * bar doesn't look "done" before the payload has actually arrived.
 *
 * Pure and monotonic under monotonic inputs (more work done ⇒ never
 * lower output). Extracted out of `useSimulation.runJob` so the
 * shard/build seam can be unit-tested without spinning up a worker
 * pool.
 */

import { BUILD_PROGRESS_CAP } from "./progressConstants";

export interface ProgressInputs {
  /** Samples finished across all shards so far. */
  shardDone: number;
  /** Total samples planned across all shards. */
  shardTotal: number;
  /** Bar fraction reserved for the shard phase (output of
   *  `shardProgressFracFor(samples)`). */
  shardFrac: number;
  /** Running build-progress fractions by `buildId`, in [0,1]. */
  buildFracs: ReadonlyMap<number, number>;
  /** Expected number of build messages — equals the number of passes
   *  (foreground + compare). Used as the denominator for the average. */
  totalBuildsExpected: number;
  /** Build-phase ceiling. Defaults to `BUILD_PROGRESS_CAP`; exposed for
   *  tests. */
  cap?: number;
}

/**
 * Compose the visible bar fraction for the current moment.
 *
 * Semantics:
 *   - shard phase only (no builds yet): `shardFrac · shardDone/shardTotal`
 *   - build phase: `shardFrac + (cap − shardFrac) · avg(buildFracs)`
 *
 * When build messages arrive, the bar jumps from the shard endpoint
 * (`shardFrac`) onto the build track — we don't add the two (they
 * share the interval `[shardFrac, cap]`). Callers that want the
 * shard-only fraction during shard phase should pass `buildFracs`
 * empty; any non-empty map means we are in the build phase.
 */
export function composeProgress(inputs: ProgressInputs): number {
  const {
    shardDone,
    shardTotal,
    shardFrac,
    buildFracs,
    totalBuildsExpected,
    cap = BUILD_PROGRESS_CAP,
  } = inputs;

  if (buildFracs.size > 0 && totalBuildsExpected > 0) {
    let sum = 0;
    for (const f of buildFracs.values()) sum += f;
    const avg = sum / totalBuildsExpected;
    const headroom = Math.max(0, cap - shardFrac);
    return shardFrac + headroom * clamp01(avg);
  }
  if (shardTotal <= 0) return 0;
  return shardFrac * clamp01(shardDone / shardTotal);
}

function clamp01(x: number): number {
  if (!(x > 0)) return 0;
  if (x > 1) return 1;
  return x;
}
