import type { SimulationResult } from "@/lib/sim/types";

export interface HeadlineProfitStats {
  expectedProfit: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  p05: number;
  p95: number;
}

/**
 * The Battle Royale leaderboard promo EV must reach the headline exactly
 * once. When the "include LB" toggle is on, `shiftResultByRakeback` has
 * already folded it into the displayed result's mean / median / quantiles,
 * so the headline shift is zero; otherwise it is added here as a flat
 * deterministic shift so the card still reports the full expected haul.
 */
export function leaderboardPromoHeadlineShift(
  expectedPayout: number,
  foldedIntoDisplayed: boolean,
): number {
  return foldedIntoDisplayed ? 0 : expectedPayout;
}

export function computeHeadlineStats(
  displayed: Pick<SimulationResult, "expectedProfit"> & {
    stats: Pick<
      SimulationResult["stats"],
      "mean" | "median" | "min" | "max" | "p05" | "p95"
    >;
  },
  promoShift: number,
): HeadlineProfitStats {
  const { stats } = displayed;
  return {
    expectedProfit: displayed.expectedProfit + promoShift,
    mean: stats.mean + promoShift,
    median: stats.median + promoShift,
    min: stats.min + promoShift,
    max: stats.max + promoShift,
    p05: stats.p05 + promoShift,
    p95: stats.p95 + promoShift,
  };
}
