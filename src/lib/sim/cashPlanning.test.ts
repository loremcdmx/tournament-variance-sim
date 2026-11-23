import { describe, expect, it } from "vitest";
import {
  cashEffectiveSummary,
  cashFiniteHorizonRor,
  computeCashConvergenceRows,
  computeCashProveEdgeRows,
} from "./cashPlanning";
import { DEFAULT_CASH_INPUT } from "./cashInput";

describe("cashEffectiveSummary", () => {
  it("computes single-stake effective WR, SD, and EV without rakeback", () => {
    const s = cashEffectiveSummary({
      ...DEFAULT_CASH_INPUT,
      wrBb100: 5,
      sdBb100: 100,
      hands: 100_000,
      bbSize: 1,
      rake: { enabled: false, contributedRakeBb100: 8, advertisedRbPct: 30, pvi: 1 },
      hoursBlock: { handsPerHour: 500 },
    });
    expect(s.effectiveWrBb100).toBeCloseTo(5, 9);
    expect(s.effectiveSdBb100).toBeCloseTo(100, 9);
    expect(s.expectedEvBb).toBeCloseTo(5_000, 9);
    expect(s.hourlyEvUsd).toBeCloseTo(25, 9);
  });

  it("folds rakeback into effective WR when enabled", () => {
    const s = cashEffectiveSummary({
      ...DEFAULT_CASH_INPUT,
      wrBb100: 2,
      sdBb100: 100,
      hands: 100_000,
      rake: { enabled: true, contributedRakeBb100: 10, advertisedRbPct: 30, pvi: 0.8 },
    });
    // RB = 10 * 0.30 * 0.8 = 2.4 bb/100 → effective WR = 4.4 bb/100
    expect(s.effectiveWrBb100).toBeCloseTo(4.4, 9);
    expect(s.totalRbBb).toBeCloseTo(2_400, 9);
  });
});

describe("computeCashConvergenceRows", () => {
  it("computes exact 95% confidence spread ±1.96 * sd / sqrt(hands/100)", () => {
    const rows = computeCashConvergenceRows(5, 100, 95, [10_000, 100_000]);
    expect(rows[0].halfWidthBb100).toBeCloseTo(19.6, 2);
    expect(rows[1].halfWidthBb100).toBeCloseTo(19.6 / Math.sqrt(10), 2);
    expect(rows[1].probProfit).toBeGreaterThan(rows[0].probProfit);
  });

  it("handles zero SD deterministically", () => {
    const rows = computeCashConvergenceRows(3, 0, 95, [10_000]);
    expect(rows[0].halfWidthBb100).toBe(0);
    expect(rows[0].probProfit).toBe(1);
  });
});

describe("computeCashProveEdgeRows", () => {
  it("scales hands inversely with WR^2 and matches exact power formula at 95%", () => {
    const rows = computeCashProveEdgeRows(100, 95, 500, [2, 4]);
    // At 95% CI, z_sig ≈ 1.959964, z_pow ≈ 1.644854 → (z_sig + z_pow)^2 ≈ 12.9947
    // For SD=100, WR=4: 100 * (3.604818 * 100 / 4)^2 ≈ 812,170 hands
    expect(rows[1].handsRequired).toBeGreaterThan(800_000);
    expect(rows[1].handsRequired).toBeLessThan(830_000);
    expect(rows[0].handsRequired / rows[1].handsRequired).toBeCloseTo(4, 2);
    expect(rows[1].hoursRequired).toBeCloseTo(rows[1].handsRequired / 500, 3);
    // 5% RoR at WR=4, SD=100: -10000 * ln(0.05) / 8 ≈ 3744.7 BB
    expect(rows[1].bankroll5pctBb).toBeCloseTo(3744.67, 1);
    expect(rows[1].bankroll1pctBb).toBeCloseTo(5756.46, 1);
  });
});

describe("cashFiniteHorizonRor", () => {
  it("converges toward asymptotic exp(-2*B*mu/var) as hands grow large", () => {
    const wrPerHand = 0.05; // 5 bb/100
    const varPerHand = 100; // SD 100 bb/100
    const br = 2_000;
    const asymp = Math.exp((-2 * br * wrPerHand) / varPerHand);
    const shortH = cashFiniteHorizonRor(br, wrPerHand, varPerHand, 10_000);
    const hugeH = cashFiniteHorizonRor(br, wrPerHand, varPerHand, 10_000_000);
    expect(shortH).toBeLessThan(asymp);
    expect(hugeH).toBeCloseTo(asymp, 5);
  });

  it("handles zero variance without NaN", () => {
    expect(cashFiniteHorizonRor(100, 0, 0, 10_000)).toBe(0);
    expect(cashFiniteHorizonRor(100, -0.05, 0, 10_000)).toBe(1);
    expect(cashFiniteHorizonRor(100, -0.005, 0, 10_000)).toBe(0);
  });
});
