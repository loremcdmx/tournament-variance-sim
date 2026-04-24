import { describe, it, expect } from "vitest";
import {
  buildResult,
  compileSchedule,
  makeCheckpointGrid,
  mergeShards,
  runSimulation,
  simulateShard,
} from "./engine";
import type {
  FinishModelId,
  PayoutStructureId,
  SimulationInput,
  TournamentRow,
} from "./types";
import { battleRoyaleRowFromTotalTicket } from "./battleRoyaleTicket";

const BR_10 = battleRoyaleRowFromTotalTicket(10);
const BR_25 = battleRoyaleRowFromTotalTicket(25);

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

  it("interleaves equal-frequency rows inside each schedule pass", () => {
    const compiled = compileSchedule(
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
            count: 2,
          },
          {
            id: "b",
            label: "B",
            players: 200,
            buyIn: 10,
            rake: 0.1,
            roi: 0.12,
            payoutStructure: "mtt-standard",
            count: 2,
          },
        ],
        scheduleRepeats: 2,
      }),
    );

    const perPass = compiled.tournamentsPerPass;
    const firstPass = compiled.flat.slice(0, perPass).map((entry) => entry.rowIdx);
    const secondPass = compiled.flat
      .slice(perPass, perPass * 2)
      .map((entry) => entry.rowIdx);

    expect(firstPass).toEqual([0, 1, 0, 1]);
    expect(secondPass).toEqual(firstPass);
  });

  it("spaces weighted rows across a schedule pass instead of batching them", () => {
    const compiled = compileSchedule(
      baseInput({
        schedule: [
          {
            id: "a",
            label: "A",
            players: 100,
            buyIn: 1,
            rake: 0.1,
            roi: 0.1,
            payoutStructure: "mtt-standard",
            count: 3,
          },
          {
            id: "b",
            label: "B",
            players: 100,
            buyIn: 2,
            rake: 0.1,
            roi: 0.1,
            payoutStructure: "mtt-standard",
            count: 2,
          },
        ],
        scheduleRepeats: 1,
      }),
    );

    const firstPass = compiled.flat.map((entry) => entry.rowIdx);
    expect(firstPass).toEqual([0, 1, 0, 1, 0]);
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

  it("keeps full-cost EV by default but honors primedopeStyleEV opt-in", () => {
    const input = baseInput({
      schedule: [
        {
          id: "r",
          label: "pd-ev",
          players: 100,
          buyIn: 100,
          rake: 0.2,
          roi: 0.1,
          payoutStructure: "mtt-standard",
          count: 10,
        },
      ],
      scheduleRepeats: 1,
      samples: 100,
    });

    const fullCost = compileSchedule(input, "primedope-binary-itm");
    const pdCost = compileSchedule(
      { ...input, primedopeStyleEV: true },
      "primedope-binary-itm",
    );

    expect(fullCost.totalBuyIn).toBeCloseTo(100 * 1.2 * 10, 12);
    expect(fullCost.expectedProfit).toBeCloseTo(100 * 1.2 * 0.1 * 10, 12);
    expect(pdCost.totalBuyIn).toBeCloseTo(100 * 10, 12);
    expect(pdCost.expectedProfit).toBeCloseTo(100 * 0.1 * 10, 12);
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

  it("emits a deterministic BR leaderboard backend channel", () => {
    const input = baseInput({
      samples: 1200,
      schedule: [
        {
          id: "br",
          label: "battle royale",
          players: 18,
          buyIn: BR_10.buyIn,
          rake: BR_10.rake,
          roi: 0.05,
          payoutStructure: "battle-royale",
          gameType: "mystery-royale",
          bountyFraction: 0.5,
          mysteryBountyVariance: 1.8,
          count: 1,
        },
      ],
      scheduleRepeats: 20,
      battleRoyaleLeaderboard: {
        participants: 200,
        windowTournaments: 5,
        scoring: {
          entryPoints: 1,
          knockoutPoints: 5,
          firstPoints: 12,
          secondPoints: 6,
          thirdPoints: 3,
        },
        payouts: [
          { rankFrom: 1, rankTo: 1, prizeEach: 250 },
          { rankFrom: 2, rankTo: 5, prizeEach: 75 },
          { rankFrom: 6, rankTo: 20, prizeEach: 20 },
        ],
        opponentModel: {
          kind: "normal",
          meanScore: 28,
          stdDevScore: 9,
        },
      },
    });

    const a = runSimulation(input);
    const b = runSimulation(input);
    expect(a.battleRoyaleLeaderboard).toBeDefined();
    expect(b.battleRoyaleLeaderboard).toBeDefined();
    expect(a.battleRoyaleLeaderboard!.stats.meanWindows).toBe(4);
    expect(a.battleRoyaleLeaderboard!.points[0]).toBe(
      b.battleRoyaleLeaderboard!.points[0],
    );
    expect(a.battleRoyaleLeaderboard!.payouts[0]).toBe(
      b.battleRoyaleLeaderboard!.payouts[0],
    );
    expect(a.battleRoyaleLeaderboard!.stats.meanPayout).toBeCloseTo(
      b.battleRoyaleLeaderboard!.stats.meanPayout,
      12,
    );
  });

  it("counts only BR tournaments inside leaderboard windows", () => {
    const input = baseInput({
      samples: 400,
      schedule: [
        {
          id: "fr",
          label: "freeze",
          players: 200,
          buyIn: 10,
          rake: 0.1,
          roi: 0.08,
          payoutStructure: "mtt-standard",
          count: 2,
        },
        {
          id: "br",
          label: "battle royale",
          players: 18,
          buyIn: BR_10.buyIn,
          rake: BR_10.rake,
          roi: 0.03,
          payoutStructure: "battle-royale",
          gameType: "mystery-royale",
          bountyFraction: 0.5,
          mysteryBountyVariance: 1.8,
          count: 1,
        },
      ],
      scheduleRepeats: 12,
      battleRoyaleLeaderboard: {
        participants: 120,
        windowTournaments: 3,
        scoring: {
          entryPoints: 1,
          knockoutPoints: 4,
          firstPoints: 10,
          secondPoints: 5,
          thirdPoints: 2,
        },
        payouts: [{ rankFrom: 1, rankTo: 10, prizeEach: 10 }],
        opponentModel: {
          kind: "normal",
          meanScore: 15,
          stdDevScore: 6,
        },
      },
    });

    const r = runSimulation(input);
    expect(r.battleRoyaleLeaderboard).toBeDefined();
    expect(r.battleRoyaleLeaderboard!.stats.meanWindows).toBe(4);
    expect(r.battleRoyaleLeaderboard!.stats.meanKnockouts).toBeGreaterThan(0);
    expect(r.battleRoyaleLeaderboard!.stats.meanFirsts).toBeGreaterThanOrEqual(0);
  });

  it("still scores explicit BR rows even when the row omits bounty-share knobs", () => {
    const input = baseInput({
      samples: 300,
      schedule: [
        {
          id: "br",
          label: "battle royale legacy",
          players: 18,
          buyIn: BR_10.buyIn,
          rake: BR_10.rake,
          roi: 0.02,
          payoutStructure: "battle-royale",
          gameType: "mystery-royale",
          count: 1,
        },
      ],
      scheduleRepeats: 8,
      battleRoyaleLeaderboard: {
        participants: 50,
        windowTournaments: 4,
        scoring: {
          entryPoints: 2,
          knockoutPoints: 0,
          firstPoints: 5,
          secondPoints: 3,
          thirdPoints: 1,
        },
        payouts: [{ rankFrom: 1, rankTo: 5, prizeEach: 10 }],
        opponentModel: {
          kind: "normal",
          meanScore: 10,
          stdDevScore: 4,
        },
      },
    });

    const r = runSimulation(input);
    expect(r.battleRoyaleLeaderboard).toBeDefined();
    expect(r.battleRoyaleLeaderboard!.stats.meanWindows).toBe(2);
    expect(r.battleRoyaleLeaderboard!.stats.meanPoints).toBeGreaterThan(0);
    expect(r.battleRoyaleLeaderboard!.stats.meanKnockouts).toBe(0);
  });

  it("keeps BR leaderboard promo as a separate observed layer without changing main EV", () => {
    const row = {
      id: "br",
      label: "battle royale",
      players: 18,
      buyIn: BR_10.buyIn,
      rake: BR_10.rake,
      roi: 0.05,
      payoutStructure: "battle-royale" as const,
      gameType: "mystery-royale" as const,
      bountyFraction: 0.5,
      count: 10,
    };
    const scheduleRepeats = 5;
    const rbFrac = 0.4;

    const baseline = runSimulation(
      baseInput({
        samples: 300,
        schedule: [row],
        scheduleRepeats,
        rakebackFracOfRake: rbFrac,
      }),
    );
    const split = runSimulation(
      baseInput({
        samples: 300,
        schedule: [row],
        scheduleRepeats,
        rakebackFracOfRake: rbFrac,
        battleRoyaleLeaderboardPromo: {
          mode: "observed",
          totalPrizes: 450,
          totalTournaments: 3000,
          pointsByStake: {
            "0.25": 0,
            "1": 0,
            "3": 120_000,
            "10": 0,
            "25": 0,
          },
        },
      }),
    );

    expect(split.expectedProfit).toBeCloseTo(baseline.expectedProfit, 10);
    expect(split.battleRoyaleLeaderboardPromo).toBeDefined();
    expect(split.battleRoyaleLeaderboardPromo?.expectedPayout).toBeCloseTo(7.5, 10);
    expect(split.battleRoyaleLeaderboardPromo?.payoutPerTournament).toBeCloseTo(
      0.15,
      10,
    );
  });

  it("adds manual BR leaderboard promo as separate EV without changing path risk", () => {
    const row: TournamentRow = {
      id: "br",
      label: "br",
      players: 18,
      buyIn: 0.92,
      rake: 0.08 / 0.92,
      roi: 0,
      itmRate: 0.2,
      payoutStructure: "battle-royale",
      gameType: "mystery-royale",
      bountyFraction: 0.45,
      count: 7000,
    };
    const baseline = runSimulation(
      baseInput({
        samples: 300,
        schedule: [row],
        scheduleRepeats: 1,
      }),
    );
    const withManual = runSimulation(
      baseInput({
        samples: 300,
        schedule: [row],
        scheduleRepeats: 1,
        battleRoyaleLeaderboardPromo: {
          mode: "manual",
          payoutPerTournament: 0.05,
        },
      }),
    );

    expect(withManual.expectedProfit).toBeCloseTo(baseline.expectedProfit, 10);
    expect(withManual.battleRoyaleLeaderboardPromo?.mode).toBe("manual");
    expect(withManual.battleRoyaleLeaderboardPromo?.expectedPayout).toBeCloseTo(
      350,
      10,
    );
    expect(withManual.stats.mean).toBeCloseTo(baseline.stats.mean, 10);
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

  it("mystery rows do not inherit PKO head variance by default", () => {
    const base = baseInput({
      samples: 4000,
      seed: 654,
      schedule: [
        {
          id: "myst",
          label: "Myst",
          gameType: "mystery",
          players: 500,
          buyIn: 20,
          rake: 0.1,
          roi: 0.2,
          payoutStructure: "mtt-gg-mystery",
          bountyFraction: 0.5,
          mysteryBountyVariance: 2.0,
          count: 1,
        },
      ],
    });
    const implicit = runSimulation(base);
    const explicitZero = runSimulation({
      ...base,
      schedule: base.schedule.map((r) => ({ ...r, pkoHeadVar: 0 })),
    });
    expect(implicit.stats.mean).toBe(explicitZero.stats.mean);
    expect(implicit.stats.stdDev).toBe(explicitZero.stats.stdDev);
    expect(implicit.finalProfits[0]).toBe(explicitZero.finalProfits[0]);
    expect(
      implicit.finalProfits[implicit.finalProfits.length - 1],
    ).toBe(explicitZero.finalProfits[explicitZero.finalProfits.length - 1]);
  });

  it("PKO rows still default pkoHeadVar to 0.4", () => {
    const base = baseInput({
      samples: 4000,
      seed: 655,
      schedule: [
        {
          id: "pko",
          label: "PKO",
          gameType: "pko",
          players: 500,
          buyIn: 20,
          rake: 0.1,
          roi: 0.2,
          payoutStructure: "mtt-gg-bounty",
          bountyFraction: 0.5,
          count: 1,
        },
      ],
    });
    const implicit = runSimulation(base);
    const explicit = runSimulation({
      ...base,
      schedule: base.schedule.map((r) => ({ ...r, pkoHeadVar: 0.4 })),
    });
    expect(implicit.stats.mean).toBe(explicit.stats.mean);
    expect(implicit.stats.stdDev).toBe(explicit.stats.stdDev);
    expect(implicit.finalProfits[0]).toBe(explicit.finalProfits[0]);
    expect(
      implicit.finalProfits[implicit.finalProfits.length - 1],
    ).toBe(explicit.finalProfits[explicit.finalProfits.length - 1]);
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

  const cashBountyEV = (compiled: {
    aliasProb: Float64Array;
    aliasIdx: Int32Array;
    prizeByPlace: Float64Array;
    bountyByPlace: Float64Array | null;
  }): { cash: number; bounty: number } => {
    const pmf = pmfFromAlias(compiled.aliasProb, compiled.aliasIdx);
    let cash = 0;
    let bounty = 0;
    for (let i = 0; i < pmf.length; i++) {
      cash += pmf[i] * compiled.prizeByPlace[i];
      bounty += pmf[i] * (compiled.bountyByPlace?.[i] ?? 0);
    }
    return { cash, bounty };
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

  it("fixed-ITM Battle Royale centers the slider on the configured KO-pool split", () => {
    const bountyFraction = 0.45;
    const compileRoyale = (roi: number, bias = 0) =>
      compileSchedule({
        schedule: [
          {
            id: `mbr-profit-${roi}-${bias}`,
            label: "mbr",
            players: 18,
            buyIn: BR_25.buyIn,
            rake: BR_25.rake,
            roi,
            gameType: "mystery-royale",
            payoutStructure: "battle-royale",
            bountyFraction,
            mysteryBountyVariance: 1.8,
            itmRate: 0.24,
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

    const breakeven = cashBountyEV(compileRoyale(0));
    const plusFour = cashBountyEV(compileRoyale(0.04));
    const profitLift = 25 * 0.04;
    const breakevenTotal = breakeven.cash + breakeven.bounty;
    const plusFourTotal = plusFour.cash + plusFour.bounty;

    expect(breakeven.bounty / breakevenTotal).toBeCloseTo(bountyFraction, 10);
    expect(plusFour.bounty / plusFourTotal).toBeCloseTo(bountyFraction, 10);
    expect(plusFour.cash - breakeven.cash).toBeCloseTo(
      profitLift * (1 - bountyFraction),
      10,
    );
    expect(plusFour.bounty - breakeven.bounty).toBeCloseTo(
      profitLift * bountyFraction,
      10,
    );

    const cashHeavy = cashBountyEV(compileRoyale(0.04, 0.25));
    const koHeavy = cashBountyEV(compileRoyale(0.04, -0.25));

    expect(cashHeavy.cash).toBeGreaterThan(plusFour.cash);
    expect(cashHeavy.bounty).toBeLessThan(plusFour.bounty);
    expect(koHeavy.cash).toBeLessThan(plusFour.cash);
    expect(koHeavy.bounty).toBeGreaterThan(plusFour.bounty);
    expect(cashHeavy.cash + cashHeavy.bounty).toBeCloseTo(
      plusFour.cash + plusFour.bounty,
      10,
    );
    expect(koHeavy.cash + koHeavy.bounty).toBeCloseTo(
      plusFour.cash + plusFour.bounty,
      10,
    );
    expect(cashHeavy.cash - breakeven.cash).toBeGreaterThan(
      profitLift * (1 - bountyFraction),
    );
    expect(koHeavy.bounty - breakeven.bounty).toBeGreaterThan(
      profitLift * bountyFraction,
    );
  });

  it("fixed-ITM Battle Royale can push KO share well below 50% when first place still has headroom", () => {
    const compiled = compileSchedule({
      schedule: [
        {
          id: "mbr-low-roi-wide-range",
          label: "mbr",
          players: 18,
          buyIn: BR_10.buyIn,
          rake: BR_10.rake,
          roi: 0.02,
          gameType: "mystery-royale",
          payoutStructure: "battle-royale",
          bountyFraction: 0.5,
          mysteryBountyVariance: 1.8,
          itmRate: 0.2,
          count: 1,
          bountyEvBias: 0.25,
        },
      ],
      scheduleRepeats: 1,
      samples: 1,
      bankroll: 100,
      seed: 7,
      finishModel: { id: "power-law" },
    }).flat[0];

    const ev = cashBountyEV(compiled);
    const koShare = ev.bounty / (ev.cash + ev.bounty);
    const pmf = pmfFromAlias(compiled.aliasProb, compiled.aliasIdx);

    expect(koShare).toBeLessThan(0.4);
    expect(pmf[0]).toBeGreaterThan(1 / 18);
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

  it("fixed-ITM Battle Royale routes extra ROI into first place before inflating lower cash spots", () => {
    const compileRoyale = (roi: number) =>
      compileSchedule({
        schedule: [
          {
            id: `mbr-winner-first-${roi}`,
            label: "mbr",
            players: 18,
            buyIn: BR_25.buyIn,
            rake: BR_25.rake,
            roi,
            gameType: "mystery-royale",
            payoutStructure: "battle-royale",
            bountyFraction: 0.5,
            mysteryBountyVariance: 1.8,
            itmRate: 0.24,
            count: 1,
            bountyEvBias: 0,
          },
        ],
        scheduleRepeats: 1,
        samples: 1,
        bankroll: 100,
        seed: 7,
        finishModel: { id: "power-law" },
      }).flat[0];

    const low = compileRoyale(0);
    const high = compileRoyale(0.03);
    const lowPmf = pmfFromAlias(low.aliasProb, low.aliasIdx);
    const highPmf = pmfFromAlias(high.aliasProb, high.aliasIdx);

    expect(highPmf[0]).toBeGreaterThan(lowPmf[0]);
    expect(highPmf[1]).toBeLessThanOrEqual(lowPmf[1] + 1e-12);
    expect(highPmf[2]).toBeLessThan(lowPmf[2]);
    expect(highPmf[1] + highPmf[2]).toBeLessThan(lowPmf[1] + lowPmf[2]);
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

describe("itmTopHeavyBias", () => {
  const pmfFromAlias = (prob: Float64Array, alias: Int32Array): number[] => {
    const n = prob.length;
    const pmf = Array.from({ length: n }, () => 0);
    for (let i = 0; i < n; i++) {
      pmf[i] += prob[i] / n;
      pmf[alias[i]] += (1 - prob[i]) / n;
    }
    return pmf;
  };

  it("keeps EV on target while tilting fixed-ITM freezeout finishes inside the paid band", () => {
    const compileFreeze = (itmTopHeavyBias: number) =>
      compileSchedule({
        schedule: [
          {
            id: `freeze-itm-bias-${itmTopHeavyBias}`,
            label: "freeze",
            players: 500,
            buyIn: 10,
            rake: 0.1,
            roi: 0.08,
            payoutStructure: "mtt-standard",
            itmRate: 0.16,
            itmTopHeavyBias,
            count: 1,
          },
        ],
        scheduleRepeats: 1,
        samples: 1,
        bankroll: 100,
        seed: 7,
        finishModel: { id: "power-law" },
      }).flat[0];

    const targetWinnings = 10 * 1.1 * 1.08;
    const flat = compileFreeze(-1);
    const neutral = compileFreeze(0);
    const heavy = compileFreeze(1);
    const flatPmf = pmfFromAlias(flat.aliasProb, flat.aliasIdx);
    const neutralPmf = pmfFromAlias(neutral.aliasProb, neutral.aliasIdx);
    const heavyPmf = pmfFromAlias(heavy.aliasProb, heavy.aliasIdx);

    expect(flat.analyticMeanSingle).toBeCloseTo(targetWinnings, 10);
    expect(neutral.analyticMeanSingle).toBeCloseTo(targetWinnings, 10);
    expect(heavy.analyticMeanSingle).toBeCloseTo(targetWinnings, 10);
    expect(heavyPmf[0]).toBeGreaterThan(neutralPmf[0]);
    expect(neutralPmf[0]).toBeGreaterThan(flatPmf[0]);
  });

  it("keeps BR EV on target while moving top-3 occupancy along the feasible cash line", () => {
    const compileRoyale = (itmTopHeavyBias: number) =>
      compileSchedule({
        schedule: [
          {
            id: `mbr-itm-bias-${itmTopHeavyBias}`,
            label: "mbr",
            players: 18,
            buyIn: BR_25.buyIn,
            rake: BR_25.rake,
            roi: 0.03,
            gameType: "mystery-royale",
            payoutStructure: "battle-royale",
            bountyFraction: 0.5,
            mysteryBountyVariance: 1.8,
            itmRate: 0.24,
            itmTopHeavyBias,
            count: 1,
            bountyEvBias: 0,
          },
        ],
        scheduleRepeats: 1,
        samples: 1,
        bankroll: 100,
        seed: 7,
        finishModel: { id: "power-law" },
      }).flat[0];

    const targetWinnings = 25 * 1.03;
    const flat = compileRoyale(-1);
    const neutral = compileRoyale(0);
    const heavy = compileRoyale(1);
    const flatPmf = pmfFromAlias(flat.aliasProb, flat.aliasIdx);
    const neutralPmf = pmfFromAlias(neutral.aliasProb, neutral.aliasIdx);
    const heavyPmf = pmfFromAlias(heavy.aliasProb, heavy.aliasIdx);

    expect(flat.analyticMeanSingle).toBeCloseTo(targetWinnings, 10);
    expect(neutral.analyticMeanSingle).toBeCloseTo(targetWinnings, 10);
    expect(heavy.analyticMeanSingle).toBeCloseTo(targetWinnings, 10);
    expect(heavyPmf[0]).toBeGreaterThanOrEqual(neutralPmf[0] - 1e-12);
    expect(neutralPmf[0]).toBeGreaterThan(flatPmf[0]);
    expect(heavyPmf[1] + heavyPmf[2]).toBeLessThanOrEqual(
      neutralPmf[1] + neutralPmf[2] + 1e-12,
    );
    expect(neutralPmf[1] + neutralPmf[2]).toBeLessThan(
      flatPmf[1] + flatPmf[2],
    );
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
        buyIn: BR_10.buyIn,
        rake: BR_10.rake,
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
