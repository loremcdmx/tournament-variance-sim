import { describe, expect, it, vi } from "vitest";
import { calibrateShelledItm } from "./finishModel";
import { compileSchedule } from "./engine";
import { validateSchedule } from "./validation";
import { computeRowStats } from "./previewRowStats";
import { applyGameType } from "./gameType";
import type { FinishModelConfig, TournamentRow } from "./types";

vi.mock("./finishModel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./finishModel")>();
  return { ...actual, calibrateShelledItm: vi.fn(actual.calibrateShelledItm) };
});

describe("the cash side Run's gate solves on a bounty row", () => {
  it("is the one the engine plays: same target, capped at the row's total winnings", () => {
    // PKO 30 at ITM 30%, ROI 0%: the 1/N solution's cash side overpays even
    // the row's total winnings ($110), so the first place the row keeps
    // depends on the most cash it plays: P(1st)·N 0.646 at its total, the
    // natural 0.011 at its cash target ($55). The verdict reads that cash only
    // through the bounty ceiling, so it cannot tell a gate that solved a pmf
    // the engine never plays.
    const model: FinishModelConfig = { id: "powerlaw-realdata-influenced" };
    let row: TournamentRow = { id: "r", players: 30, buyIn: 100, rake: 0.1, roi: 0, payoutStructure: "mtt-standard", count: 1 };
    row = { ...row, ...applyGameType(row, "pko"), players: 30, itmRate: 0.3 };
    const solves = (run: () => unknown) => {
      vi.mocked(calibrateShelledItm).mockClear();
      run();
      return vi.mocked(calibrateShelledItm).mock.calls.map((args) => ({ target: args[4], cap: args[9] }));
    };
    const engine = solves(() =>
      compileSchedule({ schedule: [row], scheduleRepeats: 1, samples: 1, bankroll: 0, seed: 1, finishModel: model }),
    );
    const gate = solves(() => validateSchedule([row], model));
    const preview = solves(() => computeRowStats(row, model));
    expect(engine).toHaveLength(1);
    expect(engine[0].cap).toBeCloseTo(110, 10);
    expect(engine[0].target).toBeLessThan(engine[0].cap as number);
    expect(gate).toEqual(engine);
    expect(preview).toContainEqual(engine[0]);
  });
});
