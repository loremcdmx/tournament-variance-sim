import { describe, expect, it } from "vitest";
import { SCENARIOS } from "@/lib/scenarios";
import { countScheduleTournaments } from "@/lib/sim/scheduleTarget";
import { battleRoyaleRowFromTotalTicket } from "@/lib/sim/battleRoyaleTicket";
import { buyInLabel, presetCardSummary } from "./presetCardSummary";

describe("buyInLabel", () => {
  it("rounds float noise to cents and drops trailing zeros", () => {
    expect(battleRoyaleRowFromTotalTicket(3).buyIn).toBe(2.7600000000000002);
    expect(buyInLabel(battleRoyaleRowFromTotalTicket(3).buyIn)).toBe("$2.76");
    expect(buyInLabel(50)).toBe("$50");
    expect(buyInLabel(0.5)).toBe("$0.5");
    expect(buyInLabel(9.2)).toBe("$9.2");
    expect(buyInLabel(0.01)).toBe("$0.01");
  });
});

describe("presetCardSummary", () => {
  it("counts the tournaments the loaded preset plays per sample, repeats included", () => {
    const schedule = [
      { count: 30, buyIn: 55 },
      { count: 40, buyIn: 215 },
    ];
    expect(presetCardSummary(schedule, 16)).toEqual({ total: 1120, range: "$55–215" });
    expect(presetCardSummary(schedule, 1).total).toBe(70);
  });

  it("reads repeats the way the controls panel does (at least one, whole)", () => {
    expect(presetCardSummary([{ count: 5, buyIn: 10 }], 0).total).toBe(5);
    expect(presetCardSummary([{ count: 5, buyIn: 10 }], 2.9).total).toBe(10);
  });

  it("prints one price when the rows only differ by float noise", () => {
    const rows = [
      { count: 1, buyIn: 2.7600000000000002 },
      { count: 1, buyIn: 2.76 },
    ];
    expect(presetCardSummary(rows, 1).range).toBe("$2.76");
  });

  it("prints a mixed Battle Royale range without noise", () => {
    const rows = [3, 10, 25].map((ticket) => ({
      count: 1,
      buyIn: battleRoyaleRowFromTotalTicket(ticket).buyIn,
    }));
    expect(presetCardSummary(rows, 1).range).toBe("$2.76–23");
  });

  it("matches the controls panel volume for every built-in scenario", () => {
    for (const s of SCENARIOS) {
      const card = presetCardSummary(s.schedule, s.controls.scheduleRepeats);
      expect(card.total, s.id).toBe(
        countScheduleTournaments(s.schedule) * Math.max(1, s.controls.scheduleRepeats),
      );
      expect(card.range, s.id).not.toMatch(/\d\.\d{3,}/);
    }
  });

  it("has an empty range for an empty schedule instead of Infinity", () => {
    expect(presetCardSummary([], 1)).toEqual({ total: 0, range: "" });
  });
});
