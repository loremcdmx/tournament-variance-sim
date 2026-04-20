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
    Math.floor(Number.isFinite(targetTournaments) ? targetTournaments : currentTotal),
  );
  const weights = schedule.map((r) => Math.max(1, Math.floor(r.count)));
  const weightTotal = weights.reduce((a, b) => a + b, 0) || weights.length;
  const remaining = target - schedule.length;

  const rows = weights.map((weight, idx) => {
    const rawExtra = remaining * (weight / weightTotal);
    const extra = Math.floor(rawExtra);
    return {
      idx,
      count: 1 + extra,
      frac: rawExtra - extra,
    };
  });

  let allocated = rows.reduce((a, r) => a + r.count, 0);
  rows
    .slice()
    .sort((a, b) => b.frac - a.frac || a.idx - b.idx)
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
