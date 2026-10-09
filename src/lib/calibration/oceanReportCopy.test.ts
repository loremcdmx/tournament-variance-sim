import { describe, expect, it } from "vitest";
import { DICT } from "@/lib/i18n/dict";

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
