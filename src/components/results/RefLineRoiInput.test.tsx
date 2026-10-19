import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// DraftNumberInput keeps its draft in useState; a one-cell stand-in lets the
// test drive its own handlers (render, fire one, render again).
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

import { DraftNumberInput } from "@/components/ui/DraftNumberInput";
import { roiLabel } from "@/lib/results/refLines";
import { RefLineRoiInput } from "./RefLineRoiInput";

type Handlers = {
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  onBlur: () => void;
};

function mount(roi: number) {
  const onChange = vi.fn();
  const element = RefLineRoiInput({ roi, onChange, ariaLabel: "ROI" }) as ReactElement<
    Parameters<typeof DraftNumberInput>[0]
  >;
  const render = () => DraftNumberInput(element.props) as unknown as { props: Handlers };
  return { onChange, element, input: () => render().props };
}

beforeEach(() => {
  cell.value = undefined;
  cell.set = false;
});

describe("reference-line ROI box", () => {
  it("shows the stored ROI in percent", () => {
    expect(mount(-0.2).input().value).toBe("-20");
  });

  it("lets a negative ROI be typed: a lone minus is a pending draft, not a commit of 0", () => {
    const { onChange, input } = mount(0.5);
    input().onChange({ target: { value: "" } });
    input().onBlur();
    expect(onChange).not.toHaveBeenCalled();
    input().onChange({ target: { value: "-20" } });
    expect(onChange).not.toHaveBeenCalled();
    input().onBlur();
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ roi: -0.2, label: roiLabel(-0.2) });
  });

  it("keeps the line inside the -99% .. 10000% the chart accepts", () => {
    const { onChange, input } = mount(0);
    input().onChange({ target: { value: "-500" } });
    input().onBlur();
    expect(onChange).toHaveBeenLastCalledWith({ roi: -0.99, label: roiLabel(-0.99) });
    input().onChange({ target: { value: "99999" } });
    input().onBlur();
    expect(onChange).toHaveBeenLastCalledWith({ roi: 100, label: roiLabel(100) });
  });
});
