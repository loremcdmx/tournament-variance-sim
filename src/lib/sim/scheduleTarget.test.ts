import { describe, expect, it } from "vitest";
import type { TournamentRow } from "./types";
import {
  countScheduleTournaments,
  redistributeScheduleCounts,
} from "./scheduleTarget";

function row(id: string, count: number): TournamentRow {
  return {
    id,
    label: id,
    players: 18,
    buyIn: 10,
    rake: 0,
    roi: 0,
    payoutStructure: "battle-royale",
    count,
  };
}

describe("schedule target helpers", () => {
  it("counts schedule tournaments with the same integer floor used by the engine", () => {
    expect(countScheduleTournaments([row("a", 2.9), row("b", 0)])).toBe(3);
  });

  it("lets a session target shrink a single huge row below the previous pass size", () => {
    const next = redistributeScheduleCounts([row("br", 10_000)], 1_000);

    expect(next).toHaveLength(1);
    expect(next[0].count).toBe(1_000);
    expect(countScheduleTournaments(next)).toBe(1_000);
  });

  it("preserves the row mix while hitting the requested total exactly", () => {
    const next = redistributeScheduleCounts([row("a", 3), row("b", 1)], 8);

    expect(next.map((r) => r.count)).toEqual([6, 2]);
    expect(countScheduleTournaments(next)).toBe(8);
  });

  it("keeps every row playable when target is smaller than row count", () => {
    const next = redistributeScheduleCounts(
      [row("a", 100), row("b", 50), row("c", 25)],
      1,
    );

    expect(next.map((r) => r.count)).toEqual([1, 1, 1]);
    expect(countScheduleTournaments(next)).toBe(3);
  });

  it("allocates exactly at the safe-integer boundary without rounding overflow", () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const next = redistributeScheduleCounts([row("a", maximum), row("b", maximum)], maximum);
    expect(next.map((entry) => entry.count)).toEqual([4503599627370496, 4503599627370495]);
    expect(countScheduleTournaments(next)).toBe(maximum);
    expect(redistributeScheduleCounts([row("a", 1)], 1e308)[0].count).toBe(maximum);
  });

  it("returns the counts untouched when the target is the current total", () => {
    const counts = [40, 20, 10, 25, 12, 6, 20, 10, 5, 30, 15, 7, 30, 15, 7, 1, 1];
    const schedule = counts.map((c, i) => row(`r${i}`, c));
    const total = countScheduleTournaments(schedule);
    expect(total).toBe(254);
    expect(redistributeScheduleCounts(schedule, total).map((r) => r.count)).toEqual(counts);
    expect(redistributeScheduleCounts([1, 1, 1, 97].map((c, i) => row(`s${i}`, c)), 100).map((r) => r.count))
      .toEqual([1, 1, 1, 97]);
  });

  it("moves one tournament onto the largest row, not onto the single-entry rows", () => {
    const counts = [40, 20, 10, 25, 12, 6, 20, 10, 5, 30, 15, 7, 30, 15, 7, 1, 1];
    const next = redistributeScheduleCounts(counts.map((c, i) => row(`r${i}`, c)), 255);
    expect(next.map((r) => r.count)).toEqual([41, ...counts.slice(1)]);
  });

  it("scales a mix whose shares are not whole by largest remainder, keeping every row and the total", () => {
    const schedule = [row("a", 5), row("b", 3), row("c", 1), row("d", 1)];
    const next = redistributeScheduleCounts(schedule, 25);
    // Exact shares 12.5 / 7.5 / 2.5 / 2.5: the two largest remainders go to the first rows.
    expect(next.map((r) => r.count)).toEqual([13, 8, 2, 2]);
    expect(countScheduleTournaments(next)).toBe(25);
  });

  it("holds a row whose share rounds below 1 at one and splits the rest", () => {
    const next = redistributeScheduleCounts([row("a", 1), row("b", 1), row("c", 98)], 10);
    expect(next.map((r) => r.count)).toEqual([1, 1, 8]);
    expect(countScheduleTournaments(next)).toBe(10);
  });

  it("re-pins a row that the first pins push under 1", () => {
    // At target 20 the first row's exact share is 1.08. The five single-entry
    // rows (0.18 each) pin first and leave 15 for 106 of weight, which drops
    // the first row's share to 0.85, so it pins too.
    const next = redistributeScheduleCounts(
      [6, 1, 1, 1, 1, 1, 100].map((c, i) => row(`p${i}`, c)),
      20,
    );
    expect(next.map((r) => r.count)).toEqual([1, 1, 1, 1, 1, 1, 14]);
    expect(countScheduleTournaments(next)).toBe(20);
  });

  it("always hits the target exactly and keeps every row at 1 or more", () => {
    const weights = [1, 2, 3, 5, 8, 13, 40, 77];
    for (let target = weights.length; target < 200; target++) {
      const next = redistributeScheduleCounts(weights.map((c, i) => row(`w${i}`, c)), target);
      expect(countScheduleTournaments(next)).toBe(target);
      for (const r of next) expect(r.count).toBeGreaterThanOrEqual(1);
    }
  });
});
