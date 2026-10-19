import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { DICT } from "@/lib/i18n/dict";
import { simulateCash } from "@/lib/sim/cashEngine";
import { DEFAULT_CASH_INPUT } from "@/lib/sim/cashInput";
import { CashResultsView } from "./CashResultsView";
import { isEmptyHistogram } from "./CashResultsShared";

function render(overrides: Partial<typeof DEFAULT_CASH_INPUT>): string {
  const result = simulateCash({
    ...DEFAULT_CASH_INPUT,
    hands: 1000,
    nSimulations: 20,
    hoursBlock: undefined,
    ...overrides,
  });
  return renderToStaticMarkup(
    <LocaleProvider>
      <CashResultsView result={result} />
    </LocaleProvider>,
  );
}

const ru = (key: keyof typeof DICT) => DICT[key].ru;
const escaped = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

describe("isEmptyHistogram", () => {
  it("is empty when no bin holds a count", () => {
    expect(isEmptyHistogram({ binEdges: [0, 1], counts: [0] })).toBe(true);
    expect(isEmptyHistogram({ binEdges: [0, 1, 2], counts: [0, 0] })).toBe(true);
    expect(isEmptyHistogram({ binEdges: [0, 1, 2], counts: [0, 3] })).toBe(false);
  });
});

describe("cash streaks card with nothing to chart", () => {
  const losing = { wrBb100: -100, sdBb100: 1 };

  it("says nobody recovered instead of drawing an empty hands axis", () => {
    const text = render(losing);
    expect(text).toContain(escaped(ru("cash.chart.recovery.empty")));
  });

  it("charts the recovery times when some runs recovered", () => {
    const text = render({ wrBb100: 5, sdBb100: 100, hands: 20_000 });
    expect(text).not.toContain(escaped(ru("cash.chart.recovery.empty")));
  });

  it("says no run fell below a previous peak instead of an empty breakeven chart", () => {
    const text = render({ wrBb100: 5000, sdBb100: 1 });
    expect(text).toContain(escaped(ru("cash.chart.breakeven.empty")));
    expect(text).not.toContain(escaped(ru("cash.chart.recovery.empty")));
  });
});

describe("recovery readouts say they are over the recovered runs only", () => {
  it("qualifies the median pill and explains the censoring", () => {
    const text = render({ wrBb100: -5, sdBb100: 100, hands: 20_000 });
    expect(text).toContain(escaped(ru("cash.summary.recoveryMedian")));
    expect(text).toContain(escaped(ru("cash.summary.recoveryMedian.tip")));
    expect(ru("cash.summary.recoveryMedian")).toMatch(/восстановивш/);
  });

  it("qualifies the p90 on the hero card", () => {
    expect(ru("cash.hero.breakeven.subRecovery")).toMatch(/восстановивш/);
    expect(DICT["cash.hero.breakeven.subRecovery"].en).toMatch(/recovered/);
    expect(DICT["cash.summary.recoveryMedian"].en).toMatch(/recovered/);
  });
});
