import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { BigStat } from "./StatCards";

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(<LocaleProvider>{node}</LocaleProvider>);

const riskSubline = {
  label: "Current risk",
  pointLabel: "Risk",
  pointHint: "hint",
  pointValue: "36.7%",
  leftScaleLabel: "0% risk",
  rightScaleLabel: "100% risk",
  fromLabel: "5% risk",
  toLabel: "1% risk",
  minValue: "$7,867",
  maxValue: "$8,551",
  riskRatio: 0.367,
};

describe("BigStat sublines", () => {
  it("keeps the horizon caption under the risk-of-ruin scale", () => {
    const markup = render(
      <BigStat label="Bankroll bust risk" value="36.7%" riskSubline={riskSubline}
        sub="chance your bankroll streaks to zero · within 200 tournaments (one sample)" />,
    );
    expect(markup).toContain("$8,551");
    expect(markup).toContain("within 200 tournaments");
  });

  it("still lets the range subline stand in for its duplicate caption", () => {
    const markup = render(
      <BigStat label="Expected profit" value="$1,000"
        rangeSubline={{ label: "Range", fromLabel: "p5", toLabel: "p95", pointLabel: "EV",
          pointHint: "hint", minValue: "-$500", maxValue: "$2,500", anchorRatio: 0.3 }}
        sub="duplicate range caption" />,
    );
    expect(markup).not.toContain("duplicate range caption");
  });
});
