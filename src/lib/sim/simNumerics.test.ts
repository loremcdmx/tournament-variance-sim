import { describe, expect, it } from "vitest";
import { runSimulation } from "./engine";
import { aggregateStreaks } from "./pathStreaks";
import { histogramFromCounts } from "./simNumerics";
import type { SimulationInput } from "./types";

function expectHistogramContract(h: { binEdges: number[]; counts: number[] }) {
  expect(h.binEdges.length).toBe(h.counts.length + 1);
  for (const e of h.binEdges) expect(Number.isFinite(e)).toBe(true);
  for (let i = 1; i < h.binEdges.length; i++) {
    expect(h.binEdges[i]).toBeGreaterThan(h.binEdges[i - 1]);
  }
}

describe("histogramFromCounts", () => {
  it("keeps edges = counts + 1 when no streak was ever recorded", () => {
    const empty = histogramFromCounts(new Int32Array(11), 60, 2.5);
    expectHistogramContract(empty);
    expect(empty.counts.every((c) => c === 0)).toBe(true);
  });

  it("keeps edges = counts + 1 for a zero-length counts array", () => {
    expectHistogramContract(histogramFromCounts(new Int32Array(0), 60));
  });

  it("bins a populated distribution on integer widths and scales the edges", () => {
    const counts = new Int32Array(8);
    counts[1] = 5;
    counts[2] = 3;
    counts[7] = 1;
    const h = histogramFromCounts(counts, 60, 2);
    expectHistogramContract(h);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(9);
    expect(h.binEdges[1] - h.binEdges[0]).toBe(2);
  });

  it("gives every bar the same number of lengths, the first one included", () => {
    for (const [maxLen, width] of [[40, 1], [120, 2], [200, 4], [600, 10]] as const) {
      const counts = new Int32Array(maxLen + 1);
      for (let len = 1; len <= maxLen; len++) counts[len] = 1000;
      const h = histogramFromCounts(counts, 60);
      expect(h.binEdges[0]).toBe(0.5);
      expect(h.binEdges[1] - h.binEdges[0]).toBe(width);
      expect(h.counts.every((c) => c === 1000 * width)).toBe(true);
    }
  });

  it("keeps a falling law falling: a geometric streak length gives non-increasing bars", () => {
    for (const p of [0.2, 0.1, 0.05, 0.02]) {
      const counts = new Int32Array(4001);
      for (let k = 1; k <= 4000; k++) counts[k] = Math.round(1e8 * (1 - p) ** (k - 1) * p);
      const h = histogramFromCounts(counts, 60);
      const w = h.binEdges[1] - h.binEdges[0];
      let firstBar = 0;
      for (let k = 1; k <= w; k++) firstBar += counts[k];
      expect(h.counts[0]).toBe(firstBar);
      for (let b = 1; b < h.counts.length - 1; b++) {
        expect(h.counts[b]).toBeLessThanOrEqual(h.counts[b - 1]);
      }
    }
  });

  it("starts at the shortest length that occurs, so chords that cannot be one step long fill the first bar", () => {
    const counts = new Int32Array(201);
    for (let len = 2; len <= 200; len++) counts[len] = 1000;
    const h = histogramFromCounts(counts, 60, 2.5);
    expect(h.binEdges[0]).toBe(1.5 * 2.5);
    expect(h.binEdges[1] - h.binEdges[0]).toBe(4 * 2.5);
    expect(h.counts.slice(0, -1).every((c) => c === 4000)).toBe(true);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(199_000);
  });

  it("is the same histogram the path-based streak card publishes for a path with no chords", () => {
    const xHi = Array.from({ length: 50 }, (_, i) => i);
    const flat = new Float64Array(50);
    for (let i = 0; i < 50; i++) flat[i] = i;
    const agg = aggregateStreaks([flat], xHi, null);
    expectHistogramContract(agg.longestBreakevenHistogram);
    expect(agg.longestBreakevenHistogram.counts.every((c) => c === 0)).toBe(true);
  });
});

describe("a one-tournament run publishes well-formed streak histograms", () => {
  const input: SimulationInput = {
    schedule: [
      {
        id: "r",
        players: 500,
        buyIn: 10,
        rake: 0.1,
        roi: 0.1,
        payoutStructure: "mtt-standard",
        count: 1,
      },
    ],
    scheduleRepeats: 1,
    samples: 200,
    seed: 7,
    bankroll: 0,
    finishModel: { id: "power-law" },
  };

  it("keeps edges = counts + 1 on the longest-breakeven histogram", () => {
    const res = runSimulation(input);
    expectHistogramContract(res.longestBreakevenHistogram);
    expectHistogramContract(res.longestCashlessHistogram);
  });
});
