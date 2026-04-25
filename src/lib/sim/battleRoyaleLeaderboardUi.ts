import type {
  BattleRoyaleLeaderboardLookupSnapshot,
  BattleRoyaleLeaderboardManualConfig,
  BattleRoyaleLeaderboardObservedConfig,
  BattleRoyaleLeaderboardObservedPointsByStake,
  BattleRoyaleLeaderboardPromoConfig,
  TournamentRow,
} from "./types";
import {
  analyzeBattleRoyaleLeaderboardLookup,
  normalizeBattleRoyaleLeaderboardLookupSnapshots,
} from "./battleRoyaleLeaderboardLookup";
import {
  analyzeBattleRoyaleLeaderboardManual,
  normalizeBattleRoyaleLeaderboardManualStake,
  resolveBattleRoyaleLeaderboardManualStake,
  type BattleRoyaleLeaderboardManualStakeSelection,
} from "./battleRoyaleLeaderboardManual";

export interface BattleRoyaleLeaderboardControls {
  mode: "off" | "observed" | "manual" | "lookup";
  /**
   * GGPoker nicks tied to this profile (current + any prior nicks the
   * player rebranded to). Each entry is sanitized + capped at
   * `OBSERVED_USERNAME_MAX_LEN`. Up to `OBSERVED_USERNAMES_MAX_COUNT`
   * entries; ResultHub doesn't track GGPoker rename history, so the
   * lookup fans out across all entries and sums the per-stake totals.
   */
  observedResultHubUsernames: string[];
  observedTotalPrizes: number;
  observedTotalTournaments: number;
  observedPointsByStake: BattleRoyaleLeaderboardObservedPointsByStake;
  manualPayoutPerTournament: number;
  manualStake: BattleRoyaleLeaderboardManualStakeSelection;
  manualTournamentsPerDay: number;
  manualPointsPerTournament: number;
  lookupTournamentsPerDay: number;
  lookupPointsPerTournament: number;
  lookupSnapshots: BattleRoyaleLeaderboardLookupSnapshot[];
}

type BattleRoyaleLeaderboardScheduleRow = Pick<
  TournamentRow,
  "gameType" | "payoutStructure"
> &
  Partial<Pick<TournamentRow, "buyIn" | "count">>;

export const DEFAULT_BATTLE_ROYALE_LEADERBOARD_POINTS: BattleRoyaleLeaderboardObservedPointsByStake =
  {
    "0.25": 0,
    "1": 0,
    "3": 0,
    "10": 0,
    "25": 0,
  };

export const OBSERVED_USERNAME_MAX_LEN = 64;
export const OBSERVED_USERNAMES_MAX_COUNT = 10;

export const DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS: BattleRoyaleLeaderboardControls =
  {
    mode: "off",
    observedResultHubUsernames: [],
    observedTotalPrizes: 0,
    observedTotalTournaments: 0,
    observedPointsByStake: DEFAULT_BATTLE_ROYALE_LEADERBOARD_POINTS,
    manualPayoutPerTournament: 0,
    manualStake: "auto",
    manualTournamentsPerDay: 160,
    manualPointsPerTournament: 40,
    lookupTournamentsPerDay: 160,
    lookupPointsPerTournament: 40,
    lookupSnapshots: [],
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

export function normalizeObservedResultHubUsername(value: unknown): string {
  if (typeof value !== "string") return "";
  // Strip control characters (codepoints < 32 and DEL), trim outer
  // whitespace, cap length. We don't restrict to ASCII — ResultHub allows
  // non-Latin nicks.
  let stripped = "";
  for (const ch of value) {
    const cp = ch.codePointAt(0);
    if (cp != null && cp >= 32 && cp !== 127) stripped += ch;
  }
  return stripped.trim().slice(0, OBSERVED_USERNAME_MAX_LEN);
}

/**
 * Parse a free-form input ("nick1, nick2, oldNick") into a deduped, capped
 * array of clean nicks. Splits on comma or newline, drops empties, keeps
 * GGPoker case sensitivity, drops duplicates by exact match.
 */
export function parseObservedResultHubUsernames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return dedupeUsernames(
      value
        .map((v) => normalizeObservedResultHubUsername(v))
        .filter((s) => s.length > 0),
    );
  }
  if (typeof value !== "string") return [];
  return dedupeUsernames(
    value
      .split(/[,\n]/)
      .map((s) => normalizeObservedResultHubUsername(s))
      .filter((s) => s.length > 0),
  );
}

function dedupeUsernames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= OBSERVED_USERNAMES_MAX_COUNT) break;
  }
  return out;
}

/**
 * Render an array of nicks for editing in a single-line input. Comma+space
 * keeps the source obvious if the user round-trips through the field.
 */
export function joinObservedResultHubUsernames(names: readonly string[]): string {
  return names.join(", ");
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
  const mode =
    value.mode === "observed"
      ? "observed"
      : value.mode === "lookup"
        ? "lookup"
      : value.mode === "manual"
        ? "manual"
        : "off";
  // Migration: persisted state from before the multi-nick change had
  // `observedResultHubUsername: string`. Accept either form, prefer array.
  const usernames =
    value.observedResultHubUsernames !== undefined
      ? parseObservedResultHubUsernames(value.observedResultHubUsernames)
      : parseObservedResultHubUsernames(value.observedResultHubUsername);
  return {
    mode,
    observedResultHubUsernames: usernames,
    observedTotalPrizes: finiteOr(value.observedTotalPrizes, 0),
    observedTotalTournaments: Math.floor(
      finiteOr(value.observedTotalTournaments, 0, 0, 10_000_000),
    ),
    observedPointsByStake: normalizePointsByStake(value.observedPointsByStake),
    manualPayoutPerTournament: finiteOr(
      value.manualPayoutPerTournament,
      0,
      0,
      1_000_000,
    ),
    manualStake: normalizeBattleRoyaleLeaderboardManualStake(value.manualStake),
    manualTournamentsPerDay: finiteOr(
      value.manualTournamentsPerDay,
      finiteOr(
        value.lookupTournamentsPerDay,
        DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS.manualTournamentsPerDay,
        0,
        1_000_000,
      ),
      0,
      1_000_000,
    ),
    manualPointsPerTournament: finiteOr(
      value.manualPointsPerTournament,
      finiteOr(
        value.lookupPointsPerTournament,
        DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS.manualPointsPerTournament,
        0,
        1_000_000,
      ),
      0,
      1_000_000,
    ),
    lookupTournamentsPerDay: finiteOr(
      value.lookupTournamentsPerDay,
      DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS.lookupTournamentsPerDay,
      0,
      1_000_000,
    ),
    lookupPointsPerTournament: finiteOr(
      value.lookupPointsPerTournament,
      DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS.lookupPointsPerTournament,
      0,
      1_000_000,
    ),
    lookupSnapshots: normalizeBattleRoyaleLeaderboardLookupSnapshots(
      value.lookupSnapshots,
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

function buildManualConfig(
  controls: BattleRoyaleLeaderboardControls,
  schedule: readonly BattleRoyaleLeaderboardScheduleRow[],
): BattleRoyaleLeaderboardManualConfig | undefined {
  if (controls.mode !== "manual") return undefined;
  const stake = resolveBattleRoyaleLeaderboardManualStake({
    selected: controls.manualStake,
    schedule,
  });
  const manual = analyzeBattleRoyaleLeaderboardManual({
    stake,
    tournamentsPerDay: controls.manualTournamentsPerDay,
    pointsPerTournament: controls.manualPointsPerTournament,
  });
  if (manual.hasBuiltInSnapshots && manual.tournamentsPerDay > 0) {
    if (!(manual.payoutPerTournament > 0)) return undefined;
    return {
      mode: "manual",
      payoutPerTournament: manual.payoutPerTournament,
      stake,
      tournamentsPerDay: manual.tournamentsPerDay,
      pointsPerTournament: manual.pointsPerTournament,
      targetPoints: manual.targetPoints,
      snapshotCount: manual.snapshotCount,
      paidDays: manual.paidDays,
      averageDailyPrize: manual.averageDailyPrize,
    };
  }
  if (!(controls.manualPayoutPerTournament > 0)) return undefined;
  return {
    mode: "manual",
    payoutPerTournament: Math.max(0, controls.manualPayoutPerTournament),
  };
}

function buildLookupConfig(
  controls: BattleRoyaleLeaderboardControls,
): BattleRoyaleLeaderboardPromoConfig | undefined {
  if (controls.mode !== "lookup") return undefined;
  const lookup = analyzeBattleRoyaleLeaderboardLookup({
    tournamentsPerDay: controls.lookupTournamentsPerDay,
    pointsPerTournament: controls.lookupPointsPerTournament,
    snapshots: controls.lookupSnapshots,
  });
  if (!(lookup.snapshotCount > 0) || !(lookup.tournamentsPerDay > 0)) {
    return undefined;
  }
  if (!(lookup.payoutPerTournament > 0)) return undefined;
  return {
    mode: "lookup",
    payoutPerTournament: lookup.payoutPerTournament,
    tournamentsPerDay: lookup.tournamentsPerDay,
    pointsPerTournament: lookup.pointsPerTournament,
    targetPoints: lookup.targetPoints,
    snapshotCount: lookup.snapshotCount,
    paidDays: lookup.paidDays,
    averageDailyPrize: lookup.averageDailyPrize,
  };
}

export function buildBattleRoyaleLeaderboardPromoConfig(
  controls: BattleRoyaleLeaderboardControls | null | undefined,
  schedule: readonly BattleRoyaleLeaderboardScheduleRow[],
): BattleRoyaleLeaderboardPromoConfig | undefined {
  if (!scheduleHasBattleRoyaleRows(schedule)) return undefined;
  const cfg = controls ?? DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS;
  return (
    buildObservedConfig(cfg) ??
    buildManualConfig(cfg, schedule) ??
    buildLookupConfig(cfg)
  );
}
