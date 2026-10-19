import type { ControlsState } from "@/components/ControlsPanel";
import type { TournamentRow } from "@/lib/sim/types";

export interface StateSnapshot {
  schedule: readonly TournamentRow[];
  controls: ControlsState;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : v,
  );
}

// Row ids are minted per row and the seed is redrawn per page load; neither is
// something the user typed.
function fingerprint({ schedule, controls }: StateSnapshot): string {
  return canonical({
    schedule: schedule.map((row) => ({ ...row, id: "" })),
    controls: { ...controls, seed: 0 },
  });
}

/**
 * Loading a demo or a saved preset overwrites the schedule and every control,
 * and the autosave then writes the replacement over the stored state. An
 * untouched scenario (any edit clears `activeScenarioId`) and a state that is
 * still one of the app's own starting points lose nothing; anything else is the
 * user's work.
 */
export function replacingNeedsConfirm(
  current: StateSnapshot & { activeScenarioId: string | null },
  untouched: readonly StateSnapshot[],
): boolean {
  if (current.activeScenarioId != null) return false;
  const now = fingerprint(current);
  return !untouched.some((state) => fingerprint(state) === now);
}
