import { describe, it, expect } from "vitest";
import { applyICMToPayoutTable, icmEquities } from "./icm";

describe("icmEquities", () => {
  it("equal stacks, winner-takes-all → flat split", () => {
    const eq = icmEquities([1, 1, 1], [100]);
    expect(eq).toHaveLength(3);
    for (const v of eq) expect(v).toBeCloseTo(100 / 3, 8);
  });

  it("lone player gets the whole prize pool", () => {
    const eq = icmEquities([5], [100, 50]);
    expect(eq[0]).toBeCloseTo(100, 8);
  });

  it("bigger stack → larger equity under Malmuth-Harville", () => {
    const eq = icmEquities([10, 1], [100, 40]);
    expect(eq[0]).toBeGreaterThan(eq[1]);
    // P(big wins) = 10/11, P(small wins) = 1/11
    const bigEq = (10 / 11) * 100 + (1 / 11) * 40;
    const smallEq = (1 / 11) * 100 + (10 / 11) * 40;
    expect(eq[0]).toBeCloseTo(bigEq, 8);
    expect(eq[1]).toBeCloseTo(smallEq, 8);
  });

  it("equities sum to total prize pool", () => {
    const eq = icmEquities([3, 2, 5, 1], [500, 300, 150, 50]);
    const s = eq.reduce((a, b) => a + b, 0);
    expect(s).toBeCloseTo(1000, 6);
  });
});

describe("applyICMToPayoutTable", () => {
  it("preserves total $ on top ftSize places", () => {
    const payouts = [1000, 600, 400, 250, 180, 130, 100, 80, 60, 40, 30];
    const adjusted = applyICMToPayoutTable(payouts, 9, 0.4);
    const topBefore = payouts.slice(0, 9).reduce((a, b) => a + b, 0);
    const topAfter = adjusted.slice(0, 9).reduce((a, b) => a + b, 0);
    expect(topAfter).toBeCloseTo(topBefore, 8);
  });

  it("flattens top places (1st goes down, last FT place goes up)", () => {
    const payouts = [1000, 600, 400, 250, 180, 130, 100, 80, 60];
    const adjusted = applyICMToPayoutTable(payouts, 9, 0.5);
    expect(adjusted[0]).toBeLessThan(payouts[0]);
    expect(adjusted[8]).toBeGreaterThan(payouts[8]);
  });

  it("smoothing=0 is identity", () => {
    const payouts = [1000, 600, 400];
    const adjusted = applyICMToPayoutTable(payouts, 3, 0);
    expect(adjusted).toEqual(payouts);
  });

  it("smoothing=1 yields the top-ft average for every FT place", () => {
    const payouts = [900, 600, 300];
    const adjusted = applyICMToPayoutTable(payouts, 3, 1);
    for (let i = 0; i < 3; i++) {
      expect(adjusted[i]).toBeCloseTo(600, 8);
    }
  });

  it("leaves non-FT places alone", () => {
    const payouts = [1000, 600, 400, 250, 180, 130, 100, 80, 60, 40, 30, 25];
    const adjusted = applyICMToPayoutTable(payouts, 9, 0.4);
    for (let i = 9; i < payouts.length; i++) {
      expect(adjusted[i]).toBeCloseTo(payouts[i], 10);
    }
  });
});
