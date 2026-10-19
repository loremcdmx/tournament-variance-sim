import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const { reactHookMocks } = await import("@/lib/testing/hookHarness");
  return { ...(await importOriginal<typeof import("react")>()), ...reactHookMocks };
});

const { built, FakeUPlot } = vi.hoisted(() => {
  const built: Array<{ destroyed: boolean }> = [];
  class FakeUPlot {
    scales = { x: { min: 0, max: 100 }, y: { min: 0, max: 1 } };
    cursor = {};
    over = { clientWidth: 100, clientHeight: 100 };
    destroyed = false;
    constructor(opts: { hooks?: { setScale?: Array<(u: FakeUPlot, key: string) => void> } }) {
      built.push(this);
      for (const hook of opts.hooks?.setScale ?? []) hook(this, "x");
    }
    setData() {}
    setSize() {}
    destroy() {
      this.destroyed = true;
    }
  }
  return { built, FakeUPlot };
});
vi.mock("uplot", () => ({ default: FakeUPlot }));
vi.mock("uplot/dist/uPlot.min.css", () => ({}));

import { hookHarness } from "@/lib/testing/hookHarness";
import { UplotChart } from "./UplotChart";

const host = {
  clientWidth: 600,
  addEventListener() {},
  removeEventListener() {},
};

beforeEach(() => {
  hookHarness.reset();
  built.length = 0;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
});

function render(props: Parameters<typeof UplotChart>[0]) {
  return hookHarness.render(
    () => UplotChart(props) as unknown as { props: { ref: { current: unknown } } },
    (el) => {
      el.props.ref.current = host;
    },
  );
}

const data = [[0, 1], [0, 1]] as Parameters<typeof UplotChart>[0]["data"];

describe("UplotChart callbacks", () => {
  it("sends the scale call made while a new plot is built to the callback of the same render", () => {
    const first = vi.fn();
    const second = vi.fn();
    render({ data, options: { series: [{}, {}] }, onScaleChange: first });
    expect(first).toHaveBeenCalledTimes(1);

    render({ data, options: { series: [{}, {}] }, onScaleChange: second });

    expect(built).toHaveLength(2);
    expect(built[0].destroyed).toBe(true);
    expect(second).toHaveBeenCalledExactlyOnceWith("x", 0, 100);
    expect(first).toHaveBeenCalledTimes(1);
  });
});
