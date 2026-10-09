import { describe, expect, it } from "vitest";
import { battleRoyaleRowFromTotalTicket } from "./battleRoyaleTicket";
import { compileSchedule } from "./engine";
import { computeRowStats } from "./previewRowStats";
import { compiledEntryMoments } from "./scheduleMoments";
import type { TournamentRow } from "./types";

describe("computeRowStats", () => {
  it("uses configured Battle Royale bountyFraction as the neutral KO EV share", () => {
    const ticket = battleRoyaleRowFromTotalTicket(10);
    const row: TournamentRow = {
      id: "br",
      label: "br",
      players: 18,
      buyIn: ticket.buyIn,
      rake: ticket.rake,
      roi: 0,
      gameType: "mystery-royale",
      payoutStructure: "battle-royale",
      bountyFraction: 0.45,
      mysteryBountyVariance: 1.8,
      itmRate: 0.2,
      count: 1,
      bountyEvBias: 0,
    };

    const stats = computeRowStats(row, { id: "power-law" });

    expect(stats.bountyShare).toBeCloseTo(0.45, 10);
    expect(stats.cashEvPerEntry / stats.evPerEntry).toBeCloseTo(0.55, 10);
  });
});

describe("computeRowStats mirrors the engine on guaranteed bounty rows", () => {
  it("matches compiled ITM / α / EV when the guarantee exceeds N·buyIn", () => {
    const row: TournamentRow = {
      id: "pko-g",
      label: "pko-g",
      players: 100,
      buyIn: 10,
      rake: 0.1,
      roi: 0.1,
      gameType: "pko",
      payoutStructure: "mtt-gg-bounty",
      bountyFraction: 0.5,
      guarantee: 2000,
      count: 1,
    };
    const model = { id: "power-law" as const };
    const entry = compileSchedule({
      schedule: [row],
      scheduleRepeats: 1,
      samples: 1,
      bankroll: 100,
      seed: 1,
      finishModel: model,
    }).flat[0];
    const stats = computeRowStats(row, model);

    let cashPool = 0;
    for (let i = 0; i < entry.prizeByPlace.length; i++) {
      cashPool += entry.prizeByPlace[i];
    }
    expect(cashPool).toBeCloseTo(1500, 6);
    expect(stats.itm).toBeCloseTo(entry.itm, 4);
    expect(stats.alpha).toBeCloseTo(entry.alpha, 4);
    expect(stats.evPerEntry).toBeCloseTo(entry.analyticMeanSingle, 4);
  });
});

describe("computeRowStats σ is the compiled entry's σ", () => {
  const model = { id: "power-law" as const };
  const base: TournamentRow = {
    id: "r", label: "r", players: 500, buyIn: 20, rake: 0.1, roi: 0.1,
    payoutStructure: "mtt-standard", count: 1,
  };
  const pko: TournamentRow = {
    ...base, gameType: "pko", payoutStructure: "mtt-gg-bounty", bountyFraction: 0.5,
  };
  const ticket = battleRoyaleRowFromTotalTicket(10);
  const br: TournamentRow = {
    ...base, players: 18, buyIn: ticket.buyIn, rake: ticket.rake, roi: 0.03,
    gameType: "mystery-royale", payoutStructure: "battle-royale", bountyFraction: 0.45,
    mysteryBountyVariance: 1.8, itmRate: 0.18,
  };
  const ocean: TournamentRow = {
    ...base, players: 1000, buyIn: 92, rake: 8 / 92, bountyFraction: 50 / 92,
    gameType: "ocean-ko", payoutStructure: "mtt-gg-bounty",
  };

  function compiledMoments(row: TournamentRow) {
    const entry = compileSchedule({
      schedule: [row], scheduleRepeats: 1, samples: 1, bankroll: 1, seed: 1, finishModel: model,
    }).flat[0];
    const m = compiledEntryMoments(entry);
    return {
      std: Math.sqrt(m.secondDollar - m.meanDollar ** 2),
      lower: m.secondDollarLower === undefined
        ? undefined
        : Math.sqrt(m.secondDollarLower - m.meanDollar ** 2),
    };
  }

  it.each([
    ["PKO", pko],
    ["PKO with heat", { ...pko, pkoHeat: 0.6 }],
    ["Mystery", { ...pko, gameType: "mystery" as const, payoutStructure: "mtt-gg-mystery" as const, mysteryBountyVariance: 2 }],
    ["Battle Royale", br],
    ["freezeout", base],
  ])("%s preview σ equals the compiled-moments σ", (_name, row) => {
    expect(computeRowStats(row, model).payoutStd).toBeCloseTo(compiledMoments(row).std, 8);
  });

  it("the PKO figure now carries the bounty noise the place-only σ left out", () => {
    const withNoise = computeRowStats(pko, model).payoutStd;
    const placesOnly = computeRowStats(pko, model, { skipCompiledSigma: true }).payoutStd;
    expect(withNoise).toBeGreaterThan(placesOnly * 1.03);
  });

  it("integrates every field-size variant instead of the first one", () => {
    const varied: TournamentRow = {
      ...pko, fieldVariability: { kind: "uniform", min: 100, max: 3000, buckets: 4 },
    };
    const preview = computeRowStats(varied, model).payoutStd;
    expect(preview).toBeCloseTo(compiledMoments(varied).std, 8);
    expect(Math.abs(preview - computeRowStats(pko, model).payoutStd)).toBeGreaterThan(0.1);
  });

  it("keeps Ocean's own upper and lower bounds, which are the compiled ones", () => {
    const stats = computeRowStats(ocean, model);
    const compiled = compiledMoments(ocean);
    expect(stats.payoutStd).toBeCloseTo(compiled.std, 6);
    expect(stats.payoutStdLower).toBeCloseTo(compiled.lower!, 6);
  });

  it("falls back to the place-only σ for a row the compiler rejects", () => {
    const stats = computeRowStats({ ...pko, pkoHeat: 9 }, model);
    expect(Number.isFinite(stats.payoutStd)).toBe(true);
    expect(stats.payoutStd).toBeCloseTo(
      computeRowStats({ ...pko, pkoHeat: 9 }, model, { skipCompiledSigma: true }).payoutStd, 12,
    );
  });
});
