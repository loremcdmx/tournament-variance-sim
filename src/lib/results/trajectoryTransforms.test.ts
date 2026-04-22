import { describe, expect, it } from "vitest";
import {
  computeExpectedRakebackCurve,
  shiftResultByRakeback,
  stripJackpots,
} from "./trajectoryTransforms";
import type { SimulationResult, TournamentRow } from "@/lib/sim/types";

function makeRow(overrides: Partial<TournamentRow>): TournamentRow {
  return {
    id: "row",
    players: 100,
    buyIn: 100,
    rake: 0.1,
    roi: 0.1,
    payoutStructure: "mtt-standard",
    count: 1,
    ...overrides,
  };
}

describe("computeExpectedRakebackCurve", () => {
  it("tracks heterogeneous schedules in engine order", () => {
    const schedule: TournamentRow[] = [
      makeRow({ id: "a", count: 1, buyIn: 100, rake: 0.1 }),
      makeRow({ id: "b", count: 2, buyIn: 50, rake: 0.1 }),
    ];

    const curve = computeExpectedRakebackCurve(
      schedule,
      2,
      0.5,
      [0, 1, 2, 3, 4],
    );

    expect(curve).not.toBeNull();
    expect(Array.from(curve ?? [])).toEqual([0, 5, 7.5, 10, 15]);
  });

  it("returns null when rakeback is disabled", () => {
    const curve = computeExpectedRakebackCurve(
      [makeRow({ id: "a" })],
      1,
      0,
      [0, 1],
      false,
    );
    expect(curve).toBeNull();
  });

  it("keeps legacy full direct RB when advanced BR split is off, and reduces only the opted-in BR row when on", () => {
    const schedule: TournamentRow[] = [
      makeRow({
        id: "fr",
        payoutStructure: "mtt-standard",
        gameType: "freezeout",
        buyIn: 100,
        rake: 0.1,
      }),
      makeRow({
        id: "br",
        payoutStructure: "battle-royale",
        gameType: "mystery-royale",
        buyIn: 100,
        rake: 0.1,
        battleRoyaleLeaderboardEnabled: true,
        battleRoyaleLeaderboardShare: 0.25,
      }),
    ];

    const legacy = computeExpectedRakebackCurve(schedule, 1, 0.5, [0, 1, 2], false);
    const split = computeExpectedRakebackCurve(schedule, 1, 0.5, [0, 1, 2], true);

    expect(Array.from(legacy ?? [])).toEqual([0, 5, 10]);
    expect(Array.from(split ?? [])).toEqual([0, 5, 8.75]);
  });
});

describe("stripJackpots", () => {
  it("filters hi-res paths by their global sample indices", () => {
    const keptPath = Float64Array.from([0, 10]);
    const jackpotPath = Float64Array.from([0, 1000]);
    const fallback = Float64Array.from([0, 1000]);
    const result = {
      finalProfits: Float64Array.from([0, 10, 20, 1000]),
      jackpotMask: Uint8Array.from([0, 0, 0, 1]),
      histogram: { binEdges: [0, 1000], counts: [4] },
      samplePaths: {
        x: [0, 1],
        paths: [keptPath, jackpotPath],
        best: jackpotPath,
        worst: keptPath,
        sampleIndices: [1, 3],
      },
      envelopes: {
        x: [0, 1],
        mean: fallback,
        p05: fallback,
        p95: fallback,
        p15: fallback,
        p85: fallback,
        p025: fallback,
        p975: fallback,
        p0015: fallback,
        p9985: fallback,
        min: fallback,
        max: fallback,
      },
    } as unknown as SimulationResult;

    const stripped = stripJackpots(result);

    expect(stripped.samplePaths.sampleIndices).toEqual([1]);
    expect(stripped.samplePaths.paths).toHaveLength(1);
    expect(stripped.samplePaths.paths[0]).toBe(keptPath);
    expect(stripped.samplePaths.best).toBe(keptPath);
    expect(stripped.samplePaths.worst).toBe(keptPath);
    expect(Array.from(stripped.finalProfits)).toEqual([0, 10, 20]);
  });
});

describe("shiftResultByRakeback", () => {
  it("shifts profit scalars without replacing full-sample streak statistics", () => {
    const hist = { binEdges: [-10, 0, 10], counts: [1, 1] };
    const basePath = Float64Array.from([0, 5, 10]);
    const result = {
      expectedProfit: 10,
      histogram: hist,
      drawdownHistogram: { binEdges: [0, 5, 10], counts: [2, 0] },
      longestBreakevenHistogram: { binEdges: [0, 1], counts: [2] },
      recoveryHistogram: { binEdges: [0, 1], counts: [2] },
      stats: {
        mean: 10,
        median: 10,
        min: -10,
        max: 30,
        p01: -10,
        p05: -5,
        p95: 25,
        p99: 30,
        probProfit: 0.5,
        maxDrawdownMean: 99,
        maxDrawdownMedian: 88,
        maxDrawdownP95: 77,
        maxDrawdownP99: 66,
        maxDrawdownWorst: 55,
        longestBreakevenMean: 44,
        breakevenStreakMean: 33,
        recoveryMedian: 22,
        recoveryP90: 11,
        recoveryUnrecoveredShare: 0.25,
        var95: 5,
        var99: 7,
        cvar95: 9,
        cvar99: 11,
      },
      samplePaths: {
        x: [0, 1, 2],
        paths: [basePath],
        best: basePath,
        worst: basePath,
        sampleIndices: [0],
      },
      envelopes: {
        x: [0, 1, 2],
        mean: basePath,
        p05: basePath,
        p95: basePath,
        p15: basePath,
        p85: basePath,
        p025: basePath,
        p975: basePath,
        p0015: basePath,
        p9985: basePath,
        min: basePath,
        max: basePath,
      },
    } as unknown as SimulationResult;

    const shifted = shiftResultByRakeback(result, Float64Array.from([0, 2, 4]), -1);

    expect(shifted.expectedProfit).toBe(6);
    expect(shifted.stats.mean).toBe(6);
    expect(shifted.stats.probProfit).toBeCloseTo(0.3, 12);
    expect(shifted.stats.maxDrawdownMean).toBe(result.stats.maxDrawdownMean);
    expect(shifted.stats.longestBreakevenMean).toBe(
      result.stats.longestBreakevenMean,
    );
    expect(shifted.drawdownHistogram).toBe(result.drawdownHistogram);
    expect(Array.from(shifted.samplePaths.paths[0])).toEqual([0, 3, 6]);
  });
});
