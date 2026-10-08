import { describe, expect, it } from "vitest";
import { commonRiskCurves, type FormatComparisonSummary } from "@/lib/calibration/formatComparison";
import { riskChartMaximum } from "./riskChartDomain";

function curve(fallsAt: number, tail = 0) {
  return Array.from({ length: 101 }, (_, i) => ({ thresholdBI: i * 10, probability: { value: i * 10 < fallsAt ? .1 : tail } }));
}

describe("risk chart display domain", () => {
  it("waits for all four format tails and includes one genuine point beyond the cutoff", () => {
    const curves = [curve(50), curve(80), curve(150), curve(300)];
    expect(riskChartMaximum(curves)).toBe(310);
    expect(riskChartMaximum(curves, true)).toBe(1000);
  });

  it("keeps the full domain when any format is still above 0.5%", () => {
    expect(riskChartMaximum([curve(50), curve(80), curve(150), curve(300, .0051)])).toBe(1000);
  });

  it("includes equality with the 0.5% cutoff and does not extend beyond the data endpoint", () => {
    expect(riskChartMaximum([curve(300, .005), curve(250)])).toBe(310);
    expect(riskChartMaximum([curve(1000, .005), curve(50)])).toBe(1000);
  });

  it("keeps a nondegenerate domain for entirely zero curves", () => {
    expect(riskChartMaximum([curve(0), curve(0)])).toBe(10);
    expect(riskChartMaximum([])).toBe(10);
  });

  it("does not infer missing probabilities for empty or unaligned curves", () => {
    expect(riskChartMaximum([curve(10), []])).toBe(1000);
    expect(riskChartMaximum([curve(10), curve(10).map(point => ({ ...point, thresholdBI: point.thresholdBI + 5 }))])).toBe(1005);
  });

  it("works on the shared dynamic grid: the full domain is the grid's top, the default one stops earlier", () => {
    const row = (format: "freezeout" | "pko", maxima: number[]) => ({
      format, careerMaxima: { drawdownBI: Float64Array.from(maxima), evShortfallBI: Float64Array.from(maxima) },
    }) satisfies Pick<FormatComparisonSummary, "format" | "careerMaxima">;
    const tail = Array.from({ length: 1000 }, (_, i) => 100 + i * 1.5);
    const common = commonRiskCurves([row("freezeout", tail), row("pko", tail.map(value => value / 4))], "drawdown");
    const curves = [common.curves.freezeout!, common.curves.pko!];
    expect(common.thresholds.at(-1)).toBe(2000);
    expect(riskChartMaximum(curves, true)).toBe(2000);
    expect(riskChartMaximum(curves)).toBeLessThanOrEqual(2000);
    expect(riskChartMaximum(curves)).toBeGreaterThan(1500);
    expect(curves.every(curve => curve.at(-1)!.probability.value === 0)).toBe(true);
  });
});
