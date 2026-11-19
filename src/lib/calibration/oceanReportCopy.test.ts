import { describe, expect, it } from "vitest";
import { DICT } from "@/lib/i18n/dict";
import { compileFormatComparison, FORMAT_COMPARISON_DEFAULTS } from "./formatComparison";

describe("caption under the model σ table of the Ocean downside report", () => {
  it("says that the realised σ and ROI of Ocean are unstable and that the bound is not an interval for them", () => {
    const { ru, en } = DICT["oceanReport.sigmaBound"];
    expect(ru).toContain("аналитическая нижняя–верхняя граница");
    expect(ru).toContain("не 95% доверительный интервал");
    expect(ru).toContain("Реализованные σ и ROI Ocean на тысячах симулированных дистанций");
    expect(ru).toContain("статистически нестабильны");
    expect(ru).toContain("аналитические границы, а не доверительный интервал для них");
    expect(en).toContain("Realised σ and ROI of Ocean over thousands of simulated careers are statistically unstable");
    expect(en).toContain("analytic, not a confidence interval for them");
  });

  it("keeps the same placeholders in both languages", () => {
    const slots = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    expect(slots(DICT["oceanReport.sigmaBound"].en)).toEqual(slots(DICT["oceanReport.sigmaBound"].ru));
  });
});

describe("note under the Mystery bounty log-variance select", () => {
  const sigma = (players: number, mysteryLogVariance: number) => compileFormatComparison({ ...FORMAT_COMPARISON_DEFAULTS, players, mysteryLogVariance })
    .find(row => row.scenario.format === "mystery")!.moments.sigmaBI.upper;

  it("quotes the default field, where σ more than doubles, and the fading in larger fields", () => {
    const { en, ru } = DICT["oceanReport.mysterySpreadNote"];
    expect(FORMAT_COMPARISON_DEFAULTS.players).toBe(1000);
    expect(FORMAT_COMPARISON_DEFAULTS.roi).toBe(0.1);
    expect(sigma(1000, 0).toFixed(1)).toBe("4.9");
    expect(sigma(1000, 4).toFixed(1)).toBe("11.5");
    expect(sigma(1000, 4) / sigma(1000, 0)).toBeGreaterThan(2);
    expect((sigma(10_000, 4) / sigma(10_000, 0)).toFixed(1)).toBe("1.6");
    expect((sigma(100_000, 4) / sigma(100_000, 0)).toFixed(1)).toBe("1.1");
    for (const text of ["1,000 players", "4.9 to 11.5 BI", "1.6× at 10,000", "1.1× at 100,000"]) expect(en).toContain(text);
    for (const text of ["поле 1 000 игроков", "с 4,9 до 11,5 BI", "1,6× при 10 000", "1,1× при 100 000"]) expect(ru).toContain(text);
  });
});

describe("recovery notes of the Ocean downside report", () => {
  it("count a return to the old peak as recovery, as the engine does", () => {
    for (const key of ["oceanReport.recoveryNote", "oceanReport.recoveryTimeNote"] as const) {
      expect(DICT[key].en).not.toMatch(/strict/i);
      expect(DICT[key].ru).not.toMatch(/строго/);
    }
    expect(DICT["oceanReport.recoveryNote"].en).toContain("got back to the old peak");
    expect(DICT["oceanReport.recoveryNote"].ru).toContain("так и не вернулся к прежнему пику");
    expect(DICT["oceanReport.recoveryTimeNote"].en).toContain("back at the old peak or above");
    expect(DICT["oceanReport.recoveryTimeNote"].ru).toContain("снова вышел на прежний пик");
    expect(DICT["oceanReport.recoveryTimeNote"].ru).toContain("в даунстрике");
  });
});
