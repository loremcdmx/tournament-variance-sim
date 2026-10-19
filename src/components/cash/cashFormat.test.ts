import { describe, expect, it } from "vitest";
import { DICT, type DictKey, type Locale } from "@/lib/i18n/dict";
import { bankrollReadout, makeCashFormat } from "./cashFormat";

const dictT = (locale: Locale) => (key: DictKey) => DICT[key][locale];
const fmtFor = (locale: Locale) => makeCashFormat(locale, dictT(locale));
const plain = (s: string) => s.replace(/\s/g, " ");

describe("cash number formatting follows the UI locale", () => {
  it("groups and punctuates money, rates and thresholds by the app language, not the browser's", () => {
    const en = fmtFor("en");
    const ru = fmtFor("ru");

    expect(en.money(-612.6, "bb", 1)).toBe("-612.6 BB");
    expect(plain(ru.money(-612.6, "bb", 1))).toBe("-612,6 BB");
    expect(plain(ru.money(3611, "bb", 1))).toBe("3 611 BB");
    expect(en.money(3611, "bb", 1)).toBe("3,611 BB");
    expect(plain(ru.money(1250, "usd", 2))).toBe("$2 500");
    expect(plain(ru.riskThresholdBb(12345))).toBe("−12 345 BB");
    expect(plain(ru.riskThresholdBb(12.34))).toBe("−12,3 BB");
    expect(plain(ru.riskThreshold(1234.5, "usd", 2))).toBe("−$2 469");
    expect(plain(ru.usdBbSize(0.25))).toBe("$0,25 BB");
    expect(plain(ru.signedBb100(-19.74))).toBe("-19,7");
    expect(plain(ru.unsignedBb100(12345.6))).toBe("12 346");
  });

  it("uses the UI locale for percentages and the hover winrate too", () => {
    expect(fmtFor("en").pct(0.15021)).toBe("15.0%");
    expect(fmtFor("ru").pct(0.15021)).toBe("15,0%");
    expect(fmtFor("en").winrate(-19.74)).toBe("-19.74");
    expect(fmtFor("ru").winrate(-19.74)).toBe("-19,74");
  });
});

describe("cash unit suffixes come from the dictionary", () => {
  it("reads the hourly suffix per language", () => {
    expect(fmtFor("en").usdRate(12.5)).toBe("$12.5/h");
    expect(fmtFor("ru").usdRate(12.5)).toBe("$12,5/час");
  });

  it("reads the BB unit from the dictionary instead of a literal", () => {
    const t = (key: DictKey) => (key === "cash.unit.bb" ? "ББ" : DICT[key].en);
    const fmt = makeCashFormat("en", t);

    expect(fmt.money(5, "bb", 1)).toBe("5 ББ");
    expect(fmt.bb(5)).toBe("5 ББ");
    expect(fmt.usdBbSize(1)).toBe("$1.00 ББ");
    expect(fmt.riskThresholdBb(100)).toBe("−100 ББ");
  });

  it("labels a run by the dictionary template", () => {
    expect(DICT["cash.chart.trajectory.runLabel"].en).toBe("Run {n}");
    expect(DICT["cash.chart.trajectory.runLabel"].ru).toBe("Ран {n}");
  });
});

describe("cash money signs", () => {
  const en = fmtFor("en");

  it("puts the minus before the dollar sign", () => {
    expect(en.amountUsd(-2610)).toBe("-$2,610");
    expect(en.amountUsd(2610)).toBe("$2,610");
    expect(en.money(-2610, "usd", 1)).toBe("-$2,610");
    expect(en.amountUsd(-0.25)).toBe("-$0.25");
  });

  it("never prints a minus in front of a zero", () => {
    expect(en.amountUsd(-0.001)).toBe("$0");
    expect(en.amountUsd(-0)).toBe("$0");
    expect(en.bb(-0.04)).toBe("0 BB");
    expect(en.money(-0.04, "bb", 1)).toBe("0 BB");
    expect(en.money(-0.001, "usd", 1)).toBe("$0");
    expect(en.usdRate(-0.001)).toBe("$0/h");
    expect(en.winrate(-0.001)).toBe("0.00");
    expect(en.signedBb100(-0.04)).toBe("+0");
  });
});

describe("trajectory hover readout", () => {
  const t = dictT("en");
  const fmt = makeCashFormat("en", t);

  it("lists the bankroll once in BB and once in $, minus before the dollar sign", () => {
    const rows = bankrollReadout(-2620.2, 1, fmt, t);

    expect(rows.map((r) => r.key)).toEqual(["bb", "usd"]);
    expect(rows.map((r) => r.value)).toEqual(["-2,620.2", "-$2,620"]);
    expect(new Set(rows.map((r) => r.label)).size).toBe(2);
    expect(rows.every((r) => r.negative)).toBe(true);
  });

  it("scales the dollar row by the BB size and keeps a tiny negative from printing -0", () => {
    const rows = bankrollReadout(-0.004, 0.25, fmt, t);

    expect(rows.map((r) => r.value)).toEqual(["0", "$0"]);
    expect(bankrollReadout(400, 0.25, fmt, t)[1].value).toBe("$100");
  });
});
