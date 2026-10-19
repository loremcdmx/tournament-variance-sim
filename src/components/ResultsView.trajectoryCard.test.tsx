import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const { reactHookMocks } = await import("@/lib/testing/hookHarness");
  return { ...(await importOriginal<typeof import("react")>()), ...reactHookMocks };
});
vi.mock("@/lib/i18n/LocaleProvider", () => ({
  useT: () => (key: string) => key,
  useLocale: () => ({ locale: "en", t: (key: string) => key }),
}));
vi.mock("@/lib/ui/AdvancedModeProvider", () => ({
  useAdvancedMode: () => ({ advanced: false }),
}));
vi.mock("@/lib/ui/useLocalStorageState", () => ({
  useLocalStorageState: (_key: string, _load: unknown, _save: unknown, fallback: unknown) => [
    fallback,
    () => {},
  ],
}));
vi.mock("./results/UnitContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./results/UnitContext")>()),
  useMoneyFmt: () => ({
    money: (v: number) => `$${v}`,
    compactMoney: (v: number) => `$${v}`,
    unit: "money",
    setUnit: () => {},
  }),
}));

import { hookHarness } from "@/lib/testing/hookHarness";
import { DEFAULT_LINE_STYLE_PRESET, LINE_STYLE_PRESETS } from "@/lib/lineStyles";
import { DEFAULT_REF_LINES } from "@/lib/results/refLines";
import type { SimulationResult } from "@/lib/sim/types";
import { TrajectoryCard } from "./ResultsView";
import { TrajectoryPlot } from "./results/TrajectoryPlot";

const array = (...values: number[]) => Float64Array.from(values);

function fixture(): SimulationResult {
  return {
    expectedProfit: 3,
    totalBuyIn: 300,
    stats: { itmRate: 0.15 },
    samplePaths: {
      x: [0, 1, 2],
      // The second run climbs far above every envelope line.
      paths: [array(0, 1, 2), array(0, 1000, 2), array(0, -900, 2)],
      sampleIndices: [0, 1, 2],
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
}

type Props = ComponentProps<typeof TrajectoryCard>;
const renderCard = (TrajectoryCard as unknown as { type: (props: Props) => unknown }).type;

type El = { type: unknown; props: Record<string, unknown> };
function findAll(node: unknown, type: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, type, out);
  } else if (node && typeof node === "object" && "props" in node) {
    if ((node as El).type === type) out.push(node as El);
    findAll((node as El).props.children, type, out);
  }
  return out;
}

const result = fixture();
const noOverrides = {};
const baseProps = (over: Partial<Props>): Props => ({
  result,
  displayResult: result,
  bankroll: 0,
  overlayPd: false,
  setOverlayPd: () => {},
  pdChart: null,
  displayPdChart: null,
  pdPkoFallback: false,
  compareMode: undefined,
  schedule: undefined,
  scheduleRepeats: undefined,
  modelLabel: "model",
  linePreset: LINE_STYLE_PRESETS[DEFAULT_LINE_STYLE_PRESET],
  lineOverrides: noOverrides,
  visibleRuns: 1,
  runMode: "random",
  trimTopPct: 0,
  trimBotPct: 0,
  refLines: DEFAULT_REF_LINES,
  pdPresetFlip: false,
  honestLabel: "honest",
  usePdPayouts: true,
  usePdFinishModel: true,
  usePdRakeMath: true,
  ...over,
});

function plotProps(props: Props) {
  const out = hookHarness.render(() => renderCard(props));
  const [plot] = findAll(out, TrajectoryPlot);
  return plot.props as {
    assets: unknown;
    yRange: { min: number; max: number };
    visibleRuns: number;
  };
}

beforeEach(() => hookHarness.reset());

describe("trajectory card and the runs-shown slider", () => {
  it("keeps the built chart when the slider moves, and hands the plot the range of the runs shown", () => {
    const few = plotProps(baseProps({ visibleRuns: 1 }));
    const many = plotProps(baseProps({ visibleRuns: 3 }));

    expect(many.assets).toBe(few.assets);
    expect(many.visibleRuns).toBe(3);
    expect(many.yRange.max).toBeGreaterThan(1000);
    expect(few.yRange.max).toBeLessThan(500);
    expect(many.yRange.min).toBeLessThan(few.yRange.min);
  });

  it("builds on every drawn run, so the first paint never clips a run the slider can reveal", () => {
    const built = plotProps(baseProps({ visibleRuns: 1 })).assets as {
      opts: { scales: { y: { range: [number, number] } } };
    };
    expect(built.opts.scales.y.range[1]).toBeGreaterThan(1000);
    expect(built.opts.scales.y.range[0]).toBeLessThan(-900);
  });

  it("still rebuilds for a new result", () => {
    const first = plotProps(baseProps({ visibleRuns: 1 }));
    const other = fixture();
    const again = plotProps(baseProps({ visibleRuns: 1, displayResult: other, result: other }));
    expect(again.assets).not.toBe(first.assets);
  });
});

describe("trajectory card names the overlaid pass by what it is", () => {
  const second = fixture();
  const overlaidLabel = (over: Partial<Props>) => {
    const out = hookHarness.render(() =>
      renderCard(
        baseProps({
          overlayPd: true,
          compareMode: "primedope",
          pdChart: second,
          displayPdChart: second,
          ...over,
        }),
      ),
    );
    const [primary] = findAll(out, TrajectoryPlot);
    return (primary.props.assets as { overlayLabel: string | null }).overlayLabel;
  };

  it("says PrimeDope when the comparison pass is the PrimeDope one", () => {
    expect(overlaidLabel({})).toBe("PrimeDope");
  });

  it("says the stripped-bounty label for a PKO schedule", () => {
    expect(overlaidLabel({ pdPkoFallback: true })).toBe("chart.overlay.freezeouts");
  });

  it("does not call our own model PrimeDope under the Like PrimeDope preset", () => {
    expect(overlaidLabel({ pdPresetFlip: true, honestLabel: "Power-law finish model" })).toBe(
      "Power-law finish model",
    );
  });
});
