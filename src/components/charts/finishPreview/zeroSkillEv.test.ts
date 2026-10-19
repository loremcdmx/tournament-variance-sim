import { describe, expect, it } from "vitest";
import { computeRowStats } from "@/lib/sim/previewRowStats";
import type { TournamentRow } from "@/lib/sim/types";
import { zeroSkillEvShares } from "./zeroSkillEv";

const row: TournamentRow = {
  id: "r", players: 1000, buyIn: 25, rake: 0.1, roi: 0.1,
  payoutStructure: "mtt-standard", gameType: "freezeout", count: 1,
};
const stats = computeRowStats(row, { id: "power-law" });

describe("zeroSkillEvShares", () => {
  it("splits one unit of EV over the tiers", () => {
    const shares = zeroSkillEvShares(stats, 0);
    expect(shares).toHaveLength(stats.tiers.length);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it("puts a zero-skill player's EV on the paid tiers: the unpaid tier holds most seats and none of it", () => {
    const shares = zeroSkillEvShares(stats, 0);
    const ootm = stats.tiers.findIndex((tier) => tier.key === "ootm");
    expect(ootm).toBeGreaterThanOrEqual(0);
    expect(stats.tiers[ootm].eqShare).toBeGreaterThan(0.5);
    expect(shares[ootm]).toBeCloseTo(0, 9);
    const winner = stats.tiers.findIndex((tier) => tier.posLo === 1);
    expect(shares[winner]).toBeGreaterThan(stats.tiers[winner].eqShare * 10);
  });

  it("leaves room for money the tiers do not hold, such as rakeback", () => {
    const withRakeback = zeroSkillEvShares(stats, 1);
    const none = zeroSkillEvShares(stats, 0);
    const total = withRakeback.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(1);
    withRakeback.forEach((share, i) => expect(share).toBeLessThan(none[i] + 1e-12));
  });

  it("is all zeros when the baseline holds nothing", () => {
    const empty = { ...stats, cost: 0, tiers: stats.tiers.map((t) => ({ ...t, eqShare: 0, eqNetDollars: 0 })) };
    expect(zeroSkillEvShares(empty, 0).every((share) => share === 0)).toBe(true);
  });
});
