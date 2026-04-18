import { describe, it, expect } from "vitest";
import {
  simulateCash,
  simulateCashShard,
  buildCashResult,
  makeCashEnvGrid,
  makeCashHiResGrid,
} from "./cashEngine";
import type { CashInput } from "./cashTypes";

function baseInput(overrides: Partial<CashInput> = {}): CashInput {
  return {
    type: "cash",
    wrBb100: 5,
    sdBb100: 100,
    hands: 10_000,
    nSimulations: 1000,
    bbSize: 1,
    rake: {
      enabled: false,
      contributedRakeBb100: 0,
      advertisedRbPct: 0,
      pvi: 1,
    },
    baseSeed: 42,
    ...overrides,
  };
}

describe("cashEngine — determinism contract", () => {
  it("same input + seed → byte-identical finalBb", () => {
    const a = simulateCash(baseInput());
    const b = simulateCash(baseInput());
    expect(a.samples).toBe(b.samples);
    expect(Array.from(a.finalBb)).toEqual(Array.from(b.finalBb));
  });

  it("different seeds → different trajectories", () => {
    const a = simulateCash(baseInput({ baseSeed: 1 }));
    const b = simulateCash(baseInput({ baseSeed: 2 }));
    expect(Array.from(a.finalBb)).not.toEqual(Array.from(b.finalBb));
  });

  it("sharding preserves determinism", () => {
    const input = baseInput({ nSimulations: 400 });
    const envGrid = makeCashEnvGrid(input.hands);
    const hiGrid = makeCashHiResGrid(input.hands);
    const monolith = simulateCashShard(
      input,
      0,
      input.nSimulations,
      envGrid,
      hiGrid,
    );
    const s1 = simulateCashShard(input, 0, 100, envGrid, hiGrid);
    const s2 = simulateCashShard(input, 100, 250, envGrid, hiGrid);
    const s3 = simulateCashShard(input, 250, 400, envGrid, hiGrid);
    const merged = buildCashResult(input, [s1, s2, s3], envGrid);
    const whole = buildCashResult(input, [monolith], envGrid);
    expect(Array.from(merged.finalBb)).toEqual(Array.from(whole.finalBb));
    expect(merged.stats.meanFinalBb).toBe(whole.stats.meanFinalBb);
  });
});

describe("cashEngine — analytical sanity", () => {
  it("E[finalBb] ≈ hands × wr / 100 (±4σ of sampling error)", () => {
    const input = baseInput({
      wrBb100: 5,
      sdBb100: 100,
      hands: 20_000,
      nSimulations: 1500,
    });
    const r = simulateCash(input);
    const expected = (input.hands * input.wrBb100) / 100;
    const sdFinal = (input.sdBb100 / 10) * Math.sqrt(input.hands);
    const se = sdFinal / Math.sqrt(input.nSimulations);
    expect(Math.abs(r.stats.meanFinalBb - expected)).toBeLessThan(4 * se);
  });

  it("SD[finalBb] ≈ (sd/10) × √hands", () => {
    const input = baseInput({
      wrBb100: 0,
      sdBb100: 100,
      hands: 20_000,
      nSimulations: 1500,
    });
    const r = simulateCash(input);
    const expectedSd = (input.sdBb100 / 10) * Math.sqrt(input.hands);
    const relErr = Math.abs(r.stats.sdFinalBb - expectedSd) / expectedSd;
    expect(relErr).toBeLessThan(0.08);
  });

  it("probLoss ≈ 0.5 when wr = 0 (symmetric random walk)", () => {
    const r = simulateCash(
      baseInput({ wrBb100: 0, sdBb100: 100, hands: 10_000, nSimulations: 2000 }),
    );
    expect(r.stats.probLoss).toBeGreaterThan(0.45);
    expect(r.stats.probLoss).toBeLessThan(0.55);
  });
});

describe("cashEngine — rakeback", () => {
  it("RB shifts mean EV by rakeback amount", () => {
    const noRb = simulateCash(
      baseInput({
        wrBb100: 0,
        sdBb100: 50,
        hands: 10_000,
        nSimulations: 1000,
      }),
    );
    const withRb = simulateCash(
      baseInput({
        wrBb100: 0,
        sdBb100: 50,
        hands: 10_000,
        nSimulations: 1000,
        rake: {
          enabled: true,
          contributedRakeBb100: 10,
          advertisedRbPct: 30,
          pvi: 1,
        },
      }),
    );
    // RB per 100 hands = 10 × 0.30 × 1 = 3 BB. Over 10k hands = 300 BB.
    const delta = withRb.stats.meanFinalBb - noRb.stats.meanFinalBb;
    expect(Math.abs(delta - 300)).toBeLessThan(1e-9);
  });

  it("PVI < 1 reduces RB proportionally", () => {
    const full = simulateCash(
      baseInput({
        wrBb100: 0,
        sdBb100: 50,
        hands: 10_000,
        nSimulations: 200,
        rake: {
          enabled: true,
          contributedRakeBb100: 10,
          advertisedRbPct: 30,
          pvi: 1,
        },
      }),
    );
    const pvi05 = simulateCash(
      baseInput({
        wrBb100: 0,
        sdBb100: 50,
        hands: 10_000,
        nSimulations: 200,
        rake: {
          enabled: true,
          contributedRakeBb100: 10,
          advertisedRbPct: 30,
          pvi: 0.5,
        },
      }),
    );
    // Trajectories should differ only by a constant drift — the underlying
    // noise is identical because the seed and nSimulations match.
    const deltaEnd =
      full.stats.meanFinalBb - pvi05.stats.meanFinalBb;
    expect(Math.abs(deltaEnd - 150)).toBeLessThan(1e-9);
    expect(full.stats.meanRbEarnedBb).toBeCloseTo(300);
    expect(pvi05.stats.meanRbEarnedBb).toBeCloseTo(150);
  });

  it("rake.enabled=false zeroes rake/RB totals regardless of PVI", () => {
    const r = simulateCash(
      baseInput({
        rake: {
          enabled: false,
          contributedRakeBb100: 10,
          advertisedRbPct: 30,
          pvi: 1,
        },
      }),
    );
    expect(r.stats.meanRakePaidBb).toBe(0);
    expect(r.stats.meanRbEarnedBb).toBe(0);
  });
});

describe("cashEngine — output shape", () => {
  it("exposes envelopes with p05/p95 bracketing the mean", () => {
    const r = simulateCash(
      baseInput({
        wrBb100: 0,
        sdBb100: 100,
        hands: 10_000,
        nSimulations: 1000,
      }),
    );
    const midJ = Math.floor(r.envelopes.x.length / 2);
    expect(r.envelopes.p05[midJ]).toBeLessThan(r.envelopes.mean[midJ]);
    expect(r.envelopes.mean[midJ]).toBeLessThan(r.envelopes.p95[midJ]);
    expect(r.envelopes.p025[midJ]).toBeLessThanOrEqual(r.envelopes.p05[midJ]);
    expect(r.envelopes.p95[midJ]).toBeLessThanOrEqual(r.envelopes.p975[midJ]);
    expect(r.envelopes.min[midJ]).toBeLessThanOrEqual(r.envelopes.p025[midJ]);
    expect(r.envelopes.max[midJ]).toBeGreaterThanOrEqual(r.envelopes.p975[midJ]);
  });

  it("histograms sum to sample count (or recovered-only subset)", () => {
    const r = simulateCash(baseInput({ nSimulations: 500 }));
    const finalCount = r.histogram.counts.reduce((a, b) => a + b, 0);
    expect(finalCount).toBe(r.samples);
    const ddCount = r.drawdownHistogram.counts.reduce((a, b) => a + b, 0);
    expect(ddCount).toBe(r.samples);
  });

  it("hourlyEvUsd reflects handsPerHour lens", () => {
    const r = simulateCash(
      baseInput({
        wrBb100: 5,
        hands: 10_000,
        nSimulations: 100,
        bbSize: 2,
        hoursBlock: { handsPerHour: 500 },
      }),
    );
    // wr 5 bb/100, bb=$2 → $0.10/hand → $50/hour at 500 hands/hour.
    expect(r.stats.hourlyEvUsd).toBeCloseTo(50, 6);
  });
});
