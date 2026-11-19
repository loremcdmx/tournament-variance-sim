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

const rowSolves = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/lib/sim/previewRowStats", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sim/previewRowStats")>();
  return {
    ...actual,
    computeRowStats: (...args: Parameters<typeof actual.computeRowStats>) => {
      rowSolves.count++;
      return actual.computeRowStats(...args);
    },
  };
});

import { applyItmTarget } from "@/lib/sim/itmTarget";
import { computeRowStats } from "@/lib/sim/previewRowStats";
import type { TournamentRow } from "@/lib/sim/types";
import { BountyShareSlider, TopHeavyPlacementSlider, realisedBountyShare } from "./FinishPMFPreview";

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
  enter: () => void;
  reset: () => void;
  /** The share or figure the slider announces, draft included. */
  valueText: string;
  /** The range input's value as the browser holds it (snapped to its step). */
  rangeValue: number;
  slide: (v: number) => void;
  /** Tab key released on the range input, then focus moving on, with the value it holds. */
  tabThroughSlider: () => void;
};

function view(root: ReactElement<Record<string, unknown>>): View {
  const input = find(root, (n) => n.type === "input" && n.props?.type === "number")[0].props as {
    value: string;
    onChange: (e: { target: { value: string } }) => void;
    onBlur: () => void;
    onKeyDown: (e: { key: string; preventDefault: () => void }) => void;
  };
  const range = find(root, (n) => n.type === "input" && n.props?.type === "range")[0].props as {
    "aria-valuetext": string;
    value: number;
    step: number;
    min: number;
    onChange: (e: { target: { value: string } }) => void;
    onKeyUp: (e: { currentTarget: { value: string } }) => void;
    onBlur: (e: { currentTarget: { value: string } }) => void;
  };
  const rangeValue =
    range.min + Math.round((range.value - range.min) / range.step) * range.step;
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
    enter: () => input.onKeyDown({ key: "Enter", preventDefault: () => {} }),
    reset: () => button.onClick(),
    valueText: range["aria-valuetext"],
    rangeValue,
    slide: (v) => range.onChange({ target: { value: String(v) } }),
    tabThroughSlider: () => {
      range.onKeyUp({ currentTarget: { value: String(rangeValue) } });
      range.onBlur({ currentTarget: { value: String(rangeValue) } });
    },
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
  shareAtBias: (bias: number) => 0.5 - 0.3 * (bias / 0.25),
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

describe("top-heavy slider on a model that ignores the bias", () => {
  it("disables the slider and the number box and says why", () => {
    store.cells = [];
    store.deps = [];
    store.at = 0;
    store.effects = [];
    const el = (TopHeavyPlacementSlider as (p: typeof TOP & {
      onCommit: (v: number) => void;
      disabledReason?: string;
    }) => ReactElement<Record<string, unknown>>)({ ...TOP, onCommit: vi.fn(), disabledReason: "ignored" });
    const inputs = find(el, (n) => n.type === "input");
    expect(inputs).toHaveLength(2);
    for (const input of inputs) expect(input.props?.disabled).toBe(true);
    expect(el.props.title).toBe("ignored");
    expect(find(el, (n) => n.type === "p" && n.props?.children === "ignored")).toHaveLength(1);
  });
});

describe("a typed figure in a slider's number box is held as typed, not on the drag grid", () => {
  // The drag grid is 1/20 of each side of the axis: 1.5 pp of bounty share on
  // either side of BOUNTY's 50 %, 2.5 points of top-heaviness.
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  const bounty = (props: Partial<typeof BOUNTY> = {}) => {
    const onCommit = vi.fn();
    const m = mountSlider(BountyShareSlider as (p: typeof BOUNTY & { onCommit: (v: number) => void }) => ReactElement<Record<string, unknown>>, {
      ...BOUNTY,
      ...props,
      onCommit,
    });
    return { m, onCommit };
  };
  // BOUNTY maps a bias b >= 0 to 50 % - 30 % x b / 0.25 and b < 0 to 50 % + 30 % x |b| / 0.25.
  const shareOf = (bias: number) => 0.5 - 0.3 * (bias / 0.25);

  it.each([
    ["42.7", 0.427],
    ["61.13", 0.611],
    ["35", 0.35],
  ])("bounty share: a typed %s commits the bias of %s", (text, share) => {
    const { m, onCommit } = bounty();
    m.render();
    m.render().typeText(text);
    m.render().blur();
    expect(onCommit).toHaveBeenCalledOnce();
    expect(shareOf(onCommit.mock.calls[0][0] as number)).toBeCloseTo(share, 12);
  });

  it("bounty share: the landed value reads back as typed", () => {
    const { m, onCommit } = bounty();
    m.render();
    m.render().typeText("42.7");
    m.render().blur();
    const bias = onCommit.mock.calls[0][0] as number;
    m.setProps({ committedBias: bias, committedShare: shareOf(bias) });
    const v = m.render();
    expect(v.busy).toBe(false);
    expect(v.text).toBe("42.7");
  });

  it("bounty share: tabbing through the slider leaves an off-grid stored bias alone; dragging still snaps", () => {
    const bias = 0.0608333;
    const { m, onCommit } = bounty({ committedBias: bias, committedShare: shareOf(bias) });
    m.render();
    m.render().tabThroughSlider();
    m.render();
    expect(onCommit).not.toHaveBeenCalled();
    // The range input carries -bias; a drag to -0.0608 lands on the 0.0125 grid.
    m.render().slide(-0.0608);
    m.render().tabThroughSlider();
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(0.0625);
  });

  const topHeavy = (committedBias = 0) => {
    const onCommit = vi.fn();
    const m = mountSlider(TopHeavyPlacementSlider as (p: typeof TOP & { onCommit: (v: number) => void }) => ReactElement<Record<string, unknown>>, {
      ...TOP,
      committedBias,
      onCommit,
    });
    return { m, onCommit };
  };

  it.each([
    ["33", -0.34],
    ["33.33", -0.334],
    ["71", 0.42],
  ])("top-heaviness: a typed %s commits bias %s", (text, bias) => {
    const { m, onCommit } = topHeavy();
    m.render();
    m.render().typeText(text);
    m.render().blur();
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit.mock.calls[0][0] as number).toBeCloseTo(bias, 12);
  });

  it("top-heaviness: the landed value reads back as typed, and tabbing through the slider keeps it", () => {
    const { m, onCommit } = topHeavy();
    m.render();
    m.render().typeText("33");
    m.render().blur();
    const bias = onCommit.mock.calls[0][0] as number;
    m.setProps({ committedBias: bias });
    const v = m.render();
    expect(v.text).toBe("33");
    v.tabThroughSlider();
    m.render();
    expect(onCommit).toHaveBeenCalledOnce();
  });
});

describe("a slider's number box commits only a typed figure", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  // The slider's straight line through the three probed shares, as on every
  // row whose cash side does not saturate.
  const onLine = (d: number, lo: number, hi: number) => (bias: number) =>
    bias >= 0 ? d + (lo - d) * (bias / 0.25) : d + (hi - d) * (-bias / 0.25);
  const bountyRow = (d: number, lo: number, hi: number, committedBias = 0) => {
    const onCommit = vi.fn();
    const shareAtBias = onLine(d, lo, hi);
    const m = mountSlider(BountyShareSlider as (p: typeof BOUNTY & { onCommit: (v: number) => void }) => ReactElement<Record<string, unknown>>, {
      ...BOUNTY,
      committedBias,
      committedShare: shareAtBias(committedBias),
      defaultShare: d,
      minShare: lo,
      maxShare: hi,
      shareAtBias,
      onCommit,
    });
    return { m, onCommit, shareAtBias };
  };

  // Battle Royale's default 21/46 and Ocean KO's 25/46 sit off the box's one
  // decimal, and so does a 500-entrant PKO row one drag step off centre.
  it.each([
    ["Battle Royale", 21 / 46, 0.30097, 0.65049, 0, "45.7"],
    ["Ocean KO", 25 / 46, 0.4, 0.68, 0, "54.3"],
    ["PKO 500 after a drag", 0.5, 0.375, 0.625, 0.0125, "49.4"],
  ])("%s: focus and blur, or Enter, without typing leave the stored bias alone", (_, d, lo, hi, bias, shown) => {
    const { m, onCommit } = bountyRow(d, lo, hi, bias);
    const v = m.render();
    expect(v.text).toBe(shown);
    v.blur();
    m.render().enter();
    expect(m.render().text).toBe(shown);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("retyping the figure the box shows keeps the stored bias; another figure commits", () => {
    const { m, onCommit, shareAtBias } = bountyRow(21 / 46, 0.30097, 0.65049);
    m.render();
    m.render().typeText("45.7");
    m.render().blur();
    const v = m.render();
    expect(onCommit).not.toHaveBeenCalled();
    expect(v.text).toBe("45.7");
    expect(v.busy).toBe(false);
    v.typeText("45.8");
    m.render().blur();
    expect(onCommit).toHaveBeenCalledOnce();
    expect(shareAtBias(onCommit.mock.calls[0][0] as number)).toBeCloseTo(0.458, 12);
  });

  it("a drag commits once; leaving the number box after it adds nothing", () => {
    const { m, onCommit, shareAtBias } = bountyRow(0.5, 0.375, 0.625);
    m.render();
    // The range input carries -bias.
    m.render().slide(-0.0125);
    m.render().tabThroughSlider();
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(0.0125);
    m.setProps({ committedBias: 0.0125, committedShare: shareAtBias(0.0125) });
    const v = m.render();
    expect(v.text).toBe("49.4");
    v.blur();
    m.render();
    expect(onCommit).toHaveBeenCalledOnce();
  });

  it("top-heaviness: a stored bias off the box's 0.1 grid survives focus, Enter and retyping", () => {
    const onCommit = vi.fn();
    // 0.0123 is 50.615 % of the way along the -1 .. 1 axis.
    const m = mountSlider(TopHeavyPlacementSlider as (p: typeof TOP & { onCommit: (v: number) => void }) => ReactElement<Record<string, unknown>>, {
      ...TOP,
      committedBias: 0.0123,
      onCommit,
    });
    const v = m.render();
    expect(v.text).toBe("50.6");
    v.blur();
    m.render().enter();
    m.render().typeText("50.6");
    m.render().blur();
    expect(m.render().text).toBe("50.6");
    expect(onCommit).not.toHaveBeenCalled();
    m.render().typeText("50.7");
    m.render().blur();
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit.mock.calls[0][0] as number).toBeCloseTo(0.014, 12);
  });
});

const MAX_SOLVES_PER_COMMIT = 8;

describe("a typed KO share lands on rows whose cash side saturates", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  // A 45-entrant PKO row at +30 % with its ITM pinned: the share stops
  // falling well before the cash end of the axis, so the straight line
  // through the probes (50 % at 0, 43.906 % at 0.25) misses by up to 3 pp.
  const model = { id: "power-law" as const };
  const row = applyItmTarget(
    [
      {
        id: "pko45",
        label: "pko45",
        players: 45,
        buyIn: 10,
        rake: 0.1,
        roi: 0.3,
        gameType: "pko",
        payoutStructure: "mtt-gg-bounty",
        bountyFraction: 0.5,
        count: 1,
      } satisfies TournamentRow,
    ],
    { enabled: false, pct: 20 },
    model,
  )[0];
  const shareAtBias = (bias: number) =>
    computeRowStats({ ...row, bountyEvBias: bias }, model, { skipCompiledSigma: true }).bountyShare;
  const probes = { defaultShare: shareAtBias(0), minShare: shareAtBias(0.25), maxShare: shareAtBias(-0.25) };

  it("the row really saturates: the probes' line misses 46 % by more than 1 pp", () => {
    expect(probes.minShare).toBeCloseTo(0.43906, 5);
    const lineBias = ((probes.defaultShare - 0.46) / (probes.defaultShare - probes.minShare)) * 0.25;
    expect(Math.abs(shareAtBias(lineBias) - 0.46)).toBeGreaterThan(0.01);
  });

  it("the preview solves the row once per bias, so a drag back over visited biases costs nothing", () => {
    const shareAt = realisedBountyShare(row, model);
    rowSolves.count = 0;
    const dragged = [0, 0.0125, 0.025, 0.0125, 0, 0.025].map(shareAt);
    expect(rowSolves.count).toBe(3);
    expect(dragged.slice(3)).toEqual([dragged[1], dragged[0], dragged[2]]);
    expect(dragged[2]).toBe(shareAtBias(0.025));
  });

  it.each(["46.0", "44.5", "49.2", "55.0", "62.0"])("a typed %s % is the share the row then realises", (text) => {
    const onCommit = vi.fn();
    let solves = 0;
    const m = mountSlider(BountyShareSlider as (p: typeof BOUNTY & { onCommit: (v: number) => void }) => ReactElement<Record<string, unknown>>, {
      ...BOUNTY,
      ...probes,
      committedShare: probes.defaultShare,
      shareAtBias: (bias: number) => {
        solves++;
        return shareAtBias(bias);
      },
      onCommit,
    });
    m.render();
    for (let i = 1; i <= text.length; i++) m.render().typeText(text.slice(0, i));
    // The live draft reads the share the commit will land, and no keystroke
    // solves the row: a solve costs tens of ms on a large or ranged field.
    expect(m.render().valueText).toBe(`${text}%`);
    expect(solves).toBe(0);
    m.render().blur();
    // False position from the line's guess; a bisection of the whole axis took 41.
    expect(solves).toBeLessThanOrEqual(MAX_SOLVES_PER_COMMIT);
    expect(onCommit).toHaveBeenCalledOnce();
    const bias = onCommit.mock.calls[0][0] as number;
    expect(shareAtBias(bias)).toBeCloseTo(Number(text) / 100, 9);
    m.setProps({ committedBias: bias, committedShare: shareAtBias(bias) });
    expect(m.render().text).toBe(text);
  });
});

describe("a figure typed while an earlier one is landing still commits", () => {
  // The first commit has not reached the row yet, so the row still shows the
  // figure typed second: it is a new value, not a retype of the shown one.
  it("bounty share: 40 then 50.0 ends the row on 50 %", () => {
    const onCommit = vi.fn();
    const m = mountSlider(BountyShareSlider as (p: typeof BOUNTY & { onCommit: (v: number) => void }) => ReactElement<Record<string, unknown>>, {
      ...BOUNTY,
      onCommit,
    });
    m.render();
    m.render().typeText("40");
    m.render().blur();
    m.render().typeText("50.0");
    m.render().blur();
    expect(onCommit).toHaveBeenCalledTimes(2);
    const [first, second] = onCommit.mock.calls.map((c) => c[0] as number);
    expect(BOUNTY.shareAtBias(first)).toBeCloseTo(0.4, 12);
    expect(second).toBe(0);
    m.setProps({ committedBias: first, committedShare: 0.4 });
    let v = m.render();
    expect(v.busy).toBe(true);
    expect(v.text).toBe("50.0");
    m.setProps({ committedBias: 0, committedShare: 0.5 });
    v = m.render();
    expect(v.busy).toBe(false);
    expect(v.text).toBe("50.0");
  });

  it("top-heaviness: 40 then 50 ends the row on 50", () => {
    const onCommit = vi.fn();
    const m = mountSlider(TopHeavyPlacementSlider as (p: typeof TOP & { onCommit: (v: number) => void }) => ReactElement<Record<string, unknown>>, {
      ...TOP,
      onCommit,
    });
    m.render();
    m.render().typeText("40");
    m.render().blur();
    m.render().typeText("50");
    m.render().blur();
    expect(onCommit).toHaveBeenCalledTimes(2);
    const [first, second] = onCommit.mock.calls.map((c) => c[0] as number);
    expect(first).toBeCloseTo(-0.2, 12);
    expect(second).toBe(0);
    m.setProps({ committedBias: first });
    let v = m.render();
    expect(v.busy).toBe(true);
    expect(v.text).toBe("50");
    m.setProps({ committedBias: 0 });
    v = m.render();
    expect(v.busy).toBe(false);
    expect(v.text).toBe("50");
  });
});
