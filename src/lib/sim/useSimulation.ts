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
  // Use ~half of logical threads — on SMT systems that's roughly the
  // physical-core count, which keeps SMT siblings free for the OS, the
  // browser UI thread, and whatever else the user has running. Avoids
  // the "fans spin up, Discord stutters" problem of saturating all
  // cores. 7950X (hc=32) → 16, 5800X (hc=16) → 8, laptop quad
  // (hc=8) → 4, dual-core fallback → 1.
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

export function useSimulation() {
  const poolRef = useRef<Pool | null>(null);
  const jobIdRef = useRef(0);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    poolRef.current = spawnPool();
    return () => {
      const p = poolRef.current;
      if (p) for (const w of p.workers) w.terminate();
      poolRef.current = null;
    };
  }, []);

  // Cancel any in-flight run. Bumps jobId so pending promise resolvers
  // bail out, then terminates and respawns the worker pool — postMessage
  // has no cooperative cancellation, so the only way to actually stop
  // the hot loop is to kill the worker. Respawn is cheap (~ms).
  const cancel = useCallback(() => {
    jobIdRef.current++;
    const old = poolRef.current;
    if (old) for (const w of old.workers) w.terminate();
    poolRef.current = spawnPool();
    setStatus("idle");
    setProgress(0);
  }, []);

  // Run a single calibration mode across the worker pool. Resolves with
  // a fully-aggregated SimulationResult. Progress callback reports a
  // [0, 1] fraction within this pass — callers normalize across twin
  // runs themselves.
  const runPass = useCallback(
    (
      input: SimulationInput,
      calibrationMode: CalibrationMode,
      jobId: number,
      onPassProgress: (frac: number) => void,
    ): Promise<SimulationResult> => {
      return new Promise((resolve, reject) => {
        const pool = poolRef.current;
        if (!pool) {
          reject(new Error("worker pool not ready"));
          return;
        }
        const W = pool.workers.length;
        const S = input.samples;
        const numRows = input.schedule.length;

        // Compile once on the main thread too — we need the grid and
        // compiled metadata for mergeShards + buildResult. Workers
        // re-compile independently; the cost is negligible vs. the hot
        // loop, and the two compilations are deterministic.
        let compiled;
        try {
          compiled = compileSchedule(
            { ...input, calibrationMode },
            calibrationMode,
          );
        } catch (err) {
          reject(err);
          return;
        }
        const grid = makeCheckpointGrid(compiled.tournamentsPerSample);
        const K1 = grid.K + 1;

        const effectiveShards = Math.max(1, Math.min(W, S));
        const shardBounds: Array<[number, number]> = [];
        for (let i = 0; i < effectiveShards; i++) {
          const lo = Math.floor((i * S) / effectiveShards);
          const hi = Math.floor(((i + 1) * S) / effectiveShards);
          if (hi > lo) shardBounds.push([lo, hi]);
        }
        const n = shardBounds.length;

        const totalPerShard: number[] = shardBounds.map(([a, b]) => b - a);
        const donePerShard: number[] = shardBounds.map(() => 0);
        const shards: (RawShard | null)[] = shardBounds.map(() => null);
        let remaining = n;
        let settled = false;

        const emitProgress = () => {
          let total = 0;
          let done = 0;
          for (let i = 0; i < n; i++) {
            total += totalPerShard[i];
            done += donePerShard[i];
          }
          onPassProgress(total > 0 ? done / total : 0);
        };

        const handlers: Array<(e: MessageEvent) => void> = new Array(n);
        const detach = () => {
          for (let i = 0; i < n; i++) {
            pool.workers[i].removeEventListener(
              "message",
              handlers[i] as EventListener,
            );
          }
        };

        for (let i = 0; i < n; i++) {
          const worker = pool.workers[i];
          const handler = (e: MessageEvent) => {
            if (settled || jobIdRef.current !== jobId) return;
            const msg = e.data as
              | ShardProgressMsg
              | ShardResultMsg
              | ShardErrorMsg;
            if (msg.jobId !== jobId || msg.shardId !== i) return;
            if (msg.type === "shard-progress") {
              donePerShard[i] = msg.done;
              emitProgress();
            } else if (msg.type === "shard-result") {
              donePerShard[i] = totalPerShard[i];
              shards[i] = msg.shard;
              emitProgress();
              remaining--;
              if (remaining === 0) {
                settled = true;
                detach();
                try {
                  const merged = mergeShards(
                    shards.filter((x): x is RawShard => x !== null),
                    S,
                    K1,
                    numRows,
                  );
                  const out = buildResult(
                    { ...input, calibrationMode },
                    compiled,
                    merged,
                    calibrationMode,
                    grid,
                  );
                  resolve(out);
                } catch (err) {
                  reject(err);
                }
              }
            } else if (msg.type === "shard-error") {
              settled = true;
              detach();
              reject(new Error(msg.message));
            }
          };
          handlers[i] = handler;
          worker.addEventListener("message", handler as EventListener);

          const req: ShardRequest = {
            type: "shard",
            jobId,
            shardId: i,
            input,
            calibrationMode,
            sStart: shardBounds[i][0],
            sEnd: shardBounds[i][1],
          };
          worker.postMessage(req);
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

      const twin = !!input.compareWithPrimedope && !input.calibrationMode;
      const mode2 = input.compareMode ?? "random";

      try {
        if (twin) {
          const primary = await runPass(
            { ...input, compareWithPrimedope: false },
            "alpha",
            jobId,
            (f) => setProgress(f * 0.5),
          );
          if (jobIdRef.current !== jobId) return;
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
          const secondCalib: CalibrationMode =
            mode2 === "primedope" ? "primedope-uniform-lift" : "alpha";
          const comparison = await runPass(
            secondInput,
            secondCalib,
            jobId,
            (f) => setProgress(0.5 + f * 0.5),
          );
          if (jobIdRef.current !== jobId) return;
          setResult({ ...primary, comparison });
        } else {
          const mode: CalibrationMode = input.calibrationMode ?? "alpha";
          const res = await runPass(input, mode, jobId, (f) => setProgress(f));
          if (jobIdRef.current !== jobId) return;
          setResult(res);
        }
        setProgress(1);
        setStatus("done");
      } catch (err) {
        if (jobIdRef.current !== jobId) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    },
    [runPass],
  );

  return { status, progress, result, error, run, cancel };
}
