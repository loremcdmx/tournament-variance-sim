import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DICT } from "@/lib/i18n/dict";
import { SCENARIOS } from "@/lib/scenarios";

// The menu is closed until it is clicked and there is no DOM to click; this file
// holds it open so the markup of the open menu can be read.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => [typeof initial === "boolean" ? true : initial, () => {}],
  };
});

import { ScheduleToolbarExtras } from "./ScheduleToolbarExtras";

const t = (key: keyof typeof DICT) => DICT[key].ru;
const open = (activeScenarioId: string | null) =>
  renderToStaticMarkup(
    <ScheduleToolbarExtras
      t={t}
      activeScenarioId={activeScenarioId}
      loadScenario={() => {}}
      onReset={() => {}}
    />,
  );

describe("scenario picker markup", () => {
  const markup = open(SCENARIOS[1].id);

  it("is a disclosure of buttons, not a listbox whose options its list does not own", () => {
    expect(markup).not.toContain('role="listbox"');
    expect(markup).not.toContain('role="option"');
    expect(markup).not.toContain("aria-haspopup");
    expect(markup).not.toContain("aria-selected");
  });

  it("names the popup and ties the trigger to it", () => {
    const controls = /<button[^>]*aria-controls="([^"]+)"/.exec(markup)?.[1];
    expect(controls).toBeDefined();
    expect(markup).toMatch(new RegExp(`<div id="${controls}"[^>]*role="group"[^>]*aria-label="${DICT["demo.label"].ru}"`));
    expect(markup).toMatch(/<button[^>]*aria-expanded="true"/);
  });

  it("marks the loaded scenario and only that one", () => {
    expect(markup.match(/aria-current="true"/g)).toHaveLength(1);
    expect(markup.match(/<li>/g)).toHaveLength(SCENARIOS.length);
  });

  it("shows keyboard focus on an option instead of removing the outline", () => {
    const option = /<button[^>]*aria-current[^>]*>/.exec(markup)?.[0] ?? "";
    expect(option).toContain("focus-visible:outline");
    expect(option).not.toContain("focus:outline-none");
  });
});
