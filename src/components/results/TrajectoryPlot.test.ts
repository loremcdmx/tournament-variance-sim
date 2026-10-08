import { describe, expect, it, vi } from "vitest";
import type { SimulationResult } from "@/lib/sim/types";
import { DEFAULT_EXTREME_STYLES, type ExtremeStyles } from "@/lib/lineStyles";
import { computeYRange } from "./TrajectoryPlot";

vi.mock("@/components/charts/UplotChart", () => ({ UplotChart: () => null }));

const array = (...values: number[]) => Float64Array.from(values);
const hiddenExtremes: ExtremeStyles = {
  realBest: { ...DEFAULT_EXTREME_STYLES.realBest, enabled: false },
  realWorst: { ...DEFAULT_EXTREME_STYLES.realWorst, enabled: false },
  aggBest: { ...DEFAULT_EXTREME_STYLES.aggBest, enabled: false },
  aggWorst: { ...DEFAULT_EXTREME_STYLES.aggWorst, enabled: false },
};

function result() {
  return {
    expectedProfit: 3,
    samplePaths: {
      x: [0, 1, 2],
      paths: [array(0, 1, 2)],
      sampleIndices: [0],
      best: array(0, 125, 250),
      worst: array(0, -125, -250),
    },
    envelopes: {
      x: [0, 1, 2],
      mean: array(0, 1, 2),
      p0015: array(0, -50, -100),
      p025: array(0, -20, -40),
      p05: array(0, -12, -24),
      p15: array(0, -5, -10),
      p85: array(0, 5, 10),
      p95: array(0, 12, 24),
      p975: array(0, 20, 40),
      p9985: array(0, 50, 100),
      min: array(0, -150, -300),
      max: array(0, 150, 300),
    },
  } satisfies Pick<SimulationResult, "expectedProfit" | "samplePaths" | "envelopes">;
}

describe("trajectory Y range", () => {
  it("contains the visible upper tail when both best-run toggles are off", () => {
    const range = computeYRange([result()], hiddenExtremes, 100, "random");
    expect(range.max).toBe(116);
    expect(range.max).toBeLessThan(250);
  });

  it("contains the visible lower tail when both worst-run toggles are off", () => {
    const range = computeYRange([result()], hiddenExtremes, 100, "random");
    expect(range.min).toBe(-116);
    expect(range.min).toBeGreaterThan(-250);
  });

  it.each([
    { trim: 0.149, min: -116, max: 116 },
    { trim: 0.15, min: -46.4, max: 46.4 },
    { trim: 2.499, min: -46.4, max: 46.4 },
    { trim: 2.5, min: -11.6, max: 11.6 },
    { trim: 14.999, min: -11.6, max: 11.6 },
    { trim: 15, min: -0.24, max: 3.24 },
  ])("drops hidden bands exactly at trim=$trim percent", ({ trim, min, max }) => {
    const range = computeYRange([result()], hiddenExtremes, 100, "random", trim, trim);
    expect(range.min).toBeCloseTo(min, 10);
    expect(range.max).toBeCloseTo(max, 10);
  });

  it.each([60, -60])("keeps optional p5/p95 and EV=%s inside the zero-run range", (ev) => {
    const data = result();
    data.expectedProfit = ev;
    data.envelopes.mean = array(0, -7, 2);
    const range = computeYRange([data], hiddenExtremes, 0, "random");
    for (const value of [...data.envelopes.p05, ...data.envelopes.p95, ...data.envelopes.mean, ev]) {
      expect(value).toBeGreaterThanOrEqual(range.min);
      expect(value).toBeLessThanOrEqual(range.max);
    }
    expect(range.min).toBeGreaterThan(-100);
    expect(range.max).toBeLessThan(100);
  });

  it("preserves the existing zero-run range when extreme toggles are enabled", () => {
    const allExtremes: ExtremeStyles = {
      realBest: { ...hiddenExtremes.realBest, enabled: true },
      realWorst: { ...hiddenExtremes.realWorst, enabled: true },
      aggBest: { ...hiddenExtremes.aggBest, enabled: true },
      aggWorst: { ...hiddenExtremes.aggWorst, enabled: true },
    };
    expect(computeYRange([result()], allExtremes, 0, "random")).toEqual({ min: -348, max: 348 });
  });

  it("still fits an intermediate peak of an actually visible sample path", () => {
    const data = result();
    data.samplePaths.paths = [array(0, 250, 2)];
    const range = computeYRange([data], hiddenExtremes, 1, "random");
    expect(range.max).toBe(278);
  });
});
