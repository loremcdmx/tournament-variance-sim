import { describe, expect, it } from "vitest";
import {
  battleRoyaleBountyShareOfNetPool,
  battleRoyaleRowFromTotalTicket,
} from "./battleRoyaleTicket";
import { makeBrTierSampler } from "./brBountyTiers";
import { compileSchedule } from "./compile";
import { applyGameType, BATTLE_ROYALE_PLAYERS, DEFAULT_BATTLE_ROYALE_BOUNTY_FRACTION } from "./gameType";
import { SCENARIOS } from "@/lib/scenarios";
import type { TournamentRow } from "./types";

const TIERS = [0.25, 1, 3, 10, 25];

function brRow(ticket: number): TournamentRow {
  const base: TournamentRow = {
    id: "br", players: 18, ...battleRoyaleRowFromTotalTicket(ticket), roi: 0.03,
    payoutStructure: "mtt-standard", count: 1,
  };
  return { ...base, ...applyGameType(base, "mystery-royale"), ...battleRoyaleRowFromTotalTicket(ticket) };
}

describe("Battle Royale bounty share of the net pool", () => {
  it("is 8 envelopes of 0.945 tickets over 18 net tickets: 7.56 / 16.56 = 21/46", () => {
    expect(battleRoyaleBountyShareOfNetPool(18)).toBeCloseTo(7.56 / 16.56, 12);
    expect(battleRoyaleBountyShareOfNetPool(18)).toBeCloseTo(21 / 46, 12);
  });

  it("rests on a table whose mean envelope is 0.945 x ticket in every published tier", () => {
    for (const ticket of TIERS) {
      const sampler = makeBrTierSampler(battleRoyaleRowFromTotalTicket(ticket).buyIn);
      expect(sampler.meanValue / ticket).toBeCloseTo(0.945, 7);
    }
  });

  it("is the default Battle Royale bounty fraction", () => {
    expect(DEFAULT_BATTLE_ROYALE_BOUNTY_FRACTION).toBe(
      battleRoyaleBountyShareOfNetPool(BATTLE_ROYALE_PLAYERS),
    );
    expect(DEFAULT_BATTLE_ROYALE_BOUNTY_FRACTION).toBeGreaterThan(0.4565);
    expect(DEFAULT_BATTLE_ROYALE_BOUNTY_FRACTION).toBeLessThan(0.4566);
  });

  it.each(TIERS)("leaves GG's 40/30/20 cash split exactly: $%s ticket", (ticket) => {
    const entry = compileSchedule({
      schedule: [brRow(ticket)], scheduleRepeats: 1, samples: 1, bankroll: 1, seed: 1,
      finishModel: { id: "power-law" },
    }).flat[0];
    expect(entry.prizeByPlace[0]).toBeCloseTo(4 * ticket, 9);
    expect(entry.prizeByPlace[1]).toBeCloseTo(3 * ticket, 9);
    expect(entry.prizeByPlace[2]).toBeCloseTo(2 * ticket, 9);
    const cash = Array.from(entry.prizeByPlace).reduce((a, b) => a + b, 0);
    expect(cash).toBeCloseTo(9 * ticket, 9);
  });

  it("the mixed GG demo schedule starts its Battle Royale row from the same value", () => {
    const mixed = SCENARIOS.find((s) => s.id === "mixed-gg-with-br")!;
    const brRows = mixed.schedule.filter((r) => r.gameType === "mystery-royale");
    expect(brRows).toHaveLength(1);
    expect(brRows[0].bountyFraction).toBe(DEFAULT_BATTLE_ROYALE_BOUNTY_FRACTION);
  });

  it("does not leak into the Romeo PKO demo row that used to borrow the constant", () => {
    const romeo = SCENARIOS.find((s) => s.id === "romeo-pro")!;
    expect(romeo.schedule[0].gameType ?? "pko").not.toBe("mystery-royale");
    expect(romeo.schedule[0].bountyFraction).toBe(0.45);
  });
});
