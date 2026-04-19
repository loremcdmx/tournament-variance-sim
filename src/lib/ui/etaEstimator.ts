/**
 * Pure ETA computation shared by `useRemainingMs` in ControlsPanel.
 *
 * Two estimators are blended:
 *   - bootstrap: prior-run rate hint (`estimatedMs`), honest only pre-run
 *   - projection: `elapsed / progress`, honest once enough of the bar has
 *     moved
 * Weight ramps from 0 at `progress≈0` to 1 at `progress≥0.5`, so the
 * bootstrap carries the first half-second before projection stabilises.
 *
 * Countdown uses a one-sided exponential smoother: `raw` only pulls the
 * display *down*; if the new raw estimate is larger, the display still
 * ticks down by wall-clock `dt`. Keeps the ETA monotonic so users don't
 * see it jump back up mid-run.
 *
 * Near the tail (`prev < 1500ms`) we cut the smoothing time constant
 * from 400→150 so the last second tracks reality — otherwise the bar
 * hits 100% while ETA still reads "1s".
 */

export const TAU_MID_MS = 400;
export const TAU_TAIL_MS = 150;
export const TAIL_CUTOFF_MS = 1500;
/** `progress` must cross this before we trust the projection at all. */
export const PROJECTION_MIN_PROGRESS = 0.03;
/** Bootstrap ↔ projection crossover: 0% blend below, 100% at/above. */
export const BLEND_COMPLETE_AT_PROGRESS = 0.5;

export interface RemainingMsStep {
  elapsedMs: number;
  progress: number;
  estimatedMs: number | null | undefined;
  prevSmoothedMs: number | null;
  dtMs: number;
}

/**
 * Advance the smoothed ETA one step. Returns the new smoothed value in
 * ms, or `null` if neither estimator has enough data yet (fresh run,
 * no bootstrap hint). Pure — all timing state is threaded through args.
 */
export function computeRemainingMs(step: RemainingMsStep): number | null {
  const { elapsedMs, progress, estimatedMs, prevSmoothedMs, dtMs } = step;

  const tProjection =
    progress > PROJECTION_MIN_PROGRESS ? elapsedMs / progress : null;
  const tBootstrap =
    estimatedMs != null && estimatedMs > 0 ? estimatedMs : null;

  let tEst: number | null;
  if (tProjection != null && tBootstrap != null) {
    const w = Math.min(
      1,
      Math.max(0, progress / BLEND_COMPLETE_AT_PROGRESS),
    );
    tEst = (1 - w) * tBootstrap + w * tProjection;
  } else {
    tEst = tProjection ?? tBootstrap;
  }
  if (tEst == null) return null;

  const raw = Math.max(0, tEst - elapsedMs);

  if (prevSmoothedMs == null) return raw;
  if (raw < prevSmoothedMs) {
    const tau = prevSmoothedMs < TAIL_CUTOFF_MS ? TAU_TAIL_MS : TAU_MID_MS;
    const alpha = 1 - Math.exp(-dtMs / tau);
    return alpha * raw + (1 - alpha) * prevSmoothedMs;
  }
  return Math.max(0, prevSmoothedMs - dtMs);
}
