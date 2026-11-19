import { describe, expect, it } from "vitest";
import { compileSchedule } from "./compile";
import { countScheduleTournaments } from "./scheduleTarget";
import { validateSchedule } from "./validation";
import type { FinishModelConfig, SimulationInput, TournamentRow } from "./types";

const model: FinishModelConfig = { id: "power-law" };

function row(id: string, count: number): TournamentRow {
  return {
    id,
    players: 100,
    buyIn: 10,
    rake: 0.1,
    roi: 0.1,
    payoutStructure: "mtt-standard",
    gameType: "freezeout",
    count,
  };
}

function compile(schedule: TournamentRow[], scheduleRepeats = 50) {
  const args: SimulationInput = {
    schedule,
    scheduleRepeats,
    samples: 10,
    bankroll: 0,
    seed: 1,
    finishModel: model,
  };
  return compileSchedule(args);
}

describe("how many times compile plays a row per pass", () => {
  it("plays a row whose count is below 1 once, like a count of 1", () => {
    const one = compile([row("a", 1)]);
    for (const count of [0, 0.5, 0.999]) {
      const compiled = compile([row("a", count)]);
      expect(compiled.flat).toHaveLength(one.flat.length);
      expect(compiled.totalBuyIn).toBe(one.totalBuyIn);
      expect(compiled.rowCounts).toEqual(one.rowCounts);
    }
    expect(one.flat).toHaveLength(50);
    expect(one.totalBuyIn).toBe(50 * 11);
  });

  it("floors a fractional count", () => {
    expect(compile([row("a", 2.7)]).rowCounts).toEqual([100]);
    expect(compile([row("a", 2.7)], 1).rowCounts).toEqual([2]);
  });

  it("agrees with the tournament count the target field shows", () => {
    const schedule = [row("a", 0), row("b", 0.5), row("c", 2.7), row("d", 4)];
    expect(compile(schedule, 1).tournamentsPerPass).toBe(countScheduleTournaments(schedule));
  });
});

describe("a row with a Field-size range raises one calibration notice", () => {
  // The run plays the mixture of the sizes, and the notice quotes what the
  // expected profit reads: the row's mean over them. One notice per size
  // would repeat the row in the results' list.
  const ranged = (over: Partial<TournamentRow>): TournamentRow => ({
    ...row("ranged", 1),
    ...over,
    fieldVariability: { kind: "uniform", min: over.players! * 0.6, max: over.players! * 1.4 + 1, buckets: 3 },
  });
  const once = (input: Omit<SimulationInput, "scheduleRepeats" | "samples" | "bankroll" | "seed">, mode: "alpha" | "primedope-binary-itm") =>
    compileSchedule({ scheduleRepeats: 1, samples: 1, bankroll: 0, seed: 1, ...input }, mode);

  it("in the main pass, where every size misses its pinned ITM's target", () => {
    const r = ranged({ players: 9, roi: -0.3, itmRate: 0.12 });
    const compiled = once({ schedule: [r], finishModel: model }, "alpha");
    const means = compiled.flat[0].variants!.map((v) => v.analyticMeanSingle);
    expect(means).toHaveLength(3);
    for (const m of means) expect(Math.abs(m / 7.7 - 1)).toBeGreaterThan(0.05);

    expect(compiled.calibrationWarnings).toHaveLength(1);
    const [warning] = compiled.calibrationWarnings!;
    expect(warning).toMatchObject({ rowId: "ranged", kind: "target-unreachable" });
    expect(warning.targetWinnings).toBeCloseTo(7.7, 12);
    expect(warning.actualWinnings).toBeCloseTo(means.reduce((a, b) => a + b, 0) / 3, 12);
    expect(warning.actualWinnings).toBeCloseTo(compiled.expectedProfit + compiled.totalBuyIn, 12);
  });

  it("in the PrimeDope pass of a row Run accepts", () => {
    const r = ranged({ players: 45, roi: 0.6 });
    const linear: FinishModelConfig = { id: "linear-skill" };
    expect(validateSchedule([r], linear).ok).toBe(true);
    const compiled = once(
      { schedule: [r], finishModel: linear, usePrimedopeFinishModel: false },
      "primedope-binary-itm",
    );
    expect(compiled.flat[0].variants).toHaveLength(3);
    expect(compiled.calibrationWarnings).toHaveLength(1);
    const [warning] = compiled.calibrationWarnings!;
    expect(warning).toMatchObject({ rowId: "ranged", kind: "primedope-free-itm-unreachable" });
    expect(warning.actualWinnings).toBeCloseTo(compiled.expectedProfit + compiled.totalBuyIn, 12);
  });

  it("leaves a fixed-field row's notice as the entry raised it", () => {
    const r = { ...row("fixed", 1), players: 9, roi: -0.3, itmRate: 0.12 };
    const compiled = once({ schedule: [r], finishModel: model }, "alpha");
    expect(compiled.calibrationWarnings).toEqual([compiled.flat[0].calibrationWarning]);
  });
});
