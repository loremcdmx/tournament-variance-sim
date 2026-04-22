import { describe, expect, it } from "vitest";
import {
  DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS,
  DEFAULT_BATTLE_ROYALE_LEADERBOARD_SHARE,
  battleRoyaleDirectRakebackShareForRow,
  battleRoyaleLeaderboardShareForRow,
  buildBattleRoyaleLeaderboardConfig,
  normalizeBattleRoyaleLeaderboardControls,
  normalizeBattleRoyaleLeaderboardShare,
  scheduleHasBattleRoyaleRows,
  scheduleHasBattleRoyaleLeaderboardRows,
} from "./battleRoyaleLeaderboardUi";

describe("battleRoyaleLeaderboardUi", () => {
  it("normalizes malformed persisted controls back into the visible UI contract", () => {
    const normalized = normalizeBattleRoyaleLeaderboardControls({
      enabled: true,
      participants: 1,
      windowTournaments: 0,
      awardPartialWindow: "oops",
      entryPoints: "bad",
      knockoutPoints: 6,
      firstPoints: 15,
      secondPoints: 9,
      thirdPoints: 6,
      top1Prize: -100,
      top2To3Prize: 250,
      top4To10Prize: 80,
      opponentMeanScore: "bad",
      opponentStdDevScore: -5,
    });

    expect(normalized).toEqual({
      ...DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS,
      enabled: true,
      participants: 2,
      windowTournaments: 1,
      knockoutPoints: 6,
      top1Prize: 0,
      top2To3Prize: 250,
      top4To10Prize: 80,
      opponentStdDevScore: 0,
    });
  });

  it("normalizes per-row leaderboard share into the visible row contract", () => {
    expect(normalizeBattleRoyaleLeaderboardShare("oops")).toBe(
      DEFAULT_BATTLE_ROYALE_LEADERBOARD_SHARE,
    );
    expect(normalizeBattleRoyaleLeaderboardShare(-1)).toBe(0);
    expect(normalizeBattleRoyaleLeaderboardShare(2)).toBe(1);
  });

  it("derives BR row splits only in advanced mode", () => {
    const row = {
      payoutStructure: "battle-royale",
      gameType: "mystery-royale",
      battleRoyaleLeaderboardEnabled: true,
      battleRoyaleLeaderboardShare: 0.4,
    } as const;

    expect(battleRoyaleLeaderboardShareForRow(row, false)).toBe(0);
    expect(battleRoyaleDirectRakebackShareForRow(row, false)).toBe(1);
    expect(battleRoyaleLeaderboardShareForRow(row, true)).toBe(0.4);
    expect(battleRoyaleDirectRakebackShareForRow(row, true)).toBe(0.6);
  });

  it("emits an engine config only when advanced mode has opted-in BR rows", () => {
    const controls = {
      ...DEFAULT_BATTLE_ROYALE_LEADERBOARD_CONTROLS,
      top1Prize: 400,
      top2To3Prize: 200,
      top4To10Prize: 50,
    };
    const freezeSchedule = [
      { id: "fr", payoutStructure: "mtt-standard", gameType: "freezeout" },
    ] as const;
    const brSchedule = [
      {
        id: "br",
        payoutStructure: "battle-royale",
        gameType: "mystery-royale",
        battleRoyaleLeaderboardEnabled: true,
        battleRoyaleLeaderboardShare: 0.6,
      },
    ] as const;

    expect(buildBattleRoyaleLeaderboardConfig(controls, freezeSchedule, true)).toBeUndefined();
    expect(buildBattleRoyaleLeaderboardConfig(controls, brSchedule, false)).toBeUndefined();
    expect(scheduleHasBattleRoyaleRows(freezeSchedule)).toBe(false);
    expect(scheduleHasBattleRoyaleRows(brSchedule)).toBe(true);
    expect(scheduleHasBattleRoyaleLeaderboardRows(brSchedule, true)).toBe(true);

    expect(buildBattleRoyaleLeaderboardConfig(controls, brSchedule, true)).toEqual({
      participants: controls.participants,
      windowTournaments: controls.windowTournaments,
      awardPartialWindow: controls.awardPartialWindow,
      scoring: {
        entryPoints: controls.entryPoints,
        knockoutPoints: controls.knockoutPoints,
        firstPoints: controls.firstPoints,
        secondPoints: controls.secondPoints,
        thirdPoints: controls.thirdPoints,
      },
      payouts: [
        { rankFrom: 1, rankTo: 1, prizeEach: 400 },
        { rankFrom: 2, rankTo: 3, prizeEach: 200 },
        { rankFrom: 4, rankTo: 10, prizeEach: 50 },
      ],
      opponentModel: {
        kind: "normal",
        meanScore: controls.opponentMeanScore,
        stdDevScore: controls.opponentStdDevScore,
      },
      includedRowIds: ["br"],
    });
  });
});
