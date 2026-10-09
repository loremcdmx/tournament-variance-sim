import type { SimulationResult } from "@/lib/sim/types";

type TailStats = Pick<
  SimulationResult["stats"],
  "stdDev" | "mcSeStdDev" | "kurtosis"
>;

/**
 * Excess kurtosis above which the final-profit distribution counts as heavy
 * tailed. The standard error of σ is σ/2·√((κ−1)/(S−1)); the normal-theory
 * formula assumes κ = 3, so κ above 9 (excess above 6) means σ is at least
 * twice as uncertain as that formula says. Past this point σ², and with it the
 * Kelly bankroll σ²/μ and the Gaussian ruin formulas, are dominated by a few
 * rare big scores and swing between seeds. For scale: freezeout and PKO runs
 * of a few hundred entries sit near 0.3-2, an Ocean KO run of 1000 entries
 * well above 50.
 */
export const HEAVY_TAIL_EXCESS_KURTOSIS = 6;

export function hasHeavyTail(stats: Pick<TailStats, "kurtosis">): boolean {
  return stats.kurtosis > HEAVY_TAIL_EXCESS_KURTOSIS;
}

/** One standard error of σ as a fraction of σ; null when σ is zero. */
export function sigmaRelativeError(
  stats: Pick<TailStats, "stdDev" | "mcSeStdDev">,
): number | null {
  if (!(stats.stdDev > 0) || !Number.isFinite(stats.mcSeStdDev)) return null;
  return stats.mcSeStdDev / stats.stdDev;
}

/** "±12%" for a fraction; one decimal below 10%, none above. */
export function formatSigmaError(relative: number, locale: Intl.LocalesArgument = "en-US"): string {
  const pct = relative * 100;
  const digits = pct < 10 ? 1 : 0;
  return `±${pct.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}
