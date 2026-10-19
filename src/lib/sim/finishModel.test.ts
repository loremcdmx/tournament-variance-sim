import { describe, it, expect } from "vitest";
import {
  buildFinishPMF,
  expectedWinnings,
  calibrateAlpha,
  calibrateShelledItm,
  buildCDF,
  sampleFromCDF,
  buildBinaryItmAssets,
  itmProbability,
  isAlphaAdjustable,
  applyBountyBias,
  manualAlphaFor,
  supportsManualAlpha,
  cashTargetFloor,
  targetEvTolerance,
  withinTargetEv,
} from "./finishModel";
import { getPayoutTable } from "./payouts";
import { battleRoyaleRowFromTotalTicket } from "./battleRoyaleTicket";
import { compileSchedule, runSimulation } from "./engine";
import type { FinishModelConfig, SimulationInput, TournamentRow } from "./types";

const MODELS: FinishModelConfig[] = [
  { id: "power-law" },
  { id: "linear-skill" },
  { id: "stretched-exp", beta: 1 },
  { id: "plackett-luce" },
  { id: "uniform" },
];

describe("buildFinishPMF", () => {
  it.each(MODELS)("sums to ~1 for model %s", (model) => {
    const pmf = buildFinishPMF(500, model, 1.5);
    let s = 0;
    for (const v of pmf) s += v;
    expect(s).toBeCloseTo(1, 8);
  });

  it("power-law with alpha=0 is uniform", () => {
    const pmf = buildFinishPMF(100, { id: "power-law" }, 0);
    for (const v of pmf) expect(v).toBeCloseTo(0.01, 10);
  });

  it("power-law is monotonic descending in place for alpha>0", () => {
    const pmf = buildFinishPMF(50, { id: "power-law" }, 2);
    for (let i = 1; i < pmf.length; i++) {
      expect(pmf[i]).toBeLessThanOrEqual(pmf[i - 1]);
    }
  });

  it("plackett-luce with alpha=0 (s=1) is uniform", () => {
    const pmf = buildFinishPMF(100, { id: "plackett-luce" }, 0);
    for (const v of pmf) expect(v).toBeCloseTo(0.01, 10);
  });

  it("plackett-luce is monotonic descending for alpha>0 (skill>1)", () => {
    const pmf = buildFinishPMF(50, { id: "plackett-luce" }, 1.5);
    for (let i = 1; i < pmf.length; i++) {
      expect(pmf[i]).toBeLessThanOrEqual(pmf[i - 1]);
    }
    // Top place gets more mass than uniform baseline
    expect(pmf[0]).toBeGreaterThan(1 / 50);
  });
});

describe("expectedWinnings × calibrateAlpha", () => {
  it("calibrated alpha yields the target ROI within tolerance", () => {
    const N = 500;
    const cost = 11;
    const pool = N * 10;
    const payouts = getPayoutTable("mtt-standard", N);
    // linear-skill has a bounded maximum EW (slope ∈ [−1, 1]), so ROI is
    // capped below ~0.7 on typical MTT payouts. We only test it on the
    // reachable range.
    const cases: { targetROI: number; models: string[] }[] = [
      { targetROI: -0.3, models: ["power-law", "stretched-exp", "plackett-luce"] },
      { targetROI: -0.1, models: ["power-law", "linear-skill", "stretched-exp", "plackett-luce"] },
      { targetROI: 0, models: ["power-law", "linear-skill", "stretched-exp", "plackett-luce"] },
      { targetROI: 0.1, models: ["power-law", "linear-skill", "stretched-exp", "plackett-luce"] },
      { targetROI: 0.5, models: ["power-law", "stretched-exp", "plackett-luce"] },
      { targetROI: 1.0, models: ["power-law", "stretched-exp", "plackett-luce"] },
    ];
    for (const c of cases) {
      for (const m of MODELS) {
        if (!c.models.includes(m.id)) continue;
        const alpha = calibrateAlpha(N, payouts, pool, cost, c.targetROI, m);
        const pmf = buildFinishPMF(N, m, alpha);
        const ew = expectedWinnings(pmf, payouts, pool);
        const realizedROI = ew / cost - 1;
        expect(Math.abs(realizedROI - c.targetROI)).toBeLessThan(0.01);
      }
    }
  });

  it("uniform model ignores ROI entirely", () => {
    const N = 200;
    const pool = N * 10;
    const payouts = getPayoutTable("mtt-standard", N);
    const alpha = calibrateAlpha(N, payouts, pool, 11, 2.0, { id: "uniform" });
    const pmf = buildFinishPMF(N, { id: "uniform" }, alpha);
    // Uniform EW = pool / N
    const ew = expectedWinnings(pmf, payouts, pool);
    expect(ew).toBeCloseTo(pool / N, 6);
  });

  it("uniform calibration short-circuits to alpha=0 regardless of ROI sign/size", () => {
    const N = 300;
    const pool = N * 20;
    const payouts = getPayoutTable("mtt-standard", N);
    for (const roi of [-0.5, -0.1, 0, 0.1, 0.5, 2.0]) {
      const alpha = calibrateAlpha(N, payouts, pool, 22, roi, { id: "uniform" });
      expect(alpha).toBe(0);
    }
  });
});

describe("supportsManualAlpha / manualAlphaFor", () => {
  const TILT = ["freeze-realdata-tilt", "pko-realdata-tilt", "mystery-realdata-tilt"] as const;
  const OTHERS = [
    "power-law", "linear-skill", "stretched-exp", "plackett-luce", "uniform", "empirical",
    "powerlaw-realdata-influenced", "freeze-realdata-step", "freeze-realdata-linear",
    "pko-realdata-step", "pko-realdata-linear", "mystery-realdata-step", "mystery-realdata-linear",
  ] as const;

  it("is true for exactly the three real-data tilt models", () => {
    for (const id of TILT) expect(supportsManualAlpha(id)).toBe(true);
    for (const id of OTHERS) expect(supportsManualAlpha(id)).toBe(false);
  });

  it("sends the typed alpha only where it is read", () => {
    for (const id of TILT) {
      expect(manualAlphaFor(id, 0.2)).toBe(0.2);
      expect(manualAlphaFor(id, 0)).toBe(0);
      expect(manualAlphaFor(id, null)).toBeUndefined();
    }
    for (const id of OTHERS) expect(manualAlphaFor(id, 3)).toBeUndefined();
    expect(manualAlphaFor("pko-realdata-tilt", Number.NaN)).toBeUndefined();
  });

  it("agrees with the engine: a tilt model moves with alpha, the others do not", () => {
    const mean = (id: FinishModelConfig["id"], alpha: number | undefined) => {
      const payouts = getPayoutTable("mtt-standard", 500);
      const paid = payouts.filter((p) => p > 0).length;
      return calibrateShelledItm(
        500, paid, payouts, 5000, 11 * 1.1, 0.15, undefined, { id, alpha },
      ).currentWinnings;
    };
    expect(mean("pko-realdata-tilt", 0.3)).not.toBeCloseTo(mean("pko-realdata-tilt", undefined), 3);
    expect(mean("power-law", 3)).toBe(mean("power-law", undefined));
    expect(mean("stretched-exp", 3)).toBe(mean("stretched-exp", undefined));
  });
});

describe("isAlphaAdjustable", () => {
  it("returns true for α-driven skill models", () => {
    expect(isAlphaAdjustable({ id: "power-law" })).toBe(true);
    expect(isAlphaAdjustable({ id: "linear-skill" })).toBe(true);
    expect(isAlphaAdjustable({ id: "stretched-exp", beta: 1 })).toBe(true);
    expect(isAlphaAdjustable({ id: "plackett-luce" })).toBe(true);
    expect(isAlphaAdjustable({ id: "powerlaw-realdata-influenced" })).toBe(true);
  });

  it("returns false for fixed-shape neutral models", () => {
    expect(isAlphaAdjustable({ id: "uniform" })).toBe(false);
    expect(isAlphaAdjustable({ id: "empirical" })).toBe(false);
  });

  it("returns false for every realdata-* reference shape", () => {
    const ids = [
      "freeze-realdata-step",
      "freeze-realdata-linear",
      "freeze-realdata-tilt",
      "pko-realdata-step",
      "pko-realdata-linear",
      "pko-realdata-tilt",
      "mystery-realdata-step",
      "mystery-realdata-linear",
      "mystery-realdata-tilt",
    ] as const;
    for (const id of ids) {
      expect(isAlphaAdjustable({ id })).toBe(false);
    }
  });

  it("returns false when the caller pins α explicitly", () => {
    expect(isAlphaAdjustable({ id: "power-law", alpha: 1.2 })).toBe(false);
    expect(isAlphaAdjustable({ id: "plackett-luce", alpha: 0 })).toBe(false);
  });

  it("agrees with calibrateAlpha: adjustable ⇒ α responds to ROI", () => {
    // Spot-check that the two predicates stay in sync: when the model is
    // α-adjustable, changing the ROI target changes the α `calibrateAlpha`
    // returns; when it isn't, α is pinned at 0 regardless of target.
    const N = 200;
    const pool = N * 10;
    const payouts = getPayoutTable("mtt-standard", N);
    const adjustable = calibrateAlpha(N, payouts, pool, 11, 0.5, {
      id: "power-law",
    });
    const adjustableBase = calibrateAlpha(N, payouts, pool, 11, 0.0, {
      id: "power-law",
    });
    expect(adjustable).not.toBeCloseTo(adjustableBase, 2);
    const fixed = calibrateAlpha(N, payouts, pool, 11, 0.5, { id: "uniform" });
    expect(fixed).toBe(0);
  });
});

describe("applyBountyBias", () => {
  it("bias=0 returns the anchor unchanged", () => {
    expect(applyBountyBias(5, 10, 0)).toBe(5);
    expect(applyBountyBias(0, 10, 0)).toBe(0);
  });

  it("positive bias shrinks bounty proportionally", () => {
    expect(applyBountyBias(8, 12, 0.25)).toBeCloseTo(8 * 0.75, 12);
    expect(applyBountyBias(8, 12, 0.1)).toBeCloseTo(8 * 0.9, 12);
  });

  it("negative bias grows bounty toward the total ceiling", () => {
    // anchor=4, total=10, bias=-0.25 → 4 + 0.25 × (10 − 4) = 5.5
    expect(applyBountyBias(4, 10, -0.25)).toBeCloseTo(5.5, 12);
  });

  it("negative bias with anchor already above total leaves anchor untouched", () => {
    // max(0, 10 − 12) = 0, so the bonus term vanishes.
    expect(applyBountyBias(12, 10, -0.25)).toBe(12);
  });

  it("result stays non-negative for anchor=0", () => {
    expect(applyBountyBias(0, 10, 0.25)).toBe(0);
    // anchor=0, total=10, bias=-0.25 → 0 + 0.25 × 10 = 2.5
    expect(applyBountyBias(0, 10, -0.25)).toBeCloseTo(2.5, 12);
  });
});

describe("buildBinaryItmAssets (PrimeDope two-bin uniform)", () => {
  const payouts500 = getPayoutTable("mtt-standard", 500);
  const paid500 = payouts500.reduce((n, p) => (p > 0 ? n + 1 : n), 0);
  const pool500 = 500 * 50;

  it("pmf has two uniform bins summing to 1", () => {
    const { pmf } = buildBinaryItmAssets(500, paid500, payouts500, pool500, 55);
    let sum = 0;
    for (let i = 0; i < 500; i++) sum += pmf[i];
    expect(sum).toBeCloseTo(1, 10);
    // All paid slots equal; all unpaid slots equal.
    for (let i = 1; i < paid500; i++) expect(pmf[i]).toBeCloseTo(pmf[0], 12);
    for (let i = paid500 + 1; i < 500; i++)
      expect(pmf[i]).toBeCloseTo(pmf[paid500], 12);
  });

  it("uses the real top-heavy payout curve on paid places", () => {
    const { prizeByPlace } = buildBinaryItmAssets(
      500,
      paid500,
      payouts500,
      pool500,
      55,
    );
    // 1st >> 2nd >> median paid place >> unpaid zeros.
    expect(prizeByPlace[0]).toBeGreaterThan(prizeByPlace[1]);
    expect(prizeByPlace[1]).toBeGreaterThan(prizeByPlace[Math.floor(paid500 / 2)]);
    expect(prizeByPlace[paid500]).toBe(0);
    expect(prizeByPlace[499]).toBe(0);
  });

  it("realized expected winnings match targetWinnings exactly", () => {
    for (const target of [5, 25, 50, 55, 100]) {
      const { pmf, prizeByPlace } = buildBinaryItmAssets(
        500,
        paid500,
        payouts500,
        pool500,
        target,
      );
      let ew = 0;
      for (let i = 0; i < 500; i++) ew += pmf[i] * prizeByPlace[i];
      expect(ew).toBeCloseTo(target, 4);
    }
  });

  it("ITM probability lifts above raw paid/N when target exceeds break-even", () => {
    // Break-even target = pool/N (mean winnings at l = paid/N).
    const breakEven = pool500 / 500;
    const { pmf: itmLift } = buildBinaryItmAssets(
      500,
      paid500,
      payouts500,
      pool500,
      breakEven * 1.2,
    );
    expect(itmProbability(itmLift, paid500)).toBeGreaterThan(paid500 / 500);
  });
});

describe("itmProbability", () => {
  it("matches analytical pmf sum on paid places", () => {
    const pmf = buildFinishPMF(400, { id: "power-law" }, 1.5);
    const itm60 = itmProbability(pmf, 60);
    let expected = 0;
    for (let i = 0; i < 60; i++) expected += pmf[i];
    expect(itm60).toBeCloseTo(expected, 10);
  });
});

describe("calibrateShelledItm", () => {
  const paid = 15;
  const N = 100;
  const curve = getPayoutTable("mtt-standard", N).slice(0, paid);
  const pool = 900;
  const itm = 0.16;

  it("with no locks hits target EW exactly and preserves ITM", () => {
    const target = 16.5; // +50% ROI on $11 cost
    const r = calibrateShelledItm(
      N, paid, curve, pool, target, itm, undefined, { id: "power-law" },
    );
    let s = 0;
    for (let i = 0; i < paid; i++) s += r.pmf[i];
    expect(s).toBeCloseTo(itm, 6);
    expect(r.currentWinnings).toBeCloseTo(target, 4);
    expect(r.feasible).toBe(true);
  });

  it("with P(1st) lock honors the lock and still hits target", () => {
    const target = 16.5;
    const r = calibrateShelledItm(
      N, paid, curve, pool, target, itm, { first: 0.0125 }, { id: "power-law" },
    );
    expect(r.pmf[0]).toBeCloseTo(0.0125, 8);
    expect(r.currentWinnings).toBeCloseTo(target, 4);
    expect(r.feasible).toBe(true);
  });

  it("keeps first place at least equilibrium for high-ITM Battle Royale regs", () => {
    const brN = 18;
    const brPaid = 3;
    const br25 = battleRoyaleRowFromTotalTicket(25);
    const buyIn = br25.buyIn;
    const entryCost = buyIn * (1 + br25.rake);
    const brPool = brN * buyIn * 0.5;
    const brCurve = getPayoutTable("battle-royale", brN).slice(0, brPaid);
    const targetRegular = entryCost * 1.03 * 0.5;
    const r = calibrateShelledItm(
      brN,
      brPaid,
      brCurve,
      brPool,
      targetRegular,
      0.24,
      undefined,
      { id: "power-law" },
    );
    let paidMass = 0;
    for (let i = 0; i < brPaid; i++) paidMass += r.pmf[i];

    expect(r.pmf[0]).toBeCloseTo(1 / brN, 10);
    expect(paidMass).toBeCloseTo(0.24, 10);
    expect(r.currentWinnings).toBeGreaterThan(targetRegular);
    expect(r.feasible).toBe(false);
  });

  it("lets explicit first-place locks override the equilibrium floor", () => {
    const brN = 18;
    const brPaid = 3;
    const br25 = battleRoyaleRowFromTotalTicket(25);
    const buyIn = br25.buyIn;
    const entryCost = buyIn * (1 + br25.rake);
    const brPool = brN * buyIn * 0.5;
    const brCurve = getPayoutTable("battle-royale", brN).slice(0, brPaid);
    const targetRegular = entryCost * 1.03 * 0.5;
    const r = calibrateShelledItm(
      brN,
      brPaid,
      brCurve,
      brPool,
      targetRegular,
      0.24,
      { first: 0.01 },
      { id: "power-law" },
    );

    expect(r.pmf[0]).toBeCloseTo(0.01, 10);
  });

  it("flags infeasible when locks are too small to hit target", () => {
    // Lock top-9 at 0.5% total — paid band mass below any α can reach target.
    const target = 16.5;
    const r = calibrateShelledItm(
      N, paid, curve, pool, target, itm,
      { first: 0.001, top3: 0.002, ft: 0.005 },
      { id: "power-law" },
    );
    expect(r.feasible).toBe(false);
    expect(r.currentWinnings).toBeLessThan(target);
  });

  it("accepts a miss of a thousandth of the target, whatever the stake", () => {
    // 0.0028 on 20.96 is 1.3e-4 of it; the old $0.001 slack refused it.
    expect(withinTargetEv(20.96776, 20.96496)).toBe(true);
    expect(withinTargetEv(20.96496 * 1.002, 20.96496)).toBe(false);
    // The same share of a $0.0055 target is a hundredth of a cent, not a tenth of a cent.
    expect(withinTargetEv(0.0055 + 0.0003, 0.0055)).toBe(false);
    expect(targetEvTolerance(0.0055)).toBeCloseTo(5.5e-6, 12);
  });

  it("calls a saturated free band feasible when it stops a hair short of the target", () => {
    // All free mass on 1st (α at its ceiling) pays 1.3e-4 of the target short.
    const ceiling = calibrateShelledItm(
      N, paid, curve, pool, 1e9, itm, undefined, { id: "power-law" },
    ).currentWinnings;
    const nearlyThere = calibrateShelledItm(
      N, paid, curve, pool, ceiling * (1 + 1.3e-4), itm, undefined, { id: "power-law" },
    );
    expect(nearlyThere.feasible).toBe(true);
    const farOff = calibrateShelledItm(
      N, paid, curve, pool, ceiling * 1.01, itm, undefined, { id: "power-law" },
    );
    expect(farOff.feasible).toBe(false);
  });

  it("does not hold a model with no α to a target it cannot move", () => {
    const target = 16.5;
    for (const model of [
      { id: "uniform" } as FinishModelConfig,
      { id: "empirical", empiricalBuckets: [8, 4, 2, 1, 1, 1, 1, 1, 1, 1] } as FinishModelConfig,
    ]) {
      const r = calibrateShelledItm(N, paid, curve, pool, target, itm, undefined, model);
      expect(Math.abs(r.currentWinnings - target)).toBeGreaterThan(1);
      expect(r.feasible).toBe(true);
      expect(r.supportsTargetRoi).toBe(false);
    }
  });

  it("PMF sums to 1 under all shell configurations", () => {
    const cases = [
      undefined,
      { first: 0.01 },
      { first: 0.01, top3: 0.03 },
      { first: 0.01, top3: 0.03, ft: 0.08 },
      { ft: 0.10 },
    ];
    for (const shells of cases) {
      const r = calibrateShelledItm(
        N, paid, curve, pool, 12, itm, shells, { id: "power-law" },
      );
      let s = 0;
      for (let i = 0; i < N; i++) s += r.pmf[i];
      expect(s).toBeCloseTo(1, 6);
    }
  });
});

describe("calibrateShelledItm: free band the model gives no weight to", () => {
  const sum = (a: Float64Array) => a.reduce((x, y) => x + y, 0);
  const paidMass = (a: Float64Array, paid: number) => sum(a.slice(0, paid));
  const solve = (
    structure: Parameters<typeof getPayoutTable>[0],
    N: number,
    itm: number,
    locks: { first?: number; top3?: number; ft?: number },
    model: FinishModelConfig,
    roi: number,
  ) => {
    const payouts = getPayoutTable(structure, N);
    const paid = payouts.reduce((n, p) => (p > 0 ? n + 1 : n), 0);
    const r = calibrateShelledItm(N, paid, payouts, N * 10, 11 * (1 + roi), itm, locks, model);
    return { r, paid };
  };

  it("linear skill at its α ceiling keeps the whole ITM band (BR, 9 players, first locked)", () => {
    const { r, paid } = solve("battle-royale", 9, 0.09010175858158619, { first: 0.019911431847140195 }, { id: "linear-skill" }, 0.1648);
    expect(paid).toBe(2);
    expect(sum(r.pmf)).toBeCloseTo(1, 12);
    expect(paidMass(r.pmf, paid)).toBeCloseTo(0.09010175858158619, 12);
    expect(r.pmf[0]).toBeCloseTo(0.019911431847140195, 12);
    expect(r.pmf[1]).toBeCloseTo(0.09010175858158619 - 0.019911431847140195, 12);
    expect(r.feasible).toBe(false);
  });

  it("linear skill at its α ceiling keeps the whole ITM band (SNG 65/35, ITM 100 %, first locked)", () => {
    const { r, paid } = solve("sng-65-35", 3, 1, { first: 0.09937498716171832 }, { id: "linear-skill" }, 0.3359);
    expect(paid).toBe(2);
    expect(sum(r.pmf)).toBeCloseTo(1, 12);
    expect(paidMass(r.pmf, paid)).toBeCloseTo(1, 12);
    expect(r.pmf[0]).toBeCloseTo(0.09937498716171832, 12);
    expect(r.pmf[1]).toBeCloseTo(1 - 0.09937498716171832, 12);
  });

  it("a stretched exponential that underflows on the free band keeps its mass too", () => {
    const { r, paid } = solve("mtt-standard", 1000, 0.3, { first: 0.05, ft: 0.25 }, { id: "stretched-exp", beta: 1.3 }, -0.4);
    expect(sum(r.pmf)).toBeCloseTo(1, 12);
    expect(paidMass(r.pmf, paid)).toBeCloseTo(0.3, 12);
    expect(r.shells.first).toBeCloseTo(0.05, 12);
    expect(r.shells.ft).toBeCloseTo(0.25, 12);
    expect(r.feasible).toBe(false);
  });

  it("an unreachable target is still reported as infeasible rather than as a solved shape", () => {
    const { r } = solve("battle-royale", 9, 0.09010175858158619, { first: 0.019911431847140195 }, { id: "linear-skill" }, 0.1648);
    expect(Math.abs(r.currentWinnings - 11 * 1.1648)).toBeGreaterThan(1e-3);
    expect(r.feasible).toBe(false);
  });

  describe("simulated end to end", () => {
    const rows: Array<[string, TournamentRow]> = [
      ["BR 9 players, ITM 9 %, first locked", {
        id: "r", label: "r", buyIn: 10, rake: 0.1, roi: 0.1648, count: 5, players: 9,
        payoutStructure: "battle-royale", gameType: "mystery-royale", bountyFraction: 0.25,
        itmRate: 0.09010175858158619, finishBuckets: { first: 0.019911431847140195 },
      }],
      ["SNG 65/35 mystery, ITM 100 %, first locked", {
        id: "r", label: "r", buyIn: 10, rake: 0.1, roi: 0.3359, count: 5, players: 3,
        payoutStructure: "sng-65-35", gameType: "mystery", bountyFraction: 0.5,
        itmRate: 1, finishBuckets: { first: 0.09937498716171832 },
      }],
    ];
    const inputFor = (row: TournamentRow, id: "linear-skill" | "power-law"): SimulationInput => ({
      schedule: [row], scheduleRepeats: 1, samples: 4000, bankroll: 0, seed: 5, finishModel: { id },
    });

    it.each(rows)("%s: linear skill compiles and simulates like power-law", (_name, row) => {
      const linear = compileSchedule(inputFor(row, "linear-skill"), "alpha").flat[0];
      const power = compileSchedule(inputFor(row, "power-law"), "alpha").flat[0];
      expect(linear.analyticMeanSingle).toBeCloseTo(power.analyticMeanSingle, 10);
      expect(linear.analyticMeanSingle).toBeCloseTo(row.buyIn * (1 + row.rake) * (1 + row.roi), 8);
      const a = runSimulation(inputFor(row, "linear-skill"));
      const b = runSimulation(inputFor(row, "power-law"));
      expect(a.stats.mean).toBe(b.stats.mean);
      expect(a.stats.stdDev).toBe(b.stats.stdDev);
    });
  });
});

describe("sampleFromCDF", () => {
  it("empirical frequencies match PMF within χ²", () => {
    const N = 20;
    const pmf = buildFinishPMF(N, { id: "power-law" }, 1.5);
    const cdf = buildCDF(pmf);
    const counts = new Array(N).fill(0);
    const trials = 200_000;
    // Use a deterministic sequence: just equispaced u for reproducibility.
    let acc = 0;
    const step = 1 / trials;
    for (let i = 0; i < trials; i++) {
      acc += step;
      const u = acc % 1;
      counts[sampleFromCDF(cdf, u)]++;
    }
    for (let i = 0; i < N; i++) {
      const freq = counts[i] / trials;
      expect(Math.abs(freq - pmf[i])).toBeLessThan(0.003);
    }
  });
});

describe("cashTargetFloor", () => {
  it("is the old $0.01 for any ticket of $10 or more", () => {
    expect(cashTargetFloor(10)).toBe(0.01);
    expect(cashTargetFloor(11)).toBe(0.01);
    expect(cashTargetFloor(1100)).toBe(0.01);
  });

  it("follows a smaller ticket down and never reaches zero", () => {
    expect(cashTargetFloor(1)).toBeCloseTo(0.001, 12);
    expect(cashTargetFloor(0.011)).toBeCloseTo(1.1e-5, 14);
    expect(cashTargetFloor(0)).toBeGreaterThan(0);
  });
});

describe("empirical finish model resampling", () => {
  const spike = [10, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  const total = spike.reduce((a, b) => a + b, 0);

  const massOfBucket = (N: number, bucket: number): number => {
    const pmf = buildFinishPMF(N, { id: "empirical", empiricalBuckets: spike }, 0);
    const width = N / spike.length;
    let m = 0;
    for (let i = Math.round(bucket * width); i < Math.round((bucket + 1) * width); i++) m += pmf[i];
    return m;
  };

  it.each([10, 20, 100, 1000, 10_000])(
    "keeps each pasted bucket's share of the field at N=%i",
    (N) => {
      expect(massOfBucket(N, 0)).toBeCloseTo(10 / total, 10);
      expect(massOfBucket(N, 1)).toBeCloseTo(1 / total, 10);
      expect(massOfBucket(N, 9)).toBeCloseTo(1 / total, 10);
    },
  );

  it("does not jump between a field smaller and larger than the histogram", () => {
    const first = (N: number) => massOfBucket(N, 0);
    expect(Math.abs(first(20) - first(5 * 20))).toBeLessThan(1e-10);
    expect(Math.abs(first(10) - first(11 * 10))).toBeLessThan(1e-10);
  });

  it("sums to one and stays uniform for a flat histogram at any N", () => {
    for (const N of [3, 10, 37, 500]) {
      const flat = buildFinishPMF(N, { id: "empirical", empiricalBuckets: [2, 2, 2, 2, 2] }, 0);
      expect(flat.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      for (let i = 0; i < N; i++) expect(flat[i]).toBeCloseTo(1 / N, 12);
    }
  });

  it("returns the pasted histogram itself when the field is as long as the histogram", () => {
    const pmf = buildFinishPMF(10, { id: "empirical", empiricalBuckets: spike }, 0);
    for (let i = 0; i < 10; i++) expect(pmf[i]).toBeCloseTo(spike[i] / total, 12);
  });
});
