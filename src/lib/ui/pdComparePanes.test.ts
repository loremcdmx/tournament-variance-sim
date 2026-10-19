import { describe, expect, it } from "vitest";
import { DICT } from "@/lib/i18n/dict";
import { pdComparePaneKeys } from "./pdComparePanes";

const base = {
  pdPresetFlip: false,
  pdPkoFallback: false,
  hasPrimeDopePane: true,
  oursCapKey: "chart.trajectory.ours.cap",
} as const;

describe("pdComparePaneKeys", () => {
  it("puts the PD toggles on the comparison pane when PrimeDope is the right pane", () => {
    const keys = pdComparePaneKeys(base);
    expect(keys.pdPane).toBe("comparison");
    expect(keys.primaryCapKey).toBe("chart.trajectory.ours.cap");
    expect(keys.comparisonCapKey).toBe("chart.trajectory.theirs.cap");
  });

  it("keeps the custom-preset caption on the primary pane without a flip", () => {
    const keys = pdComparePaneKeys({ ...base, oursCapKey: "chart.trajectory.ours.cap.custom" });
    expect(keys.primaryCapKey).toBe("chart.trajectory.ours.cap.custom");
  });

  it("puts the PD toggles on the primary pane under the Like PrimeDope preset", () => {
    expect(pdComparePaneKeys({ ...base, pdPresetFlip: true }).pdPane).toBe("primary");
  });

  it("gives the flipped right pane its own caption, not the two-random-runs one", () => {
    const keys = pdComparePaneKeys({ ...base, pdPresetFlip: true });
    expect(keys.comparisonCapKey).not.toBe("twin.runB.cap");
    expect(keys.comparisonCapKey).toBe("chart.trajectory.ours.cap.pdPreset");
    expect(keys.primaryCapKey).toBe("chart.trajectory.theirs.cap");
  });

  it("describes the stripped-bounty PD pane on the left when the flip meets a PKO schedule", () => {
    const keys = pdComparePaneKeys({ ...base, pdPresetFlip: true, pdPkoFallback: true });
    expect(keys.pdPane).toBe("primary");
    expect(keys.primaryCapKey).toBe("chart.trajectory.noKoCap");
  });

  it("does not say only the model differs when the PD pane has its bounties stripped", () => {
    const keys = pdComparePaneKeys({ ...base, pdPresetFlip: true, pdPkoFallback: true });
    expect(keys.comparisonCapKey).toBe("chart.trajectory.ours.cap.pdPresetNoKo");
    expect(keys.comparisonCapKey).not.toBe("chart.trajectory.ours.cap.pdPreset");
    expect(DICT["chart.trajectory.ours.cap.pdPresetNoKo"].en).toMatch(/bount/i);
    expect(DICT["chart.trajectory.ours.cap.pdPresetNoKo"].ru).toMatch(/нок/);
    expect(DICT["chart.trajectory.ours.cap.pdPresetNoKo"].en).not.toMatch(/only the model differs/i);
  });

  it("keeps the same-seed wording for the flip without bounties", () => {
    const keys = pdComparePaneKeys({ ...base, pdPresetFlip: true });
    expect(keys.comparisonCapKey).toBe("chart.trajectory.ours.cap.pdPreset");
  });

  it("keeps the no-KO caption on the right pane for a PKO schedule without a flip", () => {
    const keys = pdComparePaneKeys({ ...base, pdPkoFallback: true });
    expect(keys.comparisonCapKey).toBe("chart.trajectory.noKoCap");
    expect(keys.pdPane).toBe("comparison");
  });

  it("falls back to the two-random-runs captions when there is no PrimeDope pane", () => {
    const keys = pdComparePaneKeys({ ...base, hasPrimeDopePane: false });
    expect(keys.primaryCapKey).toBe("twin.runA.cap");
    expect(keys.comparisonCapKey).toBe("twin.runB.cap");
  });

  describe("whichever pane pdPane names carries the PrimeDope caption, in every flag combination", () => {
    const flags = [false, true];
    const pdCaptions: string[] = ["chart.trajectory.theirs.cap", "chart.trajectory.noKoCap"];
    const combos = flags.flatMap((pdPresetFlip) =>
      flags.flatMap((pdPkoFallback) =>
        flags
          .filter((hasPrimeDopePane) => pdPresetFlip || hasPrimeDopePane)
          .map((hasPrimeDopePane) => ({ ...base, pdPresetFlip, pdPkoFallback, hasPrimeDopePane })),
      ),
    );

    it.each(combos)("flip=$pdPresetFlip pko=$pdPkoFallback pdPane=$hasPrimeDopePane", (input) => {
      const keys = pdComparePaneKeys(input);
      const otherPane = keys.pdPane === "primary" ? "comparison" : "primary";
      const caption = (pane: "primary" | "comparison") =>
        pane === "primary" ? keys.primaryCapKey : keys.comparisonCapKey;

      expect(caption(keys.pdPane)).toBe(
        input.pdPkoFallback ? "chart.trajectory.noKoCap" : "chart.trajectory.theirs.cap",
      );
      expect(pdCaptions).not.toContain(caption(otherPane));
      expect(caption(otherPane)).not.toMatch(/^twin\./);
      if (input.pdPkoFallback) {
        // The stripped-bounty PrimeDope pane is never one that only the model separates from ours.
        expect(DICT[caption(otherPane)].en).not.toMatch(/only the model differs/i);
        expect(DICT[caption(otherPane)].ru).not.toMatch(/отличается только модель/i);
      }
    });
  });

  it("does not claim a different seed for the flipped right pane", () => {
    expect(DICT["chart.trajectory.ours.cap.pdPreset"].en).not.toMatch(/different seed/i);
    expect(DICT["chart.trajectory.ours.cap.pdPreset"].en).toMatch(/same seed/i);
    expect(DICT["chart.trajectory.ours.cap.pdPreset"].ru).toMatch(/том же сиде/);
  });
});
