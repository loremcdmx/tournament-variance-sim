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

export interface DoneSummaryProfitStats {
  mean: number;
  median: number;
  roi: number;
  probProfit: number;
}

/**
 * The Done row under Run prints the run with the leaderboard promo in, like the
 * results card in its default state. The chance to be up must be counted on the
 * same promo-shifted finals as the mean, or a promo-inclusive profit sits next
 * to a game-only probability (59.9 % against the card's 67.9 % on the BR
 * leaderboard demo at its own seed and 10 000 runs).
 * The guard matches `computeExpectedLeaderboardCurve`, so both switch together.
 */
export function doneSummaryProfitStats(
  result: Pick<
    SimulationResult,
    "finalProfits" | "totalBuyIn" | "battleRoyaleLeaderboardPromo"
  > & {
    stats: Pick<SimulationResult["stats"], "mean" | "median" | "probProfit">;
  },
): DoneSummaryProfitStats {
  const payout = result.battleRoyaleLeaderboardPromo?.expectedPayout ?? 0;
  const promo = Number.isFinite(payout) && payout > 0 ? payout : 0;
  const mean = result.stats.mean + promo;
  let probProfit = result.stats.probProfit;
  const finals = result.finalProfits;
  if (promo > 0 && finals.length > 0) {
    let up = 0;
    for (let s = 0; s < finals.length; s++) if (finals[s] + promo > 0) up++;
    probProfit = up / finals.length;
  }
  return {
    mean,
    median: result.stats.median + promo,
    roi: mean / result.totalBuyIn,
    probProfit,
  };
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
