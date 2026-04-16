/**
 * Game-type presets for tournament rows. `inferGameType` reads a row's
 * current flags (re-entry, bounty, ICM) and picks the closest canonical
 * preset; `applyGameType` flips the flags to match a chosen preset.
 * Pure data + small helpers — no side effects, no RNG.
 */
import type { GameType, TournamentRow } from "./types";

export const GAME_TYPE_ORDER: GameType[] = [
  "freezeout",
  "freezeout-reentry",
  "pko",
  "mystery",
  "mystery-royale",
];

/**
 * Infer a row's game type from its underlying fields. Used for legacy
 * rows (no explicit `gameType`) and for presets imported before this
 * attribute existed. The inference is deterministic:
 *   - bountyFraction > 0 + mysteryBountyVariance ≥ 1.4 → mystery-royale
 *   - bountyFraction > 0 + mysteryBountyVariance >  0  → mystery
 *   - bountyFraction > 0                               → pko
 *   - maxEntries > 1                                   → freezeout-reentry
 *   - else                                             → freezeout
 */
export function inferGameType(row: TournamentRow): GameType {
  if (row.gameType) return row.gameType;
  const bounty = row.bountyFraction ?? 0;
  if (bounty > 0) {
    const v = row.mysteryBountyVariance ?? 0;
    if (v >= 1.4) return "mystery-royale";
    if (v > 0) return "mystery";
    return "pko";
  }
  if ((row.maxEntries ?? 1) > 1) return "freezeout-reentry";
  return "freezeout";
}

/**
 * Apply a game-type change to a row, rewriting the underlying engine
 * fields (maxEntries, reentryRate, bountyFraction, mysteryBountyVariance)
 * to sensible defaults for the chosen format. Caller merges the returned
 * patch into the row.
 *
 * Defaults chosen to match what a typical online grinder would see:
 *   - PKO: 50 % of prize pool in the bounty pool.
 *   - Mystery: 50 % bounty, σ² = 0.8 (moderate right tail).
 *   - Mystery royale: 50 % bounty, σ² = 1.8 (jackpot-tier tail).
 *   - Freezeout-reentry: maxEntries=2, reentryRate=1 (always re-enter).
 *
 * Existing values that the new format *still uses* are preserved when
 * possible (e.g. switching between mystery ↔ mystery-royale keeps the
 * current bountyFraction), so the user's manual tweaks survive.
 */
export function applyGameType(
  row: TournamentRow,
  next: GameType,
): Partial<TournamentRow> {
  const patch: Partial<TournamentRow> = { gameType: next };
  const bounty = row.bountyFraction ?? 0;

  switch (next) {
    case "freezeout":
      patch.maxEntries = 1;
      patch.reentryRate = undefined;
      patch.bountyFraction = undefined;
      patch.mysteryBountyVariance = undefined;
      break;
    case "freezeout-reentry":
      patch.maxEntries = Math.max(2, row.maxEntries ?? 2);
      patch.reentryRate = row.reentryRate ?? 1;
      patch.bountyFraction = undefined;
      patch.mysteryBountyVariance = undefined;
      break;
    case "pko":
      patch.bountyFraction = bounty > 0 ? bounty : 0.5;
      patch.mysteryBountyVariance = undefined;
      patch.pkoHeadVar = row.pkoHeadVar ?? 0.4;
      break;
    case "mystery":
      patch.bountyFraction = bounty > 0 ? bounty : 0.5;
      patch.mysteryBountyVariance = 0.8;
      break;
    case "mystery-royale":
      patch.bountyFraction = bounty > 0 ? bounty : 0.5;
      patch.mysteryBountyVariance = 1.8;
      break;
  }
  return patch;
}
