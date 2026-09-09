import { describe, expect, it } from "vitest";
import { runSimulation } from "@/lib/sim/engine";
import type { SimulationInput } from "@/lib/sim/types";
import { computeSatelliteStats } from "./satellite";

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
