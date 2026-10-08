import { describe, expect, it } from "vitest";
import type { ComparisonFormat, DistributionSummary } from "./formatComparison";
import { FULL_DISTANCE_SHARE, interpolate, isNearFullDistance, oceanRatios } from "./oceanReportView";

const summary = (p95: number): DistributionSummary => ({ mean: p95 / 2, median: p95 / 2, p90: p95, p95, p99: p95, max: p95 });
const row = (format: ComparisonFormat, drawdown: number, evShortfall: number) =>
  ({ format, maxDrawdownBI: summary(drawdown), maxEvShortfallBI: summary(evShortfall) });

describe("longest spell below EV saturates at the distance", () => {
  it("treats P95 from 97% of the distance as the whole distance", () => {
    expect(FULL_DISTANCE_SHARE).toBe(0.97);
    expect(isNearFullDistance(1000, 1000)).toBe(true);
    expect(isNearFullDistance(970, 1000)).toBe(true);
    expect(isNearFullDistance(969, 1000)).toBe(false);
    expect(isNearFullDistance(19_400, 20_000)).toBe(true);
    expect(isNearFullDistance(4_849, 5_000)).toBe(false);
    expect(isNearFullDistance(0, 0)).toBe(false);
  });
});

describe("Ocean against the other formats", () => {
  const rows = [
    row("freezeout", 357.4, 410.8), row("pko", 163.8, 216.5), row("mystery", 270.4, 317.5), row("ocean-ko", 196.2, 256.3),
  ];

  it("divides Ocean's P95 by each comparable format's, in a fixed order, without rounding", () => {
    const ratios = oceanRatios([...rows].reverse());
    expect(ratios.map(item => item.format)).toEqual(["freezeout", "pko", "mystery"]);
    expect(ratios[1].drawdown).toBe(196.2 / 163.8);
    expect(ratios[1].evShortfall).toBe(256.3 / 216.5);
    expect(ratios[0].drawdown).toBeCloseTo(0.549, 3);
    // One digit is what the report shows: the second one is Monte Carlo noise.
    expect(ratios.map(item => item.drawdown!.toFixed(1))).toEqual(["0.5", "1.2", "0.7"]);
    expect(ratios.map(item => item.evShortfall!.toFixed(1))).toEqual(["0.6", "1.2", "0.8"]);
  });

  it("leaves a ratio empty when the other format has no drawdown, and skips formats that did not run", () => {
    const ratios = oceanRatios([row("freezeout", 0, 10), rows[3]]);
    expect(ratios).toHaveLength(1);
    expect(ratios[0]).toEqual({ format: "freezeout", drawdown: null, evShortfall: 256.3 / 10 });
    expect(oceanRatios(rows.slice(0, 3))).toEqual([]);
  });

  it("fills placeholders by name", () => {
    expect(interpolate("{a} из {b}, {missing}", { a: "1", b: "2" })).toBe("1 из 2, {missing}");
  });
});
