import { describe, expect, it } from "vitest";
import { battleRoyaleRowFromTotalTicket } from "./battleRoyaleTicket";
import { makeBrTierSampler } from "./brBountyTiers";
import { knockoutFloor, knockoutFloorShape, settleBountyAgainstPool } from "./bountySplit";
import { compileSchedule } from "./compile";
import { bountyEvCeiling } from "./finishModel";
import { applyGameType, DEFAULT_BATTLE_ROYALE_BOUNTY_FRACTION } from "./gameType";
import { applySitThroughPayJumps } from "./sitThroughPayJumps";
import type { GameType, TournamentRow } from "./types";

// A three-place table paying 100 / 50 / 0 out of a $100 x 0.25 bounty pool per
// seat, so the pool holds 75 and one entry collects at most 75 x (1 - P(last)).
const N = 3;
const prizeByPlace = Float64Array.from([100, 50, 0]);
const pool = { N, paidCount: 2, buyIn: 100, bountyFraction: 0.25, gameType: "pko" as const, cashFloor: 0.01 };
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
    expect(s.floorLift).toBe(false);
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
        N: 4, paidCount: 2, buyIn: 100, bountyFraction: 0.25, gameType: "pko", cashFloor: 0.01,
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

  it("holds what an overshooting pinned cash side leaves, not the ask, to the ceiling", () => {
    // The pin keeps P(last) at 0.4 (ceiling 45), but the cash side pays 1.5x
    // what it is asked past 30, as the first-place floor does near break-even:
    // asked for 35 it pays 37.5. A total of 80 then leaves KO EV of
    // 1.5 ask - 25, which meets the ceiling at ask 140/3 (cash 35).
    const overshooting = (target: number) => {
      const cash = Math.min(60, Math.max(30, 30 + 1.5 * (target - 30)));
      const first = (cash - 30) / 50;
      return { pmf: Float64Array.from([first, 0.6 - first, 0.4]), prizeByPlace };
    };
    const s = settleBountyAgainstPool({
      ...pool, totalWinningsEV: 80, plannedBountyMean: 60, residualCloses: true,
      sitThrough: false, payJumpAggression: undefined, solve: overshooting,
    });
    // Held to the ask, the first ask (the ceiling, 45) fits and leaves 42.5.
    expect(s.poolCut).toBe(true);
    expect(s.bountyMean / 45).toBeGreaterThan(1 - 1e-9);
    expect(s.bountyMean).toBeLessThanOrEqual(ceilingOf(s.solved.pmf));
    expect(s.cashEV).toBeCloseTo(35, 6);
    expect(s.cashEV + s.bountyMean).toBeCloseTo(80, 12);
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
      N: 6, paidCount: 4, buyIn: 100, bountyFraction: 0.1, gameType: "pko", cashFloor: 0.01,
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

describe("the KO floor", () => {
  // The PKO tree on three seats pays the winner 2.75 heads, 2nd 0.25, 3rd none,
  // and winning guarantees two heads ($50).
  const shape = knockoutFloorShape(N, 2, 100, 0.25, "pko");
  const floorOf = (pmf: Float64Array) => knockoutFloor(shape, pmf);

  it("is the place shape the engine spreads a row's KO EV over", () => {
    const base: TournamentRow = { id: "r", players: 30, buyIn: 10, rake: 0.1, roi: 0.1, payoutStructure: "mtt-standard", count: 1 };
    const rows: [GameType, number][] = [
      ["pko", 2], ["pko", 3], ["pko", 9], ["pko", 45],
      // Heads-up Mystery pays one place: no bust drops an envelope and the
      // winner takes the pool.
      ["mystery", 2], ["mystery", 30], ["mystery", 300],
      ["mystery-royale", 18], ["ocean-ko", 9], ["ocean-ko", 100],
    ];
    for (const [gameType, players] of rows) {
      const row = { ...base, ...applyGameType(base, gameType), players };
      const entry = compileSchedule({
        schedule: [row], scheduleRepeats: 1, samples: 1, bankroll: 0, seed: 1, finishModel: { id: "power-law" },
      }).flat[0];
      const { weights } = knockoutFloorShape(entry.fieldSize, entry.paidCount, row.buyIn, row.bountyFraction ?? 0, gameType);
      const paid = entry.bountyByPlace!;
      for (let i = 0; i < entry.fieldSize; i++) {
        expect(Math.abs(paid[i] * weights[0] - paid[0] * weights[i])).toBeLessThanOrEqual(1e-12 * paid[0] * weights[0]);
      }
    }
    expect(Array.from(shape.weights)).toEqual([2.75, 0.25, 0]);
    expect(shape.winnerTake).toBe(50);
  });

  it("holds what a lifted cash side leaves to the floor, the first-place floor giving way", () => {
    // Pinned ITM 0.6 whose first-place floor lifts P(1st) to the whole ITM as far
    // as the cash side may rise. At the $80 total it pays $60 and leaves $20 of
    // KOs, where its P(1st) of 0.6 guarantees $30. With P(1st) = f the row leaves
    // 50 - 50 f against a floor of 50 (2.5 f + 0.15) / 2.75: f = 2.6 / 5.25.
    const calls: [number, number][] = [];
    const s = settleBountyAgainstPool({
      ...pool, totalWinningsEV: 80, plannedBountyMean: 40, residualCloses: true,
      sitThrough: false, payJumpAggression: undefined,
      solve: (target, cap) => {
        calls.push([target, cap]);
        const natural = Math.max(0, Math.min(0.6, (target - 30) / 50));
        const first = Math.max(natural, Math.min(0.6, (Math.max(target, cap) - 30) / 50));
        return { pmf: Float64Array.from([first, 0.6 - first, 0.4]), prizeByPlace };
      },
    });
    expect(calls[0]).toEqual([40, 80]);
    expect(calls.every(([target, cap]) => target === 40 && cap >= 40 && cap <= 80)).toBe(true);
    expect(calls.length).toBeLessThanOrEqual(8);
    expect(Math.abs(s.solved.pmf[0] / (2.6 / 5.25) - 1)).toBeLessThan(2e-9);
    expect(Math.abs(s.bountyMean / (50 - 50 * 2.6 / 5.25) - 1)).toBeLessThan(2e-9);
    expect(s.bountyMean).toBeGreaterThanOrEqual(floorOf(s.solved.pmf));
    expect(s.cashEV + s.bountyMean).toBeCloseTo(80, 9);
    expect(s.poolCut).toBe(false);
    expect(s.floorLift).toBe(false);
  });

  it("raises a free plan under the floor to the fixed point of its own solve", () => {
    // A cash target t puts t / 150 on 1st and 2nd, so the floor of a KO EV b is
    // (600 / 11) x (70 - b) / 150 and b = 280 / 15.
    const s = settleBountyAgainstPool({
      ...pool, totalWinningsEV: 70, plannedBountyMean: 5, residualCloses: false,
      sitThrough: false, payJumpAggression: undefined, solve: freeSolve([]),
    });
    expect(Math.abs(s.bountyMean / (280 / 15) - 1)).toBeLessThan(2e-9);
    expect(s.bountyMean).toBeGreaterThanOrEqual(floorOf(s.solved.pmf));
    expect(s.bountyMean).toBeLessThanOrEqual(ceilingOf(s.solved.pmf));
    expect(s.cashEV + s.bountyMean).toBeCloseTo(70, 9);
    expect(s.poolCut).toBe(false);
  });

  it("plays a fixed shape whose cash leaves less than the floor at the floor, over its total, and marks it", () => {
    // The shape cashes $60 at P(1st) 0.6, which guarantees $30 of KOs against
    // the $20 the $80 total leaves; cashing $90, it overpays the total alone.
    const fixed = (first: number) => {
      const calls: number[] = [];
      const s = settleBountyAgainstPool({
        ...pool, totalWinningsEV: 80, plannedBountyMean: 40, residualCloses: true,
        sitThrough: false, payJumpAggression: undefined,
        solve: (target) => {
          calls.push(target);
          return { pmf: Float64Array.from([first, 0, 1 - first]), prizeByPlace };
        },
      });
      return { s, calls };
    };
    const { s, calls } = fixed(0.6);
    expect(calls).toHaveLength(3);
    expect(s.bountyMean).toBeCloseTo(30, 12);
    expect(s.cashEV + s.bountyMean).toBeCloseTo(90, 12);
    expect(s.poolCut).toBe(false);
    expect(s.floorLift).toBe(true);
    const over = fixed(0.9).s;
    expect(over.bountyMean).toBeCloseTo(45, 12);
    expect(over.floorLift).toBe(true);
    // A shape whose residual clears the floor closes its total unmarked.
    const closes = fixed(0.5).s;
    expect(closes.bountyMean).toBeCloseTo(30, 12);
    expect(closes.floorLift).toBe(false);
    // The floor allows rounding only: a residual 4e-7 under it is lifted.
    const edge = fixed((80 / 150) * (1 + 1.25e-7)).s;
    expect(80 - edge.cashEV).toBeLessThan(edge.bountyMean * (1 - 3e-7));
    expect(edge.bountyMean).toBeCloseTo(50 * edge.solved.pmf[0], 12);
    expect(edge.floorLift).toBe(true);
  });

  it("holds a heads-up plan past the ceiling to the floor when its cash side overshoots", () => {
    // The plan asks for more than the pool holds, and the cash side is lifted
    // $5 over its target as far as its cap allows. The ceiling's search holds
    // what the overshooting row plays, the residual 80 - cash, to the ceiling:
    // b - 5 = 50 x (85 - b) / 100 gives a residual of 80 / 3, which heads-up is
    // also the floor, so the floor holds as it lands. The pool cut the plan.
    const heads = { N: 2, paidCount: 1, buyIn: 100, bountyFraction: 0.25, gameType: "pko" as const, cashFloor: 0.01 };
    const s = settleBountyAgainstPool({
      ...heads, totalWinningsEV: 80, plannedBountyMean: 60, residualCloses: true,
      sitThrough: false, payJumpAggression: undefined,
      solve: (target, cap) => {
        const cash = Math.min(target + 5, Math.max(target, cap));
        return { pmf: Float64Array.from([cash / 100, 1 - cash / 100]), prizeByPlace: Float64Array.from([100, 0]) };
      },
    });
    expect(Math.abs(s.bountyMean / (80 / 3) - 1)).toBeLessThan(2e-9);
    expect(s.bountyMean).toBeGreaterThanOrEqual(50 * s.solved.pmf[0] * (1 - 1e-9));
    expect(s.cashEV + s.bountyMean).toBeCloseTo(80, 7);
    expect(s.poolCut).toBe(true);
    expect(s.floorLift).toBe(false);
  });

  it("guarantees a Battle Royale winner one envelope of the table the engine draws, at any ticket", () => {
    // GG's $10 table pays $9.45 an envelope, which is also 18 x $4.20 over its
    // 8 knockouts; a typed $5 ticket draws GG's $3 table ($2.835) while its own
    // pool would pay $4.725, and a $6 ticket the $10 table against $5.67.
    for (const [ticket, envelope] of [[10, 9.45], [5, 2.835], [6, 9.45]] as const) {
      const { buyIn } = battleRoyaleRowFromTotalTicket(ticket);
      const shape = knockoutFloorShape(18, 3, buyIn, DEFAULT_BATTLE_ROYALE_BOUNTY_FRACTION, "mystery-royale");
      expect(shape.winnerTake).toBeCloseTo(envelope, 12);
      expect(shape.winnerTake).toBe(makeBrTierSampler(buyIn).meanValue);
    }
    // Where the whole pool is less than an envelope, the pool is all a win takes.
    expect(knockoutFloorShape(2, 1, 9.2, 0.1, "mystery-royale").winnerTake).toBeCloseTo(2 * 0.92, 12);
  });

  it("pins a heads-up KO EV to the pool's share of a win, where the floor meets the ceiling", () => {
    const heads = { N: 2, paidCount: 1, buyIn: 100, bountyFraction: 0.25, gameType: "pko" as const, cashFloor: 0.01 };
    const won = { pmf: Float64Array.from([0.5, 0.5]), prizeByPlace: Float64Array.from([100, 0]) };
    for (const totalWinningsEV of [70, 75, 80]) {
      const s = settleBountyAgainstPool({
        ...heads, totalWinningsEV, plannedBountyMean: 10, residualCloses: true,
        sitThrough: false, payJumpAggression: undefined, solve: () => won,
      });
      expect(s.bountyMean).toBeCloseTo(25, 12);
    }
  });
});
