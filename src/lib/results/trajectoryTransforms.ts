import { buildSchedulePassOrder, histogramOf } from "@/lib/sim/engine";
import type { SimulationResult, TournamentRow } from "@/lib/sim/types";

// Expected extra bullets from a geometric re-entry process with cap `maxEntries`
// and unconditional re-entry rate `reRate`. Matches the engine's closed form
// for `reentryExpected` so UI-side rakeback overlays can stay in sync with the
// compiled schedule math.
export function reentryExpectedClient(
  maxEntries: number,
  reRate: number,
): number {
  if (maxEntries <= 1) return 0;
  if (reRate >= 1) return maxEntries - 1;
  if (reRate <= 0) return 0;
  return (reRate * (1 - Math.pow(reRate, maxEntries - 1))) / (1 - reRate);
}

// Deterministic cumulative rakeback curve aligned to `xCheckpoints` (tournament
// indices into the flat schedule). Walks schedule passes in the same weighted
// interleave order as `compileSchedule()`, so heterogeneous schedules don't
// render fake row-batch kinks when the trajectory card toggles RB on/off.
export function computeExpectedRakebackCurve(
  schedule: TournamentRow[],
  scheduleRepeats: number,
  rbFrac: number,
  xCheckpoints: number[],
): Float64Array | null {
  if (rbFrac <= 0 || schedule.length === 0) return null;
  const repeats = Number.isFinite(scheduleRepeats)
    ? Math.max(1, Math.floor(scheduleRepeats))
    : 1;
  const rowCounts: number[] = [];
  const rowRbs: number[] = [];
  let cycleCount = 0;

  for (const row of schedule) {
    const count = Number.isFinite(row.count)
      ? Math.max(1, Math.floor(row.count))
      : 1;
    const maxEntries = Math.max(1, row.maxEntries ?? 1);
    const reRate =
      maxEntries > 1 ? Math.max(0, Math.min(1, row.reentryRate ?? 1)) : 0;
    const expectedBullets = 1 + reentryExpectedClient(maxEntries, reRate);
    const rbPer = rbFrac * row.rake * row.buyIn * expectedBullets;

    rowCounts.push(count);
    rowRbs.push(rbPer);
    cycleCount += count;
  }

  if (cycleCount === 0) return null;

  const passOrder = buildSchedulePassOrder(rowCounts);
  const passPrefix = new Float64Array(cycleCount + 1);
  for (let i = 0; i < cycleCount; i++) {
    passPrefix[i + 1] = passPrefix[i] + rowRbs[passOrder[i]];
  }
  const cycleRb = passPrefix[cycleCount];
  const totalCount = cycleCount * repeats;

  const out = new Float64Array(xCheckpoints.length);
  for (let i = 0; i < xCheckpoints.length; i++) {
    const checkpoint = Number.isFinite(xCheckpoints[i]) ? xCheckpoints[i] : 0;
    const idx = Math.max(0, Math.min(totalCount, Math.floor(checkpoint)));
    const fullCycles = Math.floor(idx / cycleCount);
    const partialCount = idx - fullCycles * cycleCount;
    out[i] = fullCycles * cycleRb + passPrefix[partialCount];
  }
  return out;
}

/**
 * Cumulative BR leaderboard cashflow curve aligned to `xCheckpoints`. The
 * leaderboard pays out at the end of the tracking period, but the promo
 * EV is deterministic in expectation — distributing it linearly across
 * the schedule's tournaments keeps the path / drawdown metrics aware of
 * the side-channel without needing a stochastic LB-tier draw per path.
 *
 * Returns null when there's no LB promo or the EV is zero / negative —
 * caller can short-circuit the shift.
 */
export function computeExpectedLeaderboardCurve(
  expectedPayout: number,
  totalTournaments: number,
  xCheckpoints: number[],
): Float64Array | null {
  if (
    !Number.isFinite(expectedPayout) ||
    expectedPayout <= 0 ||
    totalTournaments <= 0
  ) {
    return null;
  }
  const perTournament = expectedPayout / totalTournaments;
  const out = new Float64Array(xCheckpoints.length);
  for (let i = 0; i < xCheckpoints.length; i++) {
    const checkpoint = Number.isFinite(xCheckpoints[i]) ? xCheckpoints[i] : 0;
    const idx = Math.max(0, Math.min(totalTournaments, checkpoint));
    out[i] = idx * perTournament;
  }
  return out;
}

export function shiftResultByRakeback(
  result: SimulationResult,
  curve: Float64Array,
  sign: 1 | -1,
): SimulationResult {
  // Only profit-path quantities that shift by the deterministic cumulative RB
  // curve are updated here. Path-dependent streak / drawdown / ruin stats stay
  // on the engine's full-sample output; recomputing them from stored hi-res
  // paths would silently downsample to ~1000 runs.
  const shiftArr = (arr: Float64Array): Float64Array => {
    const out = new Float64Array(arr.length);
    const commonLength = Math.min(arr.length, curve.length);
    for (let i = 0; i < commonLength; i++) out[i] = arr[i] + sign * curve[i];
    for (let i = commonLength; i < arr.length; i++) out[i] = arr[i];
    return out;
  };

  const totalShift = sign * curve[curve.length - 1];
  const shiftedHistEdges = result.histogram.binEdges.map((edge) => edge + totalShift);
  const totalCount =
    result.histogram.counts.reduce((sum, count) => sum + count, 0) || 1;
  let cumBelow = 0;

  for (let i = 0; i < result.histogram.counts.length; i++) {
    const lo = shiftedHistEdges[i];
    const hi = shiftedHistEdges[i + 1];
    const count = result.histogram.counts[i];
    if (hi <= 0) {
      cumBelow += count;
    } else if (lo < 0) {
      const frac = (0 - lo) / (hi - lo);
      cumBelow += count * frac;
    }
  }

  const probProfit = Math.max(0, Math.min(1, 1 - cumBelow / totalCount));

  return {
    ...result,
    expectedProfit: result.expectedProfit + totalShift,
    histogram: {
      ...result.histogram,
      binEdges: shiftedHistEdges,
    },
    stats: {
      ...result.stats,
      mean: result.stats.mean + totalShift,
      median: result.stats.median + totalShift,
      min: result.stats.min + totalShift,
      max: result.stats.max + totalShift,
      p01: result.stats.p01 + totalShift,
      p05: result.stats.p05 + totalShift,
      p95: result.stats.p95 + totalShift,
      p99: result.stats.p99 + totalShift,
      probProfit,
      var95: result.stats.var95 - totalShift,
      var99: result.stats.var99 - totalShift,
      cvar95: result.stats.cvar95 - totalShift,
      cvar99: result.stats.cvar99 - totalShift,
    },
    samplePaths: {
      ...result.samplePaths,
      paths: result.samplePaths.paths.map(shiftArr),
      best: shiftArr(result.samplePaths.best),
      worst: shiftArr(result.samplePaths.worst),
    },
    envelopes: {
      ...result.envelopes,
      mean: shiftArr(result.envelopes.mean),
      p05: shiftArr(result.envelopes.p05),
      p95: shiftArr(result.envelopes.p95),
      p15: shiftArr(result.envelopes.p15),
      p85: shiftArr(result.envelopes.p85),
      p025: shiftArr(result.envelopes.p025),
      p975: shiftArr(result.envelopes.p975),
      p0015: shiftArr(result.envelopes.p0015),
      p9985: shiftArr(result.envelopes.p9985),
      min: shiftArr(result.envelopes.min),
      max: shiftArr(result.envelopes.max),
    },
  };
}

export function rebuildEnvelopesFromPaths(
  fallback: SimulationResult["envelopes"],
  paths: Float64Array[],
): SimulationResult["envelopes"] {
  if (paths.length === 0) return fallback;

  const len = fallback.x.length;
  const mean = new Float64Array(len);
  const p05 = new Float64Array(len);
  const p95 = new Float64Array(len);
  const p15 = new Float64Array(len);
  const p85 = new Float64Array(len);
  const p025 = new Float64Array(len);
  const p975 = new Float64Array(len);
  const p0015 = new Float64Array(len);
  const p9985 = new Float64Array(len);
  const min = new Float64Array(len);
  const max = new Float64Array(len);
  const scratch = new Float64Array(paths.length);
  const lastIdx = Math.max(0, paths.length - 1);
  const pick = (q: number) => {
    const pos = q * lastIdx;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return scratch[lo];
    const w = pos - lo;
    return scratch[lo] + (scratch[hi] - scratch[lo]) * w;
  };

  for (let t = 0; t < len; t++) {
    let sum = 0;
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      const value =
        t < path.length ? path[t] : path.length > 0 ? path[path.length - 1] : 0;
      scratch[i] = value;
      sum += value;
    }
    scratch.sort();
    mean[t] = sum / paths.length;
    min[t] = scratch[0];
    max[t] = scratch[scratch.length - 1];
    p0015[t] = pick(0.0015);
    p025[t] = pick(0.025);
    p05[t] = pick(0.05);
    p15[t] = pick(0.15);
    p85[t] = pick(0.85);
    p95[t] = pick(0.95);
    p975[t] = pick(0.975);
    p9985[t] = pick(0.9985);
  }

  return {
    ...fallback,
    mean,
    p05,
    p95,
    p15,
    p85,
    p025,
    p975,
    p0015,
    p9985,
    min,
    max,
  };
}

// Strip samples flagged in `jackpotMask` from the scale-sensitive fields that
// drive path and histogram views. Best/worst paths are reselected from the
// remaining stored paths so the chart does not keep the removed jackpot curve
// as its visible extreme marker.
export function stripJackpots(result: SimulationResult): SimulationResult {
  const mask = result.jackpotMask;
  if (!mask || mask.length === 0) return result;

  const keepFinal: number[] = [];
  for (let i = 0; i < mask.length; i++) if (!mask[i]) keepFinal.push(i);
  if (keepFinal.length === mask.length) return result;

  const filteredFinal = new Float64Array(keepFinal.length);
  for (let i = 0; i < keepFinal.length; i++) {
    filteredFinal[i] = result.finalProfits[keepFinal[i]];
  }

  const histogram = histogramOf(filteredFinal, 60, false, true);
  const keptPaths: Float64Array[] = [];
  const keptSampleIndices: number[] = [];

  for (let i = 0; i < result.samplePaths.sampleIndices.length; i++) {
    const globalIdx = result.samplePaths.sampleIndices[i];
    if (!mask[globalIdx]) {
      keptPaths.push(result.samplePaths.paths[i]);
      keptSampleIndices.push(globalIdx);
    }
  }

  let best = result.samplePaths.best;
  let worst = result.samplePaths.worst;
  if (keptPaths.length > 0) {
    let bestValue = -Infinity;
    let worstValue = Infinity;
    let bestIdx = 0;
    let worstIdx = 0;
    for (let i = 0; i < keptPaths.length; i++) {
      const path = keptPaths[i];
      const value = path.length > 0 ? path[path.length - 1] : 0;
      if (value > bestValue) {
        bestValue = value;
        bestIdx = i;
      }
      if (value < worstValue) {
        worstValue = value;
        worstIdx = i;
      }
    }
    best = keptPaths[bestIdx];
    worst = keptPaths[worstIdx];
  }

  const envelopes = rebuildEnvelopesFromPaths(result.envelopes, keptPaths);
  return {
    ...result,
    finalProfits: filteredFinal,
    histogram,
    envelopes,
    samplePaths: {
      ...result.samplePaths,
      paths: keptPaths,
      sampleIndices: keptSampleIndices,
      best,
      worst,
    },
  };
}
