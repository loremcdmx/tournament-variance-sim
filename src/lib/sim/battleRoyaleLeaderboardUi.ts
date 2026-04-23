import type {
  BattleRoyaleLeaderboardObservedConfig,
  BattleRoyaleLeaderboardObservedPointsByStake,
  BattleRoyaleLeaderboardPromoConfig,
  TournamentRow,
} from "./types";

export interface BattleRoyaleLeaderboardControls {
  mode: "off" | "observed";
  observedTotalPrizes: number;
  observedTotalTournaments: number;
  observedPointsByStake: BattleRoyaleLeaderboardObservedPointsByStake;
}

export const DEFAULT_BATTLE_ROYALE_LEADERBOARD_POINTS: BattleRoyaleLeaderboardObservedPointsByStake =
  {
    "0.25": 0,
    "1": 0,
    "3": 0,
    "10": 0,
    "25": 0,
  };

export const DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS: BattleRoyaleLeaderboardControls =
  {
    mode: "off",
    observedTotalPrizes: 0,
    observedTotalTournaments: 0,
    observedPointsByStake: DEFAULT_BATTLE_ROYALE_LEADERBOARD_POINTS,
  };

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function finiteOr(
  value: unknown,
  fallback: number,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizePointsByStake(
  value: unknown,
): BattleRoyaleLeaderboardObservedPointsByStake {
  if (!isRecord(value)) return DEFAULT_BATTLE_ROYALE_LEADERBOARD_POINTS;
  return {
    "0.25": finiteOr(value["0.25"], 0),
    "1": finiteOr(value["1"], 0),
    "3": finiteOr(value["3"], 0),
    "10": finiteOr(value["10"], 0),
    "25": finiteOr(value["25"], 0),
  };
}

export function normalizeBattleRoyaleLeaderboardControls(
  value: unknown,
): BattleRoyaleLeaderboardControls | undefined {
  if (!isRecord(value)) return undefined;
  const mode = value.mode === "observed" ? "observed" : "off";
  return {
    mode,
    observedTotalPrizes: finiteOr(value.observedTotalPrizes, 0),
    observedTotalTournaments: Math.floor(
      finiteOr(value.observedTotalTournaments, 0, 0, 10_000_000),
    ),
    observedPointsByStake: normalizePointsByStake(value.observedPointsByStake),
  };
}

export function isBattleRoyaleRow(
  row: Pick<TournamentRow, "gameType" | "payoutStructure">,
): boolean {
  return (
    row.gameType === "mystery-royale" ||
    row.payoutStructure === "battle-royale"
  );
}

export function scheduleHasBattleRoyaleRows(
  schedule: readonly Pick<TournamentRow, "gameType" | "payoutStructure">[],
): boolean {
  return schedule.some((r) => isBattleRoyaleRow(r));
}

function buildObservedConfig(
  controls: BattleRoyaleLeaderboardControls,
): BattleRoyaleLeaderboardObservedConfig | undefined {
  if (controls.mode !== "observed") return undefined;
  if (!(controls.observedTotalTournaments > 0)) return undefined;
  return {
    mode: "observed",
    totalPrizes: Math.max(0, controls.observedTotalPrizes),
    totalTournaments: Math.max(1, Math.floor(controls.observedTotalTournaments)),
    pointsByStake: controls.observedPointsByStake,
  };
}

export function buildBattleRoyaleLeaderboardPromoConfig(
  controls: BattleRoyaleLeaderboardControls | null | undefined,
  schedule: readonly Pick<TournamentRow, "gameType" | "payoutStructure">[],
): BattleRoyaleLeaderboardPromoConfig | undefined {
  if (!scheduleHasBattleRoyaleRows(schedule)) return undefined;
  const cfg =
    controls ?? DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS;
  return buildObservedConfig(cfg);
}
