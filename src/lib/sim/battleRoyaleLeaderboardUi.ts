import type {
  BattleRoyaleLeaderboardConfig,
  TournamentRow,
} from "./types";

export interface BattleRoyaleLeaderboardControls {
  enabled: boolean;
  participants: number;
  windowTournaments: number;
  awardPartialWindow: boolean;
  entryPoints: number;
  knockoutPoints: number;
  firstPoints: number;
  secondPoints: number;
  thirdPoints: number;
  top1Prize: number;
  top2To3Prize: number;
  top4To10Prize: number;
  opponentMeanScore: number;
  opponentStdDevScore: number;
}

export const DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS: BattleRoyaleLeaderboardControls =
  {
    enabled: false,
    participants: 200,
    windowTournaments: 100,
    awardPartialWindow: true,
    entryPoints: 1,
    knockoutPoints: 4,
    firstPoints: 15,
    secondPoints: 9,
    thirdPoints: 6,
    top1Prize: 500,
    top2To3Prize: 200,
    top4To10Prize: 75,
    opponentMeanScore: 180,
    opponentStdDevScore: 45,
  };

export const DEFAULT_BATTLE_ROYALE_LEADERBOARD_SHARE = 1;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readNumber(
  record: Record<string, unknown>,
  key: keyof BattleRoyaleLeaderboardControls,
  fallback: number,
  min: number,
  max: number,
  integer = false,
): number {
  const raw = record[key];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  const safe = clamp(raw, min, max);
  return integer ? Math.floor(safe) : safe;
}

export function normalizeBattleRoyaleLeaderboardControls(
  value: unknown,
): BattleRoyaleLeaderboardControls | undefined {
  if (!isRecord(value)) return undefined;
  return {
    enabled:
      typeof value.enabled === "boolean"
        ? value.enabled
        : DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS.enabled,
    participants: readNumber(
      value,
      "participants",
      DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS.participants,
      2,
      100_000,
      true,
    ),
    windowTournaments: readNumber(
      value,
      "windowTournaments",
      DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS.windowTournaments,
      1,
      100_000,
      true,
    ),
    awardPartialWindow:
      typeof value.awardPartialWindow === "boolean"
        ? value.awardPartialWindow
        : DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS.awardPartialWindow,
    entryPoints: readNumber(
      value,
      "entryPoints",
      DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS.entryPoints,
      0,
      100_000,
    ),
    knockoutPoints: readNumber(
      value,
      "knockoutPoints",
      DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS.knockoutPoints,
      0,
      100_000,
    ),
    firstPoints: readNumber(
      value,
      "firstPoints",
      DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS.firstPoints,
      0,
      100_000,
    ),
    secondPoints: readNumber(
      value,
      "secondPoints",
      DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS.secondPoints,
      0,
      100_000,
    ),
    thirdPoints: readNumber(
      value,
      "thirdPoints",
      DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS.thirdPoints,
      0,
      100_000,
    ),
    top1Prize: readNumber(
      value,
      "top1Prize",
      DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS.top1Prize,
      0,
      1_000_000_000,
    ),
    top2To3Prize: readNumber(
      value,
      "top2To3Prize",
      DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS.top2To3Prize,
      0,
      1_000_000_000,
    ),
    top4To10Prize: readNumber(
      value,
      "top4To10Prize",
      DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS.top4To10Prize,
      0,
      1_000_000_000,
    ),
    opponentMeanScore: readNumber(
      value,
      "opponentMeanScore",
      DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS.opponentMeanScore,
      0,
      1_000_000,
    ),
    opponentStdDevScore: readNumber(
      value,
      "opponentStdDevScore",
      DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS.opponentStdDevScore,
      0,
      1_000_000,
    ),
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

export function normalizeBattleRoyaleLeaderboardShare(
  value: unknown,
  fallback = DEFAULT_BATTLE_ROYALE_LEADERBOARD_SHARE,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return clamp(value, 0, 1);
}

export function battleRoyaleLeaderboardShareForRow(
  row: Pick<
    TournamentRow,
    | "gameType"
    | "payoutStructure"
    | "battleRoyaleLeaderboardEnabled"
    | "battleRoyaleLeaderboardShare"
  >,
  advanced: boolean,
): number {
  if (!advanced || !isBattleRoyaleRow(row)) return 0;
  if (!row.battleRoyaleLeaderboardEnabled) return 0;
  // The current product contract is a simple on/off toggle:
  // off  -> 100% direct RB
  // on   -> 100% leaderboard promo channel
  // Keep the legacy share field only for backward-compatible payload reads.
  return 1;
}

export function battleRoyaleDirectRakebackShareForRow(
  row: Pick<
    TournamentRow,
    | "gameType"
    | "payoutStructure"
    | "battleRoyaleLeaderboardEnabled"
    | "battleRoyaleLeaderboardShare"
  >,
  advanced: boolean,
): number {
  return 1 - battleRoyaleLeaderboardShareForRow(row, advanced);
}

export function scheduleHasBattleRoyaleRows(
  schedule: readonly Pick<TournamentRow, "gameType" | "payoutStructure">[],
): boolean {
  return schedule.some((r) => isBattleRoyaleRow(r));
}

export function scheduleHasBattleRoyaleLeaderboardRows(
  schedule: readonly Pick<
    TournamentRow,
    | "id"
    | "gameType"
    | "payoutStructure"
    | "battleRoyaleLeaderboardEnabled"
    | "battleRoyaleLeaderboardShare"
  >[],
  advanced: boolean,
): boolean {
  return schedule.some(
    (r) => battleRoyaleLeaderboardShareForRow(r, advanced) > 0,
  );
}

export function buildBattleRoyaleLeaderboardConfig(
  controls: BattleRoyaleLeaderboardControls | null | undefined,
  schedule: readonly Pick<
    TournamentRow,
    | "id"
    | "gameType"
    | "payoutStructure"
    | "battleRoyaleLeaderboardEnabled"
    | "battleRoyaleLeaderboardShare"
  >[],
  advanced: boolean,
): BattleRoyaleLeaderboardConfig | undefined {
  if (!advanced) return undefined;
  const includedRowIds = schedule
    .filter((row) => battleRoyaleLeaderboardShareForRow(row, advanced) > 0)
    .map((row) => row.id);
  if (includedRowIds.length === 0) return undefined;

  const cfg =
    normalizeBattleRoyaleLeaderboardControls(controls) ??
    DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS;
  const payouts = [
    { rankFrom: 1, rankTo: 1, prizeEach: cfg.top1Prize },
    { rankFrom: 2, rankTo: 3, prizeEach: cfg.top2To3Prize },
    { rankFrom: 4, rankTo: 10, prizeEach: cfg.top4To10Prize },
  ].filter((tier) => tier.prizeEach > 0);
  if (payouts.length === 0) return undefined;

  return {
    participants: cfg.participants,
    windowTournaments: cfg.windowTournaments,
    awardPartialWindow: cfg.awardPartialWindow,
    scoring: {
      entryPoints: cfg.entryPoints,
      knockoutPoints: cfg.knockoutPoints,
      firstPoints: cfg.firstPoints,
      secondPoints: cfg.secondPoints,
      thirdPoints: cfg.thirdPoints,
    },
    payouts,
    opponentModel: {
      kind: "normal",
      meanScore: cfg.opponentMeanScore,
      stdDevScore: cfg.opponentStdDevScore,
    },
    includedRowIds,
  };
}
