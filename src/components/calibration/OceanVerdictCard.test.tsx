import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ComparisonFormat, DistributionSummary, FormatComparisonSummary } from "@/lib/calibration/formatComparison";
import { DICT, type DictKey } from "@/lib/i18n/dict";
import { OceanVerdictCard } from "./OceanVerdictCard";
import { MetricTable } from "./OceanComparisonReport";

const t = (key: DictKey) => DICT[key].ru;
const n = (value: number, digits = 1) => new Intl.NumberFormat("ru", { maximumFractionDigits: digits }).format(value).replace(/[  ]/g, " ");
const summary = (median: number, p95: number): DistributionSummary => ({ mean: median, median, p90: p95, p95, p99: p95, max: p95 });
function row(format: ComparisonFormat, drawdown: [number, number], evShortfall: [number, number], belowEv: [number, number], underwater: [number, number] = [0, 0]) {
  return {
    format, distance: 1000, samples: 2000,
    maxDrawdownBI: summary(...drawdown), maxEvShortfallBI: summary(...evShortfall),
    longestBelowEv: summary(...belowEv), longestUnderwater: summary(...underwater),
  } as unknown as FormatComparisonSummary;
}
// The audit's live numbers at the default scenario ($100, AFS 1000, ROI 10%, 1000 entries, seed 20261008).
const rows = [
  row("freezeout", [188.1, 357.4], [156.1, 410.8], [371, 1000], [900, 1000]),
  row("pko", [85.4, 163.8], [80.2, 216.5], [344, 1000], [400, 800]),
  row("mystery", [141.5, 270.4], [121.4, 317.5], [355, 1000], [500, 900]),
  row("ocean-ko", [103.3, 196.2], [104.1, 256.3], [434, 1000], [450, 850]),
];
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("headline card", () => {
  const markup = renderToStaticMarkup(<OceanVerdictCard ocean={rows[3]} rows={rows} t={t} n={n} />);
  const plain = text(markup);

  it("shows the median of the longest spell below EV, not its P95 that equals the distance", () => {
    expect(plain).toContain("Самый долгий период ниже EV · медиана");
    expect(plain).not.toContain("Самый долгий период ниже EV · P95");
    const stats = [...markup.matchAll(/<span class="[^"]*statValue[^"]*">([^<]*)<small>/g)].map(match => match[1].trim());
    expect(stats).toEqual(["196,2", "256,3", "434"]);
    expect(plain).toContain("из 1 000 турниров");
    expect(plain).not.toMatch(/\b1 000 <small>турниров/);
  });

  it("lists Ocean / freezeout, PKO and Mystery P95 ratios rounded to one digit", () => {
    const body = markup.slice(markup.indexOf("<tbody>"), markup.indexOf("</tbody>"));
    const cells = [...body.matchAll(/<tr><th[^>]*>([^<]*)<\/th><td>([^<]*)<\/td><td>([^<]*)<\/td><\/tr>/g)].map(match => match.slice(1, 4));
    expect(cells).toEqual([
      ["Фризаут", "0,5×", "0,6×"],
      ["PKO", "1,2×", "1,2×"],
      ["Mystery Bounty", "0,7×", "0,8×"],
    ]);
    expect(plain).not.toContain("1,18×");
    expect(plain).not.toContain("1,2×; 1,18");
  });

  it("says the ratios depend on the distance and that the second digit is noise", () => {
    expect(plain).toContain("Отношения зависят от дистанции");
    expect(plain).toContain("1,2× на 1000 турниров, 1,4× на 5000 и 1,5× на 20 000");
    expect(plain).toContain("второй знак — шум Монте-Карло");
  });
});

describe("duration table", () => {
  const markup = renderToStaticMarkup(<MetricTable rows={rows} kind="duration" t={t} n={n} />);

  it("writes a P95 of at least 97% of the distance as the whole distance, with the number in a hint", () => {
    expect(markup).toContain("≈ вся дистанция");
    expect(markup).toContain('title="P95 = 1 000 из 1 000 турниров"');
    const cells = [...markup.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(match => text(match[1]).trim());
    // freezeout: underwater 900 / 1000 (whole distance), below EV 371 / 1000 (whole distance)
    expect(cells.slice(0, 4)).toEqual(["900", "≈ вся дистанция (P95 = 1 000 из 1 000 турниров)", "371", "≈ вся дистанция (P95 = 1 000 из 1 000 турниров)"]);
  });

  it("keeps a P95 below 97% of the distance as a number, and never rewrites the depth table", () => {
    const pko = renderToStaticMarkup(<MetricTable rows={[rows[1]]} kind="duration" t={t} n={n} />);
    expect(pko).toContain(">800<");
    const depth = renderToStaticMarkup(<MetricTable rows={[row("freezeout", [188, 357.4], [156, 410.8], [371, 1000])]} kind="depth" t={t} n={n} />);
    expect(depth).not.toContain("≈ вся дистанция");
    expect(depth).toContain("357,4");
  });
});
