import { describe, expect, it } from "vitest";
import {
  battleRoyaleLeaderboardPoints,
  normalizeBattleRoyaleLeaderboardConfig,
  payoutForLeaderboardRank,
  sampleBattleRoyaleLeaderboardWindow,
} from "./battleRoyaleLeaderboard";

describe("battleRoyaleLeaderboard", () => {
  it("normalizes payout tiers and basic bounds", () => {
    const cfg = normalizeBattleRoyaleLeaderboardConfig({
      participants: 50.9,
      windowTournaments: 0,
      scoring: {
        entryPoints: 1,
        knockoutPoints: 4,
        firstPoints: 10,
        secondPoints: 6,
        thirdPoints: 3,
      },
      payouts: [
        { rankFrom: 5, rankTo: 3, prizeEach: 20 },
        { rankFrom: 1, rankTo: 1, prizeEach: 100 },
        { rankFrom: 80, rankTo: 90, prizeEach: 5 },
      ],
      opponentModel: { kind: "normal", meanScore: 30, stdDevScore: 9 },
    });

    expect(cfg).not.toBeNull();
    expect(cfg!.participants).toBe(50);
    expect(cfg!.windowTournaments).toBe(1);
    expect(cfg!.payouts).toEqual([
      { rankFrom: 1, rankTo: 1, prizeEach: 100 },
      { rankFrom: 3, rankTo: 5, prizeEach: 20 },
      { rankFrom: 50, rankTo: 50, prizeEach: 5 },
    ]);
    expect(cfg!.maxPaidRank).toBe(50);
  });

  it("computes points from place + knockout mix", () => {
    const scoring = {
      entryPoints: 1,
      knockoutPoints: 5,
      firstPoints: 12,
      secondPoints: 7,
      thirdPoints: 3,
    };
    expect(battleRoyaleLeaderboardPoints(scoring, 1, 4)).toBe(33);
    expect(battleRoyaleLeaderboardPoints(scoring, 2, 1)).toBe(13);
    expect(battleRoyaleLeaderboardPoints(scoring, 9, 0)).toBe(1);
  });

  it("maps ranks to prize bands", () => {
    const payouts = [
      { rankFrom: 1, rankTo: 1, prizeEach: 100 },
      { rankFrom: 2, rankTo: 3, prizeEach: 40 },
      { rankFrom: 4, rankTo: 10, prizeEach: 10 },
    ];
    expect(payoutForLeaderboardRank(1, payouts)).toBe(100);
    expect(payoutForLeaderboardRank(3, payouts)).toBe(40);
    expect(payoutForLeaderboardRank(9, payouts)).toBe(10);
    expect(payoutForLeaderboardRank(11, payouts)).toBe(0);
  });

  it("turns a crushing score into a top-rank payout", () => {
    const cfg = normalizeBattleRoyaleLeaderboardConfig({
      participants: 100,
      windowTournaments: 25,
      scoring: {
        entryPoints: 0,
        knockoutPoints: 4,
        firstPoints: 10,
        secondPoints: 5,
        thirdPoints: 2,
      },
      payouts: [{ rankFrom: 1, rankTo: 3, prizeEach: 50 }],
      opponentModel: { kind: "normal", meanScore: 30, stdDevScore: 4 },
    })!;
    const rng = () => 0.5;
    const gauss = () => 0;
    const settled = sampleBattleRoyaleLeaderboardWindow(200, cfg, rng, gauss);
    expect(settled.rank).toBe(1);
    expect(settled.payout).toBe(50);
    expect(settled.beatProb).toBe(0);
  });
});
