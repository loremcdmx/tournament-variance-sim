/**
 * Shared progress-bar constants. Kept outside engine.ts because they're a
 * UI-presentation contract between the worker-pool dispatcher
 * (`useSimulation.ts`) and the ETA projector (`ControlsPanel.tsx`).
 *
 * History: both files used to declare their own SHARD_FRACTION (0.85 vs
 * 0.92), which made the ETA math in ControlsPanel treat the first 7% of
 * the build phase as still-shard-phase work and under-estimate remaining
 * time. That combined with a fixed BUILD_TIME_FRAC=0.15 to push the bar
 * into "wrapping up…" seconds before the real finalize — especially bad
 * on ≥1M-sample runs where build dominates wall time.
 */

/**
 * Fraction of the progress bar reserved for shard-phase work. The build
 * phase fills the remainder (SHARD_FRACTION → ~0.995), and the final
 * postMessage back to main pushes to 1.0.
 */
export const SHARD_FRACTION = 0.85;

/**
 * Fraction of *wall time* that build (envelope sort + histogram +
 * serialize + postMessage) typically consumes, as a function of sample
 * count. Shard work is embarrassingly parallel; build work is
 * single-threaded per pass, so build-share grows with samples.
 *
 * Rough empirical ramp — not tuned against a profiler, calibrated against
 * "bar feels honest on 10k / 100k / 1M / 5M runs". If you find a case
 * where ETA drifts by >30%, log elapsed/share and retune rather than
 * cutting progress emission.
 */
export function buildTimeFracFor(samples: number): number {
  if (!(samples > 0)) return 0.15;
  // log10(samples/10k) maps 10k→0, 100k→1, 1M→2, 10M→3.
  const logScale = Math.log10(Math.max(1, samples / 10_000));
  return Math.min(0.55, 0.10 + 0.15 * logScale);
}
