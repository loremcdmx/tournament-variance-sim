import { beforeEach, describe, expect, it, vi } from "vitest";

// MixRow keeps its draft in useState; with no DOM, a one-cell stand-in lets the
// test render it, fire the handlers React would call, and render it again.
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

import { MixRow } from "./ConvergenceChart";

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

function mount(share: number) {
  const onChange = vi.fn();
  const box = () => {
    const tree = MixRow({
      label: "PKO",
      idx: 1,
      mix: [0.5 - share / 2, share, 0.5 - share / 2],
      accent: "fuchsia",
      onChange,
    });
    return elements(tree).find((e) => e.type === "input" && e.props.type === "number")!.props;
  };
  return { onChange, box };
}

beforeEach(() => {
  cell.value = undefined;
  cell.set = false;
});

describe("convergence mix share box", () => {
  it.each([
    ["blur", (box: Record<string, unknown>) => (box.onBlur as Fn)({ target: { value: "" } })],
    ["Enter", (box: Record<string, unknown>) => (box.onKeyDown as Fn)({ key: "Enter", target: { value: "", blur() {} } })],
  ])("keeps the share when the box is cleared and left with %s", (_name, leave) => {
    const { onChange, box } = mount(0.4);
    (box().onFocus as Fn)({ currentTarget: { value: "40" } });
    (box().onChange as Fn)({ target: { value: "" } });
    expect(box().value).toBe("");
    leave(box());
    expect(onChange).not.toHaveBeenCalled();
    expect(box().value).toBe("40");
  });

  it("commits a typed share as a fraction, held to 0..100", () => {
    const { onChange, box } = mount(0.4);
    (box().onBlur as Fn)({ target: { value: "25" } });
    expect(onChange).toHaveBeenLastCalledWith(1, 0.25);
    (box().onBlur as Fn)({ target: { value: "250" } });
    expect(onChange).toHaveBeenLastCalledWith(1, 1);
    (box().onBlur as Fn)({ target: { value: "0" } });
    expect(onChange).toHaveBeenLastCalledWith(1, 0);
  });
});
