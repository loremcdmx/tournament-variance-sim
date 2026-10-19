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
