import { describe, it, expect } from "vitest";
import {
  buildFinishPMF,
  expectedWinnings,
  calibrateAlpha,
  buildCDF,
  sampleFromCDF,
  buildBinaryItmAssets,
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

describe("buildBinaryItmAssets (PrimeDope-compat)", () => {
  it("pmf is uniform 1/N over the whole field", () => {
    const { pmf } = buildBinaryItmAssets(500, 75, 12);
    for (let i = 0; i < 500; i++) expect(pmf[i]).toBeCloseTo(1 / 500, 12);
  });

  it("ITM equals the natural paidCount/N (no skill lift on cashing rate)", () => {
    const { pmf } = buildBinaryItmAssets(500, 75, 12);
    expect(itmProbability(pmf, 75)).toBeCloseTo(75 / 500, 10);
  });

  it("every paid place gets the same flat avgCash, every unpaid gets 0", () => {
    const { prizeByPlace } = buildBinaryItmAssets(300, 45, 13.2);
    const expected = (13.2 * 300) / 45;
    for (let i = 0; i < 45; i++) expect(prizeByPlace[i]).toBeCloseTo(expected, 8);
    for (let i = 45; i < 300; i++) expect(prizeByPlace[i]).toBe(0);
  });

  it("realized expected winnings match targetWinnings exactly", () => {
    for (const target of [5, 11, 12, 13.2, 50, 200]) {
      const { pmf, prizeByPlace } = buildBinaryItmAssets(500, 75, target);
      let ew = 0;
      for (let i = 0; i < 500; i++) ew += pmf[i] * prizeByPlace[i];
      expect(ew).toBeCloseTo(target, 6);
    }
  });

  it("collapsing payouts to a flat avgCash strictly reduces per-tourney variance", () => {
    // Compare variance of per-tourney winnings under binary-itm vs the
    // top-heavy real payout curve at the same target.
    const N = 500;
    const paid = 75;
    const target = 12;
    const { pmf, prizeByPlace } = buildBinaryItmAssets(N, paid, target);
    let varBinary = 0;
    for (let i = 0; i < N; i++) varBinary += pmf[i] * (prizeByPlace[i] - target) ** 2;

    const realPayouts = new Array(paid).fill(0).map((_, i) => Math.pow(1.45, -i));
    const sum = realPayouts.reduce((a, b) => a + b, 0);
    for (let i = 0; i < paid; i++) realPayouts[i] /= sum;
    const pool = (target * N) / 1; // scale pool so EW equals target under uniform 1/N
    let varReal = 0;
    for (let i = 0; i < paid; i++) {
      const prize = realPayouts[i] * pool;
      varReal += (1 / N) * (prize - target) ** 2;
    }
    varReal += ((N - paid) / N) * target * target;
    expect(varBinary).toBeLessThan(varReal);
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
