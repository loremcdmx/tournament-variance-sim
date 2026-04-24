import { describe, expect, it } from "vitest";

import { parseBattleRoyaleLeaderboardObservedImport } from "./battleRoyaleLeaderboardObservedImport";

describe("parseBattleRoyaleLeaderboardObservedImport", () => {
  it("extracts ResultHub-style text totals and points by stake", () => {
    expect(
      parseBattleRoyaleLeaderboardObservedImport(`
        LB prizes: $4,016
        Tournaments in profile: 76 238
        pts $0.25: 219114
        pts $1: 2,202,653
        pts $3: 584513
        pts $10: 0
        pts $25: 0
      `),
    ).toEqual({
      totalPrizes: 4016,
      totalTournaments: 76238,
      pointsByStake: {
        "0.25": 219114,
        "1": 2202653,
        "3": 584513,
        "10": 0,
        "25": 0,
      },
    });
  });

  it("extracts nested JSON exports", () => {
    expect(
      parseBattleRoyaleLeaderboardObservedImport(
        JSON.stringify({
          resultHub: {
            leaderboardPrizes: 350,
            battleRoyaleTournamentCount: 7000,
            points: {
              pts_0_25: 10,
              pts_1: 20,
              pts_3: 30,
            },
          },
        }),
      ),
    ).toMatchObject({
      totalPrizes: 350,
      totalTournaments: 7000,
      pointsByStake: {
        "1": 20,
        "3": 30,
      },
    });
  });
});
