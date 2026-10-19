import { beforeEach, describe, expect, it, vi } from "vitest";

// NumInput keeps its draft in useState; with no DOM available, a one-cell
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

import { NumInput } from "./ControlsPanel";

type Handlers = {
  value: string;
  "aria-invalid"?: boolean;
  onChange: (e: { target: { value: string } }) => void;
  onBlur: () => void;
  onKeyDown: (e: { key: string }) => void;
};

function mount(props: { value: number; min?: number; max?: number; commitMode?: "change" | "blur" }) {
  const onChange = vi.fn();
  const render = () =>
    (NumInput({ ...props, onChange }) as unknown as { props: Handlers }).props;
  return { onChange, render };
}

beforeEach(() => {
  cell.value = undefined;
  cell.set = false;
});

describe("ControlsPanel NumInput commit", () => {
  it.each([
    ["blur", (h: Handlers) => h.onBlur()],
    ["Enter", (h: Handlers) => h.onKeyDown({ key: "Enter" })],
  ])("reverts a cleared field on %s instead of committing the minimum", (_name, leave) => {
    const { onChange, render } = mount({ value: 800, min: 1, commitMode: "blur" });
    render().onChange({ target: { value: "" } });
    const cleared = render();
    expect(cleared.value).toBe("");
    expect(cleared["aria-invalid"]).toBe(true);
    leave(cleared);
    expect(onChange).not.toHaveBeenCalled();
    const after = render();
    expect(after.value).toBe("800");
    expect(after["aria-invalid"]).toBeUndefined();
  });

  it("treats a lone minus (reported as an empty value) the same way", () => {
    const { onChange, render } = mount({ value: 800, min: 1, commitMode: "blur" });
    render().onChange({ target: { value: "" } });
    render().onBlur();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("still clamps a real below-minimum number on blur", () => {
    const { onChange, render } = mount({ value: 800, min: 1, commitMode: "blur" });
    render().onChange({ target: { value: "0" } });
    render().onBlur();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("commits a valid number on blur and not while typing in blur mode", () => {
    const { onChange, render } = mount({ value: 800, min: 1, commitMode: "blur" });
    render().onChange({ target: { value: "50" } });
    expect(onChange).not.toHaveBeenCalled();
    render().onBlur();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(50);
  });

  it("applies in-range numbers while typing in change mode, never an empty one", () => {
    const { onChange, render } = mount({ value: 800, min: 100, max: 1000 });
    render().onChange({ target: { value: "" } });
    render().onChange({ target: { value: "5" } });
    expect(onChange).not.toHaveBeenCalled();
    render().onChange({ target: { value: "500" } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(500);
  });

  it("Escape drops the draft", () => {
    const { onChange, render } = mount({ value: 800, min: 1, commitMode: "blur" });
    render().onChange({ target: { value: "12" } });
    render().onKeyDown({ key: "Escape" });
    render().onBlur();
    expect(onChange).not.toHaveBeenCalled();
    expect(render().value).toBe("800");
  });
});
