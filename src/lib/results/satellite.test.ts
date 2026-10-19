import { describe, expect, it } from "vitest";
import { runSimulation } from "@/lib/sim/engine";
import type { SimulationInput } from "@/lib/sim/types";
import { computeSatelliteStats, integerBinLabel, integerHistogram } from "./satellite";

describe("satellite ticket counts", () => {
  it("counts actual paid finishes independently of rakeback cash and ROI shocks", () => {
    const input: SimulationInput = {
      schedule: [{ id: "sat", players: 100, buyIn: 10, rake: .1, roi: .2, itmRate: .132,
        payoutStructure: "satellite-ticket", count: 100 }],
      scheduleRepeats: 1, samples: 128, bankroll: 0, seed: 42, finishModel: { id: "power-law" },
    };
    const game = runSimulation(input);
    const cash = runSimulation({ ...input, rakebackFracOfRake: .2, roiShockPerSession: .1 });
    const before = computeSatelliteStats(game, input.schedule, 1)!;
    const after = computeSatelliteStats(cash, input.schedule, 1)!;
    expect(after.expectedSeats).toBe(before.expectedSeats);
    expect(after.histogram).toEqual(before.histogram);
    expect(after.seatsMedian).toBe(Math.round(after.seatsMedian));
    expect(after.netPerSession).not.toBe(before.netPerSession);
    expect(after.cashRate).toBe(after.expectedSeats / 100);
    expect(after.shotsPerSeat).toBeCloseTo(100 / after.expectedSeats, 12);
  });
});

describe("seat-count histogram", () => {
  const tally = (values: number[]) => {
    const sorted = Float64Array.from(values).sort();
    return integerHistogram(values, sorted[0], sorted[sorted.length - 1]);
  };

  it("gives a short session one bar per seat count, centred on the whole number", () => {
    const { binEdges, counts } = tally([0, 0, 1, 1, 1, 2, 3, 3]);
    expect(binEdges).toEqual([-0.5, 0.5, 1.5, 2.5, 3.5]);
    expect(counts).toEqual([2, 3, 1, 2]);
  });

  it("leaves no bin between two whole numbers empty by construction", () => {
    const values = Array.from({ length: 8 }, (_, i) => i);
    expect(tally(values).counts.every((c) => c === 1)).toBe(true);
  });

  it("groups a long session in whole-number widths, so no bar collects an uneven number of seat counts", () => {
    const values = Array.from({ length: 101 }, (_, i) => i);
    const { binEdges, counts } = tally(values);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(101);
    expect(counts.length).toBeLessThanOrEqual(40);
    expect(binEdges[0]).toBe(-0.5);
    expect(binEdges[binEdges.length - 1]).toBe(100.5);
    const widths = binEdges.slice(1).map((edge, i) => edge - binEdges[i]);
    for (const width of widths.slice(0, -1)) expect(width).toBe(widths[0]);
    expect(Number.isInteger(widths[0])).toBe(true);
    counts.slice(0, -1).forEach((c) => expect(c).toBe(widths[0]));
  });

  it("draws a single value as one bar", () => {
    const { binEdges, counts } = tally([5, 5, 5]);
    expect(binEdges).toEqual([4.5, 5.5]);
    expect(counts).toEqual([3]);
  });

  it("labels a bin by the seat counts it holds, not by its half-integer edges", () => {
    expect(integerBinLabel(-0.5, 0.5)).toBe("0");
    expect(integerBinLabel(2.5, 5.5)).toBe("3 – 5");
  });

  it("builds the card's histogram on whole numbers from a real run", () => {
    const input: SimulationInput = {
      schedule: [{ id: "sat", players: 100, buyIn: 10, rake: .1, roi: .2, itmRate: .132,
        payoutStructure: "satellite-ticket", count: 12 }],
      scheduleRepeats: 1, samples: 400, bankroll: 0, seed: 7, finishModel: { id: "power-law" },
    };
    const stats = computeSatelliteStats(runSimulation(input), input.schedule, 1)!;
    const { binEdges, counts } = stats.histogram;
    expect(binEdges).toHaveLength(counts.length + 1);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(400);
    expect(Number.isInteger(binEdges[0] + 0.5)).toBe(true);
    expect(binEdges[1] - binEdges[0]).toBe(1);
    const populated = counts.findIndex((c) => c > 0);
    const lastPopulated = counts.length - 1 - [...counts].reverse().findIndex((c) => c > 0);
    expect(counts.slice(populated, lastPopulated + 1).every((c) => c > 0)).toBe(true);
  });
});
