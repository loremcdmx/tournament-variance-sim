import { describe, it, expect } from "vitest";
import {
  simulateCash,
  simulateCashShard,
  buildCashResult,
  makeCashEnvGrid,
  makeCashHiResGrid,
} from "./cashEngine";
import { normalizeCashInput, serializeCashInput } from "./cashInput";
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

  it("sharding preserves the hi-res sample-path union instead of truncating to shard 0", () => {
    const input = baseInput({ hands: 1_000, nSimulations: 100 });
    const envGrid = makeCashEnvGrid(input.hands);
    const hiGrid = makeCashHiResGrid(input.hands);
    const monolith = simulateCash(input);
    const s1 = simulateCashShard(input, 0, 9, envGrid, hiGrid);
    const s2 = simulateCashShard(input, 9, 30, envGrid, hiGrid);
    const s3 = simulateCashShard(input, 30, 100, envGrid, hiGrid);
    const merged = buildCashResult(input, [s1, s2, s3], envGrid);

    expect(merged.samplePaths.paths).toHaveLength(monolith.samplePaths.paths.length);
    expect(merged.samplePaths.sampleIndices).toEqual(monolith.samplePaths.sampleIndices);
    expect(merged.samplePaths.sampleIndices.at(-1)).toBe(99);
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
  it("keeps summary stats finite for absurd persisted rake and hourly inputs", () => {
    const r = simulateCash(
      baseInput({
        wrBb100: 1000,
        sdBb100: 100,
        hands: 1000,
        nSimulations: 100,
        bbSize: 1_000_000,
        rake: {
          enabled: true,
          contributedRakeBb100: 1e308,
          advertisedRbPct: 100,
          pvi: 1,
        },
        hoursBlock: { handsPerHour: 1e308 },
      }),
    );

    expect(
      [
        r.stats.expectedEvBb,
        r.stats.meanFinalBb,
        r.stats.meanRakePaidBb,
        r.stats.meanRbEarnedBb,
        r.stats.hourlyEvUsd,
      ].every((value) => Number.isFinite(value ?? 0)),
    ).toBe(true);
  });

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

  it("exposes useful summary quantiles for deterministic paths", () => {
    const r = simulateCash(
      baseInput({
        wrBb100: 100,
        sdBb100: 0,
        hands: 5,
        nSimulations: 8,
      }),
    );

    expect(r.stats.finalBbMedian).toBeCloseTo(5, 9);
    expect(r.stats.finalBbP05).toBeCloseTo(5, 9);
    expect(r.stats.finalBbP95).toBeCloseTo(5, 9);
    expect(r.stats.maxDrawdownMedian).toBeCloseTo(0, 9);
    expect(r.stats.maxDrawdownP95).toBeCloseTo(0, 9);
    expect(r.stats.longestBreakevenMedian).toBeCloseTo(0, 9);
    expect(r.stats.recoveryMedian).toBeCloseTo(0, 9);
    expect(r.stats.recoveryP90).toBeCloseTo(0, 9);
    expect(r.stats.probProfit).toBeCloseTo(1, 9);
    expect(r.stats.probLoss).toBeCloseTo(0, 9);
  });

  it("tracks user-facing odds over distance on the envelope checkpoints", () => {
    const r = simulateCash(
      baseInput({
        wrBb100: 5,
        sdBb100: 100,
        hands: 5_000,
        nSimulations: 256,
        riskBlock: { thresholdBb: 120 },
      }),
    );

    expect(r.oddsOverDistance.x[0]).toBe(0);
    expect(r.oddsOverDistance.thresholdBb).toBe(120);
    expect(r.oddsOverDistance.profitShare[0]).toBeCloseTo(0, 9);
    expect(r.oddsOverDistance.belowThresholdNowShare[0]).toBeCloseTo(0, 9);

    const last = r.oddsOverDistance.profitShare.length - 1;
    const finalBelowThresholdNow =
      Array.from(r.finalBb).filter((v) => v <= -120).length / r.samples;

    expect(r.oddsOverDistance.profitShare[last]).toBeCloseTo(
      r.stats.probProfit,
      12,
    );
    expect(r.oddsOverDistance.belowThresholdNowShare[last]).toBeCloseTo(
      finalBelowThresholdNow,
      12,
    );
  });

  it("risk threshold tracks path minimum, not just the final bankroll", () => {
    const r = simulateCash(
      baseInput({
        hands: 200,
        nSimulations: 1,
        bbSize: 1,
        riskBlock: { thresholdBb: 150 },
        stakes: [
          {
            wrBb100: -200,
            sdBb100: 0,
            bbSize: 1,
            handShare: 0.5,
            rake: { enabled: false, contributedRakeBb100: 0, advertisedRbPct: 0, pvi: 1 },
          },
          {
            wrBb100: 200,
            sdBb100: 0,
            bbSize: 1,
            handShare: 0.5,
            rake: { enabled: false, contributedRakeBb100: 0, advertisedRbPct: 0, pvi: 1 },
          },
        ],
      }),
    );
    expect(r.stats.meanFinalBb).toBeCloseTo(0, 9);
    expect(r.stats.probBelowThresholdEver).toBe(1);
    expect(r.oddsOverDistance.belowThresholdNowShare.at(-1)).toBe(0);
  });

  it("risk threshold actually changes the tracked danger line", () => {
    const safe = simulateCash(
      baseInput({
        hands: 200,
        nSimulations: 1,
        bbSize: 1,
        riskBlock: { thresholdBb: 250 },
        stakes: [
          {
            wrBb100: -200,
            sdBb100: 0,
            bbSize: 1,
            handShare: 0.5,
            rake: { enabled: false, contributedRakeBb100: 0, advertisedRbPct: 0, pvi: 1 },
          },
          {
            wrBb100: 200,
            sdBb100: 0,
            bbSize: 1,
            handShare: 0.5,
            rake: { enabled: false, contributedRakeBb100: 0, advertisedRbPct: 0, pvi: 1 },
          },
        ],
      }),
    );

    expect(safe.stats.probBelowThresholdEver).toBe(0);
    expect(safe.oddsOverDistance.belowThresholdNowShare.at(-1)).toBe(0);
  });

  it("longest breakeven counts only hands spent below the previous peak", () => {
    const up = simulateCash(
      baseInput({
        wrBb100: 100,
        sdBb100: 0,
        hands: 5,
        nSimulations: 1,
      }),
    );
    const flat = simulateCash(
      baseInput({
        wrBb100: 0,
        sdBb100: 0,
        hands: 5,
        nSimulations: 1,
      }),
    );
    const down = simulateCash(
      baseInput({
        wrBb100: -100,
        sdBb100: 0,
        hands: 5,
        nSimulations: 1,
      }),
    );

    expect(
      up.longestBreakevenHistogram.counts.reduce((a, b) => a + b, 0),
    ).toBe(0);
    expect(
      flat.longestBreakevenHistogram.counts.reduce((a, b) => a + b, 0),
    ).toBe(0);
    expect(down.longestBreakevenHistogram.binEdges.at(-1)).toBe(5);
    expect(down.longestBreakevenHistogram.counts.at(-1)).toBe(1);
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
    // Combined: 5 bb ref per 100 hands × 10_000 = 500 bb ref total.
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

  it("interleaves stake rows instead of creating one giant regime switch", () => {
    const r = simulateCash(
      baseInput({
        hands: 1_000,
        nSimulations: 1,
        bbSize: 1,
        stakes: [
          {
            wrBb100: 10,
            sdBb100: 0,
            bbSize: 1,
            handShare: 0.5,
            rake: { enabled: false, contributedRakeBb100: 0, advertisedRbPct: 0, pvi: 1 },
          },
          {
            wrBb100: -10,
            sdBb100: 0,
            bbSize: 1,
            handShare: 0.5,
            rake: { enabled: false, contributedRakeBb100: 0, advertisedRbPct: 0, pvi: 1 },
          },
        ],
      }),
    );
    const path = r.samplePaths.paths[0];
    let peak = path[0] ?? 0;
    let maxDd = 0;
    for (const v of path) {
      if (v > peak) peak = v;
      const dd = peak - v;
      if (dd > maxDd) maxDd = dd;
    }
    expect(maxDd).toBeLessThanOrEqual(10.000001);
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

  it("all-zero hand shares fall back to an equal split instead of row-0 takeover", () => {
    const r = simulateCash(
      baseInput({
        hands: 100,
        nSimulations: 1,
        stakes: [
          {
            wrBb100: 100,
            sdBb100: 0,
            bbSize: 1,
            handShare: 0,
            rake: { enabled: false, contributedRakeBb100: 0, advertisedRbPct: 0, pvi: 1 },
          },
          {
            wrBb100: 0,
            sdBb100: 0,
            bbSize: 1,
            handShare: 0,
            rake: { enabled: false, contributedRakeBb100: 0, advertisedRbPct: 0, pvi: 1 },
          },
        ],
      }),
    );

    expect(r.stats.expectedEvBb).toBeCloseTo(50, 9);
    expect(r.stats.meanFinalBb).toBeCloseTo(50, 9);
  });

  it("allocates row hand budgets exactly even when rows outnumber hands", () => {
    const r = simulateCash(
      baseInput({
        hands: 3,
        nSimulations: 1,
        stakes: [1, 2, 3, 4, 5].map((wr) => ({
          wrBb100: wr * 100,
          sdBb100: 0,
          bbSize: 1,
          handShare: 1,
          rake: {
            enabled: false,
            contributedRakeBb100: 0,
            advertisedRbPct: 0,
            pvi: 1,
          },
        })),
      }),
    );

    expect(r.stats.expectedEvBb).toBeCloseTo(r.stats.meanFinalBb, 9);
  });

  it("mix rake totals follow the exact allocated hand budget", () => {
    const r = simulateCash(
      baseInput({
        hands: 3,
        nSimulations: 1,
        stakes: Array.from({ length: 5 }, () => ({
          wrBb100: 0,
          sdBb100: 0,
          bbSize: 1,
          handShare: 1,
          rake: {
            enabled: true,
            contributedRakeBb100: 100,
            advertisedRbPct: 50,
            pvi: 1,
          },
        })),
      }),
    );

    expect(r.stats.meanRakePaidBb).toBeCloseTo(3, 9);
    expect(r.stats.meanRbEarnedBb).toBeCloseTo(1.5, 9);
  });

  it("emits a row-level mix breakdown from the exact compiled hand budget", () => {
    const r = simulateCash(
      baseInput({
        hands: 400,
        nSimulations: 1,
        bbSize: 1,
        stakes: [
          {
            label: "Reg tables",
            wrBb100: 10,
            sdBb100: 50,
            bbSize: 1,
            handShare: 0.5,
            rake: {
              enabled: true,
              contributedRakeBb100: 10,
              advertisedRbPct: 50,
              pvi: 1,
            },
          },
          {
            label: "Shot",
            wrBb100: 0,
            sdBb100: 100,
            bbSize: 1,
            handShare: 0.5,
            rake: {
              enabled: true,
              contributedRakeBb100: 30,
              advertisedRbPct: 50,
              pvi: 1,
            },
          },
        ],
      }),
    );

    expect(r.mixBreakdown?.rows).toHaveLength(2);
    expect(r.mixBreakdown?.rows[0]).toMatchObject({
      label: "Reg tables",
      hands: 200,
      handShare: 0.5,
      varianceShare: 0.2,
      rakePaidBb: 20,
      rakeShare: 0.25,
      rbEarnedBb: 10,
      rbShare: 0.25,
    });
    expect(r.mixBreakdown?.rows[1]).toMatchObject({
      label: "Shot",
      hands: 200,
      handShare: 0.5,
      varianceShare: 0.8,
      rakePaidBb: 60,
      rakeShare: 0.75,
      rbEarnedBb: 30,
      rbShare: 0.75,
    });
    expect(r.mixBreakdown?.rows[0]?.expectedEvBb).toBeCloseTo(30, 9);
    expect(r.mixBreakdown?.rows[1]?.expectedEvBb).toBeCloseTo(30, 9);
    expect(r.mixBreakdown?.totalVarianceBb2).toBeCloseTo(25_000, 9);
  });
});

describe("cashInput normalization", () => {
  it("keeps an explicit hourly toggle-off instead of silently restoring the default lens", () => {
    const normalized = normalizeCashInput({
      ...baseInput(),
      hoursBlock: undefined,
    });

    expect(normalized.hoursBlock).toBeUndefined();
  });

  it("round-trips a disabled hourly lens through persisted JSON", () => {
    const saved = JSON.stringify(
      serializeCashInput(baseInput({ hoursBlock: undefined })),
    );
    const hydrated = normalizeCashInput(JSON.parse(saved));

    expect(hydrated.hoursBlock).toBeUndefined();
  });

  it("deep-merges partial persisted cash input without dropping nested defaults", () => {
    const hydrated = normalizeCashInput({
      rake: { enabled: true },
      hoursBlock: {},
      riskBlock: {},
      stakes: [{ rake: { enabled: true } }],
    });

    expect(hydrated.rake).toMatchObject({
      enabled: true,
      contributedRakeBb100: 8,
      advertisedRbPct: 30,
      pvi: 1,
    });
    expect(hydrated.hoursBlock?.handsPerHour).toBe(500);
    expect(hydrated.riskBlock?.thresholdBb).toBe(100);
    expect(hydrated.stakes?.[0]).toMatchObject({
      wrBb100: 5,
      sdBb100: 100,
      bbSize: 1,
      handShare: 1,
    });
    expect(hydrated.stakes?.[0]?.rake).toMatchObject({
      enabled: true,
      contributedRakeBb100: 8,
      advertisedRbPct: 30,
      pvi: 1,
    });
  });

  it("clamps crashy cash inputs back into a finite engine contract", () => {
    const normalized = normalizeCashInput({
      hands: 0,
      nSimulations: 0,
      sdBb100: -10,
      bbSize: 0,
      rake: {
        enabled: true,
        contributedRakeBb100: -5,
        advertisedRbPct: 500,
        pvi: 0,
      },
      hoursBlock: { handsPerHour: 0 },
      riskBlock: { thresholdBb: 0 },
      stakes: [
        {
          wrBb100: 10,
          sdBb100: -1,
          bbSize: -1,
          handShare: -5,
          rake: {
            enabled: true,
            contributedRakeBb100: -1,
            advertisedRbPct: 999,
            pvi: 0,
          },
        },
      ],
    });

    expect(normalized.hands).toBe(1);
    expect(normalized.nSimulations).toBe(1);
    expect(normalized.sdBb100).toBe(0);
    expect(normalized.bbSize).toBe(0.01);
    expect(normalized.rake).toMatchObject({
      contributedRakeBb100: 0,
      advertisedRbPct: 100,
      pvi: 0.05,
    });
    expect(normalized.hoursBlock?.handsPerHour).toBe(1);
    expect(normalized.riskBlock?.thresholdBb).toBe(1);
    expect(normalized.stakes?.[0]).toMatchObject({
      sdBb100: 0,
      bbSize: 0.01,
      handShare: 1,
    });
  });
});
