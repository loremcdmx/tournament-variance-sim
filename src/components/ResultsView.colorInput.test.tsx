import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const { reactHookMocks } = await import("@/lib/testing/hookHarness");
  return { ...(await importOriginal<typeof import("react")>()), ...reactHookMocks };
});

import { hookHarness } from "@/lib/testing/hookHarness";
import { DebouncedColorInput } from "./ResultsView";

type Handlers = {
  props: {
    onChange: (e: { target: { value: string } }) => void;
    onBlur: () => void;
  };
};

function mount() {
  const onChange = vi.fn();
  const render = (value: string) =>
    hookHarness.render(() => DebouncedColorInput({ value, onChange })) as unknown as Handlers;
  return { onChange, render };
}

beforeEach(() => {
  hookHarness.reset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("DebouncedColorInput", () => {
  it("sends a picked colour once, after the debounce", () => {
    const { onChange, render } = mount();
    render("#aaaaaa").props.onChange({ target: { value: "#ff0000" } });
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(130);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("#ff0000");

    render("#ff0000").props.onBlur();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("does not write the old colour back after the value is reset from outside", () => {
    const { onChange, render } = mount();
    render("#aaaaaa").props.onChange({ target: { value: "#ff0000" } });
    vi.advanceTimersByTime(130);
    render("#ff0000");
    onChange.mockClear();

    render("#aaaaaa").props.onBlur();

    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not hand a row the colour of the row that was removed before it", () => {
    const { onChange, render } = mount();
    render("#ff0000");
    render("#00ff00").props.onBlur();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("applies a pick that is still pending when the field loses focus", () => {
    const { onChange, render } = mount();
    render("#aaaaaa").props.onChange({ target: { value: "#00ff00" } });
    render("#aaaaaa").props.onBlur();
    expect(onChange).toHaveBeenCalledExactlyOnceWith("#00ff00");
    vi.advanceTimersByTime(130);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
