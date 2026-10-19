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
