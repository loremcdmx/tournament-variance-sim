import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The row's number boxes keep their draft in hooks. With no DOM, a call-order
// hook store lets the test render the real ScheduleRow, then the real ROI box
// inside it, and fire the handlers React would call.
type Cell = { value: unknown };
const store: { cells: Cell[]; at: number } = { cells: [], at: 0 };

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const i = store.at++;
      store.cells[i] ??= { value: typeof initial === "function" ? (initial as () => unknown)() : initial };
      const cell = store.cells[i];
      return [
        cell.value,
        (next: unknown) => {
          cell.value = typeof next === "function" ? (next as (p: unknown) => unknown)(cell.value) : next;
        },
      ];
    },
    useRef: (initial: unknown) => {
      const i = store.at++;
      store.cells[i] ??= { value: { current: initial } };
      return store.cells[i].value;
    },
    useEffect: () => {},
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
    useLayoutEffect: (fn: () => void) => fn(),
  };
});
vi.mock("@/lib/i18n/LocaleProvider", async () => {
  const { DICT } = await import("@/lib/i18n/dict");
  return { useT: () => (key: keyof typeof DICT) => DICT[key].en };
});
vi.mock("@/lib/ui/AdvancedModeProvider", () => ({
  useAdvancedMode: () => ({ advanced: false }),
}));

import { AdvancedRowPanel, ScheduleEditor } from "./ScheduleEditor";
import { applyGameType } from "@/lib/sim/gameType";
import {
  BATTLE_ROYALE_MARKETED_RAKE_SHARE_OF_TOTAL,
  battleRoyaleRowFromTotalTicket,
} from "@/lib/sim/battleRoyaleTicket";
import type { TournamentRow } from "@/lib/sim/types";

type El = { type: unknown; props: Record<string, unknown> };
type Fn = (...args: unknown[]) => unknown;
type Component = (props: Record<string, unknown>) => unknown;

function elements(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, out);
  } else if (node && typeof node === "object" && "props" in node) {
    out.push(node as El);
    elements((node as El).props.children, out);
  }
  return out;
}

const unwrap = (type: unknown): Component =>
  ((type as { type?: Component }).type ?? type) as Component;

const row = (roi: number): TournamentRow => ({
  id: "a", label: "a", players: 1000, buyIn: 20, rake: 0.1, roi,
  payoutStructure: "mtt-standard", gameType: "freezeout", count: 1,
});

function mountRow(r: TournamentRow, globalRakebackPct = 0) {
  store.cells = [];
  store.at = 0;
  const update = vi.fn();
  const editor = unwrap(ScheduleEditor)({ schedule: [r], onChange: vi.fn(), globalRakebackPct });
  const rowEl = elements(editor).find((e) => typeof e.props.update === "function")!;
  const rowTree = unwrap(rowEl.type)({ ...rowEl.props, update });
  return { update, rowTree };
}

// Renders the editor, its row, the row's number box `id` and the <input> inside
// it, with the hook cells of the box (the third component down) kept between renders.
function mountBox(r: TournamentRow, id: string) {
  const { update, rowTree } = mountRow(r);
  const boxEl = elements(rowTree).find((e) => e.props.id === id)!;
  const boxTree = unwrap(boxEl.type)(boxEl.props);
  const numEl = elements(boxTree).find((e) => e.props.id === id && e.type !== boxEl.type)!;
  store.cells = [];
  const input = () => {
    store.at = 0;
    return unwrap(numEl.type)(numEl.props) as { props: Record<string, unknown> };
  };
  return { update, input };
}

const mountRoiBox = (roi: number) => mountBox(row(roi), "schedule-a-roi");

beforeEach(() => {
  vi.stubGlobal("React", React);
});
afterEach(() => vi.unstubAllGlobals());

describe("row ROI box commits what was typed", () => {
  it("shows the stored fractional ROI", () => {
    expect(mountRoiBox(0.025).input().props.value).toBe("2.5");
  });

  it("commits 7.5 as 7.5 %, not as 8 %", () => {
    const { update, input } = mountRoiBox(0.1);
    (input().props.onChange as Fn)({ target: { value: "7.5" } });
    (input().props.onBlur as Fn)();
    expect(update).toHaveBeenCalledExactlyOnceWith("a", { roi: 0.075 });
  });

  it("keeps two decimals of a percent", () => {
    const { update, input } = mountRoiBox(0.1);
    (input().props.onChange as Fn)({ target: { value: "2.25" } });
    (input().props.onBlur as Fn)();
    expect(update).toHaveBeenCalledExactlyOnceWith("a", { roi: 0.0225 });
  });

  it("treats the old rounded figure as a real change on a 2.5 % row", () => {
    const { update, input } = mountRoiBox(0.025);
    (input().props.onChange as Fn)({ target: { value: "3" } });
    (input().props.onBlur as Fn)();
    expect(update).toHaveBeenCalledExactlyOnceWith("a", { roi: 0.03 });
  });

  it("leaves the row alone when the shown figure is retyped", () => {
    const { update, input } = mountRoiBox(0.025);
    (input().props.onChange as Fn)({ target: { value: "2.5" } });
    (input().props.onBlur as Fn)();
    expect(update).not.toHaveBeenCalled();
  });

  it("still clamps to the editor range", () => {
    const { update, input } = mountRoiBox(0.1);
    (input().props.onChange as Fn)({ target: { value: "-250" } });
    (input().props.onBlur as Fn)();
    expect(update).toHaveBeenCalledExactlyOnceWith("a", { roi: -0.99 });
  });
});

describe("row bounty-share box keeps what was typed, one decimal", () => {
  const pko = (bountyFraction: number): TournamentRow => ({
    ...row(0.1),
    ...applyGameType(row(0.1), "pko"),
    bountyFraction,
  });
  const typed = (start: TournamentRow, text: string) => {
    const { update, input } = mountBox(start, "schedule-a-bounty");
    (input().props.onChange as Fn)({ target: { value: text } });
    (input().props.onBlur as Fn)();
    return update;
  };

  it.each([
    ["33", 0.33],
    ["42", 0.42],
    ["12.5", 0.125],
    ["2", 0.02],
    ["33.33", 0.333],
  ])("commits a typed %s as a share of %s, not the nearest multiple of 5", (text, fraction) => {
    const update = typed(pko(0.5), text);
    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0][0]).toBe("a");
    expect(update.mock.calls[0][1].bountyFraction).toBeCloseTo(fraction, 12);
  });

  it("still clamps to 0..90", () => {
    expect(typed(pko(0.5), "95")).toHaveBeenCalledExactlyOnceWith("a", { bountyFraction: 0.9 });
  });

  it("shows the Ocean and Battle Royale structural shares to one decimal, and retyping them is no change", () => {
    for (const [gameType, shown] of [["ocean-ko", "54.3"], ["mystery-royale", "45.7"]] as const) {
      const start = { ...row(0.1), ...applyGameType(row(0.1), gameType) };
      expect(mountBox(start, "schedule-a-bounty").input().props.value).toBe(shown);
      expect(typed(start, shown)).not.toHaveBeenCalled();
    }
  });
});

describe("advanced row boxes keep what was typed, not the arrow-key grid", () => {
  // Renders the advanced panel, the number box whose arrow step is `step`, and
  // the <input> inside it, with the box's hook cells kept between renders.
  const mountAdvancedBox = (r: TournamentRow, step: number) => {
    store.cells = [];
    store.at = 0;
    const onChange = vi.fn();
    const panel = unwrap(AdvancedRowPanel)({ row: r, onChange });
    const boxEl = elements(panel).find((e) => e.props.step === step && typeof e.type === "function")!;
    store.cells = [];
    const input = () => {
      store.at = 0;
      return unwrap(boxEl.type)(boxEl.props) as { props: Record<string, unknown> };
    };
    return { onChange, input };
  };
  // The three ways a typed figure reaches the row: leaving the box, Enter, and
  // the live commit 140 ms after the last keystroke.
  type Path = "blur" | "Enter" | "pause";
  const PATHS: Path[] = ["blur", "Enter", "pause"];
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const typed = (r: TournamentRow, step: number, text: string, path: Path = "blur") => {
    const { onChange, input } = mountAdvancedBox(r, step);
    (input().props.onChange as Fn)({ target: { value: text } });
    if (path === "blur") (input().props.onBlur as Fn)();
    else if (path === "Enter") (input().props.onKeyDown as Fn)({ key: "Enter", preventDefault: () => {} });
    else vi.advanceTimersByTime(140);
    return onChange;
  };
  const mystery = (mysteryBountyVariance: number): TournamentRow => ({
    ...row(0.1),
    ...applyGameType(row(0.1), "mystery"),
    mysteryBountyVariance,
  });
  const sitThrough = (payJumpAggression: number): TournamentRow => ({
    ...row(0.1),
    sitThroughPayJumps: true,
    payJumpAggression,
  });

  it.each(
    PATHS.flatMap((path) =>
      ([
        ["2.25", 2.25],
        ["1.85", 1.85],
        ["0.04", 0.04],
        ["2.257", 2.26],
      ] as const).map(([text, variance]) => [path, text, variance] as const),
    ),
  )("Mystery sigma^2 on %s commits a typed %s as %s, two decimals, not the 0.1 grid", (path, text, variance) => {
    const onChange = typed(mystery(2), 0.1, text, path);
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0].mysteryBountyVariance).toBeCloseTo(variance, 12);
  });

  it.each(PATHS)("Mystery sigma^2 on %s still clamps to 0..3, and retyping the shown figure is no change", (path) => {
    expect(typed(mystery(2), 0.1, "4", path)).toHaveBeenCalledExactlyOnceWith({ mysteryBountyVariance: 3 });
    expect(mountAdvancedBox(mystery(2.25), 0.1).input().props.value).toBe("2.25");
    expect(typed(mystery(2.25), 0.1, "2.25", path)).not.toHaveBeenCalled();
  });

  it.each(
    PATHS.flatMap((path) =>
      ([
        ["33", 0.33],
        ["42", 0.42],
        ["12.5", 0.13],
        ["2", 0.02],
      ] as const).map(([text, aggression]) => [path, text, aggression] as const),
    ),
  )("sit-through aggression on %s commits a typed %s as %s, not the nearest multiple of 5", (path, text, aggression) => {
    const onChange = typed(sitThrough(0.5), 5, text, path);
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0].payJumpAggression).toBeCloseTo(aggression, 12);
  });

  it.each(PATHS)("sit-through aggression on %s still clamps to 0..100, and retyping the shown figure is no change", (path) => {
    expect(typed(sitThrough(0.5), 5, "120", path)).toHaveBeenCalledExactlyOnceWith({ payJumpAggression: 1 });
    expect(mountAdvancedBox(sitThrough(0.33), 5).input().props.value).toBe("33");
    expect(typed(sitThrough(0.33), 5, "33", path)).not.toHaveBeenCalled();
  });
});

describe("Battle Royale reported-ROI presets land on the ROI on the button", () => {
  const br = (roi: number): TournamentRow => ({
    ...row(roi),
    ...applyGameType(row(roi), "mystery-royale"),
    ...battleRoyaleRowFromTotalTicket(10),
    roi,
  });
  // The fee is 8 % of a BR ticket, so rakeback pays rb x 8 % of what a ticket costs.
  const reported = (fieldRoi: number, rbPct: number) =>
    fieldRoi + (rbPct / 100) * BATTLE_ROYALE_MARKETED_RAKE_SHARE_OF_TOTAL;
  const buttons = (roi: number, rbPct: number) => {
    const { update, rowTree } = mountRow(br(roi), rbPct);
    const control = elements(rowTree).find((e) => typeof e.props.onApply === "function" && "globalRakebackPct" in e.props)!;
    const tree = unwrap(control.type)(control.props);
    const list = elements(tree).filter((e) => e.type === "button");
    expect(list.map((b) => b.props.children)).toEqual(["3", "5", "7", "10"]);
    return { update, list };
  };

  it.each([20, 30, 33, 40, 45])("each button writes the field ROI that gives its reported ROI at rakeback %s", (rbPct) => {
    const { update, list } = buttons(0.1, rbPct);
    for (const [k, target] of [0.03, 0.05, 0.07, 0.1].entries()) {
      update.mockClear();
      (list[k].props.onClick as Fn)();
      expect(update).toHaveBeenCalledOnce();
      const patch = update.mock.calls[0][1] as Partial<TournamentRow>;
      expect(patch.bountyEvBias).toBe(0);
      expect(reported(patch.roi!, rbPct)).toBeCloseTo(target, 6);
    }
  });

  it("lights the button whose reported ROI the row gives, and only that one", () => {
    const pressed = (roi: number, rbPct: number) =>
      buttons(roi, rbPct).list.map((b) => b.props["aria-pressed"]);
    expect(pressed(0.014, 20)).toEqual([true, false, false, false]);
    expect(pressed(0.01, 20)).toEqual([false, false, false, false]);
    expect(pressed(-0.002, 40)).toEqual([true, false, false, false]);
  });

  it("states the field ROI the button writes, so the tooltip adds up", () => {
    expect(buttons(0.1, 20).list.map((b) => b.props.title)).toEqual([
      "+3.0% total -> +1.40% field",
      "+5.0% good reg -> +3.40% field",
      "+7.0% good reg -> +5.40% field",
      "+10.0% top reg -> +8.40% field",
    ]);
    expect(buttons(0.1, 40).list[0].props["aria-label"]).toBe("+3.0% total -> -0.20% field");
  });
});
