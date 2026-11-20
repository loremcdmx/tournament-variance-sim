import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { runSimulation } from "@/lib/sim/engine";
import { DICT } from "@/lib/i18n/dict";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { compileSchedule } from "@/lib/sim/compile";
import { applyItmTarget } from "@/lib/sim/itmTarget";
import type { TournamentRow } from "@/lib/sim/types";
import {
  buildPrimedopeCheatSheet,
  CalibrationNotices,
  CopyPdDiagButton,
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
    expect(other.stats.p05).toBeGreaterThan(0);
    const lowerTail = rows.find((row) => row.includes("Нижний хвост"))!;
    // Both quantiles are gains here and print as such; the difference column
    // keeps its own sign.
    const [, oursCell, theirsCell] = lowerTail.trim().split(/\s{2,}/);
    expect(oursCell).toMatch(/^\$/);
    expect(theirsCell).toMatch(/^\$/);
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

describe("PrimeDope clamp notice", () => {
  it("keeps the cents that tell a requested payout from the modeled one", () => {
    const result = runSimulation(input);
    const clamped = { ...result, calibrationWarnings: [{ rowId: "test",
      kind: "primedope-target-clamped" as const, targetWinnings: 1.815, actualWinnings: 1.8 }] };
    const markup = renderToStaticMarkup(<LocaleProvider><CalibrationNotices result={clamped} /></LocaleProvider>);
    expect(markup).toContain("запрошено $1,82, смоделировано $1,80");
  });

  it("does not blame PrimeDope for a target our own model missed", () => {
    const result = runSimulation(input);
    const missed = { ...result, calibrationWarnings: [{ rowId: "test",
      kind: "target-unreachable" as const, targetWinnings: 10.815, actualWinnings: 10 }] };
    const markup = renderToStaticMarkup(<LocaleProvider><CalibrationNotices result={missed} /></LocaleProvider>);
    expect(markup).not.toContain("PrimeDope");
    expect(markup).toContain("Модель финишей не смогла выйти на заданный ROI");
    expect(markup).toContain("запрошено $10,82, смоделировано $10,00");
  });

  it("names the field size a ranged row misses at, not the mean of its sizes", () => {
    // The sizes of a 5-50 range at ROI +30 % play $15.60 / $12.98 / $14.30
    // against $14.30; their mean, $14.29, would read as on target.
    const result = runSimulation(input);
    const ranged = (kind: "target-unreachable" | "primedope-target-clamped" | "primedope-free-itm-unreachable") => ({
      ...result,
      calibrationWarnings: [{ rowId: "test", kind, targetWinnings: 14.3, actualWinnings: 12.978, fieldSize: 28 }],
    });
    const ours = renderToStaticMarkup(<LocaleProvider><CalibrationNotices result={ranged("target-unreachable")} /></LocaleProvider>);
    expect(ours).toContain("Модель финишей не смогла выйти на заданный ROI");
    expect(ours).toContain("Наибольший промах — при размере поля 28: запрошено $14,30, смоделировано $12,98");
    expect(ours).toContain("по смоделированным выплатам всех размеров поля");
    const clamped = renderToStaticMarkup(<LocaleProvider><CalibrationNotices result={ranged("primedope-target-clamped")} /></LocaleProvider>);
    expect(clamped).toContain("PrimeDope не достиг");
    expect(clamped).toContain("при размере поля 28");
    const free = renderToStaticMarkup(<LocaleProvider><CalibrationNotices result={ranged("primedope-free-itm-unreachable")} /></LocaleProvider>);
    expect(free).toContain("даже без фиксации ITM");
    expect(free).toContain("при размере поля 28");
    for (const key of ["calibration.targetUnreachable.range", "pd.calibrationClamped.range", "pd.freeItmUnreachable.range"] as const) {
      expect(DICT[key].en).toContain("The biggest miss is at a field of {field}");
    }
  });

  it("says our model missed in the PrimeDope pass when the free-ITM retry still falls short", () => {
    const result = runSimulation(input);
    const missed = { ...result, calibrationWarnings: [{ rowId: "test",
      kind: "primedope-free-itm-unreachable" as const, targetWinnings: 22, actualWinnings: 17.5 }] };
    const markup = renderToStaticMarkup(<LocaleProvider><CalibrationNotices result={missed} /></LocaleProvider>);
    expect(markup).toContain("наша модель финишей не смогла выйти на заданный ROI");
    expect(markup).toContain("даже без фиксации ITM, финишей и настройки топ-хеви");
    expect(markup).not.toContain("PrimeDope не достиг");
    expect(markup).toContain("запрошено $22,00, смоделировано $17,50");
  });
});

describe("PrimeDope reproduce text", () => {
  const first = { id: "a", label: "Daily", players: 500, buyIn: 10, rake: 0.1, roi: 0.12,
    payoutStructure: "mtt-standard" as const, count: 10 };
  const second = { ...first, id: "b", label: "Sunday", buyIn: 100, count: 4 };

  it("prints one row's numbers and no warning for a one-row schedule", () => {
    const text = buildPrimedopeCheatSheet([first], 3, "en", true);
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
      const text = buildPrimedopeCheatSheet([first, second], 2, locale, true);
      expect(text).toMatch(/: 28$/m);
      expect(text).toMatch(firstRowNote);
      expect(text).toMatch(totalNote);
      expect(text).not.toMatch(oldWording);
    },
  );

  it("quotes the places the PrimeDope pass paid, from the table it compiled", () => {
    const row = (payoutStructure: TournamentRow["payoutStructure"], extra: Partial<TournamentRow> = {}) =>
      [{ ...first, players: 1000, payoutStructure, ...extra }];
    const paidLine = (text: string) => text.split("\n").find((line) => line.startsWith("Places paid"));
    expect(paidLine(buildPrimedopeCheatSheet(row("mtt-flat"), 1, "en", true))).toBe("Places paid: 150 (~15.0% of field)");
    expect(paidLine(buildPrimedopeCheatSheet(row("mtt-flat"), 1, "en", false))).toBe("Places paid: 200 (~20.0% of field)");
    expect(paidLine(buildPrimedopeCheatSheet(row("mtt-gg"), 1, "en", false))).toBe("Places paid: 158 (~15.8% of field)");
    const lateReg = buildPrimedopeCheatSheet(row("mtt-standard", { lateRegMultiplier: 1.5 }), 1, "ru", true);
    expect(paidLine(lateReg)).toBe("Places paid: 225 (~15.0% поля)");
    expect(lateReg).toMatch(/^Field size: 1500$/m);
  });
});

describe("PrimeDope toggle hints quote what the engine compiles", () => {
  // The hints' example row: $100 + $9 rake, 1000 entrants, 150 paid, ROI +20%.
  const schedule = applyItmTarget([{ id: "r", players: 1000, buyIn: 100, rake: 0.09, roi: 0.2,
    payoutStructure: "mtt-standard", count: 1 }], { enabled: false, pct: 15 });
  const compile = (mode: "alpha" | "primedope-binary-itm", usePrimedopeRakeMath = true) => {
    const entry = compileSchedule({ schedule, scheduleRepeats: 1, samples: 1, bankroll: 0, seed: 1,
      finishModel: { id: "power-law" }, usePrimedopeRakeMath }, mode).flat[0];
    const n = entry.aliasProb.length;
    const pmf = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      pmf[i] += entry.aliasProb[i] / n;
      pmf[entry.aliasIdx[i]] += (1 - entry.aliasProb[i]) / n;
    }
    let mean = 0;
    let square = 0;
    let pool = 0;
    for (let i = 0; i < n; i++) {
      const prize = entry.prizeByPlace[i];
      pool += prize;
      mean += pmf[i] * prize;
      square += pmf[i] * prize * prize;
    }
    const itm = pmf.slice(0, entry.paidCount).reduce((a, b) => a + b, 0);
    return { pmf, itm, pool, sd: Math.sqrt(square - mean * mean) };
  };
  const ours = compile("alpha");
  const pd = compile("primedope-binary-itm");
  const pdPreRake = compile("primedope-binary-itm", false);

  it("finish model: our ITM is the row's 15%, PrimeDope's about 22%", () => {
    expect(ours.itm).toBeCloseTo(0.15, 6);
    expect(Math.round(pd.itm * 100)).toBe(22);
    const hint = DICT["chart.trajectory.pdFinishModel.hint"];
    expect(hint.en).toContain("≈22%");
    expect(hint.en).toContain("15% here");
    expect(hint.en).not.toMatch(/~17%/);
    expect(hint.ru).toContain("≈22%");
    expect(hint.ru).toContain("здесь 15%");
  });

  it("finish model: the place table quotes our pmf as a multiple of the uniform base", () => {
    const n = ours.pmf.length;
    const multiple = (place: number) => (ours.pmf[place - 1] * n).toFixed(1);
    expect([1, 10, 75, 150, 151, n].map(multiple)).toEqual(["1.7", "1.2", "1.0", "0.9", "1.0", "1.0"]);
    const hint = DICT["chart.trajectory.pdFinishModel.hint"];
    for (const [place, label] of [["1st", "1"], ["10th", "10"], ["75th", "75"], ["150th", "150"], ["151+", "151+"]]) {
      const value = multiple(place === "151+" ? 151 : Number.parseInt(place, 10));
      expect(hint.en).toMatch(new RegExp(`^  ${place.replace("+", "\\+")} +~${value}× base`, "m"));
      expect(hint.ru).toMatch(new RegExp(`^  ${label.replace("+", "\\+")} +~${value}× базы`, "m"));
    }
  });

  it("finish model: PrimeDope's column uses the same unit, flat over the paid places", () => {
    const n = pd.pmf.length;
    const multiple = (place: number) => (pd.pmf[place - 1] * n).toFixed(1);
    expect([1, 10, 75, 150, 151, n].map(multiple)).toEqual(["1.4", "1.4", "1.4", "1.4", "0.9", "0.9"]);
    const hint = DICT["chart.trajectory.pdFinishModel.hint"];
    for (const place of ["1st", "10th", "75th", "150th"]) {
      expect(hint.en).toMatch(new RegExp(`^  ${place} +~[\\d.]+× base +~1\\.4× base$`, "m"));
    }
    expect(hint.en).toMatch(/^  151\+ +~1\.0× base +~0\.9× base, no prize$/m);
    expect(hint.ru).toMatch(/^  151\+ +~1\.0× базы +~0\.9× базы, без приза$/m);
    expect(hint.en).not.toContain("1/150 flat");
  });

  it("rake math: the pools are $100 x 1000 and $91 x 1000, and PD's SD drops about 5%", () => {
    expect(ours.pool).toBeCloseTo(100_000, 6);
    expect(pd.pool).toBeCloseTo(91_000, 6);
    expect(Math.round((1 - pd.sd / pdPreRake.sd) * 100)).toBe(5);
    const hint = DICT["chart.trajectory.pdRakeMath.hint"];
    for (const text of [hint.en, hint.ru]) {
      expect(text).toContain("$100 × 1000");
      expect(text).toContain("$91 × 1000");
      expect(text).not.toContain("$109 × 1000");
      expect(text).toContain("≈5%");
    }
  });
});

describe("PrimeDope readouts under a live tilt channel", () => {
  const primary = runSimulation(input);
  const other = runSimulation({ ...input, seed: 43 });
  const diffRows = (tiltActive: boolean) => {
    const markup = renderToStaticMarkup(<LocaleProvider><PrimedopeDiff primary={primary} other={other} tiltActive={tiltActive} /></LocaleProvider>);
    return [...markup.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0].replace(/<[^>]+>/g, " "));
  };

  it("labels cost x ROI as before tilt and adds the simulated mean", () => {
    const rows = diffRows(true);
    expect(rows.some((row) => row.includes(DICT["pd.row.ev"].ru))).toBe(false);
    expect(rows.some((row) => row.includes(DICT["pd.row.evBeforeTilt"].ru))).toBe(true);
    expect(rows.some((row) => row.includes(DICT["pd.row.mean"].ru))).toBe(true);
  });

  it("keeps the plain EV row and no mean row with no tilt", () => {
    const rows = diffRows(false);
    expect(rows.some((row) => row.includes(DICT["pd.row.ev"].ru))).toBe(true);
    expect(rows.some((row) => row.includes(DICT["pd.row.mean"].ru))).toBe(false);
  });

  it("names the report's expected profit as before tilt", () => {
    const markup = renderToStaticMarkup(<LocaleProvider><PrimedopeReportCard result={primary} tiltActive /></LocaleProvider>);
    expect(markup).toContain(DICT["pd.report.expectedProfit.beforeTilt"].ru);
  });
});

describe("PrimeDope report intervals", () => {
  it("says the lines are mean ± k SD, a normal approximation", () => {
    const result = runSimulation(input);
    const markup = renderToStaticMarkup(<LocaleProvider><PrimedopeReportCard result={result} /></LocaleProvider>);
    expect(markup).toContain("нормальное приближение");
    for (const k of ["1,04", "1,96", "3"]) expect(markup).toContain(`среднее ± ${k} SD`);
  });
});

describe("PrimeDope log button", () => {
  it("speaks the UI language", () => {
    const result = runSimulation(input);
    const markup = renderToStaticMarkup(<LocaleProvider>
      <CopyPdDiagButton schedule={input.schedule} scheduleRepeats={1} bankroll={0} result={result} pdChart={null}
        pdOverrideStatus="idle" usePdPayouts usePdFinishModel usePdRakeMath />
    </LocaleProvider>);
    expect(markup).toContain(DICT["pd.copyLogs"].ru);
    expect(markup).toContain(DICT["pd.copyLogs.title"].ru);
    expect(markup).not.toMatch(/copy PD logs/i);
  });
});
