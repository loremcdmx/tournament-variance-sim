import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const { reactHookMocks } = await import("@/lib/testing/hookHarness");
  return { ...(await importOriginal<typeof import("react")>()), ...reactHookMocks };
});
const t = (key: string) => key;
vi.mock("@/lib/i18n/LocaleProvider", () => ({
  useT: () => t,
  useLocale: () => ({ locale: "en", t }),
}));
vi.mock("@/components/charts/UplotChart", () => ({ UplotChart: () => null }));

import { hookHarness } from "@/lib/testing/hookHarness";
import { UplotChart } from "@/components/charts/UplotChart";
import type { CashResult } from "@/lib/sim/cashTypes";
import { CashConvergenceChart, CashOddsChart, HistogramChart } from "./CashResultsCharts";

type El = { type: unknown; props: Record<string, unknown> };
function plotOptions(node: unknown): unknown {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = plotOptions(child);
      if (hit) return hit;
    }
    return undefined;
  }
  if (node && typeof node === "object" && "props" in node) {
    const el = node as El;
    if (el.type === UplotChart) return el.props.options;
    return plotOptions(el.props.children);
  }
  return undefined;
}

const result = {
  oddsOverDistance: { x: [0, 1], profitShare: [0, 1], belowThresholdNowShare: [0, 1] },
  convergence: { x: [1, 2], seLo: [0, 0], mean: [1, 1], seHi: [2, 2] },
} as unknown as CashResult;
const hist = { binEdges: [0, 1, 2], counts: [3, 4] };

beforeEach(() => hookHarness.reset());

describe("cash charts keep their uPlot options between parent renders", () => {
  it.each([
    ["histogram", () => HistogramChart({ hist, xLabel: "x", yLabel: "y", tone: "club" })],
    ["odds", () => CashOddsChart({ result })],
    ["convergence", () => CashConvergenceChart({ result })],
  ])("%s chart", (_name, render) => {
    const first = plotOptions(hookHarness.render(render));
    const second = plotOptions(hookHarness.render(render));
    expect(first).toBeDefined();
    expect(second).toBe(first);
  });

  it("rebuilds the histogram when an axis label changes", () => {
    const first = plotOptions(
      hookHarness.render(() => HistogramChart({ hist, xLabel: "x", yLabel: "y", tone: "club" })),
    );
    const second = plotOptions(
      hookHarness.render(() => HistogramChart({ hist, xLabel: "hands", yLabel: "y", tone: "club" })),
    );
    expect(second).not.toBe(first);
  });
});
