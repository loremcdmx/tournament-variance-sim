import {
  analyzeBattleRoyaleLeaderboardLookup,
  type BattleRoyaleLeaderboardLookupAnalysis,
} from "./battleRoyaleLeaderboardLookup";
import {
  BATTLE_ROYALE_LEADERBOARD_MANUAL_SOURCE,
  BATTLE_ROYALE_LEADERBOARD_MANUAL_STAKES,
  getBattleRoyaleLeaderboardManualSnapshots,
  type BattleRoyaleLeaderboardManualStake,
} from "./battleRoyaleLeaderboardManualData";
import type { TournamentRow } from "./types";

export type BattleRoyaleLeaderboardManualStakeSelection =
  | "auto"
  | BattleRoyaleLeaderboardManualStake;

export interface BattleRoyaleLeaderboardManualAnalysis
  extends BattleRoyaleLeaderboardLookupAnalysis {
  stake: BattleRoyaleLeaderboardManualStake;
  hasBuiltInSnapshots: boolean;
  source: typeof BATTLE_ROYALE_LEADERBOARD_MANUAL_SOURCE;
}

export const DEFAULT_BATTLE_ROYALE_LEADERBOARD_MANUAL_STAKE: BattleRoyaleLeaderboardManualStake =
  "1";

export function isBattleRoyaleLeaderboardManualStake(
  value: unknown,
): value is BattleRoyaleLeaderboardManualStake {
  return (
    typeof value === "string" &&
    BATTLE_ROYALE_LEADERBOARD_MANUAL_STAKES.includes(
      value as BattleRoyaleLeaderboardManualStake,
    )
  );
}

export function normalizeBattleRoyaleLeaderboardManualStake(
  value: unknown,
): BattleRoyaleLeaderboardManualStakeSelection {
  return value === "auto" || isBattleRoyaleLeaderboardManualStake(value)
    ? value
    : "auto";
}

export function nearestBattleRoyaleLeaderboardManualStake(
  buyIn: number | null | undefined,
): BattleRoyaleLeaderboardManualStake {
  const n = typeof buyIn === "number" && Number.isFinite(buyIn) ? buyIn : 0;
  if (!(n > 0)) return DEFAULT_BATTLE_ROYALE_LEADERBOARD_MANUAL_STAKE;
  let best = DEFAULT_BATTLE_ROYALE_LEADERBOARD_MANUAL_STAKE;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const stake of BATTLE_ROYALE_LEADERBOARD_MANUAL_STAKES) {
    const distance = Math.abs(Math.log(n / Number(stake)));
    if (distance < bestDistance) {
      best = stake;
      bestDistance = distance;
    }
  }
  return best;
}

export function inferBattleRoyaleLeaderboardManualStake(
  schedule: readonly Partial<
    Pick<TournamentRow, "buyIn" | "count" | "gameType" | "payoutStructure">
  >[],
): BattleRoyaleLeaderboardManualStake {
  let tournaments = 0;
  let buyIns = 0;
  for (const row of schedule) {
    const isBattleRoyale =
      row.gameType === "mystery-royale" ||
      row.payoutStructure === "battle-royale";
    if (!isBattleRoyale) continue;
    const count =
      typeof row.count === "number" && Number.isFinite(row.count)
        ? Math.max(0, row.count)
        : 1;
    const buyIn =
      typeof row.buyIn === "number" && Number.isFinite(row.buyIn)
        ? Math.max(0, row.buyIn)
        : 0;
    tournaments += count;
    buyIns += count * buyIn;
  }
  return nearestBattleRoyaleLeaderboardManualStake(
    tournaments > 0 ? buyIns / tournaments : null,
  );
}

export function resolveBattleRoyaleLeaderboardManualStake(params: {
  selected: BattleRoyaleLeaderboardManualStakeSelection;
  schedule: readonly Partial<
    Pick<TournamentRow, "buyIn" | "count" | "gameType" | "payoutStructure">
  >[];
}): BattleRoyaleLeaderboardManualStake {
  return params.selected === "auto"
    ? inferBattleRoyaleLeaderboardManualStake(params.schedule)
    : params.selected;
}

export function analyzeBattleRoyaleLeaderboardManual(params: {
  stake: BattleRoyaleLeaderboardManualStake;
  tournamentsPerDay: number;
  pointsPerTournament: number;
}): BattleRoyaleLeaderboardManualAnalysis {
  const snapshots = getBattleRoyaleLeaderboardManualSnapshots(params.stake);
  const analysis = analyzeBattleRoyaleLeaderboardLookup({
    tournamentsPerDay: params.tournamentsPerDay,
    pointsPerTournament: params.pointsPerTournament,
    snapshots,
  });
  return {
    ...analysis,
    stake: params.stake,
    hasBuiltInSnapshots: snapshots.length > 0,
    source: BATTLE_ROYALE_LEADERBOARD_MANUAL_SOURCE,
  };
}
