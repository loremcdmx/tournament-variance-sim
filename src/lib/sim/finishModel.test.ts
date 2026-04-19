import { describe, it, expect } from "vitest";
import {
  buildFinishPMF,
  expectedWinnings,
  calibrateAlpha,
  calibrateBountyBudget,
  calibrateShelledItm,
  buildCDF,
  sampleFromCDF,
  buildBinaryItmAssets,
  itmProbability,
  isAlphaAdjustable,
  applyBountyBias,
} from "./finishModel";
import { getPayoutTable } from "./payouts";
import type { FinishModelConfig } from "./types";

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

describe("calibrateBountyBudget", () => {
  const N = 500;
  const cost = 22;
  const pool = N * 20;
  const payouts = getPayoutTable("mtt-standard", N);

  it("closes the ROI contract when added back to cash EV", () => {
    const pmf = buildFinishPMF(N, { id: "power-law" }, 1.2);
    const target = cost * (1 + 0.3);
    const r = calibrateBountyBudget(pmf, payouts, pool, target);
    expect(r.cashEV + r.bountyMean).toBeCloseTo(target, 9);
  });

  it("reports feasible when cash EV is below target", () => {
    // Uniform pmf against a skill-like ROI → cashEV ≪ target.
    const pmf = buildFinishPMF(N, { id: "uniform" }, 0);
    const target = cost * (1 + 0.5);
    const r = calibrateBountyBudget(pmf, payouts, pool, target);
    expect(r.feasible).toBe(true);
    expect(r.bountyMean).toBeGreaterThan(0);
  });

  it("reports infeasible when cash EV overshoots target", () => {
    // Highly concentrated pmf beats a near-zero target.
    const pmf = buildFinishPMF(N, { id: "power-law" }, 5);
    const r = calibrateBountyBudget(pmf, payouts, pool, 0);
    expect(r.feasible).toBe(false);
    expect(r.bountyMean).toBeLessThan(0);
  });

  it("bountyMean is monotone decreasing in cash EV for fixed target", () => {
    const target = cost * (1 + 0.2);
    const pmfFlat = buildFinishPMF(N, { id: "power-law" }, 0.2);
    const pmfSteep = buildFinishPMF(N, { id: "power-law" }, 2);
    const flat = calibrateBountyBudget(pmfFlat, payouts, pool, target);
    const steep = calibrateBountyBudget(pmfSteep, payouts, pool, target);
    expect(steep.cashEV).toBeGreaterThan(flat.cashEV);
    expect(steep.bountyMean).toBeLessThan(flat.bountyMean);
  });

  it("cashEV equals direct expectedWinnings", () => {
    const pmf = buildFinishPMF(N, { id: "power-law" }, 1);
    const r = calibrateBountyBudget(pmf, payouts, pool, 0);
    expect(r.cashEV).toBeCloseTo(expectedWinnings(pmf, payouts, pool), 9);
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

// Keep dummy import alive for tooling
void expectedWinnings;

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
