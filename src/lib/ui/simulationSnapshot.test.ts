import { describe, expect, it } from "vitest";
import type { PersistedState } from "@/lib/persistence";
import type { ControlsState } from "@/components/ControlsPanel";
import type { SimulationInput, SimulationResult } from "@/lib/sim/types";
import { cacheSimulationRun, replacePrimeDopeResult } from "./simulationSnapshot";

const input: SimulationInput = {
  schedule: [{ id: "r", players: 200, buyIn: 50, rake: 0.1, roi: 0.1,
    payoutStructure: "mtt-standard", count: 10, itmRate: 0.15 }],
  samples: 100, scheduleRepeats: 1, bankroll: 0, seed: 42,
  finishModel: { id: "power-law" }, compareMode: "primedope",
  usePrimedopePayouts: true, usePrimedopeFinishModel: true,
  usePrimedopeRakeMath: true,
};
const result = { samples: 100, tournamentsPerSample: 10 } as SimulationResult;
const comparison = { ...result, expectedProfit: 123 };
const source: PersistedState = {
  v: 2,
  schedule: [{ ...input.schedule[0], itmRate: undefined }],
  controls: { seed: 42, bankroll: 0, itmGlobalEnabled: true, itmGlobalPct: 15,
    usePrimedopePayouts: true, usePrimedopeFinishModel: true,
    usePrimedopeRakeMath: true } as ControlsState,
};

describe("completed simulation snapshot", () => {
  it("keeps worker inputs and raw share inheritance when editors change", () => {
    const draftInput = structuredClone(input);
    const draftSource = structuredClone(source);
    const cached = cacheSimulationRun(draftInput, result, draftSource);
    draftInput.bankroll = 100;
    draftInput.schedule[0].count = 20;
    draftSource.controls.bankroll = 100;
    draftSource.schedule[0].count = 20;
    expect(cached.input.bankroll).toBe(0);
    expect(cached.input.schedule[0].count).toBe(10);
    expect(cached.source?.controls.bankroll).toBe(0);
    expect(cached.source?.schedule[0].count).toBe(10);
    expect(cached.source?.schedule[0].itmRate).toBeUndefined();
    expect(cached.input.schedule[0].itmRate).toBe(0.15);
  });

  it("updates the comparison, its flags and seed only for the selected sibling", () => {
    const first = cacheSimulationRun(input, { ...result, comparison }, source);
    const sibling = cacheSimulationRun({ ...input, seed: 7 }, first.result, source);
    const updated = replacePrimeDopeResult(sibling,
      { ...sibling.input, usePrimedopePayouts: false },
      { ...comparison, expectedProfit: 456 }, "comparison");
    expect(updated.result.comparison?.expectedProfit).toBe(456);
    expect(updated.source?.controls.seed).toBe(7);
    expect(updated.source?.controls.usePrimedopePayouts).toBe(false);
    expect(first.source?.controls.usePrimedopePayouts).toBe(true);
    expect(first.result.comparison?.expectedProfit).toBe(123);
    expect(sibling.result.comparison?.expectedProfit).toBe(123);
  });

  it("replaces the primary PD preset without replacing its alpha comparison", () => {
    const cached = cacheSimulationRun({ ...input, modelPresetId: "primedope" },
      { ...result, comparison }, source);
    const updated = replacePrimeDopeResult(cached,
      { ...cached.input, usePrimedopeFinishModel: false },
      { ...result, expectedProfit: 789 }, "primary");
    expect(updated.result.expectedProfit).toBe(789);
    expect(updated.result.comparison).toBe(comparison);
    expect(updated.input.usePrimedopeFinishModel).toBe(false);
    expect(updated.source?.controls.usePrimedopeFinishModel).toBe(false);
  });
});
