import { describe, it, expect } from "vitest";
import { runSimulation, compileSchedule } from "./engine";
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

  it("uses a top-9 envelope window with harmonic KO means", () => {
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

    expect(kmean[0]).toBeCloseTo(harmonic(8), 12);
    expect(kmean[1]).toBeCloseTo(harmonic(8) - 1, 12);
    expect(kmean[7]).toBeCloseTo(1 / 8, 12);
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
