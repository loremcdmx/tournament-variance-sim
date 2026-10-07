import { describe, expect, it } from "vitest";
import { compileSchedule } from "./compile";
import { runSimulation } from "./engine";
import { compiledEntryMoments } from "./scheduleMoments";
import type { SimulationInput, TournamentRow } from "./types";

const ocean: TournamentRow = {
  id: "ocean", players: 1000, buyIn: 92, rake: 8 / 92,
  bountyFraction: 50 / 92, gameType: "ocean-ko", roi: 0.1,
  payoutStructure: "mtt-gg-bounty", count: 1,
};

function input(schedule: TournamentRow[]): SimulationInput {
  return {
    schedule, scheduleRepeats: 1, samples: 4, bankroll: 1000,
    seed: 91876, finishModel: { id: "power-law" },
  };
}

describe("Ocean schedule diagnostic upper bound", () => {
  it("integrates every field-size variant instead of inheriting the first field", () => {
    const args = input([{
      ...ocean,
      fieldVariability: { kind: "uniform", min: 18, max: 2000, buckets: 2 },
    }]);
    const parent = compileSchedule(args).flat[0];
    const moments = parent.variants!.map(compiledEntryMoments);
    const mean = moments.reduce((sum, m) => sum + m.meanDollar, 0) / moments.length;
    const second = moments.reduce((sum, m) => sum + m.secondDollar, 0) / moments.length;
    const expected = Math.sqrt(second - mean * mean);
    expect(Math.abs(expected - parent.sigmaSingleAnalytic)).toBeGreaterThan(1);
    const result = runSimulation(args);
    expect(result.stats.sigmaPerTournamentAnalytic).toBeCloseTo(expected, 8);
    expect(result.stats.sigmaPerTournamentAnalyticKind).toBe("upper-bound");
  });

  it("includes Mystery tail variance in a mixed Ocean schedule", () => {
    const args = input([
      { ...ocean, players: 18 },
      { ...ocean, id: "mystery", gameType: "mystery", mysteryBountyVariance: 10, count: 3 },
    ]);
    const compiled = compileSchedule(args);
    const expectedVariance = compiled.flat.reduce((sum, entry) => {
      const m = compiledEntryMoments(entry);
      return sum + m.secondDollar - m.meanDollar ** 2;
    }, 0) / compiled.flat.length;
    const legacySigma = Math.sqrt(compiled.flat.reduce(
      (sum, entry) => sum + entry.sigmaSingleAnalytic ** 2, 0,
    ) / compiled.flat.length);
    const result = runSimulation(args);
    expect(result.stats.sigmaPerTournamentAnalytic).toBeCloseTo(Math.sqrt(expectedVariance), 8);
    expect(result.stats.sigmaPerTournamentAnalytic).toBeGreaterThan(legacySigma * 5);
    expect(result.stats.sigmaPerTournamentAnalyticKind).toBe("upper-bound");
  });

  it("preserves the existing diagnostic contract for schedules without Ocean", () => {
    const args = input([{ ...ocean, gameType: "mystery", mysteryBountyVariance: 2 }]);
    const compiled = compileSchedule(args);
    const result = runSimulation(args);
    expect(result.stats.sigmaPerTournamentAnalytic).toBe(compiled.flat[0].sigmaSingleAnalytic);
    expect(result.stats.sigmaPerTournamentAnalyticKind).toBeUndefined();
  });

  it("does not label an Ocean row with zero bounty as an adaptive-wheel upper bound", () => {
    const args = input([{ ...ocean, bountyFraction: 0 }]);
    const compiled = compileSchedule(args);
    expect(compiled.flat[0].oceanKo).toBeNull();
    const result = runSimulation(args);
    expect(result.stats.sigmaPerTournamentAnalyticKind).toBeUndefined();
    expect(result.stats.sigmaPerTournamentAnalytic).toBe(compiled.flat[0].sigmaSingleAnalytic);
  });
});
