/**
 * ResultHub GG Battle Royale lookup — pure parsing utilities.
 *
 * The runtime fetch lives in the Next.js API route (server-side proxy is
 * required because resulthub.org locks CORS). This module owns:
 *
 * - the stable stake-name mapping (`BR_0_25` → "0.25" used by the BR
 *   leaderboard observed controls);
 * - the parser that turns the raw API JSON into a normalized summary the
 *   UI can apply directly to `BattleRoyaleLeaderboardControls`;
 * - the date-range helper for "current calendar month so far", which is
 *   how GG Battle Royale leaderboards run.
 *
 * Endpoint shape (live as of 2026-04):
 *   GET https://resulthub.org/gg-network/leaderboard/api/v1
 *       /aggregate/result/player/game-type/stake
 *       ?name={username}&gameType=BATTLE_ROYALE&from=YYYY-MM-DD&to=YYYY-MM-DD
 * Response (verified):
 *   [{
 *     "gameType": {"name": "BATTLE_ROYALE", ...},
 *     "results": [
 *       {"totalPrize": 70, "totalPoints": 15698,
 *        "stake": {"name": "BR_10", "description": "$10"}},
 *       ...
 *     ]
 *   }]
 *
 * Tournament count is NOT exposed by this endpoint — the UI keeps that
 * field as manual input.
 */

import type { BattleRoyaleLeaderboardObservedPointsByStake } from "./types";

export const RESULTHUB_GG_BR_BASE =
  "https://resulthub.org/gg-network/leaderboard/api/v1";

/**
 * GG Battle Royale stake → BR leaderboard pts-by-stake key. The right-hand
 * side has to match the keys in `BattleRoyaleLeaderboardObservedPointsByStake`.
 */
export const STAKE_NAME_TO_KEY = {
  BR_0_25: "0.25",
  BR_1: "1",
  BR_3: "3",
  BR_10: "10",
  BR_25: "25",
} as const satisfies Record<
  string,
  keyof BattleRoyaleLeaderboardObservedPointsByStake
>;

export type StakeApiName = keyof typeof STAKE_NAME_TO_KEY;

export interface RawStakeResult {
  totalPrize: number;
  totalPoints: number;
  stake: { name: string; description?: string };
}

export interface RawGameTypeBlock {
  gameType: { name: string; description?: string };
  results: RawStakeResult[];
}

export interface ResulthubGgBrSummary {
  /** Sum of `totalPrize` across all BR stakes — fills `observedTotalPrizes`. */
  totalPrizes: number;
  /** Per-stake leaderboard points, keys aligned with `observedPointsByStake`. */
  pointsByStake: BattleRoyaleLeaderboardObservedPointsByStake;
  /** Echo of which window the lookup covered, for status display. */
  window: { from: string; to: string };
}

const ZERO_POINTS: BattleRoyaleLeaderboardObservedPointsByStake = {
  "0.25": 0,
  "1": 0,
  "3": 0,
  "10": 0,
  "25": 0,
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Parse the raw API response into a normalized summary, or null when it no
 * longer has the shape documented above (not an array, a non-empty answer
 * with no BATTLE_ROYALE block, `results` that is not a list, a row whose
 * stake name or totals are missing or not numbers). `[]` is not drift: it is
 * what ResultHub sends for a nick it has nothing on, and reads as no data.
 * An unknown stake name still counts toward the prize total; negative
 * numbers clamp to zero.
 */
export function parseGgBrStakeResponse(
  raw: unknown,
  window: { from: string; to: string },
): ResulthubGgBrSummary | null {
  if (!Array.isArray(raw)) return null;
  const points = { ...ZERO_POINTS };
  let totalPrizes = 0;
  let sawBattleRoyale = false;
  for (const block of raw as RawGameTypeBlock[]) {
    if (block?.gameType?.name !== "BATTLE_ROYALE") continue;
    sawBattleRoyale = true;
    if (!Array.isArray(block.results)) return null;
    for (const row of block.results) {
      const stakeName = row?.stake?.name;
      if (
        typeof stakeName !== "string" ||
        !isFiniteNumber(row.totalPrize) ||
        !isFiniteNumber(row.totalPoints)
      ) {
        return null;
      }
      totalPrizes += Math.max(0, row.totalPrize);
      if (stakeName in STAKE_NAME_TO_KEY) {
        points[STAKE_NAME_TO_KEY[stakeName as StakeApiName]] += Math.max(
          0,
          row.totalPoints,
        );
      }
    }
  }
  if (raw.length > 0 && !sawBattleRoyale) return null;
  return { totalPrizes, pointsByStake: points, window };
}

/**
 * All-time ISO date range, anchored to UTC. The API requires both
 * bounds, but accepts a generous span; we anchor `from` well before GG
 * Battle Royale launched (2020-01-01) so the response covers the full
 * recorded history of the requested nick. Returning the current
 * month-to-date used to under-count anyone with tournament volume in
 * earlier months — for the BR leaderboard observed model the user
 * cares about the cumulative profile, not just the running month.
 */
export function allTimeBrLeaderboardWindow(now: Date = new Date()): {
  from: string;
  to: string;
} {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const day = now.getUTCDate();
  const fmt = (yy: number, mm: number, dd: number) =>
    `${yy}-${String(mm + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  return { from: "2020-01-01", to: fmt(y, m, day) };
}

/**
 * Sanitize a username for the upstream API: strip control bytes, trim,
 * cap length. Mirrors `normalizeObservedResultHubUsername` so persisted
 * state and lookup state share one shape.
 */
export function sanitizeUsernameForLookup(value: string): string {
  let stripped = "";
  for (const ch of value) {
    const cp = ch.codePointAt(0);
    if (cp != null && cp >= 32 && cp !== 127) stripped += ch;
  }
  return stripped.trim().slice(0, 64);
}
