/**
 * Shared progress-bar constants. Kept outside engine.ts because they define a
 * UI contract between the worker-pool dispatcher (`useSimulation.ts`) and the
 * ETA projector (`ControlsPanel.tsx`).
 *
 * The old model used a fixed shard fraction (85% of the bar for shards, ~15%
 * for build/finalize). That falls apart on large runs where envelope sorts,
 * histograms, and serialize/postMessage dominate wall time: the bar reaches
 * the high 90s while the run is still materially busy.
 *
 * The helpers below keep the bar split dynamic and shared between the
 * dispatcher and the ETA projection logic, so visual progress and textual ETA
 * drift together instead of contradicting each other.
 */

/**
 * Build-progress updates intentionally stop just below 1.0. The final
 * `build-result` / `postMessage` handoff owns the last visible tick to 100%.
 */
export const BUILD_PROGRESS_CAP = 0.995;

/**
 * Fraction of wall time that build (envelope sort + histogram + serialize +
 * postMessage) typically consumes as a function of sample count.
 *
 * Rough empirical ramp: calibrated for honesty, not profiler-perfectness.
 * 10k -> ~10%, 100k -> ~25%, 1M -> ~40%, 10M+ -> capped at ~55%.
 */
export function buildTimeFracFor(samples: number): number {
  if (!(samples > 0)) return 0.15;
  const logScale = Math.log10(Math.max(1, samples / 10_000));
  return Math.min(0.55, 0.10 + 0.15 * logScale);
}

/**
 * Fraction of the visible progress bar reserved for shard simulation. The
 * remainder up to BUILD_PROGRESS_CAP is owned by build/finalize. This mirrors
 * the buildTimeFrac heuristic so large runs reserve visibly more headroom for
 * the slower tail stage.
 */
export function shardProgressFracFor(samples: number): number {
  return Math.max(0.35, BUILD_PROGRESS_CAP - buildTimeFracFor(samples));
}
