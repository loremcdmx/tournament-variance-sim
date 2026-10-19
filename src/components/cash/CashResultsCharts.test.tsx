import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { simulateCash } from "@/lib/sim/cashEngine";
import { DEFAULT_CASH_INPUT } from "@/lib/sim/cashInput";
import { TrajectoryChart, TrajectoryToolbar } from "./CashResultsCharts";

describe("cash trajectory visibility", () => {
  it("renders zero selected runs without a one-run legend", () => {
    const result = simulateCash({ ...DEFAULT_CASH_INPUT, hands: 1000, nSimulations: 10 });
    const props = { visibleRuns: 0, runMode: "random" as const, moneyUnit: "usd" as const,
      riskThresholdBb: 100, bbSize: 1 };
    const markup = renderToStaticMarkup(<LocaleProvider>
      <TrajectoryToolbar {...props} maxVisibleRuns={result.samplePaths.paths.length}
        onVisibleRunsChange={() => {}} onRunModeChange={() => {}} onMoneyUnitChange={() => {}} />
      <TrajectoryChart {...props} result={result} />
    </LocaleProvider>);
    const text = markup.replace(/<[^>]+>/g, "");
    expect(text).toContain("0/10");
    expect(text).not.toContain("1 ранов");
  });
});

describe("cash run-mode picker semantics", () => {
  it("is a labelled group of toggle buttons, not a radio group without radio keys", () => {
    const result = simulateCash({ ...DEFAULT_CASH_INPUT, hands: 1000, nSimulations: 10 });
    const markup = renderToStaticMarkup(<LocaleProvider>
      <TrajectoryToolbar visibleRuns={1} runMode="best" moneyUnit="usd" riskThresholdBb={100} bbSize={1}
        maxVisibleRuns={result.samplePaths.paths.length}
        onVisibleRunsChange={() => {}} onRunModeChange={() => {}} onMoneyUnitChange={() => {}} />
    </LocaleProvider>);
    expect(markup).not.toContain('role="radio');
    expect(markup).not.toContain("aria-checked");
    expect(markup).toContain('role="group"');
    expect(markup.match(/aria-pressed="true"/g)?.length).toBe(1);
  });
});
