import { describe, expect, it } from "vitest";
import { compileSchedule } from "../sim/compile";
import { makeCheckpointGrid } from "../sim/grids";
import { simulateShard } from "../sim/hotLoop";
import { compiledEntryMoments } from "../sim/scheduleMoments";
import {
  buildFormatComparisonMoments, buildFormatComparisonScenarios, estimateProbability,
  FORMAT_COMPARISON_DEFAULTS, oceanWheelCutoffs, summarizeDistribution, summarizeFormatComparisonScenario,
} from "./formatComparison";

describe("format comparison's common cost and native mechanics", () => {
  it("compares four MTTs on the same total cost, field, ROI, distance and samples", () => {
    const config = { ...FORMAT_COMPARISON_DEFAULTS, ticket: 37, players: 500, distance: 300 };
    const scenarios = buildFormatComparisonScenarios(config);
    for (const scenario of scenarios.filter((row) => row.comparable)) {
      const row = scenario.input.schedule[0];
      expect(row.buyIn * (1 + row.rake)).toBeCloseTo(config.ticket, 12);
      expect(row.players).toBe(500);
      expect(row.roi).toBe(config.roi);
      expect(scenario.input.scheduleRepeats).toBe(300);
      expect(scenario.input.collectDownsideReport).toBe(true);
      expect(scenario.input.rakebackFracOfRake).toBeUndefined();
      expect(scenario.input.battleRoyaleLeaderboard).toBeUndefined();
    }
    const battle = scenarios.find((row) => row.format === "mystery-royale")!;
    expect(battle.comparable).toBe(false);
    expect(battle.input.schedule[0].players).toBe(18);
    expect(battle.input.schedule[0].buyIn).toBeCloseTo(9.2, 12);
    expect(battle.input.schedule[0].buyIn * battle.input.schedule[0].bountyFraction!).toBeCloseTo(4.2, 12);
    expect(battle.input.schedule[0].buyIn * (1 - battle.input.schedule[0].bountyFraction!) * 18).toBeCloseTo(90, 12);
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
    expect(rows.at(-1)!.oceanDistanceRatio).toBeNull();
    for (const row of rows.filter((r) => r.comparable)) {
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
    for (const players of [18, 5000]) for (const roi of [-0.2, 1]) for (const ticket of [1, 1000]) {
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

  it("counts 101 genuine risk thresholds including ties, preserving the original reference thresholds", () => {
    const scenario = buildFormatComparisonScenarios({ ...FORMAT_COMPARISON_DEFAULTS, ticket: 37, players: 18, distance: 100 })[0];
    const input = { ...scenario.input, samples: 8 };
    const compiled = compileSchedule(input);
    const ticket = compiled.flat[0].singleCost;
    const grid = makeCheckpointGrid(compiled.tournamentsPerSample);
    const shard = simulateShard(input, compiled, 0, input.samples, grid);
    const drawdowns = [0, 9.99, 10, 49.99, 50, 250, 1000, 1300];
    const shortfalls = [0, 20, 20, 99.99, 100, 500, 999.99, 1000];
    shard.maxDrawdowns.set(drawdowns.map(value => value * ticket));
    shard.downsideReport!.maxEvShortfall.set(shortfalls.map(value => value * ticket));
    const before = Array.from(shard.maxDrawdowns);
    const report = summarizeFormatComparisonScenario(scenario, compiled, shard, grid);
    for (const [curve, reference, values] of [
      [report.drawdownRiskCurve, report.drawdownRisks, shard.maxDrawdowns],
      [report.evShortfallRiskCurve, report.evShortfallRisks, shard.downsideReport!.maxEvShortfall],
    ] as const) {
      expect(curve).toHaveLength(101);
      expect(curve[0].thresholdBI).toBe(0);
      expect(curve[0].probability.value).toBe(1);
      expect(curve.at(-1)!.thresholdBI).toBe(1000);
      for (let i = 0; i < curve.length; i++) {
        const point = curve[i];
        const count = Array.from(values).filter(value => value >= point.thresholdBI * ticket).length;
        expect(point.probability).toEqual(estimateProbability(count, input.samples));
        if (i > 0) {
          expect(point.thresholdBI - curve[i - 1].thresholdBI).toBe(10);
          expect(point.probability.value).toBeLessThanOrEqual(curve[i - 1].probability.value);
        }
      }
      expect(reference.map(point => point.thresholdBI)).toEqual([50, 100, 250, 500, 1000]);
      for (const point of reference) expect(point).toEqual(curve.find(item => item.thresholdBI === point.thresholdBI));
    }
    expect(report.drawdownRiskCurve[1].probability.count).toBe(6);
    expect(report.drawdownRiskCurve.at(-1)!.probability.count).toBe(2);
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
