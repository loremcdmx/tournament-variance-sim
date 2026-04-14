import { describe, it, expect } from "vitest";
import { getPayoutTable, parsePayoutString } from "./payouts";
import type { PayoutStructureId } from "./types";

const STRUCTURES: PayoutStructureId[] = [
  "mtt-standard",
  "mtt-flat",
  "mtt-top-heavy",
  "mtt-pokerstars",
  "mtt-gg",
  "mtt-sunday-million",
  "mtt-gg-bounty",
  "satellite-ticket",
  "sng-50-30-20",
  "sng-65-35",
  "winner-takes-all",
];

describe("payout tables", () => {
  it.each(STRUCTURES)("%s sums to 1", (s) => {
    const table = getPayoutTable(s, 500);
    const sum = table.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 9);
  });

  it.each(STRUCTURES)("%s is monotonically non-increasing", (s) => {
    const table = getPayoutTable(s, 500);
    for (let i = 1; i < table.length; i++) {
      expect(table[i]).toBeLessThanOrEqual(table[i - 1] + 1e-12);
    }
  });

  it("top-heavy has a bigger 1st-place share than flat", () => {
    const topH = getPayoutTable("mtt-top-heavy", 500)[0];
    const flat = getPayoutTable("mtt-flat", 500)[0];
    expect(topH).toBeGreaterThan(flat);
  });

  it("satellite-ticket pays every seat equally", () => {
    const table = getPayoutTable("satellite-ticket", 500);
    expect(table.length).toBe(50); // 10% of 500
    for (let i = 1; i < table.length; i++) {
      expect(table[i]).toBeCloseTo(table[0], 12);
    }
  });
});

describe("parsePayoutString", () => {
  it("parses whitespace and commas", () => {
    expect(parsePayoutString("50 30 20")).toEqual([0.5, 0.3, 0.2]);
    expect(parsePayoutString("50,30,20")).toEqual([0.5, 0.3, 0.2]);
    expect(parsePayoutString("50% 30% 20%")).toEqual([0.5, 0.3, 0.2]);
  });

  it("normalizes non-normalized inputs", () => {
    const r = parsePayoutString("1 1 1 1")!;
    expect(r).toHaveLength(4);
    for (const v of r) expect(v).toBeCloseTo(0.25, 9);
  });

  it("returns null for empty input", () => {
    expect(parsePayoutString("")).toBeNull();
    expect(parsePayoutString("   ")).toBeNull();
  });
});
