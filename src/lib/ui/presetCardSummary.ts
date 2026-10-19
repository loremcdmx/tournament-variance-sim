import { countScheduleTournaments } from "@/lib/sim/scheduleTarget";
import type { TournamentRow } from "@/lib/sim/types";

// A buy-in is a price in cents; the Battle Royale ticket math leaves
// 2.7600000000000002 behind, which must not reach a label.
function trimCents(value: number): string {
  return String(Number(value.toFixed(2)));
}

export function buyInLabel(value: number): string {
  return `$${trimCents(value)}`;
}

export interface PresetCardSummary {
  /** Tournaments one simulated sample plays: what the controls panel reports once the preset loads. */
  total: number;
  range: string;
}

export function presetCardSummary(
  schedule: readonly Pick<TournamentRow, "count" | "buyIn">[],
  scheduleRepeats: number,
): PresetCardSummary {
  const perPass = countScheduleTournaments(schedule as TournamentRow[]);
  const total = perPass * Math.max(1, Math.floor(scheduleRepeats));
  if (schedule.length === 0) return { total, range: "" };
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of schedule) {
    if (row.buyIn < lo) lo = row.buyIn;
    if (row.buyIn > hi) hi = row.buyIn;
  }
  const range =
    trimCents(lo) === trimCents(hi)
      ? buyInLabel(lo)
      : `${buyInLabel(lo)}–${trimCents(hi)}`;
  return { total, range };
}
