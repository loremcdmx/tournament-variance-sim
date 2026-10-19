import { describe, expect, it } from "vitest";
import { DICT, type DictKey } from "@/lib/i18n/dict";
import { computeRowStats } from "@/lib/sim/previewRowStats";
import type { TournamentRow } from "@/lib/sim/types";
import { tierLabel, tierPlacesLabel } from "./tierPlaces";

describe("tierPlacesLabel", () => {
  it("prints a single place or a range of places", () => {
    expect(tierPlacesLabel({ posLo: 19, posHi: 19 }, "varies")).toBe("19");
    expect(tierPlacesLabel({ posLo: 10, posHi: 18 }, "varies")).toBe("10–18");
  });

  it("says the places depend on the field instead of printing another field's range", () => {
    expect(tierPlacesLabel({ posLo: 28, posHi: 28, placesVary: true }, "varies")).toBe("varies");
  });
});

describe("tierLabel", () => {
  const en = (key: DictKey) => DICT[key].en;
  const model = { id: "power-law" as const };
  const mtt = (players: number): TournamentRow => ({
    id: "r", label: "r", players, buyIn: 50, rake: 0.1, roi: 0.1,
    payoutStructure: "mtt-standard", count: 1,
  });
  const labelsOf = (players: number) =>
    Object.fromEntries(
      computeRowStats(mtt(players), model).tiers.map((tier) => [tier.key, tierLabel(tier, en)]),
    );

  it("keeps the printed range when the field pays every place the label names", () => {
    const labels = labelsOf(1000);
    expect(labels.top3).toBe("2nd-3rd");
    expect(labels.ft).toBe("4th-9th");
    expect(labels.top27).toBe("10th-27th");
  });

  it("prints the places a small field really pays instead of the nominal ones", () => {
    const stats = computeRowStats(mtt(100), model);
    const top27 = stats.tiers.find((tier) => tier.key === "top27")!;
    expect(top27.posHi).toBe(stats.paidCount);
    expect(stats.paidCount).toBeLessThan(27);
    expect(tierLabel(top27, en)).toBe(`Places 10-${stats.paidCount}`);
    expect(tierLabel(top27, en)).not.toContain("27");
  });

  it("names a single remaining place and a clipped final table", () => {
    expect(tierLabel({ key: "top3", labelKey: "preview.tierTop3", posLo: 2, posHi: 2 }, en)).toBe("Place 2");
    expect(tierLabel({ key: "ft", labelKey: "preview.tierFt", posLo: 4, posHi: 7 }, en)).toBe("Places 4-7");
  });

  it("says the same in Russian", () => {
    const ru = (key: DictKey) => DICT[key].ru;
    expect(tierLabel({ key: "top27", labelKey: "preview.tierTop27", posLo: 10, posHi: 15 }, ru)).toBe("10-15 места");
    expect(tierLabel({ key: "top3", labelKey: "preview.tierTop3", posLo: 2, posHi: 2 }, ru)).toBe("2-е место");
  });

  it("leaves tiers without a printed range and mixed-field tiers on their own label", () => {
    expect(tierLabel({ key: "winner", labelKey: "preview.tierWinner", posLo: 1, posHi: 1 }, en)).toBe("1st place");
    expect(tierLabel({ key: "restItm", labelKey: "preview.tierRestItm", posLo: 11, posHi: 40 }, en)).toBe("Rest of cashes");
    expect(
      tierLabel({ key: "top27", labelKey: "preview.tierTop27", posLo: 10, posHi: 15, placesVary: true }, en),
    ).toBe("10th-27th");
  });
});
