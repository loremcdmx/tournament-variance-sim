import { describe, expect, it } from "vitest";
import { compileSchedule } from "./compile";
import { runSimulation } from "./engine";
import { computeRowStats } from "./previewRowStats";
import type { FinishModelConfig, SimulationInput, TournamentRow } from "./types";

const model: FinishModelConfig = { id: "power-law" };

function input(row: TournamentRow, over: Partial<SimulationInput> = {}): SimulationInput {
  return {
    schedule: [row],
    scheduleRepeats: 1,
    samples: 2000,
    bankroll: 0,
    seed: 7,
    finishModel: model,
    ...over,
  };
}

function compileOne(row: TournamentRow) {
  return compileSchedule(input(row, { samples: 10 })).flat[0];
}

function row(over: Partial<TournamentRow> = {}): TournamentRow {
  return {
    id: "r",
    players: 300,
    buyIn: 20,
    rake: 0.1,
    roi: 0.1,
    payoutStructure: "mtt-gg-mystery",
    bountyFraction: 0.5,
    mysteryBountyVariance: 2,
    count: 3,
    ...over,
  };
}

describe("a row with no gameType compiles as the type inferGameType reads", () => {
  it("plays a legacy Mystery payout row exactly like the same row marked Mystery", () => {
    const legacy = row();
    const explicit = row({ gameType: "mystery" });
    const a = compileOne(legacy);
    const b = compileOne(explicit);

    expect(a.bountyByPlace).toEqual(b.bountyByPlace);
    expect(a.bountyKmean).toEqual(b.bountyKmean);
    expect(a.mysteryBountyLogVar).toBe(b.mysteryBountyLogVar);
    expect(a.analyticMeanSingle).toBe(b.analyticMeanSingle);
  });

  it("window-limits the envelope drops of a legacy Mystery row to the paid places, as Mystery does", () => {
    const entry = compileOne(row());
    const kmean = entry.bountyKmean!;
    // Only busts whose victim finished in the money drop an envelope, so the
    // PKO full-range harmonic (which keeps counting kills past the bubble)
    // must not be what a Mystery row gets.
    const lastPaid = entry.paidCount - 1;
    expect(kmean[lastPaid]).toBe(0);
    expect(kmean[0]).toBeGreaterThan(kmean[1]);
    const pko = compileOne(row({ gameType: "pko", payoutStructure: "mtt-gg-bounty", mysteryBountyVariance: undefined }));
    expect(pko.bountyKmean![lastPaid]).toBeGreaterThan(0);
  });

  it("recognises a legacy Mystery row by its bounty fields when the payout says nothing", () => {
    const legacy = row({ payoutStructure: "mtt-standard" });
    const explicit = row({ payoutStructure: "mtt-standard", gameType: "mystery" });
    expect(compileOne(legacy).bountyByPlace).toEqual(compileOne(explicit).bountyByPlace);
  });

  it("gives the same simulated result for the legacy and the explicit row", () => {
    const a = runSimulation(input(row()));
    const b = runSimulation(input(row({ gameType: "mystery" })));
    expect(a.stats.stdDev).toBe(b.stats.stdDev);
    expect(Array.from(a.finalProfits)).toEqual(Array.from(b.finalProfits));
  });

  it("shows the preview the bounty shape the engine plays", () => {
    const legacy = computeRowStats(row(), model);
    const explicit = computeRowStats(row({ gameType: "mystery" }), model);
    expect(legacy).toEqual(explicit);
  });

  it("leaves a legacy PKO row (no gameType) as it was", () => {
    const legacy = row({ payoutStructure: "mtt-gg-bounty", mysteryBountyVariance: undefined });
    const explicit = { ...legacy, gameType: "pko" as const };
    const a = compileOne(legacy);
    const b = compileOne(explicit);
    expect(a.bountyByPlace).toEqual(b.bountyByPlace);
    expect(a.bountyKmean).toEqual(b.bountyKmean);
    expect(a.mysteryBountyLogVar).toBe(b.mysteryBountyLogVar);
  });
});

describe("the cash target of a micro-stake row", () => {
  const micro = (roi: number): TournamentRow => ({
    id: "m",
    players: 100,
    buyIn: 0.01,
    rake: 0.1,
    roi,
    payoutStructure: "mtt-standard",
    gameType: "freezeout",
    count: 1,
  });

  it.each([-0.5, -0.1, 0, 0.3])("pays the typed ROI %f on a $0.01 ticket", (roi) => {
    const entry = compileOne(micro(roi));
    expect(entry.analyticMeanSingle / entry.singleCost - 1).toBeCloseTo(roi, 9);
  });

  it("keeps the old $0.01 floor from a $10 ticket up", () => {
    // At -99.95% a $10 ticket is owed 0.0055 in total: the floor, not the ROI,
    // decides the target here, and it must not have moved for normal stakes.
    const deep = (buyIn: number): TournamentRow => ({
      ...micro(-0.9995),
      players: 300,
      buyIn,
    });
    const entry = compileOne(deep(10));
    expect(entry.analyticMeanSingle).toBeCloseTo(0.01, 9);
  });
});
