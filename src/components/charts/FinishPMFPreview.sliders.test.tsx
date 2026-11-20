import React, { type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The sliders keep a draft in hooks. With no DOM, a call-order hook store lets
// the test run their own handlers: render, fire one, render again.
type Cell = { value: unknown; cleanup?: void | (() => void) };
const store: {
  cells: Cell[];
  deps: (unknown[] | undefined)[];
  at: number;
  effects: (() => void)[];
  dirty: boolean;
} = { cells: [], deps: [], at: 0, effects: [], dirty: false };

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
      store.cells[i] ??= { value: undefined };
      const cell = store.cells[i];
      // Like React: the previous run's cleanup goes first.
      if (changed) {
        store.effects.push(() => {
          if (typeof cell.cleanup === "function") cell.cleanup();
          cell.cleanup = fn();
        });
      }
    },
    useMemo: (factory: () => unknown, deps: unknown[]) => {
      const i = store.at++;
      const prev = store.deps[i];
      const changed = !prev || deps.some((d, k) => !Object.is(d, prev[k]));
      store.deps[i] = deps;
      if (changed || !store.cells[i]) store.cells[i] = { value: factory() };
      return store.cells[i].value;
    },
  };
});

// FinishPMFPreview itself reads the language and the mode through hooks.
vi.mock("@/lib/i18n/LocaleProvider", async () => {
  const { DICT } = await import("@/lib/i18n/dict");
  return {
    useT: () => (key: keyof typeof DICT) => DICT[key].en,
    useLocale: () => ({ locale: "en" }),
  };
});
vi.mock("@/lib/ui/AdvancedModeProvider", () => ({
  useAdvancedMode: () => ({ advanced: true }),
}));

const rowSolves = vi.hoisted(() => ({ count: 0 }));
// performance.now() reads this clock, and a row solve costs msPerSolve on it,
// so how heavy a row looks to the slider does not depend on the machine.
const clock = vi.hoisted(() => ({ now: 0, msPerSolve: 0 }));
vi.mock("@/lib/sim/previewRowStats", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sim/previewRowStats")>();
  return {
    ...actual,
    computeRowStats: (...args: Parameters<typeof actual.computeRowStats>) => {
      rowSolves.count++;
      clock.now += clock.msPerSolve;
      return actual.computeRowStats(...args);
    },
  };
});

import { battleRoyaleRowFromTotalTicket } from "@/lib/sim/battleRoyaleTicket";
import { compileSchedule } from "@/lib/sim/engine";
import { DEFAULT_BATTLE_ROYALE_BOUNTY_FRACTION } from "@/lib/sim/gameType";
import { applyItmTarget } from "@/lib/sim/itmTarget";
import { computeRowStats } from "@/lib/sim/previewRowStats";
import type { FinishModelConfig, TournamentRow } from "@/lib/sim/types";
import { evPct, evPctInputValue } from "./finishPreview/PreviewParts";
import {
  BountyShareSlider,
  FinishPMFPreview,
  TopHeavyPlacementSlider,
  realisedBountyShare,
  type RealisedBountyShare,
} from "./FinishPMFPreview";

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
  placeholder: string | undefined;
  /** The number box and the range input are both disabled. */
  disabled: boolean;
  /** The sentence under the slider (role="status"), or null. */
  note: unknown;
  /** The pointer reaches the slider. */
  pointerEnter: () => void;
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
    placeholder?: string;
    disabled?: boolean;
    onChange: (e: { target: { value: string } }) => void;
    onBlur: () => void;
    onKeyDown: (e: { key: string; preventDefault: () => void }) => void;
  };
  const range = find(root, (n) => n.type === "input" && n.props?.type === "range")[0].props as {
    "aria-valuetext": string;
    disabled?: boolean;
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
  const status = find(root, (n) => n.type === "p" && n.props?.role === "status")[0];
  return {
    busy: root.props["aria-busy"] === true,
    text: input.value,
    placeholder: input.placeholder,
    disabled: input.disabled === true && range.disabled === true,
    note: status ? (status.props?.children ?? null) : undefined,
    pointerEnter: () =>
      (find(root, (n) => n.props?.className === "pmf-slider")[0].props!.onPointerEnter as () => void)(),
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

function mountWith<P extends object, R>(
  component: (p: P) => ReactElement<Record<string, unknown>>,
  initial: P,
  read: (el: ReactElement<Record<string, unknown>>) => R,
) {
  store.cells = [];
  store.deps = [];
  store.at = 0;
  store.effects = [];
  store.dirty = false;
  let props = initial;
  // Like React: an effect, or a state update during the render, schedules another render.
  const render = () => {
    let el: ReactElement<Record<string, unknown>>;
    for (let pass = 0; ; pass++) {
      store.at = 0;
      store.dirty = false;
      el = component(props);
      for (const fx of store.effects.splice(0)) fx();
      if (!store.dirty || pass >= 4) break;
    }
    return read(el);
  };
  return { render, setProps: (p: Partial<P>) => (props = { ...props, ...p }) };
}

function mountSlider<P extends object>(
  component: (p: P) => ReactElement<Record<string, unknown>>,
  initial: P,
) {
  return mountWith(component, initial, view);
}

type BountySliderProps = Parameters<typeof BountyShareSlider>[0];
const PreviewCard = (FinishPMFPreview as unknown as {
  type: (p: { row: TournamentRow; model: FinishModelConfig; onRowChange: () => void }) => ReactElement<Record<string, unknown>>;
}).type;

/** The whole row preview; reads the props it hands its KO slider. */
function mountPreview(row: TournamentRow, model: FinishModelConfig = { id: "power-law" }) {
  return mountWith(
    PreviewCard,
    { row, model, onRowChange: () => {} },
    (el) => find(el, (n) => n.type === BountyShareSlider)[0]?.props as BountySliderProps | undefined,
  );
}

// Only timeouts are faked (a slider's table fills on them), and none outlives its test.
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(performance, "now").mockImplementation(() => clock.now);
  clock.msPerSolve = 0;
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// A stand-in for realisedBountyShare whose every bias is already solved.
const solvedEverywhere = (share: (bias: number) => number): RealisedBountyShare => ({
  at: share,
  solved: share,
  atPoolCeiling: () => false,
  solveMs: () => 0,
});
// A stand-in that solves every ask and keeps nothing, so the slider never fills a table.
const solvingEveryAsk = (at: (bias: number) => number): RealisedBountyShare => ({
  at,
  solved: () => undefined,
  atPoolCeiling: () => false,
  solveMs: () => Infinity,
});

const BOUNTY = {
  committedBias: 0,
  committedShare: 0.5,
  defaultShare: 0.5,
  minShare: 0.2,
  maxShare: 0.8,
  realised: solvedEverywhere((bias: number) => 0.5 - 0.3 * (bias / 0.25)),
  poolCapsTop: false,
  title: "share",
  cashLabel: "cash",
  bountyLabel: "bounty",
  tip: "tip",
  resetLabel: "reset",
  poolCapNote: "pool caps at {x}",
  rangeNote: "plays {lo} to {hi}",
  gapNote: "plays {y}, not {x}",
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
      realised: solvedEverywhere(shareAtBias),
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
    const dragged = [0, 0.0125, 0.025, 0.0125, 0, 0.025].map((bias) => shareAt.at(bias));
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
      realised: solvingEveryAsk((bias: number) => {
        solves++;
        return shareAtBias(bias);
      }),
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
    expect(BOUNTY.realised.at(first)).toBeCloseTo(0.4, 12);
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

const powerLaw = { id: "power-law" as const };
const GRID = Array.from({ length: 41 }, (_, k) => Number((-0.25 + k * 0.0125).toFixed(4)));

/** The KO EV the engine compiles for a row (the mean of its finish pmf), its share of the
 *  winnings, and what the bounty pool can pay the entry: N x buy-in x bounty x (1 - P(last)). */
function engineKo(row: TournamentRow, model: FinishModelConfig = powerLaw): { share: number; ko: number; ceiling: number } {
  const entry = compileSchedule({
    schedule: [row], scheduleRepeats: 1, samples: 1, bankroll: 1, seed: 1, finishModel: model,
  }).flat[0];
  const n = entry.aliasProb.length;
  const pmf = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    pmf[i] += entry.aliasProb[i] / n;
    pmf[entry.aliasIdx[i]] += (1 - entry.aliasProb[i]) / n;
  }
  let cash = 0;
  let ko = 0;
  for (let i = 0; i < n; i++) {
    cash += pmf[i] * entry.prizeByPlace[i];
    ko += pmf[i] * (entry.bountyByPlace?.[i] ?? 0);
  }
  return { share: ko / (cash + ko), ko, ceiling: n * row.buyIn * (row.bountyFraction ?? 0) * (1 - pmf[n - 1]) };
}
const engineKoShare = (row: TournamentRow) => engineKo(row).share;

// Three players, 65/35, $100 + 10 %, 30 % bounty, ITM 66 %, ROI +20 %. The pool
// pays one entry at most 3 x $30 x (1 - P(last)) = $59.40 of the $132 won, 45 %.
const PKO3: TournamentRow = {
  id: "pko3", label: "pko3", players: 3, buyIn: 100, rake: 0.1, roi: 0.2,
  gameType: "pko", payoutStructure: "sng-65-35", bountyFraction: 0.3, itmRate: 0.66, count: 1,
};
const PKO500 = applyItmTarget([{
  id: "pko500", label: "pko500", players: 500, buyIn: 10, rake: 0.1, roi: 0.1,
  gameType: "pko", payoutStructure: "mtt-gg-bounty", bountyFraction: 0.5, count: 1,
} satisfies TournamentRow], { enabled: false, pct: 20 }, powerLaw)[0];
const PKO45: TournamentRow = { ...PKO500, id: "pko45", label: "pko45", players: 45, roi: 0.3 };
// Late registration takes the 18-max to 21 entrants, where the engine plays the
// row's own KO share whatever the bias.
const BR_LATE_REG: TournamentRow = {
  id: "br", label: "br", ...battleRoyaleRowFromTotalTicket(10), players: 18, lateRegMultiplier: 1.2,
  payoutStructure: "battle-royale", bountyFraction: DEFAULT_BATTLE_ROYALE_BOUNTY_FRACTION,
  mysteryBountyVariance: 1.8, gameType: "mystery-royale", roi: 0.03, itmRate: 0.18, count: 1,
};

function typeAndCommit(props: BountySliderProps, text: string) {
  const onCommit = vi.fn();
  const m = mountSlider(BountyShareSlider, { ...props, onCommit });
  m.render();
  for (let i = 1; i <= text.length; i++) m.render().typeText(text.slice(0, i));
  const typing = m.render();
  typing.blur();
  return { m, onCommit, typing, landed: m.render() };
}

describe("the KO box compares shares at the precision it prints", () => {
  const typeOnly = (props: BountySliderProps, text: string) => {
    const onCommit = vi.fn();
    const m = mountSlider(BountyShareSlider, { ...props, onCommit });
    m.render();
    for (let i = 1; i <= text.length; i++) m.render().typeText(text.slice(0, i));
    const typing = m.render();
    typing.blur();
    return { onCommit, typing, landed: m.render() };
  };

  it("a figure typed at the end the box shows is in range, though the solved end sits an ulp inside it", () => {
    const ends = { minShare: 0.22500000000000153, maxShare: 0.6249999999999993, defaultShare: 0.425, committedShare: 0.425 };
    const share = (b: number) => (b <= -0.25 ? ends.maxShare : b >= 0.25 ? ends.minShare : 0.425 - 0.8 * b);
    for (const typed of ["62.5", "22.5"]) {
      const { onCommit, typing, landed } = typeOnly({ ...BOUNTY, ...ends, realised: solvedEverywhere(share) } as BountySliderProps, typed);
      expect(typing.note, typed).toBeNull();
      expect(landed.note, typed).toBeNull();
      expect(onCommit, typed).toHaveBeenCalledTimes(1);
    }
  });

  it("a share the row plays a hair under 1 % is the 1.0 % typed, not a share it jumps over", () => {
    const under = 0.0099999999999999;
    const share = (b: number) => (b < 0 ? 0.02 : b === 0 ? under : under - 0.008 * b);
    const props = { ...BOUNTY, minShare: under - 0.002, maxShare: 0.02, defaultShare: under, committedShare: 0.015, committedBias: -0.1, realised: solvedEverywhere(share) } as BountySliderProps;
    const { onCommit, landed } = typeOnly(props, "1.0");
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(landed.note).toBeNull();
  });
});

describe("the KO slider reads the row the engine plays", () => {
  it("Battle Royale at 21 entrants after late registration plays one KO share at every bias, so the slider is locked", () => {
    const engine = [-0.25, 0, 0.25].map((bias) => engineKoShare({ ...BR_LATE_REG, bountyEvBias: bias }));
    expect(engine[0]).toBeCloseTo(engine[2], 12);
    const props = mountPreview(BR_LATE_REG).render()!;
    expect(props.maxShare).toBeCloseTo(engine[0], 9);
    expect(props.defaultShare).toBeCloseTo(engine[1], 9);
    expect(props.minShare).toBeCloseTo(engine[2], 9);
    expect(mountSlider(BountyShareSlider, props).render().disabled).toBe(true);
    // a row that dropped the late registration would read the 18-max, which moves 30 % to 65 %
    expect(mountPreview({ ...BR_LATE_REG, lateRegMultiplier: undefined }).render()!.maxShare).toBeGreaterThan(0.6);
  });

  it("PKO with late registration: the probes and every grid share are the engine's", () => {
    const row = { ...PKO45, lateRegMultiplier: 1.5 };
    const props = mountPreview(row).render()!;
    const flat = mountPreview(PKO45).render()!;
    expect(Math.abs(props.minShare - flat.minShare)).toBeGreaterThan(0.005);
    expect(props.minShare).toBeCloseTo(engineKoShare({ ...row, bountyEvBias: 0.25 }), 9);
    expect(props.maxShare).toBeCloseTo(engineKoShare({ ...row, bountyEvBias: -0.25 }), 9);
    for (const bias of [-0.1, 0.0125, 0.2]) {
      expect(props.realised.at(bias)).toBeCloseTo(engineKoShare({ ...row, bountyEvBias: bias }), 9);
    }
  });
});

describe("a typed KO share on a row whose bounty pool caps the KO EV", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  it("the pool really caps it: the share is flat at 45 % from the KO end to -3/14", () => {
    // The plan is $39.60 + $92.40 x |bias| of KO EV, which meets the $59.40 at -3/14.
    const props = mountPreview(PKO3).render()!;
    expect(props.poolCapsTop).toBe(true);
    expect(props.maxShare).toBeCloseTo(0.45, 12);
    expect(props.realised.at(-0.2125)).toBeLessThan(0.45 - 1e-3);
    for (const bias of [-0.25, -0.2375, -0.225, -3 / 14 - 1e-6]) {
      expect(props.realised.at(bias)).toBeCloseTo(0.45, 12);
    }
    expect(mountPreview(PKO500).render()!.poolCapsTop).toBe(false);
  });

  it("every share the row plays, typed from 31.8 % to 45.0 % in 0.1 steps, lands as typed in the preview and the engine", () => {
    const props = mountPreview(PKO3).render()!;
    for (let tenths = 318; tenths <= 450; tenths++) {
      const text = (tenths / 10).toFixed(1);
      const { onCommit, landed } = typeAndCommit(props, text);
      const typed = tenths / 1000;
      const bias = onCommit.mock.calls[0]?.[0] as number | undefined;
      if (bias === undefined) {
        // 31.8 % rounds the stored 31.75 % at bias 0: a retype of the shown figure
        expect(text).toBe("31.8");
        continue;
      }
      expect(props.realised.at(bias)).toBeCloseTo(typed, 8);
      expect(engineKoShare({ ...PKO3, bountyEvBias: bias })).toBeCloseTo(typed, 8);
      expect(landed.valueText).toBe(`${text}%`);
    }
    // 40 % and 43 % land at -1/7 and -13/70, not on the probes' line (40.9 %, 44.9 %)
    expect(typeAndCommit(props, "40").onCommit.mock.calls[0][0]).toBeCloseTo(-1 / 7, 8);
    expect(typeAndCommit(props, "43").onCommit.mock.calls[0][0]).toBeCloseTo(-13 / 70, 8);
  });

  it("a share above what the pool pays commits the cap and says so, until the next edit", () => {
    const props = mountPreview(PKO3).render()!;
    expect(typeAndCommit(props, "44.9").landed.note).toBeNull();
    const { m, onCommit, typing, landed } = typeAndCommit(props, "50");
    const capNote = "The bounty pool caps KOs at 45.0% of the winnings on this row.";
    expect(typing.note).toBe(capNote);
    const { ko, ceiling } = engineKo({ ...PKO3, bountyEvBias: -0.25 });
    expect(ko / ceiling).toBeGreaterThan(1 - 1e-9);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(-0.25);
    expect(engineKoShare({ ...PKO3, bountyEvBias: -0.25 })).toBeCloseTo(0.45, 12);
    expect(landed.note).toBe(capNote);
    m.setProps({ committedBias: -0.25, committedShare: props.realised.at(-0.25) });
    const v = m.render();
    expect(v.text).toBe("45.0");
    expect(v.note).toBe(capNote);
    v.typeText("40");
    expect(m.render().note).toBeNull();
  });

  it("past an end the pool does not set, the note gives the row's range instead", () => {
    const capped = mountPreview(PKO3).render()!;
    const below = typeAndCommit(capped, "30");
    // a figure typed below the range may be on its way to a valid one, so it is named only once committed
    expect(below.typing.note).toBeNull();
    expect(below.landed.note).toBe("On this row KOs make 31.8% to 45.0% of the winnings.");
    const uncapped = mountPreview(PKO500).render()!;
    expect(uncapped.maxShare).toBeCloseTo(0.625, 12);
    const { onCommit, landed } = typeAndCommit(uncapped, "70");
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(-0.25);
    expect(landed.note).toBe("On this row KOs make 37.5% to 62.5% of the winnings.");
  });

  it("names the pool on a row whose pool search stops a few 1e-9 under the ceiling", () => {
    // Free ITM, 50/30/20, +6 %: the search's bracket closes 1.7e-9 under what the pool can pay.
    const row: TournamentRow = { ...PKO3, roi: 0.06, payoutStructure: "sng-50-30-20", itmRate: undefined };
    const end = engineKo({ ...row, bountyEvBias: -0.25 });
    expect(1 - end.ko / end.ceiling).toBeGreaterThan(1e-9);
    const props = mountPreview(row).render()!;
    expect(props.poolCapsTop).toBe(true);
    const { onCommit, landed } = typeAndCommit(props, "46.9");
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(-0.25);
    expect(landed.note).toBe("The bounty pool caps KOs at 44.9% of the winnings on this row.");
  });
});

describe("a drag on the KO slider", () => {
  // Frames are painted by hand, so a frame is never a timer.
  let frames: (() => void)[] = [];
  const paint = () => frames.splice(0).forEach((frame) => frame());
  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (frame: () => void) => frames.push(frame));
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  const slideTo = (m: { render: () => View }, bias: number) => {
    // The range input carries -bias.
    m.render().slide(-bias);
    paint();
    return m.render();
  };
  // Runs the queued timeouts one macrotask at a time; a fill that never ends stops at 100.
  const macrotasks = () => {
    let n = 0;
    for (; vi.getTimerCount() > 0 && n < 100; n++) vi.advanceTimersToNextTimer();
    return n;
  };

  it("on a light row fills the table in one macrotask once shown, so a touch drag reads the engine at once", () => {
    const props = mountPreview(PKO45).render()!;
    const m = mountSlider(BountyShareSlider, { ...props, onCommit: vi.fn() });
    m.render();
    rowSolves.count = 0;
    // 41 grid biases, three of them the probes; no pointer has come near yet
    expect(macrotasks()).toBe(1);
    expect(rowSolves.count).toBe(38);
    // a touch: the pointer arrives with the first input event
    m.render().pointerEnter();
    const v = slideTo(m, 0.1);
    const share = props.realised.solved(0.1)!;
    expect(Math.abs(share - engineKoShare({ ...PKO45, bountyEvBias: 0.1 }))).toBeLessThan(1e-12);
    expect(v.valueText).toBe(evPct(share));
    expect(v.text).toBe(evPctInputValue(share));
    expect(rowSolves.count).toBe(38);
  });

  it("on a heavy row solves nothing while the thumb moves, then solves the release at once, so the readout is exact from the release on", () => {
    clock.msPerSolve = 100;
    const props = mountPreview(PKO45).render()!;
    expect(props.realised.solveMs()).toBe(100);
    const onCommit = vi.fn();
    const m = mountSlider(BountyShareSlider, { ...props, onCommit });
    m.render();
    rowSolves.count = 0;
    // a touch drag: the pointer arrives with the first input event, before any macrotask
    m.render().pointerEnter();
    const v = slideTo(m, 0.0125);
    expect(rowSolves.count).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(v.valueText.startsWith("≈ ")).toBe(true);
    expect(v.text).toBe("");
    expect(v.placeholder?.startsWith("≈")).toBe(true);
    v.tabThroughSlider();
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(0.0125);
    expect(rowSolves.count).toBe(1);
    // before the row lands and before any fill: the engine's share at that bias
    const released = m.render();
    const share = props.realised.solved(0.0125)!;
    expect(Math.abs(share - engineKoShare({ ...PKO45, bountyEvBias: 0.0125 }))).toBeLessThan(1e-12);
    expect(released.valueText).toBe(evPct(share));
    expect(released.text).toBe(evPctInputValue(share));
    expect(released.placeholder).toBeUndefined();
  });

  it("on a heavy row waits for the pointer, then fills one solve per macrotask nearest the thumb, and waits while the thumb moves", () => {
    clock.msPerSolve = 100;
    const props = mountPreview(PKO45).render()!;
    const m = mountSlider(BountyShareSlider, { ...props, onCommit: vi.fn() });
    m.render();
    expect(vi.getTimerCount()).toBe(0);
    m.render().pointerEnter();
    m.render();
    rowSolves.count = 0;
    vi.advanceTimersToNextTimer();
    expect(rowSolves.count).toBe(1);
    expect(props.realised.solved(-0.0125)).toBeDefined();
    // a drag holds the fill
    slideTo(m, 0.1);
    expect(vi.getTimerCount()).toBe(0);
    m.render().tabThroughSlider();
    expect(rowSolves.count).toBe(2);
    m.render();
    // 41 grid biases: three probes, one filled, one released, 36 to go, one per macrotask
    expect(macrotasks()).toBe(36);
    expect(rowSolves.count).toBe(38);
    for (const bias of GRID) expect(props.realised.solved(bias)).toBeDefined();
  });

  it("does not fill while a figure is typed in the box", () => {
    clock.msPerSolve = 100;
    const props = mountPreview(PKO45).render()!;
    const m = mountSlider(BountyShareSlider, { ...props, onCommit: vi.fn() });
    m.render().pointerEnter();
    m.render().typeText("45");
    m.render();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("once the table is full, every grid bias reads the engine's share without a solve", () => {
    const props = mountPreview(PKO45).render()!;
    const m = mountSlider(BountyShareSlider, { ...props, onCommit: vi.fn() });
    m.render();
    macrotasks();
    rowSolves.count = 0;
    for (const bias of GRID) {
      // At 0.125 the engine's 43.75 % sits 3e-16 off the table's, either side of a rounding edge.
      const share = props.realised.solved(bias)!;
      expect(Math.abs(share - engineKoShare({ ...PKO45, bountyEvBias: bias }))).toBeLessThan(1e-12);
      expect(slideTo(m, bias).valueText).toBe(evPct(bias === 0 ? props.committedShare : share));
    }
    expect(rowSolves.count).toBe(0);
  });

  it("keeps its table through a committed bias and drops it when anything else on the row changes", () => {
    const preview = mountPreview(PKO45);
    const first = preview.render()!.realised;
    preview.setProps({ row: { ...PKO45, bountyEvBias: -0.1 } });
    expect(preview.render()!.realised).toBe(first);
    preview.setProps({ row: { ...PKO45, bountyEvBias: -0.1, roi: 0.31 } });
    expect(preview.render()!.realised).not.toBe(first);
  });
});

// Four players at $100 + 10 % with a 10 % bounty and a pinned ITM. Near the KO end
// the first-place floor lifts the cash side past what it is asked, so the KO EV
// the row plays is not the KO EV the pool search asks for.
const FOUR_65: TournamentRow = {
  id: "four65", label: "four65", players: 4, buyIn: 100, rake: 0.1, roi: 0.2,
  gameType: "pko", payoutStructure: "sng-65-35", bountyFraction: 0.1, itmRate: 0.6, count: 1,
};
const FOUR_GG: TournamentRow = {
  ...FOUR_65, id: "fourgg", label: "fourgg", roi: 0.1, payoutStructure: "mtt-gg-bounty", itmRate: 0.66,
};

describe("the KO end of a small pinned row whose cash side overshoots", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  it.each([
    ["4-max 65/35", FOUR_65, 0.2424],
    ["4-max GG", FOUR_GG, 0.2744],
  ])("%s: the share never falls toward the KO end, and that end is all the pool can pay", (_, row, top) => {
    const props = mountPreview(row).render()!;
    const shares = GRID.map((bias) => props.realised.at(bias));
    for (let k = 0; k + 1 < GRID.length; k++) expect(shares[k]).toBeGreaterThanOrEqual(shares[k + 1] - 1e-12);
    const end = engineKo({ ...row, bountyEvBias: -0.25 });
    expect(end.ko / end.ceiling).toBeGreaterThan(1 - 1e-9);
    expect(props.maxShare).toBeCloseTo(end.share, 12);
    expect(props.maxShare).toBeCloseTo(top, 4);
    expect(props.poolCapsTop).toBe(true);
  });

  it("names the pool only where the KO EV is all the pool can pay", () => {
    for (const row of [PKO3, FOUR_65, FOUR_GG, PKO500]) {
      const { realised } = mountPreview(row).render()!;
      for (const bias of [-0.25, -0.2, 0]) {
        const { ko, ceiling } = engineKo({ ...row, bountyEvBias: bias });
        expect(realised.atPoolCeiling(bias)).toBe(ko >= ceiling * (1 - 1e-6));
      }
    }
    // the cash side, not the pool, stops 4-max 65/35 at -0.2: 91.9 % of what the pool could pay
    const short = engineKo({ ...FOUR_65, bountyEvBias: -0.2 });
    expect(short.ko / short.ceiling).toBeCloseTo(0.9188, 4);
  });

  it("4-max 65/35: 24 % lands as typed, and 25 % commits the KO end and says the pool stops it at 24.2 %", () => {
    const props = mountPreview(FOUR_65).render()!;
    const typed = typeAndCommit(props, "24");
    expect(engineKoShare({ ...FOUR_65, bountyEvBias: typed.onCommit.mock.calls[0][0] as number })).toBeCloseTo(0.24, 8);
    expect(typed.landed.note).toBeNull();
    const over = typeAndCommit(props, "25");
    expect(over.onCommit).toHaveBeenCalledExactlyOnceWith(-0.25);
    expect(over.landed.note).toBe("The bounty pool caps KOs at 24.2% of the winnings on this row.");
  });

  it("4-max GG: every share from 7.5 % to 27.4 %, typed in 0.1 steps, lands as typed in the engine", () => {
    const props = mountPreview(FOUR_GG).render()!;
    for (let tenths = 75; tenths <= 274; tenths++) {
      const text = (tenths / 10).toFixed(1);
      const bias = typeAndCommit(props, text).onCommit.mock.calls[0]?.[0] as number | undefined;
      // the box shows the stored share at bias 0; retyping it keeps the row
      if (bias === undefined) {
        expect(text).toBe(evPctInputValue(props.committedShare));
        continue;
      }
      expect(engineKoShare({ ...FOUR_GG, bountyEvBias: bias })).toBeCloseTo(tenths / 1000, 8);
    }
  });
});

describe("a cleared KO box", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  it.each(["", "-"])("%j puts the readout and the thumb back on the stored share, with no solve", (text) => {
    let solves = 0;
    const share = BOUNTY.realised.at;
    const m = mountSlider(BountyShareSlider, {
      ...BOUNTY,
      realised: solvingEveryAsk((bias: number) => (solves++, share(bias))),
      onCommit: vi.fn(),
    });
    m.render();
    m.render().typeText("40");
    // the thumb rides the line to bias 1/12, which the range input holds on its step
    expect(m.render().rangeValue).toBeCloseTo(-0.0875, 12);
    m.render().typeText(text);
    const v = m.render();
    expect(v.valueText).toBe("50.0%");
    expect(v.rangeValue).toBe(0);
    expect(v.busy).toBe(false);
    expect(solves).toBe(0);
  });
});

describe("a typed KO share the row jumps over", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  it("lands on the nearer side of the jump and names the share it plays", () => {
    // The engine's KO share has been continuous in the bias on every row scanned since
    // the fixed-ITM first-place floor stopped switching, so a stand-in carries the jump:
    // 17.49 % just left of bias -0.074, 16.88 % just right of it.
    const share = (b: number) => (b < -0.074 ? 0.1749 + (-0.074 - b) * 0.04 : 0.1688 - (b + 0.074) * 0.04);
    const props = {
      ...BOUNTY, minShare: share(0.25), maxShare: share(-0.25), defaultShare: share(0),
      committedShare: share(0), committedBias: 0, realised: solvedEverywhere(share),
    } as BountySliderProps;
    const played = (text: string) => {
      const { onCommit, typing, landed } = typeAndCommit(props, text);
      // no keystroke solves the row, so a figure inside the range is named only once committed
      expect(typing.note).toBeNull();
      expect(onCommit).toHaveBeenCalledTimes(1);
      return { share: share(onCommit.mock.calls[0][0] as number), landed };
    };
    const below = played("17.1");
    expect(below.share).toBeCloseTo(0.1688, 4);
    expect(below.landed.note).toBe("plays 16.9%, not 17.1%");
    const above = played("17.4");
    expect(above.share).toBeCloseTo(0.1749, 4);
    expect(above.landed.note).toBe("plays 17.5%, not 17.4%");
    // either side of the jump lands as typed, and says nothing
    for (const text of ["17.6", "16.8"]) {
      const { share: s, landed } = played(text);
      expect(s).toBeCloseTo(Number(text) / 100, 8);
      expect(landed.note).toBeNull();
    }
  });

  it("takes the side of the jump nearer the typed share, not the side the Illinois halving left nearer", () => {
    // 50 % - 1.2 x bias, 5 pp lower from -0.15 on: 66 % sits 2 pp under the jump's top (68 %)
    // and 3 pp over its foot (63 %).
    const at = (bias: number) => 0.5 - 1.2 * bias - (bias >= -0.15 ? 0.05 : 0);
    const { onCommit, landed } = typeAndCommit({
      ...BOUNTY, realised: solvedEverywhere(at), committedShare: 0.45, defaultShare: 0.45,
      minShare: 0.15, maxShare: 0.8, onCommit: vi.fn(),
    }, "66");
    expect(at(onCommit.mock.calls[0][0] as number)).toBeCloseTo(0.68, 9);
    expect(landed.note).toBe("plays 68.0%, not 66.0%");
  });
});
