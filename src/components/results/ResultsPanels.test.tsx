import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { runSimulation } from "@/lib/sim/engine";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import type { SimulationResult } from "@/lib/sim/types";
import { AdvancedStatsCard } from "./ResultsPanels";
import { PrimedopeReportCard } from "./PrimedopeDiagnostics";

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
