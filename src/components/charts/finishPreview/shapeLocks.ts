import type { TournamentRow } from "@/lib/sim/types";

type FinishLocks = NonNullable<TournamentRow["finishBuckets"]>;

// The shell solver pins a layer only when both of its cumulative boundaries
// are known, so P(top-3) on its own pins nothing: it needs P(1st) or P(FT) next
// to it.
export function isTop3LockAvailable(locks: FinishLocks | undefined): boolean {
  return locks?.first != null || locks?.ft != null;
}

/**
 * Row update for one edit of the shape panel's locks. The panel is fed the
 * effective row (ITM already filled in), but its patch lands on the raw row,
 * and applyItmTarget drops `finishBuckets` from any row without an explicit
 * ITM. A lock therefore carries the ITM the panel is showing, which makes the
 * raw row explicit. A Top-3 lock whose First and FT anchors were removed goes
 * with them.
 */
export function patchFinishLocks(
  row: Pick<TournamentRow, "finishBuckets" | "itmRate">,
  patch: Partial<FinishLocks>,
): Partial<TournamentRow> {
  const merged = { ...(row.finishBuckets ?? {}), ...patch };
  const cleaned: FinishLocks = {};
  if (merged.first != null) cleaned.first = merged.first;
  if (merged.top3 != null) cleaned.top3 = merged.top3;
  if (merged.ft != null) cleaned.ft = merged.ft;
  if (!isTop3LockAvailable(cleaned)) delete cleaned.top3;
  if (Object.keys(cleaned).length === 0) return { finishBuckets: undefined };
  return row.itmRate != null && row.itmRate > 0
    ? { finishBuckets: cleaned, itmRate: row.itmRate }
    : { finishBuckets: cleaned };
}

/**
 * `patchFinishLocks` makes an auto-ITM row explicit so its locks survive
 * `applyItmTarget`. Left that way, the row stops following the global ITM
 * target, its players and its payout for good. The caller keeps the stamped
 * value per row (in memory only, nothing persisted) and passes it back here: a
 * panel edit that removes the last lock also removes the stamp, but only while
 * the raw ITM is still exactly what was stamped. Any other ITM, whether typed
 * after the lock or there before it, is the user's and stays.
 */
export function reconcileLockItmStamp(
  raw: Pick<TournamentRow, "itmRate" | "finishBuckets">,
  updates: Partial<TournamentRow>,
  stamp: number | undefined,
): { updates: Partial<TournamentRow>; stamp: number | undefined } {
  if (updates.finishBuckets != null) {
    if (raw.itmRate == null) return { updates, stamp: updates.itmRate ?? undefined };
    return { updates, stamp: stamp === raw.itmRate ? stamp : undefined };
  }
  if ("finishBuckets" in updates && !("itmRate" in updates)) {
    const hadLocks = raw.finishBuckets != null && Object.keys(raw.finishBuckets).length > 0;
    if (hadLocks && stamp != null && raw.itmRate === stamp) {
      return { updates: { ...updates, itmRate: undefined }, stamp: undefined };
    }
    return { updates, stamp: undefined };
  }
  if ("itmRate" in updates) return { updates, stamp: undefined };
  return { updates, stamp };
}
