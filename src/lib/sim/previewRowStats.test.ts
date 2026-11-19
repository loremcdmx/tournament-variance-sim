import { describe, expect, it } from "vitest";
import { battleRoyaleRowFromTotalTicket } from "./battleRoyaleTicket";
import { compileSchedule } from "./engine";
import { computeRowStats } from "./previewRowStats";
import { applyGameType, normalizeGameTypeConsistency } from "./gameType";
import { applyItmTarget } from "./itmTarget";
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

  it("solves the same first place as the engine on a bounty row whose cash side overpays below break-even", () => {
    // PKO 45 at ITM 18.7%, ROI -9.5%: the 1/N solution's cash side overpays
    // its target and the KO budget hands the excess back, so the first-place
    // floor's share depends on the row's total winnings. The preview has to
    // pass the same total as the engine, or its P(1st) falls short.
    let row: TournamentRow = { ...base, players: 45, buyIn: 100, roi: -0.095 };
    row = { ...row, ...applyGameType(row, "pko"), players: 45, itmRate: 0.187 };
    const fm = { id: "powerlaw-realdata-influenced" as const };
    const entry = compileSchedule({
      schedule: [row], scheduleRepeats: 1, samples: 1, bankroll: 1, seed: 1, finishModel: fm,
    }).flat[0];
    let first = 0;
    for (let i = 0; i < entry.fieldSize; i++) {
      if (i === 0) first += entry.aliasProb[i] / entry.fieldSize;
      if (entry.aliasIdx[i] === 0) first += (1 - entry.aliasProb[i]) / entry.fieldSize;
    }
    const stats = computeRowStats(row, fm);
    expect(stats.shellP1).toBeCloseTo(first, 10);
    expect(first * 45).toBeGreaterThan(0.5);
  });

  it("the PKO figure now carries the bounty noise the place-only σ left out", () => {
    const withNoise = computeRowStats(pko, model).payoutStd;
    const placesOnly = computeRowStats(pko, model, { skipCompiledSigma: true }).payoutStd;
    // 1.2 % on this row: the regular column's steep top already carries most
    // of the place spread, so the knockout spread adds little on top of it.
    expect(withNoise).toBeGreaterThan(placesOnly * 1.01);
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

  it("prints the last paid place and the bubble at their mixed probability when some fields pay 27 or fewer", () => {
    const row: TournamentRow = {
      ...base, buyIn: 10, players: 200, fieldVariability: range(120, 280),
    };
    const stats = computeRowStats(row, model);
    const { variants } = compiledVariants(row);
    const paidOf = (v: { prizeByPlace: ArrayLike<number> }) =>
      Array.from(v.prizeByPlace).filter((p) => p > 0).length;
    expect(variants.some((v) => paidOf(v) <= 27)).toBe(true);
    expect(variants.some((v) => paidOf(v) > 27)).toBe(true);

    const tier = (key: string) => stats.tiers.find((t) => t.key === key)!;
    const lastPaid = mean(variants.map((v) => placeProbability(v, paidOf(v) - 1)));
    const bubble = mean(variants.map((v) => placeProbability(v, paidOf(v))));
    expect(tier("firstMincash").field).toBeCloseTo(lastPaid, 9);
    expect(tier("firstMincash").field).toBeCloseTo(stats.shellFirstCash, 12);
    expect(tier("bubble").field).toBeCloseTo(bubble, 9);
    expect(tier("firstMincash").eqShare).toBeCloseTo(mean(variants.map((v) => 1 / v.prizeByPlace.length)), 12);
    expect(stats.tiers.reduce((a, t) => a + t.field, 0)).toBeCloseTo(1, 12);
  });

  it("leaves a fixed field that pays 27 or fewer on its own layout", () => {
    const fixed = computeRowStats({ ...base, buyIn: 10, players: 136 }, model);
    expect(fixed.paidCount).toBeLessThanOrEqual(27);
    expect(fixed.tiers.at(-3)!.key).toBe("top27");
    expect(fixed.tiers.at(-3)!.posHi).toBe(fixed.paidCount);
    expect(fixed.tiers.some((t) => t.key === "firstMincash")).toBe(false);
  });

  it("carries the engine's mixture σ even when the compiled σ is skipped", () => {
    const row: TournamentRow = { ...base, fieldVariability: range(100, 3000, 4) };
    const { slot } = compiledVariants(row);
    const m = compiledEntryMoments(slot);
    const compiledStd = Math.sqrt(m.secondDollar - m.meanDollar ** 2);
    expect(computeRowStats(row, model).payoutStd).toBeCloseTo(compiledStd, 8);
    expect(computeRowStats(row, model, { skipCompiledSigma: true }).payoutStd).toBeCloseTo(compiledStd, 6);
  });

  it("previews a Battle Royale row that still carries a range as the 18-max the engine plays", () => {
    // compileSchedule and validateSchedule drop the range from a BR row, so
    // the preview must not average over the range's 10-26 entrants.
    const editorRow: TournamentRow = { ...base, players: 18, buyIn: 10 };
    const br: TournamentRow = {
      ...editorRow,
      ...applyGameType(editorRow, "mystery-royale"),
      fieldVariability: range(10, 26, 3),
    };
    const stats = computeRowStats(br, model);
    const { slot } = compiledVariants(br);
    const m = compiledEntryMoments(slot);
    let cashEv = 0;
    for (let i = 0; i < slot.fieldSize; i++) cashEv += placeProbability(slot, i) * slot.prizeByPlace[i];

    expect(slot.fieldSize).toBe(18);
    expect(stats).toEqual(computeRowStats(normalizeGameTypeConsistency(br), model));
    expect(stats.evPerEntry).toBeCloseTo(slot.analyticMeanSingle, 9);
    expect(stats.cashEvPerEntry).toBeCloseTo(cashEv, 9);
    expect(stats.payoutStd).toBeCloseTo(Math.sqrt(m.secondDollar - m.meanDollar ** 2), 9);
    expect(stats.bountyShare).toBeCloseTo(br.bountyFraction!, 9);
  });

  it("previews a Mystery row left on the Battle Royale table as the Mystery row the engine plays", () => {
    // An explicit gameType wins: compileSchedule moves the payout to
    // mtt-gg-mystery, and the preview must use the same table.
    const row: TournamentRow = {
      ...base, players: 200, gameType: "mystery", payoutStructure: "battle-royale",
      bountyFraction: 0.5, mysteryBountyVariance: 2, itmRate: 0.15,
    };
    const stats = computeRowStats(row, model);
    const { slot } = compiledVariants(row);
    const m = compiledEntryMoments(slot);

    expect(stats).toEqual(computeRowStats(normalizeGameTypeConsistency(row), model));
    expect(stats.paidCount).toBe(slot.paidCount);
    expect(stats.evPerEntry).toBeCloseTo(slot.analyticMeanSingle, 9);
    expect(stats.payoutStd).toBeCloseTo(Math.sqrt(m.secondDollar - m.meanDollar ** 2), 9);
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

  it("is infeasible when the residual bounty would pass the whole bounty pool", () => {
    const hu = pko({ players: 2, buyIn: 100, roi: 0.05, itmRate: 0.5 });
    expect(validateSchedule([hu], model).ok).toBe(false);
    expect(computeRowStats(hu, model).shellFeasible).toBe(false);
    const fair = { ...hu, itmRate: 0.5775 };
    expect(validateSchedule([fair], model).ok).toBe(true);
    expect(computeRowStats(fair, model).shellFeasible).toBe(true);
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

describe("computeRowStats on a Mystery field that pays one place", () => {
  const model = { id: "power-law" as const };
  // The editor's route: switch the format to Mystery, then type 2 players.
  const headsUp = (roi: number, itm: { enabled: boolean; pct: number }): TournamentRow => {
    const seed: TournamentRow = {
      id: "hu", label: "hu", players: 500, buyIn: 10, rake: 0.1, roi,
      payoutStructure: "mtt-standard", gameType: "freezeout", count: 1,
    };
    const row = { ...seed, ...applyGameType(seed, "mystery"), players: 2 };
    return normalizeGameTypeConsistency(applyItmTarget([row], itm)[0]);
  };

  it.each([
    [0.1, false],
    [0, false],
    [-0.0909, false],
    [0, true],
  ])("keeps the typed ROI at ROI %d (global ITM %s), as the engine does", (roi, enabled) => {
    const row = headsUp(roi, { enabled, pct: 18.7 });
    const stats = computeRowStats(row, model);
    const cost = row.buyIn * (1 + row.rake);
    expect(stats.paidCount).toBe(1);
    expect(stats.evPerEntry).toBeCloseTo(cost * (1 + roi), 9);
    const entry = compileSchedule({
      schedule: [row], scheduleRepeats: 1, samples: 1, bankroll: 1, seed: 1, finishModel: model,
    }).flat[0];
    expect(stats.evPerEntry).toBeCloseTo(entry.analyticMeanSingle, 9);
    expect(stats.bountyEvPerEntry).toBeGreaterThan(0);
    expect(stats.cashEvPerEntry + stats.bountyEvPerEntry).toBeCloseTo(stats.evPerEntry, 12);
  });

  it("pays the whole bounty pool to the winner, as compileEntry's fallback does", () => {
    const stats = computeRowStats(headsUp(0.1, { enabled: false, pct: 18.7 }), model);
    const [winner, loser] = stats.tiers;
    expect(winner.key).toBe("winner");
    expect(winner.bountyEv).toBeCloseTo(stats.bountyEvPerEntry, 12);
    expect(loser.bountyEv).toBe(0);
    expect(stats.tiers.reduce((a, t) => a + t.eqNetDollars, 0)).toBeCloseTo(-1, 9);
  });
});
