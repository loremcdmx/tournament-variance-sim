import { describe, expect, it } from "vitest";

import {
  buildBattleRoyalePromoResult,
  buildObservedBattleRoyalePromoResult,
} from "./battleRoyaleLeaderboardObserved";
import { runSimulation } from "./engine";
import type { BattleRoyaleLeaderboardPromoConfig, SimulationInput, TournamentRow } from "./types";

function makeBrRow(
  id: string,
  count: number,
  label = `BR ${id}`,
): TournamentRow {
  return {
    id,
    label,
    players: 18,
    buyIn: 2.78,
    rake: 0.22 / 2.78,
    roi: 0.05,
    payoutStructure: "battle-royale",
    gameType: "mystery-royale",
    bountyFraction: 0.5,
    count,
  };
}

describe("buildObservedBattleRoyalePromoResult", () => {
  it("projects observed leaderboard dollars onto the current BR sample", () => {
    const result = buildObservedBattleRoyalePromoResult({
      config: {
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
      schedule: [makeBrRow("a", 100), makeBrRow("b", 50)],
      rowCounts: [100, 50],
      rowBuyIns: [278, 139],
    });

    expect(result).toBeDefined();
    expect(result?.expectedPayout).toBeCloseTo(22.5, 10);
    expect(result?.payoutPerTournament).toBeCloseTo(0.15, 10);
    expect(result?.payoutPerDay).toBeNull();
    expect(result?.current.tournamentsPerDay).toBeNull();
    expect(result?.current.activeDays).toBeNull();
    expect(result?.current.tournaments).toBe(150);
    expect(result?.pctOfCurrentBuyIns).toBeCloseTo(22.5 / 417, 10);
    expect(result?.observed.reconstructedAbi).toBeCloseTo(3, 10);
    expect(result?.confidence.level).toBe("aligned");
    expect(result?.rows.map((row) => row.payout)).toEqual([15, 7.5]);
  });

  it("uses raw observed totals instead of the rounded dollars-per-tournament label", () => {
    const result = buildObservedBattleRoyalePromoResult({
      config: {
        mode: "observed",
        totalPrizes: 4016,
        totalTournaments: 76238,
        pointsByStake: {
          "0.25": 219_114,
          "1": 2_202_653,
          "3": 584_513,
          "10": 0,
          "25": 0,
        },
      },
      schedule: [makeBrRow("a", 7000)],
      rowCounts: [7000],
      rowBuyIns: [7000],
    });

    expect(result).toBeDefined();
    expect(result?.payoutPerTournament).toBeCloseTo(4016 / 76238, 12);
    expect(result?.expectedPayout).toBeCloseTo((4016 / 76238) * 7000, 10);
  });

  it("flags large ABI drift as mismatch", () => {
    const result = buildObservedBattleRoyalePromoResult({
      config: {
        mode: "observed",
        totalPrizes: 900,
        totalTournaments: 1000,
        pointsByStake: {
          "0.25": 0,
          "1": 0,
          "3": 0,
          "10": 0,
          "25": 40_000,
        },
      },
      schedule: [makeBrRow("a", 100)],
      rowCounts: [100],
      rowBuyIns: [278],
    });

    expect(result).toBeDefined();
    expect(result?.observed.reconstructedAbi).toBeCloseTo(25, 10);
    expect(result?.current.abi).toBeCloseTo(2.78, 10);
    expect(result?.confidence.level).toBe("mismatch");
    expect(result?.confidence.abiDriftPct).toBeGreaterThan(0.8);
  });

  it("projects manual dollars per tournament without requiring observed stake distance", () => {
    const result = buildBattleRoyalePromoResult({
      config: {
        mode: "manual",
        payoutPerTournament: 0.05,
      },
      schedule: [makeBrRow("a", 7000)],
      rowCounts: [7000],
      rowBuyIns: [6440],
    });

    expect(result).toBeDefined();
    expect(result?.mode).toBe("manual");
    expect(result?.expectedPayout).toBeCloseTo(350, 10);
    expect(result?.payoutPerTournament).toBeCloseTo(0.05, 10);
    expect(result?.pctOfCurrentBuyIns).toBeCloseTo(350 / 6440, 10);
    expect(result?.rows.map((row) => row.payout)).toEqual([350]);
  });

  it("projects lookup-derived dollars per tournament with source metadata", () => {
    const result = buildBattleRoyalePromoResult({
      config: {
        mode: "lookup",
        payoutPerTournament: 0.05,
        tournamentsPerDay: 160,
        pointsPerTournament: 40,
        targetPoints: 6400,
        snapshotCount: 12,
        paidDays: 9,
        averageDailyPrize: 8,
      },
      schedule: [makeBrRow("a", 7000)],
      rowCounts: [7000],
      rowBuyIns: [6440],
    });

    expect(result).toBeDefined();
    expect(result?.mode).toBe("lookup");
    expect(result?.expectedPayout).toBeCloseTo(350, 10);
    if (result?.mode !== "lookup") throw new Error("expected lookup mode");
    expect(result.lookup).toMatchObject({
      payoutPerTournament: 0.05,
      tournamentsPerDay: 160,
      pointsPerTournament: 40,
      targetPoints: 6400,
      snapshotCount: 12,
      paidDays: 9,
      averageDailyPrize: 8,
    });
  });
});

describe("per-day figures come from the model's own tournaments per day", () => {
  const manualAnchored: BattleRoyaleLeaderboardPromoConfig = {
    mode: "manual",
    payoutPerTournament: 0.0375,
    stake: "3",
    tournamentsPerDay: 160,
    pointsPerTournament: 40,
    targetPoints: 6400,
    snapshotCount: 12,
    paidDays: 9,
    averageDailyPrize: 6,
  };
  const lookup: BattleRoyaleLeaderboardPromoConfig = {
    mode: "lookup",
    payoutPerTournament: 0.0375,
    tournamentsPerDay: 160,
    pointsPerTournament: 40,
    targetPoints: 6400,
    snapshotCount: 12,
    paidDays: 9,
    averageDailyPrize: 6,
  };

  it("divides the projected promo by the configured day length, not by a repeat count", () => {
    for (const config of [manualAnchored, lookup]) {
      const result = buildBattleRoyalePromoResult({
        config,
        schedule: [makeBrRow("a", 1000)],
        rowCounts: [1000],
        rowBuyIns: [2780],
      });
      expect(result?.expectedPayout).toBeCloseTo(37.5, 10);
      expect(result?.payoutPerDay).toBeCloseTo(6, 10);
      expect(result?.current.tournamentsPerDay).toBe(160);
      expect(result?.current.activeDays).toBeCloseTo(6.25, 10);
    }
  });

  it("matches the anchor's own average daily prize", () => {
    const result = buildBattleRoyalePromoResult({
      config: lookup,
      schedule: [makeBrRow("a", 40)],
      rowCounts: [40],
      rowBuyIns: [111.2],
    });
    expect(result?.payoutPerDay).toBeCloseTo(6, 10);
    expect(result?.current.activeDays).toBeCloseTo(0.25, 10);
  });

  it("has no day length for a free-form manual dollars-per-tournament", () => {
    const result = buildBattleRoyalePromoResult({
      config: { mode: "manual", payoutPerTournament: 0.05 },
      schedule: [makeBrRow("a", 1000)],
      rowCounts: [1000],
      rowBuyIns: [2780],
    });
    expect(result?.expectedPayout).toBeCloseTo(50, 10);
    expect(result?.payoutPerDay).toBeNull();
    expect(result?.current.tournamentsPerDay).toBeNull();
    expect(result?.current.activeDays).toBeNull();
  });

  function runWith(count: number, scheduleRepeats: number, config: BattleRoyaleLeaderboardPromoConfig) {
    const input: SimulationInput = {
      schedule: [makeBrRow("a", count)],
      scheduleRepeats,
      samples: 50,
      seed: 7,
      bankroll: 0,
      finishModel: { id: "power-law" },
      battleRoyaleLeaderboardPromo: config,
    };
    return runSimulation(input).battleRoyaleLeaderboardPromo;
  }

  it("does not change when the same volume is split differently into count and repeats", () => {
    for (const config of [manualAnchored, lookup]) {
      const oneRow = runWith(500, 1, config);
      const repeated = runWith(100, 5, config);
      const longRow = runWith(250, 2, config);
      expect(oneRow?.current.tournaments).toBe(500);
      expect(repeated?.current.tournaments).toBe(500);
      for (const run of [oneRow, repeated, longRow]) {
        expect(run?.payoutPerDay).toBeCloseTo(6, 10);
        expect(run?.current.tournamentsPerDay).toBe(160);
        expect(run?.current.activeDays).toBeCloseTo(3.125, 10);
        expect(run?.expectedPayout).toBeCloseTo(18.75, 10);
      }
    }
  });
});
