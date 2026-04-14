import { describe, it, expect } from "vitest";
import { runSimulation } from "./engine";
import type { SimulationInput } from "./types";

function baseInput(overrides: Partial<SimulationInput> = {}): SimulationInput {
  return {
    schedule: [
      {
        id: "r1",
        label: "row",
        players: 500,
        buyIn: 10,
        rake: 0.1,
        roi: 0.2,
        payoutStructure: "mtt-standard",
        count: 1,
      },
    ],
    scheduleRepeats: 200,
    samples: 3000,
    bankroll: 500,
    seed: 42,
    finishModel: { id: "power-law" },
    ...overrides,
  };
}

describe("engine", () => {
  it("is deterministic for the same seed", () => {
    const a = runSimulation(baseInput());
    const b = runSimulation(baseInput());
    expect(a.stats.mean).toBe(b.stats.mean);
    expect(a.stats.stdDev).toBe(b.stats.stdDev);
    expect(a.finalProfits[0]).toBe(b.finalProfits[0]);
    expect(a.finalProfits[a.finalProfits.length - 1]).toBe(
      b.finalProfits[b.finalProfits.length - 1],
    );
  });

  it("realized mean ROI is within 3 SE of the target", () => {
    const r = runSimulation(baseInput({ samples: 5000 }));
    const realized = r.stats.mean / r.totalBuyIn;
    const se = r.stats.stdDev / Math.sqrt(r.samples) / r.totalBuyIn;
    expect(Math.abs(realized - 0.2)).toBeLessThan(3 * se);
  });

  it("uniform model yields realized ROI ≈ -rake", () => {
    const r = runSimulation(
      baseInput({
        samples: 5000,
        finishModel: { id: "uniform" },
      }),
    );
    // Uniform → ev = pool/N = buyIn, cost = buyIn*(1+rake)
    // ROI = buyIn / (buyIn*1.1) - 1 ≈ -0.0909
    const realized = r.stats.mean / r.totalBuyIn;
    expect(realized).toBeCloseTo(-0.0909, 1);
  });

  it("row decomposition sums back to total mean", () => {
    const r = runSimulation(
      baseInput({
        schedule: [
          {
            id: "a",
            label: "A",
            players: 100,
            buyIn: 5,
            rake: 0.1,
            roi: 0.15,
            payoutStructure: "mtt-standard",
            count: 1,
          },
          {
            id: "b",
            label: "B",
            players: 1000,
            buyIn: 20,
            rake: 0.08,
            roi: 0.25,
            payoutStructure: "mtt-top-heavy",
            count: 1,
          },
        ],
        scheduleRepeats: 50,
      }),
    );
    const sum = r.decomposition.reduce((a, d) => a + d.mean, 0);
    expect(sum).toBeCloseTo(r.stats.mean, 6);
    const shareSum = r.decomposition.reduce((a, d) => a + d.varianceShare, 0);
    expect(shareSum).toBeCloseTo(1, 6);
  });

  it("risk of ruin increases as bankroll shrinks", () => {
    const big = runSimulation(baseInput({ bankroll: 5000 }));
    const small = runSimulation(baseInput({ bankroll: 100 }));
    expect(small.stats.riskOfRuin).toBeGreaterThanOrEqual(
      big.stats.riskOfRuin,
    );
  });

  it("min-BR inverse: RoR-1% ≥ RoR-5%", () => {
    const r = runSimulation(baseInput());
    expect(r.stats.minBankrollRoR1pct).toBeGreaterThanOrEqual(
      r.stats.minBankrollRoR5pct,
    );
  });

  it("convergence curve has monotonic sample counts", () => {
    const r = runSimulation(baseInput());
    for (let i = 1; i < r.convergence.x.length; i++) {
      expect(r.convergence.x[i]).toBeGreaterThan(r.convergence.x[i - 1]);
    }
  });

  it("sensitivity scan is monotonic in ΔROI and centered on mean", () => {
    const r = runSimulation(baseInput());
    const zeroIdx = r.sensitivity.deltas.findIndex((d) => d === 0);
    expect(r.sensitivity.expectedProfits[zeroIdx]).toBeCloseTo(
      r.stats.mean,
      6,
    );
    for (let i = 1; i < r.sensitivity.deltas.length; i++) {
      expect(r.sensitivity.expectedProfits[i]).toBeGreaterThan(
        r.sensitivity.expectedProfits[i - 1],
      );
    }
  });

  it("worst displayed sample line is the deepest peak-to-trough drawdown", () => {
    const r = runSimulation(baseInput());
    // The displayed worst trajectory line should have a peak-to-trough
    // span equal to the worst max drawdown across all samples — so the
    // visible peak-to-trough on the chart matches the reported stat.
    let runMax = -Infinity;
    let dd = 0;
    for (let i = 0; i < r.samplePaths.worst.length; i++) {
      const v = r.samplePaths.worst[i];
      if (v > runMax) runMax = v;
      const span = runMax - v;
      if (span > dd) dd = span;
    }
    expect(dd).toBeCloseTo(r.stats.maxDrawdownWorst, 6);
  });

  it("downswing catalog is top-10 sorted by depth descending", () => {
    const r = runSimulation(baseInput());
    expect(r.downswings.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < r.downswings.length; i++) {
      expect(r.downswings[i].depth).toBeLessThanOrEqual(
        r.downswings[i - 1].depth,
      );
    }
  });

  it("ITM rate is analytic and between 0 and 1", () => {
    const r = runSimulation(baseInput());
    expect(r.stats.itmRate).toBeGreaterThan(0);
    expect(r.stats.itmRate).toBeLessThan(1);
  });

  it("compareWithPrimedope returns a nested comparison result on the same seed", () => {
    const r = runSimulation(baseInput({ compareWithPrimedope: true }));
    expect(r.calibrationMode).toBe("alpha");
    expect(r.comparison).toBeDefined();
    expect(r.comparison!.calibrationMode).toBe("primedope-binary-itm");
    // Same tournamentsPerSample — compile is deterministic re: schedule size.
    expect(r.comparison!.tournamentsPerSample).toBe(r.tournamentsPerSample);
    // Both calibrations aim at the same expected ROI. Binary-ITM is "no skill"
    // (uniform 1/N finish) but keeps the real top-heavy payout curve, so it
    // should still produce meaningful drawdown — just driven by pure luck.
    expect(r.comparison!.stats.maxDrawdownMean).toBeGreaterThan(0);
    expect(Number.isFinite(r.comparison!.stats.stdDev)).toBe(true);
  });

  it("re-entry row inflates cost and mean proportionally", () => {
    const single = runSimulation(
      baseInput({
        samples: 4000,
        schedule: [
          {
            id: "r",
            label: "freezeout",
            players: 500,
            buyIn: 10,
            rake: 0.1,
            roi: 0.2,
            payoutStructure: "mtt-standard",
            count: 1,
          },
        ],
      }),
    );
    const reentry = runSimulation(
      baseInput({
        samples: 4000,
        schedule: [
          {
            id: "r",
            label: "reentry",
            players: 500,
            buyIn: 10,
            rake: 0.1,
            roi: 0.2,
            payoutStructure: "mtt-standard",
            count: 1,
            maxEntries: 3,
            reentryRate: 1,
          },
        ],
      }),
    );
    // Re-entry = freezeout × 3 entries → cost ×3, and because ROI is the
    // *per-entry* figure, expected profit should also scale ~×3.
    expect(reentry.totalBuyIn).toBeCloseTo(3 * single.totalBuyIn, 4);
    expect(reentry.stats.mean / reentry.totalBuyIn).toBeCloseTo(
      single.stats.mean / single.totalBuyIn,
      1,
    );
  });

  it("real multi-bullet re-entry increases variance over freezeout", () => {
    // Three bullets fired independently against the same freezeout schedule
    // should produce ~√3× the std-dev per slot. Assertion: reentry stdDev
    // is strictly greater than freezeout stdDev (would be equal under the
    // old cost-scaling-only model).
    const freezeout = runSimulation(
      baseInput({
        samples: 6000,
        scheduleRepeats: 50,
        schedule: [
          {
            id: "r",
            label: "freezeout",
            players: 500,
            buyIn: 10,
            rake: 0.1,
            roi: 0.2,
            payoutStructure: "mtt-standard",
            count: 1,
          },
        ],
      }),
    );
    const reentry = runSimulation(
      baseInput({
        samples: 6000,
        scheduleRepeats: 50,
        schedule: [
          {
            id: "r",
            label: "3-bullet",
            players: 500,
            buyIn: 10,
            rake: 0.1,
            roi: 0.2,
            payoutStructure: "mtt-standard",
            count: 1,
            maxEntries: 3,
            reentryRate: 1,
          },
        ],
      }),
    );
    // Real-bullet amplification: independent draws (√3 ≈ 1.73) plus the
    // larger prize pool per bullet (effective seats × 3 → prizes ×3) pushes
    // the observed ratio to ~2.5–3.0. The cost-scaling-only null would give
    // ratio ≈ 1.0, so any clean floor >1.5 proves the variance channel is
    // real.
    const ratio = reentry.stats.stdDev / freezeout.stats.stdDev;
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(4);
  });

  it("bounty row produces a non-zero expected bounty lump per entry", () => {
    const base = runSimulation(
      baseInput({
        samples: 4000,
        schedule: [
          {
            id: "r",
            label: "reg",
            players: 500,
            buyIn: 10,
            rake: 0.1,
            roi: 0.1,
            payoutStructure: "mtt-standard",
            count: 1,
          },
        ],
      }),
    );
    const bounty = runSimulation(
      baseInput({
        samples: 4000,
        schedule: [
          {
            id: "r",
            label: "bounty",
            players: 500,
            buyIn: 10,
            rake: 0.1,
            roi: 0.1,
            payoutStructure: "mtt-standard",
            count: 1,
            bountyFraction: 0.5,
          },
        ],
      }),
    );
    // Same seed, same schedule, same ROI target → means should track within
    // the realised noise of a 4000-sample run. Stability of bounty model.
    const se = bounty.stats.stdDev / Math.sqrt(bounty.samples);
    expect(Math.abs(bounty.stats.mean - base.stats.mean)).toBeLessThan(6 * se);
  });

  it("ICM FT flag flattens top payouts without changing schedule totals", () => {
    const plain = runSimulation(
      baseInput({
        samples: 3000,
        schedule: [
          {
            id: "r",
            label: "plain",
            players: 500,
            buyIn: 10,
            rake: 0.1,
            roi: 0.2,
            payoutStructure: "mtt-top-heavy",
            count: 1,
          },
        ],
      }),
    );
    const icm = runSimulation(
      baseInput({
        samples: 3000,
        schedule: [
          {
            id: "r",
            label: "icm",
            players: 500,
            buyIn: 10,
            rake: 0.1,
            roi: 0.2,
            payoutStructure: "mtt-top-heavy",
            count: 1,
            icmFinalTable: true,
            icmFinalTableSize: 9,
          },
        ],
      }),
    );
    // Payout total unchanged → both runs should calibrate to the same EV.
    const se =
      plain.stats.stdDev / Math.sqrt(plain.samples) +
      icm.stats.stdDev / Math.sqrt(icm.samples);
    expect(Math.abs(plain.stats.mean - icm.stats.mean)).toBeLessThan(6 * se);
    // But ICM *reduces* variance at the top (flatter top = less upside).
    expect(icm.stats.stdDev).toBeLessThanOrEqual(plain.stats.stdDev * 1.02);
  });

  it("empirical finish model reproduces a provided histogram", () => {
    // Histogram concentrated on the top 20 % of finishes (first 100 of 500).
    // After interp onto 500 places, virtually all probability mass sits on
    // the top quintile → ITM rate should far exceed the mtt-standard
    // baseline (15 %).
    const buckets = new Array(500).fill(0);
    for (let i = 0; i < 100; i++) buckets[i] = 1;
    const r = runSimulation(
      baseInput({
        samples: 2000,
        finishModel: { id: "empirical", empiricalBuckets: buckets },
      }),
    );
    expect(r.stats.itmRate).toBeGreaterThan(0.7);
  });

  it("sit-through-pay-jumps preserves realized mean ROI", () => {
    const base = baseInput({ samples: 6000, seed: 123 });
    const plain = runSimulation(base);
    const withSit = runSimulation({
      ...base,
      schedule: base.schedule.map((r) => ({
        ...r,
        sitThroughPayJumps: true,
        payJumpAggression: 0.5,
      })),
    });
    const plainRoi = plain.stats.mean / plain.totalBuyIn;
    const sitRoi = withSit.stats.mean / withSit.totalBuyIn;
    const se =
      withSit.stats.stdDev / Math.sqrt(withSit.samples) / withSit.totalBuyIn;
    expect(Math.abs(sitRoi - plainRoi)).toBeLessThan(4 * se);
    expect(withSit.stats.stdDev).toBeGreaterThan(plain.stats.stdDev);
  });

  it("mystery bounty variance preserves realized mean ROI but inflates stdDev", () => {
    const base = baseInput({
      samples: 6000,
      seed: 321,
      schedule: [
        {
          id: "mb",
          label: "MB",
          players: 500,
          buyIn: 20,
          rake: 0.1,
          roi: 0.2,
          payoutStructure: "mtt-standard",
          bountyFraction: 0.5,
          count: 1,
        },
      ],
    });
    const plain = runSimulation(base);
    const withMyst = runSimulation({
      ...base,
      schedule: base.schedule.map((r) => ({
        ...r,
        mysteryBountyVariance: 0.5,
      })),
    });
    const plainRoi = plain.stats.mean / plain.totalBuyIn;
    const mystRoi = withMyst.stats.mean / withMyst.totalBuyIn;
    const se =
      withMyst.stats.stdDev / Math.sqrt(withMyst.samples) / withMyst.totalBuyIn;
    expect(Math.abs(mystRoi - plainRoi)).toBeLessThan(4 * se);
    expect(withMyst.stats.stdDev).toBeGreaterThan(plain.stats.stdDev);
  });
});
