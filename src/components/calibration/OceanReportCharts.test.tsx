import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ComparisonFormat, FormatComparisonSummary } from "@/lib/calibration/formatComparison";
import { DICT, type DictKey } from "@/lib/i18n/dict";
import { SurvivalChart } from "./OceanReportCharts";

const t = (key: DictKey) => DICT[key].ru;
const n = (value: number, digits = 1) => new Intl.NumberFormat("ru", { maximumFractionDigits: digits }).format(value).replace(/[  ]/g, " ");
const pct = (value: number) => `${n(value * 100, 1)}%`;
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

function row(format: ComparisonFormat, drawdownBI: number[], evShortfallBI: number[]) {
  return {
    format,
    careerMaxima: { drawdownBI: Float64Array.from(drawdownBI).sort(), evShortfallBI: Float64Array.from(evShortfallBI).sort() },
  } as unknown as FormatComparisonSummary;
}

// A 20,000-entry distance: the old fixed 0-1000 BI grid left 12% of the freezeout careers beyond the chart.
const freezeout = Array.from({ length: 100 }, (_, i) => 100 + i * 15);
const pko = Array.from({ length: 100 }, (_, i) => 50 + i * 4);
const rows = [row("freezeout", freezeout, freezeout.map(v => v * 1.6)), row("pko", pko, pko.map(v => v * 2.5))];

describe("risk chart labels follow the dynamic grid", () => {
  it("names the real maximum of the shared grid in the full-tail checkbox", () => {
    const drawdown = text(renderToStaticMarkup(<SurvivalChart rows={rows} metric="drawdown" t={t} n={n} pct={pct} />));
    // deepest freezeout career is 1585 BI -> the grid ends at the round number above it, 2000 BI
    expect(drawdown).toContain("Показать полный хвост до 2 000 BI");
    expect(drawdown).not.toContain("до 1000 BI");
    expect(drawdown).toContain("Сетка общая для всех форматов: от 0 до 2 000 BI");
    // the EV shortfall metric has its own, deeper grid: 1585 * 1.6 = 2536 -> 3000
    const shortfall = text(renderToStaticMarkup(<SurvivalChart rows={rows} metric="evShortfall" t={t} n={n} pct={pct} />));
    expect(shortfall).toContain("Показать полный хвост до 3 000 BI");
  });

  it("states where the automatic axis stops and where the rest of the tail is", () => {
    const wide = Array.from({ length: 100 }, (_, i) => i < 99 ? 10 + i : 5000);
    const markup = text(renderToStaticMarkup(<SurvivalChart rows={[row("freezeout", wide, wide), row("pko", wide, wide)]} metric="drawdown" t={t} n={n} pct={pct} />));
    expect(markup).toContain("Ось заканчивается, когда вероятность у всех показанных форматов не выше 0,5%");
    expect(markup).toContain("Полный хвост до 6 000 BI — по галочке и в таблице данных");
  });
});
