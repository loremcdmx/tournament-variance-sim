import { describe, expect, it } from "vitest";
import type { ControlsState } from "@/components/ControlsPanel";
import { SCENARIOS } from "@/lib/scenarios";
import { controlsForLoadedState } from "./loadedControls";

const defaults = { ...SCENARIOS[0].controls, seed: 42, bankroll: 0, rakebackPct: 20 } as ControlsState;

describe("controlsForLoadedState", () => {
  it("keeps the session seed over the one a preset was saved or imported with", () => {
    const saved = { ...defaults, seed: 7, bankroll: 1000 };
    const next = controlsForLoadedState(defaults, saved, 987654321);
    expect(next.seed).toBe(987654321);
    expect(next.bankroll).toBe(1000);
  });

  it("fills what an older save omitted from the defaults", () => {
    const next = controlsForLoadedState(defaults, { bankroll: 50 }, 5);
    expect(next.rakebackPct).toBe(20);
    expect(next.bankroll).toBe(50);
    expect(next.seed).toBe(5);
  });
});
