/**
 * Game-type presets for tournament rows. `inferGameType` reads a row's
 * current flags (re-entry, bounty) and picks the closest canonical
 * preset; `applyGameType` flips the flags to match a chosen preset.
 * Pure data + small helpers — no side effects, no RNG.
 */
import type { GameType, TournamentRow } from "./types";

export const GAME_TYPE_ORDER: GameType[] = [
  "freezeout",
  "pko",
  "mystery",
  "mystery-royale",
];

/**
 * Infer a row's game type from its underlying fields. Used for legacy
 * rows (no explicit `gameType`) and for presets imported before this
 * attribute existed. The inference is deterministic:
 *   - explicit `gameType` wins
 *   - `payoutStructure === "battle-royale"`     → mystery-royale
 *   - `payoutStructure === "mtt-gg-mystery"`    → mystery
 *   - `payoutStructure === "mtt-gg-bounty"`     → pko
 *   - bountyFraction > 0 + mystery variance > 0 → mystery
 *   - bountyFraction > 0                         → pko
 *   - maxEntries > 1                             → freezeout-reentry
 *   - else                                       → freezeout
 *
 * Mystery-royale is never inferred from variance alone: regular Mystery uses
 * σ²=2.0, so the old `mysteryBountyVariance >= 1.4` heuristic misrouted plain
 * Mystery rows into Battle Royale.
 */
export function inferGameType(row: TournamentRow): GameType {
  if (row.gameType) return row.gameType;
  if (row.payoutStructure === "battle-royale") return "mystery-royale";
  if (row.payoutStructure === "mtt-gg-mystery") return "mystery";
  if (row.payoutStructure === "mtt-gg-bounty") return "pko";
  const bounty = row.bountyFraction ?? 0;
  if (bounty > 0) {
    const v = row.mysteryBountyVariance ?? 0;
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
/**
 * Normalize the gameType ↔ payoutStructure invariant. Mystery Battle Royale
 * format is keyed on two flags that MUST agree: `gameType === "mystery-royale"`
 * gates the FT-window harmonic KO accumulator (engine.ts top-9 window), while
 * `payoutStructure === "battle-royale"` gates the discrete envelope-tier
 * sampler. Legacy rows (pre-gameType column, manual JSON edits, old
 * localStorage) can drift — silently fix at compile boundary so both hot-loop
 * branches see consistent state.
 *
 * Precedence (matches `inferGameType` and `convergencePolicy.inferRowFormat`):
 * **explicit `gameType` wins**. A row with an explicit non-MBR `gameType`
 * plus a drifted `payoutStructure="battle-royale"` gets the payout corrected
 * to its format's engine default — we do NOT upgrade the user's explicit
 * Mystery/PKO/etc. into MBR. Only when `gameType` is absent (legacy rows,
 * old localStorage) does `payoutStructure="battle-royale"` upgrade the row
 * to MBR. Returns the row unchanged if already in sync or nothing to fix.
 */
export function normalizeBrMrConsistency(row: TournamentRow): TournamentRow {
  const isBR = row.payoutStructure === "battle-royale";
  const isMR = row.gameType === "mystery-royale";
  // gameType === "mystery-royale" is authoritative — correct drifted payout.
  if (isMR && !isBR) return { ...row, payoutStructure: "battle-royale" };
  // Explicit non-MBR gameType + BR payout → user wanted non-MBR; correct the
  // drifted payout to its format's engine default. `gameType === "mystery"`
  // maps to "mtt-gg-mystery" (engine's non-BR mystery path); PKO / freezeouts
  // use "mtt-gg-bounty" / "mtt-standard" per applyGameType defaults.
  if (isBR && row.gameType && !isMR) {
    const payout =
      row.gameType === "mystery"
        ? "mtt-gg-mystery"
        : row.gameType === "pko"
          ? "mtt-gg-bounty"
          : "mtt-standard";
    return { ...row, payoutStructure: payout };
  }
  // Legacy: no explicit gameType + BR payout → upgrade to MBR. This is the
  // only case where payoutStructure drives gameType (backwards-compat for
  // rows saved before the `gameType` column existed).
  if (isBR && !row.gameType) {
    return { ...row, gameType: "mystery-royale" };
  }
  return row;
}

export function applyGameType(
  row: TournamentRow,
  next: GameType,
): Partial<TournamentRow> {
  const patch: Partial<TournamentRow> = { gameType: next };
  const bounty = row.bountyFraction ?? 0;
  const snapAfs = (min: number) => {
    if ((row.players ?? 0) < min) patch.players = min;
  };

  switch (next) {
    case "freezeout":
      patch.maxEntries = 1;
      patch.reentryRate = undefined;
      patch.bountyFraction = undefined;
      patch.mysteryBountyVariance = undefined;
      patch.payoutStructure = "mtt-standard";
      snapAfs(30);
      break;
    case "freezeout-reentry":
      patch.maxEntries = Math.max(2, row.maxEntries ?? 2);
      patch.reentryRate = row.reentryRate ?? 1;
      patch.bountyFraction = undefined;
      patch.mysteryBountyVariance = undefined;
      patch.payoutStructure = "mtt-standard";
      snapAfs(30);
      break;
    case "pko":
      patch.maxEntries = 1;
      patch.reentryRate = undefined;
      patch.bountyFraction = bounty > 0 ? bounty : 0.5;
      patch.mysteryBountyVariance = undefined;
      patch.pkoHeadVar = row.pkoHeadVar ?? 0.4;
      patch.payoutStructure = "mtt-gg-bounty";
      snapAfs(500);
      break;
    case "mystery":
      patch.maxEntries = 1;
      patch.reentryRate = undefined;
      patch.bountyFraction = bounty > 0 ? bounty : 0.5;
      // σ² = 2.0 is a stopgap — log-normal structurally can't match GG's
      // real envelope distribution (jackpot tier ~10000× mean w/ prob ~6e-7,
      // see #92's scraped BR tiers), but σ² = 2.0 gives P(X > 100×mean) ≈
      // 3.7e-5 which aligns with BR's empirical 4.5e-5. Previous σ² = 0.8
      // gave P(>100×) = 1e-8 — effectively zero jackpot tail. When real
      // non-BR Mystery tier data lands, switch to discrete-tier draw like BR.
      patch.mysteryBountyVariance = 2.0;
      patch.payoutStructure = "mtt-gg-mystery";
      snapAfs(500);
      break;
    case "mystery-royale":
      patch.maxEntries = 1;
      patch.reentryRate = undefined;
      patch.bountyFraction = bounty > 0 ? bounty : 0.5;
      patch.mysteryBountyVariance = 1.8;
      patch.rake = 0.08;
      patch.buyIn = 10 / 1.08;
      patch.roi = 0.03;
      // Skill-adjusted ITM: structural 3/18 = 16.7 % is the field average.
      // A reg edges it up modestly (≈1–2 pp) by surviving the FT bubble
      // more often than random — the SNG structure caps the ceiling, so
      // this bump is smaller than in MTTs where paid% itself flexes.
      patch.itmRate = 0.18;
      patch.players = 18;
      patch.payoutStructure = "battle-royale";
      break;
  }
  return patch;
}
