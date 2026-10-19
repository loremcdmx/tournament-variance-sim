import { describe, expect, it } from "vitest";
import {
  DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS,
  buildBattleRoyaleLeaderboardPromoConfig,
} from "@/lib/sim/battleRoyaleLeaderboardUi";
import { battleRoyaleRowFromTotalTicket } from "@/lib/sim/battleRoyaleTicket";
import { runSimulation } from "@/lib/sim/engine";
import type { SimulationInput, SimulationResult, TournamentRow } from "@/lib/sim/types";
import {
  computeHeadlineStats,
  leaderboardPromoHeadlineShift,
} from "./headlineStats";
import {
  computeExpectedLeaderboardCurve,
  computeExpectedRakebackCurve,
  shiftResultByRakeback,
} from "./trajectoryTransforms";

const ENGINE = {
  expectedProfit: 140,
  stats: { mean: 140, median: 100, min: -900, max: 5000, p05: -600, p95: 1200 },
};
const LB_EV = 500;

function foldLb(base: typeof ENGINE, lb: number): typeof ENGINE {
  return {
    expectedProfit: base.expectedProfit + lb,
    stats: {
      mean: base.stats.mean + lb,
      median: base.stats.median + lb,
      min: base.stats.min + lb,
      max: base.stats.max + lb,
      p05: base.stats.p05 + lb,
      p95: base.stats.p95 + lb,
    },
  };
}

describe("headline stats with a BR leaderboard promo", () => {
  it("counts the promo once when the toggle already folded it into the result", () => {
    const displayed = foldLb(ENGINE, LB_EV);
    const shift = leaderboardPromoHeadlineShift(LB_EV, true);
    const headline = computeHeadlineStats(displayed, shift);

    expect(shift).toBe(0);
    expect(headline.expectedProfit).toBe(640);
    expect(headline.mean).toBe(640);
    expect(headline.median).toBe(600);
    expect(headline.p05).toBe(-100);
    expect(headline.p95).toBe(1700);
    expect(headline.mean).not.toBe(1140);
  });

  it("adds the promo once when the toggle left the result at engine output", () => {
    const shift = leaderboardPromoHeadlineShift(LB_EV, false);
    const headline = computeHeadlineStats(ENGINE, shift);

    expect(shift).toBe(LB_EV);
    expect(headline.expectedProfit).toBe(640);
    expect(headline.mean).toBe(640);
    expect(headline.median).toBe(600);
    expect(headline.min).toBe(-400);
    expect(headline.max).toBe(5500);
    expect(headline.p05).toBe(-100);
    expect(headline.p95).toBe(1700);
  });

  it("both toggle states agree on every headline number", () => {
    const folded = computeHeadlineStats(
      foldLb(ENGINE, LB_EV),
      leaderboardPromoHeadlineShift(LB_EV, true),
    );
    const raw = computeHeadlineStats(
      ENGINE,
      leaderboardPromoHeadlineShift(LB_EV, false),
    );
    expect(folded).toEqual(raw);
  });

  it("is a no-op without a promo", () => {
    const headline = computeHeadlineStats(
      ENGINE,
      leaderboardPromoHeadlineShift(0, false),
    );
    expect(headline.mean).toBe(ENGINE.stats.mean);
    expect(headline.expectedProfit).toBe(ENGINE.expectedProfit);
  });
});

describe("headline stats on a real Battle Royale run", () => {
  const ticket = battleRoyaleRowFromTotalTicket(1);
  const schedule: TournamentRow[] = [
    {
      id: "br-1",
      label: "GG BR $1",
      gameType: "mystery-royale",
      payoutStructure: "battle-royale",
      players: 18,
      buyIn: ticket.buyIn,
      rake: ticket.rake,
      roi: 0,
      count: 700,
      bountyFraction: 0.45,
      itmRate: 0.2,
    },
  ];
  const promo = buildBattleRoyaleLeaderboardPromoConfig(
    {
      ...DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS,
      mode: "observed",
      observedTotalPrizes: 35,
      observedTotalTournaments: 700,
      observedPointsByStake: { "0.25": 0, "1": 1, "3": 0, "10": 0, "25": 0 },
    },
    schedule,
  );
  const input: SimulationInput = {
    schedule,
    scheduleRepeats: 1,
    samples: 400,
    bankroll: 100,
    seed: 42,
    finishModel: { id: "power-law" },
    rakebackFracOfRake: 0.3,
    battleRoyaleLeaderboardPromo: promo,
  };
  const engine = runSimulation(input, () => {});
  const lbExpected = engine.battleRoyaleLeaderboardPromo?.expectedPayout ?? 0;
  const x = Array.from(engine.samplePaths.x);

  // The composition ResultsView applies before the headline: leaderboard
  // folded in when the toggle is on, rakeback taken out when it is off.
  function headlineFor(lbIncluded: boolean, rbIncluded: boolean) {
    const lbCurve = computeExpectedLeaderboardCurve(lbExpected, engine.tournamentsPerSample, x);
    const lbAdjusted: SimulationResult =
      lbIncluded && lbCurve ? shiftResultByRakeback(engine, lbCurve, 1) : engine;
    const rbCurve = computeExpectedRakebackCurve(schedule, 1, 0.3, x);
    const displayed =
      !rbIncluded && rbCurve ? shiftResultByRakeback(lbAdjusted, rbCurve, -1) : lbAdjusted;
    const folded = lbIncluded && lbCurve != null;
    return computeHeadlineStats(displayed, leaderboardPromoHeadlineShift(lbExpected, folded));
  }

  it("builds a leaderboard promo worth counting", () => {
    expect(lbExpected).toBeCloseTo(35, 9);
  });

  it("counts the promo once whichever way the include toggle is set", () => {
    const on = headlineFor(true, true);
    const off = headlineFor(false, true);
    expect(on.mean).toBeCloseTo(engine.stats.mean + lbExpected, 9);
    expect(on.expectedProfit).toBeCloseTo(engine.expectedProfit + lbExpected, 9);
    for (const key of Object.keys(on) as (keyof typeof on)[]) {
      expect(on[key], key).toBeCloseTo(off[key], 9);
    }
  });

  it("takes rakeback out of the headline together with the promo kept in", () => {
    const withRb = headlineFor(true, true);
    const withoutRb = headlineFor(true, false);
    const rbTotal = withRb.mean - withoutRb.mean;
    const rbCurve = computeExpectedRakebackCurve(schedule, 1, 0.3, x);
    expect(rbTotal).toBeCloseTo(rbCurve![rbCurve!.length - 1], 9);
    expect(rbTotal).toBeGreaterThan(0);
    expect(withoutRb.expectedProfit).toBeCloseTo(engine.expectedProfit + lbExpected - rbTotal, 9);
  });
});
