import type { TournamentRow } from "./types";

export function countScheduleTournaments(schedule: TournamentRow[]): number {
  return schedule.reduce((a, r) => a + Math.max(1, Math.floor(r.count)), 0);
}

/**
 * Rescales the rows to `targetTournaments` per pass, keeping the row mix: each
 * row gets its share of the target by largest remainder, so a target equal to
 * the current total returns the counts untouched. Every row still plays at
 * least once; a row whose share rounds below 1 is held at 1 and the rest split
 * what is left, which can pull the shares of the others down slightly.
 */
export function redistributeScheduleCounts(
  schedule: TournamentRow[],
  targetTournaments: number,
): TournamentRow[] {
  if (schedule.length === 0) return schedule;

  const currentTotal = countScheduleTournaments(schedule);
  const target = Math.max(
    schedule.length,
    Math.min(Number.MAX_SAFE_INTEGER,
      Math.floor(Number.isFinite(targetTournaments) ? targetTournaments : currentTotal)),
  );
  // Exact largest remainders also work at the safe-integer boundary, where
  // floating-point products can otherwise allocate one tournament too many.
  const weights = schedule.map((r) => BigInt(Math.max(1,
    Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number.isFinite(r.count) ? r.count : 1)))));
  const one = BigInt(1);

  // A row whose exact share is under 1 is pinned at 1. That takes more than
  // its share, which can push another row's share under 1, so repeat until no
  // row moves; each pass only grows the pinned set.
  const pinned = schedule.map(() => false);
  let free = BigInt(target);
  let freeWeight = weights.reduce((a, b) => a + b, BigInt(0));
  for (let moved = true; moved; ) {
    moved = false;
    weights.forEach((weight, idx) => {
      if (pinned[idx] || free * weight >= freeWeight) return;
      pinned[idx] = true;
      free -= one;
      freeWeight -= weight;
      moved = true;
    });
  }

  const rows = weights.map((weight, idx) => {
    if (pinned[idx]) return { idx, count: 1, frac: BigInt(0) };
    const numerator = free * weight;
    return {
      idx,
      count: Number(numerator / freeWeight),
      frac: numerator % freeWeight,
    };
  });

  const allocated = rows.reduce((a, r) => a + r.count, 0);
  rows
    .slice()
    .sort((a, b) => a.frac === b.frac ? a.idx - b.idx : a.frac > b.frac ? -1 : 1)
    .slice(0, target - allocated)
    .forEach((r) => {
      rows[r.idx].count += 1;
    });

  return schedule.map((row, idx) => ({
    ...row,
    count: rows[idx].count,
  }));
}
