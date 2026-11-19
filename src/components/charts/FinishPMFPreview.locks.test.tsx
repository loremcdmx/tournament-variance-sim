import { describe, expect, it, vi } from "vitest";

// ShapeControls only reads the language through hooks; with no DOM the test
// calls it as a function and presses the lock buttons' own handlers.
vi.mock("@/lib/i18n/LocaleProvider", () => ({
  useT: () => (key: string) => key,
  useLocale: () => ({ locale: "en" }),
}));

import { compileSchedule } from "@/lib/sim/engine";
import { applyItmTarget } from "@/lib/sim/itmTarget";
import { computeRowStats } from "@/lib/sim/previewRowStats";
import { compiledEntryMoments } from "@/lib/sim/scheduleMoments";
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

const model = { id: "power-law" as const };
const OFF = { enabled: false, pct: 18.7 };

// Press "lock" on one row of the panel (0 = P(1st), 1 = top-3, 2 = FT), merge the patch into the raw row as the
// page does, and derive the effective row again.
function pressLock(raw: TournamentRow, index: number): TournamentRow {
  const effective = applyItmTarget([raw], OFF)[0];
  const onRowChange = vi.fn();
  const tree = ShapeControls({ row: effective, stats: computeRowStats(effective, model), onRowChange });
  const buttons = elements(tree).filter(
    (e) => e.type === "button" && (e.props.children === "shape.lock" || e.props.children === "shape.unlock"),
  );
  expect(buttons[index].props.children).toBe("shape.lock");
  (buttons[index].props.onClick as () => void)();
  const [patch] = onRowChange.mock.calls[0] as [Partial<TournamentRow>];
  return applyItmTarget([{ ...raw, ...patch }], OFF)[0];
}

function played(row: TournamentRow) {
  const entry = compileSchedule({
    schedule: [row], scheduleRepeats: 1, samples: 1, bankroll: 1, seed: 1, finishModel: model,
  }).flat[0];
  const m = compiledEntryMoments(entry);
  return { stats: computeRowStats(row, model), sigma: Math.sqrt(m.secondDollar - m.meanDollar ** 2) };
}

const sitThrough = (aggression: number): TournamentRow => ({
  id: "r", players: 500, buyIn: 50, rake: 0.1, roi: 0.2,
  payoutStructure: "mtt-standard", gameType: "freezeout", count: 1,
  sitThroughPayJumps: true, payJumpAggression: aggression,
});

describe("ShapeControls: a lock holds the row as it plays", () => {
  it.each([
    ["with sit-through 50%", sitThrough(0.5)],
    ["with sit-through 100%", sitThrough(1)],
    ["without sit-through", { ...sitThrough(0), sitThroughPayJumps: false }],
  ])("locking P(1st) %s changes nothing the engine plays", (_name, raw) => {
    const before = played(applyItmTarget([raw], OFF)[0]);
    const after = played(pressLock(raw, 0));
    expect(after.stats.shellP1).toBeCloseTo(before.stats.shellP1, 12);
    expect(after.sigma).toBeCloseTo(before.sigma, 6);
  });

  it.each([
    ["with sit-through 50%", sitThrough(0.5)],
    ["with sit-through 100%", sitThrough(1)],
  ])("stamps what the solver pins, so a lock %s is its own fixed point", (_name, raw) => {
    for (const [index, lockKey] of [[0, "first"], [2, "ft"]] as const) {
      const locked = pressLock(raw, index);
      const stamped = locked.finishBuckets![lockKey]!;
      const stats = computeRowStats(locked, model);
      expect(index === 0 ? stats.lockP1 : stats.lockFt).toBeCloseTo(stamped, 12);
    }
  });

  it("re-locking after auto lands on the same lock", () => {
    const raw = sitThrough(0.5);
    const first = pressLock(raw, 0).finishBuckets?.first;
    const relocked = pressLock({ ...raw, ...pressLock(raw, 0), finishBuckets: undefined }, 0);
    expect(relocked.finishBuckets?.first).toBe(first);
  });
});
