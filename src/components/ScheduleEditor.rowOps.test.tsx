import React from "react";
import type { SetStateAction } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ScheduleEditor keeps its import box and row callbacks in hooks. With no DOM, a
// call-order hook store lets the test render it as a function and fire the real
// handlers it hands to its rows and toolbar buttons. useLayoutEffect runs
// inline so the latest onChange is in place for the next handler call.
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

// memo() keeps the inner component on `.type`; calling it renders one level with the mocked hooks.
const renderEditor = (ScheduleEditor as unknown as {
  type: (props: React.ComponentProps<typeof ScheduleEditor>) => unknown;
}).type;

type El = { type: unknown; props: Record<string, unknown> };
type Fn = (...args: unknown[]) => unknown;

function elements(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, out);
  } else if (node && typeof node === "object" && "props" in node) {
    out.push(node as El);
    elements((node as El).props.children, out);
  }
  return out;
}

function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node as El).props.children);
  }
  return "";
}

const row = (id: string, over: Partial<TournamentRow> = {}): TournamentRow => ({
  id,
  label: id,
  players: 1000,
  buyIn: 20,
  rake: 0.1,
  roi: 0.1,
  payoutStructure: "mtt-standard",
  count: 1,
  ...over,
});

// The editor is handed `schedule` once and never sees a later one: a commit
// still waiting in a transition has not reached it, which is exactly when a row
// operation computed from `schedule` would overwrite that commit. React applies
// whatever was queued, in order, on top of the real state.
function mountStale(schedule: TournamentRow[]) {
  store.cells = [];
  store.at = 0;
  const queue: SetStateAction<TournamentRow[]>[] = [];
  const onChange = (action: SetStateAction<TournamentRow[]>) => {
    queue.push(action);
  };
  const render = () => {
    store.at = 0;
    return elements(renderEditor({ schedule, onChange }));
  };
  const button = (label: string) => {
    const found = render().find((el) => el.type === "button" && textOf(el).includes(label));
    if (!found) throw new Error(`no "${label}" button`);
    return found.props.onClick as Fn;
  };
  const rowHandlers = () => {
    const el = render().find((e) => typeof e.props.update === "function");
    if (!el) throw new Error("no row rendered");
    return el.props as { update: Fn; remove: Fn; duplicate: Fn };
  };
  const importRows = (csv: string, mode: "append" | "replace") => {
    button("row.import")();
    const box = render().find((el) => el.type === "textarea");
    (box!.props.onChange as Fn)({ target: { value: csv } });
    button(mode === "append" ? "row.importAppend" : "row.importReplace")();
  };
  const settle = () =>
    queue.reduce<TournamentRow[]>(
      (state, action) => (typeof action === "function" ? action(state) : action),
      schedule,
    );
  return { queue, rowHandlers, button, importRows, settle };
}

beforeEach(() => {
  vi.stubGlobal("React", React);
});
afterEach(() => vi.unstubAllGlobals());

const base = [row("a"), row("b")];
const IMPORT_CSV = "Imported, 500, 10+1, 20, 1, mtt-standard";

const operations: [string, (m: ReturnType<typeof mountStale>) => void, string[]][] = [
  ["Add row", (m) => m.button("row.addRow")(), ["a", "b", "*"]],
  ["Duplicate", (m) => m.rowHandlers().duplicate("b"), ["a", "b", "*"]],
  ["Remove", (m) => m.rowHandlers().remove("b"), ["a"]],
  ["append import", (m) => m.importRows(IMPORT_CSV, "append"), ["a", "b", "*"]],
];

describe("ScheduleEditor row operations on a schedule that is still waiting for an earlier edit", () => {
  it.each(operations)("%s keeps the edit queued before it", (_name, operate, ids) => {
    const m = mountStale(base);
    m.rowHandlers().update("a", { players: 7000 });
    operate(m);
    const settled = m.settle();
    expect(settled.map((r) => (ids.includes(r.id) ? r.id : "*"))).toEqual(ids);
    expect(settled.find((r) => r.id === "a")?.players).toBe(7000);
  });

  it("keeps both of two edits to one row that were queued before the first rendered", () => {
    const m = mountStale(base);
    m.rowHandlers().update("a", { players: 7000 });
    m.rowHandlers().update("a", { roi: 0.5 });
    const a = m.settle().find((r) => r.id === "a");
    expect(a?.players).toBe(7000);
    expect(a?.roi).toBe(0.5);
  });

  it("hands every operation to React as an updater, never as an array built from the rendered rows", () => {
    for (const [name, operate] of operations) {
      const m = mountStale(base);
      operate(m);
      expect(m.queue.length, name).toBeGreaterThan(0);
      for (const action of m.queue) expect(typeof action, name).toBe("function");
    }
    const edit = mountStale(base);
    edit.rowHandlers().update("a", { buyIn: 5 });
    expect(typeof edit.queue[0]).toBe("function");
  });

  it("lets a replace import win over an edit queued before it", () => {
    const m = mountStale(base);
    m.rowHandlers().update("a", { players: 7000 });
    m.importRows(IMPORT_CSV, "replace");
    const settled = m.settle();
    expect(settled).toHaveLength(1);
    expect(settled[0].label).toBe("Imported");
  });
});
