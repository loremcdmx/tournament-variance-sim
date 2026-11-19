import { describe, expect, it } from "vitest";
import { compileSchedule } from "./compile";
import { runSimulation } from "./engine";
import { computeRowStats } from "./previewRowStats";
import { applyItmTarget } from "./itmTarget";
import { compiledEntryMoments } from "./scheduleMoments";
import type { FinishModelConfig, SimulationInput, TournamentRow } from "./types";
import { validateSchedule } from "./validation";

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

describe("the PrimeDope pass with PD's finish model off", () => {
  const sng: TournamentRow = {
    id: "sng", players: 9, buyIn: 10, rake: 0.1, roi: 0.05,
    payoutStructure: "sng-50-30-20", gameType: "freezeout", itmRate: 3 / 9, count: 1,
  };
  const pd = (r: TournamentRow, m: FinishModelConfig = { id: "powerlaw-realdata-influenced" }) =>
    compileSchedule(
      input(r, { samples: 10, scheduleRepeats: 200, finishModel: m, usePrimedopeFinishModel: false }),
      "primedope-binary-itm",
    );

  it("says it missed the target when the row's ITM lands on PD's one-place table", () => {
    // PD pays 1 place of 9 from a pool of 9 x $9: the row's 1/3 ITM wins $81
    // a third of the time, $27 a ticket against the $11.55 the ROI asks for.
    const c = pd(sng);
    expect(c.calibrationWarnings).toEqual([
      { rowId: "sng", kind: "primedope-target-clamped", targetWinnings: 11.55, actualWinnings: 27 },
    ]);
    expect(c.expectedProfit).toBeCloseTo(200 * (27 - 11), 9);
  });

  it("stays quiet on a row the pass still hits, and for a model that never aims at the ROI", () => {
    const mtt = pd({ ...sng, players: 1000, payoutStructure: "mtt-standard", itmRate: 0.15 });
    expect(mtt.calibrationWarnings).toBeUndefined();
    expect(mtt.expectedProfit).toBeCloseTo(200 * 11 * 0.05, 6);
    expect(pd(sng, { id: "uniform" }).calibrationWarnings).toBeUndefined();
  });
});

describe("a row whose pinned ITM cannot reach the ROI on our own model", () => {
  // Heads-up winner-takes-all at ITM 50% pays $20 half the time: $10 a ticket
  // whatever ROI is typed. Run is blocked on it; a caller that skips
  // validateSchedule must still get the profit the samples will show.
  const hu: TournamentRow = {
    id: "hu", players: 2, buyIn: 10, rake: 0.05, roi: 0.03,
    payoutStructure: "winner-takes-all", itmRate: 0.5, count: 500,
  };

  it("warns and takes the expected profit from the pmf", () => {
    expect(validateSchedule([hu], model).ok).toBe(false);
    const c = compileSchedule(input(hu, { samples: 10 }));
    expect(c.calibrationWarnings).toEqual([
      { rowId: "hu", kind: "target-unreachable", targetWinnings: 10.5 * 1.03, actualWinnings: 10 },
    ]);
    expect(c.expectedProfit).toBeCloseTo(500 * (10 - 10.5), 9);
  });

  it("stays quiet on a row validation accepts", () => {
    const mtt: TournamentRow = { ...hu, id: "mtt", players: 500, payoutStructure: "mtt-standard", roi: 0.2, itmRate: 0.15 };
    expect(validateSchedule([mtt], model).ok).toBe(true);
    const c = compileSchedule(input(mtt, { samples: 10 }));
    expect(c.calibrationWarnings).toBeUndefined();
    expect(c.expectedProfit).toBeCloseTo(500 * 10.5 * 0.2, 9);
  });
});

describe("a Mystery table that pays one place", () => {
  // Heads-up Mystery: the KO window (the paid places) is empty, yet the one
  // knockout of the match is made by the winner. The ITM is the one the ROI
  // implies heads-up (applyItmTarget): $12.10 / ($10 cash + $10 bounty pool).
  const hu: TournamentRow = {
    id: "hu", players: 2, buyIn: 10, rake: 0.1, roi: 0.1,
    payoutStructure: "mtt-gg-mystery", gameType: "mystery", bountyFraction: 0.5,
    mysteryBountyVariance: 2, itmRate: 0.605, count: 1,
  };

  it("runs at the ITM the ROI implies", () => {
    expect(applyItmTarget([{ ...hu, itmRate: undefined }], { enabled: false, pct: 18.7 })[0].itmRate)
      .toBeCloseTo(0.605, 12);
    expect(validateSchedule([hu], model).ok).toBe(true);
  });

  it("gives the whole bounty budget to the winner and none to the loser", () => {
    const entry = compileOne(hu);
    expect(entry.paidCount).toBe(1);
    // Cash 0.605 x $10, so the bounty closes $12.10 - $6.05 = $6.05 per entry:
    // the winner takes the whole $10 pool.
    expect(entry.bountyByPlace![0]).toBeCloseTo(10, 12);
    expect(entry.bountyByPlace![1]).toBe(0);
    expect(Array.from(entry.bountyKmean!)).toEqual([0, 0]);
    expect(entry.analyticMeanSingle).toBeCloseTo(12.1, 12);
  });

  it("matches its Monte Carlo σ: a loser keeps nothing", () => {
    const entry = compileOne(hu);
    const m = compiledEntryMoments(entry);
    const sigma = Math.sqrt(m.secondDollar - m.meanDollar ** 2);
    // Two outcomes, +$9 at 60.5% or -$11: σ = 20·√(0.605·0.395).
    expect(sigma).toBeCloseTo(20 * Math.sqrt(0.605 * 0.395), 9);
    const res = runSimulation(input(hu, { samples: 20000, seed: 20261119, scheduleRepeats: 1 }));
    expect(res.stats.min).toBeCloseTo(-11, 9);
    expect(res.stats.max).toBeCloseTo(9, 9);
    // SE of a sample σ for a two-point law is σ·√((κ−1)/(4S)) with κ ≈ 1.18
    // here; the normal-theory σ/√(2S) is the wider band.
    const seSigma = sigma / Math.sqrt(2 * (res.samples - 1));
    expect(Math.abs(res.stats.stdDev - sigma) / seSigma).toBeLessThan(4);
    const seMean = sigma / Math.sqrt(res.samples);
    expect(Math.abs(res.stats.mean - 1.1) / seMean).toBeLessThan(4);
  });

  it("leaves a Mystery table with a KO window as it was", () => {
    const three = compileOne({ ...hu, players: 3, itmRate: 2 / 3 });
    expect(three.bountyKmean![0]).toBe(1);
    expect(three.bountyByPlace![1]).toBe(0);
  });
});
