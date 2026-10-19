import { beforeEach, describe, expect, it, vi } from "vitest";

// EvBreakdownRow keeps its popup state in hooks. With no DOM, a call-order hook
// store lets the test render it as a function, fire the handlers React would
// call, and render again. Cell 2 is `canHover`, which the row reads from
// matchMedia in an effect that does not run here.
type Cell = { value: unknown };
const store: { cells: Cell[]; at: number } = { cells: [], at: 0 };
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
    useEffect: () => {},
  };
});
vi.mock("@/lib/i18n/LocaleProvider", () => ({
  useT: () => (key: string) => key,
  useLocale: () => ({ locale: "en" }),
}));

import { EvBreakdownRow } from "./PreviewParts";

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

const breakdown = {
  tier: { color: "#fff" },
  hasBounty: true,
  bountyColor: "#0ff",
  posRangeLabel: "1",
} as never;

function ghostWidth(props: { eqShare: number | null; eqEvShare?: number | null; maxEvShare?: number }) {
  store.cells = [];
  store.at = 0;
  const tree = EvBreakdownRow({
    label: "Not ITM", color: "#1f2937", evShare: 0.01, fieldShare: 0.85, netDollars: -5,
    ...props,
  });
  const ghost = elements(tree).find(
    (e) => e.type === "div" && String(e.props.className).includes("opacity-30"),
  );
  return (ghost?.props.style as { width: string } | undefined)?.width;
}

function mount(canHover: boolean, withBreakdown = true) {
  store.cells = [];
  store.at = 0;
  store.cells[2] = { value: canHover };
  const row = () => {
    store.at = 0;
    const tree = EvBreakdownRow({
      label: "Winner", color: "#fff", evShare: 0.2, fieldShare: 0.001, eqShare: 0.001,
      netDollars: 5, maxEvShare: 0.3, breakdown: withBreakdown ? breakdown : undefined,
    });
    return elements(tree).find((e) => e.type === "div" && "onKeyDown" in e.props)!.props;
  };
  const key = (k: string) => (row().onKeyDown as Fn)({ key: k, preventDefault: () => {} });
  return { row, key };
}

beforeEach(() => {
  store.cells = [];
  store.at = 0;
});

describe("EV breakdown row popup", () => {
  it.each([true, false])("opens from the keyboard with Enter and Space, and closes with Escape, when canHover is %s", (canHover) => {
    const { row, key } = mount(canHover);
    expect(row().tabIndex).toBe(0);
    expect(row()["aria-expanded"]).toBe(false);
    key("Enter");
    expect(row()["aria-expanded"]).toBe(true);
    key("Enter");
    expect(row()["aria-expanded"]).toBe(false);
    key(" ");
    expect(row()["aria-expanded"]).toBe(true);
    key("Escape");
    expect(row()["aria-expanded"]).toBe(false);
  });

  it("closes when focus leaves the row, on a device with a mouse too", () => {
    const { row, key } = mount(true);
    key("Enter");
    const container = { contains: () => false };
    (row().onBlur as Fn)({ currentTarget: container, relatedTarget: null });
    expect(row()["aria-expanded"]).toBe(false);
  });

  it("still opens on hover where there is a mouse, and on a click where there is not", () => {
    const mouse = mount(true);
    (mouse.row().onMouseEnter as Fn)();
    expect(mouse.row()["aria-expanded"]).toBe(true);
    (mouse.row().onMouseLeave as Fn)();
    expect(mouse.row()["aria-expanded"]).toBe(false);

    const touch = mount(false);
    (touch.row().onMouseEnter as Fn)();
    expect(touch.row()["aria-expanded"]).toBe(false);
    (touch.row().onClick as Fn)();
    expect(touch.row()["aria-expanded"]).toBe(true);
  });

  it("is not a button when there is nothing to show", () => {
    const { row } = mount(true, false);
    expect(row().role).toBeUndefined();
    expect(row().tabIndex).toBeUndefined();
  });
});

// The faint bar is the zero-skill baseline for the solid %-of-EV bar next to it,
// so it is drawn from the tier's zero-skill share of EV. The "eq %" column keeps
// the tier's share of seats.
describe("EV breakdown row zero-skill bar", () => {
  it("follows the zero-skill share of EV, not the share of seats", () => {
    expect(ghostWidth({ eqShare: 0.85, eqEvShare: 0, maxEvShare: 0.3 })).toBe("0.0000%");
    expect(ghostWidth({ eqShare: 0.001, eqEvShare: 0.15, maxEvShare: 0.3 })).toBe("50.0000%");
  });

  it("draws no baseline for a row that has none", () => {
    expect(ghostWidth({ eqShare: null, eqEvShare: null, maxEvShare: 0.3 })).toBe("0.0000%");
  });
});
