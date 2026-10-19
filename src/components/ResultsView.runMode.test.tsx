import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DICT, type DictKey } from "@/lib/i18n/dict";
import { RunModeSlider } from "./ResultsView";

const t = ((key: DictKey) => DICT[key].en) as Parameters<typeof RunModeSlider>[0]["t"];

// A radio group promises arrow-key movement and one tab stop; three plain
// buttons give neither, so the group is announced as a group of toggles.
describe("run-mode picker semantics", () => {
  const markup = renderToStaticMarkup(<RunModeSlider value="best" onChange={() => {}} t={t} />);

  it("is a labelled group of toggle buttons, not a radio group", () => {
    expect(markup).not.toContain('role="radio');
    expect(markup).not.toContain("aria-checked");
    expect(markup).toContain('role="group"');
    expect(markup).toContain(`aria-label="${DICT["runs.mode.title"].en}"`);
  });

  it("marks only the active mode as pressed", () => {
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(markup.match(/aria-pressed="false"/g)).toHaveLength(2);
    expect(markup).toMatch(/aria-pressed="true"[^>]*>[^<]*best/i);
  });
});
