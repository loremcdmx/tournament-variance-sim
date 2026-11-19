import { describe, expect, it } from "vitest";

import { selectSortedRanks } from "./orderStatistics";
import { mulberry32 } from "./rng";

function pick(values: Float64Array, ranks: number[], offset = 0): number[] {
  const work = new Float64Array(offset + values.length + 2).fill(7.5);
  work.set(values, offset);
  const out = new Float64Array(ranks.length);
  selectSortedRanks(work, offset, values.length, Int32Array.from(ranks), out);
  expect(Array.from(work.subarray(0, offset))).toEqual(new Array(offset).fill(7.5));
  expect(Array.from(work.subarray(offset + values.length))).toEqual([7.5, 7.5]);
  return Array.from(out);
}

function sortedAt(values: Float64Array, ranks: number[]): number[] {
  const sorted = values.slice().sort();
  return ranks.map((r) => sorted[r]);
}

const ENVELOPE_SHARES = [0.0015, 0.025, 0.05, 0.15, 0.85, 0.95, 0.975, 0.9985];

describe("selectSortedRanks", () => {
  it("returns what a full sort leaves at each rank", () => {
    const rng = mulberry32(77);
    const shapes: (() => number)[] = [
      () => rng() * 2000 - 1000,
      () => ((rng() * 7) | 0) * 11 - 33,
      () => -11,
      () => (rng() < 0.97 ? -11 : Math.exp(rng() * 12)),
      () => (rng() < 0.1 ? Infinity : rng() < 0.1 ? -Infinity : rng()),
    ];
    for (const draw of shapes) {
      for (const n of [1, 2, 3, 24, 25, 599, 601, 602, 1500, 12_000]) {
        const values = Float64Array.from({ length: n }, draw);
        const envelope = ENVELOPE_SHARES.map((p) => Math.floor(p * (n - 1)));
        expect(pick(values, envelope, 3)).toEqual(sortedAt(values, envelope));
        const scattered = Array.from({ length: 6 }, () => (rng() * n) | 0).sort((a, b) => a - b);
        expect(pick(values, scattered)).toEqual(sortedAt(values, scattered));
        expect(pick(values, [0, n - 1])).toEqual(sortedAt(values, [0, n - 1]));
      }
    }
  });

  it("keeps the sign of zero the sort would give", () => {
    const rng = mulberry32(5);
    for (const n of [2, 5, 40, 900]) {
      for (let rep = 0; rep < 20; rep++) {
        const values = Float64Array.from({ length: n }, () =>
          rng() < 0.3 ? -0 : rng() < 0.5 ? 0 : rng() < 0.5 ? -1 : 1,
        );
        const ranks = Array.from({ length: Math.min(n, 9) }, (_, i) =>
          Math.floor((i * (n - 1)) / Math.max(1, Math.min(n, 9) - 1)),
        );
        const got = pick(values, ranks);
        const want = sortedAt(values, ranks);
        for (let r = 0; r < ranks.length; r++) {
          expect(Object.is(got[r], want[r]), `n=${n} rank=${ranks[r]}`).toBe(true);
        }
      }
    }
    expect(Object.is(pick(Float64Array.from([0, -0]), [0, 1])[0], -0)).toBe(true);
    expect(Object.is(pick(Float64Array.from([0, -0]), [0, 1])[1], 0)).toBe(true);
  });

  it("accepts repeated ranks and an empty request", () => {
    const values = Float64Array.from([5, 1, 4, 2, 3]);
    expect(pick(values, [0, 0, 2, 2, 4, 4])).toEqual([1, 1, 3, 3, 5, 5]);
    expect(pick(values, [])).toEqual([]);
  });
});
