/**
 * Core Monte Carlo engine. Runs inside Web Workers (see `worker.ts`), never
 * on the main thread. The public surface is small — `compileSchedule`,
 * `simulateShard`, `mergeShards`, `buildResult` — and is orchestrated by
 * `useSimulation.ts` on the UI side.
 *
 * Determinism contract: `SimulationInput + seed → byte-identical
 * SimulationResult` regardless of worker pool size or shard dispatch order.
 * Enforced by `engine.test.ts`. No `Math.random`, no `Date.now`, no wall
 * clock. Only `mulberry32` seeded via `mixSeed(seed, sampleIdx)` — each
 * stochastic channel uses its own XOR-offset of the seed — where
 * `sampleIdx` is the GLOBAL index in `[0, samples)`.
 *
 * Hot loop allocation rule: no `new Float64Array(...)` inside the per-sample
 * inner loop. All scratch buffers are preallocated per shard and reused.
 *
 * See `docs/ARCHITECTURE.md` for data flow, hot-loop shape, and storage.
 */
import { compileSchedule } from "./compile";
import { makeCheckpointGrid } from "./grids";
import { simulateShard, type ProgressCb } from "./hotLoop";
import { buildResult } from "./buildResult";
import type { RawShard } from "./engineTypes";
import type {
  CalibrationMode,
  SimulationInput,
  SimulationResult,
} from "./types";

// `engine.ts` is now a thin orchestrator (runSimulation + mergeShards). It
// re-exports the public surface from the sibling modules so existing
// importers — the worker, useSimulation, convergence math, trajectory
// transforms, tests — keep their `./engine` import path unchanged.
export { compileSchedule } from "./compile";
export {
  buildSchedulePassOrder,
  buildScheduleAnalyticBreakdown,
} from "./compile";
export { histogramOf, poissonPTRS } from "./simNumerics";
export { JACKPOT_THRESHOLD } from "./engineConstants";
export { makeCheckpointGrid, makeHiResGrid } from "./grids";
export { simulateShard } from "./hotLoop";
export type { ProgressCb } from "./hotLoop";
export { buildResult } from "./buildResult";
export type { BuildStage } from "./buildResult";
export type {
  CheckpointGrid,
  RawShard,
  ScheduleAnalyticBreakdown,
  ScheduleAnalyticRow,
} from "./engineTypes";

// =====================================================================
// Top-level entry: runSimulation + buildResult
// ---------------------------------------------------------------------
// `runSimulation` is the synchronous entry point used by the worker
// pool. It compiles the schedule, runs the sharded hot loop in-process
// (workers wrap this with their own dispatch), then calls `buildResult`
// to assemble the SimulationResult that React consumes.
//
// `buildResult` does post-processing only — percentile envelopes,
// downswing catalog, row decomposition, risk-of-ruin integration,
// convergence curves. No new RNG draws, no calibration. Pure.
// =====================================================================

export function runSimulation(
  input: SimulationInput,
  onProgress?: ProgressCb,
): SimulationResult {
  const calibrationMode: CalibrationMode =
    input.calibrationMode ?? "alpha";

  const compiled = compileSchedule(input, calibrationMode);
  const N = compiled.tournamentsPerSample;
  const S = input.samples;

  if (N === 0 || S === 0) throw new Error("Empty schedule or zero samples");

  const grid = makeCheckpointGrid(N);
  const shard = simulateShard(input, compiled, 0, S, grid, onProgress);
  return buildResult(input, compiled, shard, calibrationMode, grid);
}

/**
 * Stitch disjoint shards covering [0, S) into a single RawShard with
 * full-sized buffers. Fast-paths a single full-range shard by returning
 * it directly (no copies).
 */
export function mergeShards(
  shards: RawShard[],
  S: number,
  K1: number,
  numRows: number,
): RawShard {
  if (
    shards.length === 1 &&
    shards[0].sStart === 0 &&
    shards[0].sEnd === S
  ) {
    return shards[0];
  }
  const sorted = shards.slice().sort((a, b) => a.sStart - b.sStart);
  const finalProfits = new Float64Array(S);
  const pathMatrix = new Float64Array(S * K1);
  const maxDrawdowns = new Float64Array(S);
  const maxRunUps = new Float64Array(S);
  const runningMins = new Float64Array(S);
  const longestBreakevens = new Float64Array(S);
  const breakevenStreakAvgs = new Float64Array(S);
  const longestCashless = new Int32Array(S);
  const recoveryLengths = new Int32Array(S);
  const rowProfits = new Float64Array(S * numRows);
  const rowBountyProfits = new Float64Array(S * numRows);
  const jackpotMask = new Uint8Array(S);
  const hasLeaderboard = sorted[0].leaderboardPoints !== null;
  const leaderboardPoints = hasLeaderboard ? new Float64Array(S) : null;
  const leaderboardPayouts = hasLeaderboard ? new Float64Array(S) : null;
  const leaderboardExpectedPayouts = hasLeaderboard
    ? new Float64Array(S)
    : null;
  const leaderboardWindows = hasLeaderboard ? new Int32Array(S) : null;
  const leaderboardPaidWindows = hasLeaderboard ? new Int32Array(S) : null;
  const leaderboardRankSums = hasLeaderboard ? new Int32Array(S) : null;
  const leaderboardKnockouts = hasLeaderboard ? new Int32Array(S) : null;
  const leaderboardFirsts = hasLeaderboard ? new Int32Array(S) : null;
  const leaderboardSeconds = hasLeaderboard ? new Int32Array(S) : null;
  const leaderboardThirds = hasLeaderboard ? new Int32Array(S) : null;
  const beCountsLen = sorted[0].breakevenStreakCounts.length;
  const clCountsLen = sorted[0].cashlessStreakCounts.length;
  const breakevenStreakCounts = new Int32Array(beCountsLen);
  const cashlessStreakCounts = new Int32Array(clCountsLen);
  let ruinedCount = 0;
  for (const sh of sorted) {
    finalProfits.set(sh.finalProfits, sh.sStart);
    maxDrawdowns.set(sh.maxDrawdowns, sh.sStart);
    maxRunUps.set(sh.maxRunUps, sh.sStart);
    runningMins.set(sh.runningMins, sh.sStart);
    longestBreakevens.set(sh.longestBreakevens, sh.sStart);
    breakevenStreakAvgs.set(sh.breakevenStreakAvgs, sh.sStart);
    longestCashless.set(sh.longestCashless, sh.sStart);
    recoveryLengths.set(sh.recoveryLengths, sh.sStart);
    pathMatrix.set(sh.pathMatrix, sh.sStart * K1);
    rowProfits.set(sh.rowProfits, sh.sStart * numRows);
    rowBountyProfits.set(sh.rowBountyProfits, sh.sStart * numRows);
    jackpotMask.set(sh.jackpotMask, sh.sStart);
    if (leaderboardPoints !== null && sh.leaderboardPoints !== null) {
      leaderboardPoints.set(sh.leaderboardPoints, sh.sStart);
      leaderboardPayouts!.set(sh.leaderboardPayouts!, sh.sStart);
      leaderboardExpectedPayouts!.set(
        sh.leaderboardExpectedPayouts!,
        sh.sStart,
      );
      leaderboardWindows!.set(sh.leaderboardWindows!, sh.sStart);
      leaderboardPaidWindows!.set(sh.leaderboardPaidWindows!, sh.sStart);
      leaderboardRankSums!.set(sh.leaderboardRankSums!, sh.sStart);
      leaderboardKnockouts!.set(sh.leaderboardKnockouts!, sh.sStart);
      leaderboardFirsts!.set(sh.leaderboardFirsts!, sh.sStart);
      leaderboardSeconds!.set(sh.leaderboardSeconds!, sh.sStart);
      leaderboardThirds!.set(sh.leaderboardThirds!, sh.sStart);
    }
    for (let i = 0; i < beCountsLen; i++) {
      breakevenStreakCounts[i] += sh.breakevenStreakCounts[i];
    }
    for (let i = 0; i < clCountsLen; i++) {
      cashlessStreakCounts[i] += sh.cashlessStreakCounts[i];
    }
    ruinedCount += sh.ruinedCount;
  }
  // Hi-res aggregation: concatenate per-shard hiResPaths in sStart order so
  // the slider exposes the union of each shard's budget (not just shard 0).
  // Global best/worst are still picked by scanning per-shard extrema.
  const leading = sorted[0];
  const hiResCheckpointIdx = leading.hiResCheckpointIdx;
  const hiResPaths: Float64Array[] = [];
  const hiResSampleIndices: number[] = [];
  for (const sh of sorted) {
    for (let i = 0; i < sh.hiResPaths.length; i++) {
      hiResPaths.push(sh.hiResPaths[i]);
      hiResSampleIndices.push(sh.hiResSampleIndices[i]);
    }
  }
  let bestShard = leading;
  let worstShard = leading;
  for (const sh of sorted) {
    if (sh.hiResBestFinal > bestShard.hiResBestFinal) bestShard = sh;
    if (sh.hiResWorstFinal < worstShard.hiResWorstFinal) worstShard = sh;
  }
  // Pointwise min/max across shards.
  const mergedHiResMin = new Float64Array(leading.hiResMin.length);
  const mergedHiResMax = new Float64Array(leading.hiResMax.length);
  mergedHiResMin.set(leading.hiResMin);
  mergedHiResMax.set(leading.hiResMax);
  for (let i = 1; i < sorted.length; i++) {
    const mn = sorted[i].hiResMin;
    const mx = sorted[i].hiResMax;
    for (let j = 0; j < mergedHiResMin.length; j++) {
      if (mn[j] < mergedHiResMin[j]) mergedHiResMin[j] = mn[j];
      if (mx[j] > mergedHiResMax[j]) mergedHiResMax[j] = mx[j];
    }
  }
  return {
    sStart: 0,
    sEnd: S,
    finalProfits,
    pathMatrix,
    maxDrawdowns,
    maxRunUps,
    runningMins,
    longestBreakevens,
    breakevenStreakAvgs,
    longestCashless,
    recoveryLengths,
    breakevenStreakCounts,
    cashlessStreakCounts,
    rowProfits,
    rowBountyProfits,
    jackpotMask,
    leaderboardPoints,
    leaderboardPayouts,
    leaderboardExpectedPayouts,
    leaderboardWindows,
    leaderboardPaidWindows,
    leaderboardRankSums,
    leaderboardKnockouts,
    leaderboardFirsts,
    leaderboardSeconds,
    leaderboardThirds,
    ruinedCount,
    hiResCheckpointIdx,
    hiResPaths,
    hiResSampleIndices: Int32Array.from(hiResSampleIndices),
    hiResBestPath: bestShard.hiResBestPath,
    hiResWorstPath: worstShard.hiResWorstPath,
    hiResBestFinal: bestShard.hiResBestFinal,
    hiResWorstFinal: worstShard.hiResWorstFinal,
    hiResMin: mergedHiResMin,
    hiResMax: mergedHiResMax,
  };
}
