/// <reference lib="webworker" />
import {
  buildResult,
  compileSchedule,
  makeCheckpointGrid,
  mergeShards,
  simulateShard,
} from "./engine";
import type { CalibrationMode, SimulationInput, SimulationResult } from "./types";
import type { RawShard } from "./engine";

declare const self: DedicatedWorkerGlobalScope;

/**
 * Shard request — main thread asks this worker to run [sStart, sEnd)
 * for a given SimulationInput + calibration mode. Workers are stateless
 * between requests; the pool is owned by the main thread.
 */
export interface ShardRequest {
  type: "shard";
  jobId: number;
  shardId: number;
  input: SimulationInput;
  calibrationMode: CalibrationMode;
  sStart: number;
  sEnd: number;
}

export interface ShardProgressMsg {
  type: "shard-progress";
  jobId: number;
  shardId: number;
  done: number;
  total: number;
}

export interface ShardResultMsg {
  type: "shard-result";
  jobId: number;
  shardId: number;
  shard: RawShard;
  grid: { K: number; checkpointIdx: Int32Array };
}

export interface ShardErrorMsg {
  type: "shard-error";
  jobId: number;
  shardId: number;
  message: string;
}

/**
 * Request to merge raw shards and build the final SimulationResult entirely
 * inside the worker — keeps the expensive envelope sorts / histograms off
 * the main thread so the UI never freezes at 100%.
 */
export interface BuildRequest {
  type: "build";
  jobId: number;
  buildId: number;
  input: SimulationInput;
  calibrationMode: CalibrationMode;
  shards: RawShard[];
}

export interface BuildResultMsg {
  type: "build-result";
  jobId: number;
  buildId: number;
  result: SimulationResult;
}

export interface BuildErrorMsg {
  type: "build-error";
  jobId: number;
  buildId: number;
  message: string;
}

/**
 * Walk a SimulationResult and return every ArrayBuffer backing a typed
 * array. Used as the transfer list on the return trip so the main thread
 * gets zero-copy handoff of multi-MB buffers (finalProfits, envelopes,
 * convergence lines, sample paths).
 */
function collectResultTransfers(r: SimulationResult): Transferable[] {
  const out: Transferable[] = [];
  out.push(r.finalProfits.buffer);
  out.push(r.rowProfits.buffer);
  out.push(r.samplePaths.best.buffer);
  out.push(r.samplePaths.worst.buffer);
  for (const p of r.samplePaths.paths) out.push(p.buffer);
  out.push(r.envelopes.mean.buffer);
  out.push(r.envelopes.p05.buffer);
  out.push(r.envelopes.p95.buffer);
  out.push(r.envelopes.p15.buffer);
  out.push(r.envelopes.p85.buffer);
  out.push(r.envelopes.p025.buffer);
  out.push(r.envelopes.p975.buffer);
  out.push(r.envelopes.p0015.buffer);
  out.push(r.envelopes.p9985.buffer);
  out.push(r.convergence.mean.buffer);
  out.push(r.convergence.seLo.buffer);
  out.push(r.convergence.seHi.buffer);
  return out;
}

function collectShardTransfers(shard: RawShard): Transferable[] {
  const out: Transferable[] = [
    shard.finalProfits.buffer,
    shard.pathMatrix.buffer,
    shard.maxDrawdowns.buffer,
    shard.maxRunUps.buffer,
    shard.runningMins.buffer,
    shard.longestBreakevens.buffer,
    shard.longestCashless.buffer,
    shard.recoveryLengths.buffer,
    shard.breakevenStreakCounts.buffer,
    shard.cashlessStreakCounts.buffer,
    shard.rowProfits.buffer,
    shard.hiResCheckpointIdx.buffer,
    shard.hiResBestPath.buffer,
    shard.hiResWorstPath.buffer,
  ];
  for (const p of shard.hiResPaths) out.push(p.buffer);
  return out;
}

self.onmessage = (e: MessageEvent<ShardRequest | BuildRequest>) => {
  const req = e.data;
  if (req.type === "build") {
    handleBuild(req);
    return;
  }
  if (req.type !== "shard") return;
  const { jobId, shardId, input, calibrationMode, sStart, sEnd } = req;
  try {
    const compiled = compileSchedule({ ...input, calibrationMode }, calibrationMode);
    const grid = makeCheckpointGrid(compiled.tournamentsPerSample);

    const shard = simulateShard(
      { ...input, calibrationMode },
      compiled,
      sStart,
      sEnd,
      grid,
      (done, total) => {
        const msg: ShardProgressMsg = {
          type: "shard-progress",
          jobId,
          shardId,
          done,
          total,
        };
        self.postMessage(msg);
      },
    );

    const result: ShardResultMsg = {
      type: "shard-result",
      jobId,
      shardId,
      shard,
      grid: { K: grid.K, checkpointIdx: grid.checkpointIdx },
    };
    const transfers = collectShardTransfers(shard);
    // Note: grid.checkpointIdx is Int32Array but we do NOT transfer it —
    // the worker keeps using grid internally, and main thread reconstructs
    // the K from the result. Transferring it twice would detach in one place
    // and cause an AccessError the next time the worker processes a shard.
    self.postMessage(result, transfers);
  } catch (err) {
    const msg: ShardErrorMsg = {
      type: "shard-error",
      jobId,
      shardId,
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(msg);
  }
};

function handleBuild(req: BuildRequest) {
  const { jobId, buildId, input, calibrationMode, shards } = req;
  try {
    const compiled = compileSchedule({ ...input, calibrationMode }, calibrationMode);
    const grid = makeCheckpointGrid(compiled.tournamentsPerSample);
    const K1 = grid.K + 1;
    const merged = mergeShards(shards, input.samples, K1, input.schedule.length);
    const result = buildResult(
      { ...input, calibrationMode },
      compiled,
      merged,
      calibrationMode,
      grid,
    );
    const msg: BuildResultMsg = {
      type: "build-result",
      jobId,
      buildId,
      result,
    };
    const transfers = collectResultTransfers(result);
    self.postMessage(msg, transfers);
  } catch (err) {
    const msg: BuildErrorMsg = {
      type: "build-error",
      jobId,
      buildId,
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(msg);
  }
}

export {};
