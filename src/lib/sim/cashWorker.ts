/// <reference lib="webworker" />
/**
 * Cash-mode worker. Handles both shard simulation (`cash-shard`, with in-shard
 * progress ticks and zero-copy buffer transfers) and final result assembly
 * (`cash-build`, keeping envelope selection and histograms off the main thread).
 */
import {
  buildCashResult,
  collectCashShardTransfers,
  makeCashEnvGrid,
  makeCashHiResGrid,
  simulateCashShard,
  type CashShard,
} from "./cashEngine";
import type { CashInput, CashResult } from "./cashTypes";

declare const self: DedicatedWorkerGlobalScope;

export interface CashShardRequest {
  type: "cash-shard";
  jobId: number;
  shardId: number;
  input: CashInput;
  sStart: number;
  sEnd: number;
}

export interface CashBuildRequest {
  type: "cash-build";
  jobId: number;
  input: CashInput;
  shards: CashShard[];
}

export interface CashShardProgressMsg {
  type: "cash-shard-progress";
  jobId: number;
  shardId: number;
  done: number;
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

export interface CashBuildResultMsg {
  type: "cash-build-result";
  jobId: number;
  result: CashResult;
}

export interface CashBuildErrorMsg {
  type: "cash-build-error";
  jobId: number;
  message: string;
}

export type CashWorkerRequest = CashShardRequest | CashBuildRequest;
export type CashWorkerResponse =
  | CashShardProgressMsg
  | CashShardResultMsg
  | CashShardErrorMsg
  | CashBuildResultMsg
  | CashBuildErrorMsg;

function collectCashResultTransfers(r: CashResult): Transferable[] {
  const seen = new Set<ArrayBufferLike>();
  const out: Transferable[] = [];
  const push = (buf: ArrayBufferLike) => {
    if (seen.has(buf)) return;
    seen.add(buf);
    out.push(buf as Transferable);
  };
  push(r.finalBb.buffer);
  push(r.samplePaths.x.buffer);
  push(r.samplePaths.maxDrawdownBb.buffer);
  push(r.samplePaths.longestBelowPeakHands.buffer);
  push(r.samplePaths.best.buffer);
  push(r.samplePaths.worst.buffer);
  push(r.samplePaths.realBestPath.buffer);
  push(r.samplePaths.realWorstPath.buffer);
  push(r.samplePaths.hiResMin.buffer);
  push(r.samplePaths.hiResMax.buffer);
  for (const p of r.samplePaths.paths) push(p.buffer);
  for (const arr of Object.values(r.envelopes)) push(arr.buffer);
  for (const arr of Object.values(r.hiResEnvelopes)) push(arr.buffer);
  push(r.oddsOverDistance.x.buffer);
  push(r.oddsOverDistance.profitShare.buffer);
  push(r.oddsOverDistance.belowThresholdNowShare.buffer);
  push(r.convergence.x.buffer);
  push(r.convergence.mean.buffer);
  push(r.convergence.seLo.buffer);
  push(r.convergence.seHi.buffer);
  return out;
}

self.onmessage = (e: MessageEvent<CashWorkerRequest>) => {
  const req = e.data;
  if (req.type === "cash-shard") {
    try {
      const envGrid = makeCashEnvGrid(req.input.hands);
      const hiResGrid = makeCashHiResGrid(req.input.hands);
      const shard = simulateCashShard(
        req.input,
        req.sStart,
        req.sEnd,
        envGrid,
        hiResGrid,
        (done) => {
          const prog: CashShardProgressMsg = {
            type: "cash-shard-progress",
            jobId: req.jobId,
            shardId: req.shardId,
            done,
          };
          self.postMessage(prog);
        },
      );
      const msg: CashShardResultMsg = {
        type: "cash-shard-result",
        jobId: req.jobId,
        shardId: req.shardId,
        shard,
      };
      self.postMessage(msg, collectCashShardTransfers(shard));
    } catch (err) {
      const msg: CashShardErrorMsg = {
        type: "cash-shard-error",
        jobId: req.jobId,
        shardId: req.shardId,
        message: err instanceof Error ? err.message : String(err),
      };
      self.postMessage(msg);
    }
    return;
  }

  if (req.type === "cash-build") {
    try {
      const envGrid = makeCashEnvGrid(req.input.hands);
      const result = buildCashResult(req.input, req.shards, envGrid);
      const msg: CashBuildResultMsg = {
        type: "cash-build-result",
        jobId: req.jobId,
        result,
      };
      self.postMessage(msg, collectCashResultTransfers(result));
    } catch (err) {
      const msg: CashBuildErrorMsg = {
        type: "cash-build-error",
        jobId: req.jobId,
        message: err instanceof Error ? err.message : String(err),
      };
      self.postMessage(msg);
    }
  }
};

export {};
