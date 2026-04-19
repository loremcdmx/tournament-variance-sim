/**
 * Pure state machine for the run-button progress bar in `ControlsPanel`.
 *
 * Three states:
 *   - `hidden`     — bar unmounted. Idle, or terminal non-success (cancel/error).
 *   - `running`    — bar tracks `progress`, stage label live.
 *   - `completing` — 450 ms hold at 100 % so the fill animation plays out.
 *                    Only reached on natural completion.
 *
 * Completion detection uses `progress === 1`, not a "nearly done" threshold.
 * `composeProgress` caps at `BUILD_PROGRESS_CAP` (0.985), so the only way
 * progress hits exactly 1 is the terminal `setProgress(1)` in the success
 * path of `useSimulation.run`. `cancel()` resets to 0; errors leave progress
 * wherever the last tick landed (< cap). This is what keeps an aborted run
 * from being mis-sold as a completed one via a false 100 % flash.
 */

export type BarState = "hidden" | "running" | "completing";

/** Hold duration (ms) for the `completing` phase. */
export const COMPLETING_HOLD_MS = 450;

export interface BarStateInputs {
  running: boolean;
  progress: number;
  prev: BarState;
}

/**
 * Next bar state given current external inputs and previous state.
 *
 * Pure; React-agnostic. The component drives transitions by calling this
 * in an effect whose dependencies are `[running, progress, prev]`.
 */
export function nextBarState(inputs: BarStateInputs): BarState {
  const { running, progress, prev } = inputs;
  if (running) return "running";
  if (prev === "hidden") return "hidden";
  if (progress < 1) return "hidden";
  return "completing";
}

/**
 * Width style for the filled portion of the bar. Clamped to [0, 100].
 * In `completing` we render 100 % regardless of the in-flight `progress`
 * snapshot so the CSS width transition animates cleanly to the end.
 */
export function barFillPercent(state: BarState, progress: number): string {
  if (state === "hidden") return "0%";
  if (state === "completing") return "100%";
  const pct = progress * 100;
  if (!(pct > 0)) return "0.0%";
  if (pct > 100) return "100.0%";
  return `${pct.toFixed(1)}%`;
}
