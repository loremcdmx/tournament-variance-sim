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
  const solves = (run: () => unknown) => {
    vi.mocked(calibrateShelledItm).mockClear();
    run();
    return vi.mocked(calibrateShelledItm).mock.calls.map((args) => ({ target: args[4], cap: args[9] }));
  };
  const layers = (row: TournamentRow, model: FinishModelConfig) => ({
    engine: solves(() =>
      compileSchedule({ schedule: [row], scheduleRepeats: 1, samples: 1, bankroll: 0, seed: 1, finishModel: model }),
    ),
    gate: solves(() => validateSchedule([row], model)),
    preview: solves(() => computeRowStats(row, model, { skipCompiledSigma: true })),
  });

  it("is the one the engine plays: same targets, capped at the total less the KO EV the places guarantee", () => {
    // PKO 30 at ITM 30%, ROI +10%: the 1/N solution's cash side overpays even
    // the row's total winnings ($121), so the first place the row keeps
    // depends on the most cash it plays. Capped at the total it leaves $6.85 of
    // KO EV at P(1st)·N 1.0, under the $11.92 its places guarantee there, so
    // the cap comes down until the cash side leaves what the places of its own
    // solve guarantee: $10.99 at P(1st)·N 0.647. The verdict reads that cash
    // only through the KO EV's bounds, so it cannot tell a gate that solved a
    // pmf the engine never plays.
    const model: FinishModelConfig = { id: "powerlaw-realdata-influenced" };
    let row: TournamentRow = { id: "r", players: 30, buyIn: 100, rake: 0.1, roi: 0.1, payoutStructure: "mtt-standard", count: 1 };
    row = { ...row, ...applyGameType(row, "pko"), players: 30, itmRate: 0.3 };
    const { engine, gate, preview } = layers(row, model);
    expect(engine[0].cap).toBeCloseTo(121, 10);
    expect(engine[0].target).toBeLessThan(engine[0].cap as number);
    expect(engine.length).toBeGreaterThan(1);
    expect(engine.slice(1).every(({ target, cap }) => (cap as number) < 121 && (cap as number) >= (target as number))).toBe(true);
    expect(gate).toEqual(engine);
    expect(preview).toEqual(engine);
    expect(validateSchedule([row], model).ok).toBe(true);
  });

  it("solves the same in every layer where no cap lets the row pay its ROI", () => {
    // The reported Battle Royale row: 21 entrants, ITM 54 %, ROI -5 %. Off the
    // 18-max table the shelled solver plays it, and the least cash it can ask
    // for still leaves less than the KO EV its places guarantee.
    const model: FinishModelConfig = { id: "powerlaw-realdata-influenced" };
    let row: TournamentRow = { id: "br", players: 18, buyIn: 10, rake: 0.1, roi: 0, payoutStructure: "mtt-standard", count: 1 };
    row = { ...row, ...applyGameType(row, "mystery-royale"), lateRegMultiplier: 1.17, itmRate: 0.54, roi: -0.05 };
    const { engine, gate, preview } = layers(row, model);
    expect(engine.at(-1)?.cap).toBeLessThan(0.1);
    expect(gate).toEqual(engine);
    expect(preview).toEqual(engine);
    expect(validateSchedule([row], model).ok).toBe(false);
  });
});
