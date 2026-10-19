import React, { type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DICT } from "@/lib/i18n/dict";
import { RunActionButton, RunProgress } from "./ControlsPanel";

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

describe("run progress for assistive technology", () => {
  const html = (over: Partial<Parameters<typeof RunProgress>[0]>) =>
    renderToStaticMarkup(
      <RunProgress
        barState="running"
        runToken={1}
        progress={0.857}
        stage="simulating"
        running
        hasDone={false}
        t={(key) => DICT[key].en}
        {...over}
      />,
    );

  it("exposes the bar as a named progressbar with its percent", () => {
    const markup = html({});
    expect(markup).toMatch(/role="progressbar"/);
    expect(markup).toContain(`aria-label="${DICT["controls.progress"].en}"`);
    expect(markup).toContain('aria-valuemin="0"');
    expect(markup).toContain('aria-valuemax="100"');
    expect(markup).toContain('aria-valuenow="85"');
  });

  it("says 100 while the finished bar is held, and mounts no bar at rest", () => {
    expect(html({ barState: "completing", running: false, hasDone: true })).toContain('aria-valuenow="100"');
    expect(html({ barState: "hidden", running: false })).not.toContain("progressbar");
  });

  it("keeps a status region in the page at rest, empty, so a later change is announced", () => {
    const idle = html({ barState: "hidden", running: false, stage: null });
    expect(idle).toMatch(/<div role="status" class="sr-only"><\/div>/);
  });

  it("puts the stage, then Done, in the status region, and never the ticking ETA", () => {
    expect(html({})).toContain(`class="sr-only">${DICT["controls.stage.simulating"].en}</div>`);
    expect(html({ stage: null })).toContain(`class="sr-only">${DICT["controls.starting"].en}</div>`);
    expect(html({ barState: "hidden", running: false, hasDone: true })).toContain(
      `class="sr-only">${DICT["controls.done.label"].en}</div>`,
    );
  });
});
