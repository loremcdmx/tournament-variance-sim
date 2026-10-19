import type { DictKey } from "@/lib/i18n/dict";

interface PdComparePaneInput {
  // Under the "Like PrimeDope" preset the engine's primary pass is the PD
  // binary-ITM one, so PD sits in the left pane and our model on the same seed
  // in the right one.
  pdPresetFlip: boolean;
  pdPkoFallback: boolean;
  hasPrimeDopePane: boolean;
  oursCapKey: DictKey;
}

interface PdComparePaneKeys {
  primaryCapKey: DictKey;
  comparisonCapKey: DictKey;
  // The pane that holds the PrimeDope result. The PD toggles re-run its pass and
  // "Open PrimeDope" reproduces it, so both belong with that pane.
  pdPane: "primary" | "comparison";
}

export function pdComparePaneKeys({
  pdPresetFlip,
  pdPkoFallback,
  hasPrimeDopePane,
  oursCapKey,
}: PdComparePaneInput): PdComparePaneKeys {
  if (pdPresetFlip) {
    return {
      primaryCapKey: pdPkoFallback
        ? "chart.trajectory.noKoCap"
        : "chart.trajectory.theirs.cap",
      // The PD pass has no bounties on a PKO schedule, ours keeps them: the model
      // is not the only difference between the panes.
      comparisonCapKey: pdPkoFallback
        ? "chart.trajectory.ours.cap.pdPresetNoKo"
        : "chart.trajectory.ours.cap.pdPreset",
      pdPane: "primary",
    };
  }
  return {
    primaryCapKey: hasPrimeDopePane ? oursCapKey : "twin.runA.cap",
    comparisonCapKey: pdPkoFallback
      ? "chart.trajectory.noKoCap"
      : hasPrimeDopePane
        ? "chart.trajectory.theirs.cap"
        : "twin.runB.cap",
    pdPane: "comparison",
  };
}

export interface PdOverlayLabelKeys {
  // The second pass is our own model: the PrimeDope preset's primary pass is the
  // binary-ITM one, so what is laid over it is the alpha calibration.
  secondIsOurs: boolean;
  // null: the literal product name "PrimeDope", or our model's label when
  // `secondIsOurs`.
  overlayKey: DictKey | null;
  // null: the default "PD" badge.
  badgeKey: DictKey | null;
  // null: the default "our model" legend of the first pass.
  primaryLegendKey: DictKey | null;
}

export function pdOverlayLabelKeys({
  pdPresetFlip,
  pdPkoFallback,
}: {
  pdPresetFlip: boolean;
  pdPkoFallback: boolean;
}): PdOverlayLabelKeys {
  if (pdPresetFlip) {
    return {
      secondIsOurs: true,
      overlayKey: null,
      badgeKey: "stat.pd.badge.ours",
      primaryLegendKey: "pd.model.primedope",
    };
  }
  return {
    secondIsOurs: false,
    overlayKey: pdPkoFallback ? "chart.overlay.freezeouts" : null,
    badgeKey: pdPkoFallback ? "stat.pd.badge.freezeouts" : null,
    primaryLegendKey: null,
  };
}
