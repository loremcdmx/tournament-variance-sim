import { describe, expect, it } from "vitest";
import { DICT, type DictKey, type Locale } from "@/lib/i18n/dict";
import { DEFAULT_CASH_INPUT } from "@/lib/sim/cashInput";
import { seedMixRows, stakeSeedLabel } from "./cashMixSeed";

const dictT = (locale: Locale) => (key: DictKey) => DICT[key][locale];
const en = dictT("en");

describe("stake mix seed rows", () => {
  it("names a row by the stake its big blind implies, not a fixed NL100", () => {
    expect(stakeSeedLabel(0.25, en)).toBe("NL25");
    expect(stakeSeedLabel(1, en)).toBe("NL100");
    expect(stakeSeedLabel(0.07, en)).toBe("NL7");
    expect(stakeSeedLabel(0.02, en)).toBe("NL2");
  });

  it("leaves a big blind that is no round NL stake unlabelled", () => {
    expect(stakeSeedLabel(0.333, en)).toBeUndefined();
    expect(stakeSeedLabel(0.005, en)).toBeUndefined();
  });

  it("seeds NL25 and NL50 from a $0.25 big blind", () => {
    const [row1, row2] = seedMixRows({ ...DEFAULT_CASH_INPUT, bbSize: 0.25 }, en);

    expect(row1).toMatchObject({ label: "NL25", bbSize: 0.25, handShare: 0.7 });
    expect(row2).toMatchObject({ label: "NL50", bbSize: 0.5, handShare: 0.3 });
  });

  it("keeps the old NL100 / NL200 pair for a $1 big blind and copies the session inputs", () => {
    const input = {
      ...DEFAULT_CASH_INPUT,
      wrBb100: 3,
      sdBb100: 80,
      rake: { enabled: true, contributedRakeBb100: 6, advertisedRbPct: 20, pvi: 0.8 },
    };
    const [row1, row2] = seedMixRows(input, en);

    expect([row1.label, row2.label]).toEqual(["NL100", "NL200"]);
    for (const row of [row1, row2]) {
      expect(row).toMatchObject({ wrBb100: 3, sdBb100: 80, rake: input.rake });
    }
    expect(row1.rake).not.toBe(input.rake);
    expect(row1.rake).not.toBe(row2.rake);
  });

  it("omits the label key when no stake name fits", () => {
    const [row1] = seedMixRows({ ...DEFAULT_CASH_INPUT, bbSize: 0.333 }, en);
    expect("label" in row1).toBe(false);
  });
});
