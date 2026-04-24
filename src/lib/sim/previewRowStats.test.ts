import { describe, expect, it } from "vitest";
import { battleRoyaleRowFromTotalTicket } from "./battleRoyaleTicket";
import { computeRowStats } from "./previewRowStats";
import type { TournamentRow } from "./types";

describe("computeRowStats", () => {
  it("uses configured Battle Royale bountyFraction as the neutral KO EV share", () => {
    const ticket = battleRoyaleRowFromTotalTicket(10);
    const row: TournamentRow = {
      id: "br",
      label: "br",
      players: 18,
      buyIn: ticket.buyIn,
      rake: ticket.rake,
      roi: 0,
      gameType: "mystery-royale",
      payoutStructure: "battle-royale",
      bountyFraction: 0.45,
      mysteryBountyVariance: 1.8,
      itmRate: 0.2,
      count: 1,
      bountyEvBias: 0,
    };

    const stats = computeRowStats(row, { id: "power-law" });

    expect(stats.bountyShare).toBeCloseTo(0.45, 10);
    expect(stats.cashEvPerEntry / stats.evPerEntry).toBeCloseTo(0.55, 10);
  });
});
