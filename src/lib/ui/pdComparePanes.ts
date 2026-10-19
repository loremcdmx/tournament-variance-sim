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
  // The PD toggles re-run the pass behind the PD pane, so they belong in its header.
  togglesPane: "primary" | "comparison";
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
      comparisonCapKey: "chart.trajectory.ours.cap.pdPreset",
      togglesPane: "primary",
    };
  }
  return {
    primaryCapKey: hasPrimeDopePane ? oursCapKey : "twin.runA.cap",
    comparisonCapKey: pdPkoFallback
      ? "chart.trajectory.noKoCap"
      : hasPrimeDopePane
        ? "chart.trajectory.theirs.cap"
        : "twin.runB.cap",
    togglesPane: "comparison",
  };
}
