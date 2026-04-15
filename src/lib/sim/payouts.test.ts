import { describe, it, expect } from "vitest";
import { getPayoutTable, parsePayoutString } from "./payouts";
import type { PayoutStructureId } from "./types";

const STRUCTURES: PayoutStructureId[] = [
  "mtt-standard",
  "mtt-primedope",
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

  it("mtt-primedope matches PD's live paid=15 curve byte-for-byte at N=100", () => {
    // Scraped from the live `sub_routine=payout_info` endpoint (see
    // pdCurves.ts top-of-file comment). PD updated their table post-
    // tmp_legacy.js: 1st is now 28 % (was 25.5 %), tail is flat 2.1 %
    // for places 10–15 instead of the old stepped 2.5/2.5/2.5/2/2/2.
    const expected = [
      0.28, 0.17, 0.106, 0.086, 0.076, 0.053, 0.043, 0.033, 0.027,
      0.021, 0.021, 0.021, 0.021, 0.021, 0.021,
    ];
    const table = getPayoutTable("mtt-primedope", 100);
    expect(table).toHaveLength(15);
    for (let i = 0; i < 15; i++) {
      expect(table[i]).toBeCloseTo(expected[i], 6);
    }
  });

  it("mtt-primedope reproduces PD's σ within MC noise on the 100p reference", () => {
    // Two-bin uniform SD for the 100p/$50/10% ROI reference scenario.
    // PD reports σ_1000 = $5607 (math) / $5789 (sim). Our analytic σ
    // under mtt-primedope should land inside this range (±5 %).
    const N = 100;
    const buyIn = 50;
    const pool = N * buyIn;
    const target = buyIn * 1.1;
    const fractions = getPayoutTable("mtt-primedope", N);
    const paid = fractions.length;
    const l = (target * paid) / pool;
    const pPaid = l / paid;
    let mu = 0;
    let mu2 = 0;
    for (let i = 0; i < paid; i++) {
      const prize = fractions[i] * pool;
      mu += pPaid * prize;
      mu2 += pPaid * prize * prize;
    }
    const sd1 = Math.sqrt(mu2 - mu * mu);
    const sd1k = sd1 * Math.sqrt(1000);
    expect(sd1k).toBeGreaterThan(5350);
    expect(sd1k).toBeLessThan(6100);
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
