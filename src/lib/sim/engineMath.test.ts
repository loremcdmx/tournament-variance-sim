import { describe, it, expect } from "vitest";
import {
  runSimulation,
  buildScheduleAnalyticBreakdown,
  compileSchedule,
  simulateShard,
  mergeShards,
  makeCheckpointGrid,
  poissonPTRS,
} from "./engine";
import { mulberry32, mixSeed } from "./rng";
import type { SimulationInput, TournamentRow } from "./types";

function eqF64(a: Float64Array, b: Float64Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
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
  const schedule: TournamentRow[] = [
    { label: "fz", players: 500, buyIn: 50, rake: 0.1, roi: 0.1, count: 2,
      payoutStructure: "mtt-standard", gameType: "freezeout" } as TournamentRow,
    { label: "pko", players: 1000, buyIn: 25, rake: 0.1, roi: 0.08, count: 2,
      payoutStructure: "mtt-gg-bounty", gameType: "pko",
      bountyFraction: 0.5, pkoHeadVar: 0.4 } as TournamentRow,
  ];
  const input: SimulationInput = {
    schedule, scheduleRepeats: 20, samples: 3000, bankroll: 100_000,
    seed: 0xc0ffee, finishModel: { id: "power-law" },
  } as SimulationInput;

  it("single full-range shard == reversed multi-shard merge (incl. a 1-sample shard)", () => {
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

    expect(eqF64(merged.finalProfits, single.finalProfits)).toBe(true);
    expect(eqF64(merged.pathMatrix, single.pathMatrix)).toBe(true);
    expect(eqF64(merged.maxDrawdowns, single.maxDrawdowns)).toBe(true);
    expect(eqF64(merged.rowProfits, single.rowProfits)).toBe(true);
    expect([...merged.breakevenStreakCounts]).toEqual([
      ...single.breakevenStreakCounts,
    ]);
  });
});
