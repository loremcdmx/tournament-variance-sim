import { describe, it, expect } from "vitest";
import {
  buildFinishPMF,
  expectedWinnings,
  calibrateAlpha,
  buildCDF,
  sampleFromCDF,
  buildUniformLiftPMF,
  itmProbability,
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

describe("buildUniformLiftPMF (PrimeDope-compat)", () => {
  it("zero-edge case yields flat 1/N over the whole field", () => {
    const N = 500;
    const pool = N * 10; // no rake, no overlay — zero-edge target = pool/N
    const target = pool / N;
    const pmf = buildUniformLiftPMF(N, 75, target, pool);
    for (let i = 0; i < N; i++) {
      expect(pmf[i]).toBeCloseTo(1 / N, 10);
    }
  });

  it("realized EW matches targetWinnings within tolerance for sensible ROI", () => {
    const N = 500;
    const paid = 75;
    const pool = N * 10;
    // Build a typical payout curve summing to 1
    const payouts = new Array(paid).fill(0).map((_, i) => Math.pow(1.35, -i));
    const s = payouts.reduce((a, b) => a + b, 0);
    for (let i = 0; i < paid; i++) payouts[i] /= s;

    for (const targetROI of [-0.3, -0.1, 0, 0.1, 0.25, 0.5, 1.0]) {
      const cost = 11;
      const target = cost * (1 + targetROI);
      const pmf = buildUniformLiftPMF(N, paid, target, pool);
      const ew = expectedWinnings(pmf, payouts, pool);
      expect(Math.abs(ew - target)).toBeLessThan(0.001);
    }
  });

  it("all paid places get the exact same probability (no top-heavy bias)", () => {
    const N = 300;
    const paid = 45;
    const pool = 3000;
    const pmf = buildUniformLiftPMF(N, paid, 13.2, pool); // 20% ROI over $11
    const first = pmf[0];
    for (let i = 0; i < paid; i++) expect(pmf[i]).toBeCloseTo(first, 10);
    // All unpaid places also equal to each other
    const unpaidProb = pmf[paid];
    for (let i = paid; i < N; i++) expect(pmf[i]).toBeCloseTo(unpaidProb, 10);
    // Paid > unpaid (because ROI > 0)
    expect(first).toBeGreaterThan(unpaidProb);
  });

  it("inflates ITM rate relative to zero-edge baseline", () => {
    const N = 500;
    const paid = 75;
    const baselineITM = paid / N; // 0.15
    const pool = 5000;
    const pmf = buildUniformLiftPMF(N, paid, 12, pool); // 20% ROI over $10
    const itm = itmProbability(pmf, paid);
    expect(itm).toBeGreaterThan(baselineITM);
    expect(itm).toBeCloseTo(baselineITM * 1.2, 3); // ITM inflated by ~ROI lift
  });

  it("clamps gracefully when target is unreachable", () => {
    const N = 100;
    const paid = 15;
    const pool = 1000;
    const pmf = buildUniformLiftPMF(N, paid, 50, pool); // absurd target
    // Still a valid distribution — sums to 1 and non-negative
    let s = 0;
    for (let i = 0; i < N; i++) {
      expect(pmf[i]).toBeGreaterThanOrEqual(0);
      s += pmf[i];
    }
    expect(s).toBeCloseTo(1, 10);
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
