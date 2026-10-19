import { describe, expect, it, vi } from "vitest";

// ShapeControls only reads the language through hooks; with no DOM the test
// calls it as a function and fires the preset select's own handler.
vi.mock("@/lib/i18n/LocaleProvider", () => ({
  useT: () => (key: string) => key,
  useLocale: () => ({ locale: "en" }),
}));

import { applyItmTarget } from "@/lib/sim/itmTarget";
import { computeRowStats } from "@/lib/sim/previewRowStats";
import type { TournamentRow } from "@/lib/sim/types";
import { ShapeControls } from "./FinishPMFPreview";

type El = { type: unknown; props: Record<string, unknown> };

function elements(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, out);
  } else if (node && typeof node === "object" && "props" in node) {
    out.push(node as El);
    elements((node as El).props.children, out);
  }
  return out;
}

const OFF = { enabled: false, pct: 18.7 };

function pickPreset(row: TournamentRow, preset: string) {
  const stats = computeRowStats(row, { id: "power-law" });
  const onRowChange = vi.fn();
  const tree = ShapeControls({ row, stats, onRowChange });
  const select = elements(tree).find((e) => e.type === "select")!;
  (select.props.onChange as (e: unknown) => void)({ target: { value: preset } });
  return onRowChange;
}

const row = (over: Partial<TournamentRow>): TournamentRow => ({
  id: "r", players: 1000, buyIn: 25, rake: 0.1, roi: 0.1,
  payoutStructure: "mtt-standard", gameType: "freezeout", count: 1, ...over,
});

describe("the No-skill preset sets the payout table's own paid share", () => {
  it("is the equilibrium rate an untouched row already runs", () => {
    const plain = row({});
    const onRowChange = pickPreset(plain, "noskill");
    const expected = applyItmTarget([plain], OFF)[0].itmRate!;
    expect(onRowChange).toHaveBeenCalledExactlyOnceWith({ finishBuckets: undefined, itmRate: expect.closeTo(expected, 9) });
  });

  it("counts the late-registration field the paid places come from, not the nominal one", () => {
    const lateReg = row({ lateRegMultiplier: 3 });
    const onRowChange = pickPreset(lateReg, "noskill");
    const expected = applyItmTarget([lateReg], OFF)[0].itmRate!;
    expect(expected).toBeLessThan(0.2);
    const [patch] = onRowChange.mock.calls[0] as [{ itmRate: number }];
    expect(patch.itmRate).toBeCloseTo(expected, 9);
  });
});
