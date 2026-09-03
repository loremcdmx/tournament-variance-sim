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
      makeRow({ id: "a", count: 2, buyIn: 100, rake: 0.1 }),
      makeRow({ id: "b", count: 2, buyIn: 50, rake: 0.1 }),
    ];

    const curve = computeExpectedRakebackCurve(
      schedule,
      1,
      0.5,
      [0, 1, 2, 3, 4],
    );

    expect(curve).not.toBeNull();
    expect(Array.from(curve ?? [])).toEqual([0, 5, 7.5, 12.5, 15]);
  });

  it("returns null when rakeback is disabled", () => {
    const curve = computeExpectedRakebackCurve(
      [makeRow({ id: "a" })],
      1,
      0,
      [0, 1],
    );
    expect(curve).toBeNull();
  });

  it("keeps full direct RB for BR rows regardless of legacy leaderboard flags", () => {
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
        battleRoyaleLeaderboardShare: 1,
      }),
    ];

    const curve = computeExpectedRakebackCurve(schedule, 1, 0.5, [0, 1, 2]);

    expect(Array.from(curve ?? [])).toEqual([0, 5, 10]);
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
      neverBustedMask: new Uint8Array(0),
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
  it("recomputes probUpNeverBusted on the shifted finals, keeping raw bust flags", () => {
    const hist = { binEdges: [-10, 0, 10], counts: [2, 2] };
    const path = Float64Array.from([0, 0, 0]);
    const env = {
      x: [0, 1, 2], mean: path, p05: path, p95: path, p15: path, p85: path,
      p025: path, p975: path, p0015: path, p9985: path, min: path, max: path,
    };
    const base = {
      expectedProfit: 0,
      histogram: hist,
      // finals −4, −2, 3, 8; run #1 (index 1) busted on the way.
      finalProfits: Float64Array.from([-4, -2, 3, 8]),
      neverBustedMask: Uint8Array.from([1, 0, 1, 1]),
      stats: { mean: 1, median: 0, min: -4, max: 8, p01: -4, p05: -4, p95: 8, p99: 8,
        probProfit: 0.5, probUpNeverBusted: 0.5, var95: 4, var99: 4, cvar95: 4, cvar99: 4 },
      samplePaths: { x: [0, 1, 2], paths: [path], best: path, worst: path, sampleIndices: [0] },
      envelopes: env,
    } as unknown as SimulationResult;

    // +5 rakeback lifts run #0 above zero; run #1 also crosses zero but it
    // busted, so it must NOT count. 3 of 4 → 0.75 (raw was 0.5).
    const shifted = shiftResultByRakeback(base, Float64Array.from([0, 2.5, 5]), 1);
    expect(shifted.stats.probUpNeverBusted).toBeCloseTo(0.75, 12);

    // Without a bankroll the engine leaves the mask empty and the stat null:
    // the transform must not invent a number.
    const noBankroll = {
      ...base,
      neverBustedMask: new Uint8Array(0),
      stats: { ...base.stats, probUpNeverBusted: null },
    } as unknown as SimulationResult;
    expect(shiftResultByRakeback(noBankroll, Float64Array.from([0, 2.5, 5]), 1).stats.probUpNeverBusted).toBeNull();
  });

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
