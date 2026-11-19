/**
 * Path-shape catalogs: drawdown depth quantiles, breakeven / cashless streak
 * aggregates, recovery-time distribution, and the worst/best swing rankings.
 * Owns the "streaks" phase of the build progress.
 */
import type { BuildProgressCb } from "./engineTypes";
import { histogramOfLengths } from "./simNumerics";
import type { SimulationResult } from "./types";

export function computeStreakStats(
  maxDrawdowns: Float64Array,
  longestBreakevens: Float64Array,
  breakevenStreakAvgs: Float64Array,
  longestCashless: Int32Array,
  recoveryLengths: Int32Array,
  S: number,
  onBuildProgress?: BuildProgressCb,
) {
  let ddMean = 0;
  let ddWorst = 0;
  for (let s = 0; s < S; s++) {
    ddMean += maxDrawdowns[s];
    if (maxDrawdowns[s] > ddWorst) ddWorst = maxDrawdowns[s];
  }
  ddMean /= S;

  // Tail quantiles of max drawdown — a straight answer to
  // "how bad is a typical/5%/1% worst run". PrimeDope only shows a single
  // aggregate estimate; we expose the whole tail shape.
  onBuildProgress?.(0.83, "streaks");
  const ddSorted = maxDrawdowns.slice().sort();
  onBuildProgress?.(0.85, "streaks");
  const ddPct = (p: number) =>
    ddSorted[Math.min(S - 1, Math.max(0, Math.floor(p * (S - 1))))];
  const maxDrawdownMedian = ddPct(0.5);
  const maxDrawdownP95 = ddPct(0.95);
  const maxDrawdownP99 = ddPct(0.99);

  let beMean = 0;
  for (let s = 0; s < S; s++) beMean += longestBreakevens[s];
  beMean /= S;

  // Mean "any streak" length per sample: average of breakevenStreakAvgs
  // over samples that had at least one forward return. Samples with no
  // returns (monotone paths) contribute 0; we still divide by S so the
  // aggregate has the same semantics as beMean.
  let beStreakMean = 0;
  for (let s = 0; s < S; s++) beStreakMean += breakevenStreakAvgs[s];
  beStreakMean /= S;

  // Cashless streak stats
  let cashlessAcc = 0;
  let cashlessWorst = 0;
  for (let s = 0; s < S; s++) {
    const v = longestCashless[s];
    cashlessAcc += v;
    if (v > cashlessWorst) cashlessWorst = v;
  }
  const longestCashlessMean = cashlessAcc / S;

  // Recovery from deepest drawdown: -2 means no drawdown, -1 "unrecovered" — we
  // compute median / p90 over the recovered-only slice, and report the
  // unrecovered share separately. With no recovered sample there is no time to
  // report: NaN, not 0, which would read as an instant recovery.
  let unrecoveredCount = 0;
  const recoveredOnly: number[] = [];
  for (let s = 0; s < S; s++) {
    const v = recoveryLengths[s];
    if (v === -1) unrecoveredCount++;
    else if (v >= 0) recoveredOnly.push(v);
  }
  recoveredOnly.sort((a, b) => a - b);
  const recoveredCount = recoveredOnly.length;
  const recoveryPct = (p: number) =>
    recoveredCount === 0
      ? Number.NaN
      : recoveredOnly[
          Math.min(
            recoveredCount - 1,
            Math.max(0, Math.floor(p * (recoveredCount - 1))),
          )
        ];
  const recoveryMedian = recoveryPct(0.5);
  const recoveryP90 = recoveryPct(0.9);
  const recoveryUnrecoveredShare = unrecoveredCount / S;
  let recoveryHistogram: { binEdges: number[]; counts: number[] } = { binEdges: [0, 1], counts: [0] };
  if (recoveredCount > 0) {
    const countsByLen = new Int32Array(recoveredOnly[recoveredCount - 1] + 1);
    for (let i = 0; i < recoveredCount; i++) countsByLen[recoveredOnly[i]]++;
    recoveryHistogram = histogramOfLengths(
      countsByLen,
      Math.min(1, recoveredOnly[0]),
      recoveryPct(0.999),
      40,
    );
  }

  return {
    ddMean,
    ddWorst,
    maxDrawdownMedian,
    maxDrawdownP95,
    maxDrawdownP99,
    beMean,
    beStreakMean,
    longestCashlessMean,
    cashlessWorst,
    recoveryMedian,
    recoveryP90,
    recoveryUnrecoveredShare,
    recoveryHistogram,
  };
}

/**
 * The three largest values' sample indices, largest first, an equal value
 * keeping the lower index ahead: the head of a stable descending sort of all
 * S indices, found in one pass.
 */
function topThreeIndices(values: Float64Array, S: number): number[] {
  let i0 = -1;
  let i1 = -1;
  let i2 = -1;
  for (let i = 0; i < S; i++) {
    const v = values[i];
    if (i0 < 0 || v > values[i0]) {
      i2 = i1;
      i1 = i0;
      i0 = i;
    } else if (i1 < 0 || v > values[i1]) {
      i2 = i1;
      i1 = i;
    } else if (i2 < 0 || v > values[i2]) {
      i2 = i;
    }
  }
  const out: number[] = [];
  if (i0 >= 0) out.push(i0);
  if (i1 >= 0) out.push(i1);
  if (i2 >= 0) out.push(i2);
  return out;
}

/**
 * Top-3 samples by max drawdown depth (downswings) and by max run-up height
 * (upswings). Previously we showed the top-10 downswings, but the tail
 * samples clustered very tightly — rank 8-10 differ by a few bucks and add
 * noise without new information. Top-3 keeps the spread meaningful and
 * leaves room for a symmetric upswings table next to it.
 */
export function buildSwingCatalog(
  maxDrawdowns: Float64Array,
  maxRunUps: Float64Array,
  finalProfits: Float64Array,
  longestBreakevens: Float64Array,
  S: number,
  onBuildProgress?: BuildProgressCb,
): {
  downswings: SimulationResult["downswings"];
  upswings: SimulationResult["upswings"];
} {
  onBuildProgress?.(0.88, "streaks");
  const ddIdx = topThreeIndices(maxDrawdowns, S);
  onBuildProgress?.(0.93, "streaks");
  const upIdx = topThreeIndices(maxRunUps, S);
  onBuildProgress?.(0.97, "streaks");
  const downswings = ddIdx.map((sampleIndex, i) => ({
    rank: i + 1,
    sampleIndex,
    depth: maxDrawdowns[sampleIndex],
    finalProfit: finalProfits[sampleIndex],
    longestBreakeven: longestBreakevens[sampleIndex],
  }));
  const upswings = upIdx.map((sampleIndex, i) => ({
    rank: i + 1,
    sampleIndex,
    height: maxRunUps[sampleIndex],
    finalProfit: finalProfits[sampleIndex],
    longestBreakeven: longestBreakevens[sampleIndex],
  }));
  return { downswings, upswings };
}
