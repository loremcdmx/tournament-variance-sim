import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { runSimulation } from "@/lib/sim/engine";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import {
  buildPrimedopeCheatSheet,
  CalibrationNotices,
  PrimedopeDiff,
  PrimedopeReportCard,
} from "./PrimedopeDiagnostics";

const input = {
  schedule: [{ id: "test", players: 10, buyIn: 10, rake: 0, roi: .8, itmRate: .18,
    payoutStructure: "mtt-standard" as const, count: 1000 }],
  samples: 128, scheduleRepeats: 1, seed: 42, bankroll: 0, finishModel: { id: "power-law" as const },
};

describe("rendered PrimeDope results", () => {
  it("preserves the required cent above tied losses in the bankroll report", () => {
    const result = runSimulation({ ...input, schedule: [{ ...input.schedule[0], players: 6,
      payoutStructure: "sng-50-30-20", rake: .1, roi: 0, itmRate: .5, count: 1 }] });
    expect(result.stats.minBankrollRoR1pct).toBe(11.01);
    const markup = renderToStaticMarkup(<LocaleProvider><PrimedopeReportCard result={result} /></LocaleProvider>);
    expect(markup).toContain("$11,01");
    expect(markup).not.toMatch(/RoR 1%<\/span><span[^>]*>\$11<\/span>/);
  });

  it("shows the signed lower quantile, finite tail deltas and unmodeled ruin as unavailable", () => {
    const primary = runSimulation(input);
    const other = runSimulation({ ...input, seed: 43 });
    expect(primary.stats.p05).toBeGreaterThan(0);
    const markup = renderToStaticMarkup(<LocaleProvider><PrimedopeDiff primary={primary} other={other} /></LocaleProvider>);
    const rows = [...markup.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0].replace(/<[^>]+>/g, " "));
    const lowerTail = rows.find((row) => row.includes("Нижний хвост"))!;
    expect(lowerTail).not.toContain("−$");
    expect(rows.find((row) => row.includes("худших 5%"))).not.toMatch(/\d{8,}/);
    const ruin = rows.find((row) => row.includes("Риск слить банкролл"))!;
    expect(ruin).not.toContain("0.0%");
    expect(ruin).toContain("укажи банкролл");
  });

  it("identifies reversed model order and explains unreachable calibration targets", () => {
    const result = runSimulation(input);
    const primary = { ...result, calibrationMode: "primedope-binary-itm" as const,
      calibrationWarnings: [{ rowId: "test", kind: "primedope-target-clamped" as const, targetWinnings: 20, actualWinnings: 18 }],
      comparison: result };
    const markup = renderToStaticMarkup(<LocaleProvider>
      <PrimedopeReportCard result={primary} />
      <CalibrationNotices result={primary} schedule={[{ ...input.schedule[0], label: "Daily" }]} />
    </LocaleProvider>);
    expect(markup.indexOf("PrimeDope</span>")).toBeLessThan(markup.indexOf("Наша калиброванная модель</span>"));
    expect(markup).toContain("PrimeDope не достиг");
    expect(markup).toContain("Daily");
    expect(markup).toContain("$20");
    expect(markup).toContain("$18");
  });
});

describe("PrimeDope reproduce text", () => {
  const first = { id: "a", label: "Daily", players: 500, buyIn: 10, rake: 0.1, roi: 0.12,
    payoutStructure: "mtt-standard" as const, count: 10 };
  const second = { ...first, id: "b", label: "Sunday", buyIn: 100, count: 4 };

  it("prints one row's numbers and no warning for a one-row schedule", () => {
    const text = buildPrimedopeCheatSheet([first], 3, "en");
    expect(text).toContain("Number of tournaments: 30");
    expect(text).toContain("Buy-in: $10");
    expect(text).not.toContain("⚠");
  });

  it.each([
    ["en", /are the first row's \(Daily\)/, /total across all 2 rows \(28\)/, /The first row's values were copied/],
    ["ru", /взяты из первой строки \(Daily\)/, /сумма по всем 2 строкам \(28\)/, /Скопированы параметры первой строки/],
  ] as const)(
    "says the tournament count is the whole schedule's, not the first row's, in %s",
    (locale, firstRowNote, totalNote, oldWording) => {
      const text = buildPrimedopeCheatSheet([first, second], 2, locale);
      expect(text).toMatch(/: 28$/m);
      expect(text).toMatch(firstRowNote);
      expect(text).toMatch(totalNote);
      expect(text).not.toMatch(oldWording);
    },
  );
});
