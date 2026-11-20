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
  playsWholeFieldShape,
} from "./finishModel";
import { applyItmTarget } from "./itmTarget";
import { applyItmTopHeavyToFreeBand } from "./itmTopHeavy";
import { getPayoutTable } from "./payouts";
import { battleRoyaleRowFromTotalTicket } from "./battleRoyaleTicket";
import { compileSchedule, runSimulation } from "./engine";
import { validateSchedule } from "./validation";
import { applyGameType } from "./gameType";
import { compiledEntryMoments } from "./scheduleMoments";
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

  it("holds a high-ITM Battle Royale reg to the most first place its target allows", () => {
    // Above the no-skill winnings, but the 1/N solution overpays at every α:
    // the floor yields, and first place keeps what the target can carry.
    const brN = 18;
    const brPaid = 3;
    const br25 = battleRoyaleRowFromTotalTicket(25);
    const buyIn = br25.buyIn;
    const entryCost = buyIn * (1 + br25.rake);
    const brPool = brN * buyIn * 0.5;
    const brCurve = getPayoutTable("battle-royale", brN).slice(0, brPaid);
    const targetRegular = entryCost * 1.03 * 0.5;
    const solve = (locks?: { first: number }) =>
      calibrateShelledItm(brN, brPaid, brCurve, brPool, targetRegular, 0.24, locks, { id: "power-law" });
    const r = solve();
    let paidMass = 0;
    for (let i = 0; i < brPaid; i++) paidMass += r.pmf[i];

    expect(targetRegular).toBeGreaterThan(brPool / brN);
    expect(r.pmf[0] * brN).toBeCloseTo(0.567, 3);
    expect(paidMass).toBeCloseTo(0.24, 10);
    expect(Math.abs(r.currentWinnings / targetRegular - 1)).toBeLessThan(2e-9);
    expect(r.feasible).toBe(true);
    expect(solve({ first: 1 / brN }).feasible).toBe(false);
    expect(solve({ first: r.pmf[0] * 1.01 }).currentWinnings).toBeGreaterThan(targetRegular * 1.0005);
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

describe("an empirical history on the run path", () => {
  // 30 paid places of 200; the history cashes 9 times in each of places 1..30
  // and finishes 4 times in each of places 31..200, so it is in the money
  // 270 / 950 = 28.42% of the time against the table's 15%.
  const N = 200;
  const payouts = getPayoutTable("mtt-standard", N);
  const paid = payouts.filter((p) => p > 0).length;
  const pool = N * 100;
  const buckets = Array.from({ length: N }, (_, i) => (i < 30 ? 9 : 4));
  const model: FinishModelConfig = { id: "empirical", empiricalBuckets: buckets };

  it("plays the pasted whole-field history, not the history squeezed into the paid places", () => {
    expect(paid).toBe(30);
    const r = calibrateShelledItm(N, paid, payouts, pool, 121, paid / N, { first: 0.05 }, model, 1);
    const whole = buildFinishPMF(N, model, 0);
    expect(Array.from(r.pmf)).toEqual(Array.from(whole));
    expect(itmProbability(r.pmf, paid)).toBeCloseTo(270 / 950, 12);
    expect(r.feasible).toBe(true);
    expect(r.supportsTargetRoi).toBe(false);
  });

  it("gives a history of only wins P(1st) = 1 at the row's pinned ITM", () => {
    const wins: FinishModelConfig = { id: "empirical", empiricalBuckets: [50, ...new Array(N - 1).fill(0)] };
    const r = calibrateShelledItm(N, paid, payouts, pool, 121, paid / N, undefined, wins);
    expect(r.pmf[0]).toBeCloseTo(1, 12);
  });

  it("keeps the no-data fallback: uniform over the paid places at the row's ITM", () => {
    for (const empiricalBuckets of [undefined, [], [0, 0, 0]]) {
      const empty: FinishModelConfig = { id: "empirical", empiricalBuckets };
      expect(playsWholeFieldShape(empty)).toBe(false);
      const r = calibrateShelledItm(N, paid, payouts, pool, 121, 0.15, undefined, empty);
      for (let i = 0; i < paid; i++) expect(r.pmf[i]).toBeCloseTo(0.15 / paid, 12);
      expect(r.pmf[N - 1]).toBeCloseTo(0.85 / (N - paid), 12);
    }
  });

  it("reaches the engine's mean through the ITM the app stamps on every row", () => {
    const row: TournamentRow = {
      id: "e", players: N, buyIn: 100, rake: 0.1, roi: 0.1,
      payoutStructure: "mtt-standard", gameType: "freezeout", count: 1,
    };
    const schedule = applyItmTarget([row], { enabled: false, pct: 18.7 });
    expect(schedule[0].itmRate).toBe(0.15);
    const historyEv = buckets.reduce((ev, n, i) => ev + n * (payouts[i] ?? 0) * pool, 0) / 950;
    const input: SimulationInput = {
      schedule, scheduleRepeats: 50, samples: 4000, bankroll: 0, seed: 20261119, finishModel: model,
    };
    const res = runSimulation(input);
    expect(res.stats.itmRate).toBeCloseTo(270 / 950, 2);
    expect(res.expectedProfit / 50).toBeCloseTo(historyEv - 110, 9);
    const se = res.stats.stdDev / Math.sqrt(res.samples);
    expect(Math.abs(res.stats.mean - res.expectedProfit) / se).toBeLessThan(4);
  });
});

describe("ITM top-heaviness reaches only the models where it has a labelled meaning", () => {
  const N = 500;
  const payouts = getPayoutTable("mtt-standard", N);
  const paid = payouts.filter((p) => p > 0).length;
  const pool = N * 100;
  const target = 121;
  const grid = Array.from({ length: 41 }, (_, k) => Math.round((-1 + k * 0.05) * 100) / 100);

  it.each(["power-law", "powerlaw-realdata-influenced"] as const)(
    "%s: right raises P(1st) at the same EV",
    (id) => {
      let prev = -Infinity;
      for (const bias of grid) {
        const r = calibrateShelledItm(N, paid, payouts, pool, target, paid / N, undefined, { id }, bias);
        expect(withinTargetEv(r.currentWinnings, target)).toBe(true);
        expect(r.pmf[0]).toBeGreaterThanOrEqual(prev - 1e-15);
        prev = r.pmf[0];
      }
      const flat = calibrateShelledItm(N, paid, payouts, pool, target, paid / N, undefined, { id }, -1);
      const heavy = calibrateShelledItm(N, paid, payouts, pool, target, paid / N, undefined, { id }, 1);
      expect(heavy.pmf[0]).toBeGreaterThan(flat.pmf[0]);
    },
  );

  it.each<FinishModelConfig>([
    { id: "plackett-luce" },
    { id: "stretched-exp", beta: 1 },
    { id: "linear-skill" },
    { id: "uniform" },
    { id: "empirical" },
    { id: "empirical", empiricalBuckets: [20, 10, 5, 3, 2, 1, 1, 1, 1, 1] },
    { id: "freeze-realdata-linear" },
  ])("$id plays the same pmf at every bias", (model) => {
    const neutral = calibrateShelledItm(N, paid, payouts, pool, target, paid / N, undefined, model, 0);
    for (const bias of [-1, -0.5, 0.5, 1]) {
      const r = calibrateShelledItm(N, paid, payouts, pool, target, paid / N, undefined, model, bias);
      expect(Array.from(r.pmf)).toEqual(Array.from(neutral.pmf));
    }
  });
});

describe("calibrateShelledItm: the first-place floor around break-even", () => {
  // Freezeout of 1000 at $10 + 10%, ITM pinned at 25% against a table that
  // pays 15%: the free solution puts first place under 1/N at break-even.
  const N = 1000;
  const payouts = getPayoutTable("mtt-standard", N);
  const paid = payouts.reduce((n, p) => (p > 0 ? n + 1 : n), 0);
  const pool = N * 10;
  const itm = 0.25;
  const noSkillWinnings = payouts.slice(0, paid).reduce((s, p) => s + (p * pool) / N, 0);
  const solve = (target: number, locks?: { first?: number }) =>
    calibrateShelledItm(N, paid, payouts, pool, target, itm, locks, { id: "power-law" });
  const paidMass = (pmf: Float64Array) => pmf.slice(0, paid).reduce((a, b) => a + b, 0);

  it("does not jump between two targets a millionth either side of the no-skill winnings", () => {
    // The free solution has P(1st)·N 0.475 here; the floor at the no-skill
    // winnings is 1.
    const below = solve(noSkillWinnings * (1 - 1e-6));
    const at = solve(noSkillWinnings);
    expect(at.pmf[0] * N).toBeCloseTo(1, 12);
    expect(Math.abs(below.pmf[0] - at.pmf[0]) * N).toBeLessThan(1e-3);
    for (const r of [below, at]) {
      expect(r.feasible).toBe(true);
      expect(paidMass(r.pmf)).toBeCloseTo(itm, 12);
    }
  });

  it("from the no-skill winnings up is the solution with first place locked at 1/N, bit for bit", () => {
    for (const ratio of [1, 1.05, 1.3]) {
      const target = noSkillWinnings * ratio;
      expect(Array.from(solve(target).pmf)).toEqual(Array.from(solve(target, { first: 1 / N }).pmf));
    }
  });

  it("fades in over the band below, P(1st) rising with the target at the exact ITM, at any top-heaviness", () => {
    // Deterministic solves, 0.0025 of the no-skill winnings apart. The second
    // case is a row whose 1/N solution overpays at the bottom of its α range,
    // where the first-place lock slides down to what the target allows.
    const cases = [
      { model: { id: "power-law" } as FinishModelConfig, n: N, table: payouts, cut: paid, p: pool, i: itm },
      (() => {
        const t = getPayoutTable("mtt-standard", 500);
        return { model: { id: "linear-skill" } as FinishModelConfig, n: 500, table: t, cut: t.filter((x) => x > 0).length, p: 5000, i: 0.35 };
      })(),
    ];
    for (const c of cases) {
      const eqW = c.table.slice(0, c.cut).reduce((acc, x) => acc + (x * c.p) / c.n, 0);
      for (const bias of [-1, 0, 1]) {
        let last = 0;
        for (let k = 0; k <= 60; k++) {
          const target = eqW * (0.85 + k * 0.0025);
          const r = calibrateShelledItm(c.n, c.cut, c.table, c.p, target, c.i, undefined, c.model, bias);
          expect(r.pmf.slice(0, c.cut).reduce((a, b) => a + b, 0)).toBeCloseTo(c.i, 12);
          if (r.feasible) expect(withinTargetEv(r.currentWinnings, target)).toBe(true);
          expect(r.pmf[0]).toBeGreaterThanOrEqual(last);
          last = r.pmf[0];
        }
      }
    }
    // Below the band the free solution is untouched.
    const low = solve(noSkillWinnings * 0.89);
    expect(low.pmf[0]).toBeLessThan(0.5 / N);
  });

  it("does not reorder the places below first where the floor starts to bind under a top-heavy tilt", () => {
    // 50 runners, mtt-top-heavy (6 paid), ITM 25%, tilt +1. Locking first
    // place moves the tilt's top onto 2nd; re-solving with first held at its
    // natural share there moved P(2nd)·N 0.361 -> 0.406 at one target. The
    // mixture moves no place by more than 0.0029/N per 1e-4 of the no-skill
    // winnings across the band; the old switch at break-even moved 1.89/N.
    const n = 50;
    const table = getPayoutTable("mtt-top-heavy", n);
    const cut = table.filter((x) => x > 0).length;
    const eqW = table.slice(0, cut).reduce((acc, x) => acc + (x * 500) / n, 0);
    let prev: Float64Array | null = null;
    let worst = 0;
    for (let k = 0; k <= 1100; k++) {
      const r = calibrateShelledItm(n, cut, table, 500, eqW * (0.89 + k * 1e-4), 0.25, undefined, { id: "power-law" }, 1);
      if (prev) for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(r.pmf[i] - prev[i]) * n);
      prev = r.pmf;
    }
    expect(worst).toBeLessThan(0.01);
  });

  it("σ along ROI -20%..+5% has no step on rows pinned above the paid share", () => {
    // Deterministic compile, no sampling. Bound: between two ROIs 0.1 pp
    // apart that both validate, σ moves by at most 0.5% or by at most 1.5x
    // the larger of its two neighbouring moves, so every move is the local
    // slope. The old floor switched on at -rake/(1+rake): on these rows that
    // was a 13.9% to 81.9% step next to neighbours of 0.1-4.8% (isolation 17x
    // to 320x). Now the largest move is 19.1% (Mystery 30, tilt +1, at the
    // band's onset) at 1.17x its neighbour; the others are under 3.4%.
    const model: FinishModelConfig = { id: "powerlaw-realdata-influenced" };
    for (const [gameType, players, pinned, bias] of [
      ["freezeout", 500, 0.25, 0],
      ["pko", 200, 0.25, -1],
      ["pko", 45, 0.187, 0],
      ["mystery", 30, 0.15, 1],
      ["mystery", 24, 0.187, 0],
    ] as const) {
      const sigma: (number | null)[] = [];
      for (let k = -200; k <= 50; k++) {
        let row: TournamentRow = { id: "r", players, buyIn: 100, rake: 0.1, roi: k / 1000, payoutStructure: "mtt-standard", count: 1 };
        row = { ...row, ...applyGameType(row, gameType), players, itmRate: pinned, itmTopHeavyBias: bias };
        if (!validateSchedule([row], model).ok) {
          sigma.push(null);
          continue;
        }
        const e = compileSchedule({ schedule: [row], scheduleRepeats: 1, samples: 1, bankroll: 0, seed: 1, finishModel: model }).flat[0];
        const m = compiledEntryMoments(e);
        sigma.push(Math.sqrt(m.secondDollar - m.meanDollar ** 2));
      }
      expect(sigma.filter((x) => x != null).length).toBe(251);
      const steps = sigma.slice(1).map((x, i) => Math.abs((x as number) - (sigma[i] as number)) / (sigma[i] as number));
      for (let i = 0; i < steps.length; i++) {
        const neighbour = Math.max(steps[i - 1] ?? 0, steps[i + 1] ?? 0);
        expect(steps[i]).toBeLessThanOrEqual(Math.max(0.005, 1.5 * neighbour));
      }
    }
  });

  it("leaves a top-3 lock typed under 1/N alone", () => {
    // 500 runners, P(top 3) locked at 0.0015 against 1/N = 0.002. Holding
    // first place to 1/N lifted P(top 3) to 0.0018-0.0020 and left 2nd and
    // 3rd with nothing.
    const n = 500;
    const table = getPayoutTable("mtt-standard", n);
    const cut = table.filter((x) => x > 0).length;
    const eqW = table.slice(0, cut).reduce((acc, x) => acc + (x * 5000) / n, 0);
    for (const ratio of [0.92, 0.97, 0.999, 1, 1.02, 1.1]) {
      const r = calibrateShelledItm(
        n, cut, table, 5000, eqW * ratio, 0.2, { top3: 0.0015, ft: 0.02 }, { id: "powerlaw-realdata-influenced" },
      );
      expect(r.pmf[0] + r.pmf[1] + r.pmf[2]).toBeCloseTo(0.0015, 12);
      expect(r.pmf[1]).toBeGreaterThan(0);
    }
  });

  it("under a top-heavy tilt has no σ step where the free P(1st) crosses 1/N above break-even", () => {
    // With first place locked the tilt's top sits on 2nd place, so the 1/N
    // solution and the free one differ even at equal P(1st). Returning the
    // free one from the crossing on moved σ by 14.3% (Mystery 18, ITM 25%,
    // at ROI +28.6%) and 9.2% (ITM 18.7%, at +2.6%) between two ROIs; the
    // 1/N solution's share now fades out over the next tenth of 1/N.
    const model: FinishModelConfig = { id: "powerlaw-realdata-influenced" };
    for (const [gameType, players, pinned, from, to] of [
      ["mystery", 18, 0.25, 200, 400],
      ["mystery", 18, 0.187, -50, 100],
      ["pko", 18, 0.25, 200, 400],
      ["pko", 24, 3 / 24, -100, 0],
    ] as const) {
      const sigma: number[] = [];
      for (let k = from; k <= to; k++) {
        let row: TournamentRow = { id: "r", players, buyIn: 100, rake: 0.1, roi: k / 1000, payoutStructure: "mtt-standard", count: 1 };
        row = { ...row, ...applyGameType(row, gameType), players, itmRate: pinned, itmTopHeavyBias: -1 };
        expect(validateSchedule([row], model).ok).toBe(true);
        const e = compileSchedule({ schedule: [row], scheduleRepeats: 1, samples: 1, bankroll: 0, seed: 1, finishModel: model }).flat[0];
        const m = compiledEntryMoments(e);
        sigma.push(Math.sqrt(m.secondDollar - m.meanDollar ** 2));
      }
      const steps = sigma.slice(1).map((x, i) => Math.abs(x - sigma[i]) / sigma[i]);
      for (let i = 0; i < steps.length; i++) {
        const neighbour = Math.max(steps[i - 1] ?? 0, steps[i + 1] ?? 0);
        expect(steps[i]).toBeLessThanOrEqual(Math.max(0.005, 1.5 * neighbour));
      }
    }
  });

  it("keeps a losing row Run accepts accepted, on target and at its ITM", () => {
    // 30 runners, ITM 18.7% against 4 paid places: at ROI -10% the full 1/N
    // floor overpays the target at every α, so first place keeps the most the
    // target allows (P(1st)·N 0.609 against a band floor of 0.9).
    const row: TournamentRow = {
      id: "r", players: 30, buyIn: 10, rake: 0.1, roi: -0.1, payoutStructure: "mtt-standard", count: 1, itmRate: 0.187,
    };
    expect(validateSchedule([row], { id: "powerlaw-realdata-influenced" }).ok).toBe(true);
    const e = compileSchedule(
      { schedule: [row], scheduleRepeats: 1, samples: 1, bankroll: 0, seed: 1, finishModel: { id: "powerlaw-realdata-influenced" } },
    ).flat[0];
    expect(withinTargetEv(e.analyticMeanSingle, 11 * 0.9)).toBe(true);
    expect(e.itm).toBeCloseTo(0.187, 12);
    let first = 0;
    for (let i = 0; i < e.fieldSize; i++) {
      if (i === 0) first += e.aliasProb[i] / e.fieldSize;
      if (e.aliasIdx[i] === 0) first += (1 - e.aliasProb[i]) / e.fieldSize;
    }
    expect(first * e.fieldSize).toBeCloseTo(0.609, 3);
  });

  it("plays the typed ROI where the 1/N solution cannot come down to it", () => {
    // 30 runners at $10 + 10%, ITM 20% against 4 paid places, ROI -13.65%:
    // the floor ramp asks P(1st)·N 0.4985 and the 1/N lock overpays at the
    // bottom of its α range. The typed ROI wins: first place carries the most
    // the target allows, and a lock 1% higher overpays.
    const row: TournamentRow = {
      id: "r", players: 30, buyIn: 10, rake: 0.1, roi: -0.1365, payoutStructure: "mtt-standard",
      gameType: "freezeout", count: 1, itmRate: 0.2,
    };
    const model: FinishModelConfig = { id: "powerlaw-realdata-influenced" };
    expect(validateSchedule([row], model).ok).toBe(true);
    const e = compileSchedule(
      { schedule: [row], scheduleRepeats: 1, samples: 1, bankroll: 0, seed: 1, finishModel: model },
    ).flat[0];
    const target = 11 * (1 - 0.1365);
    expect(Math.abs(e.analyticMeanSingle / target - 1)).toBeLessThan(2e-9);
    const table = getPayoutTable("mtt-standard", 30);
    const cut = table.filter((x) => x > 0).length;
    const free = calibrateShelledItm(30, cut, table, 300, target, 0.2, undefined, model);
    expect(free.pmf[0] * 30).toBeCloseTo(0.188, 3);
    const higher = calibrateShelledItm(30, cut, table, 300, target, 0.2, { first: free.pmf[0] * 1.01 }, model);
    expect(higher.currentWinnings).toBeGreaterThan(target * (1 + 1e-5));
  });

  it("has no steep spot where the 1/N solution starts to overpay below break-even", () => {
    // 50 runners, mtt-top-heavy (6 paid), ITM 25%, no tilt, targets 2e-4 of
    // the no-skill winnings apart. The 1/N solution overpays from 0.904 to
    // 0.996 of them; a mixture that stopped short of the target there would
    // have to drop the lock's share to nothing where the overpayment starts.
    const n = 50;
    const table = getPayoutTable("mtt-top-heavy", n);
    const cut = table.filter((x) => x > 0).length;
    const eqW = table.slice(0, cut).reduce((acc, x) => acc + (x * 500) / n, 0);
    let prev: Float64Array | null = null;
    let worst = 0;
    for (let k = 0; k <= 3600; k++) {
      const target = eqW * (0.88 + k * 2e-4);
      const r = calibrateShelledItm(n, cut, table, 500, target, 0.25, undefined, { id: "power-law" });
      expect(r.feasible).toBe(true);
      expect(Math.abs(r.currentWinnings / target - 1)).toBeLessThan(2e-9);
      if (prev) {
        expect(r.pmf[0]).toBeGreaterThanOrEqual(prev[0]);
        for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(r.pmf[i] - prev[i]) * n);
      }
      prev = r.pmf;
    }
    expect(worst).toBeLessThan(0.006);
  });

  it("lets a bounty row's cash side overpay only what its KO budget hands back", () => {
    // Two PKO 30 rows whose 1/N solution's cash side overpays even the row's
    // total winnings. Capped at the total, ITM 30% at ROI +10% leaves $6.85 of
    // KO EV and ITM 25%, tilt -0.5 at ROI 0% $1.32, both at P(1st)·N 1 and
    // under the KO EV those places guarantee ($11.92 and $11.67: a winner keeps
    // two $50 heads), so first place slides down until the cash side leaves
    // what the places of its own solve guarantee ($10.99 and $10.08). Either
    // way the bounty residual closes the total.
    const model: FinishModelConfig = { id: "powerlaw-realdata-influenced" };
    for (const [itm, bias, roi, firstN, slack] of [
      [0.3, 0, 0.1, 0.6468, 1e-12],
      [0.25, -0.5, 0, 0.4383, 1e-12],
    ] as const) {
      let row: TournamentRow = { id: "r", players: 30, buyIn: 100, rake: 0.1, roi, payoutStructure: "mtt-standard", count: 1 };
      row = { ...row, ...applyGameType(row, "pko"), players: 30, itmRate: itm, itmTopHeavyBias: bias };
      expect(validateSchedule([row], model).ok).toBe(true);
      const e = compileSchedule(
        { schedule: [row], scheduleRepeats: 1, samples: 1, bankroll: 0, seed: 1, finishModel: model },
      ).flat[0];
      expect(Math.abs(e.analyticMeanSingle / (110 * (1 + roi)) - 1)).toBeLessThan(slack);
      let first = 0;
      for (let i = 0; i < e.fieldSize; i++) {
        if (i === 0) first += e.aliasProb[i] / e.fieldSize;
        if (e.aliasIdx[i] === 0) first += (1 - e.aliasProb[i]) / e.fieldSize;
      }
      expect(first * e.fieldSize).toBeCloseTo(firstN, 3);
      expect(e.bountyByPlace![0]).toBeCloseTo(100, 6);
    }
  });

  it("under a top-heavy tilt moves P(1st) only from its natural value toward 1/N, never past either", () => {
    // Rows whose 1/N solution overpays at every α while the natural one is on
    // target, so the lock slides below 1/N. Under a tilt the slid solution
    // differs from the natural one below first place even where their P(1st)
    // meet, so its share has to fade out before the lock passes the natural
    // value, or P(1st) would fall below both the natural value and the floor.
    // The natural solution comes from the same shape and tilt without the
    // floor, α bisected over the solver's range.
    const natural = (cut: number, table: readonly number[], pool: number, itm: number, bias: number, target: number) => {
      const free = Array.from({ length: cut }, (_, i) => i);
      const shape = (a: number) => {
        const { adjusted, freeSum } = applyItmTopHeavyToFreeBand(buildFinishPMF(cut, { id: "power-law" }, a), free, bias);
        return free.map((i) => (adjusted[i] / freeSum) * itm);
      };
      const ev = (a: number) => shape(a).reduce((s, m, i) => s + m * table[i] * pool, 0);
      let lo = -6;
      let hi = 25;
      for (let k = 0; k < 60; k++) {
        const mid = (lo + hi) / 2;
        if (ev(mid) < target) lo = mid;
        else hi = mid;
      }
      return { first: shape((lo + hi) / 2)[0], winnings: ev((lo + hi) / 2) };
    };
    for (const [tableId, n, itm, bias, from] of [
      ["sng-50-30-20", 10, 0.5, -1, 1.3],
      ["mtt-top-heavy", 30, 0.15, -1, 1.2],
      ["mtt-flat", 18, 0.25, -1, 1.35],
      ["mtt-standard", 50, 0.25, 1, 0.9],
    ] as const) {
      const table = getPayoutTable(tableId, n);
      const cut = table.filter((x) => x > 0).length;
      const pool = n * 10;
      const eqW = table.slice(0, cut).reduce((acc, x) => acc + (x * pool) / n, 0);
      let last = 0;
      for (let k = 0; k <= 450; k++) {
        const ratio = from + k * 1e-3;
        const target = eqW * ratio;
        const r = calibrateShelledItm(n, cut, table, pool, target, itm, undefined, { id: "power-law" }, bias);
        const nat = natural(cut, table, pool, itm, bias, target);
        const floor = Math.min(1, (ratio - 0.9) / 0.1) / n;
        expect(Math.abs(nat.winnings / target - 1)).toBeLessThan(1e-12);
        expect(r.feasible).toBe(true);
        expect(Math.abs(r.currentWinnings / target - 1)).toBeLessThan(2e-9);
        expect(r.pmf[0]).toBeGreaterThanOrEqual(Math.min(nat.first, floor) - 1e-9 / n);
        expect(r.pmf[0]).toBeLessThanOrEqual(Math.max(nat.first, 1 / n) + 1e-9 / n);
        expect(r.pmf[0]).toBeGreaterThanOrEqual(last);
        last = r.pmf[0];
      }
    }
  });

  it("under a top-heavy tilt keeps P(1st) rising with the target and the typed top-3 and final-table locks held", () => {
    // Targets 2e-4 of the no-skill winnings apart, tilt ±1. On the 50-runner
    // row at tilt -1 the 1/N solution pays too little between 0.929 and 0.937
    // of them even with 2nd at its most, so its lock slides above 1/N toward
    // the most first place the typed locks leave, and the mixture keeps them.
    // A slid lock may move P(1st) only as far toward 1/N as the 1/N lock
    // would have, never past the natural value, or P(1st) overshoots and
    // falls back as the target rises.
    for (const [tableId, n, itm, locks, runnableAtLeast] of [
      ["mtt-standard", 100, 0.2, { top3: 0.04, ft: 0.14 }, 2000],
      ["mtt-top-heavy", 50, 0.15, { top3: 0.03, ft: 0.105 }, 590],
    ] as const) {
      const table = getPayoutTable(tableId, n);
      const cut = table.filter((x) => x > 0).length;
      const pool = n * 10;
      const eqW = table.slice(0, cut).reduce((acc, x) => acc + (x * pool) / n, 0);
      const finalTable = cut <= 9 ? itm : locks.ft;
      for (const bias of [-1, 1]) {
        let last = 0;
        let runnable = 0;
        for (let k = 0; k <= 4000; k++) {
          const target = eqW * (0.88 + k * 2e-4);
          const r = calibrateShelledItm(n, cut, table, pool, target, itm, locks, { id: "power-law" }, bias);
          expect(Math.abs(r.pmf[0] + r.pmf[1] + r.pmf[2] - locks.top3)).toBeLessThan(1e-12);
          expect(Math.abs(r.pmf.slice(0, Math.min(9, cut)).reduce((s, p) => s + p, 0) - finalTable)).toBeLessThan(1e-12);
          if (!r.feasible) continue;
          runnable++;
          expect(r.pmf[0]).toBeGreaterThanOrEqual(last);
          last = r.pmf[0];
        }
        expect(runnable).toBeGreaterThan(runnableAtLeast);
      }
    }
  });

  it("without a tilt, keeps a top-3-locked bounty row continuous where its slid lock reaches the natural P(1st)", () => {
    // Bounty rows whose cash side may rise to 1.43x / 1.3x its target, top-3
    // and FT locked, 1e-4 of the no-skill winnings apart. A floor lock that
    // split the rest of the top-3 lock evenly over 2nd and 3rd, where the
    // natural solution shapes them, differed from it even at equal P(1st):
    // taking the whole slid lock until it met the natural P(1st) and none
    // after jumped 2.35/N (SNG 12) and 2.76/N (PokerStars 200) between two
    // neighbours.
    for (const [tableId, n, itm, locks, model, cashCap] of [
      ["sng-50-30-20", 12, 0.467, { top3: 0.096, ft: 0.312 }, "power-law", 1.43],
      ["mtt-pokerstars", 200, 0.14, { top3: 0.028, ft: 0.067 }, "stretched-exp", 1.3],
    ] as const) {
      const table = getPayoutTable(tableId, n);
      const cut = table.filter((x) => x > 0).length;
      const pool = n * 10;
      const eqW = table.slice(0, cut).reduce((acc, x) => acc + (x * pool) / n, 0);
      const topThree = cut <= 3 ? itm : locks.top3;
      const finalTable = cut <= 9 ? itm : locks.ft;
      let prev: Float64Array | null = null;
      let worst = 0;
      for (let k = 0; k <= 500; k++) {
        const target = eqW * (0.95 + k * 1e-4);
        const r = calibrateShelledItm(n, cut, table, pool, target, itm, locks, { id: model }, 0, target * cashCap);
        expect(Math.abs(r.pmf[0] + r.pmf[1] + r.pmf[2] - topThree)).toBeLessThan(1e-12);
        expect(Math.abs(r.pmf.slice(0, Math.min(9, cut)).reduce((s, p) => s + p, 0) - finalTable)).toBeLessThan(1e-12);
        if (prev) {
          expect(r.pmf[0]).toBeGreaterThanOrEqual(prev[0]);
          for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(r.pmf[i] - prev[i]) * n);
        }
        prev = r.pmf;
      }
      expect(worst).toBeLessThan(0.05);
    }
  });

  it("locks first place at 1/N inside a top-3 lock with 2nd and 3rd left to the model's shape", () => {
    // 100 runners, ITM 22.5%, P(top 3) 5.63% and P(FT) 13.5% locked, 1.5x the
    // no-skill winnings: the floor's lock keeps the model's α on 2nd and 3rd,
    // so it pays the target, where a typed first-place lock splits the rest of
    // the top-3 lock evenly and misses it.
    const n = 100;
    const table = getPayoutTable("mtt-standard", n);
    const cut = table.filter((x) => x > 0).length;
    const target = 1.5 * table.slice(0, cut).reduce((acc, x) => acc + (x * 1000) / n, 0);
    const locks = { top3: 0.0563, ft: 0.135 };
    const r = calibrateShelledItm(n, cut, table, 1000, target, 0.225, locks, { id: "power-law" });
    expect(Math.abs(r.pmf[0] * n - 1)).toBeLessThan(1e-12);
    expect(r.pmf[1] * n).toBeCloseTo(0.896, 3);
    expect(r.pmf[2] * n).toBeCloseTo(3.734, 3);
    expect(Math.abs(r.pmf[0] + r.pmf[1] + r.pmf[2] - 0.0563)).toBeLessThan(1e-12);
    expect(Math.abs(r.currentWinnings / target - 1)).toBeLessThan(1e-12);
    const typed = calibrateShelledItm(n, cut, table, 1000, target, 0.225, { ...locks, first: 1 / n }, { id: "power-law" });
    expect(typed.pmf[1]).toBe(typed.pmf[2]);
    expect(typed.feasible).toBe(false);
  });

  it("without a tilt, meets the natural solution where its P(1st) passes 1/N under a top-3 lock", () => {
    // 100 runners, ITM 22.5%, P(top 3) 5.63% and P(FT) 13.5% locked, no tilt,
    // targets 1e-3 of the no-skill winnings apart above break-even, as a
    // freezeout and as a bounty row whose cash side may rise to 1.6x its
    // target. A 1/N lock that split the rest of the top-3 lock evenly over
    // 2nd and 3rd is not the natural solution at equal P(1st): returning the
    // natural one the moment its P(1st) reached 1/N moved 2nd and 3rd by
    // 0.43/N.
    const n = 100;
    const table = getPayoutTable("mtt-standard", n);
    const cut = table.filter((x) => x > 0).length;
    const eqW = table.slice(0, cut).reduce((acc, x) => acc + (x * 1000) / n, 0);
    for (const cashCap of [1, 1.6]) {
      let prev: Float64Array | null = null;
      let worst = 0;
      let last = 0;
      for (let k = 0; k <= 700; k++) {
        const target = eqW * (1 + k * 1e-3);
        const r = calibrateShelledItm(n, cut, table, 1000, target, 0.225, { top3: 0.0563, ft: 0.135 }, { id: "power-law" }, 0, target * cashCap);
        if (prev) for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(r.pmf[i] - prev[i]) * n);
        if (r.feasible) {
          expect(r.pmf[0]).toBeGreaterThanOrEqual(last);
          last = r.pmf[0];
        }
        prev = r.pmf;
      }
      expect(last * n).toBeGreaterThan(1);
      expect(worst).toBeLessThan(0.05);
    }
  });

  it("leaves a model with no α its own shape at every target", () => {
    // 4 runners on a 50/30/20 table, ITM 50% against the 75% the table pays:
    // Uniform puts 1/6 on each paid place, under the floor's 1/4 at and above
    // the no-skill winnings ($8 of a $32 pool). The floor's 1/4 lock pays
    // $6.00 of cash against the model's $5.33, and a model that never aims at
    // the target must not move with it.
    const table = getPayoutTable("sng-50-30-20", 4);
    for (const model of [{ id: "uniform" }, { id: "empirical" }] as FinishModelConfig[]) {
      const shape = calibrateShelledItm(4, 3, table, 32, 4, 0.5, undefined, model).pmf;
      expect(Array.from(shape)).toEqual([1 / 6, 1 / 6, 1 / 6, 0.5]);
      for (const target of [7.2, 7.6, 8, 9, 12, 20]) {
        const r = calibrateShelledItm(4, 3, table, 32, target, 0.5, undefined, model, 0, 2 * target);
        expect(Array.from(r.pmf)).toEqual(Array.from(shape));
        expect(r.currentWinnings).toBeCloseTo(32 / 6, 12);
        expect(r.feasible).toBe(true);
      }
      // Just under the table's 75 %, Uniform pays $7.9957, within the
      // tolerance of the no-skill $8 that asks for P(1st) = 1/4: the floor
      // would put 0.25 on first place where the model puts 0.2499.
      const nearPaid = calibrateShelledItm(4, 3, table, 32, 8, 0.7496, undefined, model);
      expect(nearPaid.pmf[0]).toBeCloseTo(0.7496 / 3, 15);
      expect(nearPaid.currentWinnings).toBeCloseTo(0.7496 / 3 * 32, 12);
    }
  });

  it("does not carry a row onto a target its model misses", () => {
    // 12 runners on mtt-flat (2 paid), ITM 15 %, tilt -1: at the bottom of its
    // α range the model pays $9.119978 with P(1st)·N 1.008, the least it can
    // pay. ROI -8.9 % asks $9.11, 1.1e-3 under it. The 1/N lock pays $9.1111,
    // and mixing it in would pull the row inside the tolerance and run a ROI
    // no pmf of the model pays.
    const n = 12;
    const table = getPayoutTable("mtt-flat", n);
    const cut = table.filter((x) => x > 0).length;
    const model: FinishModelConfig = { id: "power-law" };
    const least = calibrateShelledItm(n, cut, table, 120, 0, 0.15, undefined, model, -1);
    expect(least.currentWinnings).toBeCloseTo(9.119978, 6);
    const r = calibrateShelledItm(n, cut, table, 120, 9.11, 0.15, undefined, model, -1);
    expect(r.feasible).toBe(false);
    expect(Array.from(r.pmf)).toEqual(Array.from(least.pmf));
    const row = (roi: number): TournamentRow => ({
      id: "r", players: n, buyIn: 10, rake: 0, roi, payoutStructure: "mtt-flat", gameType: "freezeout",
      count: 1, itmRate: 0.15, itmTopHeavyBias: -1,
    });
    expect(validateSchedule([row(-0.089)], model).ok).toBe(false);
    expect(validateSchedule([row(-0.088)], model).ok).toBe(true);
  });

  it("leaves a cash side short of its target as the model shapes it, on a bounty row too", () => {
    // Linear skill at ITM 10 % on a 10-runner table paying 3 puts at most
    // 2 x 10 % / 3 on first place, under the floor's 1/10, and pays at most
    // $4.0733 of a $94 pool. A $12 target, past the no-skill $9.40 where the
    // floor asks for 1/10, is out of its reach, and the 1/N lock pays more
    // cash than any α. Lifted toward it, a bounty row's cash side would leave
    // a KO residual the pool covers at totals the model cannot reach; reshaped
    // at $4.0733, it would move the P(last) that sit-through leaves and with it
    // the pool's cap.
    const n = 10;
    const table = getPayoutTable("mtt-gg-bounty", n);
    const cut = table.filter((x) => x > 0).length;
    const model: FinishModelConfig = { id: "linear-skill" };
    const most = calibrateShelledItm(n, cut, table, 94, 5, 0.1, undefined, model);
    expect(most.pmf[0]).toBeCloseTo(0.2 / 3, 6);
    expect(most.currentWinnings).toBeCloseTo(4.0733, 4);
    for (const maxCash of [12, 13, 24]) {
      const r = calibrateShelledItm(n, cut, table, 94, 12, 0.1, undefined, model, 0, maxCash);
      expect(r.feasible).toBe(false);
      expect(Array.from(r.pmf)).toEqual(Array.from(most.pmf));
    }
  });
});
