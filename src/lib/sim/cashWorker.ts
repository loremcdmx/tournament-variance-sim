/// <reference lib="webworker" />
/**
 * Cash-mode worker. One-request-at-a-time: receives a slice of samples to
 * simulate, runs the pure engine, posts the shard back with zero-copy
 * transfer of typed-array buffers. No schedule compile, no build pass —
 * the main thread merges shards via `buildCashResult`.
 */
import {
  simulateCashShard,
  type CashShard,
  type CashCheckpointGrid,
} from "./cashEngine";
import type { CashInput } from "./cashTypes";

declare const self: DedicatedWorkerGlobalScope;

export interface CashShardRequest {
  type: "cash-shard";
  jobId: number;
  shardId: number;
  input: CashInput;
  sStart: number;
  sEnd: number;
  envGrid: { K: number; checkpointIdx: Int32Array };
  hiResGrid: { K: number; checkpointIdx: Int32Array };
}

export interface CashShardResultMsg {
  type: "cash-shard-result";
  jobId: number;
  shardId: number;
  shard: CashShard;
}

export interface CashShardErrorMsg {
  type: "cash-shard-error";
  jobId: number;
  shardId: number;
  message: string;
}

function collectShardTransfers(shard: CashShard): Transferable[] {
  const out: Transferable[] = [
    shard.finalBb.buffer,
    shard.maxDrawdownBb.buffer,
    shard.longestBreakevenHands.buffer,
    shard.recoveryHands.buffer,
    shard.hitSub100.buffer,
    shard.envMatrix.buffer,
    shard.hiResBestPath.buffer,
    shard.hiResWorstPath.buffer,
  ];
  for (const p of shard.hiResPaths) out.push(p.buffer);
  // hiCheckpointIdx is the shared env grid — do NOT transfer; main thread
  // reconstructs it from the request.
  return out;
}

self.onmessage = (e: MessageEvent<CashShardRequest>) => {
  const req = e.data;
  if (req.type !== "cash-shard") return;
  try {
    const envGrid: CashCheckpointGrid = {
      K: req.envGrid.K,
      checkpointIdx: req.envGrid.checkpointIdx,
    };
    const hiResGrid: CashCheckpointGrid = {
      K: req.hiResGrid.K,
      checkpointIdx: req.hiResGrid.checkpointIdx,
    };
    const shard = simulateCashShard(
      req.input,
      req.sStart,
      req.sEnd,
      envGrid,
      hiResGrid,
    );
    const msg: CashShardResultMsg = {
      type: "cash-shard-result",
      jobId: req.jobId,
      shardId: req.shardId,
      shard,
    };
    self.postMessage(msg, collectShardTransfers(shard));
  } catch (err) {
    const msg: CashShardErrorMsg = {
      type: "cash-shard-error",
      jobId: req.jobId,
      shardId: req.shardId,
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(msg);
  }
};

export {};
