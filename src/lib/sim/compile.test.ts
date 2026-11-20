import { describe, expect, it } from "vitest";
import { compileSchedule } from "./compile";
import { withinTargetEv } from "./finishModel";
import { countScheduleTournaments } from "./scheduleTarget";
import { validateSchedule } from "./validation";
import type { CompiledEntry } from "./engineTypes";
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
  // One notice per size would repeat the row in the results' list. It names
  // the size that misses the most, the one validateSchedule reports: the run
  // plays the mixture of the sizes, but sizes that miss in opposite directions
  // can average out to the target.
  const ranged = (over: Partial<TournamentRow>): TournamentRow => ({
    ...row("ranged", 1),
    ...over,
    fieldVariability: { kind: "uniform", min: over.players! * 0.6, max: over.players! * 1.4 + 1, buckets: 3 },
  });
  const once = (input: Omit<SimulationInput, "scheduleRepeats" | "samples" | "bankroll" | "seed">, mode: "alpha" | "primedope-binary-itm") =>
    compileSchedule({ scheduleRepeats: 1, samples: 1, bankroll: 0, seed: 1, ...input }, mode);
  const worstOf = (entries: CompiledEntry[], target: number) =>
    entries.reduce((a, b) =>
      Math.abs(b.analyticMeanSingle - target) > Math.abs(a.analyticMeanSingle - target) ? b : a);

  it("in the main pass, where every size misses its pinned ITM's target", () => {
    const r = ranged({ players: 9, roi: -0.3, itmRate: 0.12 });
    const compiled = once({ schedule: [r], finishModel: model }, "alpha");
    const variants = compiled.flat[0].variants!;
    expect(variants).toHaveLength(3);
    for (const v of variants) expect(Math.abs(v.analyticMeanSingle / 7.7 - 1)).toBeGreaterThan(0.05);

    expect(compiled.calibrationWarnings).toHaveLength(1);
    const [warning] = compiled.calibrationWarnings!;
    const worst = worstOf(variants, 7.7);
    expect(warning).toMatchObject({ rowId: "ranged", kind: "target-unreachable", fieldSize: worst.fieldSize });
    expect(warning.targetWinnings).toBeCloseTo(7.7, 12);
    expect(warning.actualWinnings).toBe(worst.analyticMeanSingle);
    const issue = validateSchedule([r], model).issues[0];
    expect(issue.targetEv).toBeCloseTo(warning.targetWinnings, 9);
    expect(issue.currentEv).toBeCloseTo(warning.actualWinnings, 9);
    // The expected profit still reads the mixture the run plays.
    const mixture = variants.reduce((a, v) => a + v.analyticMeanSingle, 0) / 3;
    expect(compiled.expectedProfit + compiled.totalBuyIn).toBeCloseTo(mixture, 12);
  });

  it("names the size that misses when the sizes miss in opposite directions", () => {
    // Sizes 13 / 28 / 43 at a pinned 12 % ITM and ROI +30 % play $15.60 /
    // $12.98 / $14.30 against $14.30, so their mixture, $14.29, is inside the
    // 0.1 % on-target tolerance: quoting it said the model could not reach
    // $14.30 next to $14.29.
    const r: TournamentRow = {
      ...row("opposite", 1), players: 28, roi: 0.3, itmRate: 0.12,
      fieldVariability: { kind: "uniform", min: 5, max: 50, buckets: 3 },
    };
    const compiled = once({ schedule: [r], finishModel: model }, "alpha");
    const variants = compiled.flat[0].variants!;
    expect(variants.map((v) => v.fieldSize)).toEqual([13, 28, 43]);
    const mixture = variants.reduce((a, v) => a + v.analyticMeanSingle, 0) / 3;
    expect(withinTargetEv(mixture, 14.3)).toBe(true);
    expect(compiled.calibrationWarnings).toHaveLength(1);
    const [warning] = compiled.calibrationWarnings!;
    expect(warning).toMatchObject({ rowId: "opposite", kind: "target-unreachable", fieldSize: 28 });
    expect(warning.targetWinnings).toBeCloseTo(14.3, 12);
    expect(warning.actualWinnings).toBeCloseTo(12.978, 3);
    const issue = validateSchedule([r], model).issues[0];
    expect(issue.currentEv).toBeCloseTo(warning.actualWinnings, 9);
  });

  it("in the PrimeDope pass of a row Run accepts", () => {
    const r = ranged({ players: 45, roi: 0.6 });
    const linear: FinishModelConfig = { id: "linear-skill" };
    expect(validateSchedule([r], linear).ok).toBe(true);
    const compiled = once(
      { schedule: [r], finishModel: linear, usePrimedopeFinishModel: false },
      "primedope-binary-itm",
    );
    const variants = compiled.flat[0].variants!;
    expect(variants).toHaveLength(3);
    expect(compiled.calibrationWarnings).toHaveLength(1);
    const [warning] = compiled.calibrationWarnings!;
    const worst = worstOf(variants, warning.targetWinnings);
    expect(warning).toMatchObject({
      rowId: "ranged", kind: "primedope-free-itm-unreachable", fieldSize: worst.fieldSize,
    });
    expect(warning.actualWinnings).toBe(worst.analyticMeanSingle);
  });

  it("in the PrimeDope pass, where the sizes' mean lands on target", () => {
    // Sizes 13 / 28 / 43 at a pinned 69 % ITM and ROI +138 % play $18.00 /
    // $31.88 / $28.66 against $26.18; their mixture is $26.180.
    const r: TournamentRow = {
      ...row("pd", 1), players: 28, roi: 1.38, itmRate: 0.69,
      fieldVariability: { kind: "uniform", min: 5, max: 50, buckets: 3 },
    };
    const compiled = once(
      { schedule: [r], finishModel: { id: "linear-skill" }, usePrimedopeFinishModel: false },
      "primedope-binary-itm",
    );
    const variants = compiled.flat[0].variants!;
    expect(variants.map((v) => v.fieldSize)).toEqual([13, 28, 43]);
    expect(withinTargetEv(variants.reduce((a, v) => a + v.analyticMeanSingle, 0) / 3, 26.18)).toBe(true);
    const [warning] = compiled.calibrationWarnings!;
    expect(warning).toMatchObject({ kind: "primedope-free-itm-unreachable", fieldSize: 13 });
    expect(warning.actualWinnings).toBeCloseTo(18, 6);
  });

  it("leaves a fixed-field row's notice as the entry raised it", () => {
    const r = { ...row("fixed", 1), players: 9, roi: -0.3, itmRate: 0.12 };
    const compiled = once({ schedule: [r], finishModel: model }, "alpha");
    expect(compiled.calibrationWarnings).toEqual([compiled.flat[0].calibrationWarning]);
    expect(compiled.calibrationWarnings![0].fieldSize).toBeUndefined();
  });
});
