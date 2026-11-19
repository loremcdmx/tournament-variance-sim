import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DICT } from "@/lib/i18n/dict";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { computeRowStats } from "@/lib/sim/previewRowStats";
import type { TournamentRow } from "@/lib/sim/types";
import { ShapeControls } from "./FinishPMFPreview";

afterEach(() => vi.unstubAllGlobals());

const base: TournamentRow = {
  id: "r1",
  players: 1000,
  buyIn: 25,
  rake: 0.1,
  roi: 0.1,
  payoutStructure: "mtt-standard",
  gameType: "freezeout",
  itmRate: 0.16,
  count: 1,
};

function render(row: TournamentRow): string {
  vi.stubGlobal("React", React);
  const stats = computeRowStats(row, { id: "power-law" });
  return renderToStaticMarkup(
    React.createElement(LocaleProvider, null,
      React.createElement(ShapeControls, { row, stats, onRowChange: vi.fn() }),
    ),
  );
}

// One lock row: label, current value, input, button.
function lockRow(html: string, labelKey: "shape.rowFirst" | "shape.rowTop3" | "shape.rowFt"): string {
  const row = html
    .split('<div class="flex items-center justify-between gap-2 py-1')
    .find((part) => part.includes(`>${DICT[labelKey].ru}</span>`));
  expect(row).toBeDefined();
  return row as string;
}

const disabledCount = (fragment: string) => (fragment.match(/disabled=""/g) ?? []).length;

describe("ShapeControls: the Top-3 lock", () => {
  it("is disabled, with the reason, until First or FT is locked", () => {
    const html = render(base);
    const top3 = lockRow(html, "shape.rowTop3");
    expect(disabledCount(top3)).toBe(2);
    expect(top3).toContain(DICT["shape.top3NeedsAnchor"].ru);
    expect(disabledCount(lockRow(html, "shape.rowFirst"))).toBe(0);
    expect(disabledCount(lockRow(html, "shape.rowFt"))).toBe(0);
  });

  it.each([{ first: 0.002 }, { ft: 0.1 }])("is available once %o is locked", (finishBuckets) => {
    const top3 = lockRow(render({ ...base, finishBuckets }), "shape.rowTop3");
    expect(disabledCount(top3)).toBe(0);
    expect(top3).not.toContain(DICT["shape.top3NeedsAnchor"].ru);
  });

  it("stays editable when a stale lone Top-3 lock is already there, so it can be cleared", () => {
    const top3 = lockRow(render({ ...base, finishBuckets: { top3: 0.05 } }), "shape.rowTop3");
    expect(disabledCount(top3)).toBe(0);
  });
});

describe("ShapeControls: the FT and top-3 rows on a row that pays fewer places", () => {
  // The solver pins top min(9, paid) and top min(3, paid): on a short table
  // that is the ITM, and the label says so instead of naming a final table.
  const labelsOf = (row: TournamentRow) => {
    const html = render(row);
    return (["shape.rowFirst", "shape.rowTop3", "shape.rowFt", "shape.rowItm"] as const)
      .filter((key) => html.includes(`>${DICT[key].ru}</span>`));
  };

  it("keeps P(FT) and P(top-3) where at least nine places are paid", () => {
    expect(labelsOf(base)).toEqual(["shape.rowFirst", "shape.rowTop3", "shape.rowFt"]);
  });

  it("calls the FT row P(ITM) on a Battle Royale row, which pays three", () => {
    const br: TournamentRow = {
      ...base, players: 18, payoutStructure: "battle-royale", gameType: "mystery-royale",
      bountyFraction: 0.45, mysteryBountyVariance: 1.8, itmRate: 0.18,
    };
    const stats = computeRowStats(br, { id: "power-law" });
    expect(stats.paidCount).toBe(3);
    expect(stats.shellFt).toBeCloseTo(stats.itm, 12);
    expect(labelsOf(br)).toEqual(["shape.rowFirst", "shape.rowTop3", "shape.rowItm"]);
  });

  it("calls both rows P(ITM) when fewer than three are paid", () => {
    const sng: TournamentRow = { ...base, players: 6, payoutStructure: "sng-65-35", itmRate: 0.3 };
    const stats = computeRowStats(sng, { id: "power-law" });
    expect(stats.paidCount).toBe(2);
    const html = render(sng);
    expect(html.split(`>${DICT["shape.rowItm"].ru}</span>`).length - 1).toBe(2);
  });
});
