import { describe, expect, it } from "vitest";

import {
  buildBattleRoyalePromoResult,
  buildObservedBattleRoyalePromoResult,
} from "./battleRoyaleLeaderboardObserved";
import type { TournamentRow } from "./types";

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
      activeDays: 10,
    });

    expect(result).toBeDefined();
    expect(result?.expectedPayout).toBeCloseTo(22.5, 10);
    expect(result?.payoutPerTournament).toBeCloseTo(0.15, 10);
    expect(result?.payoutPerDay).toBeCloseTo(2.25, 10);
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
      activeDays: 1,
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
      activeDays: 5,
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
      activeDays: 1,
    });

    expect(result).toBeDefined();
    expect(result?.mode).toBe("manual");
    expect(result?.expectedPayout).toBeCloseTo(350, 10);
    expect(result?.payoutPerTournament).toBeCloseTo(0.05, 10);
    expect(result?.pctOfCurrentBuyIns).toBeCloseTo(350 / 6440, 10);
    expect(result?.rows.map((row) => row.payout)).toEqual([350]);
  });
});
