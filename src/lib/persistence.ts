"use client";

/**
 * localStorage + share-URL persistence. Stores only serializable input
 * state (schedule + controls) — never `SimulationResult`, never worker
 * state. All reads validate and fall back cleanly on schema drift; this
 * is a boundary where defensive parsing is intentional.
 */
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import type { GameType, PayoutStructureId, TournamentRow } from "./sim/types";
import type { ControlsState } from "@/components/ControlsPanel";
import {
  DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS,
  normalizeBattleRoyaleLeaderboardShare,
} from "@/lib/sim/battleRoyaleLeaderboardUi";

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isTournamentRowLike(v: unknown): v is TournamentRow {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === "string" &&
    isFiniteNumber(v.players) &&
    isFiniteNumber(v.buyIn) &&
    isFiniteNumber(v.rake) &&
    isFiniteNumber(v.roi) &&
    typeof v.payoutStructure === "string" &&
    isFiniteNumber(v.count)
  );
}

function isPersistedState(v: unknown): v is PersistedState {
  if (!isRecord(v)) return false;
  if (v.v !== 1) return false;
  if (!Array.isArray(v.schedule) || !v.schedule.every(isTournamentRowLike)) {
    return false;
  }
  if (!isRecord(v.controls)) return false;
  return true;
}

// Warn dev if a loaded row has BR/mystery-royale flags out of sync — the
// compile boundary will fix it silently, but surfacing here helps catch
// bad imports or stale JSON before engine behavior depends on the fix.
function warnOnBrMrDrift(schedule: readonly TournamentRow[] | undefined, source: string) {
  if (!schedule) return;
  for (const r of schedule) {
    const isBR = r.payoutStructure === "battle-royale";
    const isMR = r.gameType === "mystery-royale";
    if (isBR !== isMR) {
      console.warn(
        `[persistence/${source}] row "${r.label || r.id}" has BR/mystery-royale flags out of sync (gameType=${r.gameType}, payoutStructure=${r.payoutStructure}); compiler will normalize.`,
      );
    }
  }
}

export interface PersistedState {
  v: 1;
  schedule: TournamentRow[];
  controls: ControlsState;
}

const LS_KEY = "tvs:state";
const VALID_FINISH_MODEL_IDS = new Set<ControlsState["finishModelId"]>([
  "power-law",
  "linear-skill",
  "stretched-exp",
  "plackett-luce",
  "uniform",
  "empirical",
  "freeze-realdata-step",
  "freeze-realdata-linear",
  "freeze-realdata-tilt",
  "pko-realdata-step",
  "pko-realdata-linear",
  "pko-realdata-tilt",
  "mystery-realdata-step",
  "mystery-realdata-linear",
  "mystery-realdata-tilt",
  "powerlaw-realdata-influenced",
]);
const VALID_GAME_TYPES = new Set<GameType>([
  "freezeout",
  "freezeout-reentry",
  "pko",
  "mystery",
  "mystery-royale",
]);
const VALID_PAYOUT_STRUCTURE_IDS = new Set<PayoutStructureId>([
  "mtt-standard",
  "mtt-primedope",
  "mtt-flat",
  "mtt-top-heavy",
  "battle-royale",
  "mtt-pokerstars",
  "mtt-gg",
  "mtt-sunday-million",
  "mtt-gg-bounty",
  "mtt-gg-mystery",
  "satellite-ticket",
  "sng-50-30-20",
  "sng-65-35",
  "winner-takes-all",
  "custom",
]);
const VALID_COMPARE_MODES = new Set<ControlsState["compareMode"]>([
  "random",
  "primedope",
]);
const MAX_EMPIRICAL_BUCKETS = 100_000;
const PERSISTED_ROW_PLAYERS_MIN = 2;
const PERSISTED_ROW_PLAYERS_MAX = 1_000_000;
const PERSISTED_ROW_BUYIN_MIN = 0.01;
const PERSISTED_ROW_RAKE_MIN = 0;
const PERSISTED_ROW_RAKE_MAX = 1;
const PERSISTED_ROW_ROI_MIN = -0.99;
const PERSISTED_ROW_ROI_MAX = 100;
const PERSISTED_ROW_ITM_RATE_MIN = 0;
const PERSISTED_ROW_ITM_RATE_MAX = 1;
const PERSISTED_ROW_MAX_ENTRIES_MIN = 1;
const PERSISTED_ROW_MAX_ENTRIES_MAX = 100;
const PERSISTED_ROW_REENTRY_RATE_MIN = 0;
const PERSISTED_ROW_REENTRY_RATE_MAX = 1;
const PERSISTED_ROW_BOUNTY_MIN = 0;
const PERSISTED_ROW_BOUNTY_MAX = 0.9;
const PERSISTED_ROW_BOUNTY_EV_BIAS_MIN = -0.25;
const PERSISTED_ROW_BOUNTY_EV_BIAS_MAX = 0.25;
const PERSISTED_ROW_PAY_JUMP_MIN = 0;
const PERSISTED_ROW_PAY_JUMP_MAX = 1;
const PERSISTED_ROW_ITM_TOP_HEAVY_BIAS_MIN = -1;
const PERSISTED_ROW_ITM_TOP_HEAVY_BIAS_MAX = 1;
const PERSISTED_ROW_MYSTERY_VARIANCE_MIN = 0;
const PERSISTED_ROW_MYSTERY_VARIANCE_MAX = 3;
const PERSISTED_ROW_BR_LEADERBOARD_SHARE_MIN = 0;
const PERSISTED_ROW_BR_LEADERBOARD_SHARE_MAX = 1;
const PERSISTED_FIELD_VARIABILITY_BUCKETS_MAX = 20;
const PERSISTED_ROW_COUNT_MAX = 100_000;
const PERSISTED_SCHEDULE_REPEATS_MAX = 100_000;
const PERSISTED_SAMPLES_MIN = 100;
const PERSISTED_SAMPLES_MAX = 1_000_000;
const PERSISTED_BANKROLL_MAX = 1_000_000_000;

function clampPersistedCount(count: number): number {
  return Math.min(PERSISTED_ROW_COUNT_MAX, Math.max(1, count));
}

function clampPersistedPlayers(players: number): number {
  return Math.min(PERSISTED_ROW_PLAYERS_MAX, Math.max(PERSISTED_ROW_PLAYERS_MIN, players));
}

function clampPersistedRake(rake: number): number {
  return Math.min(PERSISTED_ROW_RAKE_MAX, Math.max(PERSISTED_ROW_RAKE_MIN, rake));
}

function clampPersistedOptionalNumber(
  value: unknown,
  min: number,
  max: number,
): number | undefined {
  if (!isFiniteNumber(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

function clampPersistedOptionalInt(
  value: unknown,
  min: number,
  max: number,
): number | undefined {
  if (!isFiniteNumber(value)) return undefined;
  return clampPersistedInt(value, min, max);
}

function isValidFinishModelId(
  value: unknown,
): value is ControlsState["finishModelId"] {
  return (
    typeof value === "string" &&
    VALID_FINISH_MODEL_IDS.has(value as ControlsState["finishModelId"])
  );
}

function isValidCompareMode(
  value: unknown,
): value is ControlsState["compareMode"] {
  return (
    typeof value === "string" &&
    VALID_COMPARE_MODES.has(value as ControlsState["compareMode"])
  );
}

function isValidGameType(value: unknown): value is GameType {
  return typeof value === "string" && VALID_GAME_TYPES.has(value as GameType);
}

function normalizePersistedGameType(value: unknown): GameType | undefined {
  return isValidGameType(value) ? value : undefined;
}

function isValidPayoutStructureId(value: unknown): value is PayoutStructureId {
  return (
    typeof value === "string" &&
    VALID_PAYOUT_STRUCTURE_IDS.has(value as PayoutStructureId)
  );
}

function defaultPayoutStructureForGameType(
  gameType: TournamentRow["gameType"],
): Exclude<PayoutStructureId, "custom"> {
  switch (gameType) {
    case "mystery-royale":
      return "battle-royale";
    case "mystery":
      return "mtt-gg-mystery";
    case "pko":
      return "mtt-gg-bounty";
    default:
      return "mtt-standard";
  }
}

function normalizeEmpiricalBuckets(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  if (value.length > MAX_EMPIRICAL_BUCKETS) return undefined;
  const buckets = value.filter(
    (entry): entry is number =>
      isFiniteNumber(entry) && entry >= 0 && Number.isInteger(entry),
  );
  if (buckets.length !== value.length) return undefined;
  if (!(buckets.reduce((sum, entry) => sum + entry, 0) > 0)) return undefined;
  return buckets;
}

function normalizePersistedCustomPayouts(
  row: TournamentRow,
  players: number,
): Pick<TournamentRow, "payoutStructure" | "customPayouts"> {
  if (row.payoutStructure !== "custom") {
    return { payoutStructure: row.payoutStructure, customPayouts: undefined };
  }
  const raw = row.customPayouts;
  if (!Array.isArray(raw)) {
    return { payoutStructure: "mtt-standard", customPayouts: undefined };
  }
  const trimmed = raw.slice(0, Math.max(1, Math.floor(players)));
  if (
    trimmed.length === 0 ||
    !trimmed.every((value) => isFiniteNumber(value) && value >= 0) ||
    !(trimmed.reduce((sum, value) => sum + value, 0) > 0)
  ) {
    return { payoutStructure: "mtt-standard", customPayouts: undefined };
  }
  return {
    payoutStructure: row.payoutStructure,
    customPayouts: trimmed.length === raw.length ? raw : trimmed,
  };
}

function normalizePersistedFinishBuckets(
  finishBuckets: TournamentRow["finishBuckets"],
  itmRate: number | undefined,
): TournamentRow["finishBuckets"] | undefined {
  if (!finishBuckets || typeof finishBuckets !== "object" || itmRate == null) {
    return undefined;
  }
  const cap = Math.max(0, Math.min(1, itmRate));
  const normalizeLock = (value: unknown): number | undefined | null => {
    if (value == null) return undefined;
    if (!isFiniteNumber(value) || value < 0 || value > cap) return null;
    return value;
  };
  const first = normalizeLock(finishBuckets.first);
  const top3 = normalizeLock(finishBuckets.top3);
  const ft = normalizeLock(finishBuckets.ft);
  if (first === null || top3 === null || ft === null) {
    return undefined;
  }
  if (
    (first != null && top3 != null && top3 < first) ||
    (top3 != null && ft != null && ft < top3) ||
    (first != null && ft != null && top3 == null && ft < first)
  ) {
    return undefined;
  }
  const cleaned: NonNullable<TournamentRow["finishBuckets"]> = {};
  if (first != null) cleaned.first = first;
  if (top3 != null) cleaned.top3 = top3;
  if (ft != null) cleaned.ft = ft;
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

function normalizePersistedFieldVariability(
  fieldVariability: TournamentRow["fieldVariability"],
): TournamentRow["fieldVariability"] | undefined {
  if (!fieldVariability || typeof fieldVariability !== "object") return undefined;
  if (fieldVariability.kind === "fixed") return { kind: "fixed" };
  if (
    fieldVariability.kind !== "uniform" ||
    !isFiniteNumber(fieldVariability.min) ||
    !isFiniteNumber(fieldVariability.max)
  ) {
    return undefined;
  }
  const buckets = isFiniteNumber(fieldVariability.buckets)
    ? clampPersistedInt(
        fieldVariability.buckets,
        1,
        PERSISTED_FIELD_VARIABILITY_BUCKETS_MAX,
      )
    : 5;
  return {
    kind: "uniform",
    min: clampPersistedPlayers(fieldVariability.min),
    max: clampPersistedPlayers(fieldVariability.max),
    buckets,
  };
}

function clampPersistedInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function normalizePersistedControls(controls: ControlsState): ControlsState {
  let changed = false;
  const next: Record<string, unknown> = { ...controls };
  const normalizeBoolean = (key: keyof ControlsState) => {
    if (!(key in next)) return;
    const raw = next[key];
    if (typeof raw !== "boolean") {
      delete next[key];
      changed = true;
    }
  };
  const normalizeNumber = (
    key: keyof ControlsState,
    min: number,
    max: number,
    integer = false,
  ) => {
    if (!(key in next)) return;
    const raw = next[key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      delete next[key];
      changed = true;
      return;
    }
    const normalized = integer
      ? clampPersistedInt(raw, min, max)
      : Math.min(max, Math.max(min, raw));
    if (normalized !== raw) {
      next[key] = normalized;
      changed = true;
    }
  };

  // Only normalize persisted knobs that either control simulation work
  // directly or have a tight visible numeric contract in the UI.
  normalizeNumber("scheduleRepeats", 1, PERSISTED_SCHEDULE_REPEATS_MAX, true);
  normalizeNumber("samples", PERSISTED_SAMPLES_MIN, PERSISTED_SAMPLES_MAX, true);
  normalizeNumber("bankroll", 0, PERSISTED_BANKROLL_MAX);
  normalizeNumber("rakebackPct", 0, 100);
  normalizeNumber("itmGlobalPct", 0.5, 99);
  normalizeNumber("roiStdErr", 0, 5);
  normalizeBoolean("compareWithPrimedope");
  normalizeBoolean("usePrimedopePayouts");
  normalizeBoolean("usePrimedopeFinishModel");
  normalizeBoolean("usePrimedopeRakeMath");
  normalizeBoolean("itmGlobalEnabled");

  // These controls are intentionally hidden in the current UI. Letting them
  // survive from old localStorage/share state silently changes the model while
  // giving the user no visible way to inspect or clear the cause.
  for (const key of [
    "roiShockPerTourney",
    "roiShockPerSession",
    "roiDriftSigma",
    "tiltFastGain",
    "tiltFastScale",
    "tiltSlowGain",
    "tiltSlowThreshold",
    "tiltSlowMinDuration",
    "tiltSlowRecoveryFrac",
  ] as const satisfies readonly (keyof ControlsState)[]) {
    if (key in next) {
      delete next[key];
      changed = true;
    }
  }

  if ("finishModelId" in next && !isValidFinishModelId(next.finishModelId)) {
    delete next.finishModelId;
    changed = true;
  }
  if ("compareMode" in next && !isValidCompareMode(next.compareMode)) {
    delete next.compareMode;
    changed = true;
  }
  if ("alphaOverride" in next) {
    const raw = next.alphaOverride;
    if (raw !== null && !isFiniteNumber(raw)) {
      delete next.alphaOverride;
      changed = true;
    }
  }
  if ("empiricalBuckets" in next) {
    const normalized = normalizeEmpiricalBuckets(next.empiricalBuckets);
    if (normalized === undefined) {
      delete next.empiricalBuckets;
      changed = true;
    } else if (normalized !== next.empiricalBuckets) {
      next.empiricalBuckets = normalized;
      changed = true;
    }
  }
  if ("battleRoyaleLeaderboard" in next) {
    const before = JSON.stringify(next.battleRoyaleLeaderboard);
    const after = JSON.stringify(DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS);
    if (before !== after) {
      next.battleRoyaleLeaderboard = DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS;
      changed = true;
    }
  }

  return changed ? (next as unknown as ControlsState) : controls;
}

function normalizePersistedState(state: PersistedState): PersistedState {
  let changed = false;
  const schedule = state.schedule.map((row) => {
    const nextGameType = normalizePersistedGameType(row.gameType);
    const nextPayoutStructure = isValidPayoutStructureId(row.payoutStructure)
      ? row.payoutStructure
      : defaultPayoutStructureForGameType(nextGameType);
    const nextPlayers = clampPersistedPlayers(row.players);
    const nextBuyIn = Math.max(PERSISTED_ROW_BUYIN_MIN, row.buyIn);
    const nextRake = clampPersistedRake(row.rake);
    const nextRoi = Math.min(
      PERSISTED_ROW_ROI_MAX,
      Math.max(PERSISTED_ROW_ROI_MIN, row.roi),
    );
    const nextGuarantee = undefined;
    const nextLateRegMultiplier = undefined;
    const nextItmRate = clampPersistedOptionalNumber(
      row.itmRate,
      PERSISTED_ROW_ITM_RATE_MIN,
      PERSISTED_ROW_ITM_RATE_MAX,
    );
    const nextMaxEntries = clampPersistedOptionalInt(
      row.maxEntries,
      PERSISTED_ROW_MAX_ENTRIES_MIN,
      PERSISTED_ROW_MAX_ENTRIES_MAX,
    );
    const nextReentryRate = clampPersistedOptionalNumber(
      row.reentryRate,
      PERSISTED_ROW_REENTRY_RATE_MIN,
      PERSISTED_ROW_REENTRY_RATE_MAX,
    );
    const nextBountyFraction = clampPersistedOptionalNumber(
      row.bountyFraction,
      PERSISTED_ROW_BOUNTY_MIN,
      PERSISTED_ROW_BOUNTY_MAX,
    );
    const nextBountyEvBias = clampPersistedOptionalNumber(
      row.bountyEvBias,
      PERSISTED_ROW_BOUNTY_EV_BIAS_MIN,
      PERSISTED_ROW_BOUNTY_EV_BIAS_MAX,
    );
    const nextPayJumpAggression = clampPersistedOptionalNumber(
      row.payJumpAggression,
      PERSISTED_ROW_PAY_JUMP_MIN,
      PERSISTED_ROW_PAY_JUMP_MAX,
    );
    const nextItmTopHeavyBias = clampPersistedOptionalNumber(
      row.itmTopHeavyBias,
      PERSISTED_ROW_ITM_TOP_HEAVY_BIAS_MIN,
      PERSISTED_ROW_ITM_TOP_HEAVY_BIAS_MAX,
    );
    const nextMysteryBountyVariance = clampPersistedOptionalNumber(
      row.mysteryBountyVariance,
      PERSISTED_ROW_MYSTERY_VARIANCE_MIN,
      PERSISTED_ROW_MYSTERY_VARIANCE_MAX,
    );
    const nextPkoHeadVar = undefined;
    const nextPkoHeat = undefined;
    const nextBattleRoyaleLeaderboardEnabled =
      typeof row.battleRoyaleLeaderboardEnabled === "boolean"
        ? row.battleRoyaleLeaderboardEnabled
        : undefined;
    const nextBattleRoyaleLeaderboardShare = clampPersistedOptionalNumber(
      row.battleRoyaleLeaderboardShare,
      PERSISTED_ROW_BR_LEADERBOARD_SHARE_MIN,
      PERSISTED_ROW_BR_LEADERBOARD_SHARE_MAX,
    );
    const nextSitThroughPayJumps =
      typeof row.sitThroughPayJumps === "boolean"
        ? row.sitThroughPayJumps
        : undefined;
    let finalMaxEntries: number | undefined = nextMaxEntries;
    let finalReentryRate: number | undefined = nextReentryRate;
    let finalBountyFraction: number | undefined = nextBountyFraction;
    let finalMysteryBountyVariance: number | undefined =
      nextMysteryBountyVariance;
    let finalPkoHeadVar: number | undefined = nextPkoHeadVar;
    let finalPkoHeat: number | undefined = nextPkoHeat;
    let finalBattleRoyaleLeaderboardEnabled:
      | boolean
      | undefined = nextBattleRoyaleLeaderboardEnabled;
    let finalBattleRoyaleLeaderboardShare: number | undefined =
      nextBattleRoyaleLeaderboardShare;
    if (nextGameType === "freezeout") {
      finalMaxEntries = 1;
      finalReentryRate = undefined;
      finalBountyFraction = undefined;
      finalMysteryBountyVariance = undefined;
      finalPkoHeadVar = undefined;
      finalPkoHeat = undefined;
      finalBattleRoyaleLeaderboardEnabled = undefined;
      finalBattleRoyaleLeaderboardShare = undefined;
    } else if (nextGameType === "freezeout-reentry") {
      finalMaxEntries = Math.max(2, nextMaxEntries ?? 2);
      finalReentryRate = nextReentryRate ?? 1;
      finalBountyFraction = undefined;
      finalMysteryBountyVariance = undefined;
      finalPkoHeadVar = undefined;
      finalPkoHeat = undefined;
      finalBattleRoyaleLeaderboardEnabled = undefined;
      finalBattleRoyaleLeaderboardShare = undefined;
    } else if (nextGameType === "pko") {
      finalMaxEntries = 1;
      finalReentryRate = undefined;
      finalBountyFraction = nextBountyFraction ?? 0.5;
      finalMysteryBountyVariance = undefined;
      finalPkoHeadVar = nextPkoHeadVar ?? 0.4;
      finalBattleRoyaleLeaderboardEnabled = undefined;
      finalBattleRoyaleLeaderboardShare = undefined;
    } else if (nextGameType === "mystery") {
      finalMaxEntries = 1;
      finalReentryRate = undefined;
      finalBountyFraction = nextBountyFraction ?? 0.5;
      finalMysteryBountyVariance = nextMysteryBountyVariance ?? 2.0;
      finalPkoHeadVar = undefined;
      finalPkoHeat = undefined;
      finalBattleRoyaleLeaderboardEnabled = undefined;
      finalBattleRoyaleLeaderboardShare = undefined;
    } else if (nextGameType === "mystery-royale") {
      finalMaxEntries = 1;
      finalReentryRate = undefined;
      finalBountyFraction = nextBountyFraction ?? 0.5;
      finalMysteryBountyVariance = nextMysteryBountyVariance ?? 1.8;
      finalPkoHeadVar = undefined;
      finalPkoHeat = undefined;
      finalBattleRoyaleLeaderboardEnabled =
        nextBattleRoyaleLeaderboardEnabled ?? false;
      finalBattleRoyaleLeaderboardShare =
        finalBattleRoyaleLeaderboardEnabled
          ? normalizeBattleRoyaleLeaderboardShare(
              nextBattleRoyaleLeaderboardShare,
            )
          : undefined;
    }
    const effectiveBattleRoyaleRow =
      nextGameType === "mystery-royale" ||
      nextPayoutStructure === "battle-royale";
    if (!effectiveBattleRoyaleRow) {
      finalBattleRoyaleLeaderboardEnabled = undefined;
      finalBattleRoyaleLeaderboardShare = undefined;
    }
    const nextFinishBuckets = normalizePersistedFinishBuckets(
      row.finishBuckets,
      nextItmRate,
    );
    const nextCustom = normalizePersistedCustomPayouts({
      ...row,
      gameType: nextGameType,
      payoutStructure: nextPayoutStructure,
    }, nextPlayers);
    const nextFieldVariability = normalizePersistedFieldVariability(
      row.fieldVariability,
    );
    const nextCount = clampPersistedCount(row.count);
    if (
      nextGameType === row.gameType &&
      nextPlayers === row.players &&
      nextBuyIn === row.buyIn &&
      nextRake === row.rake &&
      nextRoi === row.roi &&
      nextGuarantee === row.guarantee &&
      nextLateRegMultiplier === row.lateRegMultiplier &&
      nextItmRate === row.itmRate &&
      finalMaxEntries === row.maxEntries &&
      finalReentryRate === row.reentryRate &&
      finalBountyFraction === row.bountyFraction &&
      nextBountyEvBias === row.bountyEvBias &&
      nextPayJumpAggression === row.payJumpAggression &&
      nextItmTopHeavyBias === row.itmTopHeavyBias &&
      finalMysteryBountyVariance === row.mysteryBountyVariance &&
      finalPkoHeadVar === row.pkoHeadVar &&
      finalPkoHeat === row.pkoHeat &&
      finalBattleRoyaleLeaderboardEnabled ===
        row.battleRoyaleLeaderboardEnabled &&
      finalBattleRoyaleLeaderboardShare === row.battleRoyaleLeaderboardShare &&
      nextSitThroughPayJumps === row.sitThroughPayJumps &&
      nextFinishBuckets === row.finishBuckets &&
      nextCustom.payoutStructure === row.payoutStructure &&
      nextCustom.customPayouts === row.customPayouts &&
      nextCount === row.count &&
      nextFieldVariability === row.fieldVariability
    ) {
      return row;
    }
    changed = true;
    return {
      ...row,
      gameType: nextGameType,
      players: nextPlayers,
      buyIn: nextBuyIn,
      rake: nextRake,
      roi: nextRoi,
      guarantee: nextGuarantee,
      lateRegMultiplier: nextLateRegMultiplier,
      itmRate: nextItmRate,
      maxEntries: finalMaxEntries,
      reentryRate: finalReentryRate,
      bountyFraction: finalBountyFraction,
      bountyEvBias: nextBountyEvBias,
      payJumpAggression: nextPayJumpAggression,
      itmTopHeavyBias: nextItmTopHeavyBias,
      mysteryBountyVariance: finalMysteryBountyVariance,
      pkoHeadVar: finalPkoHeadVar,
      pkoHeat: finalPkoHeat,
      battleRoyaleLeaderboardEnabled: finalBattleRoyaleLeaderboardEnabled,
      battleRoyaleLeaderboardShare: finalBattleRoyaleLeaderboardShare,
      sitThroughPayJumps: nextSitThroughPayJumps,
      finishBuckets: nextFinishBuckets,
      payoutStructure: nextCustom.payoutStructure,
      customPayouts: nextCustom.customPayouts,
      fieldVariability: nextFieldVariability,
      count: nextCount,
    };
  });
  const controls = normalizePersistedControls(state.controls);
  if (controls !== state.controls) changed = true;
  return changed ? { ...state, schedule, controls } : state;
}

export function encodeState(state: PersistedState): string {
  return compressToEncodedURIComponent(JSON.stringify(state));
}

export function decodeState(encoded: string): PersistedState | null {
  try {
    const json = decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    const parsed = JSON.parse(json);
    if (isPersistedState(parsed)) {
      warnOnBrMrDrift(parsed.schedule, "decodeState");
      return normalizePersistedState(parsed);
    }
    return null;
  } catch {
    return null;
  }
}

export function saveLocal(state: PersistedState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    // ignore quota / SSR
  }
}

export function loadLocal(): PersistedState | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (isPersistedState(parsed)) {
      warnOnBrMrDrift(parsed.schedule, "loadLocal");
      return normalizePersistedState(parsed);
    }
    return null;
  } catch {
    return null;
  }
}

export function loadFromUrlHash(): PersistedState | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#s=/, "");
  if (!hash) return null;
  return decodeState(hash);
}

// User-defined presets — saved schedules + controls, named by the user.
export interface UserPreset {
  id: string;
  name: string;
  createdAt: number;
  state: PersistedState;
}

const PRESETS_KEY = "tvs:user-presets";

export function isValidUserPreset(v: unknown): v is UserPreset {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string") return false;
  if (typeof o.name !== "string") return false;
  if (typeof o.createdAt !== "number") return false;
  return isPersistedState(o.state);
}

export function loadUserPresets(): UserPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const safe = parsed.filter(isValidUserPreset);
    return safe.map((preset) => {
      warnOnBrMrDrift(preset.state.schedule, `preset "${preset.name}"`);
      const state = normalizePersistedState(preset.state);
      return state === preset.state ? preset : { ...preset, state };
    });
  } catch {
    return [];
  }
}

export function saveUserPresets(presets: UserPreset[]) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets.filter(isValidUserPreset)));
  } catch {
    // ignore quota
  }
}

export function addUserPreset(name: string, state: PersistedState): UserPreset {
  const preset: UserPreset = {
    id: `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim() || "Untitled",
    createdAt: Date.now(),
    state,
  };
  const all = loadUserPresets();
  all.push(preset);
  saveUserPresets(all);
  return preset;
}

export function removeUserPreset(id: string) {
  saveUserPresets(loadUserPresets().filter((p) => p.id !== id));
}

export function buildShareUrl(state: PersistedState): string {
  if (typeof window === "undefined") return "";
  const enc = encodeState(state);
  const url = new URL(window.location.href);
  url.hash = `s=${enc}`;
  return url.toString();
}
