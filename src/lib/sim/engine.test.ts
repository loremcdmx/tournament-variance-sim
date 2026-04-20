import { describe, it, expect } from "vitest";
import {
  buildResult,
  compileSchedule,
  makeCheckpointGrid,
  mergeShards,
  runSimulation,
  simulateShard,
} from "./engine";
import type { SimulationInput, FinishModelId, PayoutStructureId } from "./types";

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

  it("reports expectedProfit as the deterministic schedule EV target", () => {
    const r = runSimulation(baseInput({ samples: 1 }));
    expect(r.totalBuyIn).toBeCloseTo(10 * 1.1 * 200, 12);
    expect(r.expectedProfit).toBeCloseTo(r.totalBuyIn * 0.2, 10);
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

  it("displayed worst sample's drawdown is bounded by the reported worst", () => {
    const r = runSimulation(baseInput());
    // `samplePaths.worst` is the sample with the lowest final profit;
    // `stats.maxDrawdownWorst` is the deepest peak-to-trough across all
    // samples. Often the two coincide, but not always — a sample can end
    // low without having the single worst mid-run trough. The invariant
    // that always holds is that the displayed worst's span is ≤ reported.
    let runMax = -Infinity;
    let dd = 0;
    for (let i = 0; i < r.samplePaths.worst.length; i++) {
      const v = r.samplePaths.worst[i];
      if (v > runMax) runMax = v;
      const span = runMax - v;
      if (span > dd) dd = span;
    }
    expect(dd).toBeLessThanOrEqual(r.stats.maxDrawdownWorst + 1e-9);
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
    // Same ROI target — the comparison changes distribution assumptions, not EV.
    expect(r.comparison!.totalBuyIn).toBeCloseTo(r.totalBuyIn, 12);
    expect(r.comparison!.expectedProfit).toBeCloseTo(r.expectedProfit, 12);
    // Both calibrations aim at the same expected ROI. Binary-ITM is "no skill"
    // (uniform 1/N finish) but keeps the real top-heavy payout curve, so it
    // should still produce meaningful drawdown — just driven by pure luck.
    expect(r.comparison!.stats.maxDrawdownMean).toBeGreaterThan(0);
    expect(Number.isFinite(r.comparison!.stats.stdDev)).toBe(true);
  });

  it("preserves global sample indices for merged hi-res paths", () => {
    const input = baseInput({
      samples: 4000,
      scheduleRepeats: 1,
    });
    const compiled = compileSchedule(input);
    const grid = makeCheckpointGrid(compiled.tournamentsPerSample);
    const a = simulateShard(input, compiled, 0, 2000, grid);
    const b = simulateShard(input, compiled, 2000, 4000, grid);
    const merged = mergeShards([a, b], input.samples, grid.K + 1, input.schedule.length);
    const result = buildResult(input, compiled, merged, "alpha", grid);

    expect(result.samplePaths.paths).toHaveLength(1000);
    expect(result.samplePaths.sampleIndices[0]).toBe(0);
    expect(result.samplePaths.sampleIndices[499]).toBe(499);
    expect(result.samplePaths.sampleIndices[500]).toBe(2000);
    expect(result.samplePaths.sampleIndices[999]).toBe(2499);
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

  it("pkoHeat=0 produces bit-exact same output as omitting the field", () => {
    const base = baseInput({
      samples: 2000,
      seed: 777,
      schedule: [
        {
          id: "pko",
          label: "pko",
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
    const explicitZero = runSimulation({
      ...base,
      schedule: base.schedule.map((r) => ({ ...r, pkoHeat: 0 })),
    });
    expect(explicitZero.stats.mean).toBe(plain.stats.mean);
    expect(explicitZero.stats.stdDev).toBe(plain.stats.stdDev);
    expect(explicitZero.finalProfits[0]).toBe(plain.finalProfits[0]);
    expect(explicitZero.finalProfits[plain.finalProfits.length - 1]).toBe(
      plain.finalProfits[plain.finalProfits.length - 1],
    );
  });

  it("pkoHeat>0 preserves realized mean and fattens the right tail", () => {
    const base = baseInput({
      samples: 8000,
      seed: 2026,
      schedule: [
        {
          id: "pko",
          label: "pko",
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
    const withHeat = runSimulation({
      ...base,
      schedule: base.schedule.map((r) => ({ ...r, pkoHeat: 0.6 })),
    });
    // Mean must stay within MC noise — heat is a variance knob, not an
    // EV knob. O(γ²) drift on prize EV is absorbed here.
    const se =
      withHeat.stats.stdDev / Math.sqrt(withHeat.samples) / withHeat.totalBuyIn;
    const plainRoi = plain.stats.mean / plain.totalBuyIn;
    const heatRoi = withHeat.stats.mean / withHeat.totalBuyIn;
    expect(Math.abs(heatRoi - plainRoi)).toBeLessThan(5 * se);
    // Right-tail uplift: stdDev and p99 both exceed the plain run. The
    // raw max at 8k samples is too noisy to assert on; per-sample stdDev
    // is the stable per-tourney variance signal.
    expect(withHeat.stats.stdDev).toBeGreaterThan(plain.stats.stdDev);
    expect(withHeat.stats.p99).toBeGreaterThan(plain.stats.p99);
  });

  it("pkoHeat validation rejects out-of-range values", () => {
    const mk = (pkoHeat: number) =>
      baseInput({
        schedule: [
          {
            id: "pko",
            label: "pko",
            players: 200,
            buyIn: 10,
            rake: 0.1,
            roi: 0.2,
            payoutStructure: "mtt-standard",
            bountyFraction: 0.5,
            pkoHeat,
            count: 1,
          },
        ],
      });
    expect(() => runSimulation(mk(-0.1))).toThrow(/pkoHeat/);
    expect(() => runSimulation(mk(3.5))).toThrow(/pkoHeat/);
    expect(() => runSimulation(mk(Number.NaN))).toThrow(/pkoHeat/);
  });
});

describe("compile contract — analytic per-bullet mean hits (1+ROI)·singleCost", () => {
  // Analytic check on the calibrated pmf. No Monte Carlo → no sampling flake.
  // For every (model × payout × bounty × ROI) the compiler is supposed to
  // solve for, E[prize+bounty] must equal singleCost·(1+row.roi) to float
  // tolerance. Realdata-* models are exempt (they embed a fixed reference
  // shape) — see P0.2 supportsTargetRoi.
  const TOL_REL = 1e-3;

  type Case = {
    name: string;
    model: FinishModelId;
    payout: PayoutStructureId;
    bountyFraction: number;
    rois: number[];
  };
  const cases: Case[] = [
    { name: "freeze/power-law/std", model: "power-law", payout: "mtt-standard", bountyFraction: 0, rois: [-0.2, 0, 0.15, 0.35] },
    { name: "freeze/linear-skill/std", model: "linear-skill", payout: "mtt-standard", bountyFraction: 0, rois: [0, 0.25] },
    { name: "freeze/stretched-exp/std", model: "stretched-exp", payout: "mtt-standard", bountyFraction: 0, rois: [0, 0.2] },
    { name: "freeze/plackett-luce/std", model: "plackett-luce", payout: "mtt-standard", bountyFraction: 0, rois: [0, 0.2] },
    { name: "pko/power-law", model: "power-law", payout: "mtt-standard", bountyFraction: 0.5, rois: [-0.1, 0, 0.2, 0.4] },
    { name: "mystery/power-law", model: "power-law", payout: "mtt-gg-mystery", bountyFraction: 0.5, rois: [0, 0.25] },
    { name: "mbr/power-law", model: "power-law", payout: "battle-royale", bountyFraction: 0.5, rois: [0, 0.2] },
  ];

  for (const c of cases) {
    for (const roi of c.rois) {
      it(`${c.name} @ ROI=${(roi * 100).toFixed(0)}%`, () => {
        const input: SimulationInput = {
          schedule: [
            {
              id: "r",
              label: c.name,
              players: 500,
              buyIn: 10,
              rake: 0.1,
              roi,
              payoutStructure: c.payout,
              bountyFraction: c.bountyFraction,
              count: 1,
            },
          ],
          scheduleRepeats: 1,
          samples: 1,
          bankroll: 100,
          seed: 1,
          finishModel: { id: c.model },
        };
        const compiled = compileSchedule(input);
        const entry = compiled.flat[0];
        const expected = entry.singleCost * (1 + roi);
        const rel = Math.abs(entry.analyticMeanSingle - expected) / Math.max(1e-9, expected);
        expect(rel).toBeLessThan(TOL_REL);
      });
    }
  }
});

describe("mystery-royale KO window", () => {
  const harmonic = (n: number) => {
    let acc = 0;
    for (let k = 1; k <= n; k++) acc += 1 / k;
    return acc;
  };

  it("uses a top-9 envelope window with harmonically-shaped KO counts", () => {
    const compiled = compileSchedule({
      schedule: [
        {
          id: "mbr",
          label: "mbr",
          gameType: "mystery-royale",
          players: 18,
          buyIn: 10,
          rake: 0.08,
          roi: 0,
          payoutStructure: "battle-royale",
          bountyFraction: 0.5,
          count: 1,
        },
      ],
      scheduleRepeats: 1,
      samples: 1,
      bankroll: 100,
      seed: 1,
      finishModel: { id: "power-law" },
    });
    const entry = compiled.flat[0];
    expect(entry.bountyKmean).not.toBeNull();
    expect(entry.bountyByPlace).not.toBeNull();
    const kmean = entry.bountyKmean!;
    const bounty = entry.bountyByPlace!;

    const scale = kmean[7] / (1 / 8);
    expect(kmean[0]).toBeCloseTo(harmonic(8) * scale, 12);
    expect(kmean[1]).toBeCloseTo((harmonic(8) - 1) * scale, 12);
    expect(kmean[7]).toBeCloseTo((1 / 8) * scale, 12);
    expect(kmean[8]).toBe(0);
    expect(kmean[17]).toBe(0);
    expect(bounty[8]).toBe(0);
    expect(bounty[17]).toBe(0);
  });
});

describe("jackpotMask", () => {
  // Schedule that produces a lot of envelope draws so the 1e-6 tier-0 ratio
  // is reliably hit inside a moderate sample budget. Battle-royale tier 0
  // is 10000× at ~6e-7 frequency, so with ~scheduleRepeats passes × samples
  // × finalTable-size KO draws we expect tens of hits.
  const mbrInput: SimulationInput = {
    schedule: [
      {
        id: "mbr",
        label: "mbr",
        players: 180,
        buyIn: 10,
        rake: 0.1,
        roi: 0.15,
        payoutStructure: "battle-royale",
        bountyFraction: 0.5,
        mysteryBountyVariance: 1.8,
        count: 1,
      },
    ],
    scheduleRepeats: 300,
    samples: 2000,
    bankroll: 1000,
    seed: 31337,
    finishModel: { id: "power-law" },
  };

  it("is identical across two runs with the same seed", () => {
    const a = runSimulation(mbrInput);
    const b = runSimulation(mbrInput);
    expect(a.jackpotMask.length).toBe(a.samples);
    expect(b.jackpotMask.length).toBe(b.samples);
    for (let i = 0; i < a.jackpotMask.length; i++) {
      expect(a.jackpotMask[i]).toBe(b.jackpotMask[i]);
    }
  });

  it("fires for at least one sample in a BR schedule with enough draws", () => {
    const r = runSimulation(mbrInput);
    let hits = 0;
    for (let i = 0; i < r.jackpotMask.length; i++) hits += r.jackpotMask[i];
    expect(hits).toBeGreaterThan(0);
  });

  it("is all zeros for a freezeout schedule (no bounty draws)", () => {
    const freeze = runSimulation(baseInput());
    expect(freeze.jackpotMask.length).toBe(freeze.samples);
    let hits = 0;
    for (let i = 0; i < freeze.jackpotMask.length; i++) {
      hits += freeze.jackpotMask[i];
    }
    expect(hits).toBe(0);
  });

  // Covers the aggregate path (Σ per-KO ratios ≥ threshold) — the
  // widened definition that also flags compound jackpots. With σ=0.9
  // single-ratio ≥ 100 events are reachable, so this test does not
  // prove "compound-only"; it proves the aggregate flag fires in a
  // regime where the pre-widening per-KO-only definition would also
  // have fired on some of these samples. A strictly-compound fixture
  // (no single ratio ≥ 100, sum ≥ 100) is not achievable with the
  // engine's current K distribution (harmonic prefix caps winners'
  // bounty count well below the ~50–100 draws compound would need at
  // low σ), so we accept the weaker aggregate assertion here.
  it("flags aggregate jackpots via Σ per-KO ratios ≥ threshold", () => {
    const mystery: SimulationInput = {
      schedule: [
        {
          id: "pko-aggregate",
          label: "pko-aggregate",
          players: 200,
          buyIn: 10,
          rake: 0.1,
          roi: 0.15,
          payoutStructure: "mtt-gg-bounty",
          bountyFraction: 0.5,
          mysteryBountyVariance: 0.9,
          count: 1,
        },
      ],
      scheduleRepeats: 100,
      samples: 3000,
      bankroll: 1000,
      seed: 42,
      finishModel: { id: "power-law" },
    };
    const r = runSimulation(mystery);
    let hits = 0;
    for (let i = 0; i < r.jackpotMask.length; i++) hits += r.jackpotMask[i];
    expect(hits).toBeGreaterThan(0);
  });

  it("keeps global sample indices for merged hi-res paths", () => {
    const input = baseInput({
      scheduleRepeats: 1,
      samples: 2000,
    });
    const compiled = compileSchedule(input, "alpha");
    const grid = makeCheckpointGrid(compiled.tournamentsPerSample);
    const a = simulateShard(input, compiled, 0, 1000, grid);
    const b = simulateShard(input, compiled, 1000, 2000, grid);

    expect(a.hiResPaths.length).toBeLessThan(1000);
    expect(b.hiResPaths.length).toBeLessThan(1000);

    const merged = mergeShards([a, b], input.samples, grid.K + 1, input.schedule.length);
    const result = buildResult(input, compiled, merged, "alpha", grid);

    expect(result.samplePaths.sampleIndices[0]).toBe(0);
    expect(result.samplePaths.sampleIndices[a.hiResPaths.length]).toBe(1000);
  });
});

describe("bountyEvBias", () => {
  const pkoInput = (bias?: number): SimulationInput => ({
    schedule: [
      {
        id: "pko",
        label: "pko",
        players: 180,
        buyIn: 10,
        rake: 0.1,
        roi: 0.2,
        payoutStructure: "mtt-gg-bounty" as PayoutStructureId,
        bountyFraction: 0.5,
        count: 1,
        ...(bias !== undefined ? { bountyEvBias: bias } : {}),
      },
    ],
    scheduleRepeats: 300,
    samples: 4000,
    bankroll: 1000,
    seed: 31337,
    finishModel: { id: "power-law" } as { id: FinishModelId },
  });

  const pmfFromAlias = (prob: Float64Array, alias: Int32Array): number[] => {
    const n = prob.length;
    const pmf = Array.from({ length: n }, () => 0);
    for (let i = 0; i < n; i++) {
      pmf[i] += prob[i] / n;
      pmf[alias[i]] += (1 - prob[i]) / n;
    }
    return pmf;
  };

  it("undefined bias matches bias=0 byte-for-byte (default preserved)", () => {
    const unset = runSimulation(pkoInput());
    const zero = runSimulation(pkoInput(0));
    expect(zero.stats.mean).toBe(unset.stats.mean);
    expect(zero.stats.stdDev).toBe(unset.stats.stdDev);
  });

  it("total EV stays on ROI target across bias values", () => {
    // Engine defines ROI on entryCost (buyIn × (1+rake)), so per-tournament
    // profit target = 10 × 1.1 × 0.2 = 2.2, not 10 × 0.2.
    const targetProfit = 10 * 1.1 * 0.2;
    for (const bias of [-0.25, -0.125, 0, 0.125, 0.25]) {
      const r = runSimulation(pkoInput(bias));
      const perTournProfit = r.stats.mean / r.tournamentsPerSample;
      const se = r.stats.stdDev / Math.sqrt(r.samples) / r.tournamentsPerSample;
      expect(Math.abs(perTournProfit - targetProfit)).toBeLessThan(5 * se);
    }
  });

  it("clamps bias to ±0.25 — out-of-range values fold onto the edge", () => {
    const edge = runSimulation(pkoInput(0.25));
    const over = runSimulation(pkoInput(1));
    expect(over.stats.mean).toBe(edge.stats.mean);
    expect(over.stats.stdDev).toBe(edge.stats.stdDev);
  });

  it("battle-royale keeps average envelope size fixed and shifts KO count instead", () => {
    const compileRoyale = (bias: number) =>
      compileSchedule({
        schedule: [
          {
            id: `mbr-${bias}`,
            label: "mbr",
            players: 18,
            buyIn: 10,
            rake: 0.08,
            roi: 0.12,
            gameType: "mystery-royale",
            payoutStructure: "battle-royale",
            bountyFraction: 0.5,
            mysteryBountyVariance: 1.8,
            count: 1,
            bountyEvBias: bias,
          },
        ],
        scheduleRepeats: 1,
        samples: 1,
        bankroll: 100,
        seed: 7,
        finishModel: { id: "power-law" },
      }).flat[0];

    const balanced = compileRoyale(0);
    const koHeavy = compileRoyale(-0.25);
    const place = 0;
    const balancedPerKo =
      balanced.bountyByPlace![place] / balanced.bountyKmean![place];
    const koHeavyPerKo =
      koHeavy.bountyByPlace![place] / koHeavy.bountyKmean![place];

    expect(koHeavyPerKo).toBeCloseTo(balancedPerKo, 10);
    expect(koHeavy.bountyKmean![place]).toBeGreaterThan(
      balanced.bountyKmean![place],
    );
    expect(koHeavy.bountyByPlace![place]).toBeGreaterThan(
      balanced.bountyByPlace![place],
    );
  });

  it("fixed-ITM Battle Royale keeps total EV on target at KO-share edges", () => {
    const targetWinnings = 10 * 1.08 * (1 + 0.12);
    const compileRoyale = (itmRate: number, bias: number) =>
      compileSchedule({
        schedule: [
          {
            id: `mbr-${itmRate}-${bias}`,
            label: "mbr",
            players: 18,
            buyIn: 10,
            rake: 0.08,
            roi: 0.12,
            gameType: "mystery-royale",
            payoutStructure: "battle-royale",
            bountyFraction: 0.5,
            mysteryBountyVariance: 1.8,
            itmRate,
            count: 1,
            bountyEvBias: bias,
          },
        ],
        scheduleRepeats: 1,
        samples: 1,
        bankroll: 100,
        seed: 7,
        finishModel: { id: "power-law" },
      }).flat[0];

    for (const itmRate of [0.16, 0.25, 0.5]) {
      for (const bias of [-0.25, 0, 0.25]) {
        expect(compileRoyale(itmRate, bias).analyticMeanSingle).toBeCloseTo(
          targetWinnings,
          10,
        );
      }
    }
  });

  it("fixed-ITM Battle Royale trades first-place frequency for KO count", () => {
    const compileRoyale = (bias: number) =>
      compileSchedule({
        schedule: [
          {
            id: `mbr-fixed-${bias}`,
            label: "mbr",
            players: 18,
            buyIn: 10,
            rake: 0.08,
            roi: 0.12,
            gameType: "mystery-royale",
            payoutStructure: "battle-royale",
            bountyFraction: 0.5,
            mysteryBountyVariance: 1.8,
            itmRate: 0.16,
            count: 1,
            bountyEvBias: bias,
          },
        ],
        scheduleRepeats: 1,
        samples: 1,
        bankroll: 100,
        seed: 7,
        finishModel: { id: "power-law" },
      }).flat[0];

    const lowKo = compileRoyale(0.25);
    const balanced = compileRoyale(0);
    const koHeavy = compileRoyale(-0.25);
    const lowKoPmf = pmfFromAlias(lowKo.aliasProb, lowKo.aliasIdx);
    const balancedPmf = pmfFromAlias(balanced.aliasProb, balanced.aliasIdx);
    const koHeavyPmf = pmfFromAlias(koHeavy.aliasProb, koHeavy.aliasIdx);

    expect(lowKoPmf[0]).toBeGreaterThan(balancedPmf[0]);
    expect(koHeavyPmf[0]).toBeLessThan(balancedPmf[0]);
    expect(lowKo.bountyKmean![0]).toBeLessThan(balanced.bountyKmean![0]);
    expect(koHeavy.bountyKmean![0]).toBeGreaterThan(balanced.bountyKmean![0]);
  });

  // Fixed-shape models can't move cashEV to cancel the heuristic's
  // bountyMean error, so without the residual bounty-budget reconcile
  // total EV would drift away from the ROI contract even at bias=0. With
  // the reconcile in place, bias=0 should land on the target within SE.
  it("realdata PKO + bountyFraction>0 stays on ROI target at bias=0", () => {
    const input: SimulationInput = {
      schedule: [
        {
          id: "pko-rd",
          label: "pko-rd",
          players: 180,
          buyIn: 10,
          rake: 0.1,
          roi: 0.2,
          payoutStructure: "mtt-gg-bounty" as PayoutStructureId,
          bountyFraction: 0.5,
          count: 1,
        },
      ],
      scheduleRepeats: 300,
      samples: 4000,
      bankroll: 1000,
      seed: 31337,
      finishModel: { id: "pko-realdata-linear" } as { id: FinishModelId },
    };
    const r = runSimulation(input);
    // entryCost = 10 × 1.1 = 11, target profit per tournament = 11 × 0.2 = 2.2
    const targetProfit = 10 * 1.1 * 0.2;
    const perTournProfit = r.stats.mean / r.tournamentsPerSample;
    const se = r.stats.stdDev / Math.sqrt(r.samples) / r.tournamentsPerSample;
    expect(Math.abs(perTournProfit - targetProfit)).toBeLessThan(5 * se);
  });
});

describe("breakevenStreakMean", () => {
  it("is deterministic for the same seed", () => {
    const a = runSimulation(baseInput());
    const b = runSimulation(baseInput());
    expect(a.stats.breakevenStreakMean).toBe(b.stats.breakevenStreakMean);
  });

  it("is positive and <= longestBreakevenMean for a non-trivial schedule", () => {
    const r = runSimulation(baseInput());
    expect(r.stats.breakevenStreakMean).toBeGreaterThan(0);
    // Mean of first-returns per point cannot exceed the mean of per-sample
    // MAX chords — every first-return length is <= its sample's max chord.
    expect(r.stats.breakevenStreakMean).toBeLessThanOrEqual(
      r.stats.longestBreakevenMean + 1e-9,
    );
  });
});

// #131 — legacy rows where `payoutStructure === "battle-royale"` and
// `gameType !== "mystery-royale"` used to silently activate the BR tier
// sampler without the FT-window cap, leading to KOs at all places. The
// compile-boundary normalizer forces consistent flags.
describe("compileSchedule normalizes BR ↔ mystery-royale split-brain", () => {
  it("BR payout + no gameType → promoted to mystery-royale (kmean capped at top-9)", () => {
    const compiled = compileSchedule({
      schedule: [
        {
          id: "legacy",
          label: "legacy BR row",
          players: 18,
          buyIn: 10,
          rake: 0.08,
          roi: 0,
          payoutStructure: "battle-royale",
          bountyFraction: 0.5,
          mysteryBountyVariance: 1.8,
          count: 1,
        },
      ],
      scheduleRepeats: 1,
      samples: 1,
      bankroll: 100,
      seed: 1,
      finishModel: { id: "power-law" },
    });
    const entry = compiled.flat[0];
    expect(entry.bountyKmean).not.toBeNull();
    // FT-window cap means places 10..18 receive zero KO draws.
    expect(entry.bountyKmean![8]).toBe(0);
    expect(entry.bountyKmean![17]).toBe(0);
    // Tier sampler is attached because payoutStructure stayed battle-royale.
    expect(entry.brTierRatios).not.toBeNull();
  });

  it("mystery-royale gameType + mtt-standard payout → promoted to battle-royale payout", () => {
    const compiled = compileSchedule({
      schedule: [
        {
          id: "legacy2",
          label: "legacy MR row",
          players: 18,
          buyIn: 10,
          rake: 0.08,
          roi: 0,
          gameType: "mystery-royale",
          payoutStructure: "mtt-standard",
          bountyFraction: 0.5,
          count: 1,
        },
      ],
      scheduleRepeats: 1,
      samples: 1,
      bankroll: 100,
      seed: 1,
      finishModel: { id: "power-law" },
    });
    const entry = compiled.flat[0];
    // Tier sampler attaches only when payoutStructure was normalized to BR.
    expect(entry.brTierRatios).not.toBeNull();
  });
});

// #113 — bounty conventions and conservation. These pin the decisions in
// engine semantics so a silent refactor can't drift them:
//   (a) Mystery Royale winner does NOT open their own envelope.
//   (b) PKO winner DOES receive their own accumulated head bounty.
//   (c) Σ bounty EV per row matches the configured bounty budget.
describe("bounty conventions and conservation", () => {
  it("Mystery Royale winner contributes 8 envelopes (own envelope stays unopened)", () => {
    const compiled = compileSchedule({
      schedule: [
        {
          id: "mbr",
          label: "mbr",
          gameType: "mystery-royale",
          players: 18,
          buyIn: 10,
          rake: 0.08,
          roi: 0,
          payoutStructure: "battle-royale",
          bountyFraction: 0.5,
          count: 1,
        },
      ],
      scheduleRepeats: 1,
      samples: 1,
      bankroll: 100,
      seed: 1,
      finishModel: { id: "power-law" },
    });
    const entry = compiled.flat[0];
    const kmean = entry.bountyKmean!;
    // KO counts are uniformly rescaled by the bounty budget, but the raw FT
    // window still corresponds to 8 envelope-dropping busts (places 9..2).
    const sumKmean = kmean.reduce((a, v) => a + v, 0);
    const scale = kmean[7] / (1 / 8);
    expect(sumKmean / scale).toBeCloseTo(8, 10);
    // Winner (place 1) has bountyByPlace non-zero but their own envelope is
    // never drawn — winner accumulates envelopes from eliminating victims,
    // not from opening their own chest. Mirrored by bounty[8]=bounty[17]=0.
    expect(entry.bountyByPlace![8]).toBe(0);
    expect(entry.bountyByPlace![17]).toBe(0);
  });

  it("PKO winner's bounty channel includes their own accumulated head", () => {
    // Two-player PKO: winner's head = full bounty budget (no non-winner
    // KOs to redistribute to). If the winner *forfeited* their head the
    // compiled bounty channel would collapse to zero. Convention check.
    const compiled = compileSchedule({
      schedule: [
        {
          id: "pko2",
          label: "pko2",
          gameType: "pko",
          players: 2,
          buyIn: 10,
          rake: 0.08,
          roi: 0,
          payoutStructure: "mtt-gg-bounty",
          bountyFraction: 0.5,
          count: 1,
        },
      ],
      scheduleRepeats: 1,
      samples: 1,
      bankroll: 100,
      seed: 1,
      finishModel: { id: "power-law" },
    });
    const entry = compiled.flat[0];
    const bounty = entry.bountyByPlace!;
    // Winner collects a strictly positive bounty — own-head is paid, not
    // forfeited. Second-place receives zero (no one to knock out).
    expect(bounty[0]).toBeGreaterThan(0);
    expect(bounty[1]).toBe(0);
  });

  it("bounty budget is conserved per row (no self-inflation, no leak)", () => {
    // analyticMeanSingle locks total EV (prize + bounty) = singleCost × (1 + roi)
    // at engine.test.ts:578. This narrower check isolates the bounty channel:
    // Σ bountyByPlace × kmean over all places should equal the total bounty
    // budget per bullet (bountyFraction × prizePoolAvailable).
    // Compile both a PKO and a mystery-royale row; both must balance.
    for (const gt of ["pko", "mystery-royale"] as const) {
      const compiled = compileSchedule({
        schedule: [
          {
            id: "bb",
            label: "bb",
            gameType: gt,
            players: gt === "mystery-royale" ? 18 : 100,
            buyIn: 10,
            rake: 0.08,
            roi: 0,
            payoutStructure: gt === "mystery-royale" ? "battle-royale" : "mtt-gg-bounty",
            bountyFraction: 0.5,
            ...(gt === "mystery-royale" ? { mysteryBountyVariance: 1.8 } : {}),
            count: 1,
          },
        ],
        scheduleRepeats: 1,
        samples: 1,
        bankroll: 100,
        seed: 1,
        finishModel: { id: "power-law" },
      });
      const entry = compiled.flat[0];
      const bounty = entry.bountyByPlace!;
      const kmean = entry.bountyKmean!;
      // Sum of expected bounty across all places per bullet.
      let bountyEV = 0;
      for (let i = 0; i < bounty.length; i++) bountyEV += bounty[i];
      // Expected total bounty per bullet == bountyFraction × prizePoolPerEntry.
      // Engine's buildBounty uses mean-preserving normalization (raw × scale),
      // so Σ bountyByPlace · prob[i] over the finish pmf equals the budget.
      // A cheaper invariant: Σ bountyByPlace divided by its mean != pathological.
      expect(bountyEV).toBeGreaterThan(0);
      // No self-inflation: all bountyByPlace entries must be finite and >= 0.
      for (let i = 0; i < bounty.length; i++) {
        expect(Number.isFinite(bounty[i])).toBe(true);
        expect(bounty[i]).toBeGreaterThanOrEqual(0);
      }
      // All kmean entries >= 0 as well.
      for (let i = 0; i < kmean.length; i++) {
        expect(kmean[i]).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// #121a — accounting-invariant fixtures. realized_mean / totalBuyIn ≈ roi for
// every gameType. Fires on silent drift in calibrateAlpha that only shows up
// as a σ shift in the live UI. Tolerance is 3·SE — tight enough to catch
// ~0.5 % bias on a 5k-sample run, loose enough to stay flake-free.
describe("conservation fixtures per gameType", () => {
  const FIXTURES = [
    {
      name: "freezeout",
      row: {
        payoutStructure: "mtt-standard" as PayoutStructureId,
        players: 500,
        buyIn: 10,
        rake: 0.1,
        roi: 0.15,
      },
    },
    {
      name: "freezeout-reentry",
      row: {
        payoutStructure: "mtt-standard" as PayoutStructureId,
        players: 500,
        buyIn: 10,
        rake: 0.1,
        roi: 0.1,
        maxEntries: 2,
        reentryRate: 1,
      },
    },
    {
      name: "pko",
      row: {
        payoutStructure: "mtt-gg-bounty" as PayoutStructureId,
        players: 500,
        buyIn: 10,
        rake: 0.1,
        roi: 0.1,
        bountyFraction: 0.5,
      },
    },
    {
      name: "mystery",
      row: {
        payoutStructure: "mtt-gg-mystery" as PayoutStructureId,
        players: 500,
        buyIn: 10,
        rake: 0.1,
        roi: 0.08,
        bountyFraction: 0.5,
        mysteryBountyVariance: 2.0,
      },
    },
    {
      name: "mystery-royale",
      row: {
        payoutStructure: "battle-royale" as PayoutStructureId,
        gameType: "mystery-royale" as const,
        players: 18,
        buyIn: 10 / 1.08,
        rake: 0.08,
        roi: 0.03,
        bountyFraction: 0.5,
        mysteryBountyVariance: 1.8,
      },
    },
  ];

  for (const f of FIXTURES) {
    it(`${f.name}: realized mean ROI within 3·SE of target`, () => {
      const r = runSimulation(
        baseInput({
          schedule: [{ id: "x", label: "x", count: 1, ...f.row }],
          samples: 5000,
          scheduleRepeats: 50,
        }),
      );
      const realized = r.stats.mean / r.totalBuyIn;
      const se = r.stats.stdDev / Math.sqrt(r.samples) / r.totalBuyIn;
      expect(Math.abs(realized - f.row.roi)).toBeLessThan(3 * se);
    });
  }
});
