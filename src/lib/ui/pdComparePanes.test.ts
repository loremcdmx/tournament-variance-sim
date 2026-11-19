import { describe, expect, it } from "vitest";
import { DICT } from "@/lib/i18n/dict";
import { pdComparePaneKeys, pdDiffCopyKeys, pdOverlayLabelKeys } from "./pdComparePanes";

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

describe("which pane ran with its bounties stripped", () => {
  it("is the PrimeDope pane on a bounty schedule, left under the preset and right otherwise", () => {
    expect(pdComparePaneKeys({ ...base, pdPkoFallback: true }).bountyStrippedPane).toBe("comparison");
    expect(pdComparePaneKeys({ ...base, pdPresetFlip: true, pdPkoFallback: true }).bountyStrippedPane)
      .toBe("primary");
  });

  it("is neither pane when no pass dropped its bounties", () => {
    expect(pdComparePaneKeys(base).bountyStrippedPane).toBeNull();
    expect(pdComparePaneKeys({ ...base, pdPresetFlip: true }).bountyStrippedPane).toBeNull();
    expect(pdComparePaneKeys({ ...base, hasPrimeDopePane: false }).bountyStrippedPane).toBeNull();
  });
});

describe("pdOverlayLabelKeys", () => {
  it("names the second pass PrimeDope only when it really is the binary-ITM pass", () => {
    const keys = pdOverlayLabelKeys({ pdPresetFlip: false, pdPkoFallback: false });
    expect(keys).toEqual({
      secondIsOurs: false,
      overlayKey: null,
      badgeKey: null,
      primaryLegendKey: null,
    });
  });

  it("names the stripped-bounty second pass for a PKO schedule", () => {
    const keys = pdOverlayLabelKeys({ pdPresetFlip: false, pdPkoFallback: true });
    expect(keys.overlayKey).toBe("chart.overlay.freezeouts");
    expect(keys.badgeKey).toBe("stat.pd.badge.freezeouts");
    expect(keys.secondIsOurs).toBe(false);
    expect(keys.primaryLegendKey).toBeNull();
  });

  it("calls the second pass ours and the first PrimeDope under the Like PrimeDope preset", () => {
    const keys = pdOverlayLabelKeys({ pdPresetFlip: true, pdPkoFallback: false });
    expect(keys.secondIsOurs).toBe(true);
    expect(keys.overlayKey).toBeNull();
    expect(keys.badgeKey).toBe("stat.pd.badge.ours");
    expect(keys.primaryLegendKey).toBe("pd.model.primedope");
  });

  it("does not call our bounty-carrying pass freezeouts when the flip meets a PKO schedule", () => {
    const keys = pdOverlayLabelKeys({ pdPresetFlip: true, pdPkoFallback: true });
    expect(keys.secondIsOurs).toBe(true);
    expect(keys.badgeKey).toBe("stat.pd.badge.ours");
    expect(keys.overlayKey).toBeNull();
  });

  it("has a badge text in both languages", () => {
    expect(DICT["stat.pd.badge.ours"].en).toBeTruthy();
    expect(DICT["stat.pd.badge.ours"].ru).toBeTruthy();
  });
});

describe("pdDiffCopyKeys", () => {
  it("keeps the PrimeDope diff texts when no pass drops its bounties", () => {
    for (const pdPresetFlip of [false, true]) {
      expect(pdDiffCopyKeys({ pdPresetFlip, pdPkoFallback: false })).toEqual({
        sectionKey: "section.pdDiff", titleKey: "pd.title", subtitleKey: "pd.subtitle", theirsLabelKey: null,
      });
    }
  });

  it("names both differences when the PrimeDope column has its bounties stripped, on either side", () => {
    const right = pdDiffCopyKeys({ pdPresetFlip: false, pdPkoFallback: true });
    const left = pdDiffCopyKeys({ pdPresetFlip: true, pdPkoFallback: true });
    expect(right.subtitleKey).toBe("pd.subtitle.freezeouts");
    expect(left.subtitleKey).toBe("pd.subtitle.pdPresetNoKo");
    for (const key of [right.subtitleKey, left.subtitleKey]) {
      expect(DICT[key].en).toMatch(/two differences/);
      expect(DICT[key].en).toMatch(/PrimeDope/);
      expect(DICT[key].en).toMatch(/bount/);
      expect(DICT[key].en).not.toMatch(/only difference/i);
      expect(DICT[key].ru).toMatch(/отличий два/);
      expect(DICT[key].ru).toMatch(/PrimeDope/);
      expect(DICT[key].ru).toMatch(/нок/);
      expect(DICT[key].ru).not.toMatch(/отличаются только|отличается только/);
    }
  });

  it("calls the stripped-bounty PrimeDope pass PrimeDope wherever it is named", () => {
    const keys = [
      "pd.title.freezeouts", "section.pdDiff.freezeouts", "chart.overlay.freezeouts",
      "chart.trajectory.noKoLabel", "chart.trajectory.noKoCap", "chart.legend.noKoOverlay",
      "chart.trajectory.overlayNoKo", "chart.trajectory.overlayNoKoHint", "stat.pd.badge.freezeouts",
    ] as const;
    for (const key of keys) {
      expect(DICT[key].en, key).toMatch(/PrimeDope|PD/);
      expect(DICT[key].ru, key).toMatch(/PrimeDope|PD/);
    }
  });
});
