import type { TournamentRow } from "./types";

export function countScheduleTournaments(schedule: TournamentRow[]): number {
  return schedule.reduce((a, r) => a + Math.max(1, Math.floor(r.count)), 0);
}

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
  const weightTotal = weights.reduce((a, b) => a + b, BigInt(0));
  const remaining = BigInt(target - schedule.length);

  const rows = weights.map((weight, idx) => {
    const numerator = remaining * weight;
    const extra = Number(numerator / weightTotal);
    return {
      idx,
      count: 1 + extra,
      frac: numerator % weightTotal,
    };
  });

  let allocated = rows.reduce((a, r) => a + r.count, 0);
  rows
    .slice()
    .sort((a, b) => a.frac === b.frac ? a.idx - b.idx : a.frac > b.frac ? -1 : 1)
    .slice(0, target - allocated)
    .forEach((r) => {
      rows[r.idx].count += 1;
      allocated += 1;
    });

  return schedule.map((row, idx) => ({
    ...row,
    count: rows[idx].count,
  }));
}
