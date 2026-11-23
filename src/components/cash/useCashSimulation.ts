"use client";

/**
 * React bridge to the Cash Web Worker pool. Mirrors MTT `useSimulation.ts`:
 * - Uses full-core pool `max(1, min(16, hardwareConcurrency - 2))`
 * - Wraps worker instantiation in try/catch (never stuck in `running: true`)
 * - Streams throttled in-shard progress (`cash-shard-progress`)
 * - Dispatches `cash-build` off the main thread with zero-copy buffer transfers
 * - Tracks `elapsedMs`, ETA rate (`tvs.cashRateMsPerHand.v1`), and completed
 *   `resultInput` snapshot so live edits never reinterpret displayed results.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeCashInput } from "@/lib/sim/cashInput";
import type { CashInput, CashResult } from "@/lib/sim/cashTypes";
import {
  collectCashShardTransfers,
  type CashShard,
} from "@/lib/sim/cashEngine";
import type {
  CashBuildRequest,
  CashShardRequest,
  CashWorkerResponse,
} from "@/lib/sim/cashWorker";
import { workerFailureDetail, type CashRunError } from "./cashRunState";

export type CashRunStatus = "idle" | "running" | "done" | "error";
export type CashRunStage = "simulating" | "building";

const RATE_STORAGE_KEY = "tvs.cashRateMsPerHand.v1";

function cashPoolSize(): number {
  if (typeof navigator === "undefined") return 1;
  const hc = navigator.hardwareConcurrency ?? 4;
  return Math.max(1, Math.min(16, hc - 2));
}

function loadCashRate(): number | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(RATE_STORAGE_KEY);
    if (!raw) return null;
    const v = parseFloat(raw);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function saveCashRate(rate: number): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(RATE_STORAGE_KEY, String(rate));
  } catch {}
}

export function useCashSimulation() {
  const [status, setStatus] = useState<CashRunStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<CashRunStage | null>(null);
  const [result, setResult] = useState<CashResult | null>(null);
  const [resultInput, setResultInput] = useState<CashInput | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [error, setError] = useState<CashRunError | null>(null);
  const [rateMsPerHand, setRateMsPerHand] = useState<number | null>(() =>
    loadCashRate(),
  );

  const jobIdRef = useRef(0);
  const poolRef = useRef<Worker[] | null>(null);
  const poolBusyRef = useRef(false);

  const destroyPool = useCallback(() => {
    const pool = poolRef.current;
    if (!pool) return;
    for (const w of pool) {
      w.onmessage = null;
      w.onerror = null;
      w.onmessageerror = null;
      w.terminate();
    }
    poolRef.current = null;
    poolBusyRef.current = false;
  }, []);

  useEffect(() => {
    return () => {
      destroyPool();
    };
  }, [destroyPool]);

  const estimateMs = useCallback(
    (hands: number, nSimulations: number): number | null => {
      if (rateMsPerHand == null) return null;
      return Math.max(1, hands * nSimulations) * rateMsPerHand;
    },
    [rateMsPerHand],
  );

  const cancel = useCallback(() => {
    jobIdRef.current++;
    destroyPool();
    setStatus("idle");
    setProgress(0);
    setStage(null);
    setError(null);
  }, [destroyPool]);

  const run = useCallback(
    (rawInput: CashInput): CashInput => {
      const snapshot = normalizeCashInput(rawInput);
      if (poolBusyRef.current) {
        destroyPool();
      }
      const jobId = ++jobIdRef.current;
      setStatus("running");
      setProgress(0);
      setStage("simulating");
      setError(null);
      setElapsedMs(null);

      let pool = poolRef.current;
      if (!pool) {
        try {
          const W = cashPoolSize();
          const workers: Worker[] = [];
          for (let i = 0; i < W; i++) {
            workers.push(
              new Worker(new URL("@/lib/sim/cashWorker.ts", import.meta.url), {
                type: "module",
              }),
            );
          }
          poolRef.current = workers;
          pool = workers;
        } catch (err) {
          destroyPool();
          setStatus("error");
          setStage(null);
          setError({
            detail: workerFailureDetail({
              message: err instanceof Error ? err.message : String(err),
            }),
          });
          return snapshot;
        }
      }

      const S = snapshot.nSimulations;
      const W = pool.length;
      const oversub = S >= 5_000 ? 4 : 2;
      const targetShards = Math.max(1, Math.min(S, W * oversub));
      const shardSize = Math.max(1, Math.ceil(S / targetShards));
      const shardRanges: Array<{ sStart: number; sEnd: number }> = [];
      for (let s = 0; s < S; s += shardSize) {
        shardRanges.push({ sStart: s, sEnd: Math.min(S, s + shardSize) });
      }
      const totalShards = shardRanges.length;
      const shards: CashShard[] = new Array(totalShards);
      const shardDone = new Int32Array(totalShards);
      let doneSamples = 0;
      let completedShards = 0;
      let errored = false;
      let lastEmit = 0;
      const t0 = performance.now();

      const cleanupHandlers = () => {
        if (!pool) return;
        for (const w of pool) {
          w.onmessage = null;
          w.onerror = null;
          w.onmessageerror = null;
        }
        poolBusyRef.current = false;
      };

      const failJob = (message: unknown) => {
        if (errored || jobId !== jobIdRef.current) return;
        errored = true;
        cleanupHandlers();
        destroyPool();
        setStatus("error");
        setStage(null);
        setError({ detail: workerFailureDetail({ message }) });
      };

      const onWorkerMessage = (e: MessageEvent<CashWorkerResponse>) => {
        const msg = e.data;
        if (msg.jobId !== jobIdRef.current || errored) return;
        if (msg.type === "cash-shard-error" || msg.type === "cash-build-error") {
          failJob(msg.message);
          return;
        }
        if (msg.type === "cash-shard-progress") {
          const prev = shardDone[msg.shardId];
          if (msg.done > prev) {
            shardDone[msg.shardId] = msg.done;
            doneSamples += msg.done - prev;
            const now = performance.now();
            if (now - lastEmit >= 33) {
              lastEmit = now;
              setProgress(Math.min(0.92, (doneSamples / S) * 0.92));
            }
          }
          return;
        }
        if (msg.type === "cash-shard-result") {
          const range = shardRanges[msg.shardId];
          const rangeLen = range.sEnd - range.sStart;
          const delta = rangeLen - shardDone[msg.shardId];
          if (delta > 0) {
            shardDone[msg.shardId] = rangeLen;
            doneSamples += delta;
          }
          shards[msg.shardId] = msg.shard;
          completedShards++;
          if (completedShards < totalShards) {
            const now = performance.now();
            if (now - lastEmit >= 33) {
              lastEmit = now;
              setProgress(Math.min(0.92, (doneSamples / S) * 0.92));
            }
            return;
          }
          // All shards finished — hand off buildCashResult to worker 0 off main thread.
          setStage("building");
          setProgress(0.94);
          try {
            const transfers: Transferable[] = [];
            for (const sh of shards) {
              transfers.push(...collectCashShardTransfers(sh));
            }
            const buildReq: CashBuildRequest = {
              type: "cash-build",
              jobId,
              input: snapshot,
              shards,
            };
            pool![0].postMessage(buildReq, transfers);
          } catch (err) {
            failJob(err instanceof Error ? err.message : String(err));
          }
          return;
        }
        if (msg.type === "cash-build-result") {
          cleanupHandlers();
          const elapsed = performance.now() - t0;
          const totalWork = Math.max(1, snapshot.hands * snapshot.nSimulations);
          if (elapsed > 40) {
            const observed = elapsed / totalWork;
            const prev = loadCashRate();
            const nextRate =
              prev == null
                ? observed
                : observed > prev * 3 || observed < prev / 3
                  ? prev
                  : prev * 0.4 + observed * 0.6;
            saveCashRate(nextRate);
            setRateMsPerHand(nextRate);
          }
          setResult(msg.result);
          setResultInput(snapshot);
          setElapsedMs(elapsed);
          setProgress(1);
          setStage(null);
          setStatus("done");
        }
      };

      const onWorkerError = (e: Event) => {
        if (jobId !== jobIdRef.current) return;
        failJob((e as Event & { message?: unknown }).message);
      };

      poolBusyRef.current = true;
      for (const w of pool) {
        w.onmessage = onWorkerMessage;
        w.onerror = onWorkerError;
        w.onmessageerror = onWorkerError;
      }

      for (let i = 0; i < totalShards; i++) {
        const worker = pool[i % W];
        const r = shardRanges[i];
        const req: CashShardRequest = {
          type: "cash-shard",
          jobId,
          shardId: i,
          input: snapshot,
          sStart: r.sStart,
          sEnd: r.sEnd,
        };
        worker.postMessage(req);
      }

      return snapshot;
    },
    [destroyPool],
  );

  return {
    status,
    running: status === "running",
    progress,
    stage,
    result,
    resultInput,
    elapsedMs,
    error,
    estimateMs,
    run,
    cancel,
  };
}
