export const STOP_CLICK_GRACE_MS = 500;

// Run turns into Stop under the pointer within a frame or two, so the second
// click of a double-click on Run would otherwise cancel the run it just started.
export function isStopClickTooEarly(
  runStartedAtMs: number | null,
  nowMs: number,
): boolean {
  return runStartedAtMs !== null && nowMs - runStartedAtMs < STOP_CLICK_GRACE_MS;
}
