/**
 * Closed-form moments of an already-compiled entry: E[$] and E[$²] over the
 * calibrated finish pmf, the PKO heat bank and the per-KO bounty envelope.
 * This is the analytic twin of the hot loop — it answers "what σ would the
 * simulator produce for this row?" without drawing a single sample, which is
 * what the convergence widgets need. Kept out of the compile stage because it
 * only reads CompiledEntry and never builds one.
 */
import { HEAT_Z_RANGE } from "./engineConstants";
import { normalCdf } from "./simNumerics";
import type { CompiledEntry } from "./engineTypes";

function pmfFromAlias(
  prob: Float64Array,
  alias: Int32Array,
): Float64Array {
  const n = prob.length;
  const pmf = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    pmf[i] += prob[i] / n;
    pmf[alias[i]] += (1 - prob[i]) / n;
  }
  return pmf;
}

function heatBinProbabilities(binCount: number): Float64Array {
  if (binCount <= 1) return Float64Array.of(1);
  const probs = new Float64Array(binCount);
  const step = (2 * HEAT_Z_RANGE) / (binCount - 1);
  for (let i = 0; i < binCount; i++) {
    const lo = i === 0 ? -Infinity : -HEAT_Z_RANGE + (i - 0.5) * step;
    const hi =
      i === binCount - 1 ? Infinity : -HEAT_Z_RANGE + (i + 0.5) * step;
    probs[i] = normalCdf(hi) - normalCdf(lo);
  }
  return probs;
}

function secondMomentFromAliasValues(
  values: Float64Array,
  aliasProb: Float64Array,
  aliasIdx: Int32Array,
): number {
  const pmf = pmfFromAlias(aliasProb, aliasIdx);
  let second = 0;
  for (let i = 0; i < values.length; i++) second += pmf[i] * values[i] * values[i];
  return second;
}

function bountySecondMoment(
  mean: number,
  lambda: number,
  perKoSecondMoment: number,
): number {
  if (!(mean > 0)) return 0;
  if (!(lambda > 0)) return mean * mean;
  const variance = (mean * mean * perKoSecondMoment) / lambda;
  return mean * mean + variance;
}

export function compiledEntryMoments(entry: CompiledEntry): {
  meanDollar: number;
  secondDollar: number;
  fieldAvg: number;
  fieldMin: number;
  fieldMax: number;
} {
  if (entry.variants && entry.variants.length > 0) {
    const weight = 1 / entry.variants.length;
    let meanDollar = 0;
    let secondDollar = 0;
    let fieldAvg = 0;
    let fieldMin = Infinity;
    let fieldMax = 0;
    for (const variant of entry.variants) {
      const m = compiledEntryMoments(variant);
      meanDollar += weight * m.meanDollar;
      secondDollar += weight * m.secondDollar;
      fieldAvg += weight * m.fieldAvg;
      fieldMin = Math.min(fieldMin, m.fieldMin);
      fieldMax = Math.max(fieldMax, m.fieldMax);
    }
    return { meanDollar, secondDollar, fieldAvg, fieldMin, fieldMax };
  }

  const pmf = pmfFromAlias(entry.aliasProb, entry.aliasIdx);
  const perKoSecondMoment =
    entry.brTierRatios !== null &&
    entry.brTierAliasProb !== null &&
    entry.brTierAliasIdx !== null
      ? secondMomentFromAliasValues(
          entry.brTierRatios,
          entry.brTierAliasProb,
          entry.brTierAliasIdx,
        )
      : entry.mysteryBountyLogVar > 0
        ? Math.exp(entry.mysteryBountyLogVar)
        : 1;
  const heatBanks =
    entry.heatBountyByPlace !== null
      ? entry.heatBountyByPlace
      : [entry.bountyByPlace];
  const heatWeights =
    entry.heatBountyByPlace !== null
      ? heatBinProbabilities(entry.heatBountyByPlace.length)
      : Float64Array.of(1);

  let meanDollar = 0;
  let secondDollar = 0;
  for (let h = 0; h < heatBanks.length; h++) {
    const q = heatWeights[h] ?? 0;
    if (!(q > 0)) continue;
    const bountyByPlace = heatBanks[h];
    let meanH = 0;
    let secondH = 0;
    for (let i = 0; i < pmf.length; i++) {
      const p = pmf[i];
      if (!(p > 0)) continue;
      const prize = entry.prizeByPlace[i] ?? 0;
      const bountyMean = bountyByPlace?.[i] ?? 0;
      const lambda = entry.bountyKmean?.[i] ?? 0;
      const bounty2 = bountySecondMoment(
        bountyMean,
        lambda,
        perKoSecondMoment,
      );
      meanH += p * (prize + bountyMean);
      secondH += p * (prize * prize + 2 * prize * bountyMean + bounty2);
    }
    meanDollar += q * meanH;
    secondDollar += q * secondH;
  }

  return {
    meanDollar,
    secondDollar,
    fieldAvg: entry.fieldSize,
    fieldMin: entry.fieldSize,
    fieldMax: entry.fieldSize,
  };
}
