import { describe, expect, it } from "vitest";
import {
  computeExpectedRakebackCurve,
  hideJackpotsByDefault,
  jackpotHiddenShare,
  JACKPOT_AUTO_HIDE_MAX_SHARE,
  shiftResultByRakeback,
  stripJackpots,
  supportsJackpotFilter,
} from "./trajectoryTransforms";
import { runSimulation } from "@/lib/sim/engine";
import { applyGameType } from "@/lib/sim/gameType";
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

describe("supportsJackpotFilter", () => {
  it("preserves all paths for Ocean, including mixes and a previously enabled filter", () => {
    const ocean = makeRow({ gameType: "ocean-ko" });
    const mystery = makeRow({ gameType: "mystery" });
    expect(supportsJackpotFilter([ocean])).toBe(false);
    expect(supportsJackpotFilter([mystery, ocean])).toBe(false);
    expect(supportsJackpotFilter([ocean, makeRow({ gameType: "mystery-royale" })])).toBe(false);
  });

  it("offers the legacy filter only for Mystery or Battle Royale schedules", () => {
    expect(supportsJackpotFilter([makeRow({ gameType: "mystery" })])).toBe(true);
    expect(supportsJackpotFilter([makeRow({ gameType: "mystery-royale" })])).toBe(true);
    expect(supportsJackpotFilter([makeRow({ gameType: "pko" })])).toBe(false);
    expect(supportsJackpotFilter(undefined)).toBe(false);
  });
});

describe("jackpot filter default", () => {
  const maskWith = (hidden: number, total: number) => {
    const mask = new Uint8Array(total);
    mask.fill(1, 0, hidden);
    return { jackpotMask: mask };
  };

  it("reports the share of runs stripJackpots would remove", () => {
    expect(jackpotHiddenShare(maskWith(0, 1000))).toBe(0);
    expect(jackpotHiddenShare(maskWith(210, 1000))).toBeCloseTo(0.21, 12);
    expect(jackpotHiddenShare(maskWith(1000, 1000))).toBe(1);
  });

  it("treats a missing or empty mask as nothing to hide", () => {
    expect(jackpotHiddenShare({ jackpotMask: new Uint8Array(0) })).toBe(0);
    expect(jackpotHiddenShare({} as Pick<SimulationResult, "jackpotMask">)).toBe(0);
  });

  it("starts on only while the filter hides at most 5% of runs", () => {
    expect(JACKPOT_AUTO_HIDE_MAX_SHARE).toBe(0.05);
    // Battle Royale $10 at +10% ROI: ~4% at 2k tournaments, 21% at 10k, 69% at 50k.
    expect(hideJackpotsByDefault(0.04)).toBe(true);
    expect(hideJackpotsByDefault(0.05)).toBe(true);
    expect(hideJackpotsByDefault(0.0501)).toBe(false);
    expect(hideJackpotsByDefault(0.21)).toBe(false);
    expect(hideJackpotsByDefault(0.69)).toBe(false);
    expect(hideJackpotsByDefault(0)).toBe(true);
  });
});

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

describe("stripJackpots keeps the engine's extremes", () => {
  const X = [0, 1, 2];
  const lowerTail = ["min", "p0015", "p025", "p05", "p15"] as const;
  const upperSide = ["mean", "p85", "p95", "p975", "p9985", "max"] as const;

  // 100 samples, finals -50..49 except the jackpot sample 3. Ten stored paths
  // (global indices 0..9) end on their sample's final; the engine's bands are
  // deliberately unlike anything the ten paths could produce.
  function makeResult(flagged: number[], finalsOverride: Record<number, number> = {}) {
    const finals = Float64Array.from({ length: 100 }, (_, i) => i - 50);
    finals[3] = 5000;
    for (const [i, v] of Object.entries(finalsOverride)) finals[Number(i)] = v;
    const mask = new Uint8Array(100);
    for (const i of flagged) mask[i] = 1;
    const stored = Array.from({ length: 10 }, (_, i) => Float64Array.from([0, i - 5, finals[i]]));
    const band = (v: number) => Float64Array.from([0, v, v]);
    const engineWorst = Float64Array.from([0, -30, -50]);
    const result = {
      finalProfits: finals,
      jackpotMask: mask,
      neverBustedMask: new Uint8Array(0),
      histogram: { binEdges: [-50, 5000], counts: [100] },
      samplePaths: {
        x: X,
        paths: stored,
        best: Float64Array.from([0, 9000, 9000]),
        worst: engineWorst,
        sampleIndices: Array.from({ length: 10 }, (_, i) => i),
      },
      envelopes: {
        x: X,
        mean: band(1),
        min: band(-1000),
        p0015: band(-900),
        p025: band(-800),
        p05: band(-700),
        p15: band(-600),
        p85: band(600),
        p95: band(700),
        p975: band(800),
        p9985: band(900),
        max: band(9000),
      },
    } as unknown as SimulationResult;
    return { result, engineWorst, stored };
  }

  it("leaves the full-sample min and lower band edges alone while the filter hides a few runs", () => {
    const { result } = makeResult([3]);
    const stripped = stripJackpots(result);

    for (const key of lowerTail) {
      expect(stripped.envelopes[key]).toBe(result.envelopes[key]);
    }
    // 9 kept stored paths end on -50..-41 except sample 3: the upper side is theirs.
    for (const key of upperSide) {
      expect(stripped.envelopes[key]).not.toBe(result.envelopes[key]);
      expect(stripped.envelopes[key][2]).toBeLessThan(0);
    }
    expect(stripped.envelopes.max[2]).toBe(-41);
    expect(stripped.envelopes.mean[2]).toBeCloseTo((-50 - 49 - 48 - 46 - 45 - 44 - 43 - 42 - 41) / 9, 12);
  });

  it("keeps the min but rebuilds the percentiles once the filter reshapes the distribution", () => {
    const heavy = [3, ...Array.from({ length: 20 }, (_, i) => 60 + i)];
    const { result } = makeResult(heavy);
    expect(heavy.length / 100).toBeGreaterThan(JACKPOT_AUTO_HIDE_MAX_SHARE);
    const stripped = stripJackpots(result);

    expect(stripped.envelopes.min).toBe(result.envelopes.min);
    for (const key of ["p0015", "p025", "p05", "p15"] as const) {
      expect(stripped.envelopes[key]).not.toBe(result.envelopes[key]);
      expect(stripped.envelopes[key][2]).toBeGreaterThanOrEqual(-50);
    }
  });

  it("keeps the engine's real worst run unless that very sample is the hidden one", () => {
    const kept = makeResult([3]);
    expect(stripJackpots(kept.result).samplePaths.worst).toBe(kept.engineWorst);

    // Sample 0 holds the lowest final and is flagged: the worst of what remains
    // among the stored paths is sample 1.
    const hidden = makeResult([0, 3]);
    const stripped = stripJackpots(hidden.result);
    expect(stripped.samplePaths.worst).toBe(hidden.stored[1]);
    expect(stripped.samplePaths.best).toBe(hidden.stored[9]);
  });

  it("agrees with the engine's lower tail on a real Battle Royale run", () => {
    const r = runSimulation({
      schedule: [
        {
          id: "br",
          label: "BR",
          players: 18,
          buyIn: 2.7,
          rake: 0.11,
          roi: 0.05,
          payoutStructure: "battle-royale",
          gameType: "mystery-royale",
          bountyFraction: 0.5,
          count: 100,
        },
      ],
      scheduleRepeats: 1,
      samples: 4000,
      bankroll: 0,
      seed: 11,
      finishModel: { id: "power-law" },
    });
    const hidden = jackpotHiddenShare(r);
    expect(hidden).toBeGreaterThan(0);
    expect(hideJackpotsByDefault(hidden)).toBe(true);

    const stripped = stripJackpots(r);
    for (const key of lowerTail) {
      expect(Array.from(stripped.envelopes[key])).toEqual(Array.from(r.envelopes[key]));
    }
    const last = r.envelopes.x.length - 1;
    expect(stripped.envelopes.min[last]).toBe(Math.min(...r.finalProfits));
    expect(stripped.envelopes.max[last]).toBeLessThan(r.envelopes.max[last]);
  });
});

describe("stripJackpots keeps the envelope ordered", () => {
  const ORDER = ["min", "p0015", "p025", "p05", "p15", "p85", "p95", "p975", "p9985", "max"] as const;

  // The engine itself leaves ~1e-14 of rounding between its own min and p0015.
  function firstInversion(env: SimulationResult["envelopes"]) {
    for (let t = 0; t < env.x.length; t++) {
      for (let k = 0; k + 1 < ORDER.length; k++) {
        const lo = env[ORDER[k]][t];
        const hi = env[ORDER[k + 1]][t];
        if (lo > hi + 1e-9) return `${ORDER[k]} ${lo} > ${ORDER[k + 1]} ${hi} at checkpoint ${t}`;
      }
    }
    return null;
  }

  // Engine lower tail (all samples) sits ABOVE what the kept stored paths give
  // for the upper side at checkpoint 1: the merged bands must not cross.
  it("lifts a rebuilt upper band that falls under the engine's lower tail, and leaves the lower tail alone", () => {
    const X = [0, 1, 2];
    const band = (...v: number[]) => Float64Array.from(v);
    const finals = Float64Array.from({ length: 100 }, (_, i) => i - 50);
    const mask = new Uint8Array(100);
    mask[3] = 1;
    const stored = Array.from({ length: 10 }, (_, i) => band(0, i - 5, finals[i]));
    const result = {
      finalProfits: finals,
      jackpotMask: mask,
      neverBustedMask: new Uint8Array(0),
      histogram: { binEdges: [-50, 49], counts: [100] },
      samplePaths: { x: X, paths: stored, best: stored[9], worst: stored[0], sampleIndices: stored.map((_, i) => i) },
      envelopes: {
        x: X,
        mean: band(0, 0, 0),
        min: band(0, -20, -50),
        p0015: band(0, -10, -50),
        p025: band(0, -8, -50),
        p05: band(0, -6, -49),
        p15: band(0, 40, -48),
        p85: band(0, 50, 30),
        p95: band(0, 60, 40),
        p975: band(0, 70, 45),
        p9985: band(0, 80, 48),
        max: band(0, 90, 49),
      },
    } as unknown as SimulationResult;

    const stripped = stripJackpots(result);

    expect(firstInversion(stripped.envelopes)).toBeNull();
    for (const key of ["min", "p0015", "p025", "p05", "p15"] as const) {
      expect(stripped.envelopes[key], key).toBe(result.envelopes[key]);
    }
    // Checkpoint 1: the ten stored paths read -5..4 there, so the rebuilt
    // percentiles are under the engine's p15 of 40 and are raised to it.
    for (const key of ["p85", "p95", "p975", "p9985", "max"] as const) {
      expect(stripped.envelopes[key][1], key).toBeGreaterThanOrEqual(40);
    }
    // Where nothing crosses, the rebuilt upper side is untouched.
    expect(stripped.envelopes.max[2]).toBe(-41);
  });

  it("holds on the reviewed Mystery runs (3000 x $50, 4000 samples, seeds 3 and 4)", () => {
    const base: TournamentRow = makeRow({
      id: "m",
      players: 1000,
      buyIn: 50,
      rake: 0.1,
      roi: 0.05,
      gameType: "freezeout",
      count: 3000,
    });
    const mystery: TournamentRow = { ...base, ...applyGameType(base, "mystery"), buyIn: 50, rake: 0.1, roi: 0.05 };
    for (const seed of [3, 4]) {
      const r = runSimulation({
        schedule: [mystery],
        scheduleRepeats: 1,
        samples: 4000,
        bankroll: 0,
        seed,
        finishModel: { id: "power-law" },
      });
      expect(jackpotHiddenShare(r), `seed ${seed}`).toBeGreaterThan(0);
      expect(hideJackpotsByDefault(jackpotHiddenShare(r))).toBe(true);
      const stripped = stripJackpots(r);
      expect(firstInversion(stripped.envelopes), `seed ${seed}`).toBeNull();
      for (const key of ["min", "p0015", "p025", "p05", "p15"] as const) {
        expect(Array.from(stripped.envelopes[key]), `seed ${seed} ${key}`).toEqual(
          Array.from(r.envelopes[key]),
        );
      }
    }
  });
});

describe("shiftResultByRakeback", () => {
  it("omits survival estimates when only the original full-sample bust mask is known", () => {
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

    // Shifted paths can cross the bankroll boundary differently. The
    // original flags cannot establish joint survival in either direction.
    const shifted = shiftResultByRakeback(base, Float64Array.from([0, 2.5, 5]), 1);
    expect(shifted.stats.probUpNeverBusted).toBeNull();
    expect(shiftResultByRakeback(base, Float64Array.from([0, 2.5, 5]), -1).stats.probUpNeverBusted).toBeNull();
    expect(shiftResultByRakeback(base, new Float64Array(3), 1)).toBe(base);

    const withoutRb = shiftResultByRakeback(shifted, Float64Array.from([0, 1, 2]), -1);
    expect(Array.from(withoutRb.finalProfits)).toEqual([-1, 1, 6, 11]);
    expect(withoutRb.stats.probProfit).toBe(0.75);
    expect(Array.from(base.finalProfits)).toEqual([-4, -2, 3, 8]);

    const masked = { ...shifted, jackpotMask: Uint8Array.from([0, 0, 0, 1]) };
    const filtered = stripJackpots(masked);
    expect(Array.from(filtered.finalProfits)).toEqual([1, 3, 8]);
    expect(filtered.histogram.binEdges[0]).toBe(1);
    expect(filtered.histogram.counts.reduce((sum, count) => sum + count, 0)).toBe(3);

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
