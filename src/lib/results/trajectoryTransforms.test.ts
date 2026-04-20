import { describe, expect, it } from "vitest";
import { computeExpectedRakebackCurve, reentryExpectedClient } from "./trajectoryTransforms";
import type { TournamentRow } from "@/lib/sim/types";

function makeRow(overrides: Partial<TournamentRow>): TournamentRow {
  return {
    id: "row",
    players: 100,
    buyIn: 100,
    rake: 0.1,
    roi: 0.1,
    payoutStructure: "mtt-standard",
    count: 1,
    ...overrides,
  };
}

describe("reentryExpectedClient", () => {
  it("matches the capped geometric closed form", () => {
    expect(reentryExpectedClient(1, 0.5)).toBe(0);
    expect(reentryExpectedClient(2, 0.5)).toBeCloseTo(0.5);
    expect(reentryExpectedClient(4, 1)).toBe(3);
    expect(reentryExpectedClient(4, 0)).toBe(0);
  });
});

describe("computeExpectedRakebackCurve", () => {
  it("tracks heterogeneous schedules in engine order", () => {
    const schedule: TournamentRow[] = [
      makeRow({ id: "a", count: 1, buyIn: 100, rake: 0.1 }),
      makeRow({
        id: "b",
        count: 2,
        buyIn: 50,
        rake: 0.1,
        maxEntries: 2,
        reentryRate: 0.5,
      }),
    ];

    const curve = computeExpectedRakebackCurve(
      schedule,
      2,
      0.5,
      [0, 1, 2, 3, 4],
    );

    expect(curve).not.toBeNull();
    expect(Array.from(curve ?? [])).toEqual([0, 5, 8.75, 12.5, 17.5]);
  });

  it("returns null when rakeback is disabled", () => {
    const curve = computeExpectedRakebackCurve(
      [makeRow({ id: "a" })],
      1,
      0,
      [0, 1],
    );
    expect(curve).toBeNull();
  });
});
