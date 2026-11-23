/**
 * Post-run rakeback view shift for CashResult.
 *
 * Since cash rakeback accrues linearly (`rbPerHand = meanRbEarnedBb / hands`),
 * toggling "Include rakeback" OFF in CashResultsView shifts EV, trajectories,
 * envelopes, final bankroll distribution, and profit odds in ~1 ms without
 * re-running Monte Carlo. Drawdowns and streak lengths stay as simulated
 * (since RB changes trough/peak timing nonlinearly), mirroring MTT's
 * `shiftResultByRakeback` in `trajectoryTransforms.ts`.
 */
import { selectQuantilesFromCopy } from "@/lib/sim/orderStatistics";
import type { CashEnvelopes, CashResult } from "@/lib/sim/cashTypes";

function shiftArrayLinear(
  arr: Float64Array,
  x: Int32Array,
  deltaPerHand: number,
): Float64Array {
  const out = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    out[i] = arr[i] + x[i] * deltaPerHand;
  }
  return out;
}

function shiftEnvelopes(
  env: CashEnvelopes,
  deltaPerHand: number,
): CashEnvelopes {
  return {
    x: env.x,
    mean: shiftArrayLinear(env.mean, env.x, deltaPerHand),
    p05: shiftArrayLinear(env.p05, env.x, deltaPerHand),
    p95: shiftArrayLinear(env.p95, env.x, deltaPerHand),
    p15: shiftArrayLinear(env.p15, env.x, deltaPerHand),
    p85: shiftArrayLinear(env.p85, env.x, deltaPerHand),
    p025: shiftArrayLinear(env.p025, env.x, deltaPerHand),
    p975: shiftArrayLinear(env.p975, env.x, deltaPerHand),
    min: shiftArrayLinear(env.min, env.x, deltaPerHand),
    max: shiftArrayLinear(env.max, env.x, deltaPerHand),
  };
}

export function shiftCashResultByRakeback(
  result: CashResult,
  includeRakeback: boolean,
): CashResult {
  const rbTotal = result.stats.meanRbEarnedBb;
  if (includeRakeback || rbTotal <= 0) return result;
  const hands = Math.max(1, result.echoInput.hands);
  const deltaPerHand = -rbTotal / hands;
  const deltaTotal = -rbTotal;
  const S = result.samples;

  const finalBb = new Float64Array(S);
  let profitCount = 0;
  let lossCount = 0;
  for (let i = 0; i < S; i++) {
    const v = result.finalBb[i] + deltaTotal;
    finalBb[i] = v;
    if (v > 0) profitCount++;
    if (v < 0) lossCount++;
  }

  const qRank = (p: number) =>
    Math.min(S - 1, Math.max(0, Math.floor(p * (S - 1))));
  const picked = selectQuantilesFromCopy(
    finalBb,
    Int32Array.from([
      0,
      qRank(0.01),
      qRank(0.05),
      qRank(0.5),
      qRank(0.95),
      qRank(0.99),
      S - 1,
    ]),
  );

  const expectedEvBb = result.stats.expectedEvBb + deltaTotal;
  const bb = result.echoInput.bbSize;
  const expectedEvUsd = expectedEvBb * bb;
  const meanFinalBb = result.stats.meanFinalBb + deltaTotal;
  const meanFinalUsd = meanFinalBb * bb;
  const hourlyEvUsd = result.echoInput.hoursBlock
    ? (expectedEvUsd / hands) * result.echoInput.hoursBlock.handsPerHour
    : undefined;

  // Shift histogram bin edges directly (all points shifted by constant deltaTotal).
  const histogram = {
    binEdges: result.histogram.binEdges.map((edge) => edge + deltaTotal),
    counts: result.histogram.counts,
  };

  const xHi = result.samplePaths.x;
  const samplePaths = {
    ...result.samplePaths,
    paths: result.samplePaths.paths.map((p) =>
      shiftArrayLinear(p, xHi, deltaPerHand),
    ),
    best: shiftArrayLinear(result.samplePaths.best, xHi, deltaPerHand),
    worst: shiftArrayLinear(result.samplePaths.worst, xHi, deltaPerHand),
    realBestPath: shiftArrayLinear(
      result.samplePaths.realBestPath,
      xHi,
      deltaPerHand,
    ),
    realWorstPath: shiftArrayLinear(
      result.samplePaths.realWorstPath,
      xHi,
      deltaPerHand,
    ),
    hiResMin: shiftArrayLinear(result.samplePaths.hiResMin, xHi, deltaPerHand),
    hiResMax: shiftArrayLinear(result.samplePaths.hiResMax, xHi, deltaPerHand),
  };

  const envelopes = shiftEnvelopes(result.envelopes, deltaPerHand);
  const hiResEnvelopes = shiftEnvelopes(result.hiResEnvelopes, deltaPerHand);
  const effectiveWrBb100 = (expectedEvBb / hands) * 100;

  return {
    ...result,
    finalBb,
    histogram,
    samplePaths,
    envelopes,
    hiResEnvelopes,
    stats: {
      ...result.stats,
      expectedEvBb,
      expectedEvUsd,
      meanFinalBb,
      meanFinalUsd,
      finalBbMin: picked[0],
      finalBbP01: picked[1],
      finalBbP05: picked[2],
      finalBbMedian: picked[3],
      finalBbP95: picked[4],
      finalBbP99: picked[5],
      finalBbMax: picked[6],
      effectiveWrBb100,
      probProfit: profitCount / S,
      probLoss: lossCount / S,
      var95Bb: -picked[2],
      cvar95Bb: result.stats.cvar95Bb - deltaTotal,
      sharpe:
        result.stats.sdFinalBb > 0 ? meanFinalBb / result.stats.sdFinalBb : 0,
      hourlyEvUsd,
    },
  };
}
