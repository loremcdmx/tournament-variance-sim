import type { BattleRoyaleLeaderboardPayoutTier } from "./types";

export type BattleRoyaleStake = 0.25 | 1 | 3 | 10 | 25;

export const CURRENT_BATTLE_ROYALE_TOURNAMENTS_PER_HOUR_PER_TABLE = 3.3;
export const CURRENT_BATTLE_ROYALE_HAPPY_HOUR_MULTIPLIER = 2;
export const CURRENT_BATTLE_ROYALE_DAILY_WINDOW = {
  utcStartHour: 8,
  utcEndHourExclusive: 8,
} as const;

/**
 * Daily payout ladders transcribed from the current room-facing leaderboard
 * sources shared during the April 23, 2026 review. This file is a calibration
 * artifact for the next forecast phase; it is intentionally separate from the
 * currently shipped observed-only promo estimator.
 *
 * Two minor ambiguities remain in the shared source material:
 * - $1: the shared table implies rank 121 still pays $2 and ranks 122–241 pay
 *   $1. We encode it that way explicitly instead of flattening the boundary.
 * - $10: the shared table plus the room summary indicate the prize zone ends at
 *   rank 120. We therefore cap the final $10 band at 120.
 */
export const CURRENT_BATTLE_ROYALE_DAILY_PAYOUT_LADDERS: Record<
  BattleRoyaleStake,
  BattleRoyaleLeaderboardPayoutTier[]
> = {
  0.25: [
    { rankFrom: 1, rankTo: 1, prizeEach: 7.5 },
    { rankFrom: 2, rankTo: 2, prizeEach: 7 },
    { rankFrom: 3, rankTo: 3, prizeEach: 6.25 },
    { rankFrom: 4, rankTo: 4, prizeEach: 5.75 },
    { rankFrom: 5, rankTo: 5, prizeEach: 5.5 },
    { rankFrom: 6, rankTo: 6, prizeEach: 5 },
    { rankFrom: 7, rankTo: 7, prizeEach: 4.5 },
    { rankFrom: 8, rankTo: 8, prizeEach: 4 },
    { rankFrom: 9, rankTo: 9, prizeEach: 3.5 },
    { rankFrom: 10, rankTo: 10, prizeEach: 3 },
    { rankFrom: 11, rankTo: 16, prizeEach: 2.5 },
    { rankFrom: 17, rankTo: 25, prizeEach: 2 },
    { rankFrom: 26, rankTo: 40, prizeEach: 1.5 },
    { rankFrom: 41, rankTo: 80, prizeEach: 1.25 },
    { rankFrom: 81, rankTo: 120, prizeEach: 1 },
    { rankFrom: 121, rankTo: 200, prizeEach: 0.75 },
    { rankFrom: 201, rankTo: 220, prizeEach: 0.5 },
    { rankFrom: 221, rankTo: 350, prizeEach: 0.25 },
  ],
  1: [
    { rankFrom: 1, rankTo: 1, prizeEach: 20 },
    { rankFrom: 2, rankTo: 2, prizeEach: 18 },
    { rankFrom: 3, rankTo: 4, prizeEach: 16 },
    { rankFrom: 5, rankTo: 5, prizeEach: 14 },
    { rankFrom: 6, rankTo: 7, prizeEach: 12 },
    { rankFrom: 8, rankTo: 8, prizeEach: 10 },
    { rankFrom: 9, rankTo: 12, prizeEach: 8 },
    { rankFrom: 13, rankTo: 18, prizeEach: 6 },
    { rankFrom: 19, rankTo: 26, prizeEach: 5 },
    { rankFrom: 27, rankTo: 38, prizeEach: 4 },
    { rankFrom: 39, rankTo: 90, prizeEach: 3 },
    { rankFrom: 91, rankTo: 121, prizeEach: 2 },
    { rankFrom: 122, rankTo: 241, prizeEach: 1 },
  ],
  3: [
    { rankFrom: 1, rankTo: 1, prizeEach: 60 },
    { rankFrom: 2, rankTo: 2, prizeEach: 54 },
    { rankFrom: 3, rankTo: 3, prizeEach: 48 },
    { rankFrom: 4, rankTo: 5, prizeEach: 42 },
    { rankFrom: 6, rankTo: 7, prizeEach: 36 },
    { rankFrom: 8, rankTo: 9, prizeEach: 30 },
    { rankFrom: 10, rankTo: 11, prizeEach: 24 },
    { rankFrom: 12, rankTo: 16, prizeEach: 18 },
    { rankFrom: 17, rankTo: 21, prizeEach: 15 },
    { rankFrom: 22, rankTo: 37, prizeEach: 12 },
    { rankFrom: 38, rankTo: 60, prizeEach: 9 },
    { rankFrom: 61, rankTo: 90, prizeEach: 6 },
    { rankFrom: 91, rankTo: 200, prizeEach: 3 },
  ],
  10: [
    { rankFrom: 1, rankTo: 1, prizeEach: 150 },
    { rankFrom: 2, rankTo: 2, prizeEach: 130 },
    { rankFrom: 3, rankTo: 3, prizeEach: 120 },
    { rankFrom: 4, rankTo: 4, prizeEach: 110 },
    { rankFrom: 5, rankTo: 5, prizeEach: 100 },
    { rankFrom: 6, rankTo: 6, prizeEach: 90 },
    { rankFrom: 7, rankTo: 7, prizeEach: 80 },
    { rankFrom: 8, rankTo: 8, prizeEach: 70 },
    { rankFrom: 9, rankTo: 10, prizeEach: 60 },
    { rankFrom: 11, rankTo: 12, prizeEach: 50 },
    { rankFrom: 13, rankTo: 17, prizeEach: 40 },
    { rankFrom: 18, rankTo: 34, prizeEach: 30 },
    { rankFrom: 35, rankTo: 70, prizeEach: 20 },
    { rankFrom: 71, rankTo: 120, prizeEach: 10 },
  ],
  25: [
    { rankFrom: 1, rankTo: 1, prizeEach: 250 },
    { rankFrom: 2, rankTo: 2, prizeEach: 225 },
    { rankFrom: 3, rankTo: 3, prizeEach: 200 },
    { rankFrom: 4, rankTo: 4, prizeEach: 175 },
    { rankFrom: 5, rankTo: 5, prizeEach: 150 },
    { rankFrom: 6, rankTo: 7, prizeEach: 125 },
    { rankFrom: 8, rankTo: 8, prizeEach: 100 },
    { rankFrom: 9, rankTo: 14, prizeEach: 75 },
    { rankFrom: 15, rankTo: 40, prizeEach: 50 },
    { rankFrom: 41, rankTo: 100, prizeEach: 25 },
  ],
};
