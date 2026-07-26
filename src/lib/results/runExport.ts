import type { PersistedState } from "@/lib/persistence";
import type { ControlsState } from "@/components/ControlsPanel";
import type { TournamentRow } from "@/lib/sim/types";

/**
 * Snapshot of the numbers the results header shows, in engine units
 * (money for the profit stats, fractions for the probabilities).
 * `riskOfRuin` is null when no bankroll was configured — the engine pins
 * it to 0 there, and exporting "0" would read as "no risk" rather than
 * "not modelled".
 */
export interface RunStatsSummary {
  samples: number;
  seed: number;
  mean: number;
  median: number;
  p05: number;
  p95: number;
  stdDev: number;
  probProfit: number;
  riskOfRuin: number | null;
}

const CSV_ROW_ORDER: readonly (keyof RunStatsSummary)[] = [
  "samples",
  "seed",
  "mean",
  "median",
  "p05",
  "p95",
  "stdDev",
  "probProfit",
  "riskOfRuin",
];

function formatCsvNumber(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "";
  return String(Math.round(value * 1e6) / 1e6);
}

/**
 * Pins the seed of the run being looked at, which is not always
 * `controls.seed`: browsing the cached seed batch swaps the displayed run
 * without touching the controls. Opening the link restores the inputs, not
 * the draw — hydration and every run deliberately re-seed.
 */
export function buildRunShareState(
  schedule: readonly TournamentRow[],
  controls: ControlsState,
  seed: number,
): PersistedState {
  return {
    v: 1,
    schedule: [...schedule],
    controls: { ...controls, seed: seed >>> 0 },
  };
}

export function buildRunStatsCsv(summary: RunStatsSummary): string {
  const lines = ["metric,value"];
  for (const key of CSV_ROW_ORDER) {
    lines.push(`${key},${formatCsvNumber(summary[key])}`);
  }
  return lines.join("\n");
}
