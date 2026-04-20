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
});
