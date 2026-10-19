import { describe, expect, it } from "vitest";
import type { ControlsState } from "@/components/ControlsPanel";
import { SCENARIOS } from "@/lib/scenarios";
import type { TournamentRow } from "@/lib/sim/types";
import { replacingNeedsConfirm, type StateSnapshot } from "./replaceStateGuard";

const row: TournamentRow = {
  id: "r1",
  label: "",
  players: 5000,
  buyIn: 50,
  rake: 0.1,
  roi: 0.1,
  payoutStructure: "mtt-standard",
  gameType: "freezeout",
  count: 1,
};
const controls = { ...SCENARIOS[0].controls, seed: 42, empiricalBuckets: undefined } as ControlsState;
const start: StateSnapshot = { schedule: [row], controls };

describe("replacingNeedsConfirm", () => {
  it("lets a state that is still the app's starting point be replaced silently", () => {
    expect(
      replacingNeedsConfirm(
        {
          schedule: [{ ...row, id: "fresh-uuid" }],
          controls: { ...controls, seed: 123456 },
          activeScenarioId: null,
        },
        [start],
      ),
    ).toBe(false);
  });

  it("asks before dropping a schedule the user built", () => {
    const edited = { ...row, count: 5000 };
    expect(
      replacingNeedsConfirm(
        { schedule: [edited], controls, activeScenarioId: null },
        [start],
      ),
    ).toBe(true);
    expect(
      replacingNeedsConfirm(
        { schedule: [row, { ...row, id: "r2" }], controls, activeScenarioId: null },
        [start],
      ),
    ).toBe(true);
  });

  it("asks before dropping edited controls, even on the default schedule", () => {
    expect(
      replacingNeedsConfirm(
        { schedule: [row], controls: { ...controls, bankroll: 5000 }, activeScenarioId: null },
        [start],
      ),
    ).toBe(true);
    expect(
      replacingNeedsConfirm(
        { schedule: [row], controls: { ...controls, rakebackPct: 33 }, activeScenarioId: null },
        [start],
      ),
    ).toBe(true);
  });

  it("does not ask while an untouched scenario or preset is loaded", () => {
    expect(
      replacingNeedsConfirm(
        { schedule: [{ ...row, count: 99 }], controls, activeScenarioId: "romeo-pro" },
        [start],
      ),
    ).toBe(false);
  });

  it("ignores key order and absent optional fields", () => {
    const reordered = Object.fromEntries(Object.entries(controls).reverse()) as unknown as ControlsState;
    expect(
      replacingNeedsConfirm({ schedule: [row], controls: reordered, activeScenarioId: null }, [start]),
    ).toBe(false);
  });

  it("recognises any of several starting points", () => {
    const reset = { ...row, players: 500, buyIn: 10, roi: 0.2 };
    expect(
      replacingNeedsConfirm(
        { schedule: [{ ...reset, id: "x" }], controls, activeScenarioId: null },
        [start, { schedule: [reset], controls }],
      ),
    ).toBe(false);
  });
});
