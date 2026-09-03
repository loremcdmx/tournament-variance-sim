import { describe, expect, it } from "vitest";
import { battleRoyaleRowFromTotalTicket } from "./battleRoyaleTicket";
import { compileSchedule } from "./engine";
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

describe("computeRowStats mirrors the engine on guaranteed bounty rows", () => {
  it("matches compiled ITM / α / EV when the guarantee exceeds N·buyIn", () => {
    const row: TournamentRow = {
      id: "pko-g",
      label: "pko-g",
      players: 100,
      buyIn: 10,
      rake: 0.1,
      roi: 0.1,
      gameType: "pko",
      payoutStructure: "mtt-gg-bounty",
      bountyFraction: 0.5,
      guarantee: 2000,
      count: 1,
    };
    const model = { id: "power-law" as const };
    const entry = compileSchedule({
      schedule: [row],
      scheduleRepeats: 1,
      samples: 1,
      bankroll: 100,
      seed: 1,
      finishModel: model,
    }).flat[0];
    const stats = computeRowStats(row, model);

    let cashPool = 0;
    for (let i = 0; i < entry.prizeByPlace.length; i++) {
      cashPool += entry.prizeByPlace[i];
    }
    expect(cashPool).toBeCloseTo(1500, 6);
    expect(stats.itm).toBeCloseTo(entry.itm, 4);
    expect(stats.alpha).toBeCloseTo(entry.alpha, 4);
    expect(stats.evPerEntry).toBeCloseTo(entry.analyticMeanSingle, 4);
  });
});
