import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AlphaOverrideInput,
  changeFinishModel,
  placesReportText,
  placesWarningText,
  type ControlsState,
} from "./ControlsPanel";
import { DICT, type DictKey } from "@/lib/i18n/dict";
import type { FinishModelId } from "@/lib/sim/types";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());

describe("manual alpha control", () => {
  it.each(["power-law", "powerlaw-realdata-influenced", "uniform", "empirical"] as FinishModelId[])(
    "disables the ineffective override for %s", (modelId) => {
      const onChange = vi.fn();
      const input = AlphaOverrideInput({ modelId, value: 3, placeholder: "auto", onChange });
      expect(renderToStaticMarkup(input)).toContain('disabled=""');
      expect(input.props.value).toBe("");
      input.props.onChange({ target: { value: "0.3" } });
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it.each(["freeze-realdata-tilt", "pko-realdata-tilt", "mystery-realdata-tilt"] as FinishModelId[])(
    "accepts the complete neutral and signed tilt range for %s", (modelId) => {
      const onChange = vi.fn();
      const input = AlphaOverrideInput({ modelId, value: null, placeholder: "auto", onChange });
      const html = renderToStaticMarkup(input);
      expect(html).not.toContain('disabled=""');
      expect(html).toContain('min="-0.5"');
      expect(html).toContain('max="0.5"');
      for (const value of ["-0.5", "0", "0.5", "", "-0.6", "0.6"]) {
        input.props.onChange({ target: { value } });
      }
      expect(onChange.mock.calls).toEqual([[-0.5], [0], [0.5], [null]]);
    },
  );

  it("clears the previous family override when changing the finish model", () => {
    const before = { finishModelId: "power-law", alphaOverride: 3, modelPresetId: "naive" } as ControlsState;
    const next = changeFinishModel(before, "mystery-realdata-tilt");
    expect(next).toMatchObject({ finishModelId: "mystery-realdata-tilt", alphaOverride: null, modelPresetId: "custom" });
    expect(before.alphaOverride).toBe(3);
  });
});

describe("empirical import report", () => {
  const report = { accepted: 3, skipped: 2, maxPlace: 7, warnings: [] };

  it("shows accepted, skipped and the worst place in both locales", () => {
    expect(placesReportText(report, (key) => DICT[key].en)).toBe(
      "Accepted 3 · skipped 2 · worst place 7",
    );
    expect(placesReportText(report, (key) => DICT[key].ru)).toBe(
      "Принято 3 · пропущено 2 · худшее место 7",
    );
  });

  it("shows a dash instead of a worst place when nothing was accepted", () => {
    const empty = { ...report, accepted: 0, skipped: 4, maxPlace: 0 };
    expect(placesReportText(empty, (key) => DICT[key].ru)).toBe(
      "Принято 0 · пропущено 4 · худшее место —",
    );
  });

  it.each(["en", "ru"] as const)("fills every placeholder of the warnings in %s", (locale) => {
    const t = (key: DictKey) => DICT[key][locale];
    const first = placesWarningText({ code: "first-column", columns: 3 }, t);
    const capped = placesWarningText({ code: "capped", limit: 500_000 }, t);
    expect(first).toContain("3");
    expect(capped).toContain("500000");
    for (const text of [first, capped]) expect(text).not.toMatch(/[{}]/);
  });
});
