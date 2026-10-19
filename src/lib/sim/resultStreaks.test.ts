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
