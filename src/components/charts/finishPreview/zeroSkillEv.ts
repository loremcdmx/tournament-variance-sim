import type { RowStats } from "@/lib/sim/previewRowStats";

/**
 * Each tier's share of the EV a zero-skill player (a uniform finish) takes, the
 * baseline for the %-of-EV bar. A tier's share of seats is a different thing:
 * the unpaid tier holds most seats and none of the EV. `extraPerEntry` is money
 * that is not paid by a finishing tier and does not depend on skill (direct
 * rakeback); it belongs to the total the shares divide.
 */
export function zeroSkillEvShares(
  stats: Pick<RowStats, "cost" | "tiers">,
  extraPerEntry: number,
): number[] {
  const ev = stats.tiers.map((tier) => tier.eqNetDollars + tier.eqShare * stats.cost);
  const total = ev.reduce((a, b) => a + b, 0) + Math.max(0, extraPerEntry);
  return ev.map((v) => (total > 1e-9 ? Math.max(0, v) / total : 0));
}
