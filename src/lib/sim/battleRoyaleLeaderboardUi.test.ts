import { describe, expect, it } from "vitest";

import {
  DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS,
  buildBattleRoyaleLeaderboardPromoConfig,
  isBattleRoyaleRow,
  normalizeBattleRoyaleLeaderboardControls,
  scheduleHasBattleRoyaleRows,
} from "./battleRoyaleLeaderboardUi";

describe("battleRoyaleLeaderboardUi", () => {
  it("normalizes persisted observed controls into the visible UI contract", () => {
    const normalized = normalizeBattleRoyaleLeaderboardControls({
      mode: "observed",
      observedTotalPrizes: -5,
      observedTotalTournaments: 1234.9,
      observedPointsByStake: {
        "0.25": -10,
        "1": 80,
        "3": "oops",
        "10": 120,
        "25": null,
      },
    });

    expect(normalized).toEqual({
      ...DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS,
      mode: "observed",
      observedTotalPrizes: 0,
      observedTotalTournaments: 1234,
      observedPointsByStake: {
        "0.25": 0,
        "1": 80,
        "3": 0,
        "10": 120,
        "25": 0,
      },
    });
  });

  it("detects battle royale rows from either game type or payout structure", () => {
    expect(
      isBattleRoyaleRow({
        payoutStructure: "mtt-standard",
        gameType: "freezeout",
      }),
    ).toBe(false);
    expect(
      isBattleRoyaleRow({
        payoutStructure: "battle-royale",
        gameType: "freezeout",
      }),
    ).toBe(true);
    expect(
      isBattleRoyaleRow({
        payoutStructure: "mtt-standard",
        gameType: "mystery-royale",
      }),
    ).toBe(true);
  });

  it("emits observed promo config when BR rows and observed data are present", () => {
    const controls = {
      ...DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS,
      mode: "observed" as const,
      observedTotalPrizes: 450,
      observedTotalTournaments: 3000,
      observedPointsByStake: {
        "0.25": 0,
        "1": 0,
        "3": 120_000,
        "10": 0,
        "25": 0,
      },
    };
    const freezeSchedule = [
      { id: "fr", payoutStructure: "mtt-standard", gameType: "freezeout" },
    ] as const;
    const brSchedule = [
      {
        id: "br",
        payoutStructure: "battle-royale",
        gameType: "mystery-royale",
      },
    ] as const;

    expect(scheduleHasBattleRoyaleRows(freezeSchedule)).toBe(false);
    expect(scheduleHasBattleRoyaleRows(brSchedule)).toBe(true);
    expect(
      buildBattleRoyaleLeaderboardPromoConfig(controls, freezeSchedule),
    ).toBeUndefined();
    expect(
      buildBattleRoyaleLeaderboardPromoConfig(
        DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS,
        brSchedule,
      ),
    ).toBeUndefined();

    expect(
      buildBattleRoyaleLeaderboardPromoConfig(controls, brSchedule),
    ).toEqual({
      mode: "observed",
      totalPrizes: 450,
      totalTournaments: 3000,
      pointsByStake: controls.observedPointsByStake,
    });
  });

  it("emits manual promo config for target-limit planning without observed distance", () => {
    const controls = {
      ...DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS,
      mode: "manual" as const,
      manualPayoutPerTournament: 0.05,
    };
    const brSchedule = [
      {
        id: "br",
        payoutStructure: "battle-royale",
        gameType: "mystery-royale",
      },
    ] as const;

    expect(
      buildBattleRoyaleLeaderboardPromoConfig(controls, brSchedule),
    ).toEqual({
      mode: "manual",
      payoutPerTournament: 0.05,
    });
    expect(
      buildBattleRoyaleLeaderboardPromoConfig(
        { ...controls, manualPayoutPerTournament: 0 },
        brSchedule,
      ),
    ).toBeUndefined();
  });

  it("emits lookup promo config from imported leaderboard snapshots", () => {
    const controls = {
      ...DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS,
      mode: "lookup" as const,
      lookupTournamentsPerDay: 160,
      lookupPointsPerTournament: 40,
      lookupSnapshots: [
        {
          id: "day-1",
          entries: [
            { rank: 1, points: 9200, prize: 30 },
            { rank: 2, points: 7100, prize: 12.5 },
            { rank: 3, points: 6400, prize: 8 },
          ],
        },
      ],
    };
    const brSchedule = [
      {
        id: "br",
        payoutStructure: "battle-royale",
        gameType: "mystery-royale",
      },
    ] as const;

    expect(buildBattleRoyaleLeaderboardPromoConfig(controls, brSchedule)).toEqual({
      mode: "lookup",
      payoutPerTournament: 0.05,
      tournamentsPerDay: 160,
      pointsPerTournament: 40,
      targetPoints: 6400,
      snapshotCount: 1,
      paidDays: 1,
      averageDailyPrize: 8,
    });
  });

  it("keeps shared/basic observed BR values live instead of treating them as a visual hint", () => {
    const controls = {
      ...DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS,
      mode: "observed" as const,
      observedTotalPrizes: 4016,
      observedTotalTournaments: 76238,
      observedPointsByStake: {
        "0.25": 219_114,
        "1": 2_202_653,
        "3": 584_513,
        "10": 0,
        "25": 0,
      },
    };
    const brSchedule = [
      {
        id: "br",
        payoutStructure: "battle-royale",
        gameType: "mystery-royale",
      },
    ] as const;

    expect(buildBattleRoyaleLeaderboardPromoConfig(controls, brSchedule)).toEqual({
      mode: "observed",
      totalPrizes: 4016,
      totalTournaments: 76238,
      pointsByStake: controls.observedPointsByStake,
    });
  });
});
