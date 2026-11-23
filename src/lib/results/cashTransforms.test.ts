import { describe, expect, it } from "vitest";
import { simulateCash } from "@/lib/sim/cashEngine";
import { DEFAULT_CASH_INPUT } from "@/lib/sim/cashInput";
import { shiftCashResultByRakeback } from "./cashTransforms";

describe("shiftCashResultByRakeback", () => {
  it("returns the exact same reference when includeRakeback is true or RB is 0", () => {
    const withRb = simulateCash({
      ...DEFAULT_CASH_INPUT,
      hands: 5_000,
      nSimulations: 100,
      rake: { enabled: true, contributedRakeBb100: 10, advertisedRbPct: 30, pvi: 1 },
    });
    expect(shiftCashResultByRakeback(withRb, true)).toBe(withRb);

    const noRb = simulateCash({
      ...DEFAULT_CASH_INPUT,
      hands: 5_000,
      nSimulations: 100,
      rake: { enabled: false, contributedRakeBb100: 10, advertisedRbPct: 30, pvi: 1 },
    });
    expect(shiftCashResultByRakeback(noRb, false)).toBe(noRb);
  });

  it("linearly removes rakeback from EV, mean, finalBb, envelopes, and hiRes paths", () => {
    const res = simulateCash({
      ...DEFAULT_CASH_INPUT,
      wrBb100: 2,
      sdBb100: 80,
      hands: 10_000,
      nSimulations: 200,
      rake: { enabled: true, contributedRakeBb100: 10, advertisedRbPct: 30, pvi: 1 },
    });
    // RB = 3 bb/100 * 100 = 300 BB
    const shifted = shiftCashResultByRakeback(res, false);
    expect(shifted.stats.expectedEvBb).toBeCloseTo(res.stats.expectedEvBb - 300, 9);
    expect(shifted.stats.meanFinalBb).toBeCloseTo(res.stats.meanFinalBb - 300, 9);
    expect(shifted.stats.effectiveWrBb100).toBeCloseTo(2, 9);
    const lastIdx = shifted.hiResEnvelopes.mean.length - 1;
    expect(shifted.hiResEnvelopes.mean[lastIdx]).toBeCloseTo(
      res.hiResEnvelopes.mean[lastIdx] - 300,
      9,
    );
    expect(shifted.samplePaths.realBestPath[lastIdx]).toBeCloseTo(
      res.samplePaths.realBestPath[lastIdx] - 300,
      9,
    );
  });
});
