import { beforeEach, describe, expect, it, vi } from "vitest";

// The box keeps its draft in useState; with no DOM available, a one-cell
// stand-in lets the test drive its own handlers: render, fire one, render again.
const cell: { value: unknown; set: boolean } = { value: undefined, set: false };
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => [
      cell.set ? cell.value : initial,
      (next: unknown) => {
        cell.value = typeof next === "function" ? (next as (p: unknown) => unknown)(cell.value) : next;
        cell.set = true;
      },
    ],
  };
});

import { DraftNumberInput } from "./DraftNumberInput";

type Handlers = {
  value: string;
  min?: number;
  max?: number;
  disabled?: boolean;
  "aria-label": string;
  "aria-invalid"?: boolean;
  onChange: (e: { target: { value: string } }) => void;
  onBlur: () => void;
  onKeyDown: (e: { key: string }) => void;
};

function mount(props: Partial<Parameters<typeof DraftNumberInput>[0]> = {}) {
  const onCommit = vi.fn();
  const render = () =>
    DraftNumberInput({
      value: 200.4, min: 50, max: 50_000, step: 1, onCommit, ariaLabel: "AFS", ...props,
    }) as unknown as { props: Handlers };
  const type = (text: string) => render().props.onChange({ target: { value: text } });
  return { onCommit, props: () => render().props, type };
}

beforeEach(() => {
  cell.value = undefined;
  cell.set = false;
});

describe("DraftNumberInput", () => {
  it("shows the committed value, formatted, until the user types", () => {
    const { props } = mount({ format: (v) => String(Math.round(v)) });
    expect(props()).toMatchObject({ value: "200", min: 50, max: 50_000, "aria-label": "AFS" });
    expect(props()["aria-invalid"]).toBeUndefined();
  });

  it("types 1000 into a 50..50000 box and commits 1000, not 50000", () => {
    const { onCommit, props, type } = mount();
    for (const text of ["1", "10", "100", "1000"]) {
      type(text);
      expect(props().value).toBe(text);
    }
    expect(onCommit).not.toHaveBeenCalled();
    props().onBlur();
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(1000);
    expect(props().value).toBe("200.4");
  });

  it("types 99 into a confidence box capped at 99.99", () => {
    const { onCommit, props, type } = mount({ value: 95, min: 50, max: 99.99 });
    type("9");
    expect(props()["aria-invalid"]).toBe(true);
    type("99");
    expect(props()["aria-invalid"]).toBeUndefined();
    props().onKeyDown({ key: "Enter" });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(99);
  });

  it("types a negative ROI", () => {
    const { onCommit, props, type } = mount({ value: 10, min: -50, max: 100 });
    type("");
    type("-5");
    props().onBlur();
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(-5);
  });

  it("clamps an out-of-range number on blur", () => {
    const { onCommit, props, type } = mount();
    type("999999");
    props().onBlur();
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(50_000);
  });

  it("reverts a cleared box instead of committing the minimum", () => {
    const { onCommit, props, type } = mount();
    type("");
    props().onBlur();
    expect(onCommit).not.toHaveBeenCalled();
    expect(props().value).toBe("200.4");
  });

  it("Escape drops the draft", () => {
    const { onCommit, props, type } = mount();
    type("77");
    props().onKeyDown({ key: "Escape" });
    props().onBlur();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does nothing on blur when nothing was typed", () => {
    const { onCommit, props } = mount();
    props().onBlur();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("can be disabled", () => {
    expect(mount({ disabled: true }).props().disabled).toBe(true);
  });
});
