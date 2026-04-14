/// <reference lib="webworker" />
import { compileSchedule, makeCheckpointGrid, simulateShard } from "./engine";
import type { CalibrationMode, SimulationInput } from "./types";
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

function collectShardTransfers(shard: RawShard): Transferable[] {
  return [
    shard.finalProfits.buffer,
    shard.pathMatrix.buffer,
    shard.maxDrawdowns.buffer,
    shard.runningMins.buffer,
    shard.longestBreakevens.buffer,
    shard.longestCashless.buffer,
    shard.recoveryLengths.buffer,
    shard.rowProfits.buffer,
  ];
}

self.onmessage = (e: MessageEvent<ShardRequest>) => {
  const req = e.data;
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
    transfers.push(grid.checkpointIdx.buffer);
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

export {};
