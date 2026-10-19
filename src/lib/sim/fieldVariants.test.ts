import { describe, expect, it } from "vitest";
import { compileSchedule } from "./engine";
import { compileRowVariants } from "./compileEntry";
import {
  fieldRangeMidpoint,
  fieldVariantSizes,
  isFieldRangeActive,
  withRangeMidpointPlayers,
} from "./fieldVariants";
import { normalizeGameTypeConsistency } from "./gameType";
import { applyItmTarget, equilibriumItmRateForRow } from "./itmTarget";
import { derivePreviewRowEconomics } from "./previewRowEconomics";
import type {
  FieldVariability,
  FinishModelConfig,
  SimulationInput,
  TournamentRow,
} from "./types";

const model: FinishModelConfig = { id: "power-law" };

const row = (over: Partial<TournamentRow> = {}): TournamentRow => ({
  id: "r1",
  players: 500,
  buyIn: 20,
  rake: 0.1,
  roi: 0.1,
  payoutStructure: "mtt-standard",
  gameType: "freezeout",
  count: 1,
  ...over,
});

const uniform = (min: number, max: number, buckets?: number): FieldVariability => ({
  kind: "uniform",
  min,
  max,
  buckets,
});

describe("fieldVariantSizes", () => {
  it("is the nominal field for a fixed row, with or without a fixed marker", () => {
    expect(fieldVariantSizes(row())).toEqual([500]);
    expect(fieldVariantSizes(row({ fieldVariability: { kind: "fixed" } }))).toEqual([500]);
  });

  it("splits a range into equal-width buckets and plays each bucket's midpoint", () => {
    expect(fieldVariantSizes(row({ fieldVariability: uniform(300, 700, 5) }))).toEqual([
      340, 420, 500, 580, 660,
    ]);
  });

  it("defaults to five buckets", () => {
    expect(fieldVariantSizes(row({ fieldVariability: uniform(300, 700) }))).toHaveLength(5);
  });

  it("does not care which end is typed first", () => {
    expect(fieldVariantSizes(row({ fieldVariability: uniform(700, 300, 5) }))).toEqual(
      fieldVariantSizes(row({ fieldVariability: uniform(300, 700, 5) })),
    );
  });

  it("clamps the low end to two entrants", () => {
    const sizes = fieldVariantSizes(row({ fieldVariability: uniform(-10, 10, 2) }));
    expect(sizes).toEqual([4, 8]);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(2);
  });

  it("collapses to the midpoint with one bucket or a degenerate range", () => {
    expect(fieldVariantSizes(row({ fieldVariability: uniform(300, 700, 1) }))).toEqual([500]);
    expect(fieldVariantSizes(row({ fieldVariability: uniform(640, 640, 5) }))).toEqual([640]);
  });

  it("treats a range with a non-finite end as no range, like a reload does", () => {
    expect(fieldVariantSizes(row({ fieldVariability: uniform(Number.NaN, 700, 5) }))).toEqual([500]);
    expect(fieldVariantSizes(row({ fieldVariability: uniform(300, Infinity, 5) }))).toEqual([500]);
    expect(isFieldRangeActive(row({ fieldVariability: uniform(Number.NaN, 700, 5) }))).toBe(false);
  });
});

describe("fieldRangeMidpoint", () => {
  it("is the middle of the range and null for a fixed field", () => {
    expect(fieldRangeMidpoint(row({ fieldVariability: uniform(300, 700, 5) }))).toBe(500);
    expect(fieldRangeMidpoint(row({ fieldVariability: uniform(300, 701, 5) }))).toBe(501);
    expect(fieldRangeMidpoint(row())).toBeNull();
    expect(fieldRangeMidpoint(row({ fieldVariability: { kind: "fixed" } }))).toBeNull();
  });
});

describe("the engine plays exactly the sizes the helper lists", () => {
  it.each([
    ["default bucket count", 300, 700, undefined, 1],
    ["seven buckets", 100, 3000, 7, 1],
    ["two buckets", 18, 100, 2, 1],
    ["one bucket", 300, 700, 1, 1],
    ["late registration", 200, 800, 4, 1.5],
    ["reversed ends", 900, 300, 3, 1],
  ])("%s", (_name, min, max, buckets, lateReg) => {
    const r = row({
      players: 5000,
      lateRegMultiplier: lateReg,
      fieldVariability: uniform(min, max, buckets),
    });
    const variants = compileRowVariants(r, 0, model, "alpha", false, false);
    const sizes = fieldVariantSizes(r);
    expect(variants.map((v) => v.entry.fieldSize)).toEqual(
      sizes.map((s) => Math.floor(s * lateReg)),
    );
    for (const v of variants) expect(v.share).toBeCloseTo(1 / sizes.length, 15);
  });

  it("plays the nominal field of a fixed row", () => {
    const variants = compileRowVariants(row(), 0, model, "alpha", false, false);
    expect(variants).toHaveLength(1);
    expect(variants[0].entry.fieldSize).toBe(500);
    expect(variants[0].share).toBe(1);
  });
});

describe("the effective row reads its field from the range", () => {
  const ranged = (players: number) =>
    row({
      players,
      payoutStructure: "mtt-gg",
      fieldVariability: uniform(300, 700, 5),
    });

  it("moves a stale nominal field to the midpoint and leaves everything else alone", () => {
    const fixed = row();
    expect(withRangeMidpointPlayers(fixed)).toBe(fixed);
    const aligned = ranged(500);
    expect(withRangeMidpointPlayers(aligned)).toBe(aligned);
    expect(withRangeMidpointPlayers(ranged(5000))).toEqual({ ...ranged(5000), players: 500 });
    expect(normalizeGameTypeConsistency(ranged(5000)).players).toBe(500);
    expect(normalizeGameTypeConsistency(ranged(500))).toEqual(ranged(500));
  });

  it("gives the preview, payout card and paid-place count the midpoint field", () => {
    const [effective] = applyItmTarget([ranged(5000)], { enabled: false, pct: 0 });
    expect(derivePreviewRowEconomics(effective).fieldSize).toBe(500);
  });

  it("derives the equilibrium ITM default from the midpoint, not the dead AFS box", () => {
    const atMidpoint = equilibriumItmRateForRow(ranged(500));
    expect(atMidpoint).toBeGreaterThan(0);
    // mtt-gg pays a different share at 100 and at 500 entrants, so a stale AFS
    // would have shown up as a different default.
    expect(equilibriumItmRateForRow({ ...ranged(100), fieldVariability: undefined })).not.toBeCloseTo(
      atMidpoint,
      4,
    );
    expect(equilibriumItmRateForRow(ranged(100))).toBe(atMidpoint);
    expect(equilibriumItmRateForRow(ranged(5000))).toBe(atMidpoint);
    const [effective] = applyItmTarget([ranged(100)], { enabled: false, pct: 0 });
    expect(effective.itmRate).toBe(atMidpoint);
  });

  it("does not change what the engine compiles when the nominal field is already the midpoint", () => {
    const input = (r: TournamentRow): SimulationInput => ({
      schedule: [r],
      scheduleRepeats: 1,
      samples: 1,
      bankroll: 0,
      seed: 1,
      finishModel: model,
    });
    const aligned = ranged(500);
    const before = compileSchedule(input(aligned), "alpha");
    const after = compileSchedule(input(normalizeGameTypeConsistency(aligned)), "alpha");
    expect(after.flat).toEqual(before.flat);
    expect(after.expectedProfit).toBe(before.expectedProfit);
    expect(after.itmRate).toBe(before.itmRate);
  });

  it("compiles the same variants whatever the dead nominal field says", () => {
    const input = (r: TournamentRow): SimulationInput => ({
      schedule: [{ ...r, itmRate: 0.15 }],
      scheduleRepeats: 1,
      samples: 1,
      bankroll: 0,
      seed: 1,
      finishModel: model,
    });
    const stale = compileSchedule(input(ranged(5000)), "alpha");
    const aligned = compileSchedule(input(ranged(500)), "alpha");
    expect(stale.flat).toEqual(aligned.flat);
  });
});
