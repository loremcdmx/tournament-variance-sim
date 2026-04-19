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
