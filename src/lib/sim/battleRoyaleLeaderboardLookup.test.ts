import { describe, expect, it } from "vitest";

import {
  analyzeBattleRoyaleLeaderboardLookup,
  parseBattleRoyaleLeaderboardSnapshot,
} from "./battleRoyaleLeaderboardLookup";

describe("battleRoyaleLeaderboardLookup", () => {
  it("parses rank / points / prize rows from pasted HTML table code", () => {
    const parsed = parseBattleRoyaleLeaderboardSnapshot(`
      <table>
        <tr><th>Rank</th><th>Player</th><th>Points</th><th>Prize</th></tr>
        <tr><td>#1</td><td>Alpha</td><td>9 200</td><td>$30</td></tr>
        <tr><td>#2</td><td>Beta</td><td>7,100</td><td>$12.50</td></tr>
        <tr><td>#3</td><td>Heroish</td><td>6,400</td><td>$8</td></tr>
      </table>
    `);

    expect(parsed.entries).toEqual([
      { rank: 1, nickname: "Alpha", points: 9200, prize: 30 },
      { rank: 2, nickname: "Beta", points: 7100, prize: 12.5 },
      { rank: 3, nickname: "Heroish", points: 6400, prize: 8 },
    ]);
  });

  it("converts daily target score into LB dollars per tournament", () => {
    const snapshot = {
      id: "day-1",
      entries: [
        { rank: 1, points: 9200, prize: 30 },
        { rank: 2, points: 7100, prize: 12.5 },
        { rank: 3, points: 6400, prize: 8 },
      ],
    };

    const analysis = analyzeBattleRoyaleLeaderboardLookup({
      tournamentsPerDay: 160,
      pointsPerTournament: 40,
      snapshots: [snapshot],
    });

    expect(analysis.targetPoints).toBe(6400);
    expect(analysis.averageDailyPrize).toBe(8);
    expect(analysis.payoutPerTournament).toBeCloseTo(0.05, 12);
    expect(analysis.days[0]).toMatchObject({
      rank: 3,
      points: 6400,
      prize: 8,
    });
  });

  it("also accepts JSON-like leaderboard payloads from page source", () => {
    const parsed = parseBattleRoyaleLeaderboardSnapshot(`
      window.__DATA__ = [
        {"rank":1,"nickname":"Alpha","points":9200,"prize":"$30"},
        {"rank":2,"nickname":"Beta","points":"7,100","prize":"$12.50"},
        {"rank":3,"nickname":"Heroish","points":6400,"prize":"$8"}
      ];
    `);

    expect(parsed.entries.map((entry) => [entry.rank, entry.points, entry.prize])).toEqual([
      [1, 9200, 30],
      [2, 7100, 12.5],
      [3, 6400, 8],
    ]);
  });
});
