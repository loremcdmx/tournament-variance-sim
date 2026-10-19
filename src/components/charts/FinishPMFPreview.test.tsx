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
