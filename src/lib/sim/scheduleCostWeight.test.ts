import { describe, it, expect } from "vitest";
import { scheduleCostWeight } from "./useSimulation";

describe("scheduleCostWeight — per-format cost weighting for ETA estimates", () => {
  it("freezeout schedule: weight equals row count exactly", () => {
    expect(
      scheduleCostWeight([{ count: 5, gameType: "freezeout" }]),
    ).toBe(5);
  });

  it("undefined gameType defaults to freezeout (1.0×)", () => {
    expect(scheduleCostWeight([{ count: 3 }])).toBe(3);
  });

  it("PKO row contributes 1.35× per count", () => {
    expect(scheduleCostWeight([{ count: 10, gameType: "pko" }])).toBeCloseTo(13.5, 9);
  });

  it("Mystery row contributes 1.10× per count", () => {
    expect(scheduleCostWeight([{ count: 10, gameType: "mystery" }])).toBeCloseTo(11.0, 9);
  });

  it("MBR row contributes 1.30× per count", () => {
    expect(scheduleCostWeight([{ count: 10, gameType: "mystery-royale" }])).toBeCloseTo(13.0, 9);
  });

  it("freezeout-reentry treated same as freezeout (re-entry is its own dim)", () => {
    expect(scheduleCostWeight([{ count: 5, gameType: "freezeout-reentry" }])).toBe(5);
  });

  it("mixed schedule sums each row's weighted contribution", () => {
    // freeze 4 + pko 2×1.35 + mystery 1×1.10 = 4 + 2.7 + 1.1 = 7.8
    expect(
      scheduleCostWeight([
        { count: 4, gameType: "freezeout" },
        { count: 2, gameType: "pko" },
        { count: 1, gameType: "mystery" },
      ]),
    ).toBeCloseTo(7.8, 9);
  });

  it("count=0 still contributes 1× (Math.max(1, …) prevents zero-out)", () => {
    // A row with count=0 is unusual but the fallback ensures the schedule
    // never collapses to weight=0 (which would make work-units degenerate).
    expect(scheduleCostWeight([{ count: 0, gameType: "freezeout" }])).toBe(1);
  });

  it("clamps total to ≥1 even on empty schedule", () => {
    expect(scheduleCostWeight([])).toBe(1);
  });

  it("PKO-heavy vs freeze-only schedule diff is ~35 % at equal count", () => {
    const freeze = scheduleCostWeight([{ count: 100, gameType: "freezeout" }]);
    const pko = scheduleCostWeight([{ count: 100, gameType: "pko" }]);
    const ratio = pko / freeze;
    expect(ratio).toBeCloseTo(1.35, 6);
  });

  it("mixed PKO+Mystery vs all-freeze: weight reflects bounty cost properly", () => {
    const allFreeze = scheduleCostWeight([
      { count: 50, gameType: "freezeout" },
      { count: 50, gameType: "freezeout" },
    ]);
    const mixed = scheduleCostWeight([
      { count: 50, gameType: "pko" },
      { count: 50, gameType: "mystery" },
    ]);
    expect(allFreeze).toBe(100);
    expect(mixed).toBeCloseTo(50 * 1.35 + 50 * 1.10, 9); // 122.5
    expect(mixed / allFreeze).toBeCloseTo(1.225, 6);
  });
});
