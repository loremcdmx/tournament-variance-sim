import { describe, expect, it } from "vitest";

import {
  allTimeBrLeaderboardWindow,
  parseGgBrStakeResponse,
  sanitizeUsernameForLookup,
} from "./resulthubLookup";

describe("parseGgBrStakeResponse", () => {
  const window = { from: "2026-04-01", to: "2026-04-25" };

  it("sums prizes across stakes and maps stake names to UI keys", () => {
    const summary = parseGgBrStakeResponse(
      [
        {
          gameType: { name: "BATTLE_ROYALE" },
          results: [
            { totalPrize: 70, totalPoints: 15698, stake: { name: "BR_10" } },
            { totalPrize: 3050, totalPoints: 223476, stake: { name: "BR_25" } },
            { totalPrize: 12, totalPoints: 880, stake: { name: "BR_0_25" } },
            { totalPrize: 50, totalPoints: 4400, stake: { name: "BR_1" } },
            { totalPrize: 100, totalPoints: 11500, stake: { name: "BR_3" } },
          ],
        },
      ],
      window,
    );
    expect(summary.totalPrizes).toBe(70 + 3050 + 12 + 50 + 100);
    expect(summary.pointsByStake).toEqual({
      "0.25": 880,
      "1": 4400,
      "3": 11500,
      "10": 15698,
      "25": 223476,
    });
    expect(summary.window).toEqual(window);
  });

  it("ignores non-BATTLE_ROYALE blocks and unknown stakes", () => {
    const summary = parseGgBrStakeResponse(
      [
        {
          gameType: { name: "HOLDEM" },
          results: [
            { totalPrize: 9999, totalPoints: 9999, stake: { name: "BR_25" } },
          ],
        },
        {
          gameType: { name: "BATTLE_ROYALE" },
          results: [
            { totalPrize: 100, totalPoints: 1000, stake: { name: "BR_999" } },
            { totalPrize: 200, totalPoints: 2000, stake: { name: "BR_25" } },
          ],
        },
      ],
      window,
    );
    expect(summary.totalPrizes).toBe(300); // unknown stake still counts toward prize total
    expect(summary.pointsByStake["25"]).toBe(2000);
    expect(summary.pointsByStake["10"]).toBe(0);
  });

  it("returns a zeroed summary on garbage input rather than throwing", () => {
    const a = parseGgBrStakeResponse(null, window);
    const b = parseGgBrStakeResponse([{}], window);
    const c = parseGgBrStakeResponse(
      [{ gameType: { name: "BATTLE_ROYALE" }, results: "oops" }],
      window,
    );
    for (const summary of [a, b, c]) {
      expect(summary.totalPrizes).toBe(0);
      expect(summary.pointsByStake).toEqual({
        "0.25": 0,
        "1": 0,
        "3": 0,
        "10": 0,
        "25": 0,
      });
      expect(summary.window).toEqual(window);
    }
  });

  it("clamps negative numbers to zero", () => {
    const summary = parseGgBrStakeResponse(
      [
        {
          gameType: { name: "BATTLE_ROYALE" },
          results: [
            { totalPrize: -50, totalPoints: -1, stake: { name: "BR_25" } },
          ],
        },
      ],
      window,
    );
    expect(summary.totalPrizes).toBe(0);
    expect(summary.pointsByStake["25"]).toBe(0);
  });
});

describe("allTimeBrLeaderboardWindow", () => {
  it("anchors `from` at the pre-launch sentinel and `to` at today (UTC)", () => {
    const w = allTimeBrLeaderboardWindow(new Date(Date.UTC(2026, 3, 25, 14, 0)));
    expect(w.from).toBe("2020-01-01");
    expect(w.to).toBe("2026-04-25");
  });

  it("uses UTC day on early-morning local times near month boundary", () => {
    const w = allTimeBrLeaderboardWindow(new Date(Date.UTC(2026, 4, 1, 0, 30)));
    expect(w.from).toBe("2020-01-01");
    expect(w.to).toBe("2026-05-01");
  });
});

describe("sanitizeUsernameForLookup", () => {
  it("strips control chars, trims, caps at 64", () => {
    expect(sanitizeUsernameForLookup("  hello\nworld  ")).toBe("helloworld");
    expect(sanitizeUsernameForLookup("a".repeat(200))).toHaveLength(64);
    expect(sanitizeUsernameForLookup("ник тест")).toBe("ник тест");
  });
});
