import type { ControlsState } from "@/components/ControlsPanel";

// The seed belongs to the session: a scenario or preset that carried its own
// would make every Run of it replay one sample, and a saved or imported seed
// would silently replace the fresh one drawn at page load.
export function controlsForLoadedState(
  defaults: ControlsState,
  loaded: Partial<ControlsState>,
  sessionSeed: number,
): ControlsState {
  return { ...defaults, ...loaded, seed: sessionSeed };
}
