import { afterEach, describe, expect, it, vi } from "vitest";
import * as compilation from "../sim/compile";
import * as grids from "../sim/grids";
import { simulateDownsideShard, simulateShard } from "../sim/hotLoop";
import {
  buildFormatComparisonMoments, buildFormatComparisonScenarios,
  compileFormatComparison, FORMAT_COMPARISON_DEFAULTS, FORMAT_COMPARISON_LIMITS, summarizeFormatComparisonScenario,
} from "./formatComparison";

afterEach(() => vi.restoreAllMocks());

describe("comparison execution without unused calculator collectors", () => {
  it("executes the full expanded field and distance without truncating the report", () => {
    const config = {
      ...FORMAT_COMPARISON_DEFAULTS,
      players: FORMAT_COMPARISON_LIMITS.players.max,
      distance: FORMAT_COMPARISON_LIMITS.distance.max,
    };
    for (const { scenario, compiled, moments } of compileFormatComparison(config)) {
      expect(compiled.flat[0].fieldSize).toBe(scenario.comparable ? config.players : 18);
      expect(compiled.tournamentsPerSample).toBe(config.distance);
      const input = { ...scenario.input, samples: 2 };
      const grid = grids.makeCheckpointGrid(compiled.tournamentsPerSample);
      const raw = simulateDownsideShard(input, compiled, 0, input.samples, grid);
      const summary = summarizeFormatComparisonScenario({ ...scenario, input }, compiled, raw, grid, moments);
      expect(summary.distance).toBe(config.distance);
      expect(summary.samples).toBe(input.samples);
      expect(summary.downsideCurve.at(-1)?.entries).toBe(config.distance);
      expect(summary.downsideCurve).toHaveLength(201);
      expect(summary.expectedProfitBI).toBeCloseTo(config.roi * config.distance, 3);
      expect(raw.finalProfits.every(Number.isFinite)).toBe(true);
      expect(summary.longestBelowEv.max).toBeLessThanOrEqual(config.distance);
      expect(summary.maxDrawdownBI.max).toBeGreaterThan(0);
    }
    for (const patch of [{ players: config.players + 1 }, { distance: config.distance + 1 }]) {
      expect(() => buildFormatComparisonScenarios({ ...config, ...patch })).toThrow();
    }
  });

  it("compiles five formats once and derives the exact same analytic comparison", () => {
    const config = { ...FORMAT_COMPARISON_DEFAULTS, players: 100, distance: 503 };
    const before = buildFormatComparisonMoments(config);
    const compile = vi.spyOn(compilation, "compileSchedule");
    const prepared = compileFormatComparison(config);
    expect(compile).toHaveBeenCalledTimes(5);
    expect(prepared.map(row => row.moments)).toEqual(before);
  });

  it.each([
    { players: 18, ticket: 1, roi: -0.2, distance: 100, seed: 1 },
    { players: 1000, ticket: 100, roi: 0.1, distance: 503, seed: 20261008 },
    { players: 5000, ticket: 1000, roi: 1, distance: 257, seed: 0xffffffff },
  ])("preserves every summary byte, every entry maximum and all checkpoints for %j", (patch) => {
    const config = { ...FORMAT_COMPARISON_DEFAULTS, ...patch };
    const prepared = compileFormatComparison(config);
    const hiRes = vi.spyOn(grids, "makeHiResGrid");
    for (const { scenario, compiled, moments } of prepared) {
      const input = { ...scenario.input, samples: 128 };
      const grid = grids.makeCheckpointGrid(input.scheduleRepeats);
      const full = simulateShard(input, compiled, 0, input.samples, grid);
      hiRes.mockClear();
      const compact = simulateDownsideShard(input, compiled, 0, input.samples, grid);
      expect(hiRes).not.toHaveBeenCalled();
      expect(compact).toEqual({
        finalProfits: full.finalProfits, pathMatrix: full.pathMatrix,
        maxDrawdowns: full.maxDrawdowns, recoveryLengths: full.recoveryLengths,
        downsideReport: full.downsideReport,
      });
      expect(summarizeFormatComparisonScenario(scenario, compiled, compact, grid, moments))
        .toEqual(summarizeFormatComparisonScenario(scenario, compiled, full, grid, moments));
      expect(full.hiResPaths).toHaveLength(input.samples);
      expect(full.hiResPaths[0].length).toBeGreaterThan(0);
      expect(full.longestBreakevens.some(value => value > 0)).toBe(true);
      if (scenario.format === "ocean-ko" && patch.players >= 1000) {
        expect(full.jackpotMask.some(value => value === 1)).toBe(true);
      }
    }
  });

  it("retains global sample seeds when a compact report starts after sample zero", () => {
    const scenario = buildFormatComparisonScenarios(FORMAT_COMPARISON_DEFAULTS)[3];
    const input = { ...scenario.input, scheduleRepeats: 100, samples: 8 };
    const compiled = compilation.compileSchedule(input);
    const grid = grids.makeCheckpointGrid(input.scheduleRepeats);
    const full = simulateShard(input, compiled, 0, 8, grid);
    const compact = simulateDownsideShard(input, compiled, 3, 8, grid);
    expect(compact.finalProfits).toEqual(full.finalProfits.slice(3));
    expect(compact.pathMatrix).toEqual(full.pathMatrix.slice(3 * (grid.K + 1)));
    expect(compact.maxDrawdowns).toEqual(full.maxDrawdowns.slice(3));
    expect(compact.recoveryLengths).toEqual(full.recoveryLengths.slice(3));
    expect(() => simulateDownsideShard({ ...input, collectDownsideReport: false }, compiled, 0, 8, grid)).toThrow();
  });
});
