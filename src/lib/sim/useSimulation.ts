"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildResult,
  compileSchedule,
  makeCheckpointGrid,
  mergeShards,
} from "./engine";
import type { RawShard } from "./engine";
import type {
  CalibrationMode,
  SimulationInput,
  SimulationResult,
} from "./types";
import type {
  ShardErrorMsg,
  ShardProgressMsg,
  ShardRequest,
  ShardResultMsg,
} from "./worker";

type Status = "idle" | "running" | "done" | "error";

function poolSize(): number {
  if (typeof navigator === "undefined") return 1;
  const hc = navigator.hardwareConcurrency ?? 4;
  // Use ~half of logical threads — keeps SMT siblings free for the OS,
  // browser UI thread, and other apps. Avoids saturating cores.
  return Math.max(1, Math.min(16, Math.floor(hc / 2)));
}

interface Pool {
  workers: Worker[];
}

function spawnPool(): Pool {
  const W = poolSize();
  const workers: Worker[] = [];
  for (let i = 0; i < W; i++) {
    workers.push(
      new Worker(new URL("./worker.ts", import.meta.url), {
        type: "module",
      }),
    );
  }
  return { workers };
}

interface PassPlan {
  key: "primary" | "comparison";
  input: SimulationInput;
  calibrationMode: CalibrationMode;
  weight: number; // share of total progress (sums to 1 across passes)
}

interface ShardSlot {
  passKey: PassPlan["key"];
  shardId: number; // unique across both passes
  workerIdx: number;
  sStart: number;
  sEnd: number;
  total: number;
  done: number;
}

export function useSimulation() {
  const poolRef = useRef<Pool | null>(null);
  const jobIdRef = useRef(0);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  useEffect(() => {
    poolRef.current = spawnPool();
    return () => {
      const p = poolRef.current;
      if (p) for (const w of p.workers) w.terminate();
      poolRef.current = null;
    };
  }, []);

  const cancel = useCallback(() => {
    jobIdRef.current++;
    const old = poolRef.current;
    if (old) for (const w of old.workers) w.terminate();
    poolRef.current = spawnPool();
    setStatus("idle");
    setProgress(0);
  }, []);

  // Dispatch ALL shards from ALL passes concurrently to the single pool.
  // Each worker holds a queue of shards (web workers process postMessage
  // serially) so total throughput equals one pass's throughput, but progress
  // updates flow continuously across both passes — no "stall at 50 %".
  const runJob = useCallback(
    async (
      jobId: number,
      passes: PassPlan[],
      onProgress: (frac: number) => void,
    ): Promise<Record<PassPlan["key"], SimulationResult>> => {
      const pool = poolRef.current;
      if (!pool) throw new Error("worker pool not ready");
      const W = pool.workers.length;

      // Compile + plan shards for each pass on the main thread. Compilation
      // is cheap (<<1 ms) and we need the grid for mergeShards downstream.
      type PassCtx = {
        plan: PassPlan;
        compiled: ReturnType<typeof compileSchedule>;
        grid: ReturnType<typeof makeCheckpointGrid>;
        K1: number;
        shards: (RawShard | null)[];
        shardBounds: Array<[number, number]>;
        result: SimulationResult | null;
      };
      const ctxs: Record<PassPlan["key"], PassCtx> = {} as never;
      const allSlots: ShardSlot[] = [];
      let nextShardId = 0;
      for (const plan of passes) {
        const compiled = compileSchedule(
          { ...plan.input, calibrationMode: plan.calibrationMode },
          plan.calibrationMode,
        );
        const grid = makeCheckpointGrid(compiled.tournamentsPerSample);
        const S = plan.input.samples;
        const shardCount = Math.max(1, Math.min(W, S));
        const bounds: Array<[number, number]> = [];
        for (let i = 0; i < shardCount; i++) {
          const lo = Math.floor((i * S) / shardCount);
          const hi = Math.floor(((i + 1) * S) / shardCount);
          if (hi > lo) bounds.push([lo, hi]);
        }
        ctxs[plan.key] = {
          plan,
          compiled,
          grid,
          K1: grid.K + 1,
          shards: bounds.map(() => null),
          shardBounds: bounds,
          result: null,
        };
        for (let i = 0; i < bounds.length; i++) {
          allSlots.push({
            passKey: plan.key,
            shardId: nextShardId++,
            workerIdx: i % W, // round-robin across pool
            sStart: bounds[i][0],
            sEnd: bounds[i][1],
            total: bounds[i][1] - bounds[i][0],
            done: 0,
          });
        }
      }

      // Cached running totals — O(1) progress emission.
      let totalAll = 0;
      let doneAll = 0;
      for (const s of allSlots) totalAll += s.total;

      // Throttle UI updates: at most ~30 fps.
      let lastEmit = 0;
      const emitProgress = () => {
        const now = performance.now();
        if (now - lastEmit < 33 && doneAll < totalAll) return;
        lastEmit = now;
        onProgress(totalAll > 0 ? doneAll / totalAll : 0);
      };

      return new Promise((resolve, reject) => {
        let settled = false;
        let remaining = allSlots.length;

        // Map slot → ctx pass + index within that pass for result placement
        const slotIndexInPass = new Map<number, number>();
        for (const key of Object.keys(ctxs) as PassPlan["key"][]) {
          let idx = 0;
          for (const s of allSlots) {
            if (s.passKey === key) {
              slotIndexInPass.set(s.shardId, idx++);
            }
          }
        }

        const handler = (e: MessageEvent) => {
          if (settled || jobIdRef.current !== jobId) return;
          const msg = e.data as
            | ShardProgressMsg
            | ShardResultMsg
            | ShardErrorMsg;
          if (msg.jobId !== jobId) return;
          const slot = allSlots.find((s) => s.shardId === msg.shardId);
          if (!slot) return;
          if (msg.type === "shard-progress") {
            const delta = msg.done - slot.done;
            slot.done = msg.done;
            doneAll += delta;
            emitProgress();
          } else if (msg.type === "shard-result") {
            const delta = slot.total - slot.done;
            slot.done = slot.total;
            doneAll += delta;
            const ctx = ctxs[slot.passKey];
            const idx = slotIndexInPass.get(slot.shardId);
            if (idx != null) ctx.shards[idx] = msg.shard;
            remaining--;
            if (remaining === 0) {
              // Final shard in — push the bar to 100 % unconditionally and
              // let the browser paint it before the synchronous post-
              // processing (sort/histograms/quantiles) runs. Two rAFs: the
              // first queues a style flush, the second fires *after* paint.
              settled = true;
              detach();
              lastEmit = 0;
              onProgress(1);
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  try {
                    for (const key of Object.keys(ctxs) as PassPlan["key"][]) {
                      const ctx = ctxs[key];
                      const merged = mergeShards(
                        ctx.shards.filter((x): x is RawShard => x !== null),
                        ctx.plan.input.samples,
                        ctx.K1,
                        ctx.plan.input.schedule.length,
                      );
                      ctx.result = buildResult(
                        {
                          ...ctx.plan.input,
                          calibrationMode: ctx.plan.calibrationMode,
                        },
                        ctx.compiled,
                        merged,
                        ctx.plan.calibrationMode,
                        ctx.grid,
                      );
                    }
                    const out: Record<PassPlan["key"], SimulationResult> =
                      {} as never;
                    for (const key of Object.keys(ctxs) as PassPlan["key"][]) {
                      out[key] = ctxs[key].result!;
                    }
                    resolve(out);
                  } catch (err) {
                    reject(err);
                  }
                });
              });
            } else {
              emitProgress();
            }
          } else if (msg.type === "shard-error") {
            settled = true;
            detach();
            reject(new Error(msg.message));
          }
        };

        const detach = () => {
          for (const w of pool.workers) {
            w.removeEventListener("message", handler as EventListener);
          }
        };

        for (const w of pool.workers) {
          w.addEventListener("message", handler as EventListener);
        }

        // Dispatch all shards. Workers process postMessage queues serially;
        // round-robin assignment balances load across the pool.
        for (const slot of allSlots) {
          const req: ShardRequest = {
            type: "shard",
            jobId,
            shardId: slot.shardId,
            input: ctxs[slot.passKey].plan.input,
            calibrationMode: ctxs[slot.passKey].plan.calibrationMode,
            sStart: slot.sStart,
            sEnd: slot.sEnd,
          };
          pool.workers[slot.workerIdx].postMessage(req);
        }
      });
    },
    [],
  );

  const run = useCallback(
    async (input: SimulationInput) => {
      const pool = poolRef.current;
      if (!pool) return;
      const jobId = ++jobIdRef.current;
      setStatus("running");
      setProgress(0);
      setResult(null);
      setError(null);
      setElapsedMs(null);
      const t0 = performance.now();

      const twin = !!input.compareWithPrimedope && !input.calibrationMode;
      const mode2 = input.compareMode ?? "random";

      const passes: PassPlan[] = [
        {
          key: "primary",
          input: { ...input, compareWithPrimedope: false },
          calibrationMode: "alpha",
          weight: twin ? 0.5 : 1,
        },
      ];
      if (twin) {
        const secondInput =
          mode2 === "primedope"
            ? { ...input, compareWithPrimedope: false }
            : {
                ...input,
                compareWithPrimedope: false,
                seed:
                  (((input.seed ^ 0xa5a5a5a5) >>> 0) ^
                    ((Math.random() * 0xffffffff) >>> 0)) >>>
                  0,
              };
        passes.push({
          key: "comparison",
          input: secondInput,
          calibrationMode:
            mode2 === "primedope" ? "primedope-binary-itm" : "alpha",
          weight: 0.5,
        });
      }

      try {
        const out = await runJob(jobId, passes, (f) => setProgress(f));
        if (jobIdRef.current !== jobId) return;
        const primary = out.primary;
        const comparison = twin ? out.comparison : undefined;
        setResult(comparison ? { ...primary, comparison } : primary);
        setProgress(1);
        setElapsedMs(performance.now() - t0);
        setStatus("done");
      } catch (err) {
        if (jobIdRef.current !== jobId) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    },
    [runJob],
  );

  return { status, progress, result, error, elapsedMs, run, cancel };
}
