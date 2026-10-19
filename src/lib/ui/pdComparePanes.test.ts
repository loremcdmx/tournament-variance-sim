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
    expect(keys.togglesPane).toBe("comparison");
    expect(keys.primaryCapKey).toBe("chart.trajectory.ours.cap");
    expect(keys.comparisonCapKey).toBe("chart.trajectory.theirs.cap");
  });

  it("keeps the custom-preset caption on the primary pane without a flip", () => {
    const keys = pdComparePaneKeys({ ...base, oursCapKey: "chart.trajectory.ours.cap.custom" });
    expect(keys.primaryCapKey).toBe("chart.trajectory.ours.cap.custom");
  });

  it("puts the PD toggles on the primary pane under the Like PrimeDope preset", () => {
    expect(pdComparePaneKeys({ ...base, pdPresetFlip: true }).togglesPane).toBe("primary");
  });

  it("gives the flipped right pane its own caption, not the two-random-runs one", () => {
    const keys = pdComparePaneKeys({ ...base, pdPresetFlip: true });
    expect(keys.comparisonCapKey).not.toBe("twin.runB.cap");
    expect(keys.comparisonCapKey).toBe("chart.trajectory.ours.cap.pdPreset");
    expect(keys.primaryCapKey).toBe("chart.trajectory.theirs.cap");
  });

  it("describes the stripped-bounty PD pane on the left when the flip meets a PKO schedule", () => {
    const keys = pdComparePaneKeys({ ...base, pdPresetFlip: true, pdPkoFallback: true });
    expect(keys.togglesPane).toBe("primary");
    expect(keys.primaryCapKey).toBe("chart.trajectory.noKoCap");
    expect(keys.comparisonCapKey).toBe("chart.trajectory.ours.cap.pdPreset");
  });

  it("keeps the no-KO caption on the right pane for a PKO schedule without a flip", () => {
    const keys = pdComparePaneKeys({ ...base, pdPkoFallback: true });
    expect(keys.comparisonCapKey).toBe("chart.trajectory.noKoCap");
    expect(keys.togglesPane).toBe("comparison");
  });

  it("falls back to the two-random-runs captions when there is no PrimeDope pane", () => {
    const keys = pdComparePaneKeys({ ...base, hasPrimeDopePane: false });
    expect(keys.primaryCapKey).toBe("twin.runA.cap");
    expect(keys.comparisonCapKey).toBe("twin.runB.cap");
  });

  it("only returns keys that exist in both locales", () => {
    const flags = [false, true];
    for (const pdPresetFlip of flags) {
      for (const pdPkoFallback of flags) {
        for (const hasPrimeDopePane of flags) {
          const keys = pdComparePaneKeys({ ...base, pdPresetFlip, pdPkoFallback, hasPrimeDopePane });
          for (const k of [keys.primaryCapKey, keys.comparisonCapKey]) {
            expect(DICT[k].en.length).toBeGreaterThan(0);
            expect(DICT[k].ru.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("does not claim a different seed for the flipped right pane", () => {
    expect(DICT["chart.trajectory.ours.cap.pdPreset"].en).not.toMatch(/different seed/i);
    expect(DICT["chart.trajectory.ours.cap.pdPreset"].en).toMatch(/same seed/i);
    expect(DICT["chart.trajectory.ours.cap.pdPreset"].ru).toMatch(/том же сиде/);
  });
});
