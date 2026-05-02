/**
 * Tests for re-entry math: maxEntries cap + geometric reentryRate formula.
 * The engine treats one row as costing buy-in × (1 + E[re-entries]) per
 * tournament played, where E[re-entries] is a finite geometric sum capped
 * at (maxEntries - 1). Cost contract: target ROI is hit on this gross cost
 * basis.
 */
import { describe, it, expect } from "vitest";
import { runSimulation } from "./engine";
import type { SimulationInput, TournamentRow } from "./types";

function row(overrides: Partial<TournamentRow> = {}): TournamentRow {
  return {
    id: "re",
    label: "reentry probe",
    players: 200,
    buyIn: 10,
    rake: 0.10,
    roi: 0.05,
    payoutStructure: "mtt-standard",
    gameType: "freezeout-reentry",
    count: 1,
    maxEntries: 1,
    ...overrides,
  };
}

function input(overrides: Partial<SimulationInput> = {}): SimulationInput {
  return {
    schedule: [row()],
    scheduleRepeats: 1,
    samples: 50_000,
    bankroll: 1_000_000,
    seed: 13,
    finishModel: { id: "power-law" },
    ...overrides,
  };
}

function meanRoi(result: ReturnType<typeof runSimulation>, costPerTourney: number): number {
  return result.expectedProfit / (costPerTourney * result.tournamentsPerSample) ;
}

const SINGLE_COST = 10 * 1.10;

describe("engine — re-entry math", () => {
  it("single-bullet (maxEntries=1) → cost is exactly singleCost (no re-entry)", () => {
    const r = runSimulation(input());
    expect(meanRoi(r, SINGLE_COST)).toBeCloseTo(0.05, 2);
  });

  it("maxEntries=3, reentryRate=1 → cost = 3 × singleCost (always re-enters until cap)", () => {
    const result = runSimulation(
      input({ schedule: [row({ maxEntries: 3, reentryRate: 1 })] }),
    );
    const expectedCost = SINGLE_COST * 3;
    // ROI hits target on 3-bullet basis
    expect(meanRoi(result, expectedCost)).toBeCloseTo(0.05, 2);
  });

  it("maxEntries=2, reentryRate=0.5 → expected cost = single × (1 + 0.5)", () => {
    // Geometric formula: M=1, p=0.5 → E[reentries] = 0.5 × (1-0.5)/(1-0.5) = 0.5
    const result = runSimulation(
      input({ schedule: [row({ maxEntries: 2, reentryRate: 0.5 })] }),
    );
    const expectedCost = SINGLE_COST * 1.5;
    expect(meanRoi(result, expectedCost)).toBeCloseTo(0.05, 2);
  });

  it("maxEntries=4, reentryRate=0.5 → expected cost matches geometric series sum", () => {
    // M=3, p=0.5 → E[reentries] = 0.5 × (1 - 0.125) / (1 - 0.5) = 0.5 × 1.75 = 0.875
    const result = runSimulation(
      input({ schedule: [row({ maxEntries: 4, reentryRate: 0.5 })] }),
    );
    const expectedReentry = 0.5 * (1 - Math.pow(0.5, 3)) / (1 - 0.5);
    const expectedCost = SINGLE_COST * (1 + expectedReentry);
    expect(meanRoi(result, expectedCost)).toBeCloseTo(0.05, 2);
  });

  it("reentryRate=0 with maxEntries>1 → cost = single (no re-entries)", () => {
    const result = runSimulation(
      input({ schedule: [row({ maxEntries: 5, reentryRate: 0 })] }),
    );
    expect(meanRoi(result, SINGLE_COST)).toBeCloseTo(0.05, 2);
  });

  it("re-entry cap is respected — at maxEntries=2 even reRate=1 stops at 1 re-entry", () => {
    const result = runSimulation(
      input({ schedule: [row({ maxEntries: 2, reentryRate: 1 })] }),
    );
    // E[reentries] = 1 (capped at maxEntries - 1 = 1)
    const expectedCost = SINGLE_COST * 2;
    expect(meanRoi(result, expectedCost)).toBeCloseTo(0.05, 2);
  });

  it("default reentryRate when maxEntries>1 and rate undefined defaults to 1 (always re-enter)", () => {
    const explicit = runSimulation(
      input({ schedule: [row({ maxEntries: 3, reentryRate: 1 })] }),
    );
    const implicit = runSimulation(
      input({ schedule: [row({ maxEntries: 3 })] }),
    );
    // Both should give same expectedProfit (same effective re-entry budget)
    expect(implicit.expectedProfit).toBeCloseTo(explicit.expectedProfit, 6);
  });

  it("invalid reentryRate < 0 throws", () => {
    expect(() =>
      runSimulation(input({ schedule: [row({ reentryRate: -0.1 })] })),
    ).toThrow(/reentryRate/);
  });

  it("invalid reentryRate > 1 throws", () => {
    expect(() =>
      runSimulation(input({ schedule: [row({ reentryRate: 1.5 })] })),
    ).toThrow(/reentryRate/);
  });

  it("invalid maxEntries < 1 throws", () => {
    expect(() =>
      runSimulation(input({ schedule: [row({ maxEntries: 0 })] })),
    ).toThrow(/maxEntries/);
  });

  it("maxEntries=2 / reentryRate=1 vs maxEntries=1: variance per sample changes (multi-bullet absorbs variance)", () => {
    const single = runSimulation(input({ schedule: [row()] }));
    const triple = runSimulation(
      input({ schedule: [row({ maxEntries: 3, reentryRate: 1 })] }),
    );
    let v1 = 0;
    let v3 = 0;
    let m1 = 0;
    let m3 = 0;
    for (let i = 0; i < single.finalProfits.length; i++) {
      m1 += single.finalProfits[i];
      m3 += triple.finalProfits[i];
    }
    m1 /= single.finalProfits.length;
    m3 /= triple.finalProfits.length;
    for (let i = 0; i < single.finalProfits.length; i++) {
      v1 += (single.finalProfits[i] - m1) ** 2;
      v3 += (triple.finalProfits[i] - m3) ** 2;
    }
    v1 /= single.finalProfits.length - 1;
    v3 /= triple.finalProfits.length - 1;
    // Multi-bullet inflates variance because total stake is larger
    expect(v3).toBeGreaterThan(v1);
  });
});
