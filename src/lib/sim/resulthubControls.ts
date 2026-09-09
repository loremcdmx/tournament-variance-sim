import type { ControlsState } from "@/components/ControlsPanel";
import type { ResulthubGgBrSummary } from "./resulthubLookup";

export function mergeResulthubSummary(
  latest: ControlsState,
  requestedUsernames: readonly string[],
  summary: ResulthubGgBrSummary,
): ControlsState | null {
  const usernames = latest.battleRoyaleLeaderboard.observedResultHubUsernames;
  if (usernames.length !== requestedUsernames.length ||
      usernames.some((name, index) => name !== requestedUsernames[index])) return null;
  return {
    ...latest,
    battleRoyaleLeaderboard: {
      ...latest.battleRoyaleLeaderboard,
      observedTotalPrizes: summary.totalPrizes,
      observedPointsByStake: { ...summary.pointsByStake },
    },
  };
}
