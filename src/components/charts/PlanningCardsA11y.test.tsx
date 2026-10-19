import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DICT } from "@/lib/i18n/dict";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { fmtAfs } from "@/lib/sim/convergenceMath";
import type { ItmTargetConfig } from "@/lib/sim/itmTarget";
import type { TournamentRow } from "@/lib/sim/types";
import { ConvergenceChart } from "./ConvergenceChart";
import { ProveEdgeCard } from "./ProveEdgeCard";

const OFF: ItmTargetConfig = { enabled: false, pct: 0 };
const render = (node: React.ReactNode) =>
  renderToStaticMarkup(<LocaleProvider>{node}</LocaleProvider>);
const sliders = (markup: string) =>
  (markup.match(/<input\b[^>]*>/g) ?? []).filter((tag) => tag.includes('type="range"'));

const schedule: TournamentRow[] = [
  {
    id: "r", label: "r", players: 5000, buyIn: 10, rake: 0.1, roi: 0.1,
    payoutStructure: "mtt-standard", gameType: "freezeout", count: 100,
  },
];

// The slider's value is a 0-1 position on a log scale; read aloud it is "0.353".
describe("AFS sliders say the field size", () => {
  it("on the convergence card", () => {
    const markup = render(<ConvergenceChart schedule={schedule} itmTarget={OFF} />);
    const [afs] = sliders(markup).filter((tag) => tag.includes('aria-label="AFS"'));
    expect(afs).toBeDefined();
    expect(afs).toContain(`aria-valuetext="${fmtAfs(5000, "ru-RU")}"`);
  });

  it("on the prove-edge card", () => {
    const markup = render(<ProveEdgeCard itmTarget={OFF} />);
    const [afs] = sliders(markup).filter((tag) =>
      tag.includes(`aria-label="${DICT["proveEdge.label.fieldSize"].ru}"`),
    );
    expect(afs).toBeDefined();
    expect(afs).toContain(`aria-valuetext="${fmtAfs(200, "ru-RU")}"`);
  });
});

// At 320 CSS px the card is about 250 px wide. A flex row cannot shrink a range
// input below its 129 px intrinsic width unless min-width is 0, and a fixed
// w-32 nowrap caption takes half of what is left.
describe("slider rows fit a 320 px screen", () => {
  it("lets every range input shrink inside a flex row", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const rule = css.match(/input\[type="range"\]\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/min-width:\s*0\b/);
  });

  it("does not pin the prove-edge captions to a wide nowrap column", () => {
    const markup = render(<ProveEdgeCard itmTarget={OFF} />);
    expect(markup).not.toContain("w-32 shrink-0 whitespace-nowrap");
  });
});
