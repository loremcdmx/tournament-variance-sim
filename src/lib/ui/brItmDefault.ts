export const BR_GLOBAL_ITM_PCT = 20;

export interface ItmTargetControls {
  itmGlobalEnabled: boolean;
  itmGlobalPct: number;
}

const samePct = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/**
 * A schedule that just became pure Battle Royale gets the 20 % ITM target while
 * the percent is still the untouched generic default. Returns the target to
 * write, or null when there is nothing to change.
 */
export function brItmOnEnter(
  current: ItmTargetControls,
  genericPct: number,
): ItmTargetControls | null {
  if (!samePct(current.itmGlobalPct, genericPct)) return null;
  return { itmGlobalEnabled: true, itmGlobalPct: BR_GLOBAL_ITM_PCT };
}

export function holdsBrItmTarget(current: ItmTargetControls): boolean {
  return current.itmGlobalEnabled && samePct(current.itmGlobalPct, BR_GLOBAL_ITM_PCT);
}

/**
 * The BR target leaks onto every later freezeout / PKO / Mystery row that has
 * no ITM of its own (σ 10-19 % lower at 1500 players), so leaving pure BR puts
 * back what the app replaced. Only while the controls still hold exactly what
 * the app wrote: a target the user set stays.
 */
export function brItmOnLeave(
  current: ItmTargetControls,
  before: ItmTargetControls,
): ItmTargetControls | null {
  if (!holdsBrItmTarget(current)) return null;
  return { itmGlobalEnabled: before.itmGlobalEnabled, itmGlobalPct: before.itmGlobalPct };
}
