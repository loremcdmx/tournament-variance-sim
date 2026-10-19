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
vi.mock("@/lib/i18n/LocaleProvider", () => ({ useT: () => (key: string) => key }));
vi.mock("@/lib/ui/AdvancedModeProvider", () => ({
  useAdvancedMode: () => ({ advanced: false }),
}));

import { ScheduleEditor } from "./ScheduleEditor";
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

// Renders the editor, its row, the row's ROI box and the <input> inside it, with
// the hook cells of the box (the third component down) kept between renders.
function mountRoiBox(roi: number) {
  store.cells = [];
  store.at = 0;
  const update = vi.fn();
  const editor = unwrap(ScheduleEditor)({ schedule: [row(roi)], onChange: vi.fn() });
  const rowEl = elements(editor).find((e) => typeof e.props.update === "function")!;
  const rowTree = unwrap(rowEl.type)({ ...rowEl.props, update });
  const roiEl = elements(rowTree).find((e) => e.props.id === "schedule-a-roi")!;
  const boxTree = unwrap(roiEl.type)(roiEl.props);
  const numEl = elements(boxTree).find((e) => e.props.id === "schedule-a-roi" && e.type !== roiEl.type)!;
  store.cells = [];
  const input = () => {
    store.at = 0;
    return unwrap(numEl.type)(numEl.props) as { props: Record<string, unknown> };
  };
  return { update, input };
}

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
