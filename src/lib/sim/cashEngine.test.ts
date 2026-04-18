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

describe("cashEngine — mix of stakes", () => {
  it("single-row stakes array matches legacy single-stake input byte-for-byte", () => {
    const legacy = simulateCash(baseInput({ hands: 5_000, nSimulations: 300 }));
    const mixed = simulateCash(
      baseInput({
        hands: 5_000,
        nSimulations: 300,
        stakes: [
          {
            wrBb100: 5,
            sdBb100: 100,
            bbSize: 1,
            handShare: 1,
            rake: { enabled: false, contributedRakeBb100: 0, advertisedRbPct: 0, pvi: 1 },
          },
        ],
      }),
    );
    expect(Array.from(mixed.finalBb)).toEqual(Array.from(legacy.finalBb));
  });

  it("two-row mix: expectedEvBb equals share-weighted sum of per-row EV", () => {
    // Row A: wr 10 bb/100, bb=$1 (ref), 50% share → 10 × 0.5 = 5 bb ref per 100 hands
    // Row B: wr 0 bb/100, bb=$2, 50% share → 0 × (2/1) × 0.5 = 0 bb ref per 100 hands
    // Combined: 2.5 bb ref per 100 hands × 10_000 = 250 bb ref total.
    const r = simulateCash(
      baseInput({
        hands: 10_000,
        nSimulations: 500,
        bbSize: 1,
        stakes: [
          {
            wrBb100: 10,
            sdBb100: 80,
            bbSize: 1,
            handShare: 0.5,
            rake: { enabled: false, contributedRakeBb100: 0, advertisedRbPct: 0, pvi: 1 },
          },
          {
            wrBb100: 0,
            sdBb100: 80,
            bbSize: 2,
            handShare: 0.5,
            rake: { enabled: false, contributedRakeBb100: 0, advertisedRbPct: 0, pvi: 1 },
          },
        ],
      }),
    );
    expect(r.stats.expectedEvBb).toBeCloseTo(500, 6);
    // Realized mean's SE ≈ √(5000·64 + 5000·256)/√500 ≈ 57 bb, so 3σ ≈ ±170.
    expect(r.stats.meanFinalBb).toBeGreaterThan(300);
    expect(r.stats.meanFinalBb).toBeLessThan(700);
  });

  it("mix rake: total rake paid aggregates across rows in ref-bb", () => {
    // Row A: rake 10 bb/100 × 5000 hands × bbSize=1 → 500 bb ref.
    // Row B: rake 5 bb/100 × 5000 hands × bbSize=2 → 500 × (2/1) = 500 bb ref.
    // Total: 1000 bb ref.
    const r = simulateCash(
      baseInput({
        hands: 10_000,
        nSimulations: 200,
        bbSize: 1,
        stakes: [
          {
            wrBb100: 5,
            sdBb100: 80,
            bbSize: 1,
            handShare: 0.5,
            rake: { enabled: true, contributedRakeBb100: 10, advertisedRbPct: 0, pvi: 1 },
          },
          {
            wrBb100: 5,
            sdBb100: 80,
            bbSize: 2,
            handShare: 0.5,
            rake: { enabled: true, contributedRakeBb100: 5, advertisedRbPct: 0, pvi: 1 },
          },
        ],
      }),
    );
    expect(r.stats.meanRakePaidBb).toBeCloseTo(1000, 6);
  });

  it("mix determinism: same input+seed → byte-identical", () => {
    const mk = () =>
      simulateCash(
        baseInput({
          hands: 4_000,
          nSimulations: 200,
          stakes: [
            { wrBb100: 3, sdBb100: 90, bbSize: 1, handShare: 0.3, rake: { enabled: false, contributedRakeBb100: 0, advertisedRbPct: 0, pvi: 1 } },
            { wrBb100: 6, sdBb100: 110, bbSize: 2, handShare: 0.7, rake: { enabled: true, contributedRakeBb100: 8, advertisedRbPct: 25, pvi: 0.8 } },
          ],
        }),
      );
    const a = mk();
    const b = mk();
    expect(Array.from(a.finalBb)).toEqual(Array.from(b.finalBb));
  });

  it("mix handShares normalize when they don't sum to 1", () => {
    // Shares 2 + 2 → each 50%.
    const r = simulateCash(
      baseInput({
        hands: 4_000,
        nSimulations: 200,
        bbSize: 1,
        stakes: [
          { wrBb100: 10, sdBb100: 80, bbSize: 1, handShare: 2, rake: { enabled: false, contributedRakeBb100: 0, advertisedRbPct: 0, pvi: 1 } },
          { wrBb100: 0, sdBb100: 80, bbSize: 1, handShare: 2, rake: { enabled: false, contributedRakeBb100: 0, advertisedRbPct: 0, pvi: 1 } },
        ],
      }),
    );
    // 50% × 10 + 50% × 0 = 5 bb/100 → 200 bb over 4000 hands.
    expect(r.stats.expectedEvBb).toBeCloseTo(200, 6);
  });
});
