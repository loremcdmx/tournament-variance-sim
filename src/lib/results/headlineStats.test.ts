import { describe, expect, it } from "vitest";
import {
  computeHeadlineStats,
  leaderboardPromoHeadlineShift,
} from "./headlineStats";

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
