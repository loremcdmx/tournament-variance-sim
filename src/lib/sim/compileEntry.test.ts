import { describe, expect, it } from "vitest";
import { compileSchedule } from "./compile";
import { withinTargetEv } from "./finishModel";
import { runSimulation } from "./engine";
import { computeRowStats } from "./previewRowStats";
import { applyItmTarget } from "./itmTarget";
import { compiledEntryMoments } from "./scheduleMoments";
import { applyGameType } from "./gameType";
import { applySitThroughPayJumps } from "./sitThroughPayJumps";
import { battleRoyaleRowFromTotalTicket } from "./battleRoyaleTicket";
import { makeBrTierSampler } from "./brBountyTiers";
import type { CompiledEntry } from "./engineTypes";
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

  it("frees the ITM where the row's ITM cannot pay the ROI on PD's one-place table", () => {
    // PD pays 1 place of 9 from a pool of 9 x $9: the row's 1/3 ITM would win
    // $81 a third of the time, $27 a ticket against the $11.55 the ROI asks for.
    const c = pd(sng);
    expect(c.calibrationWarnings).toBeUndefined();
    expect(withinTargetEv(c.flat[0].analyticMeanSingle, 11.55)).toBe(true);
    expect(c.expectedProfit).toBeCloseTo(200 * 11 * 0.05, 9);
    expect(c.flat[0].itm).toBeLessThan(3 / 9);
  });

  it("gives a heads-up 65/35 row at ITM 100% a real match to lose", () => {
    const c = pd({ ...sng, id: "hu", players: 2, payoutStructure: "sng-65-35", itmRate: 1, roi: 0.02 });
    expect(c.calibrationWarnings).toBeUndefined();
    expect(withinTargetEv(c.flat[0].analyticMeanSingle, 11 * 1.02)).toBe(true);
    expect(c.flat[0].itm).toBeGreaterThan(0.5);
    expect(c.flat[0].itm).toBeLessThan(1);
  });

  it("lets a stripped Battle Royale row play the ROI it is given", () => {
    const br = (roi: number) => pd({
      ...sng, id: "br", players: 18, payoutStructure: "battle-royale", gameType: "mystery-royale", itmRate: 0.18, roi,
    });
    for (const roi of [0.03, 0.08]) {
      const c = br(roi);
      expect(c.calibrationWarnings).toBeUndefined();
      expect(withinTargetEv(c.flat[0].analyticMeanSingle, 11 * (1 + roi))).toBe(true);
    }
  });

  it("keeps the ITM and the bytes of a row the pass already hits", () => {
    const mtt = { ...sng, players: 1000, payoutStructure: "mtt-standard" as const, itmRate: 0.15 };
    const c = pd(mtt);
    expect(c.calibrationWarnings).toBeUndefined();
    expect(c.expectedProfit).toBeCloseTo(200 * 11 * 0.05, 6);
    expect(c.flat[0].itm).toBeCloseTo(0.15, 12);
    expect(pd(sng, { id: "uniform" }).calibrationWarnings).toBeUndefined();
  });

  it("samples the ROI it prints on the auditors' rows", () => {
    // 4000 runs x 200 tournaments, seed 42. Bound: the simulated mean sits
    // within 4 standard errors of cost x ROI (|z| <= 1.3 here). The stamped
    // ITM played +145%, +64% with every match won, -9.5% and -18.2%.
    const rows: [TournamentRow, boolean][] = [
      [sng, true],
      [{ ...sng, id: "hu", players: 2, payoutStructure: "sng-65-35", itmRate: 1, roi: 0.02 }, true],
      [{ ...sng, id: "wta", players: 2, rake: 0.05, payoutStructure: "winner-takes-all", itmRate: 0.5, roi: 0.03 }, true],
      [{ ...sng, id: "sat", players: 100, payoutStructure: "satellite-ticket", itmRate: 0.1, roi: 0.2 }, false],
    ];
    for (const [r, pdPayouts] of rows) {
      const result = runSimulation(input(r, {
        samples: 4000, scheduleRepeats: 200, seed: 42, finishModel: { id: "powerlaw-realdata-influenced" },
        calibrationMode: "primedope-binary-itm", usePrimedopeFinishModel: false, usePrimedopePayouts: pdPayouts,
      }));
      const typed = 200 * r.buyIn * (1 + r.rake) * r.roi;
      const fp = result.finalProfits;
      const mean = fp.reduce((a, b) => a + b, 0) / fp.length;
      const se = Math.sqrt(fp.reduce((a, b) => a + (b - mean) ** 2, 0) / (fp.length - 1) / fp.length);
      expect(result.calibrationWarnings).toBeUndefined();
      expect(result.expectedProfit).toBeCloseTo(typed, 9);
      expect(Math.abs(mean - typed)).toBeLessThan(4 * se);
    }
  });

  it("keeps the row's ITM where a free ITM would land further from the ROI", () => {
    // 100-runner satellite on its own table (PD payouts off) at +100%: the
    // pinned 25% pays $22.50 against $22; linear skill with a free ITM tops
    // out far below that.
    const sat: TournamentRow = {
      ...sng, id: "sat", players: 100, payoutStructure: "satellite-ticket", itmRate: 0.25, roi: 1,
    };
    const c = compileSchedule(
      input(sat, {
        samples: 10, scheduleRepeats: 200, finishModel: { id: "linear-skill" },
        usePrimedopeFinishModel: false, usePrimedopePayouts: false,
      }),
      "primedope-binary-itm",
    );
    expect(c.flat[0].itm).toBeCloseTo(0.25, 12);
    expect(c.calibrationWarnings).toEqual([
      { rowId: "sat", kind: "primedope-free-itm-unreachable", targetWinnings: 22, actualWinnings: 22.5 },
    ]);
    expect(c.expectedProfit).toBeCloseTo(200 * (22.5 - 11), 9);
  });

  it("warns once, with its own notice, when no ITM on PD's table reaches the ROI", () => {
    // Heads-up winner-takes-all at +100%: $22 a ticket from a $18 pool.
    const hu: TournamentRow = { ...sng, id: "wta", players: 2, payoutStructure: "winner-takes-all", itmRate: 0.5, roi: 1 };
    const c = pd(hu);
    expect(c.calibrationWarnings).toHaveLength(1);
    expect(c.calibrationWarnings?.[0]).toMatchObject({ rowId: "wta", kind: "primedope-free-itm-unreachable", targetWinnings: 22 });
    const e = c.flat[0];
    expect(e.analyticMeanSingle).toBeLessThan(18);
    expect(c.expectedProfit).toBeCloseTo(200 * (e.analyticMeanSingle - 11), 9);
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

describe("the engine never pays more KO EV than the bounty pool holds", () => {
  const pmfOf = (entry: CompiledEntry): Float64Array => {
    const n = entry.aliasProb.length;
    const pmf = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      pmf[i] += entry.aliasProb[i] / n;
      pmf[entry.aliasIdx[i]] += (1 - entry.aliasProb[i]) / n;
    }
    return pmf;
  };
  /** The KO EV an entry plays and N x buyIn x share x (1 - P(last)) of the pmf it plays. */
  const koAndCeiling = (entry: CompiledEntry, r: TournamentRow) => {
    const pmf = pmfOf(entry);
    let cash = 0;
    for (let i = 0; i < pmf.length; i++) cash += pmf[i] * entry.prizeByPlace[i];
    const share = Math.max(0, Math.min(0.9, r.bountyFraction ?? 0));
    return {
      ko: entry.analyticMeanSingle - cash,
      ceiling: entry.fieldSize * r.buyIn * share * (1 - pmf[entry.fieldSize - 1]),
    };
  };
  const reported: TournamentRow = {
    id: "r", label: "r", players: 3, buyIn: 100, rake: 0.1, roi: 0.2, gameType: "pko",
    payoutStructure: "sng-65-35", bountyFraction: 0.3, bountyEvBias: -0.25, itmRate: 0.66, count: 1,
  };

  it("pays the reported 3-player PKO row the 59.40 its pool holds, not the 62.70 its bias asks for", () => {
    // The bias asks for 39.60 + 0.25 x (132 - 39.60) = 62.70 of KO EV; the pool
    // is 3 x $30 and a last place collects nothing, 90 x 0.66 = 59.40.
    const entry = compileOne(reported);
    const { ko, ceiling } = koAndCeiling(entry, reported);
    expect(ceiling).toBeCloseTo(59.4, 9);
    expect(ko).toBeCloseTo(59.4, 9);
    expect(entry.analyticMeanSingle).toBeCloseTo(132, 9);
    expect(entry.calibrationWarning).toBeUndefined();
  });

  it("caps a residual the pool misses by less than the on-target tolerance", () => {
    // Heads-up winner-takes-all at a typed ITM 0.5, ROI -9.05 %: the cash side
    // pays $50 and leaves $50.045 of the $100.045 target to KOs, 0.09 % past
    // the $50 a winner collects. The row plays $100.00, inside the tolerance.
    const hu: TournamentRow = {
      id: "hu", label: "hu", players: 2, buyIn: 100, rake: 0.1, roi: -0.0905, gameType: "pko",
      payoutStructure: "winner-takes-all", bountyFraction: 0.5, itmRate: 0.5, count: 1,
    };
    const entry = compileOne(hu);
    const { ko, ceiling } = koAndCeiling(entry, hu);
    expect(ceiling).toBeCloseTo(50, 9);
    expect(ko).toBeLessThanOrEqual(ceiling * (1 + 1e-9));
    expect(entry.analyticMeanSingle).toBeCloseTo(100, 9);
    expect(entry.calibrationWarning).toBeUndefined();
    expect(validateSchedule([hu], model).ok).toBe(true);
  });

  it("settles a free-ITM heads-up row on the KO EV its own pmf can pay, whatever the bias past it", () => {
    const hu = (bias: number): TournamentRow => ({
      id: "hu", label: "hu", players: 2, buyIn: 100, rake: 0.1, roi: -0.3, gameType: "pko",
      payoutStructure: "mtt-gg-bounty", bountyFraction: 0.2, bountyEvBias: bias, count: 1,
    });
    const settled = [-0.25, -0.1].map((bias) => {
      const entry = compileOne(hu(bias));
      return { entry, ...koAndCeiling(entry, hu(bias)) };
    });
    for (const { entry, ko, ceiling } of settled) {
      expect(ko).toBeLessThanOrEqual(ceiling * (1 + 1e-9));
      expect(ko / ceiling).toBeGreaterThan(1 - 3e-9);
      expect(entry.analyticMeanSingle).toBeCloseTo(77, 6);
    }
    expect(settled[0].ko).toBeCloseTo(settled[1].ko, 6);
  });

  it("holds on every bounty format, small field, ITM branch, bias, pass and sit-through", () => {
    const formats: TournamentRow[] = [
      { ...reported, itmRate: undefined, bountyEvBias: undefined },
      { ...reported, payoutStructure: "mtt-gg-bounty", itmRate: undefined, bountyEvBias: undefined },
      { ...reported, gameType: "mystery", payoutStructure: "mtt-gg-mystery", mysteryBountyVariance: 2,
        itmRate: undefined, bountyEvBias: undefined },
    ];
    const ocean = { ...reported, itmRate: undefined, bountyEvBias: undefined };
    formats.push({ ...ocean, ...applyGameType(ocean, "ocean-ko") } as TournamentRow);
    const br = { ...reported, ...applyGameType(reported, "mystery-royale") } as TournamentRow;
    let entries = 0;
    let atCeiling = 0;
    const check = (r: TournamentRow, mode: "alpha" | "primedope-binary-itm", pdFinish: boolean) => {
      const compiled = compileSchedule(
        input(r, { samples: 1, usePrimedopeFinishModel: pdFinish }),
        mode,
      );
      for (const entry of compiled.flat[0].variants ?? [compiled.flat[0]]) {
        const { ko, ceiling } = koAndCeiling(entry, r);
        entries++;
        if (ko > ceiling * (1 - 1e-6)) atCeiling++;
        expect(ko).toBeLessThanOrEqual(ceiling * (1 + 1e-9));
      }
    };
    for (const roi of [-0.3, 0.3, 1]) for (const bias of [-0.25, 0.25]) for (const free of [true, false]) {
      const rows: TournamentRow[] = [{ ...br, players: 2 }, { ...br, lateRegMultiplier: 1.5 }];
      for (const f of formats) for (const players of [2, 3, 6]) rows.push({ ...f, players });
      rows.push({ ...formats[1], players: 6, fieldVariability: { kind: "uniform", min: 2, max: 10, buckets: 3 } });
      for (const raw of rows) {
        const live = applyItmTarget([{ ...raw, roi, bountyEvBias: bias }], { enabled: false, pct: 18.7 }, model)[0];
        const r = free ? { ...live, itmRate: undefined } : live;
        check(r, "alpha", true);
        check({ ...r, sitThroughPayJumps: true, payJumpAggression: 1 }, "alpha", true);
        check(r, "primedope-binary-itm", true);
        check(r, "primedope-binary-itm", false);
      }
    }
    // Over a quarter of the entries settle on the ceiling, so the sweep
    // exercises the cap and not only rows far inside it.
    expect(entries).toBe(816);
    expect(atCeiling).toBeGreaterThan(entries / 4);
  });

  it("reads the PrimeDope pass's ceiling on its own pmf, since that pass plays no sit-through", () => {
    // 30 players, ITM 0.5, a 2 % bounty share at ROI +200 %: the KO-heavy bias
    // asks for more than the $60 pool, and sit-through would move mass onto
    // last place (58.41 on PrimeDope's binary ITM instead of 58.64).
    const r: TournamentRow = {
      id: "r", label: "r", players: 30, buyIn: 100, rake: 0.1, roi: 2, gameType: "pko",
      payoutStructure: "mtt-standard", bountyFraction: 0.02, bountyEvBias: -0.25, itmRate: 0.5,
      sitThroughPayJumps: true, payJumpAggression: 1, count: 1,
    };
    for (const pdFinish of [true, false]) {
      const entry = compileSchedule(
        input(r, { samples: 1, usePrimedopeFinishModel: pdFinish }),
        "primedope-binary-itm",
      ).flat[0];
      const { ko, ceiling } = koAndCeiling(entry, r);
      expect(Math.abs(ko / ceiling - 1)).toBeLessThan(1e-9);
      const sitThrough = pmfOf(entry);
      applySitThroughPayJumps(sitThrough, entry.prizeByPlace, entry.paidCount, 1);
      expect(ko).toBeGreaterThan(30 * 100 * 0.02 * (1 - sitThrough[29]) + 0.1);
      expect(entry.calibrationWarning).toBeUndefined();
    }
  });

  it("flags a fixed-shape row the pool leaves short of its ROI, in every pass", () => {
    // Uniform at ITM 0.66 pays $69.51 of cash; the pool holds $59.40 for one
    // entry, so ROI +100 % ($220) is out of reach. The KO EV used to close the
    // whole $150.49 gap, and a model that does not aim at the ROI raised nothing.
    const uniform: FinishModelConfig = { id: "uniform" };
    const at = (roi: number) => ({ ...reported, roi });
    const compiled = compileSchedule(input(at(1), { samples: 1, finishModel: uniform }));
    const entry = compiled.flat[0];
    expect(koAndCeiling(entry, at(1)).ko).toBeCloseTo(59.4, 9);
    expect(compiled.calibrationWarnings).toHaveLength(1);
    const warning = compiled.calibrationWarnings![0];
    expect(warning.kind).toBe("target-unreachable");
    expect(warning.targetWinnings).toBeCloseTo(220, 9);
    expect(warning.actualWinnings).toBe(entry.analyticMeanSingle);
    expect(entry.analyticMeanSingle).toBeCloseTo(128.91, 9);
    expect(compiled.expectedProfit).toBeCloseTo(18.91, 9);
    // PrimeDope's pass with our finish model frees the ITM and still falls short.
    const pdOff = compileSchedule(
      input(at(1), { samples: 1, finishModel: uniform, usePrimedopeFinishModel: false }),
      "primedope-binary-itm",
    );
    expect(pdOff.calibrationWarnings?.[0].kind).toBe("primedope-free-itm-unreachable");
    expect(pdOff.calibrationWarnings?.[0].actualWinnings).toBeCloseTo(199.44, 9);
    // Inside the pool nothing is raised.
    expect(compileSchedule(input(at(0.1), { samples: 1, finishModel: uniform })).calibrationWarnings)
      .toBeUndefined();
  });
});

describe("a bounty row's KO EV never falls below what its finishing places guarantee", () => {
  const split = (entry: CompiledEntry) => {
    const n = entry.aliasProb.length;
    const pmf = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      pmf[i] += entry.aliasProb[i] / n;
      pmf[entry.aliasIdx[i]] += (1 - entry.aliasProb[i]) / n;
    }
    let cash = 0;
    for (let i = 0; i < n; i++) cash += pmf[i] * entry.prizeByPlace[i];
    return { cash, ko: entry.analyticMeanSingle - cash, first: pmf[0] };
  };
  const formatRow = (gameType: "pko" | "mystery" | "mystery-royale" | "ocean-ko", over: Partial<TournamentRow>) => {
    const base: TournamentRow = { id: "r", label: "r", players: 30, buyIn: 10, rake: 0.1, roi: 0, payoutStructure: "mtt-standard", count: 1 };
    return { ...base, ...applyGameType(base, gameType), ...over } as TournamentRow;
  };
  const agrees = (r: TournamentRow, m: FinishModelConfig, entry: CompiledEntry) => {
    const stats = computeRowStats(r, m, { skipCompiledSigma: true });
    const { cash, ko } = split(entry);
    expect(Math.abs(stats.bountyEvPerEntry - ko)).toBeLessThan(1e-9 * Math.max(1, ko));
    expect(Math.abs(stats.cashEvPerEntry - cash)).toBeLessThan(1e-9 * Math.max(1, cash));
  };

  it("pays the winner of a Battle Royale row at the KO slider's cash end one envelope", () => {
    // ITM 18 %, ROI -17.2 %, the slider at +25 %: a cash side left free to rise
    // to the total puts all of the ITM on first place and pays the winner 0.50
    // of an envelope. A $10 ticket draws GG's $10 table, $9.45 an envelope.
    const r = formatRow("mystery-royale", { roi: -0.172, bountyEvBias: 0.25 });
    expect(r.itmRate).toBe(0.18);
    const entry = compileOne(r);
    const { ko, first } = split(entry);
    expect(entry.bountyKmean![0]).toBeCloseTo(1, 12);
    expect(entry.bountyByPlace![0]).toBeCloseTo(9.45, 9);
    expect(ko).toBeCloseTo(1.8851574722, 9);
    expect(first * 18).toBeCloseTo(1.97823, 5);
    expect(entry.analyticMeanSingle).toBeCloseTo(8.28, 9);
    expect(validateSchedule([r], model).ok).toBe(true);
    agrees(r, model, entry);
  });

  it("lets the cash side give way on Mystery 30 at ITM 25 %, tilt +1, ROI -17.2 %", () => {
    // Free to rise to the total, the first-place floor lifts the cash side to
    // $8.87 of the $9.108 and leaves $0.24 of KO EV, a winner's share of 0.18 of
    // the one envelope the last knockout drops ($150 over the 2 busts of a
    // 3-place window). The cash side gives way until the winner collects it.
    const r = formatRow("mystery", { bountyFraction: 0.5, itmRate: 0.25, itmTopHeavyBias: 1, roi: -0.172, bountyEvBias: 0.25 });
    const entry = compileOne(r);
    const { ko, first } = split(entry);
    expect(entry.paidCount).toBe(3);
    expect(entry.bountyByPlace![0]).toBeCloseTo(75, 6);
    expect(ko).toBeCloseTo(0.5840721576, 9);
    expect(first).toBeCloseTo(0.0073216, 7);
    expect(entry.analyticMeanSingle).toBeCloseTo(9.108, 9);
    expect(validateSchedule([r], model).ok).toBe(true);
    agrees(r, model, entry);
  });

  it("keeps a PKO winner's own starting head and the runner-up's", () => {
    // PKO 30, half of $10 bounty, ITM 25 %, ROI -10 %, slider at +25 %: free to
    // rise to the total, the cash side takes $9.71 of the $9.90 and pays the
    // winner $1.74 of KOs, $0.94 of it as the own head. A winner keeps the own
    // $5 head and takes the runner-up's, never under $5.
    const r = formatRow("pko", { bountyFraction: 0.5, itmRate: 0.25, roi: -0.1, bountyEvBias: 0.25 });
    const entry = compileOne(r);
    const winner = entry.bountyByPlace![0];
    expect(winner).toBeGreaterThanOrEqual(10 * (1 - 1e-9));
    expect(winner * entry.pkoRawInv![0] * entry.pkoWinnerHead).toBeGreaterThanOrEqual(5);
    expect(split(entry).ko).toBeCloseTo(0.9412525284, 9);
    expect(entry.analyticMeanSingle).toBeCloseTo(9.9, 9);
    expect(validateSchedule([r], model).ok).toBe(true);
    agrees(r, model, entry);
  });

  it("pays a heads-up PKO winner two heads where the plan passes the pool's ceiling", () => {
    // $35 heads, ITM 40 %, sit-through at 0.5: the plan asks for more KO EV than
    // the pool holds. At ROI -20 % the ceiling's fixed point asks $26.19 of KOs,
    // and the first-place floor lifts the cash side to $14.06 against the $13.81
    // that leaves, so the residual sits 0.9 % under the ceiling, which heads-up
    // is also the floor. Held to the floor, the winner takes the own head and
    // the runner-up's.
    const r: TournamentRow = {
      id: "r", label: "r", players: 2, buyIn: 50, rake: 0, roi: 0, payoutStructure: "sng-50-30-20", gameType: "pko",
      bountyFraction: 0.7, itmRate: 0.4, itmTopHeavyBias: 1, bountyEvBias: 0, sitThroughPayJumps: true,
      payJumpAggression: 0.5, count: 1,
    };
    for (const [roi, ko] of [[-0.2, 25.9677419355], [-0.1, 30.4838709677]] as const) {
      const at = { ...r, roi };
      const compiled = compileSchedule(input(at, { samples: 1 }));
      const entry = compiled.flat[0];
      expect(entry.bountyByPlace![0]).toBeGreaterThanOrEqual(70 * (1 - 1e-9));
      expect(entry.bountyByPlace![0]).toBeCloseTo(70, 6);
      expect(split(entry).ko).toBeCloseTo(ko, 9);
      expect(compiled.calibrationWarnings).toBeUndefined();
      expect(validateSchedule([at], model).ok).toBe(true);
      agrees(at, model, entry);
    }
  });

  it("blocks the reported Battle Royale row in every layer: no split pays its ROI", () => {
    // 21 entrants (18 x 1.17), ITM 54 %, ROI -5 %: the first-place floor paid the
    // whole $9.50 in cash at P(1st) 0.038 and no KO EV. Even with all of its ITM
    // on the last paid place the row cashes $8.56, and its places still
    // guarantee $1.91 of KOs (a winner opens one envelope of the $9.45 table
    // the engine draws), so it plays $10.47.
    const realdata: FinishModelConfig = { id: "powerlaw-realdata-influenced" };
    const r = formatRow("mystery-royale", { players: 18, lateRegMultiplier: 1.17, itmRate: 0.54, roi: -0.05 });
    const compiled = compileSchedule(input(r, { samples: 1, finishModel: realdata }));
    const entry = compiled.flat[0];
    expect(entry.fieldSize).toBe(21);
    expect(entry.bountyByPlace![0]).toBeCloseTo(9.45, 9);
    expect(entry.bountyKmean![0]).toBeCloseTo(1, 12);
    expect(split(entry).cash).toBeCloseTo(8.5604945283, 9);
    expect(split(entry).ko).toBeCloseTo(1.9127925672, 9);
    expect(entry.analyticMeanSingle).toBeCloseTo(10.4732870955, 9);
    expect(compiled.calibrationWarnings?.[0]).toMatchObject({ kind: "target-unreachable", actualWinnings: entry.analyticMeanSingle });
    const gate = validateSchedule([r], realdata);
    expect(gate.ok).toBe(false);
    expect(gate.issues[0].currentEv).toBeCloseTo(entry.analyticMeanSingle, 12);
    agrees(r, realdata, entry);
  });

  it("flags a fixed shape whose KO EV cannot come down to what its cash side leaves, in every layer", () => {
    // Each shape fixes its cash side, and its finishing places the least KO EV
    // it can play. Uniform Mystery 27 at ITM 54 % cashes $9.72 and wins 18 % of
    // the time, so it collects at least $25.92 of KOs where the $14.30 of ROI
    // +30 % leaves $4.58; uniform PKO 18 at ITM 90 % cashes $23.76 and its places
    // guarantee $15.32 where ROI 0 leaves $0.44. The 3-player PKO's uniform cash
    // side ($69.30) overpays the $55 of ROI -50 % alone, and the Battle Royale
    // cash solver on uniform at ITM 30 % pays $6 against the $5 of ROI -50 %.
    // Closing the target would put the first two under their floors and the
    // last two at a KO EV of 0.
    const uniform: FinishModelConfig = { id: "uniform" };
    const rows: [TournamentRow, number][] = [
      [formatRow("mystery", { players: 27, payoutStructure: "mtt-gg-mystery", bountyFraction: 0.8, itmRate: 0.54, roi: 0.3, bountyEvBias: 0.1 }), 35.64],
      [formatRow("pko", { players: 18, buyIn: 22, bountyFraction: 0.8, itmRate: 0.9, roi: 0, bountyEvBias: 0.25 }), 39.0780145335],
      [{
        id: "r", label: "r", players: 3, buyIn: 100, rake: 0.1, roi: -0.5, gameType: "pko",
        payoutStructure: "sng-65-35", bountyFraction: 0.3, bountyEvBias: -0.25, itmRate: 0.66, count: 1,
      }, 90.9],
      [formatRow("mystery-royale", { itmRate: 0.3, roi: -0.5 }), 7.6510801577],
    ];
    for (const [r, plays] of rows) {
      const compiled = compileSchedule(input(r, { samples: 1, finishModel: uniform }));
      const entry = compiled.flat[0];
      expect(entry.analyticMeanSingle).toBeCloseTo(plays, 9);
      expect(compiled.calibrationWarnings?.[0]).toMatchObject({ kind: "target-unreachable", actualWinnings: entry.analyticMeanSingle });
      const gate = validateSchedule([r], uniform);
      expect(gate.ok).toBe(false);
      expect(gate.issues[0].currentEv).toBeCloseTo(entry.analyticMeanSingle, 9);
      agrees(r, uniform, entry);
      // A ROI the KO EV can close runs on the same shape.
      const reachable = { ...r, roi: plays / entry.singleCost - 1 + 0.01 };
      expect(compileSchedule(input(reachable, { samples: 1, finishModel: uniform })).calibrationWarnings).toBeUndefined();
      expect(validateSchedule([reachable], uniform).ok).toBe(true);
    }
  });

  it("guarantees a Battle Royale winner one envelope of the table the engine draws, whatever the ticket", () => {
    // A typed $6 ticket draws GG's $10 table ($9.45 an envelope); at the
    // slider's cash end a cash side free to rise to the total leaves its winner
    // 0.30 of one. A $5 ticket draws the $3 table ($2.835), so a row whose
    // winner already opens 1.24 envelopes keeps its bytes and runs.
    const realdata: FinishModelConfig = { id: "powerlaw-realdata-influenced" };
    for (const ticket of [5, 6, 50]) {
      const r = formatRow("mystery-royale", { ...battleRoyaleRowFromTotalTicket(ticket), roi: -0.172, bountyEvBias: 0.25 });
      const compiled = compileSchedule(input(r, { samples: 1, finishModel: realdata }));
      const entry = compiled.flat[0];
      expect(entry.bountyKmean![0]).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(entry.bountyByPlace![0] / entry.bountyKmean![0]).toBeCloseTo(makeBrTierSampler(r.buyIn).meanValue, 9);
      expect(compiled.calibrationWarnings).toBeUndefined();
      expect(validateSchedule([r], realdata).ok).toBe(true);
      agrees(r, realdata, entry);
    }
    const six = compileSchedule(input(
      formatRow("mystery-royale", { ...battleRoyaleRowFromTotalTicket(6), roi: -0.172, bountyEvBias: 0.25 }),
      { samples: 1, finishModel: realdata },
    )).flat[0];
    expect(six.bountyKmean![0]).toBeCloseTo(1, 12);
    expect(split(six).ko).toBeCloseTo(1.6567110938, 9);
    const five = formatRow("mystery-royale", { ...battleRoyaleRowFromTotalTicket(5), itmRate: 0.4, roi: -0.05, bountyEvBias: -0.25 });
    const fiveEntry = compileOne({ ...five, count: 1 });
    expect(split(fiveEntry).ko).toBeCloseTo(0.75, 9);
    expect(fiveEntry.bountyKmean![0]).toBeCloseTo(1.2375384, 6);
    expect(validateSchedule([five], model).ok).toBe(true);
  });

  it("agrees in every layer and pays every winner what winning guarantees on small bounty fields", () => {
    // On the played pmf, after sit-through, and on models that aim at the ROI
    // and fixed shapes alike: engine, preview and validation agree on the KO EV
    // and on the verdict, and no winner is paid less than winning takes.
    const off = { enabled: false, pct: 18.7 };
    const models: FinishModelConfig[] = [
      { id: "powerlaw-realdata-influenced" }, { id: "uniform" }, { id: "pko-realdata-tilt" },
    ];
    let entries = 0;
    let atFloor = 0;
    let blocked = 0;
    for (const m of models) for (const sitThrough of [false, true])
      for (const gameType of ["pko", "mystery", "ocean-ko", "mystery-royale"] as const) {
        const fields = gameType === "mystery-royale" ? [18] : [2, 3, 6, 9, 30];
        for (const players of fields) for (const itm of [undefined, 0.25, 0.54]) for (const bias of [-0.25, 0.25])
          for (const roi of [-0.3, 0, 0.3]) for (const lateReg of [1, 1.17]) {
            const raw = formatRow(gameType, {
              players, roi, bountyEvBias: bias, lateRegMultiplier: lateReg, itmRate: undefined,
              ...(sitThrough ? { sitThroughPayJumps: true, payJumpAggression: 1 } : {}),
            });
            const r = applyItmTarget([itm === undefined ? raw : { ...raw, itmRate: itm }], off, m)[0];
            const compiled = compileSchedule(input(r, { samples: 1, finishModel: m }));
            const entry = compiled.flat[0];
            const ok = validateSchedule([r], m).ok;
            expect(ok).toBe(compiled.calibrationWarnings === undefined);
            if (!ok) blocked++;
            agrees(r, m, entry);
            const N = entry.fieldSize;
            const pool = N * r.buyIn * (r.bountyFraction ?? 0);
            const window = gameType === "mystery-royale" ? Math.min(9, N) : entry.paidCount;
            const take = gameType === "pko" || gameType === "ocean-ko"
              ? 2 * r.buyIn * (r.bountyFraction ?? 0)
              : gameType === "mystery-royale"
                ? Math.min(makeBrTierSampler(r.buyIn).meanValue, pool)
                : window < 2 ? pool : pool / (window - 1);
            entries++;
            if (Math.abs(entry.bountyByPlace![0] / take - 1) < 1e-6) atFloor++;
            expect(entry.bountyByPlace![0]).toBeGreaterThanOrEqual(take * (1 - 1e-9));
          }
      }
    // 1 344 of the 3 456 entries sit on the floor and 1 356 are blocked, so the
    // sweep exercises the floor and both verdicts, not only rows far above it.
    expect(entries).toBe(3456);
    expect(atFloor).toBeGreaterThan(entries / 3);
    expect(blocked).toBeGreaterThan(entries / 10);
  });
});
