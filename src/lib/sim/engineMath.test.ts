import { describe, it, expect } from "vitest";
import {
  runSimulation,
  buildResult,
  buildScheduleAnalyticBreakdown,
  compileSchedule,
  simulateShard,
  mergeShards,
  makeCheckpointGrid,
  poissonPTRS,
} from "./engine";
import { mulberry32, mixSeed } from "./rng";
import type { RawShard } from "./engineTypes";
import type { SimulationInput, SimulationResult, TournamentRow } from "./types";
import { battleRoyaleRowFromTotalTicket } from "./battleRoyaleTicket";

type TypedArray = Float64Array | Int32Array | Uint8Array;

function eqTyped(a: TypedArray, b: TypedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function isTyped(v: unknown): v is TypedArray {
  return (
    v instanceof Float64Array || v instanceof Int32Array || v instanceof Uint8Array
  );
}

function std(a: Float64Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m += a[i];
  m /= a.length;
  let v = 0;
  for (let i = 0; i < a.length; i++) v += (a[i] - m) * (a[i] - m);
  return Math.sqrt(v / a.length);
}

// buildScheduleAnalyticBreakdown produces the per-tournament σ_ROI that feeds
// the convergence chart and the prove-edge "tournaments to detect" numbers.
// Per CLAUDE.md a 20% σ error ≈ 44% error in required tournaments, so this
// math must be pinned against an absolute anchor — a Monte-Carlo cross-check
// of the calibrated engine, not a naive two-point closed form.
describe("buildScheduleAnalyticBreakdown σ — Monte-Carlo cross-check", () => {
  const base: TournamentRow = {
    label: "x",
    players: 500,
    buyIn: 50,
    rake: 0.1,
    roi: 0.1,
    count: 1,
    payoutStructure: "mtt-standard",
    gameType: "freezeout",
  } as TournamentRow;

  const cases: Array<{ name: string; row: TournamentRow }> = [
    { name: "freezeout", row: base },
    {
      name: "pko",
      row: {
        ...base,
        gameType: "pko",
        payoutStructure: "mtt-gg-bounty",
        bountyFraction: 0.5,
        pkoHeadVar: 0.4,
      } as TournamentRow,
    },
  ];

  for (const c of cases) {
    it(`${c.name}: analytic σ matches simulated σ within a few %`, () => {
      const input: SimulationInput = {
        schedule: [c.row],
        scheduleRepeats: 1,
        samples: 120_000,
        bankroll: 1_000_000,
        seed: 12345,
        finishModel: { id: "power-law" },
      } as SimulationInput;

      const res = runSimulation(input);
      // 1 tournament per sample → per-sample ROI std IS the per-tournament σ.
      const simSigma = std(res.finalProfits) / res.totalBuyIn;

      const analytic = buildScheduleAnalyticBreakdown({
        schedule: [c.row],
        finishModel: { id: "power-law" },
      });
      expect(analytic).not.toBeNull();
      const ratio = simSigma / analytic!.sigmaRoiPerTourney;
      expect(ratio).toBeGreaterThan(0.96);
      expect(ratio).toBeLessThan(1.04);
    });
  }
});

// The breakeven/first-return post-loop was rewritten to precompute per-segment
// min/max (a hot-path O(K1²) cost). The existing determinism tests only assert
// the SCALAR breakevenStreakMean, not the full chord-length histogram — so this
// pins the whole array as the real safety net against a silent reshape.
describe("breakeven chord histogram is deterministic (array-level)", () => {
  const row: TournamentRow = {
    label: "x", players: 300, buyIn: 50, rake: 0.1, roi: 0.05, count: 300,
    payoutStructure: "mtt-standard", gameType: "freezeout",
  } as TournamentRow;
  const input: SimulationInput = {
    schedule: [row], scheduleRepeats: 1, samples: 4000, bankroll: 100_000,
    seed: 777, finishModel: { id: "power-law" },
  } as SimulationInput;

  it("same input + seed → identical breakeven histogram counts and edges", () => {
    const a = runSimulation(input);
    const b = runSimulation(input);
    expect(b.longestBreakevenHistogram.counts).toEqual(
      a.longestBreakevenHistogram.counts,
    );
    expect(b.longestBreakevenHistogram.binEdges).toEqual(
      a.longestBreakevenHistogram.binEdges,
    );
    expect(b.stats.breakevenStreakMean).toBe(a.stats.breakevenStreakMean);
    expect(b.stats.longestBreakevenMean).toBe(a.stats.longestBreakevenMean);
    // Non-degenerate: the chord scan actually populated the histogram.
    expect(a.longestBreakevenHistogram.counts.reduce((x, y) => x + y, 0)).toBeGreaterThan(0);
  });
});

// poissonPTRS (Hörmann 1993 transformed rejection) draws the per-place KO count
// for λ ≥ 30 in the hot loop. A Poisson(λ) has mean = variance = λ; a biased
// sampler would silently shift the bounty σ that flows into the displayed
// numbers. Seeded, so deterministic.
describe("poissonPTRS is an unbiased Poisson sampler", () => {
  for (const lam of [10, 50, 200]) {
    it(`λ=${lam}: mean within 1%, variance within 3%`, () => {
      const r = mulberry32(mixSeed(0xa11ce, lam));
      const n = 200_000;
      let sum = 0;
      let sumsq = 0;
      for (let i = 0; i < n; i++) {
        const k = poissonPTRS(lam, r);
        expect(k).toBeGreaterThanOrEqual(0);
        sum += k;
        sumsq += k * k;
      }
      const mean = sum / n;
      const variance = sumsq / n - mean * mean;
      expect(Math.abs(mean - lam) / lam).toBeLessThan(0.01);
      expect(Math.abs(variance - lam) / lam).toBeLessThan(0.03);
    });
  }
});

// The engine's #1 contract: SimulationInput + seed → byte-identical result
// regardless of how samples are sharded across the worker pool. The existing
// multi-shard tests only assert hi-res sampleIndices alignment; this pins the
// VALUE-level invariant (the worker.ts path: arbitrary [sStart,sEnd) ranges +
// mergeShards), which a future refactor of the shard buffers or merge could
// otherwise silently break with the suite still green.
describe("pool-invariance: 1 shard vs N out-of-order shards is byte-identical", () => {
  // Kitchen-sink schedule: every stochastic channel the hot loop owns is on
  // at once, so a shard-local seed leak in ANY of them shows up here.
  //   finish draw            — all rows (field-variability variant pick on fz)
  //   sit-through-pay-jumps  — fz
  //   PKO heat + head var    — pko (plus bountyEvBias reshaping the split)
  //   mystery log-normal     — myst (fixed-ITM shelled solver)
  //   BR tier sampler        — br  (fixed-ITM, jackpot mask)
  //   rakeback               — global
  //   shocks/drift/tilt      — global (roiStdErr, per-tourney, per-session,
  //                            AR(1) drift, fast + slow tilt)
  //   BR leaderboard         — 75 BR events per sample / window 7 ⇒ 10 full
  //                            windows + 1 partial (awardPartialWindow default)
  //   ruin                   — bankroll small enough that most samples bust
  const BR_10 = battleRoyaleRowFromTotalTicket(10);
  const schedule: TournamentRow[] = [
    {
      id: "fz", label: "fz", players: 500, buyIn: 50, rake: 0.1, roi: 0.1, count: 2,
      payoutStructure: "mtt-standard", gameType: "freezeout",
      fieldVariability: { kind: "uniform", min: 300, max: 900, buckets: 4 },
      sitThroughPayJumps: true, payJumpAggression: 0.5,
    },
    {
      id: "pko", label: "pko", players: 1000, buyIn: 25, rake: 0.1, roi: 0.08, count: 2,
      payoutStructure: "mtt-gg-bounty", gameType: "pko",
      bountyFraction: 0.5, pkoHeat: 0.6, pkoHeadVar: 0.4, bountyEvBias: -0.15,
    },
    {
      id: "myst", label: "myst", players: 400, buyIn: 20, rake: 0.1, roi: 0.12, count: 1,
      payoutStructure: "mtt-gg-mystery", gameType: "mystery",
      bountyFraction: 0.5, mysteryBountyVariance: 2.5, itmRate: 0.18,
    },
    {
      id: "br", label: "br", players: 18, buyIn: BR_10.buyIn, rake: BR_10.rake, roi: 0.05, count: 3,
      payoutStructure: "battle-royale", gameType: "mystery-royale",
      bountyFraction: 0.5, mysteryBountyVariance: 1.8, itmRate: 0.2,
    },
  ];
  const input: SimulationInput = {
    schedule, scheduleRepeats: 25, samples: 3000, bankroll: 1500,
    seed: 0xc0ffee, finishModel: { id: "power-law" },
    rakebackFracOfRake: 0.3,
    roiStdErr: 0.05, roiShockPerTourney: 0.1, roiShockPerSession: 0.05,
    roiDriftSigma: 0.05, roiDriftRho: 0.9,
    tiltFastGain: -0.2, tiltFastScale: 500,
    tiltSlowGain: 0.1, tiltSlowThreshold: 400, tiltSlowMinDuration: 20,
    tiltSlowRecoveryFrac: 0.5,
    battleRoyaleLeaderboard: {
      participants: 200, windowTournaments: 7,
      scoring: { entryPoints: 1, knockoutPoints: 5, firstPoints: 12, secondPoints: 6, thirdPoints: 3 },
      payouts: [
        { rankFrom: 1, rankTo: 1, prizeEach: 250 },
        { rankFrom: 2, rankTo: 20, prizeEach: 20 },
      ],
      opponentModel: { kind: "normal", meanScore: 28, stdDevScore: 9 },
    },
  };

  const compiled = compileSchedule(input, "alpha");
  const N = compiled.tournamentsPerSample;
  const grid = makeCheckpointGrid(N);
  const K1 = grid.K + 1;
  const S = input.samples;
  const numRows = input.schedule.length;

  const single = simulateShard(input, compiled, 0, S, grid);
  // Awkward, out-of-order ranges incl. a single-sample shard.
  const a = simulateShard(input, compiled, 0, 1, grid);
  const b = simulateShard(input, compiled, 1, 1234, grid);
  const c = simulateShard(input, compiled, 1234, 2001, grid);
  const d = simulateShard(input, compiled, 2001, S, grid);
  const merged = mergeShards([d, b, a, c], S, K1, numRows);

  // Hi-res path capture is a per-shard budget by design (see wantHiResPaths
  // in hotLoop.ts): which sample ids get a stored trajectory depends on the
  // split, so those two fields are compared by overlap instead of equality.
  const HI_RES_BY_SHARD_BUDGET = new Set<keyof RawShard>([
    "hiResPaths",
    "hiResSampleIndices",
  ]);

  it("every channel in the fixture is genuinely active", () => {
    expect(compiled.flat.some((e) => (e.variants?.length ?? 0) > 1)).toBe(true);
    expect(compiled.flat.some((e) => e.heatBountyByPlace !== null)).toBe(true);
    expect(compiled.flat.some((e) => e.brTierRatios !== null)).toBe(true);
    expect(compiled.flat.every((e) => e.rakebackBonusPerBullet > 0)).toBe(true);

    expect(single.ruinedCount).toBeGreaterThan(0);
    expect(single.ruinedCount).toBeLessThan(S);
    let jackpotHits = 0;
    for (let i = 0; i < S; i++) jackpotHits += single.jackpotMask[i];
    expect(jackpotHits).toBeGreaterThan(0);
    let bountyProfit = 0;
    for (let i = 0; i < single.rowBountyProfits.length; i++) {
      bountyProfit += Math.abs(single.rowBountyProfits[i]);
    }
    expect(bountyProfit).toBeGreaterThan(0);

    expect(single.leaderboardWindows).not.toBeNull();
    // 75 BR events / window 7 → 10 settled + 1 partial window per sample.
    expect(single.leaderboardWindows![0]).toBe(11);
    let knockouts = 0;
    for (let i = 0; i < S; i++) knockouts += single.leaderboardKnockouts![i];
    expect(knockouts).toBeGreaterThan(0);
    let paidWindows = 0;
    for (let i = 0; i < S; i++) paidWindows += single.leaderboardPaidWindows![i];
    expect(paidWindows).toBeGreaterThan(0);
  });

  it("every RawShard field matches after an out-of-order merge", () => {
    for (const key of Object.keys(single) as (keyof RawShard)[]) {
      if (HI_RES_BY_SHARD_BUDGET.has(key)) continue;
      const lhs = single[key];
      const rhs = merged[key];
      if (isTyped(lhs)) {
        expect(isTyped(rhs), key).toBe(true);
        expect(eqTyped(lhs, rhs as TypedArray), key).toBe(true);
      } else if (typeof lhs === "number") {
        expect(rhs, key).toBe(lhs);
      } else {
        // Only the hi-res path list and null-able leaderboard buffers fall
        // through; in this fixture the leaderboard is on, so null here means
        // the merge dropped a channel.
        expect(lhs, key).not.toBeNull();
        expect(rhs, key).not.toBeNull();
      }
    }
    expect(merged.sStart).toBe(0);
    expect(merged.sEnd).toBe(S);
    // Leaderboard buffers are the only nullable RawShard arrays — pin that
    // the generic walk above actually compared them rather than skipping.
    expect(single.leaderboardPoints).not.toBeNull();
    expect(single.leaderboardThirds).not.toBeNull();
  });

  it("hi-res paths overlap sample-for-sample where both splits stored them", () => {
    const byIndex = new Map<number, Float64Array>();
    for (let i = 0; i < merged.hiResPaths.length; i++) {
      byIndex.set(merged.hiResSampleIndices[i], merged.hiResPaths[i]);
    }
    let compared = 0;
    for (let i = 0; i < single.hiResPaths.length; i++) {
      const path = byIndex.get(single.hiResSampleIndices[i]);
      if (!path) continue;
      expect(eqTyped(path, single.hiResPaths[i])).toBe(true);
      compared++;
    }
    expect(compared).toBeGreaterThan(0);
  });

  it("buildResult JSON is identical outside the shard-budget path list", () => {
    const strip = (r: SimulationResult) =>
      JSON.stringify({
        ...r,
        samplePaths: { ...r.samplePaths, paths: undefined, sampleIndices: undefined },
      });
    const fromSingle = buildResult(input, compiled, single, "alpha", grid);
    const fromMerged = buildResult(input, compiled, merged, "alpha", grid);
    expect(strip(fromMerged)).toBe(strip(fromSingle));
    expect(fromSingle.stats.riskOfRuin).toBeGreaterThan(0);
    expect(fromSingle.battleRoyaleLeaderboard).toBeDefined();
  });
});

// "Cashed" means finishing at a paid place: 0-based `place < paidCount`,
// i.e. 1-based place ≤ paidCount. Pinning the alias table to a single place
// makes the streak counters exact, so an off-by-one on the boundary (cashing
// at paidCount+1, or missing the last paid seat) fails loudly.
describe("longest cashless streak: paid-place boundary", () => {
  const input: SimulationInput = {
    schedule: [
      { id: "r1", label: "row", players: 100, buyIn: 10, rake: 0.1, roi: 0.1,
        payoutStructure: "mtt-standard", count: 1 },
    ],
    scheduleRepeats: 6, samples: 4, bankroll: 0, seed: 1,
    finishModel: { id: "power-law" },
  };

  const pinnedRun = (placeOffsetFromPaidCount: number) => {
    const compiled = compileSchedule(input, "alpha");
    const paidCount = compiled.flat[0].paidCount;
    // aliasProb = 0 forces the alias branch, so every draw lands on aliasIdx.
    for (const entry of compiled.flat) {
      entry.aliasProb.fill(0);
      entry.aliasIdx.fill(paidCount + placeOffsetFromPaidCount);
    }
    const grid = makeCheckpointGrid(compiled.tournamentsPerSample);
    const shard = simulateShard(input, compiled, 0, input.samples, grid);
    const result = buildResult(input, compiled, shard, "alpha", grid);
    return { paidCount, N: compiled.tournamentsPerSample, shard, result };
  };

  it("finishing exactly at the last paid place counts as a cash (no streak)", () => {
    const { paidCount, shard, result } = pinnedRun(-1);
    expect(paidCount).toBeGreaterThan(1);
    expect([...shard.longestCashless]).toEqual([0, 0, 0, 0]);
    expect(shard.cashlessStreakCounts.reduce((x, y) => x + y, 0)).toBe(0);
    expect(result.stats.longestCashlessMean).toBe(0);
    expect(result.stats.longestCashlessWorst).toBe(0);
  });

  it("finishing one place below the last paid seat never cashes (streak = N)", () => {
    const { N, shard, result } = pinnedRun(0);
    expect([...shard.longestCashless]).toEqual([N, N, N, N]);
    expect(shard.cashlessStreakCounts[N]).toBe(input.samples);
    expect(shard.cashlessStreakCounts.reduce((x, y) => x + y, 0)).toBe(input.samples);
    expect(result.stats.longestCashlessMean).toBe(N);
    expect(result.stats.longestCashlessWorst).toBe(N);
  });
});

// Numerical-era pin. Share links and stored runs reproduce a simulation only
// while `input + seed → bytes` holds across releases, so these four values are
// hard-coded from the current seed era (post-`mixSeed` finalization, see
// WISDOM.md "Seed Era And Reproducibility"). Any engine change that moves
// them is a new era: update the numbers AND the WISDOM entry in the same
// commit — never widen the tolerance.
describe("golden values pin the numerical era", () => {
  it("seed 42 baseline: stats.mean / stdDev / p05 / p95 to 1e-9", () => {
    const r = runSimulation({
      schedule: [
        { id: "r1", label: "row", players: 500, buyIn: 10, rake: 0.1, roi: 0.2,
          payoutStructure: "mtt-standard", count: 1 },
      ],
      scheduleRepeats: 200, samples: 3000, bankroll: 500, seed: 42,
      finishModel: { id: "power-law" },
    });
    expect(r.stats.mean).toBeCloseTo(470.5180062331724, 9);
    expect(r.stats.stdDev).toBeCloseTo(1017.9236172839492, 9);
    expect(r.stats.p05).toBeCloseTo(-1014.3421434467685, 9);
    expect(r.stats.p95).toBeCloseTo(2320.9314345094153, 9);
  });
});
