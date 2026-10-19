import React, { type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The sliders keep a draft in hooks. With no DOM, a call-order hook store lets
// the test run their own handlers: render, fire one, render again.
type Cell = { value: unknown };
const store: {
  cells: Cell[];
  deps: (unknown[] | undefined)[];
  at: number;
  effects: (() => void | (() => void))[];
  dirty: boolean;
} = { cells: [], deps: [], at: 0, effects: [], dirty: false };

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
          const value = typeof next === "function" ? (next as (p: unknown) => unknown)(cell.value) : next;
          if (!Object.is(value, cell.value)) store.dirty = true;
          cell.value = value;
        },
      ];
    },
    useRef: (initial: unknown) => {
      const i = store.at++;
      store.cells[i] ??= { value: { current: initial } };
      return store.cells[i].value;
    },
    useEffect: (fn: () => void | (() => void), deps?: unknown[]) => {
      const i = store.at++;
      const prev = store.deps[i];
      const changed = !prev || !deps || deps.some((d, k) => !Object.is(d, prev[k]));
      store.deps[i] = deps;
      if (changed) store.effects.push(fn);
    },
  };
});

import { BountyShareSlider, TopHeavyPlacementSlider } from "./FinishPMFPreview";

type Node = { type?: unknown; props?: Record<string, unknown> };

function find(el: unknown, pred: (n: Node) => boolean): Node[] {
  const out: Node[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    const node = n as Node;
    if (pred(node)) out.push(node);
    walk(node.props?.children);
  };
  walk(el);
  return out;
}

type View = {
  busy: boolean;
  text: string;
  resetDisabled: boolean;
  typeText: (v: string) => void;
  blur: () => void;
  reset: () => void;
};

function view(root: ReactElement<Record<string, unknown>>): View {
  const input = find(root, (n) => n.type === "input" && n.props?.type === "number")[0].props as {
    value: string;
    onChange: (e: { target: { value: string } }) => void;
    onBlur: () => void;
  };
  const button = find(root, (n) => n.type === "button")[0].props as {
    disabled: boolean;
    onClick: () => void;
  };
  return {
    busy: root.props["aria-busy"] === true,
    text: input.value,
    resetDisabled: button.disabled,
    typeText: (v) => input.onChange({ target: { value: v } }),
    blur: () => input.onBlur(),
    reset: () => button.onClick(),
  };
}

function mountSlider<P extends object>(
  component: (p: P) => ReactElement<Record<string, unknown>>,
  initial: P,
) {
  store.cells = [];
  store.deps = [];
  store.at = 0;
  store.effects = [];
  store.dirty = false;
  let props = initial;
  // Like React: an effect that sets state schedules another render.
  const render = () => {
    let el: ReactElement<Record<string, unknown>>;
    for (let pass = 0; ; pass++) {
      store.at = 0;
      store.dirty = false;
      el = component(props);
      for (const fx of store.effects.splice(0)) fx();
      if (!store.dirty || pass >= 4) break;
    }
    return view(el);
  };
  return { render, setProps: (p: Partial<P>) => (props = { ...props, ...p }) };
}

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());

const BOUNTY = {
  committedBias: 0,
  committedShare: 0.5,
  defaultShare: 0.5,
  minShare: 0.2,
  maxShare: 0.8,
  title: "share",
  cashLabel: "cash",
  bountyLabel: "bounty",
  tip: "tip",
  resetLabel: "reset",
};

describe("bounty-share slider follows the stored bias", () => {
  it("drops its draft when the same row is reset from outside", () => {
    const onCommit = vi.fn();
    const m = mountSlider(BountyShareSlider as (p: typeof BOUNTY & { onCommit: (v: number) => void }) => ReactElement<Record<string, unknown>>, {
      ...BOUNTY,
      onCommit,
    });
    m.render();
    m.render().typeText("40");
    m.render().blur();
    expect(onCommit).toHaveBeenCalledTimes(1);
    const bias = onCommit.mock.calls[0][0] as number;
    expect(bias).toBeGreaterThan(0);
    m.setProps({ committedBias: bias, committedShare: 0.4 });
    let v = m.render();
    expect(v.text).toBe("40.0");
    expect(v.busy).toBe(false);

    // the scenario chip is clicked again: same row id, stored bias gone
    m.setProps({ committedBias: 0, committedShare: 0.5 });
    v = m.render();
    expect(v.text).toBe("50.0");
    expect(v.busy).toBe(false);
    expect(v.resetDisabled).toBe(true);

    // dragging back to the old value is not swallowed
    v.typeText("40");
    m.render().blur();
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCommit.mock.calls[1][0]).toBeCloseTo(bias, 9);
  });

  it("keeps the newer draft while an earlier submission is still landing", () => {
    const onCommit = vi.fn();
    const m = mountSlider(BountyShareSlider as (p: typeof BOUNTY & { onCommit: (v: number) => void }) => ReactElement<Record<string, unknown>>, {
      ...BOUNTY,
      onCommit,
    });
    m.render();
    m.render().typeText("40");
    m.render().blur();
    m.render().typeText("35");
    m.render().blur();
    const [first, second] = onCommit.mock.calls.map((c) => c[0] as number);
    expect(second).not.toBe(first);
    m.setProps({ committedBias: first, committedShare: 0.4 });
    let v = m.render();
    expect(v.busy).toBe(true);
    expect(v.text).toBe("35.0");
    m.setProps({ committedBias: second, committedShare: 0.35 });
    v = m.render();
    expect(v.busy).toBe(false);
    expect(v.text).toBe("35.0");
  });
});

const TOP = {
  committedBias: 0,
  title: "heavy",
  lowLabel: "flat",
  highLabel: "heavy",
  tip: "tip",
  resetLabel: "reset",
};

describe("top-heavy slider follows the stored bias", () => {
  it("drops its draft when the same row is reset from outside", () => {
    const onCommit = vi.fn();
    const m = mountSlider(TopHeavyPlacementSlider as (p: typeof TOP & { onCommit: (v: number) => void }) => ReactElement<Record<string, unknown>>, {
      ...TOP,
      onCommit,
    });
    m.render();
    m.render().typeText("80");
    m.render().blur();
    expect(onCommit).toHaveBeenCalledTimes(1);
    const bias = onCommit.mock.calls[0][0] as number;
    m.setProps({ committedBias: bias });
    expect(m.render().busy).toBe(false);

    m.setProps({ committedBias: 0 });
    const v = m.render();
    expect(v.text).toBe("50");
    expect(v.busy).toBe(false);
    expect(v.resetDisabled).toBe(true);

    v.typeText("80");
    m.render().blur();
    expect(onCommit).toHaveBeenCalledTimes(2);
  });
});
