import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import bridgeProfile from "@/lib/calibration/ocean-bridge-profile.json";
import profile from "@/lib/calibration/space-runtime-profile.json";
import type { EmpiricalBridgeData } from "@/lib/calibration/oceanTransport";
import type { PublicSpaceProfile } from "@/lib/calibration/types";
import { DICT, type DictKey } from "@/lib/i18n/dict";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { EmpiricalOceanExplorer } from "./EmpiricalOceanExplorer";

const bridge = bridgeProfile as unknown as EmpiricalBridgeData;
const space = profile as PublicSpaceProfile;
// \s covers the no-break and narrow no-break spaces that Intl puts between digit groups.
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const render = (data: EmpiricalBridgeData = bridge) => text(renderToStaticMarkup(
  <LocaleProvider><EmpiricalOceanExplorer profile={space} bridge={data} locale="ru" /></LocaleProvider>,
));

describe("Space → Ocean explorer at its default scenario", () => {
  const plain = render();

  it("shows the anchor's σ and ROI with their sampling error and rounds the rest", () => {
    expect(plain).toContain("7,1 ± 0,2 BI");
    expect(plain).toContain("31,0% ± 2,1 п.п.");
    expect(plain).not.toMatch(/7,08|30,99|1 001,44|1 045,06|5,01\b|5,23\b/);
    const sd = [...plain.matchAll(/SD результата на дистанции ([^B]*BI)/g)].map(match => match[1].trim());
    expect(sd).toEqual(["≈ 1 000 BI", "≈ 1 000 BI"]);
    const roiSd = [...plain.matchAll(/SD среднего ROI ([\d,]+ п\.п\.)/g)].map(match => match[1]);
    expect(roiSd).toEqual(["5,0 п.п.", "5,2 п.п."]);
    expect(plain).toContain("Ocean · сценарий, баунти до порога · $100 Масштаб разброса σ 7,4 BI");
    expect(plain).toContain("Разница σ Ocean и Space: 0,3 BI");
  });

  it("explains the ± as the anchor's standard error that the θ range does not contain", () => {
    expect(plain).toContain("± у Space — стандартная ошибка основы: σ и ROI пересчитаны 17 раз");
    expect(plain).toContain("диапазон θ ниже её не включает");
    expect(plain).toContain("Вклад сценария θ");
    expect(plain).toContain("7,4–7,5 BI");
    expect(plain).toContain("отдельно от ошибки данных основы Space");
  });

  it("names the θ scenario that sets the upper end of the range and failed the numerical gate", () => {
    expect(plain).toContain("Верхняя граница диапазона задана сценарием θ = 0,5, который не прошёл порог численной точности.");
    expect(plain).not.toContain("Нижняя граница диапазона задана");
  });

  it("derives that note from the precision table", () => {
    const relaxed = structuredClone(bridge);
    for (const row of relaxed.numericPrecision!.rows) row.bountyResidualSdRatioRelativeSE = 0;
    expect(render(relaxed)).not.toContain("граница диапазона задана сценарием");
    const strict = structuredClone(bridge);
    for (const row of strict.numericPrecision!.rows.filter(item => item.theta === 2 && item.capBountyBI === 100)) row.bountyMeanRatioRelativeSE = 1;
    const markup = render(strict);
    expect(markup).toContain("Нижняя граница диапазона задана сценарием θ = 2, который не прошёл порог численной точности.");
    expect(markup).toContain("Верхняя граница диапазона задана сценарием θ = 0,5");
  });

  it("keeps the preliminary status of the bridge next to the number of scenarios that pass", () => {
    expect(plain).toContain("Мост предварительный: порог численной точности проходят 10 из 12 сценариев.");
    expect(plain).not.toContain("Порог проходят 10 из 12");
    const withoutTable = structuredClone(bridge);
    delete withoutTable.numericPrecision;
    const markup = render(withoutTable);
    expect(markup).toContain("Численный перенос пока рассчитан пилотным прогоном.");
    expect(markup).not.toContain("Мост предварительный");
    expect(markup).not.toContain("граница диапазона задана сценарием");
  });

  it("states where the base data come from and what an event is", () => {
    expect(plain).toContain("игроки FF на Winamax.fr, окно обучения 02.02.2025 – 30.06.2026 (17 мес.)");
    expect(plain).toContain("поле 1000–1499 (в среднем 1 236 участников, по входам), включая TRIDENT (3-max)");
    expect(plain).toContain("По всем полям 500–1999 в окне около 1 100 игроков.");
    expect(plain).toContain("Событие — все входы одного игрока в одном турнире.");
  });

  it("lists the regular-prize table shape among the assumptions", () => {
    expect(plain).toContain("Форма таблицы обычных призов Ocean принята такой же, как у Space: переносится только масштаб");
  });
});

describe("new Space → Ocean texts", () => {
  const keys = ["empiricalOcean.cohort", "empiricalOcean.anchorError", "empiricalOcean.rangeEndUpper", "empiricalOcean.rangeEndLower",
    "empiricalOcean.precisionPilot", "empiricalOcean.precisionAll", "empiricalOcean.methodEconomics"] as DictKey[];
  const slots = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

  it("fill the same placeholders in both languages", () => {
    for (const key of keys) expect(slots(DICT[key].en), key).toEqual(slots(DICT[key].ru));
  });
});
