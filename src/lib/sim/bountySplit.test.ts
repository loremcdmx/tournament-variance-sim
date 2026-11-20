import { describe, expect, it } from "vitest";
import { settleBountyAgainstPool } from "./bountySplit";
import { bountyEvCeiling } from "./finishModel";
import { applySitThroughPayJumps } from "./sitThroughPayJumps";

// A three-place table paying 100 / 50 / 0 out of a $100 x 0.25 bounty pool per
// seat, so the pool holds 75 and one entry collects at most 75 x (1 - P(last)).
const N = 3;
const prizeByPlace = Float64Array.from([100, 50, 0]);
const pool = { N, paidCount: 2, buyIn: 100, bountyFraction: 0.25, cashFloor: 0.01 };
const ceilingOf = (pmf: Float64Array) => bountyEvCeiling(N, 100, 0.25, pmf);

/** Pinned ITM 0.6: the solve moves mass between 1st and 2nd, P(last) stays 0.4. */
function pinnedSolve(calls: number[]) {
  return (target: number) => {
    calls.push(target);
    const first = Math.max(0, Math.min(0.6, (target - 30) / 50));
    return { pmf: Float64Array.from([first, 0.6 - first, 0.4]), prizeByPlace };
  };
}

/** Free ITM: 1st and 2nd share 2x, so more cash lowers P(last) = 1 - 2x. */
function freeSolve(calls: number[]) {
  return (target: number) => {
    calls.push(target);
    const x = Math.max(0, Math.min(0.5, target / 150));
    return { pmf: Float64Array.from([x, x, 1 - 2 * x]), prizeByPlace };
  };
}

describe("settleBountyAgainstPool", () => {
  it("solves a plan inside the ceiling once and keeps it", () => {
    const calls: number[] = [];
    const s = settleBountyAgainstPool({
      ...pool, totalWinningsEV: 120, plannedBountyMean: 40, residualCloses: false,
      sitThrough: false, payJumpAggression: undefined, solve: freeSolve(calls),
    });
    expect(calls).toEqual([80]);
    expect(s.bountyMean).toBe(40);
    expect(s.targetRegular).toBe(80);
    expect(s.poolCut).toBe(false);
  });

  it("cuts a pinned plan to the ceiling in one more solve, since the pin fixes P(last)", () => {
    const calls: number[] = [];
    const s = settleBountyAgainstPool({
      ...pool, totalWinningsEV: 80, plannedBountyMean: 60, residualCloses: true,
      sitThrough: false, payJumpAggression: undefined, solve: pinnedSolve(calls),
    });
    // Ceiling 75 x 0.6 = 45; the cash side is asked for the other 35.
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBeCloseTo(35, 12);
    expect(s.bountyMean).toBeCloseTo(45, 12);
    expect(s.cashEV + s.bountyMean).toBeCloseTo(80, 12);
    expect(s.bountyMean).toBeLessThanOrEqual(ceilingOf(s.solved.pmf));
    expect(s.poolCut).toBe(true);
  });

  it("settles a free plan on the KO EV its own pmf can pay, whatever the plan past it", () => {
    // b = ceiling(solve(120 - b)) = 75 x 2 (120 - b) / 150 = 120 - b, so b = 60.
    const settled = [90, 110].map((plan) =>
      settleBountyAgainstPool({
        ...pool, totalWinningsEV: 120, plannedBountyMean: plan, residualCloses: false,
        sitThrough: false, payJumpAggression: undefined, solve: freeSolve([]),
      }),
    );
    for (const s of settled) {
      expect(Math.abs(s.bountyMean / 60 - 1)).toBeLessThan(2e-9);
      expect(s.bountyMean).toBeLessThanOrEqual(ceilingOf(s.solved.pmf));
      expect(s.cashEV + s.bountyMean).toBeCloseTo(120, 6);
    }
    // One step to the first ceiling (75 x 2 x 30 / 150 = 30) would pay half.
    const firstCeiling = ceilingOf(freeSolve([])(30).pmf);
    expect(firstCeiling).toBeCloseTo(30, 12);
  });

  it("finds the fixed point in a few solves where P(last) moves nonlinearly", () => {
    // Four seats paying 100 / 50 / 0 / 0 out of a 100 pool; a cash target t
    // puts t / 150 on each of 1st and 2nd and P(last) = (1 - t / 75)^2. With
    // s = (100 - b) / 75 the fixed point solves 100 s^2 - 275 s + 100 = 0.
    const prizes = Float64Array.from([100, 50, 0, 0]);
    const exact = 100 - 75 * (275 - Math.sqrt(275 * 275 - 40000)) / 200;
    for (const plan of [80, 90, 99]) {
      const calls: number[] = [];
      const s = settleBountyAgainstPool({
        N: 4, paidCount: 2, buyIn: 100, bountyFraction: 0.25, cashFloor: 0.01,
        totalWinningsEV: 100, plannedBountyMean: plan, residualCloses: false,
        sitThrough: false, payJumpAggression: undefined,
        solve: (target) => {
          calls.push(target);
          const x = Math.max(0, Math.min(0.5, target / 150));
          const u = 1 - 2 * x;
          return { pmf: Float64Array.from([x, x, u - u * u, u * u]), prizeByPlace: prizes };
        },
      });
      // Every solve is a whole calibration in the engine; a bisection over the
      // ask took 31-33 of them here and stopped up to 6e-10 short.
      expect(calls.length).toBeLessThanOrEqual(9);
      expect(Math.abs(s.bountyMean / exact - 1)).toBeLessThan(1e-11);
      expect(s.bountyMean).toBeLessThanOrEqual(bountyEvCeiling(4, 100, 0.25, s.solved.pmf));
      expect(s.cashEV + s.bountyMean).toBeCloseTo(100, 9);
    }
  });

  it("caps a residual past the ceiling by less than the on-target tolerance", () => {
    // Cash tops out at 60, so a 105.0225 total leaves 45.0225 of KO EV against a
    // ceiling of 45: 0.05 % over, which the 0.1 % tolerance on a total would pass.
    const s = settleBountyAgainstPool({
      ...pool, totalWinningsEV: 105.0225, plannedBountyMean: 40, residualCloses: true,
      sitThrough: false, payJumpAggression: undefined, solve: pinnedSolve([]),
    });
    expect(s.cashEV).toBeCloseTo(60, 12);
    expect(s.bountyMean).toBeLessThanOrEqual(ceilingOf(s.solved.pmf));
    expect(s.bountyMean).toBeCloseTo(45, 12);
  });

  it("caps what a short cash side leaves when the plan itself fits", () => {
    const calls: number[] = [];
    // The pinned table pays at most 60 in cash, so a 110 total leaves 50
    // against a ceiling of 45, while the plan of 40 fits under it.
    const s = settleBountyAgainstPool({
      ...pool, totalWinningsEV: 110, plannedBountyMean: 40, residualCloses: true,
      sitThrough: false, payJumpAggression: undefined, solve: pinnedSolve(calls),
    });
    expect(calls).toHaveLength(1);
    expect(s.bountyMean).toBeCloseTo(45, 12);
    expect(s.cashEV + s.bountyMean).toBeLessThan(110);
    expect(s.poolCut).toBe(true);
  });

  it("marks the cut on a fixed shape, which pays its own cash whatever it is asked", () => {
    // A shape that ignores its target pays 40 in cash and leaves P(last) at 0.4:
    // a 110 total leaves 70 of KO EV against a ceiling of 45. Without the cut
    // the 70 would close the total, which is why such a row aims at its ROI.
    const shape = { pmf: Float64Array.from([0.2, 0.4, 0.4]), prizeByPlace };
    const settle = (totalWinningsEV: number) => settleBountyAgainstPool({
      ...pool, totalWinningsEV, plannedBountyMean: 70, residualCloses: true,
      sitThrough: false, payJumpAggression: undefined, solve: () => shape,
    });
    const short = settle(110);
    expect(short.poolCut).toBe(true);
    expect(short.bountyMean).toBeCloseTo(45, 12);
    expect(short.cashEV + short.bountyMean).toBeCloseTo(85, 12);
    const fits = settle(80);
    expect(fits.poolCut).toBe(false);
    expect(fits.bountyMean).toBeCloseTo(40, 12);
  });

  it("leaves a lone player's residual alone: the winner is also last", () => {
    const s = settleBountyAgainstPool({
      ...pool, N: 1, paidCount: 1, totalWinningsEV: 50, plannedBountyMean: 20, residualCloses: true,
      sitThrough: false, payJumpAggression: undefined,
      solve: () => ({ pmf: Float64Array.from([1]), prizeByPlace: Float64Array.from([40]) }),
    });
    expect(s.bountyMean).toBe(10);
    expect(s.poolCut).toBe(false);
  });

  it("reads the ceiling after the sit-through transform, which moves mass onto last place", () => {
    // Six seats, four paid 40 / 30 / 20 / 10, ITM 0.6, a $100 x 0.1 pool (60).
    // A cash target of 15 puts 0.15 on 1st and 0.15 on each of 2nd-4th: the
    // ceiling is 60 x 0.8 = 48 before the transform and about 42.8 after it.
    const six = Float64Array.from([40, 30, 20, 10, 0, 0]);
    const solve = (target: number) => {
      const first = Math.max(0, Math.min(0.6, (target - 12) / 20));
      const rest = (0.6 - first) / 3;
      return { pmf: Float64Array.from([first, rest, rest, rest, 0.2, 0.2]), prizeByPlace: six };
    };
    const settle = (sitThrough: boolean) => settleBountyAgainstPool({
      N: 6, paidCount: 4, buyIn: 100, bountyFraction: 0.1, cashFloor: 0.01,
      totalWinningsEV: 60, plannedBountyMean: 45, residualCloses: true,
      sitThrough, payJumpAggression: 1, solve,
    });
    expect(settle(false).bountyMean).toBeCloseTo(45, 12);
    const s = settle(true);
    const played = Float64Array.from(s.solved.pmf);
    applySitThroughPayJumps(played, six, 4, 1);
    const ceiling = bountyEvCeiling(6, 100, 0.1, played);
    expect(s.bountyMean).toBeLessThan(45);
    expect(s.bountyMean).toBeLessThanOrEqual(ceiling);
    expect(s.bountyMean / ceiling).toBeGreaterThan(1 - 2e-9);
    expect(s.cashEV + s.bountyMean).toBeCloseTo(60, 6);
  });
});
