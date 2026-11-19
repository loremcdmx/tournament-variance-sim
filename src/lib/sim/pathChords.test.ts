import { describe, expect, it } from "vitest";

import {
  createPathChordScratch,
  scanPathChords,
  scanPathChordsReference,
} from "./pathChords";
import { mulberry32 } from "./rng";

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
