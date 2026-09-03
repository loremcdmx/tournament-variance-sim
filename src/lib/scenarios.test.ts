import { describe, expect, it } from "vitest";

import type { ControlsState } from "@/components/ControlsPanel";
import {
  DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS,
  buildBattleRoyaleLeaderboardPromoConfig,
} from "@/lib/sim/battleRoyaleLeaderboardUi";
import { compileSchedule } from "@/lib/sim/engine";
import type { SimulationInput } from "@/lib/sim/types";
import { validateSchedule } from "@/lib/sim/validation";

import { SCENARIOS } from "./scenarios";

function buildInputFromScenario(
  schedule: SimulationInput["schedule"],
  controls: ControlsState,
): SimulationInput {
  return {
    schedule,
    scheduleRepeats: controls.scheduleRepeats,
    samples: 32,
    bankroll: controls.bankroll,
    seed: controls.seed,
    finishModel: {
      id: controls.finishModelId,
      alpha: controls.alphaOverride ?? undefined,
      empiricalBuckets:
        controls.finishModelId === "empirical"
          ? controls.empiricalBuckets
          : undefined,
    },
    usePrimedopePayouts: controls.usePrimedopePayouts,
    usePrimedopeFinishModel: controls.usePrimedopeFinishModel,
    usePrimedopeRakeMath: controls.usePrimedopeRakeMath,
    compareMode: controls.compareEnabled ? controls.compareMode : undefined,
    modelPresetId: controls.modelPresetId,
    roiStdErr: controls.roiStdErr,
    roiShockPerTourney: controls.roiShockPerTourney,
    roiShockPerSession: controls.roiShockPerSession,
    roiDriftSigma: controls.roiDriftSigma,
    tiltFastGain: controls.tiltFastGain,
    tiltFastScale: controls.tiltFastScale,
    tiltSlowGain: controls.tiltSlowGain,
    tiltSlowThreshold: controls.tiltSlowThreshold,
    tiltSlowMinDuration: controls.tiltSlowMinDuration,
    tiltSlowRecoveryFrac: controls.tiltSlowRecoveryFrac,
    rakebackFracOfRake: controls.rakebackPct / 100,
    battleRoyaleLeaderboardPromo: buildBattleRoyaleLeaderboardPromoConfig(
      controls.battleRoyaleLeaderboard ??
        DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS,
      schedule,
    ),
  };
}

describe("demo scenarios", () => {
  it("keep unique ids", () => {
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
  });

  it("only enables PrimeDope comparison on explicit comparison examples", () => {
    const enabled = SCENARIOS.filter((s) => s.controls.compareEnabled).map(
      (s) => s.id,
    );

    expect(enabled).toEqual(["primedope-reference", "small-field-topreg"]);
  });

  it("activates the Battle Royale promo layer wherever the blurb promises one", () => {
    const promising = SCENARIOS.filter((s) =>
      /leaderboard|promo|BR-поинт/i.test(s.description),
    ).map((s) => s.id);
    expect(promising).toEqual(["br-leaderboard", "mixed-gg-with-br"]);
    for (const id of promising) {
      const scenario = SCENARIOS.find((s) => s.id === id)!;
      const promo = buildBattleRoyaleLeaderboardPromoConfig(
        scenario.controls.battleRoyaleLeaderboard,
        scenario.schedule,
      );
      expect(promo, id).toBeDefined();
      expect(promo?.mode, id).toBe("observed");
    }
  });

  it.each(SCENARIOS)("%s validates and compiles", (scenario) => {
    const finishModel = {
      id: scenario.controls.finishModelId,
      alpha: scenario.controls.alphaOverride ?? undefined,
      empiricalBuckets:
        scenario.controls.finishModelId === "empirical"
          ? scenario.controls.empiricalBuckets
          : undefined,
    } as const;

    const feasibility = validateSchedule(scenario.schedule, finishModel);
    expect(feasibility.ok).toBe(true);

    const compiled = compileSchedule(
      buildInputFromScenario(scenario.schedule, scenario.controls),
    );
    expect(compiled.tournamentsPerSample).toBeGreaterThan(0);
    expect(compiled.tournamentsPerPass).toBeGreaterThan(0);
    expect(compiled.totalBuyIn).toBeGreaterThan(0);
    expect(Number.isFinite(compiled.expectedProfit)).toBe(true);
  });
});
