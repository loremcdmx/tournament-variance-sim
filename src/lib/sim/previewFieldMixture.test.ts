import { describe, expect, it } from "vitest";
import { fieldVariantSizes } from "./fieldVariants";
import { computeRowStats, type TierRow } from "./previewRowStats";
import type { TournamentRow } from "./types";

const model = { id: "power-law" as const };
const pko: TournamentRow = {
  id: "r",
  label: "r",
  players: 1000,
  buyIn: 20,
  rake: 0.1,
  roi: 0.1,
  payoutStructure: "mtt-gg-bounty",
  gameType: "pko",
  bountyFraction: 0.5,
  count: 1,
};
const range = (min: number, max: number, buckets: number) =>
  ({ kind: "uniform", min, max, buckets }) as const;

const nearestToMean = (sizes: readonly number[]) => {
  const centre = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  return sizes.reduce((best, n) => (Math.abs(n - centre) < Math.abs(best - centre) ? n : best));
};
const span = (t: Pick<TierRow, "key" | "posLo" | "posHi">) => `${t.key}[${t.posLo}-${t.posHi}]`;

describe("a Field-size range reads every displayed place range from one field", () => {
  it("PKO $20, range 20-400 in 4 buckets: no tier mixes places of two fields", () => {
    const row: TournamentRow = { ...pko, fieldVariability: range(20, 400, 4) };
    const sizes = fieldVariantSizes(row);
    expect(sizes).toEqual([68, 163, 258, 353]);
    const repSize = nearestToMean(sizes);
    const rep = computeRowStats({ ...pko, players: repSize }, model);
    const mixed = computeRowStats(row, model);

    // The mixed table carves the last paid place out of the top-27 cut at
    // every size, so its "first min-cash" share is not diluted by the fields
    // whose top-27 cut would have swallowed it; the rest is the fixed layout.
    const paid = rep.paidCount;
    const shown = mixed.tiers.filter((t) => !t.placesVary);
    expect(shown.map(span)).toEqual([
      "winner[1-1]", "top3[2-3]", "ft[4-9]", `top27[10-${paid - 1}]`,
      `firstMincash[${paid}-${paid}]`, `bubble[${paid + 1}-${paid + 1}]`, `ootm[${paid + 2}-${repSize}]`,
    ]);
    expect(rep.tiers.map(span)).toEqual([
      "winner[1-1]", "top3[2-3]", "ft[4-9]", `top27[10-${paid}]`,
      `bubble[${paid + 1}-${paid + 1}]`, `ootm[${paid + 2}-${repSize}]`,
    ]);

    const unshown = mixed.tiers.filter((t) => t.placesVary).map((t) => t.key);
    expect(unshown).toEqual(["restItm"]);
    for (const key of unshown) {
      expect(rep.tiers.some((t) => t.key === key)).toBe(false);
    }
  });

  it("the places a mixed row does show never overlap and run in order", () => {
    for (const [min, max, buckets] of [[20, 400, 4], [60, 400, 4], [100, 3000, 5], [200, 4000, 6], [2, 30, 5]] as const) {
      const stats = computeRowStats({ ...pko, fieldVariability: range(min, max, buckets) }, model);
      const shown = stats.tiers.filter((t) => !t.placesVary);
      for (let i = 1; i < shown.length; i++) {
        expect(shown[i].posLo, `${min}-${max} ${span(shown[i])}`).toBeGreaterThan(shown[i - 1].posHi);
      }
    }
  });

  it("keeps the mixed shares and EV of every tier, flagged or not", () => {
    const stats = computeRowStats({ ...pko, fieldVariability: range(20, 400, 4) }, model);
    expect(stats.tiers.reduce((a, t) => a + t.field, 0)).toBeCloseTo(1, 9);
    expect(stats.tiers.reduce((a, t) => a + t.ev, 0)).toBeCloseTo(stats.evPerEntry, 9);
    expect(stats.tiers.reduce((a, t) => a + t.netDollars, 0)).toBeCloseTo(stats.evPerEntry - stats.cost, 9);
    const restItm = stats.tiers.find((t) => t.key === "restItm")!;
    expect(restItm.field).toBeGreaterThan(0);
    expect(restItm.placesVary).toBe(true);
    const firstMincash = stats.tiers.find((t) => t.key === "firstMincash")!;
    expect(firstMincash.field).toBeCloseTo(stats.shellFirstCash, 12);
    expect(firstMincash.placesVary).toBeUndefined();
  });

  it("flags nothing for a single field", () => {
    const fixed = computeRowStats({ ...pko, players: 258 }, model);
    const collapsed = computeRowStats({ ...pko, fieldVariability: range(258, 258, 1) }, model);
    expect(fixed.tiers.some((t) => t.placesVary)).toBe(false);
    expect(collapsed.tiers.some((t) => t.placesVary)).toBe(false);
  });
});
