import { describe, it, expect } from "vitest";
import {
  applyItmTarget,
  isItmTargetActive,
  resolveItmTarget,
} from "./itmTarget";
import type { TournamentRow } from "./types";

const baseRow: TournamentRow = {
  id: "r1",
  players: 500,
  buyIn: 25,
  rake: 0.1,
  roi: 0.1,
  payoutStructure: "mtt-standard",
  gameType: "freezeout",
  count: 1,
};

describe("resolveItmTarget", () => {
  it("returns null when disabled", () => {
    expect(resolveItmTarget({ enabled: false, pct: 18 })).toBeNull();
  });

  it("returns null for non-finite input", () => {
    expect(resolveItmTarget({ enabled: true, pct: NaN })).toBeNull();
  });

  it("returns null for non-positive fractions", () => {
    expect(resolveItmTarget({ enabled: true, pct: 0 })).toBeNull();
    expect(resolveItmTarget({ enabled: true, pct: -5 })).toBeNull();
  });

  it("converts whole-number percent to fraction", () => {
    expect(resolveItmTarget({ enabled: true, pct: 18.7 })).toBeCloseTo(0.187, 9);
  });

  it("clamps below to 0.005 to leave OOTM headroom", () => {
    expect(resolveItmTarget({ enabled: true, pct: 0.1 })).toBe(0.005);
  });

  it("clamps above to 0.99", () => {
    expect(resolveItmTarget({ enabled: true, pct: 120 })).toBe(0.99);
  });
});

describe("isItmTargetActive", () => {
  it("tracks resolveItmTarget", () => {
    expect(isItmTargetActive({ enabled: false, pct: 18 })).toBe(false);
    expect(isItmTargetActive({ enabled: true, pct: 0 })).toBe(false);
    expect(isItmTargetActive({ enabled: true, pct: 18 })).toBe(true);
  });
});

describe("applyItmTarget", () => {
  it("no-ops when target is null (disabled or invalid)", () => {
    const schedule = [baseRow];
    expect(applyItmTarget(schedule, { enabled: false, pct: 18 })).toBe(schedule);
  });

  it("stamps itmRate on every row and clears finishBuckets", () => {
    const schedule: TournamentRow[] = [
      { ...baseRow, id: "a" },
      { ...baseRow, id: "b", itmRate: 0.05, finishBuckets: { first: 0.01 } },
    ];
    const result = applyItmTarget(schedule, { enabled: true, pct: 20 });
    expect(result).not.toBe(schedule);
    expect(result[0].itmRate).toBe(0.20);
    expect(result[1].itmRate).toBe(0.20);
    expect(result[0].finishBuckets).toBeUndefined();
    expect(result[1].finishBuckets).toBeUndefined();
  });

  it("row-level value always loses to the global when enabled", () => {
    const schedule = [{ ...baseRow, itmRate: 0.35 }];
    const result = applyItmTarget(schedule, { enabled: true, pct: 12 });
    expect(result[0].itmRate).toBe(0.12);
  });
});
