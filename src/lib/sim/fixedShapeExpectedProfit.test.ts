import { describe, expect, it } from "vitest";
import { compileSchedule } from "./compile";
import { runSimulation } from "./engine";
import { compiledEntryMoments } from "./scheduleMoments";
import type { FinishModelConfig, SimulationInput, TournamentRow } from "./types";

const row = (over: Partial<TournamentRow> = {}): TournamentRow => ({
  id: "r", players: 300, buyIn: 20, rake: 0.1, roi: 0.1,
  payoutStructure: "mtt-standard", count: 40, ...over,
});

const input = (
  finishModel: FinishModelConfig,
  schedule: TournamentRow[] = [row()],
): SimulationInput => ({
  schedule, scheduleRepeats: 1, samples: 4000, bankroll: 0, seed: 5, finishModel,
});

/** What the finish pmf of each compiled slot really pays, summed over the pass. */
function pmfExpectedProfit(args: SimulationInput): number {
  const compiled = compileSchedule(args);
  return compiled.flat.reduce(
    (sum, entry) => sum + compiledEntryMoments(entry).meanDollar - entry.singleCost,
    0,
  );
}

const FIXED: FinishModelConfig[] = [
  { id: "freeze-realdata-step" },
  { id: "freeze-realdata-linear" },
  { id: "freeze-realdata-tilt", alpha: 0.2 },
  { id: "mystery-realdata-step" },
  { id: "uniform" },
  { id: "empirical", empiricalBuckets: [8, 4, 2, 1, 1, 1, 1, 1, 1, 1] },
];

describe("expected profit of models that do not calibrate to the row ROI", () => {
  it.each(FIXED)("$id reports the profit its own finish pmf pays", (model) => {
    const args = input(model);
    const compiled = compileSchedule(args);
    const fromRoi = compiled.totalBuyIn * 0.1;
    expect(compiled.expectedProfit).toBeCloseTo(pmfExpectedProfit(args), 8);
    expect(Math.abs(compiled.expectedProfit - fromRoi)).toBeGreaterThan(0.02 * compiled.totalBuyIn);
  });

  it("agrees with the simulated mean instead of with the typed ROI", () => {
    const args = {
      ...input({ id: "freeze-realdata-step" }, [row({ players: 1000, buyIn: 50, count: 200 })]),
      samples: 6000,
    };
    const result = runSimulation(args);
    const mcError = result.stats.stdDev / Math.sqrt(result.samples);
    expect(Math.abs(result.stats.mean - result.expectedProfit)).toBeLessThan(4 * mcError);
    expect(Math.abs(result.stats.mean - result.totalBuyIn * 0.1)).toBeGreaterThan(4 * mcError);
  });

  it("changes with the shape, not with the ROI field", () => {
    const low = compileSchedule(input({ id: "freeze-realdata-step" }, [row({ roi: -0.2 })]));
    const high = compileSchedule(input({ id: "freeze-realdata-step" }, [row({ roi: 0.6 })]));
    expect(low.expectedProfit).toBeCloseTo(high.expectedProfit, 8);
  });

  it("a pinned α is a fixed shape too", () => {
    const args = input({ id: "power-law", alpha: 0.4 });
    const compiled = compileSchedule(args);
    expect(compiled.expectedProfit).toBeCloseTo(pmfExpectedProfit(args), 8);
    expect(Math.abs(compiled.expectedProfit - compiled.totalBuyIn * 0.1)).toBeGreaterThan(
      0.02 * compiled.totalBuyIn,
    );
  });

  it("keeps a bounty row on its ROI because the bounty closes the gap", () => {
    const pko = row({ gameType: "pko", bountyFraction: 0.5, payoutStructure: "mtt-gg-bounty" });
    const args = input({ id: "pko-realdata-step" }, [pko]);
    const compiled = compileSchedule(args);
    expect(compiled.expectedProfit).toBeCloseTo(compiled.totalBuyIn * 0.1, 8);
    expect(compiled.expectedProfit).toBeCloseTo(pmfExpectedProfit(args), 8);
  });

  it("adds direct rakeback on top, as before", () => {
    const plain = compileSchedule(input({ id: "freeze-realdata-step" }));
    const withRb = compileSchedule({ ...input({ id: "freeze-realdata-step" }), rakebackFracOfRake: 0.3 });
    expect(withRb.expectedProfit - plain.expectedProfit).toBeCloseTo(
      withRb.expectedDirectRakeback, 8,
    );
  });
});

describe("expected profit of calibrated models is still the typed ROI", () => {
  it.each<FinishModelConfig>([
    { id: "power-law" },
    { id: "linear-skill" },
    { id: "plackett-luce" },
    { id: "powerlaw-realdata-influenced" },
  ])("$id: cost × ROI", (model) => {
    const args = input(model);
    const compiled = compileSchedule(args);
    expect(compiled.expectedProfit).toBeCloseTo(compiled.totalBuyIn * 0.1, 8);
    expect(compiled.expectedProfit).toBeCloseTo(pmfExpectedProfit(args), 6);
  });

  it("holds with a fixed ITM and with a bounty row as well", () => {
    const pko = row({ gameType: "pko", bountyFraction: 0.5, payoutStructure: "mtt-gg-bounty", itmRate: 0.15, roi: 0.25 });
    const compiled = compileSchedule(input({ id: "power-law" }, [pko]));
    expect(compiled.expectedProfit).toBeCloseTo(compiled.totalBuyIn * 0.25, 8);
  });

  it("PrimeDope compare keeps its calibrated target under a fixed-shape model", () => {
    const compiled = compileSchedule(input({ id: "freeze-realdata-step" }), "primedope-binary-itm");
    expect(compiled.expectedProfit).toBeCloseTo(compiled.totalBuyIn * 0.1, 6);
  });
});
