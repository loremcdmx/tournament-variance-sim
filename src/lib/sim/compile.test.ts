import { describe, expect, it } from "vitest";
import { compileSchedule } from "./compile";
import { countScheduleTournaments } from "./scheduleTarget";
import type { FinishModelConfig, SimulationInput, TournamentRow } from "./types";

const model: FinishModelConfig = { id: "power-law" };

function row(id: string, count: number): TournamentRow {
  return {
    id,
    players: 100,
    buyIn: 10,
    rake: 0.1,
    roi: 0.1,
    payoutStructure: "mtt-standard",
    gameType: "freezeout",
    count,
  };
}

function compile(schedule: TournamentRow[], scheduleRepeats = 50) {
  const args: SimulationInput = {
    schedule,
    scheduleRepeats,
    samples: 10,
    bankroll: 0,
    seed: 1,
    finishModel: model,
  };
  return compileSchedule(args);
}

describe("how many times compile plays a row per pass", () => {
  it("plays a row whose count is below 1 once, like a count of 1", () => {
    const one = compile([row("a", 1)]);
    for (const count of [0, 0.5, 0.999]) {
      const compiled = compile([row("a", count)]);
      expect(compiled.flat).toHaveLength(one.flat.length);
      expect(compiled.totalBuyIn).toBe(one.totalBuyIn);
      expect(compiled.rowCounts).toEqual(one.rowCounts);
    }
    expect(one.flat).toHaveLength(50);
    expect(one.totalBuyIn).toBe(50 * 11);
  });

  it("floors a fractional count", () => {
    expect(compile([row("a", 2.7)]).rowCounts).toEqual([100]);
    expect(compile([row("a", 2.7)], 1).rowCounts).toEqual([2]);
  });

  it("agrees with the tournament count the target field shows", () => {
    const schedule = [row("a", 0), row("b", 0.5), row("c", 2.7), row("d", 4)];
    expect(compile(schedule, 1).tournamentsPerPass).toBe(countScheduleTournaments(schedule));
  });
});
