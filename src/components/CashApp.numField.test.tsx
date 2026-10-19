import { beforeEach, describe, expect, it, vi } from "vitest";

// NumField keeps its draft in useState and its focus bookkeeping in useRef; with
// no DOM available, indexed stand-ins let the test fire its real handlers and
// render again.
const hooks: { cells: unknown[]; next: number } = { cells: [], next: 0 };
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const at = hooks.next++;
      if (!(at in hooks.cells)) {
        hooks.cells[at] =
          typeof initial === "function" ? (initial as () => unknown)() : initial;
      }
      return [
        hooks.cells[at],
        (next: unknown) => {
          hooks.cells[at] =
            typeof next === "function"
              ? (next as (p: unknown) => unknown)(hooks.cells[at])
              : next;
        },
      ];
    },
    useRef: (initial: unknown) => {
      const at = hooks.next++;
      if (!(at in hooks.cells)) hooks.cells[at] = { current: initial };
      return hooks.cells[at];
    },
  };
});

import { NumField } from "./CashApp";

type InputProps = {
  value: string;
  onFocus: (e: { currentTarget: { value: string } }) => void;
  onChange: (e: { target: { value: string } }) => void;
  onKeyDown: (e: {
    key: string;
    preventDefault: () => void;
    currentTarget: { value: string; blur: () => void };
  }) => void;
};

function findInput(node: unknown): InputProps | null {
  if (!node || typeof node !== "object") return null;
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (el.type === "input") return el.props as unknown as InputProps;
  const kids = el.props?.children;
  for (const kid of Array.isArray(kids) ? kids : [kids]) {
    const found = findInput(kid);
    if (found) return found;
  }
  return null;
}

function mount(props: {
  value: number;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  const onChange = vi.fn();
  const render = () => {
    hooks.next = 0;
    return findInput(NumField({ label: "f", ...props, onChange }))!;
  };
  const focus = () => {
    render().onFocus({ currentTarget: { value: String(props.value) } });
  };
  const press = (key: string, typed = String(props.value)) => {
    const preventDefault = vi.fn();
    render().onKeyDown({
      key,
      preventDefault,
      currentTarget: { value: typed, blur: vi.fn() },
    });
    return preventDefault;
  };
  return { onChange, render, focus, press };
}

beforeEach(() => {
  hooks.cells = [];
  hooks.next = 0;
});

describe("cash number fields step from the current value", () => {
  it.each([
    ["BB size", { value: 1, step: 0.25, min: 0.01, max: 1_000_000 }, 1.25, 0.75],
    ["SD", { value: 100, step: 5, min: 1, max: 10_000 }, 105, 95],
    ["Hands", { value: 20_000, step: 10_000, min: 1000, max: 100_000 }, 30_000, 10_000],
    ["Simulations", { value: 2000, step: 500, min: 100, max: 20_000 }, 2500, 1500],
  ])("%s: ArrowUp and ArrowDown", (_name, props, up, down) => {
    const upField = mount(props);
    const preventedUp = upField.press("ArrowUp");
    expect(preventedUp).toHaveBeenCalled();
    expect(upField.onChange).toHaveBeenCalledExactlyOnceWith(up);

    const downField = mount(props);
    downField.press("ArrowDown");
    expect(downField.onChange).toHaveBeenCalledExactlyOnceWith(down);
  });

  it("shows the stepped value in the box while editing", () => {
    const field = mount({ value: 1, step: 0.25, min: 0.01 });
    field.focus();
    field.press("ArrowUp");
    expect(field.render().value).toBe("1.25");
  });

  it("steps from what is typed in the box, not from the last committed value", () => {
    const field = mount({ value: 100, step: 5, min: 1 });
    field.focus();
    field.press("ArrowUp", "12");
    expect(field.onChange).toHaveBeenCalledExactlyOnceWith(17);
  });

  it("falls back to the committed value when the box holds no number", () => {
    const field = mount({ value: 100, step: 5, min: 1 });
    field.press("ArrowDown", "");
    expect(field.onChange).toHaveBeenCalledExactlyOnceWith(95);
  });

  it("stops at the bounds", () => {
    const top = mount({ value: 100_000, step: 10_000, min: 1000, max: 100_000 });
    top.press("ArrowUp");
    expect(top.onChange).toHaveBeenCalledExactlyOnceWith(100_000);
    const bottom = mount({ value: 0.01, step: 0.25, min: 0.01 });
    bottom.press("ArrowDown");
    expect(bottom.onChange).toHaveBeenCalledExactlyOnceWith(0.01);
  });

  it("leaves a disabled field alone", () => {
    const field = mount({ value: 8, step: 0.5, min: 0, disabled: true });
    const prevented = field.press("ArrowUp");
    expect(prevented).not.toHaveBeenCalled();
    expect(field.onChange).not.toHaveBeenCalled();
  });
});
