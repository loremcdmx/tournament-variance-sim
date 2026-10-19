import { describe, expect, it } from "vitest";
import { canStartRun, canSwitchRun } from "./runGate";

describe("canStartRun", () => {
  const ready = { activeMode: "mtt", mttModel: "mechanical", status: "idle" } as const;

  it("is blocked only by a run in flight, never by a PrimeDope-only re-run", () => {
    expect(canStartRun(ready)).toBe(true);
    expect(canStartRun({ ...ready, status: "done" })).toBe(true);
    expect(canStartRun({ ...ready, status: "error" })).toBe(true);
    expect(canStartRun({ ...ready, status: "running" })).toBe(false);
  });

  it("only runs the mechanical MTT simulator", () => {
    expect(canStartRun({ ...ready, activeMode: "cash" })).toBe(false);
    expect(canStartRun({ ...ready, mttModel: "empirical" })).toBe(false);
  });
});

describe("canSwitchRun", () => {
  it("moves to another cached run unless a PrimeDope re-run of the current one is computing", () => {
    expect(canSwitchRun({ pdStatus: "idle", sameRun: false })).toBe(true);
    expect(canSwitchRun({ pdStatus: "done", sameRun: false })).toBe(true);
    expect(canSwitchRun({ pdStatus: "error", sameRun: false })).toBe(true);
    expect(canSwitchRun({ pdStatus: "running", sameRun: false })).toBe(false);
  });

  it("always allows re-selecting the run that is already shown", () => {
    expect(canSwitchRun({ pdStatus: "running", sameRun: true })).toBe(true);
  });
});
