import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DICT } from "@/lib/i18n/dict";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { ciToZ, scheduleEffectiveRoi } from "@/lib/sim/convergenceMath";
import type { ItmTargetConfig } from "@/lib/sim/itmTarget";
import {
  computeProveEdge,
  PROVE_EDGE_DEFAULT_CANDIDATES,
} from "@/lib/sim/proveEdge";
import type { TournamentRow } from "@/lib/sim/types";
import { ConvergenceChart } from "./ConvergenceChart";
import { ProveEdgeCard, ProveEdgeTable } from "./ProveEdgeCard";

const OFF: ItmTargetConfig = { enabled: false, pct: 0 };

function render(node: React.ReactNode): string {
  return renderToStaticMarkup(<LocaleProvider>{node}</LocaleProvider>);
}

const ru = (key: keyof typeof DICT) => DICT[key].ru;
const escaped = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** Every `<input>` tag whose aria-label is `label`. */
function inputsLabelled(markup: string, label: string): string[] {
  const out: string[] = [];
  for (const m of markup.matchAll(/<input\b[^>]*>/g)) {
    if (m[0].includes(`aria-label="${escaped(label)}"`)) out.push(m[0]);
  }
  return out;
}

function freezeRow(over: Partial<TournamentRow>): TournamentRow {
  return {
    id: "r",
    label: "r",
    players: 500,
    buyIn: 10,
    rake: 0.1,
    roi: 0.1,
    payoutStructure: "mtt-standard",
    gameType: "freezeout",
    count: 100,
    ...over,
  };
}

describe("scheduleEffectiveRoi", () => {
  it("weights each row's ROI by what it costs, not by how many tournaments it has", () => {
    const rows = [
      freezeRow({ id: "micro", buyIn: 1, roi: 0.6, count: 1000 }),
      freezeRow({ id: "high", buyIn: 100, roi: 0.1, count: 10 }),
    ];
    // 1100 of cost at +60 % and 1100 at +10 %: profit 770 over cost 2200.
    expect(scheduleEffectiveRoi(rows)).toBeCloseTo(0.35, 12);
  });

  it("is 0 for a schedule that costs nothing", () => {
    expect(scheduleEffectiveRoi([])).toBe(0);
    expect(scheduleEffectiveRoi([freezeRow({ count: 0 })])).toBe(0);
  });
});

describe("the convergence card opens on the schedule's own ROI", () => {
  const schedule = [
    freezeRow({ id: "micro", buyIn: 1, roi: 0.6, count: 1000 }),
    freezeRow({ id: "high", buyIn: 100, roi: 0.1, count: 10 }),
  ];

  it("starts the synthetic tabs at the cost-weighted ROI, the one the prove-edge anchor reads", () => {
    const markup = render(<ConvergenceChart schedule={schedule} itmTarget={OFF} />);
    const [roiBox] = inputsLabelled(markup, ru("proveEdge.label.yourRoi"));
    expect(roiBox).toBeDefined();
    expect(roiBox).toContain('value="35.0"');

    const proveEdge = computeProveEdge({
      format: "exact",
      schedule,
      afs: 500,
      rake: 0.1,
      z: ciToZ(0.95),
      currentRoi: 0,
      candidates: PROVE_EDGE_DEFAULT_CANDIDATES,
    });
    expect(proveEdge.anchor.roi).toBeCloseTo(0.35, 12);
  });
});

describe("the prove-edge rake box stays inside the grid the bands were probed on", () => {
  it("caps the slider and the number box at the same 20 %", () => {
    const markup = render(<ProveEdgeCard itmTarget={OFF} />);
    const boxes = inputsLabelled(markup, ru("proveEdge.label.rake"));
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    for (const box of boxes) {
      expect(box).toContain('max="20"');
      expect(box).not.toContain('max="50"');
    }
  });
});

describe("the prove-edge schedule table says where its σ is held", () => {
  const schedule = [freezeRow({})];

  it("notes that the σ stays at the schedule's own ROI in schedule mode", () => {
    const exact = render(
      <ProveEdgeCard schedule={schedule} defaultMode="exact" itmTarget={OFF} />,
    );
    expect(exact).toContain(escaped(ru("proveEdge.schedule.sigmaHeld")));
  });

  it("does not say it on a single-format tab, where σ follows each ROI", () => {
    const single = render(<ProveEdgeCard schedule={schedule} itmTarget={OFF} />);
    expect(single).not.toContain(escaped(ru("proveEdge.schedule.sigmaHeld")));
  });
});

describe("a candidate row outside the validated zone is marked while the anchor is inside", () => {
  const result = computeProveEdge({
    format: "mystery-royale",
    afs: 18,
    rake: 0.08,
    z: 1.96,
    currentRoi: 0.1,
    candidates: PROVE_EDGE_DEFAULT_CANDIDATES,
  });
  const table = render(<ProveEdgeTable result={result} pending={false} numberLocale="ru-RU" />);
  const marker = escaped(ru("proveEdge.row.pointOnly"));

  it("is set up as the case under test", () => {
    expect(result.bandPolicy).toBe("numeric");
    const outside = result.rows.filter((r) => !r.insideFitBox);
    expect(outside.map((r) => r.roi)).toEqual([-0.3]);
    expect(outside[0].sigmaLo).toBe(outside[0].sigmaHi);
  });

  it("flags exactly the row that prints a bare point and explains it under the table", () => {
    expect(table.match(new RegExp(`title="${marker}"`, "g"))?.length).toBe(1);
    expect(table).toContain(`<p`);
    expect(table.split(marker).length - 1).toBeGreaterThanOrEqual(2);
  });

  it("flags nothing when every candidate is inside the zone", () => {
    const inside = computeProveEdge({
      format: "mystery-royale",
      afs: 18,
      rake: 0.08,
      z: 1.96,
      currentRoi: 0.1,
      candidates: [0.3, 0.1, 0.05],
    });
    const markup = render(<ProveEdgeTable result={inside} pending={false} numberLocale="ru-RU" />);
    expect(markup).not.toContain(marker);
  });

  it("stays quiet when the anchor itself is outside, where the banner already says so", () => {
    const outsideAnchor = computeProveEdge({
      format: "mystery-royale",
      afs: 18,
      rake: 0.08,
      z: 1.96,
      currentRoi: 1.5,
      candidates: PROVE_EDGE_DEFAULT_CANDIDATES,
    });
    expect(outsideAnchor.bandPolicy).toBe("outside-fit-box");
    const markup = render(<ProveEdgeTable result={outsideAnchor} pending={false} numberLocale="ru-RU" />);
    expect(markup).not.toContain(marker);
  });
});
