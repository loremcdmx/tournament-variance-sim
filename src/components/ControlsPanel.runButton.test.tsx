import React, { type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunActionButton } from "./ControlsPanel";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const onRun = vi.fn();
  const onCancel = vi.fn();
  const runStartedAtRef = { current: null as number | null };
  const base = {
    t: (key: string) => key,
    locale: "en" as const,
    progress: 0.2,
    estimatedMs: 4000,
    runBlockedReason: null as string | null,
    runBlockedScrollTarget: null as string | null,
    runStartedAtRef,
    onRun,
    onCancel,
  };
  const render = (over: Partial<typeof base> & { running: boolean }) =>
    RunActionButton({ ...base, ...over } as Parameters<typeof RunActionButton>[0]) as ReactElement<{
      onClick: () => void;
    }>;
  return { onRun, onCancel, runStartedAtRef, render };
}

describe("Run / Stop / blocked button", () => {
  it("is one button element in every state, so keyboard focus stays on it", () => {
    const { render } = setup();
    const run = render({ running: false });
    const stop = render({ running: true });
    const blocked = render({ running: false, runBlockedReason: "Row 1 is infeasible" });
    for (const el of [stop, blocked]) {
      expect(el.type).toBe(run.type);
      expect(el.key).toBe(run.key);
    }
    expect(run.type).toBe("button");
    expect(run.key).toBeNull();
  });

  it("starts a run from the Run state", () => {
    const { render, onRun } = setup();
    render({ running: false }).props.onClick();
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("ignores a Stop click in the first 500 ms of the run, the second click of a double-click", () => {
    const { render, onCancel, runStartedAtRef } = setup();
    runStartedAtRef.current = performance.now();
    render({ running: true }).props.onClick();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("lets a deliberate Stop through later", () => {
    const { render, onCancel, runStartedAtRef } = setup();
    runStartedAtRef.current = performance.now() - 2000;
    render({ running: true }).props.onClick();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
