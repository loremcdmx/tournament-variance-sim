import { describe, expect, it } from "vitest";

import { compileSchedule, makeCheckpointGrid, simulateShard } from "./engine";
import {
  createFirstReturnScratch,
  createPathChordScratch,
  scanFirstReturns,
  scanPathChords,
  scanPathChordsReference,
} from "./pathChords";
import { mulberry32 } from "./rng";
import type { SimulationInput } from "./types";

function scanBoth(path: Float64Array, base: number, K1: number) {
  const fastScratch = createPathChordScratch(K1);
  const refScratch = createPathChordScratch(K1);
  const fastCounts = new Int32Array(K1);
  const refCounts = new Int32Array(K1);
  scanPathChords(path, base, K1, fastCounts, fastScratch);
  scanPathChordsReference(path, base, K1, refCounts, refScratch);
  return {
    fast: {
      counts: Array.from(fastCounts),
      longest: fastScratch.longestChord,
      sum: fastScratch.firstReturnSum,
      count: fastScratch.firstReturnCount,
    },
    ref: {
      counts: Array.from(refCounts),
      longest: refScratch.longestChord,
      sum: refScratch.firstReturnSum,
      count: refScratch.firstReturnCount,
    },
  };
}

describe("scanPathChords", () => {
  it("reads a hand-checked path", () => {
    // 0, 2, 1, 2, -1. A segment covers every level between its two ends, both
    // ends included, so the last segment (2 down to -1) covers 0, 1 and 2:
    // the furthest chords are 4 (from 0), 3 (from the first 2) and 2 (from 1).
    // The second 2 only starts that segment, which is no return.
    const path = Float64Array.from([0, 2, 1, 2, -1]);
    const { fast, ref } = scanBoth(path, 0, 5);
    expect(fast).toEqual(ref);
    expect(fast.counts).toEqual([0, 0, 1, 1, 1]);
    expect(fast.longest).toBe(4);
    // First returns: 0 inside the last segment (4), the first 2 at checkpoint
    // 3 (2), 1 inside the last segment (2), the second 2 never.
    expect(fast.sum).toBe(8);
    expect(fast.count).toBe(3);
  });

  it("counts a flat step as a return and a bare departure as none", () => {
    // 0, 0, 5: from the first 0 the furthest segment touching the level is the
    // second one, at its left end (chord 2); the first return is the flat step.
    const flat = scanBoth(Float64Array.from([0, 0, 5]), 0, 3);
    expect(flat.fast).toEqual(flat.ref);
    expect(flat.fast.counts).toEqual([0, 0, 1]);
    expect(flat.fast.longest).toBe(2);
    expect(flat.fast.sum).toBe(1);
    expect(flat.fast.count).toBe(1);

    const monotone = scanBoth(Float64Array.from([0, -1, -2, -3]), 0, 4);
    expect(monotone.fast).toEqual(monotone.ref);
    expect(monotone.fast.longest).toBe(0);
    expect(monotone.fast.count).toBe(0);
  });

  it("agrees with the two-scan definition on random, lattice and tied paths", () => {
    const rng = mulberry32(20261119);
    const shapes: ((k: number) => number)[] = [
      () => rng() * 200 - 100,
      () => (rng() < 0.5 ? -11 : 11),
      () => (rng() < 0.85 ? -11 : 60 * Math.exp(3 * rng())),
      () => 0,
      () => ((rng() * 3) | 0) - 1,
    ];
    for (const step of shapes) {
      for (const K1 of [2, 3, 4, 17, 64, 241]) {
        for (let rep = 0; rep < 40; rep++) {
          const base = 5;
          const path = new Float64Array(base + K1 + 3);
          let level = 0;
          for (let j = 1; j < K1; j++) {
            level += step(j);
            path[base + j] = level;
          }
          const { fast, ref } = scanBoth(path, base, K1);
          expect(fast).toEqual(ref);
        }
      }
    }
  });

  it("handles infinities like the definition and sends a NaN path through it", () => {
    const inf = scanBoth(Float64Array.from([0, Infinity, 3, -Infinity, 3, Infinity]), 0, 6);
    expect(inf.fast).toEqual(inf.ref);
    const nan = scanBoth(Float64Array.from([0, 4, Number.NaN, 4, 0, -2, 0]), 0, 7);
    expect(nan.fast).toEqual(nan.ref);
  });
});

/**
 * First return to `trace[t0]` read at every tournament, written from the card's
 * definition: the first later tournament where the path is back at the level,
 * either landing on it or stepping across it; the step out of the start counts
 * only when it lands on the level. Null when the path never comes back.
 */
function firstReturnOracle(trace: ArrayLike<number>, t0: number): number | null {
  const y = trace[t0];
  for (let t = t0 + 1; t < trace.length; t++) {
    const now = trace[t] - y;
    if (now === 0) return t - t0;
    const before = trace[t - 1] - y;
    if (t > t0 + 1 && ((before < 0 && now > 0) || (before > 0 && now < 0))) return t - t0;
  }
  return null;
}

function oracleMean(trace: ArrayLike<number>, starts: ArrayLike<number>, K: number) {
  let sum = 0;
  let count = 0;
  for (let ii = 0; ii < K; ii++) {
    const len = firstReturnOracle(trace, starts[ii]);
    if (len !== null) {
      sum += len;
      count++;
    }
  }
  return { sum, count };
}

function randomWalk(rng: () => number, step: () => number, n: number): Float64Array {
  const trace = new Float64Array(n + 1);
  for (let t = 1; t <= n; t++) trace[t] = trace[t - 1] + step();
  return trace;
}

describe("scanFirstReturns", () => {
  it("is the grid scan's first return when every tournament is a checkpoint", () => {
    const rng = mulberry32(7);
    const steps: (() => number)[] = [
      () => rng() * 200 - 100,
      () => (rng() < 0.85 ? -11 : 60 * Math.exp(3 * rng())),
      () => ((rng() * 3) | 0) - 1,
      () => 0,
    ];
    for (const step of steps) {
      for (const n of [1, 2, 5, 40, 240]) {
        const trace = randomWalk(rng, step, n);
        const idx = Int32Array.from({ length: n + 1 }, (_, j) => j);
        const scratch = createFirstReturnScratch(n);
        scanFirstReturns(trace, n, idx, n, scratch);
        const grid = createPathChordScratch(n + 1);
        scanPathChordsReference(trace, 0, n + 1, new Int32Array(n + 1), grid);
        expect([scratch.firstReturnSum, scratch.firstReturnCount]).toEqual([
          grid.firstReturnSum,
          grid.firstReturnCount,
        ]);
      }
    }
  });

  it("reads every tournament from coarse checkpoints, ties and infinities included", () => {
    const rng = mulberry32(11);
    const steps: (() => number)[] = [
      () => rng() * 200 - 100,
      () => (rng() < 0.5 ? -11 : 11),
      () => (rng() < 0.85 ? -11 : 60 * Math.exp(3 * rng())),
      () => ((rng() * 3) | 0) - 1,
    ];
    for (const step of steps) {
      for (const n of [241, 1000, 5003]) {
        for (let rep = 0; rep < 5; rep++) {
          const trace = randomWalk(rng, step, n);
          const { K, checkpointIdx } = makeCheckpointGrid(n);
          const scratch = createFirstReturnScratch(K);
          scanFirstReturns(trace, n, checkpointIdx, K, scratch);
          const { sum, count } = oracleMean(trace, checkpointIdx, K);
          expect([scratch.firstReturnSum, scratch.firstReturnCount]).toEqual([sum, count]);
        }
      }
    }
    const odd = Float64Array.from([0, Infinity, 3, -Infinity, 3, Infinity, 0, Number.NaN, 2]);
    const idx = Int32Array.from([0, 2, 4, 6, 8]);
    const scratch = createFirstReturnScratch(4);
    scanFirstReturns(odd, 8, idx, 4, scratch);
    // From 0: crossed on the step 3 -> -Infinity (3). From 3 at 2: the step
    // -Infinity -> 3 lands on it (2). From 3 at 4: Infinity -> 0 crosses (2).
    // From 0 at 6: the step into NaN is no return and nothing follows.
    expect([scratch.firstReturnSum, scratch.firstReturnCount]).toEqual([7, 3]);
  });
});

describe("Avg flatline reads every tournament", () => {
  function run(scheduleRepeats: number, samples: number) {
    const input: SimulationInput = {
      schedule: [
        {
          id: "r",
          players: 500,
          buyIn: 10,
          rake: 0.1,
          roi: 0.2,
          payoutStructure: "mtt-standard",
          count: 1,
        },
      ],
      scheduleRepeats,
      samples,
      seed: 42,
      bankroll: 0,
      finishModel: { id: "power-law" },
    };
    const compiled = compileSchedule(input, "alpha");
    const grid = makeCheckpointGrid(compiled.tournamentsPerSample);
    return {
      grid,
      shard: simulateShard(input, compiled, 0, samples, grid),
      slice: (from: number, to: number) => simulateShard(input, compiled, from, to, grid),
    };
  }

  it("matches an every-tournament recount over the stored paths, from the same checkpoints", () => {
    // 1 000 tournaments: the stored paths hold every tournament (hi-res grid
    // up to 4 000), the checkpoint grid every 4.17.
    const { grid, shard } = run(1000, 300);
    expect(grid.K).toBeLessThan(1000);
    expect(shard.hiResCheckpointIdx.length).toBe(1001);
    let shown = 0;
    let gridSum = 0;
    const gridScratch = createPathChordScratch(grid.K + 1);
    const chords = new Int32Array(grid.K + 1);
    for (let s = 0; s < shard.hiResPaths.length; s++) {
      const { sum, count } = oracleMean(shard.hiResPaths[s], grid.checkpointIdx, grid.K);
      expect(shard.breakevenStreakAvgs[s]).toBe(count > 0 ? sum / count : 0);
      shown += shard.breakevenStreakAvgs[s];
      scanPathChords(shard.pathMatrix, s * (grid.K + 1), grid.K + 1, chords, gridScratch);
      gridSum += (gridScratch.firstReturnSum / gridScratch.firstReturnCount / grid.K) * 1000;
    }
    // The old checkpoint-grid reading of the same paths was far longer.
    expect(gridSum / shown).toBeGreaterThan(1.2);
  });

  it("does not depend on where the shards split", () => {
    const { shard, slice } = run(1000, 60);
    const parts = [slice(0, 1), slice(1, 37), slice(37, 60)];
    const merged = new Float64Array(60);
    let at = 0;
    for (const part of parts) {
      merged.set(part.breakevenStreakAvgs, at);
      at += part.breakevenStreakAvgs.length;
    }
    expect(Array.from(merged)).toEqual(Array.from(shard.breakevenStreakAvgs));
  });

  it("keeps the checkpoint scan where every tournament is a checkpoint", () => {
    const { grid, shard } = run(200, 100);
    expect(grid.K).toBe(200);
    const scratch = createPathChordScratch(201);
    const chords = new Int32Array(201);
    for (let s = 0; s < 100; s++) {
      scanPathChords(shard.pathMatrix, s * 201, 201, chords, scratch);
      const old =
        scratch.firstReturnCount > 0 ? (scratch.firstReturnSum / scratch.firstReturnCount / 200) * 200 : 0;
      expect(shard.breakevenStreakAvgs[s]).toBe(old);
    }
  });
});
