import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// BuyInInput keeps its text, focus and last committed ticket in hooks. With no
// DOM, a call-order hook store lets the test run its own handlers: render, fire
// one, render again. startTransition is held back so the test decides when "the
// previous keystroke's transition lands" (the props catch up).
type Cell = { value: unknown };
const store: {
  cells: Cell[];
  deps: (unknown[] | undefined)[];
  at: number;
  effects: (() => void)[];
  transitions: (() => void)[];
} = { cells: [], deps: [], at: 0, effects: [], transitions: [] };

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const i = store.at++;
      store.cells[i] ??= { value: initial };
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
    useEffect: (fn: () => void, deps?: unknown[]) => {
      const i = store.at++;
      const prev = store.deps[i];
      const changed = !prev || !deps || deps.some((d, k) => !Object.is(d, prev[k]));
      store.deps[i] = deps;
      if (changed) store.effects.push(fn);
    },
    startTransition: (fn: () => void) => {
      store.transitions.push(fn);
    },
  };
});
vi.mock("@/lib/i18n/LocaleProvider", () => ({ useT: () => (key: string) => key }));

import { BuyInInput } from "./ScheduleEditor";

type Handlers = {
  value: string;
  onFocus: () => void;
  onBlur: () => void;
  onChange: (e: { target: { value: string } }) => void;
};

function mount(initial: { buyIn: number; rake: number }, gameType: "freezeout" | "mystery-royale" = "freezeout") {
  store.cells = [];
  store.deps = [];
  store.at = 0;
  store.effects = [];
  store.transitions = [];
  const commits: { buyIn: number; rake: number }[] = [];
  let props = { ...initial };
  const render = (): Handlers => {
    store.at = 0;
    const el = BuyInInput({
      id: "b",
      gameType,
      ...props,
      onChange: (buyIn: number, rake: number) => commits.push({ buyIn, rake }),
    }) as unknown as { props: { children: { props: Handlers }[] } };
    const fx = store.effects.splice(0);
    for (const f of fx) f();
    return el.props.children[0].props;
  };
  // The queued transitions run (onChange fires) and the row reaches the props.
  const land = (to: { buyIn: number; rake: number }) => {
    for (const run of store.transitions.splice(0)) run();
    props = { ...to };
  };
  return { commits, render, land, setProps: (p: { buyIn: number; rake: number }) => (props = { ...p }) };
}

beforeEach(() => {
  vi.stubGlobal("React", React);
});
afterEach(() => vi.unstubAllGlobals());

describe("BuyInInput commits against the last committed ticket, not the rendered props", () => {
  it("commits '10' typed right after '1' while the stored ticket is still 10", () => {
    const m = mount({ buyIn: 10, rake: 0.1 });
    m.render().onFocus();
    m.render().onChange({ target: { value: "1" } });
    // The transition for "1" has not landed: the props still say 10.
    m.render().onChange({ target: { value: "10" } });
    for (const run of store.transitions.splice(0)) run();
    expect(m.commits).toEqual([
      { buyIn: 1, rake: 0.1 },
      { buyIn: 10, rake: 0.1 },
    ]);
  });

  it("does not drop the typed value when the box is left before the transition lands", () => {
    const m = mount({ buyIn: 10, rake: 0.1 });
    m.render().onFocus();
    m.render().onChange({ target: { value: "1" } });
    m.render().onChange({ target: { value: "10" } });
    m.render().onBlur();
    expect(m.render().value).toBe("10+1");
    m.land({ buyIn: 10, rake: 0.1 });
    expect(m.render().value).toBe("10+1");
    expect(m.commits[m.commits.length - 1]).toEqual({ buyIn: 10, rake: 0.1 });
  });

  it("does not re-read a sub-cent fee when a space is typed or the text is pasted back", () => {
    const m = mount({ buyIn: 0.25, rake: 0.1 });
    m.render().onFocus();
    expect(m.render().value).toBe("0.25+0.03");
    m.render().onChange({ target: { value: "0.25+0.03 " } });
    m.render().onChange({ target: { value: "0.25+0.03" } });
    m.render().onBlur();
    for (const run of store.transitions.splice(0)) run();
    expect(m.commits).toEqual([]);
  });

  it("follows an outside change to the row once the box is not focused", () => {
    const m = mount({ buyIn: 10, rake: 0.1 });
    m.setProps({ buyIn: 20, rake: 0.1 });
    expect(m.render().value).toBe("20+2");
    m.render().onFocus();
    m.render().onChange({ target: { value: "20" } });
    expect(m.commits).toEqual([]);
    m.render().onChange({ target: { value: "25" } });
    for (const run of store.transitions.splice(0)) run();
    expect(m.commits).toEqual([{ buyIn: 25, rake: 0.1 }]);
  });
});
