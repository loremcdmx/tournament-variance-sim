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
