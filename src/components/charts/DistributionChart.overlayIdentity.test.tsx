import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const { reactHookMocks } = await import("@/lib/testing/hookHarness");
  return { ...(await importOriginal<typeof import("react")>()), ...reactHookMocks };
});
vi.mock("@/lib/i18n/LocaleProvider", () => ({
  useT: () => (key: string) => key,
  useLocale: () => ({ locale: "en", t: (key: string) => key }),
}));
vi.mock("./UplotChart", () => ({ UplotChart: () => null }));

import { hookHarness } from "@/lib/testing/hookHarness";
import { DistributionChart } from "./DistributionChart";
import { UplotChart } from "./UplotChart";

type Props = Parameters<typeof DistributionChart>[0];
const renderChart = (DistributionChart as unknown as { type: (p: Props) => unknown }).type;

type El = { type: unknown; props: Record<string, unknown> };
function chartProps(node: unknown): { data: unknown; options: unknown } | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = chartProps(child);
      if (hit) return hit;
    }
    return null;
  }
  if (node && typeof node === "object" && "props" in node) {
    const el = node as El;
    if (el.type === UplotChart) return el.props as { data: unknown; options: unknown };
    return chartProps(el.props.children);
  }
  return null;
}

const binEdges = [0, 10, 20, 30];
const counts = [5, 10, 5];
const overlayEdges = [-10, 0, 10, 20, 30, 40];
const overlayCounts = [1, 4, 8, 4, 1];

const draw = (over: Props["overlay"]) =>
  chartProps(hookHarness.render(() => renderChart({ binEdges, counts, overlay: over })))!;

beforeEach(() => hookHarness.reset());

describe("DistributionChart with an overlay object built on every parent render", () => {
  it("keeps the plot's data and options when the overlay is a new object with the same content", () => {
    const first = draw({ binEdges: overlayEdges, counts: overlayCounts, label: "PrimeDope" });
    const second = draw({ binEdges: overlayEdges, counts: overlayCounts, label: "PrimeDope" });
    expect(second.options).toBe(first.options);
    expect(second.data).toBe(first.data);
  });

  it("still rebuilds when the overlay's content or label really changes", () => {
    const first = draw({ binEdges: overlayEdges, counts: overlayCounts, label: "PrimeDope" });
    const relabelled = draw({ binEdges: overlayEdges, counts: overlayCounts, label: "Freezeouts" });
    expect(relabelled.options).not.toBe(first.options);
    const moved = draw({ binEdges: overlayEdges, counts: [...overlayCounts], label: "Freezeouts" });
    expect(moved.data).not.toBe(relabelled.data);
  });

  it("drops the overlay series when the overlay goes away", () => {
    const withOverlay = draw({ binEdges: overlayEdges, counts: overlayCounts });
    const without = draw(null);
    expect(without.options).not.toBe(withOverlay.options);
    expect((without.data as unknown[]).length).toBe(2);
    expect((withOverlay.data as unknown[]).length).toBe(3);
  });
});

function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("|");
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node as El).props.children);
  }
  return "";
}

describe("DistributionChart legend", () => {
  const legend = (primaryLabel?: string) =>
    textOf(
      hookHarness.render(() =>
        renderChart({
          binEdges,
          counts,
          overlay: { binEdges: overlayEdges, counts: overlayCounts, label: "Power-law" },
          primaryLabel,
        }),
      ),
    );

  it("calls the bars our model by default", () => {
    expect(legend()).toContain("hist.legend.ours");
  });

  it("lets the PrimeDope preset name its own bars", () => {
    const text = legend("PrimeDope");
    expect(text).toContain("PrimeDope");
    expect(text).not.toContain("hist.legend.ours");
    expect(text).toContain("Power-law");
  });
});
