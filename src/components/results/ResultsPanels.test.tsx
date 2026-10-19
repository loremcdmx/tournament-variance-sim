import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { runSimulation } from "@/lib/sim/engine";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import type { ControlsState } from "@/components/ControlsPanel";
import type { FinishModelConfig, SimulationResult, TournamentRow } from "@/lib/sim/types";
import { AdvancedStatsCard, SettingsDumpCard, settingsDumpRoi } from "./ResultsPanels";
import { CalibrationNotices, PrimedopeReportCard } from "./PrimedopeDiagnostics";

const base = runSimulation({
  schedule: [{ id: "t", players: 100, buyIn: 10, rake: 0.1, roi: 0.2,
    payoutStructure: "mtt-standard" as const, count: 40 }],
  samples: 256, scheduleRepeats: 1, seed: 7, bankroll: 500,
  finishModel: { id: "power-law" as const },
});

function withTail(excessKurtosis: number, mcSeStdDev: number): SimulationResult {
  return { ...base, stats: { ...base.stats, kurtosis: excessKurtosis, mcSeStdDev } };
}

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(<LocaleProvider>{node}</LocaleProvider>);

describe("heavy-tail marking in the results panels", () => {
  const heavy = withTail(300, base.stats.stdDev * 0.12);
  const light = withTail(0.5, base.stats.stdDev * 0.01);

  it("shows σ with its error and flags Kelly as unstable on a heavy tail", () => {
    expect(base.stats.kellyFraction).toBeGreaterThan(0);
    const markup = render(<AdvancedStatsCard result={heavy} bankroll={500} />);
    expect(markup).toContain("σ профита");
    expect(markup).toContain("±12%");
    expect(markup.match(/неустойчиво · тяжёлый хвост/g)).toHaveLength(2);
  });

  it("keeps a light-tailed run free of the warning and of the error figure", () => {
    const markup = render(<AdvancedStatsCard result={light} bankroll={500} />);
    expect(markup).toContain("σ профита");
    expect(markup).not.toContain("тяжёлый хвост");
    expect(markup).not.toContain("±");
  });

  it("marks the Gaussian ruin estimates as overstated on a heavy tail only", () => {
    const heavyMarkup = render(<PrimedopeReportCard result={heavy} />);
    expect(heavyMarkup.match(/завышено при тяжёлом хвосте/g)).toHaveLength(2);
    expect(heavyMarkup).toContain("±12%");
    const lightMarkup = render(<PrimedopeReportCard result={light} />);
    expect(lightMarkup).not.toContain("завышено при тяжёлом хвосте");
  });
});

describe("settings dump on a fixed-shape skill model", () => {
  const schedule: TournamentRow[] = [{
    id: "t", players: 1000, buyIn: 50, rake: 0.1, roi: 0.1,
    payoutStructure: "mtt-standard", count: 200,
  }];
  const settings = (finishModelId: string) => ({
    samples: 6000, scheduleRepeats: 1, bankroll: 0, finishModelId, alphaOverride: null,
    modelPresetId: "custom", compareEnabled: false, compareMode: "random", roiStdErr: 0,
  }) as unknown as ControlsState;
  const dump = (model: FinishModelConfig) => {
    const result = runSimulation({
      schedule, scheduleRepeats: 1, samples: 6000, bankroll: 0, seed: 5, finishModel: model,
    });
    return render(
      <SettingsDumpCard settings={settings(model.id)} schedule={schedule} result={result} />,
    );
  };

  it("says the typed ROI is ignored when the realized ROI differs", () => {
    expect(dump({ id: "freeze-realdata-step" })).toContain("fixed shape, target ignored");
  });

  it("stays quiet for a calibrated model that hits its target", () => {
    expect(dump({ id: "power-law" })).not.toContain("target ignored");
  });
});

describe("calibration notices print the row label as typed", () => {
  const schedule: TournamentRow[] = [{
    id: "t", label: "$$$ Mid $& {target}", players: 1000, buyIn: 50, rake: 0.1, roi: 0.1,
    payoutStructure: "mtt-standard", count: 1,
  }];
  const result = {
    ...base,
    calibrationWarnings: [{ rowId: "t", targetWinnings: 55, actualWinnings: 50 }],
  } as unknown as SimulationResult;

  it("keeps $ sequences and braces in a user label out of the template engine", () => {
    const markup = render(<CalibrationNotices result={result} schedule={schedule} />);
    expect(markup).toContain("$$$ Mid $&amp; {target}");
    expect(markup).not.toContain("{row}");
  });
});

describe("settings dump money", () => {
  it("prints a Battle Royale ticket without float noise", () => {
    const br = [{
      id: "br", players: 18, buyIn: 3 * (1 - 0.08), rake: 0.08 / 0.92, roi: 0.03,
      payoutStructure: "battle-royale" as const, count: 10,
    }];
    const markup = render(
      <SettingsDumpCard
        settings={{
          samples: 100, scheduleRepeats: 1, bankroll: 0, finishModelId: "power-law",
          alphaOverride: null, modelPresetId: "naive", compareEnabled: false,
          compareMode: "primedope", roiStdErr: 0,
        } as unknown as ControlsState}
        schedule={br}
        result={base}
      />,
    );
    expect(markup).toContain("$2.76");
    expect(markup).not.toContain("2.7600000000000002");
  });
});

describe("settings dump ROI on a multi-row schedule", () => {
  const rowA: TournamentRow = {
    id: "a", label: "Small", players: 500, buyIn: 10, rake: 0.1, roi: 0.05,
    payoutStructure: "mtt-standard", count: 400,
  };
  const rowB: TournamentRow = {
    id: "b", label: "Big", players: 500, buyIn: 100, rake: 0.1, roi: 0.3,
    payoutStructure: "mtt-standard", count: 100,
  };
  const settings = (rakebackPct: number) => ({
    samples: 4000, scheduleRepeats: 1, bankroll: 0, finishModelId: "power-law", alphaOverride: null,
    modelPresetId: "custom", compareEnabled: false, compareMode: "primedope", roiStdErr: 0, rakebackPct,
  }) as unknown as ControlsState;
  const dump = (schedule: TournamentRow[], rakebackPct: number) => {
    const result = runSimulation({
      schedule, scheduleRepeats: 1, samples: 4000, bankroll: 0, seed: 11,
      finishModel: { id: "power-law" }, rakebackFracOfRake: rakebackPct / 100,
    });
    return {
      result,
      markup: render(<SettingsDumpCard settings={settings(rakebackPct)} schedule={schedule} result={result} />),
    };
  };
  const value = (markup: string, key: string) => {
    const m = markup.match(new RegExp(`<span[^>]*>${key.replace(/[()]/g, "\\$&")}</span><span[^>]*>([^<]*)</span>`));
    expect(m, key).not.toBeNull();
    return m![1];
  };

  it("labels the first row's figures and adds the cost-weighted target next to them", () => {
    const { markup } = dump([rowA, rowB], 0);
    expect(value(markup, "assumed ROI (row 1)")).toBe("5.0%");
    // 4400 of cost at +5 % and 11000 at +30 %: profit 3520 over cost 15400.
    expect(value(markup, "assumed ROI (all rows, by cost)")).toBe("22.9%");
    expect(value(markup, "buyIn (row 1)")).toBe("$10");
    expect(markup).not.toContain(">assumed ROI<");
  });

  it("puts the realized figure next to the weighted target, where a calibrated run lands on it", () => {
    const { markup, result } = dump([rowA, rowB], 0);
    const realized = (result.stats.mean / result.totalBuyIn) * 100;
    expect(realized).toBeGreaterThan(21);
    expect(realized).toBeLessThan(25);
    expect(value(markup, "realized ROI")).toBe(`${realized.toFixed(1)}%`);
  });

  it("keeps the one-row dump as it was", () => {
    const { markup } = dump([rowA], 0);
    expect(value(markup, "assumed ROI")).toBe("5.0%");
    expect(markup).not.toContain("(row 1)");
    expect(markup).not.toContain("all rows");
  });

  it("says the realized ROI carries the rakeback the run pays", () => {
    expect(value(dump([rowA], 20).markup, "realized ROI (incl. rakeback)")).toMatch(/%$/);
    expect(dump([rowA], 0).markup).not.toContain("incl. rakeback");
  });

  it("measures the target gap without the rakeback, which sits on top of the typed ROI", () => {
    const rakeback = (0.2 * 0.1) / 1.1;
    const one = settingsDumpRoi([rowA], 20, 0.05 + rakeback);
    expect(one.target).toBe(0.05);
    expect(one.rakeback).toBeCloseTo(rakeback, 12);
    expect(one.gap).toBeCloseTo(0, 12);
    const both = settingsDumpRoi([rowA, rowB], 20, 0.2294 + rakeback);
    expect(both.target).toBeCloseTo(3520 / 15400, 12);
    expect(both.rakeback).toBeCloseTo(rakeback, 12);
    expect(both.gap).toBeCloseTo(0.2294 - 3520 / 15400, 12);
  });

  it("reads a missing rakeback as none", () => {
    expect(settingsDumpRoi([rowA], undefined as unknown as number, 0.05).rakeback).toBe(0);
  });
});
