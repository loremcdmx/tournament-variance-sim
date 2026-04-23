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

  it("emits observed promo config only when advanced mode has BR rows and observed data", () => {
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
      buildBattleRoyaleLeaderboardPromoConfig(controls, freezeSchedule, true),
    ).toBeUndefined();
    expect(
      buildBattleRoyaleLeaderboardPromoConfig(controls, brSchedule, false),
    ).toBeUndefined();
    expect(
      buildBattleRoyaleLeaderboardPromoConfig(
        DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS,
        brSchedule,
        true,
      ),
    ).toBeUndefined();

    expect(
      buildBattleRoyaleLeaderboardPromoConfig(controls, brSchedule, true),
    ).toEqual({
      mode: "observed",
      totalPrizes: 450,
      totalTournaments: 3000,
      pointsByStake: controls.observedPointsByStake,
    });
  });
});
