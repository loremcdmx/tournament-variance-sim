import { describe, expect, it } from "vitest";
import { runSimulation } from "./engine";
import { computeStreakStats } from "./resultStreaks";
import type { SimulationInput, TournamentRow } from "./types";

function streaksFor(recoveryLengths: number[]) {
  const S = recoveryLengths.length;
  return computeStreakStats(
    new Float64Array(S),
    new Float64Array(S),
    new Float64Array(S),
    new Int32Array(S),
    Int32Array.from(recoveryLengths),
    S,
  );
}

describe("computeStreakStats recovery", () => {
  it("reports the recovered-only median and p90 with the never-recovered share beside them", () => {
    const out = streaksFor([-1, -1, 10, 20, 30, 40, 50, 60, 70, 80]);
    expect(out.recoveryMedian).toBe(40);
    expect(out.recoveryP90).toBe(70);
    expect(out.recoveryUnrecoveredShare).toBe(0.2);
  });

  it("has no recovery time at all when no run ever recovered", () => {
    const out = streaksFor([-1, -1, -1, -1]);
    expect(out.recoveryUnrecoveredShare).toBe(1);
    expect(Number.isNaN(out.recoveryMedian)).toBe(true);
    expect(Number.isNaN(out.recoveryP90)).toBe(true);
    expect(out.recoveryHistogram.counts).toEqual([0]);
  });

  it("has no recovery time when no run ever drew down", () => {
    const out = streaksFor([-2, -2, -2]);
    expect(out.recoveryUnrecoveredShare).toBe(0);
    expect(Number.isNaN(out.recoveryMedian)).toBe(true);
    expect(Number.isNaN(out.recoveryP90)).toBe(true);
  });

  it("bins recovery lengths on whole tournaments: no empty bar between occupied lengths", () => {
    const lengths: number[] = [];
    for (let len = 1; len <= 14; len++) for (let k = 0; k < 15 - len; k++) lengths.push(len);
    const h = streaksFor(lengths).recoveryHistogram;
    expect(h.binEdges[0]).toBe(0.5);
    expect(h.binEdges[1] - h.binEdges[0]).toBe(1);
    // p99.9 is 13 here, so the single 14 folds into the last bar.
    expect(h.counts).toEqual([14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 3]);
  });

  it("gives every recovery bar the same number of lengths over a long horizon", () => {
    const lengths: number[] = [];
    for (let len = 1; len <= 120; len++) for (let k = 0; k < 100; k++) lengths.push(len);
    const h = streaksFor(lengths).recoveryHistogram;
    expect(h.binEdges[1] - h.binEdges[0]).toBe(3);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(12_000);
    expect(h.counts.every((c) => c === 300)).toBe(true);
  });

  it("keeps a genuine zero-length recovery as a number", () => {
    const out = streaksFor([0, 0, 0]);
    expect(out.recoveryMedian).toBe(0);
    expect(out.recoveryP90).toBe(0);
  });
});

describe("engine recovery stats when every sample ends underwater", () => {
  const row: TournamentRow = {
    id: "r",
    players: 500,
    buyIn: 10,
    rake: 0.1,
    roi: -0.5,
    payoutStructure: "mtt-standard",
    count: 1,
  };
  const input: SimulationInput = {
    schedule: [row],
    scheduleRepeats: 1500,
    samples: 300,
    seed: 42,
    bankroll: 0,
    finishModel: { id: "power-law" },
  };

  it("does not print a zero-tourney recovery next to 100% never recovered", () => {
    const { stats } = runSimulation(input);
    expect(stats.recoveryUnrecoveredShare).toBe(1);
    expect(Number.isFinite(stats.recoveryMedian)).toBe(false);
    expect(Number.isFinite(stats.recoveryP90)).toBe(false);
  });
});
