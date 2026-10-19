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
