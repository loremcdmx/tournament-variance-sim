import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AlphaOverrideInput, changeFinishModel, type ControlsState } from "./ControlsPanel";
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
