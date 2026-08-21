/**
 * Shared progress-bar layout constant.
 *
 * The bar position is driven by real signals (shards done + build-phase frac
 * from the worker). The only heuristic here is *where on the bar* the
 * shard→build seam sits, and it's flat-ish on purpose: machine performance
 * decides what fraction of wall-clock the build phase actually takes, and we
 * won't pretend to know that per user. Pre-launch ETA is a separate orientation
 * estimate — it doesn't read this file.
 */

/**
 * Build-progress updates intentionally stop just below 1.0. The final
 * `build-result` / `postMessage` handoff owns the last visible tick to 100%.
 * Keep a slightly fatter tail than before so large result payloads don't pin
 * the bar at an artificial 99.x for seconds.
 */
export const BUILD_PROGRESS_CAP = 0.985;

/**
 * Fraction of the visible progress bar reserved for shard simulation. The
 * remainder up to BUILD_PROGRESS_CAP is owned by build/finalize.
 *
 * Gentle ramp so large runs reserve a bit more headroom for envelope sorts +
 * serialize/postMessage, but without over-committing to a per-machine model:
 * 10k → 0.80, 100k → 0.70, 1M → 0.60, 10M+ → floored at 0.55.
 */
export function shardProgressFracFor(samples: number): number {
  if (!(samples > 0)) return 0.78;
  const logScale = Math.log10(Math.max(1, samples / 10_000));
  return Math.max(0.55, 0.80 - 0.10 * logScale);
}

/** Clamp bounds for the measured build share. Below 2% the measurement is
 *  noise. The ceiling is high on purpose: on a wide pool the shard phase is
 *  16-way parallel while each pass's build runs on ONE worker, so a
 *  200k-sample single-pass run legitimately spends 60-75% of its wall time
 *  in build — measured, not assumed. Only truly pathological readings
 *  (throttled tab parked mid-build) are cut off. */
export const BUILD_SHARE_MIN = 0.02;
export const BUILD_SHARE_MAX = 0.85;

/**
 * Blend a fresh build-share observation into the persisted cache. Equal-weight
 * EMA: adapts within ~2 runs after a machine/pool change without letting one
 * odd run swing the seam.
 */
export function nextBuildShare(prev: number | null, observed: number): number {
  const clamped = Math.min(
    BUILD_SHARE_MAX,
    Math.max(BUILD_SHARE_MIN, observed),
  );
  if (prev == null || !Number.isFinite(prev)) return clamped;
  const blended = 0.5 * prev + 0.5 * clamped;
  return Math.min(BUILD_SHARE_MAX, Math.max(BUILD_SHARE_MIN, blended));
}

/**
 * Place the shard→build seam from the MEASURED build share of previous runs,
 * so the bar advances ~linearly in wall time: shard phase gets `(1 − share)`
 * of the bar (scaled to the cap), build gets the rest. This is what makes the
 * in-run ETA's `elapsed / progress` projection honest — with a guessed seam
 * the projection inherits the guess's error (3–5× around the seam on
 * machines where the split differs from the hardcoded curve).
 *
 * Falls back to the `shardProgressFracFor` heuristic until a run has been
 * measured on this machine.
 */
export function shardFracFromBuildShare(
  buildShare: number | null,
  samples: number,
): number {
  if (buildShare == null || !Number.isFinite(buildShare) || buildShare <= 0) {
    return shardProgressFracFor(samples);
  }
  const share = Math.min(
    BUILD_SHARE_MAX,
    Math.max(BUILD_SHARE_MIN, buildShare),
  );
  // Floor keeps a visible shard zone even on build-dominated runs; ceiling
  // keeps a visible build zone on shard-dominated ones.
  return Math.min(0.95, Math.max(0.12, (1 - share) * BUILD_PROGRESS_CAP));
}
