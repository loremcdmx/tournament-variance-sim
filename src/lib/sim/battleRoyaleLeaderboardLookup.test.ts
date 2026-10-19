import { describe, expect, it } from "vitest";

import {
  analyzeBattleRoyaleLeaderboardLookup,
  compactBattleRoyaleLeaderboardLookupSnapshot,
  normalizeBattleRoyaleLeaderboardLookupSnapshots,
  parseBattleRoyaleLeaderboardSnapshot,
} from "./battleRoyaleLeaderboardLookup";

describe("battleRoyaleLeaderboardLookup", () => {
  it("preserves numeric nicknames without treating their suffix as points", () => {
    const parsed = parseBattleRoyaleLeaderboardSnapshot("1\tPlayer99999\t1,000\t$100\n2\tPlain\t500\t$50");
    expect(parsed.entries[0]).toEqual({ rank: 1, nickname: "Player99999", points: 1000, prize: 100 });
    expect(parseBattleRoyaleLeaderboardSnapshot("1\t99999\t1,000\t$100").entries[0])
      .toEqual({ rank: 1, nickname: "99999", points: 1000, prize: 100 });
    const analysis = analyzeBattleRoyaleLeaderboardLookup({ tournamentsPerDay: 100, pointsPerTournament: 15,
      snapshots: [{ id: "day", entries: parsed.entries }] });
    expect(analysis.averageDailyPrize).toBe(100);
  });

  it("retains imported days while the target score is zero", () => {
    const analysis = analyzeBattleRoyaleLeaderboardLookup({ tournamentsPerDay: 160, pointsPerTournament: 0,
      snapshots: [{ id: "day", entries: [{ rank: 1, points: 1000, prize: 100 }] }] });
    expect(analysis.snapshotCount).toBe(1);
    expect(analysis.days).toHaveLength(1);
    expect(analysis.averageDailyPrize).toBe(0);
    expect(analysis.paidDays).toBe(0);
  });
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

  it("keeps rows whose points have more than one thousands group", () => {
    const parsed = parseBattleRoyaleLeaderboardSnapshot(
      [
        "Rank\tPlayer\tPoints\tPrize",
        "1\tAlpha\t3,203,532\t$1,200",
        "2\tBeta\t1.234.567\t$50",
        "3\tGamma\t6,400\t$8",
      ].join("\n"),
    );
    expect(parsed.entries.map((entry) => [entry.rank, entry.points, entry.prize])).toEqual([
      [1, 3_203_532, 1200],
      [2, 1_234_567, 50],
      [3, 6400, 8],
    ]);
    expect(parsed.rejectedRows).toBe(0);

    const table = parseBattleRoyaleLeaderboardSnapshot(
      "<table><tr><td>1</td><td>Alpha</td><td>12,345,678</td><td>$100</td></tr></table>",
    );
    expect(table.entries.map((entry) => entry.points)).toEqual([12_345_678]);
  });

  it("counts rows that look like leaderboard rows but cannot be read", () => {
    const parsed = parseBattleRoyaleLeaderboardSnapshot(
      [
        "Rank\tPlayer\tPoints\tPrize",
        "1\tAlpha\t9,200\t$30",
        "2\tBeta\tn/a\t$12",
        "3\tGamma\t6,400",
      ].join("\n"),
    );
    expect(parsed.entries.map((entry) => entry.rank)).toEqual([1]);
    expect(parsed.rejectedRows).toBe(2);
  });

  it("still counts a duplicate rank as rejected", () => {
    const parsed = parseBattleRoyaleLeaderboardSnapshot(
      "1\tAlpha\t9,200\t$30\n1\tAlphaCopy\t9,100\t$20",
    );
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.rejectedRows).toBe(1);
  });

  it("stores compact rank/points/prize rows without nicknames or a hard-coded label", () => {
    const parsed = parseBattleRoyaleLeaderboardSnapshot("1\tRealNick\t9,200\t$30");
    expect(parsed.entries[0].nickname).toBe("RealNick");

    const snapshot = compactBattleRoyaleLeaderboardLookupSnapshot("lb-1", parsed.entries);
    expect(snapshot).toEqual({ id: "lb-1", entries: [{ rank: 1, points: 9200, prize: 30 }] });
    expect(JSON.stringify(snapshot)).not.toContain("RealNick");
    expect("label" in snapshot).toBe(false);
  });

  it("sheds nicknames and the old English day label from saved snapshots", () => {
    const normalized = normalizeBattleRoyaleLeaderboardLookupSnapshots([
      {
        id: "a",
        label: "Day 3",
        entries: [{ rank: 1, points: 100, prize: 5, nickname: "RealNick" }],
      },
      {
        id: "b",
        label: "Week 2 promo",
        entries: [{ rank: 2, points: 90, prize: 4, nickname: "Other" }],
      },
    ]);
    expect(normalized).toHaveLength(2);
    expect(normalized[0].label).toBeUndefined();
    expect(normalized[1].label).toBe("Week 2 promo");
    expect(JSON.stringify(normalized)).not.toMatch(/RealNick|Other/);
    expect(normalized[0].entries[0]).toMatchObject({ rank: 1, points: 100, prize: 5 });
  });
});
