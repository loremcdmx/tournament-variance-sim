import { describe, expect, it } from "vitest";
import { battleRoyaleRowFromTotalTicket } from "./battleRoyaleTicket";
import { compileSchedule } from "./engine";
import { computeRowStats } from "./previewRowStats";
import { compiledEntryMoments } from "./scheduleMoments";
import type { TournamentRow } from "./types";
import { validateSchedule } from "./validation";

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
    // ~2 % on this row: the regular column's steep top already carries most
    // of the place spread, so the knockout noise adds less on top of it.
    expect(withNoise).toBeGreaterThan(placesOnly * 1.015);
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

describe("computeRowStats on a Field-size range describes the fields the engine plays", () => {
  const model = { id: "power-law" as const };
  const base: TournamentRow = {
    id: "r", label: "r", players: 1000, buyIn: 20, rake: 0.1, roi: 0.1,
    payoutStructure: "mtt-standard", gameType: "freezeout", count: 1,
  };
  const range = (min: number, max: number, buckets = 5) =>
    ({ kind: "uniform", min, max, buckets }) as const;

  function compiledVariants(row: TournamentRow) {
    const slot = compileSchedule({
      schedule: [row], scheduleRepeats: 1, samples: 1, bankroll: 1, seed: 1, finishModel: model,
    }, "alpha").flat[0];
    return { slot, variants: slot.variants ?? [slot] };
  }
  // Probability of finishing in 0-indexed place `place`, read back off the
  // alias table the hot loop samples from.
  function placeProbability(entry: { aliasProb: ArrayLike<number>; aliasIdx: ArrayLike<number> }, place: number) {
    const n = entry.aliasProb.length;
    let p = 0;
    for (let i = 0; i < n; i++) {
      if (i === place) p += entry.aliasProb[i] / n;
      if (entry.aliasIdx[i] === place) p += (1 - entry.aliasProb[i]) / n;
    }
    return p;
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  it.each([
    ["a centred range", base, range(600, 1400)],
    ["an off-centre range", base, range(2000, 3000)],
    ["a wide range", base, range(200, 4000)],
    ["a pinned ITM", { ...base, itmRate: 0.15 }, range(2000, 3000)],
    ["a small-field range", { ...base, itmRate: 0.16 }, range(60, 400, 4)],
  ])("P(1st), ITM and EV are the mean over the variants for %s", (_name, source, fv) => {
    const row: TournamentRow = { ...source, fieldVariability: fv };
    const stats = computeRowStats(row, model);
    const { slot, variants } = compiledVariants(row);

    expect(stats.shellP1).toBeCloseTo(mean(variants.map((v) => placeProbability(v, 0))), 9);
    expect(stats.itm).toBeCloseTo(slot.itm, 9);
    expect(stats.evPerEntry).toBeCloseTo(mean(variants.map((v) => v.analyticMeanSingle)), 7);
    expect(stats.tiers[0].key).toBe("winner");
    expect(stats.tiers[0].field).toBeCloseTo(stats.shellP1, 12);
    expect(stats.tiers.reduce((a, t) => a + t.field, 0)).toBeCloseTo(1, 9);
    expect(stats.tiers.reduce((a, t) => a + t.ev, 0)).toBeCloseTo(stats.evPerEntry, 9);
    expect(stats.tiers.reduce((a, t) => a + t.netDollars, 0)).toBeCloseTo(
      stats.evPerEntry - stats.cost, 9,
    );
  });

  it("is not the preview of a single field the sim never plays", () => {
    const row: TournamentRow = { ...base, fieldVariability: range(2000, 3000) };
    const nominal = computeRowStats({ ...row, fieldVariability: undefined }, model);
    const stats = computeRowStats(row, model);
    expect(nominal.shellP1 / stats.shellP1).toBeGreaterThan(1.5);
  });

  it("does not move when the unused nominal field is edited", () => {
    const row: TournamentRow = { ...base, fieldVariability: range(300, 700) };
    const reference = computeRowStats(row, model);
    for (const players of [100, 500, 5000]) {
      expect(computeRowStats({ ...row, players }, model)).toEqual(reference);
    }
  });

  it.each([4, 5, 6])("reads paid places over the midpoint as the paid share at %i buckets", (buckets) => {
    const row: TournamentRow = { ...base, players: 500, fieldVariability: range(300, 700, buckets) };
    const stats = computeRowStats(row, model);
    expect(stats.paidCount / 500).toBeCloseTo(0.15, 2);
  });

  it("moves with the range ends", () => {
    const a = computeRowStats({ ...base, fieldVariability: range(300, 700) }, model);
    const b = computeRowStats({ ...base, fieldVariability: range(300, 1500) }, model);
    expect(b.shellP1).toBeLessThan(a.shellP1);
  });

  it("splits cash and bounty EV across the variants of a bounty row", () => {
    const pko: TournamentRow = {
      ...base, gameType: "pko", payoutStructure: "mtt-gg-bounty", bountyFraction: 0.5,
      fieldVariability: range(300, 2400, 4),
    };
    const stats = computeRowStats(pko, model);
    const { variants } = compiledVariants(pko);
    expect(stats.evPerEntry).toBeCloseTo(mean(variants.map((v) => v.analyticMeanSingle)), 7);
    expect(stats.cashEvPerEntry + stats.bountyEvPerEntry).toBeCloseTo(stats.evPerEntry, 9);
    expect(stats.bountyShare).toBeCloseTo(stats.bountyEvPerEntry / stats.evPerEntry, 12);
    expect(stats.tiers.reduce((a, t) => a + t.bountyEv, 0)).toBeCloseTo(stats.bountyEvPerEntry, 9);
    expect(stats.tiers.reduce((a, t) => a + t.cashEv, 0)).toBeCloseTo(stats.cashEvPerEntry, 9);
  });

  it("is the single-field preview when the range collapses to one bucket", () => {
    const collapsed = computeRowStats({ ...base, fieldVariability: range(2000, 3000, 1) }, model);
    const fixed = computeRowStats({ ...base, players: 2500 }, model);
    expect(collapsed.shellP1).toBe(fixed.shellP1);
    expect(collapsed.itm).toBe(fixed.itm);
    expect(collapsed.paidCount).toBe(fixed.paidCount);
    expect(collapsed.tiers).toEqual(fixed.tiers);
  });

  it("keeps tier shares that are defined per field share summed over the variants' own paid places", () => {
    const stats = computeRowStats({ ...base, fieldVariability: range(60, 400, 4) }, model);
    const keys = stats.tiers.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe("winner");
    expect(keys[keys.length - 1]).toBe("ootm");
  });

  it("carries the engine's mixture σ even when the compiled σ is skipped", () => {
    const row: TournamentRow = { ...base, fieldVariability: range(100, 3000, 4) };
    const { slot } = compiledVariants(row);
    const m = compiledEntryMoments(slot);
    const compiledStd = Math.sqrt(m.secondDollar - m.meanDollar ** 2);
    expect(computeRowStats(row, model).payoutStd).toBeCloseTo(compiledStd, 8);
    expect(computeRowStats(row, model, { skipCompiledSigma: true }).payoutStd).toBeCloseTo(compiledStd, 6);
  });
});

describe("computeRowStats shell feasibility agrees with validateSchedule on bounty rows", () => {
  const model = { id: "power-law" as const };
  const pko = (over: Partial<TournamentRow>): TournamentRow => ({
    id: "r", label: "r", players: 1000, buyIn: 50, rake: 0.1, roi: 1,
    gameType: "pko", payoutStructure: "mtt-gg-bounty", bountyFraction: 0.5,
    itmRate: 0.2, count: 1, ...over,
  });

  it("is feasible when the engine closes the ROI gap by shrinking the KO budget", () => {
    const row = pko({ finishBuckets: { first: 0.03 } });
    expect(validateSchedule([row], model).ok).toBe(true);
    const stats = computeRowStats(row, model);
    expect(stats.shellMode).toBe(true);
    expect(stats.shellFeasible).toBe(true);
  });

  it("stays infeasible when the locked cash EV alone is above the total target", () => {
    const row = pko({ roi: 0.2, finishBuckets: { first: 0.05 } });
    expect(validateSchedule([row], model).ok).toBe(false);
    expect(computeRowStats(row, model).shellFeasible).toBe(false);
  });

  it("keeps a freezeout row's own feasibility rule", () => {
    const row: TournamentRow = {
      id: "f", label: "f", players: 100, buyIn: 50, rake: 0.1, roi: 1,
      payoutStructure: "mtt-standard", itmRate: 0.02, count: 1,
    };
    expect(validateSchedule([row], model).ok).toBe(false);
    expect(computeRowStats(row, model).shellFeasible).toBe(false);
  });
});

describe("computeRowStats zero-skill column sums to the rake", () => {
  const model = { id: "power-law" as const };
  const ticket = battleRoyaleRowFromTotalTicket(10);
  const rows: Array<[string, TournamentRow]> = [
    ["PKO", { id: "p", label: "p", players: 1000, buyIn: 50, rake: 0.1, roi: 0.5, gameType: "pko", payoutStructure: "mtt-gg-bounty", bountyFraction: 0.5, count: 1 }],
    ["PKO with a fixed ITM", { id: "p", label: "p", players: 1000, buyIn: 50, rake: 0.1, roi: 0.5, gameType: "pko", payoutStructure: "mtt-gg-bounty", bountyFraction: 0.5, itmRate: 0.2, count: 1 }],
    ["losing PKO", { id: "p", label: "p", players: 200, buyIn: 20, rake: 0.1, roi: -0.2, gameType: "pko", payoutStructure: "mtt-gg-bounty", bountyFraction: 0.5, count: 1 }],
    ["Mystery", { id: "m", label: "m", players: 1000, buyIn: 50, rake: 0.1, roi: 0.2, gameType: "mystery", payoutStructure: "mtt-gg-mystery", bountyFraction: 0.5, mysteryBountyVariance: 2, count: 1 }],
    ["Battle Royale", { id: "b", label: "b", players: 18, buyIn: ticket.buyIn, rake: ticket.rake, roi: 0.3, gameType: "mystery-royale", payoutStructure: "battle-royale", bountyFraction: 0.45, mysteryBountyVariance: 1.8, itmRate: 0.2, count: 1 }],
    ["Ocean KO", { id: "o", label: "o", players: 500, buyIn: 92, rake: 8 / 92, roi: 0.1, gameType: "ocean-ko", payoutStructure: "mtt-gg-bounty", bountyFraction: 0.5, count: 1 }],
    ["freezeout", { id: "f", label: "f", players: 1000, buyIn: 50, rake: 0.1, roi: 0.5, payoutStructure: "mtt-standard", count: 1 }],
  ];

  it.each(rows)("%s: a uniform finisher loses exactly the rake", (_name, row) => {
    const stats = computeRowStats(row, model);
    const eq = stats.tiers.reduce((a, t) => a + t.eqNetDollars, 0);
    expect(eq).toBeCloseTo(-row.rake * row.buyIn, 6);
  });

  it("adds a guarantee overlay per seat on top of the rake", () => {
    const row: TournamentRow = {
      id: "g", label: "g", players: 100, buyIn: 10, rake: 0.1, roi: 0.1, gameType: "pko",
      payoutStructure: "mtt-gg-bounty", bountyFraction: 0.5, guarantee: 2000, count: 1,
    };
    const eq = computeRowStats(row, model).tiers.reduce((a, t) => a + t.eqNetDollars, 0);
    expect(eq).toBeCloseTo((2000 - 100 * 10) / 100 - 0.1 * 10, 6);
  });

  it("leaves the skill-calibrated column untouched", () => {
    const stats = computeRowStats(rows[0][1], model);
    const net = stats.tiers.reduce((a, t) => a + t.netDollars, 0);
    expect(net).toBeCloseTo(stats.evPerEntry - stats.cost, 6);
  });
});
