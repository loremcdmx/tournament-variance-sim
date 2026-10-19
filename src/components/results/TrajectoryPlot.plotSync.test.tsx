import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const { reactHookMocks } = await import("@/lib/testing/hookHarness");
  return { ...(await importOriginal<typeof import("react")>()), ...reactHookMocks };
});
vi.mock("@/lib/i18n/LocaleProvider", () => ({
  useT: () => (key: string) => key,
  useLocale: () => ({ locale: "en", t: (key: string) => key }),
}));
vi.mock("@/components/charts/UplotChart", () => ({ UplotChart: () => null }));

import { hookHarness } from "@/lib/testing/hookHarness";
import { UplotChart } from "@/components/charts/UplotChart";
import type { SimulationResult } from "@/lib/sim/types";
import { buildTrajectoryAssets, TrajectoryPlot } from "./TrajectoryPlot";

const array = (...values: number[]) => Float64Array.from(values);

const result = {
  expectedProfit: 3,
  totalBuyIn: 300,
  samplePaths: {
    x: [0, 1, 2],
    paths: [array(0, 1, 2)],
    sampleIndices: [0],
    best: array(0, 125, 250),
    worst: array(0, -125, -250),
  },
  envelopes: {
    x: [0, 1, 2],
    mean: array(0, 1, 2),
    p0015: array(0, -50, -100),
    p025: array(0, -20, -40),
    p05: array(0, -12, -24),
    p15: array(0, -5, -10),
    p85: array(0, 5, 10),
    p95: array(0, 12, 24),
    p975: array(0, 20, 40),
    p9985: array(0, 50, 100),
    min: array(0, -150, -300),
    max: array(0, 150, 300),
  },
} as unknown as SimulationResult;

const assets = buildTrajectoryAssets(result, "felt", { min: -400, max: 400 });

// Models the one uPlot behaviour that matters for the y range: inside a batch
// every setSeries({show}) re-ranges its scale to the built range (the pending
// scale becomes {null,null}), so only a setScale issued AFTER the series
// toggles survives the batch commit.
function fakePlot() {
  const built = { min: -400, max: 400 };
  let pending: { min: number | null; max: number | null } | null = null;
  const plot = {
    scales: { y: { ...built } },
    series: new Array(assets.data.length).fill({}),
    data: assets.data,
    over: { contains: () => true, appendChild() {}, clientWidth: 100, clientHeight: 100 },
    batch: (fn: () => void) => {
      fn();
      if (pending) {
        plot.scales.y = { min: pending.min ?? built.min, max: pending.max ?? built.max };
        pending = null;
      }
    },
    setSeries: vi.fn(() => {
      pending = { min: null, max: null };
    }),
    setScale: vi.fn((key: string, opts: { min: number; max: number }) => {
      if (key === "y") pending = { min: opts.min, max: opts.max };
    }),
    setData: vi.fn(),
    redraw: vi.fn(),
  };
  return plot;
}

type Element = { type: unknown; props: Record<string, unknown> };
function findPlotChart(node: unknown): Element | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findPlotChart(child);
      if (hit) return hit;
    }
    return null;
  }
  if (node && typeof node === "object" && "props" in node) {
    if ((node as Element).type === UplotChart) return node as Element;
    return findPlotChart((node as Element).props.children);
  }
  return null;
}

const fmtA = (v: number) => `A${v}`;
const fmtB = (v: number) => `B${v}`;

function mount() {
  const plot = fakePlot();
  const render = (over: Partial<Parameters<typeof TrajectoryPlot>[0]> = {}) =>
    hookHarness.render(() =>
      TrajectoryPlot({
        assets,
        height: 400,
        yRange: { min: -10, max: 10 },
        visibleRuns: 1,
        compactMoney: fmtA,
        ...over,
      }),
    );
  const ready = (tree: unknown) => {
    const chart = findPlotChart(tree);
    (chart!.props.onPlotReady as (p: unknown) => void)(plot);
  };
  return { plot, render, ready };
}

beforeEach(() => {
  hookHarness.reset();
  (globalThis as Record<string, unknown>).requestAnimationFrame = () => 0;
  (globalThis as Record<string, unknown>).cancelAnimationFrame = () => {};
  (globalThis as Record<string, unknown>).document = {
    createElement: () => ({ style: {}, getContext: () => null }),
  };
});

describe("TrajectoryPlot keeps a live plot in step with its props", () => {
  it("pushes the y range of the runs shown onto the plot instead of rebuilding it", () => {
    const { plot, render, ready } = mount();
    ready(render());
    render();
    expect(plot.setScale).toHaveBeenLastCalledWith("y", { min: -10, max: 10 });
    expect(plot.scales.y).toEqual({ min: -10, max: 10 });

    render({ yRange: { min: -50, max: 80 }, visibleRuns: 40 });
    expect(plot.setScale).toHaveBeenLastCalledWith("y", { min: -50, max: 80 });
    expect(plot.scales.y).toEqual({ min: -50, max: 80 });
  });

  it("recomputes the tick labels when the unit formatter changes", () => {
    const { plot, render, ready } = mount();
    ready(render());
    render();
    plot.redraw.mockClear();

    render({ compactMoney: fmtA });
    expect(plot.redraw).not.toHaveBeenCalledWith(false, true);

    render({ compactMoney: fmtB });
    expect(plot.redraw).toHaveBeenCalledWith(false, true);

    plot.redraw.mockClear();
    render({ compactMoney: fmtB });
    expect(plot.redraw).not.toHaveBeenCalledWith(false, true);
  });
});
