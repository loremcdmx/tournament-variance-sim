import { describe, expect, it } from "vitest";

import { buildBattleRoyaleLeaderboardPromoConfig } from "@/lib/sim/battleRoyaleLeaderboardUi";
import { compileSchedule } from "@/lib/sim/engine";
import { applyItmTarget } from "@/lib/sim/itmTarget";
import { validateSchedule } from "@/lib/sim/validation";
import { buildSimulationInput } from "@/lib/ui/simulationInput";

import { SCENARIOS } from "./scenarios";

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

  // The run path: the schedule goes through applyItmTarget (which gives every
  // row a fixed ITM) and the controls through the basic-mode sanitizer unless
  // advanced is on, then validation and compile see exactly that input.
  describe.each([false, true])("run path, advanced=%s", (advanced) => {
    it.each(SCENARIOS)("%s validates and compiles", (scenario) => {
      const schedule = applyItmTarget(scenario.schedule, {
        enabled: scenario.controls.itmGlobalEnabled,
        pct: scenario.controls.itmGlobalPct,
      });
      const input = buildSimulationInput(schedule, scenario.controls, advanced);

      const feasibility = validateSchedule(schedule, input.finishModel);
      expect(feasibility.ok).toBe(true);

      const compiled = compileSchedule({ ...input, samples: 32 });
      expect(compiled.tournamentsPerSample).toBeGreaterThan(0);
      expect(compiled.tournamentsPerPass).toBeGreaterThan(0);
      expect(compiled.totalBuyIn).toBeGreaterThan(0);
      expect(Number.isFinite(compiled.expectedProfit)).toBe(true);
    });
  });
});
