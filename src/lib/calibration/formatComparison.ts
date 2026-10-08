import { compileSchedule } from "../sim/compile";
import type { CheckpointGrid, CompiledEntry, CompiledSchedule, DownsideShard } from "../sim/engineTypes";
import { OCEAN_KO_ODDS } from "../sim/oceanKo";
import { compiledEntryMoments } from "../sim/scheduleMoments";
import type { SimulationInput, TournamentRow } from "../sim/types";

export const FORMAT_COMPARISON_FORMATS = ["freezeout", "pko", "mystery", "ocean-ko"] as const;
export type ComparisonFormat = typeof FORMAT_COMPARISON_FORMATS[number];
export interface FormatComparisonConfig {
  ticket: number;
  players: number;
  roi: number;
  distance: number;
  samples: number;
  seed: number;
  mysteryLogVariance: number;
}

export const FORMAT_COMPARISON_DEFAULTS: FormatComparisonConfig = {
  ticket: 100, players: 1000, roi: 0.1, distance: 1000,
  samples: 2000, seed: 20261008, mysteryLogVariance: 2,
};

export const FORMAT_COMPARISON_LIMITS = {
  ticket: { min: 1, max: 1000 }, players: { min: 18, max: 100_000 },
  roi: { min: -0.2, max: 1 }, distance: { min: 100, max: 100_000 },
  samples: { min: 1000, max: 5000 }, mysteryLogVariance: { min: 0, max: 4 },
} as const;

export interface FormatComparisonScenario {
  format: ComparisonFormat;
  input: SimulationInput;
}

export interface NumericBounds { lower: number; upper: number }
export interface DistributionSummary {
  mean: number;
  median: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
}
export interface ProbabilityEstimate {
  count: number;
  samples: number;
  value: number;
  /** Monte Carlo sampling uncertainty, conditional on the specified model. */
  wilson95: NumericBounds;
}
export interface ThresholdRisk {
  thresholdBI: number;
  probability: ProbabilityEstimate;
}
export interface FormatComparisonMomentRow {
  format: ComparisonFormat;
  ticket: number;
  players: number;
  feeFractionOfTicket: number;
  cashPoolFractionOfTicket: number;
  bountyPoolFractionOfTicket: number;
  payoutStructure: TournamentRow["payoutStructure"];
  roi: number;
  itm: number;
  cashMeanBI: number;
  bountyMeanBI: number;
  cashVarianceBI2: number;
  bountyVarianceBI2: NumericBounds;
  twiceCashBountyCovarianceBI2: number;
  varianceBI2: NumericBounds;
  sigmaBI: NumericBounds;
  /** These are analytic model bounds, not a fitted point or confidence interval. */
  bounded: boolean;
  oceanSigmaRatio: NumericBounds | null;
  oceanDistanceRatio: NumericBounds | null;
  profitSdAtDistanceBI: NumericBounds;
  roiSdAtDistance: NumericBounds;
}

export interface FormatComparisonSummary {
  format: ComparisonFormat;
  ticket: number;
  players: number;
  distance: number;
  samples: number;
  seed: number;
  expectedProfitBI: number;
  realisedMeanProfitBI: number;
  realisedMeanRoi: number;
  maxDrawdownBI: DistributionSummary;
  maxEvShortfallBI: DistributionSummary;
  finalEvShortfallBI: DistributionSummary;
  /** Consecutive entry endpoints below EV / the prior profit high. */
  longestBelowEv: DistributionSummary;
  longestUnderwater: DistributionSummary;
  longestLosingEntries: DistributionSummary;
  fractionEntriesBelowEv: DistributionSummary;
  finalLossProbability: ProbabilityEstimate;
  finalBelowEvProbability: ProbabilityEstimate;
  everBelowEvProbability: ProbabilityEstimate;
  /** Reference thresholds (50 / 100 / 250 / 500 / 1000 BI). */
  drawdownRisks: ThresholdRisk[];
  evShortfallRisks: ThresholdRisk[];
  /** Every career's maximum in BI, ascending. The risk curves are built from
   * these in the UI so that all formats share one grid that reaches the
   * deepest observation of any of them. */
  careerMaxima: { drawdownBI: Float64Array; evShortfallBI: Float64Array };
  /** Existing engine definition: trough to first strictly higher profit peak. */
  recovery: {
    recoveredSamples: number;
    noDrawdownSamples: number;
    recoveredOnly: DistributionSummary | null;
    unrecoveredProbability: ProbabilityEstimate;
  };
  /** All-sample endpoint extrema and quantiles; adjacent points may belong to different paths. */
  downsideCurve: { entries: number; evBI: number; minBI: number; p05BI: number; medianBI: number; p95BI: number; maxBI: number }[];
  moments: FormatComparisonMomentRow;
}

export interface OceanWheelCutoff {
  cap: number;
  probabilityAbove: number;
  meanBefore: number;
  meanAfter: number;
  varianceAfter: number;
  evRemovedFraction: number;
  originalEvFromAboveFraction: number;
}

export function validateFormatComparisonConfig(config: FormatComparisonConfig): void {
  for (const key of Object.keys(FORMAT_COMPARISON_LIMITS) as (keyof typeof FORMAT_COMPARISON_LIMITS)[]) {
    const { min, max } = FORMAT_COMPARISON_LIMITS[key];
    if (!Number.isFinite(config[key]) || config[key] < min || config[key] > max) {
      throw new Error(`format comparison: ${key} must be between ${min} and ${max}`);
    }
  }
  for (const key of ["players", "distance", "samples", "seed"] as const) {
    if (!Number.isSafeInteger(config[key])) throw new Error(`format comparison: ${key} must be an integer`);
  }
  if (config.seed < 0 || config.seed > 0xffffffff) throw new Error("format comparison: seed must be uint32");
}

export function buildFormatComparisonScenarios(config: FormatComparisonConfig): FormatComparisonScenario[] {
  validateFormatComparisonConfig(config);
  return FORMAT_COMPARISON_FORMATS.map((format) => {
    const buyIn = config.ticket * 0.92;
    const row: TournamentRow = {
      id: `comparison-${format}`, gameType: format,
      players: config.players, buyIn, rake: 8 / 92,
      roi: config.roi, count: 1,
      payoutStructure: format === "freezeout" ? "mtt-gg"
        : format === "mystery" ? "mtt-gg-mystery"
          : "mtt-gg-bounty",
      ...(format !== "freezeout" ? {
        bountyFraction: format === "ocean-ko" ? 50 / 92 : 0.5,
      } : {}),
      ...(format === "mystery" ? { mysteryBountyVariance: config.mysteryLogVariance } : {}),
      ...(format === "pko" ? { pkoHeadVar: 0.4, pkoHeat: 0 } : {}),
    };
    return {
      format,
      input: {
        schedule: [row], scheduleRepeats: config.distance, samples: config.samples,
        bankroll: 0, seed: config.seed, finishModel: { id: "power-law" },
        collectDownsideReport: true,
      },
    };
  });
}

function aliasPmf(entry: CompiledEntry): Float64Array {
  const n = entry.aliasProb.length;
  const pmf = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    pmf[i] += entry.aliasProb[i] / n;
    pmf[entry.aliasIdx[i]] += (1 - entry.aliasProb[i]) / n;
  }
  return pmf;
}

function scaledBounds(bounds: NumericBounds, scale: number): NumericBounds {
  return { lower: bounds.lower * scale, upper: bounds.upper * scale };
}

function momentRow(scenario: FormatComparisonScenario, entry: CompiledEntry): FormatComparisonMomentRow {
  const row = scenario.input.schedule[0];
  const ticket = entry.singleCost;
  const pmf = aliasPmf(entry);
  const moments = compiledEntryMoments(entry);
  let cashMean = 0, cashSecond = 0, bountyMean = 0, cross = 0;
  for (let i = 0; i < pmf.length; i++) {
    const cash = entry.prizeByPlace[i];
    const bounty = entry.bountyByPlace?.[i] ?? 0;
    cashMean += pmf[i] * cash;
    cashSecond += pmf[i] * cash * cash;
    bountyMean += pmf[i] * bounty;
    cross += pmf[i] * cash * bounty;
  }
  const square = ticket * ticket;
  const varianceBI2 = {
    lower: Math.max(0, (moments.secondDollarLower ?? moments.secondDollar) - moments.meanDollar ** 2) / square,
    upper: Math.max(0, moments.secondDollar - moments.meanDollar ** 2) / square,
  };
  const sigmaBI = { lower: Math.sqrt(varianceBI2.lower), upper: Math.sqrt(varianceBI2.upper) };
  const cashVarianceBI2 = Math.max(0, cashSecond - cashMean ** 2) / square;
  const twiceCashBountyCovarianceBI2 = 2 * (cross - cashMean * bountyMean) / square;
  const distance = scenario.input.scheduleRepeats;
  return {
    format: scenario.format, ticket, players: entry.fieldSize,
    feeFractionOfTicket: 0.08,
    cashPoolFractionOfTicket: 0.92 * (1 - (row.bountyFraction ?? 0)),
    bountyPoolFractionOfTicket: 0.92 * (row.bountyFraction ?? 0),
    payoutStructure: row.payoutStructure,
    roi: moments.meanDollar / ticket - 1, itm: entry.itm,
    cashMeanBI: cashMean / ticket, bountyMeanBI: bountyMean / ticket,
    cashVarianceBI2, twiceCashBountyCovarianceBI2,
    bountyVarianceBI2: {
      lower: Math.max(0, varianceBI2.lower - cashVarianceBI2 - twiceCashBountyCovarianceBI2),
      upper: Math.max(0, varianceBI2.upper - cashVarianceBI2 - twiceCashBountyCovarianceBI2),
    },
    varianceBI2, sigmaBI, bounded: moments.varianceBounded === true,
    oceanSigmaRatio: null, oceanDistanceRatio: null,
    profitSdAtDistanceBI: scaledBounds(sigmaBI, Math.sqrt(distance)),
    roiSdAtDistance: scaledBounds(sigmaBI, 1 / Math.sqrt(distance)),
  };
}

export function buildFormatComparisonMoments(config: FormatComparisonConfig): FormatComparisonMomentRow[] {
  const rows = buildFormatComparisonScenarios(config).map((scenario) => {
    const compiled = compileSchedule({ ...scenario.input, scheduleRepeats: 1 });
    return momentRow(scenario, compiled.flat[0]);
  });
  return withOceanRatios(rows);
}

function withOceanRatios(rows: FormatComparisonMomentRow[]): FormatComparisonMomentRow[] {
  const ocean = rows.find((row) => row.format === "ocean-ko")!;
  for (const row of rows) {
    const ratio = row === ocean ? { lower: 1, upper: 1 } : {
      lower: ocean.varianceBI2.lower / row.varianceBI2.upper,
      upper: ocean.varianceBI2.upper / row.varianceBI2.lower,
    };
    row.oceanDistanceRatio = ratio;
    row.oceanSigmaRatio = { lower: Math.sqrt(ratio.lower), upper: Math.sqrt(ratio.upper) };
  }
  return rows;
}

export function compileFormatComparison(config: FormatComparisonConfig) {
  const prepared = buildFormatComparisonScenarios(config).map(scenario => {
    const compiled = compileSchedule(scenario.input);
    return { scenario, compiled, moments: momentRow(scenario, compiled.flat[0]) };
  });
  withOceanRatios(prepared.map(row => row.moments));
  return prepared;
}

export function summarizeDistribution(values: ArrayLike<number>, scale = 1): DistributionSummary {
  if (values.length === 0) throw new Error("format comparison: empty distribution");
  const sorted = Float64Array.from(values).sort();
  const quantile = (p: number) => sorted[Math.floor(p * (sorted.length - 1))] * scale;
  let sum = 0;
  for (const value of sorted) {
    if (!Number.isFinite(value)) throw new Error("format comparison: non-finite observation");
    sum += value;
  }
  return {
    mean: sum / sorted.length * scale, median: quantile(0.5), p90: quantile(0.9),
    p95: quantile(0.95), p99: quantile(0.99), max: quantile(1),
  };
}

export function estimateProbability(count: number, samples: number): ProbabilityEstimate {
  if (!Number.isSafeInteger(samples) || samples < 1 || !Number.isSafeInteger(count) || count < 0 || count > samples) {
    throw new Error("format comparison: invalid event count");
  }
  const value = count / samples;
  const z2 = 1.959963984540054 ** 2;
  const denominator = 1 + z2 / samples;
  const centre = (value + z2 / (2 * samples)) / denominator;
  const radius = Math.sqrt(value * (1 - value) / samples * z2 + z2 * z2 / (4 * samples * samples)) / denominator;
  return { count, samples, value, wilson95: { lower: Math.max(0, centre - radius), upper: Math.min(1, centre + radius) } };
}

const RISK_THRESHOLDS_BI = [50, 100, 250, 500, 1000];
export const RISK_CURVE_POINTS = 101;
const NICE_MANTISSAS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8];

/** Smallest round number (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6 or 8 times a power of ten)
 * strictly above `value`. Strictly, so that a grid ending there has no career
 * at or beyond its last threshold. */
export function niceCeilingAbove(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  for (let exponent = Math.floor(Math.log10(value)); ; exponent++) {
    for (const mantissa of NICE_MANTISSAS) {
      const candidate = Number((mantissa * 10 ** exponent).toPrecision(12));
      if (candidate > value) return candidate;
    }
  }
}

/** 101 equally spaced thresholds from 0 to the round number above `maximumBI`. */
export function riskThresholdGrid(maximumBI: number): number[] {
  const upper = niceCeilingAbove(maximumBI);
  const last = RISK_CURVE_POINTS - 1;
  return Array.from({ length: RISK_CURVE_POINTS }, (_, i) => i === last ? upper : upper * i / last);
}

/** Share of careers whose maximum reached each threshold (`maximum >= threshold`).
 * `sortedBI` must be ascending; the grid must be ascending too. */
export function thresholdRiskCurve(sortedBI: ArrayLike<number>, grid: readonly number[]): ThresholdRisk[] {
  let below = 0;
  return grid.map((thresholdBI) => {
    while (below < sortedBI.length && sortedBI[below] < thresholdBI) below++;
    return { thresholdBI, probability: estimateProbability(sortedBI.length - below, sortedBI.length) };
  });
}

export type RiskMetric = "drawdown" | "evShortfall";
export interface CommonRiskCurves {
  thresholds: number[];
  /** The deepest observation of any shown format, BI. */
  observedMaximumBI: number;
  curves: Partial<Record<ComparisonFormat, ThresholdRisk[]>>;
}

/** One grid per metric, shared by every format in the chart: its top is the
 * round number above the deepest career of any of them, so no tail is cut and
 * each curve ends at zero. */
export function commonRiskCurves(
  rows: readonly Pick<FormatComparisonSummary, "format" | "careerMaxima">[],
  metric: RiskMetric,
): CommonRiskCurves {
  const key = metric === "drawdown" ? "drawdownBI" : "evShortfallBI";
  let observedMaximumBI = 0;
  for (const row of rows) {
    for (const value of row.careerMaxima[key]) if (value > observedMaximumBI) observedMaximumBI = value;
  }
  const thresholds = riskThresholdGrid(observedMaximumBI);
  const curves: CommonRiskCurves["curves"] = {};
  for (const row of rows) curves[row.format] = thresholdRiskCurve(row.careerMaxima[key], thresholds);
  return { thresholds, observedMaximumBI, curves };
}

export function summarizeFormatComparisonScenario(
  scenario: FormatComparisonScenario,
  compiled: CompiledSchedule,
  shard: DownsideShard,
  grid: CheckpointGrid,
  preparedMoments?: FormatComparisonMomentRow,
): FormatComparisonSummary {
  const collected = shard.downsideReport;
  const samples = shard.finalProfits.length;
  const distance = compiled.tournamentsPerSample;
  if (!collected || samples === 0 || compiled.flat.length !== distance || scenario.input.schedule.length !== 1) {
    throw new Error("format comparison: a homogeneous collected downside shard is required");
  }
  const ticket = compiled.flat[0].singleCost;
  const careerMaxima = {
    drawdownBI: Float64Array.from(shard.maxDrawdowns, (value) => value / ticket).sort(),
    evShortfallBI: Float64Array.from(collected.maxEvShortfall, (value) => value / ticket).sort(),
  };
  const moments = preparedMoments ?? momentRow(scenario, compiled.flat[0]);
  const expectedProfit = (compiled.flat[0].analyticMeanSingle - ticket) * distance;
  const shortfalls = new Float64Array(samples);
  let losses = 0, belowEv = 0, everBelowEv = 0, meanProfit = 0, noDrawdownSamples = 0, unrecovered = 0;
  const recovered: number[] = [];
  for (let s = 0; s < samples; s++) {
    const profit = shard.finalProfits[s];
    meanProfit += profit;
    if (profit < 0) losses++;
    if (profit < expectedProfit) belowEv++;
    if (collected.entriesBelowEv[s] > 0) everBelowEv++;
    shortfalls[s] = Math.max(0, expectedProfit - profit);
    const recovery = shard.recoveryLengths[s];
    if (recovery === -2) noDrawdownSamples++;
    else if (recovery < 0) unrecovered++;
    else recovered.push(recovery);
  }
  const curve: FormatComparisonSummary["downsideCurve"] = [];
  const column = new Float64Array(samples);
  const checkpoints = Math.min(grid.K, 200);
  for (let point = 0; point <= checkpoints; point++) {
    const j = Math.round(point * grid.K / checkpoints);
    for (let s = 0; s < samples; s++) column[s] = shard.pathMatrix[s * (grid.K + 1) + j];
    column.sort();
    curve.push({
      entries: grid.checkpointIdx[j], evBI: expectedProfit / ticket * grid.checkpointIdx[j] / distance,
      minBI: column[0] / ticket,
      p05BI: column[Math.floor(0.05 * (samples - 1))] / ticket,
      medianBI: column[Math.floor(0.5 * (samples - 1))] / ticket,
      p95BI: column[Math.floor(0.95 * (samples - 1))] / ticket,
      maxBI: column[samples - 1] / ticket,
    });
  }
  return {
    format: scenario.format, ticket,
    players: compiled.flat[0].fieldSize, distance, samples, seed: scenario.input.seed,
    expectedProfitBI: expectedProfit / ticket,
    realisedMeanProfitBI: meanProfit / samples / ticket,
    realisedMeanRoi: meanProfit / samples / ticket / distance,
    maxDrawdownBI: summarizeDistribution(shard.maxDrawdowns, 1 / ticket),
    maxEvShortfallBI: summarizeDistribution(collected.maxEvShortfall, 1 / ticket),
    finalEvShortfallBI: summarizeDistribution(shortfalls, 1 / ticket),
    longestBelowEv: summarizeDistribution(collected.longestBelowEv),
    longestUnderwater: summarizeDistribution(collected.longestUnderwater),
    longestLosingEntries: summarizeDistribution(collected.longestLosingEntries),
    fractionEntriesBelowEv: summarizeDistribution(collected.entriesBelowEv, 1 / distance),
    finalLossProbability: estimateProbability(losses, samples),
    finalBelowEvProbability: estimateProbability(belowEv, samples),
    everBelowEvProbability: estimateProbability(everBelowEv, samples),
    drawdownRisks: thresholdRiskCurve(careerMaxima.drawdownBI, RISK_THRESHOLDS_BI),
    evShortfallRisks: thresholdRiskCurve(careerMaxima.evShortfallBI, RISK_THRESHOLDS_BI),
    careerMaxima,
    recovery: {
      recoveredSamples: recovered.length, noDrawdownSamples,
      recoveredOnly: recovered.length ? summarizeDistribution(recovered) : null,
      unrecoveredProbability: estimateProbability(unrecovered, samples),
    },
    downsideCurve: curve, moments,
  };
}

/** A cap replaces M by min(M, cap), without renormalisation. This concerns
 * one ordinary wheel only: changing it throughout the recursive head tree
 * changes subsequent head sizes and tier transitions, so these numbers do
 * not identify capped tournament ROI, jackpot ancestry EV, or path risk. */
export function oceanWheelCutoffs(): OceanWheelCutoff[] {
  const wheel = OCEAN_KO_ODDS[0];
  const meanBefore = wheel.multipliers.reduce((sum, m, i) => sum + m * wheel.probabilities[i], 0);
  return [1, 2, 10, 50, 100, 400].map((cap) => {
    let meanAfter = 0, second = 0, probabilityAbove = 0, originalAbove = 0;
    for (let i = 0; i < wheel.multipliers.length; i++) {
      const m = wheel.multipliers[i], p = wheel.probabilities[i];
      const capped = Math.min(m, cap);
      meanAfter += p * capped;
      second += p * capped * capped;
      if (m > cap) { probabilityAbove += p; originalAbove += p * m; }
    }
    return {
      cap, probabilityAbove, meanBefore, meanAfter,
      varianceAfter: Math.max(0, second - meanAfter * meanAfter),
      evRemovedFraction: (meanBefore - meanAfter) / meanBefore,
      originalEvFromAboveFraction: originalAbove / meanBefore,
    };
  });
}
