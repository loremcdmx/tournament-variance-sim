import { describe, expect, it } from "vitest";
import { compileSchedule } from "../sim/compile";
import { makeCheckpointGrid } from "../sim/grids";
import { simulateShard } from "../sim/hotLoop";
import { compiledEntryMoments } from "../sim/scheduleMoments";
import {
  buildFormatComparisonMoments, buildFormatComparisonScenarios, commonRiskCurves, estimateProbability,
  FORMAT_COMPARISON_DEFAULTS, FORMAT_COMPARISON_FORMATS, niceCeilingAbove, oceanWheelCutoffs, RISK_CURVE_POINTS,
  riskThresholdGrid, summarizeDistribution, summarizeFormatComparisonScenario, thresholdRiskCurve,
  type ComparisonFormat, type FormatComparisonSummary,
} from "./formatComparison";

describe("format comparison's common cost and native mechanics", () => {
  it("compares four MTTs on the same total cost, field, ROI, distance and samples", () => {
    const config = { ...FORMAT_COMPARISON_DEFAULTS, ticket: 37, players: 500, distance: 300 };
    const scenarios = buildFormatComparisonScenarios(config);
    expect(FORMAT_COMPARISON_FORMATS).toEqual(["freezeout", "pko", "mystery", "ocean-ko"]);
    expect(scenarios.map((row) => row.format)).toEqual(FORMAT_COMPARISON_FORMATS);
    for (const scenario of scenarios) {
      const row = scenario.input.schedule[0];
      expect(row.buyIn * (1 + row.rake)).toBeCloseTo(config.ticket, 12);
      expect(row.players).toBe(500);
      expect(row.roi).toBe(config.roi);
      expect(scenario.input.scheduleRepeats).toBe(300);
      expect(scenario.input.samples).toBe(config.samples);
      expect(scenario.input.collectDownsideReport).toBe(true);
      expect(scenario.input.rakebackFracOfRake).toBeUndefined();
      expect(scenario.input.battleRoyaleLeaderboard).toBeUndefined();
    }
  });

  it("reads analytic bounds and decomposes the same compiled second moment", () => {
    const config = { ...FORMAT_COMPARISON_DEFAULTS, players: 100 };
    const scenarios = buildFormatComparisonScenarios(config);
    const rows = buildFormatComparisonMoments(config);
    rows.forEach((row, index) => {
      const compiled = compileSchedule({ ...scenarios[index].input, scheduleRepeats: 1 });
      const m = compiledEntryMoments(compiled.flat[0]);
      const cost = compiled.flat[0].singleCost;
      expect(row.roi).toBeCloseTo(config.roi, 6);
      expect(row.cashMeanBI + row.bountyMeanBI).toBeCloseTo(1 + row.roi, 12);
      expect(row.cashVarianceBI2 + row.bountyVarianceBI2.upper + row.twiceCashBountyCovarianceBI2).toBeCloseTo(row.varianceBI2.upper, 10);
      expect(row.cashVarianceBI2 + row.bountyVarianceBI2.lower + row.twiceCashBountyCovarianceBI2).toBeCloseTo(row.varianceBI2.lower, 10);
      expect(row.varianceBI2.upper).toBeCloseTo((m.secondDollar - m.meanDollar ** 2) / cost ** 2, 10);
      expect(row.sigmaBI.upper ** 2).toBeCloseTo(row.varianceBI2.upper, 10);
      expect(row.roiSdAtDistance.upper).toBeCloseTo(row.sigmaBI.upper / Math.sqrt(config.distance), 12);
      expect(row.profitSdAtDistanceBI.upper).toBeCloseTo(row.sigmaBI.upper * Math.sqrt(config.distance), 12);
    });
    const ocean = rows.find((row) => row.format === "ocean-ko")!;
    expect(ocean.bounded).toBe(true);
    expect(ocean.sigmaBI.upper).toBeGreaterThan(ocean.sigmaBI.lower);
    expect(ocean.oceanSigmaRatio).toEqual({ lower: 1, upper: 1 });
    expect(rows[0].bountyVarianceBI2).toEqual({ lower: 0, upper: 0 });
    expect(ocean.oceanDistanceRatio).toEqual({ lower: 1, upper: 1 });
    for (const row of rows) {
      expect(row.oceanSigmaRatio!.upper ** 2).toBeCloseTo(row.oceanDistanceRatio!.upper, 10);
    }
  });

  it("preserves the format pool differences instead of concealing a confound", () => {
    const rows = buildFormatComparisonMoments({ ...FORMAT_COMPARISON_DEFAULTS, players: 18 });
    expect(rows.find((r) => r.format === "pko")!.bountyPoolFractionOfTicket).toBe(0.46);
    expect(rows.find((r) => r.format === "ocean-ko")!.bountyPoolFractionOfTicket).toBeCloseTo(0.5, 12);
    for (const row of rows) expect(row.feeFractionOfTicket + row.cashPoolFractionOfTicket + row.bountyPoolFractionOfTicket).toBeCloseTo(1, 12);
  });

  it.each([{ players: NaN }, { distance: 100.5 }, { seed: -1 }, { samples: 10 }, { ticket: Infinity }])("rejects invalid report controls %j", (patch) => {
    expect(() => buildFormatComparisonScenarios({ ...FORMAT_COMPARISON_DEFAULTS, ...patch })).toThrow();
  });

  it("keeps finite moments and the ROI contract at every configured field, edge and ticket corner", () => {
    for (const players of [18, 100_000]) for (const roi of [-0.2, 1]) for (const ticket of [1, 1000]) {
      for (const row of buildFormatComparisonMoments({ ...FORMAT_COMPARISON_DEFAULTS, players, roi, ticket })) {
        expect(row.roi).toBeCloseTo(roi, 6);
        expect(Number.isFinite(row.sigmaBI.upper)).toBe(true);
        expect(row.sigmaBI.lower).toBeGreaterThan(0);
        expect(row.sigmaBI.upper).toBeGreaterThanOrEqual(row.sigmaBI.lower);
      }
    }
  });
});

describe("downside summary distinguishes EV shortfall from losing money", () => {
  it("summarizes all paths, preserves censoring, and reads compiled EV rather than MC mean", () => {
    const scenario = buildFormatComparisonScenarios({ ...FORMAT_COMPARISON_DEFAULTS, players: 18, distance: 100 })[0];
    const input = { ...scenario.input, samples: 4 };
    const compiled = compileSchedule(input);
    const grid = makeCheckpointGrid(compiled.tournamentsPerSample);
    const shard = simulateShard(input, compiled, 0, 4, grid);
    shard.finalProfits.set([-100, 200, 600, 2000]);
    shard.maxDrawdowns.set([5000, 10000, 25000, 50000]);
    shard.recoveryLengths.set([-2, -1, 10, 20]);
    shard.downsideReport!.maxEvShortfall.set([100, 200, 300, 400]);
    shard.downsideReport!.entriesBelowEv.set([0, 1, 20, 100]);
    const report = summarizeFormatComparisonScenario(scenario, compiled, shard, grid);
    expect(report.samples).toBe(4);
    expect(report.finalLossProbability.value).toBe(0.25);
    expect(report.finalBelowEvProbability.value).toBe(0.75);
    expect(report.everBelowEvProbability.value).toBe(0.75);
    expect(report.expectedProfitBI).toBeCloseTo(10, 6);
    expect(report.realisedMeanProfitBI).toBeCloseTo(6.75, 12);
    expect(report.maxDrawdownBI.max).toBeCloseTo(500, 12);
    expect(report.maxEvShortfallBI.max).toBeCloseTo(4, 12);
    expect(report.drawdownRisks[1].probability.value).toBe(0.75);
    expect(report.fractionEntriesBelowEv.mean).toBeCloseTo(0.3025, 12);
    expect(report.recovery.recoveredSamples).toBe(2);
    expect(report.recovery.noDrawdownSamples).toBe(1);
    expect(report.recovery.unrecoveredProbability.value).toBe(0.25);
    expect(report.recovery.recoveredOnly!.mean).toBe(15);
    expect(report.downsideCurve.at(-1)!.entries).toBe(100);
    expect(report.downsideCurve.at(-1)!.evBI).toBeCloseTo(report.expectedProfitBI, 12);
    shard.recoveryLengths.fill(-1);
    expect(summarizeFormatComparisonScenario(scenario, compiled, shard, grid).recovery.recoveredOnly).toBeNull();
  });

  it("does not report zero observed events as a zero upper probability limit", () => {
    const zero = estimateProbability(0, 1000);
    expect(zero.value).toBe(0);
    expect(zero.wilson95.upper).toBeGreaterThan(0.003);
    expect(zero.wilson95.upper).toBeLessThan(0.004);
    const all = estimateProbability(1000, 1000);
    expect(all.wilson95.lower).toBeCloseTo(1 - zero.wilson95.upper, 12);
    expect(() => estimateProbability(2, 1)).toThrow();
  });

  it("keeps every career's maximum in BI, ascending, and counts ties at the reference thresholds", () => {
    const scenario = buildFormatComparisonScenarios({ ...FORMAT_COMPARISON_DEFAULTS, ticket: 37, players: 18, distance: 100 })[0];
    const input = { ...scenario.input, samples: 8 };
    const compiled = compileSchedule(input);
    const ticket = compiled.flat[0].singleCost;
    const grid = makeCheckpointGrid(compiled.tournamentsPerSample);
    const shard = simulateShard(input, compiled, 0, input.samples, grid);
    const drawdowns = [1300, 0, 9.99, 10, 49.99, 50, 250, 1000];
    const shortfalls = [0, 20, 20, 99.99, 100, 500, 999.99, 1000];
    shard.maxDrawdowns.set(drawdowns.map(value => value * ticket));
    shard.downsideReport!.maxEvShortfall.set(shortfalls.map(value => value * ticket));
    const before = Array.from(shard.maxDrawdowns);
    const report = summarizeFormatComparisonScenario(scenario, compiled, shard, grid);
    for (const [maxima, reference, source] of [
      [report.careerMaxima.drawdownBI, report.drawdownRisks, drawdowns],
      [report.careerMaxima.evShortfallBI, report.evShortfallRisks, shortfalls],
    ] as const) {
      const inBI = source.map(value => (value * ticket) / ticket).sort((a, b) => a - b);
      expect(Array.from(maxima)).toEqual(inBI);
      expect(reference.map(point => point.thresholdBI)).toEqual([50, 100, 250, 500, 1000]);
      for (const point of reference) {
        const count = inBI.filter(value => value >= point.thresholdBI).length;
        expect(point.probability).toEqual(estimateProbability(count, input.samples));
      }
    }
    expect(report.drawdownRisks[0].probability.count).toBe(4);
    expect(report.drawdownRisks.at(-1)!.probability.count).toBe(2);
    expect(report.evShortfallRisks.at(-1)!.probability.count).toBe(1);
    expect(Array.from(shard.maxDrawdowns)).toEqual(before);
  });

  it("uses the engine's empirical order-statistic convention, without interpolation or outcome normality", () => {
    expect(summarizeDistribution([9, 0, 2, 1])).toEqual({ mean: 3, median: 1, p90: 2, p95: 2, p99: 2, max: 9 });
    expect(() => summarizeDistribution([])).toThrow();
    expect(() => summarizeDistribution([NaN])).toThrow();
  });

  it("keeps 201 real checkpoints and exact all-sample extrema and quantiles, including the final checkpoint", () => {
    const scenario = buildFormatComparisonScenarios({ ...FORMAT_COMPARISON_DEFAULTS, ticket: 37, players: 18, distance: 503 })[0];
    const input = { ...scenario.input, samples: 8 };
    const compiled = compileSchedule(input);
    const ticket = compiled.flat[0].singleCost;
    const grid = makeCheckpointGrid(compiled.tournamentsPerSample);
    const shard = simulateShard(input, compiled, 0, input.samples, grid);
    for (let s = 0; s < input.samples; s++) for (let j = 0; j <= grid.K; j++) {
      shard.pathMatrix[s * (grid.K + 1) + j] = (((s + j) % input.samples) ** 2 - 9) * j * ticket;
    }
    const original = Array.from(shard.pathMatrix);
    const report = summarizeFormatComparisonScenario(scenario, compiled, shard, grid);
    expect(report.downsideCurve).toHaveLength(201);
    expect(report.downsideCurve[0].entries).toBe(0);
    expect(report.downsideCurve.at(-1)!.entries).toBe(503);
    for (const point of report.downsideCurve) {
      const j = Array.from(grid.checkpointIdx).indexOf(point.entries);
      expect(j).toBeGreaterThanOrEqual(0);
      const values = Array.from({ length: input.samples }, (_, s) => shard.pathMatrix[s * (grid.K + 1) + j]).sort((a, b) => a - b);
      expect(point.minBI).toBe(values[0] / ticket);
      expect(point.p05BI).toBe(values[Math.floor(0.05 * (input.samples - 1))] / ticket);
      expect(point.medianBI).toBe(values[Math.floor(0.5 * (input.samples - 1))] / ticket);
      expect(point.p95BI).toBe(values[Math.floor(0.95 * (input.samples - 1))] / ticket);
      expect(point.maxBI).toBe(values.at(-1)! / ticket);
      expect(point.evBI).toBeCloseTo(report.expectedProfitBI * point.entries / report.distance, 12);
    }
    expect(report.downsideCurve.at(-1)!.maxBI).toBeGreaterThan(report.downsideCurve.at(-1)!.p95BI);
    expect(Array.from(shard.pathMatrix)).toEqual(original);
  });
});

function fakeRow(format: ComparisonFormat, drawdownBI: number[], evShortfallBI = drawdownBI) {
  return {
    format,
    careerMaxima: { drawdownBI: Float64Array.from(drawdownBI).sort(), evShortfallBI: Float64Array.from(evShortfallBI).sort() },
  } satisfies Pick<FormatComparisonSummary, "format" | "careerMaxima">;
}

describe("risk curves share one grid that reaches the deepest observation", () => {
  it("rounds up to a round number strictly above the value", () => {
    const table: [number, number][] = [
      [0, 1], [-5, 1], [NaN, 1], [0.4, 0.5], [99, 100], [100, 120], [196.2, 200], [357.4, 400], [410.8, 500],
      [500, 600], [999.9, 1000], [1000, 1200], [1346, 1500], [2040.2, 2500], [12345, 15000], [60000, 80000], [80000, 100000],
    ];
    for (const [value, expected] of table) expect(niceCeilingAbove(value)).toBe(expected);
    for (const value of [0.0123, 7, 33, 410.8, 4999.9, 123456]) {
      const ceiling = niceCeilingAbove(value);
      expect(ceiling).toBeGreaterThan(value);
      expect(ceiling / value).toBeLessThanOrEqual(1.34);
    }
  });

  it("builds 101 evenly spaced thresholds from 0 to the round number", () => {
    for (const maximum of [37.2, 357.4, 410.8, 1346, 2040.2, 25000]) {
      const grid = riskThresholdGrid(maximum);
      expect(grid).toHaveLength(RISK_CURVE_POINTS);
      expect(grid[0]).toBe(0);
      expect(grid.at(-1)).toBe(niceCeilingAbove(maximum));
      expect(grid.at(-1)!).toBeGreaterThan(maximum);
      const step = grid[1] - grid[0];
      for (let i = 1; i < grid.length; i++) expect(grid[i] - grid[i - 1]).toBeCloseTo(step, 9);
    }
  });

  it("uses one grid for every format and never cuts a tail, separately for each metric", () => {
    const rows = [
      fakeRow("freezeout", [10, 150, 480, 1346, 2040], [20, 300, 900, 2500, 3100]),
      fakeRow("pko", [5, 60, 90, 300, 700], [8, 100, 200, 600, 1500]),
      fakeRow("ocean-ko", [20, 120, 410, 1100, 1900], [30, 250, 700, 2100, 2800]),
    ];
    const drawdown = commonRiskCurves(rows, "drawdown");
    const shortfall = commonRiskCurves(rows, "evShortfall");
    expect(drawdown.observedMaximumBI).toBe(2040);
    expect(drawdown.thresholds.at(-1)).toBe(2500);
    expect(shortfall.observedMaximumBI).toBe(3100);
    expect(shortfall.thresholds.at(-1)).toBe(4000);
    for (const common of [drawdown, shortfall]) {
      expect(common.thresholds).toHaveLength(RISK_CURVE_POINTS);
      for (const row of rows) {
        const curve = common.curves[row.format]!;
        expect(curve.map(point => point.thresholdBI)).toEqual(common.thresholds);
        expect(curve[0].probability.value).toBe(1);
        expect(curve.at(-1)!.probability.count).toBe(0);
        expect(curve.at(-1)!.probability.value).toBe(0);
        for (let i = 1; i < curve.length; i++) {
          expect(curve[i].probability.value).toBeLessThanOrEqual(curve[i - 1].probability.value);
        }
      }
    }
    // The old fixed 0-1000 BI grid would have shown 40% here and nothing beyond it.
    const atThousand = drawdown.curves.freezeout!.find(point => point.thresholdBI === 1000)!;
    expect(atThousand.probability.value).toBe(0.4);
    const beyond = drawdown.curves.freezeout!.find(point => point.thresholdBI === 1500)!;
    expect(beyond.probability.value).toBe(0.2);
  });

  it("counts maximum >= threshold on the shared grid, including ties", () => {
    const grid = [0, 10, 20, 30];
    const curve = thresholdRiskCurve([0, 10, 10, 25], grid);
    expect(curve.map(point => point.probability.count)).toEqual([4, 3, 1, 0]);
    expect(commonRiskCurves([], "drawdown").thresholds.at(-1)).toBe(1);
  });
});

describe("ordinary Ocean wheel caps", () => {
  it("caps rather than deletes or renormalises multiplier outcomes", () => {
    const rows = oceanWheelCutoffs();
    const full = rows.at(-1)!;
    expect(full.meanBefore).toBeCloseTo(1, 12);
    expect(full.meanAfter).toBeCloseTo(1, 12);
    expect(full.varianceAfter).toBeCloseTo(14.172664 - 1, 10);
    expect(full.evRemovedFraction).toBe(0);
    const cap100 = rows.find((row) => row.cap === 100)!;
    expect(cap100.evRemovedFraction).toBeCloseTo(0.00002 * (400 - 100), 12);
    const cap50 = rows.find((row) => row.cap === 50)!;
    expect(cap50.originalEvFromAboveFraction).toBeCloseTo(0.088, 12);
    expect(cap50.evRemovedFraction).toBeCloseTo(0.047, 12);
    expect(cap50.probabilityAbove).toBeCloseTo(0.00082, 12);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].meanAfter).toBeGreaterThanOrEqual(rows[i - 1].meanAfter);
      expect(rows[i].varianceAfter).toBeGreaterThanOrEqual(rows[i - 1].varianceAfter);
    }
  });
});
