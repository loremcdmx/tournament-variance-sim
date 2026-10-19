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

    const shown = mixed.tiers.filter((t) => !t.placesVary);
    expect(shown.map(span)).toEqual(
      rep.tiers.filter((t) => shown.some((s) => s.key === t.key)).map(span),
    );
    expect(shown.map((t) => t.key)).toEqual(["winner", "top3", "ft", "top27", "bubble", "ootm"]);

    const unshown = mixed.tiers.filter((t) => t.placesVary).map((t) => t.key);
    expect(unshown).toEqual(["restItm", "firstMincash"]);
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
    for (const key of ["restItm", "firstMincash"] as const) {
      const tier = stats.tiers.find((t) => t.key === key)!;
      expect(tier.field).toBeGreaterThan(0);
      expect(tier.placesVary).toBe(true);
    }
  });

  it("flags nothing for a single field", () => {
    const fixed = computeRowStats({ ...pko, players: 258 }, model);
    const collapsed = computeRowStats({ ...pko, fieldVariability: range(258, 258, 1) }, model);
    expect(fixed.tiers.some((t) => t.placesVary)).toBe(false);
    expect(collapsed.tiers.some((t) => t.placesVary)).toBe(false);
  });
});
