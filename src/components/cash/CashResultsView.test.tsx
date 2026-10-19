import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { DICT } from "@/lib/i18n/dict";
import { simulateCash } from "@/lib/sim/cashEngine";
import { DEFAULT_CASH_INPUT } from "@/lib/sim/cashInput";
import { CashResultsView } from "./CashResultsView";
import { isEmptyHistogram, signTone } from "./CashResultsShared";

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

const plain = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const rake = { enabled: true, contributedRakeBb100: 8, advertisedRbPct: 30, pvi: 1 };
const noRake = { ...rake, enabled: false };
const mixRow = (label: string, enabled: boolean) => ({
  label,
  wrBb100: 5,
  sdBb100: 100,
  bbSize: 1,
  handShare: 0.5,
  rake: enabled ? rake : noRake,
});

describe("expected EV hero card tone", () => {
  const heroValueClass = (text: string) =>
    text.match(
      new RegExp(`${ru("cash.hero.expected")}</span></div><div class="([^"]*)"`),
    )?.[1] ?? "";

  it("is red for a losing player, green for a winner, plain at zero", () => {
    expect(heroValueClass(render({ wrBb100: -8, hands: 20_000 }))).toContain("--color-heart");
    expect(heroValueClass(render({ wrBb100: 8, hands: 20_000 }))).toContain("--color-club");
    expect(heroValueClass(render({ wrBb100: 0 }))).not.toMatch(/--color-(heart|club)/);
  });

  it("maps the sign of a value to a tone", () => {
    expect(signTone(-1600)).toBe("neg");
    expect(signTone(12)).toBe("pos");
    expect(signTone(0)).toBeUndefined();
    expect(signTone(1e-12)).toBeUndefined();
  });
});

describe("economics card when the rakeback toggle is off", () => {
  it("says rake is not modelled instead of printing a paid rake of 0", () => {
    const text = render({ rake: noRake });
    expect(text).toContain(escaped(ru("cash.stats.rakeNotModelled")));
    expect(text).not.toContain("Заплачено рейка");
    expect(text).not.toContain("Рейкбек получен");
  });

  it("keeps the rake and rakeback totals when the toggle is on", () => {
    const text = render({ rake });
    expect(text).toContain("Заплачено рейка");
    expect(text).toContain("Рейкбек получен");
    expect(text).not.toContain(escaped(ru("cash.stats.rakeNotModelled")));
  });

  it("still lists the hourly EV when only the rake rows are hidden", () => {
    const text = render({ rake: noRake, hoursBlock: { handsPerHour: 500 } });
    expect(text).toContain("EV / час");
    expect(text).toContain(escaped(ru("cash.stats.rakeNotModelled")));
  });

  it("drops the per-row rake bars of a mix without any rakeback", () => {
    const off = render({ stakes: [mixRow("A", false), mixRow("B", false)] });
    expect(off).not.toContain(escaped(ru("cash.mix.metric.rake")));
    const partly = render({ stakes: [mixRow("A", true), mixRow("B", false)] });
    expect(partly).toContain(escaped(ru("cash.mix.metric.rake")));
    expect(partly).not.toContain(escaped(ru("cash.stats.rakeNotModelled")));
  });
});

describe("cash results text follows the UI language", () => {
  it("prints the decimal comma and the Russian hourly suffix in the Russian UI", () => {
    const text = plain(
      render({ wrBb100: -5.55, hands: 1000, hoursBlock: { handsPerHour: 500 } }),
    );
    expect(text).toContain("-55,5 BB");
    expect(text).not.toContain("-55.5");
    expect(text).toMatch(/-\$27,8\/час/);
    expect(text).not.toMatch(/\/h\b/);
  });
});

describe("summary pill caveats", () => {
  it("reach keyboard and touch through a button that discloses the tip", () => {
    const text = render({});
    const buttons = [...text.matchAll(/<button[^>]*aria-controls="([^"]+)"[^>]*>/g)];
    expect(buttons.length).toBe(3);
    for (const [tag, id] of buttons) {
      expect(tag).toContain('type="button"');
      expect(tag).toContain('aria-expanded="false"');
      expect(tag).toMatch(/aria-label="[^"]+"/);
      expect(text).toContain(`<p id="${id}" hidden=""`);
    }
  });

  it("keeps the material caveats in the page text", () => {
    const text = render({});
    expect(text).toContain(escaped(ru("cash.summary.probBelowThresholdEver.tip")));
    expect(text).toContain(escaped(ru("cash.summary.riskOfRuinAsymptotic.tip")));
  });
});
