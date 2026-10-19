import { describe, expect, it } from "vitest";
import type { ControlsState } from "@/components/ControlsPanel";
import { SCENARIOS } from "@/lib/scenarios";
import { BASIC_MODE_MAX_SAMPLES } from "@/lib/sim/modelPresets";
import { applyItmTarget } from "@/lib/sim/itmTarget";
import { compileSchedule } from "@/lib/sim/engine";
import type { TournamentRow } from "@/lib/sim/types";
import { buildSimulationInput } from "./simulationInput";

const BASE = SCENARIOS.find((s) => s.id === "primedope-reference")!;
const row: TournamentRow = {
  id: "r1",
  label: "$20 MTT",
  players: 500,
  buyIn: 20,
  rake: 0.1,
  roi: 0.1,
  payoutStructure: "mtt-standard",
  count: 20,
};

function controls(patch: Partial<ControlsState> = {}): ControlsState {
  return {
    ...BASE.controls,
    compareEnabled: true,
    compareMode: "primedope",
    roiShockPerTourney: 0.2,
    tiltFastGain: 0.1,
    tiltFastScale: 5,
    samples: 25_000,
    seed: 7,
    ...patch,
  };
}

describe("buildSimulationInput", () => {
  it("basic mode runs the sanitized controls: no noise channels, no twin pass, samples capped", () => {
    const input = buildSimulationInput([row], controls(), false);
    expect(input.roiShockPerTourney).toBe(0);
    expect(input.tiltFastGain).toBe(0);
    expect(input.compareMode).toBeUndefined();
    expect(input.samples).toBe(BASIC_MODE_MAX_SAMPLES);
  });

  it("advanced mode sends the controls as they stand", () => {
    const input = buildSimulationInput([row], controls(), true);
    expect(input.roiShockPerTourney).toBe(0.2);
    expect(input.tiltFastGain).toBe(0.1);
    expect(input.compareMode).toBe("primedope");
    expect(input.samples).toBe(25_000);
  });

  it("sends the seed as the unsigned 32-bit value the hot loop uses", () => {
    expect(buildSimulationInput([row], controls({ seed: -5 }), true).seed).toBe(4294967291);
    expect(buildSimulationInput([row], controls({ seed: 2 ** 32 + 9 }), true).seed).toBe(9);
  });

  it("sends an alpha only for a model that reads it, and buckets only for the empirical model", () => {
    const tilt = buildSimulationInput(
      [row],
      controls({ finishModelId: "pko-realdata-tilt", alphaOverride: 0.2 }),
      true,
    );
    expect(tilt.finishModel).toEqual({ id: "pko-realdata-tilt", alpha: 0.2, empiricalBuckets: undefined });
    const powerLaw = buildSimulationInput(
      [row],
      controls({ finishModelId: "power-law", alphaOverride: 0.2, empiricalBuckets: [1, 2, 3] }),
      true,
    );
    expect(powerLaw.finishModel.alpha).toBeUndefined();
    expect(powerLaw.finishModel.empiricalBuckets).toBeUndefined();
    const empirical = buildSimulationInput(
      [row],
      controls({ finishModelId: "empirical", empiricalBuckets: [1, 2, 3] }),
      true,
    );
    expect(empirical.finishModel.empiricalBuckets).toEqual([1, 2, 3]);
  });

  it("runs the schedule it is given: a row's blank ITM reaches the engine as the stamped default", () => {
    const stamped = applyItmTarget([row], { enabled: false, pct: 0 });
    expect(row.itmRate).toBeUndefined();
    expect(stamped[0].itmRate).toBeGreaterThan(0);

    const input = buildSimulationInput(stamped, controls(), true);
    expect(input.schedule).toBe(stamped);
    expect(compileSchedule(input).flat[0].itm).toBeCloseTo(stamped[0].itmRate!, 12);

    // The same row sent raw is calibrated without a pinned ITM, so the two inputs
    // are different runs; the run path must be the stamped one.
    const raw = buildSimulationInput([row], controls(), true);
    expect(compileSchedule(raw).flat[0].itm).not.toBeCloseTo(stamped[0].itmRate!, 6);
  });

  it("the global ITM target reaches the engine through the stamped schedule", () => {
    const stamped = applyItmTarget([row], { enabled: true, pct: 20 });
    const input = buildSimulationInput(stamped, controls(), true);
    expect(compileSchedule(input).flat[0].itm).toBeCloseTo(0.2, 12);
  });
});
