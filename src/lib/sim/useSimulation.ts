"use client";

/**
 * React bridge to the worker pool. The only React-touching file in
 * `src/lib/sim/`; everything else is pure TS testable under Vitest.
 *
 * Owns a pool of `Worker` instances across renders (refs, not state),
 * dispatches a `BuildRequest` to worker 0, then fans out `ShardRequest`s,
 * merges shards as they return, and exposes `{status, progress, result,
 * elapsedMs, error}` to the UI. Tracks `jobId` so late messages from a
 * cancelled run are ignored.
 *
 * Wall-clock timing lives here (not in the engine) so determinism inside
 * `engine.ts` is preserved.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RawShard } from "./engine";
import { BUILD_PROGRESS_CAP, shardProgressFracFor } from "./progressConstants";
import { composeProgress } from "./progressAggregation";
import { computeNextRate } from "@/lib/ui/rateUpdate";

const EMPTY_BUILD_FRACS: ReadonlyMap<number, number> = new Map();
import type {
  CalibrationMode,
  SimulationInput,
  SimulationResult,
} from "./types";
import type { BuildStage } from "./engine";
import type {
  BuildErrorMsg,
  BuildProgressMsg,
  BuildRequest,
  BuildResultMsg,
  ShardErrorMsg,
  ShardProgressMsg,
  ShardRequest,
  ShardResultMsg,
} from "./worker";

type Status = "idle" | "running" | "done" | "error";
type BackgroundStatus = "idle" | "computing" | "full";
/**
 * Coarse phase label rendered under the progress bar so the user can tell
 * which part of the pipeline the bar is currently advancing through.
 * "simulating" covers the shard-parallel monte carlo phase; the four
 * BuildStage variants come from buildResult in the engine.
 */
export type ProgressStage = "simulating" | BuildStage;

/** Max sibling runs cached per batch (foreground + background). */
const MAX_CACHED_RUNS = 5;

interface CachedRun {
  seed: number;
  result: SimulationResult;
}

/**
 * Hash of the SimulationInput with `seed` masked out — runs that differ
 * only by seed share the same key and accumulate into one cache batch.
 * Any non-seed change (schedule, controls, compare flags) produces a new
 * key, which discards the old cache on the next Run click.
 */
function computeBatchKey(input: SimulationInput): string {
  const rest = { ...input, seed: 0 };
  return JSON.stringify(rest);
}

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

const RATE_KEY = "tvs.lastRateMsPerWork.v1";

function workUnits(samples: number, scheduleRepeats: number, rowCount: number) {
  return Math.max(1, samples * scheduleRepeats * Math.max(1, rowCount));
}

function loadRate(): number | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(RATE_KEY);
    if (!raw) return null;
    const v = parseFloat(raw);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function saveRate(r: number) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(RATE_KEY, String(r));
  } catch {}
}

export function useSimulation() {
  const poolRef = useRef<Pool | null>(null);
  const jobIdRef = useRef(0);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<ProgressStage | null>(null);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [lastRateMs, setLastRateMs] = useState<number | null>(null);

  // Background precompute state. A "batch" is a set of runs that differ only
  // by seed — switching between them in ResultsView is instantaneous because
  // each completed run is cached here and `selectRun` just swaps `result`.
  // `version` bumps on every new foreground run so an in-flight background
  // loop can notice it's been orphaned and bail out before it overwrites a
  // fresher batch.
  const batchRef = useRef<{
    version: number;
    key: string;
    runs: CachedRun[];
    baseInput: SimulationInput | null;
  }>({ version: 0, key: "", runs: [], baseInput: null });
  const [availableRuns, setAvailableRuns] = useState(0);
  const [activeRunIdx, setActiveRunIdx] = useState(0);
  const [activeSeed, setActiveSeed] = useState<number | null>(null);
  const [backgroundStatus, setBackgroundStatus] = useState<BackgroundStatus>(
    "idle",
  );
  const bgAbortRef = useRef<AbortController | null>(null);
  const pdJobIdRef = useRef(0);
  const [pdStatus, setPdStatus] = useState<Status>("idle");
  const [pdProgress, setPdProgress] = useState(0);
  const [pdResultOverride, setPdResultOverride] = useState<SimulationResult | null>(null);

  useEffect(() => {
    setLastRateMs(loadRate());
  }, []);

  // Project a run's duration for the given work size. Returns null when
  // no prior run has been recorded — caller can hide the hint.
  const estimateMs = useCallback(
    (samples: number, scheduleRepeats: number, rowCount: number) => {
      if (lastRateMs == null) return null;
      return workUnits(samples, scheduleRepeats, rowCount) * lastRateMs;
    },
    [lastRateMs],
  );

  useEffect(() => {
    poolRef.current = spawnPool();
    return () => {
      const p = poolRef.current;
      if (p) for (const w of p.workers) w.terminate();
      poolRef.current = null;
    };
  }, []);

  // Drain the pool. Web workers process postMessage FIFO and have no
  // in-band cancel — terminate + respawn is the only way to drop stale
  // shards still sitting in a worker's queue. Without this, new shards
  // dispatched by the next run land behind seconds of background /
  // PD-only work and the progress bar stays at ~1 ms until it clears.
  const resetPool = useCallback(() => {
    const old = poolRef.current;
    if (old) for (const w of old.workers) w.terminate();
    poolRef.current = spawnPool();
  }, []);

  const interruptBackground = useCallback(() => {
    let shouldReset = false;
    if (bgAbortRef.current) {
      bgAbortRef.current.abort();
      bgAbortRef.current = null;
      shouldReset = true;
    }
    if (pdStatus === "running") {
      pdJobIdRef.current++;
      shouldReset = true;
    }
    if (!shouldReset) return;
    resetPool();
    setBackgroundStatus("idle");
    setPdStatus("idle");
    setPdProgress(0);
  }, [pdStatus, resetPool]);

  const cancel = useCallback(() => {
    jobIdRef.current++;
    pdJobIdRef.current++;
    batchRef.current.version++;
    bgAbortRef.current?.abort();
    bgAbortRef.current = null;
    resetPool();
    setStatus("idle");
    setProgress(0);
    setStage(null);
    setBackgroundStatus("idle");
    setPdStatus("idle");
    setPdProgress(0);
  }, [resetPool]);

  // Dispatch ALL shards from ALL passes concurrently to the single pool.
  // Each worker holds a queue of shards (web workers process postMessage
  // serially) so total throughput equals one pass's throughput, but progress
  // updates flow continuously across both passes — no "stall at 50 %".
  const runJob = useCallback(
    async (
      jobId: number,
      passes: PassPlan[],
      onProgress: (frac: number, stage: ProgressStage) => void,
      signal?: AbortSignal,
    ): Promise<Record<PassPlan["key"], SimulationResult>> => {
      const pool = poolRef.current;
      if (!pool) throw new Error("worker pool not ready");
      const W = pool.workers.length;

      // Plan shards for each pass. Compilation + checkpoint-grid construction
      // both happen inside the worker on shard dispatch — no main-thread copy
      // is needed, and on heavy schedules (10 rows × 20 repeats × twin) the
      // redundant work cost 35 ms of click→first-dispatch latency.
      type PassCtx = {
        plan: PassPlan;
        shards: (RawShard | null)[];
        shardBounds: Array<[number, number]>;
        result: SimulationResult | null;
      };
      const ctxs: Record<PassPlan["key"], PassCtx> = {} as never;
      const allSlots: ShardSlot[] = [];
      let nextShardId = 0;
      for (const plan of passes) {
        const S = plan.input.samples;
        // Over-subscribe shards relative to the worker pool so stragglers
        // don't park the progress bar at a coarse fraction. Large runs get a
        // denser split because the worker-message overhead is tiny compared to
        // multi-second shard tails, while the extra granularity makes the bar
        // look materially less "stuck in the middle".
        const MIN_SAMPLES_PER_SHARD = S >= 100_000 ? 32 : 64;
        const oversub = S >= 200_000 ? 6 : 4;
        const maxShards = Math.max(1, Math.floor(S / MIN_SAMPLES_PER_SHARD));
        const shardCount = Math.max(1, Math.min(W * oversub, maxShards, S));
        const bounds: Array<[number, number]> = [];
        for (let i = 0; i < shardCount; i++) {
          const lo = Math.floor((i * S) / shardCount);
          const hi = Math.floor(((i + 1) * S) / shardCount);
          if (hi > lo) bounds.push([lo, hi]);
        }
        ctxs[plan.key] = {
          plan,
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

      // Sample-count-aware split: larger runs reserve more headroom for the
      // build phase so the bar doesn't park at ~95% while envelope sorts and
      // serialize-and-post finish. Use the largest pass (twin runs share the
      // same visible bar; the slower pass dominates).
      let maxPassSamples = 0;
      for (const p of passes) {
        if (p.input.samples > maxPassSamples) maxPassSamples = p.input.samples;
      }
      const shardFrac = shardProgressFracFor(maxPassSamples);

      // Throttle UI updates: at most ~30 fps.
      let lastEmit = 0;
      const emitProgress = () => {
        const now = performance.now();
        if (now - lastEmit < 33 && doneAll < totalAll) return;
        lastEmit = now;
        onProgress(
          composeProgress({
            shardDone: doneAll,
            shardTotal: totalAll,
            shardFrac,
            buildFracs: EMPTY_BUILD_FRACS,
            totalBuildsExpected: 0,
          }),
          "simulating",
        );
      };

      return new Promise((resolve, reject) => {
        let settled = false;
        // Real build-phase progress: buildResult emits ~10 build-progress
        // messages during its run (envelope sorts + downswings). Each buildId
        // tracks its own frac; the overall build fraction is the average
        // across in-flight builds (one per pass). Replaces the old fake
        // eased-timer which parked the bar at ~0.93 for 700+ ms on 200k-sample
        // runs because its `totalAll * 0.02` wall-time estimate was 5× off.
        const buildFracs = new Map<number, number>();
        let totalBuildsExpected = 0;
        // Latest reported build stage — we surface whichever phase the most
        // recent build-progress message was tagged with, so the UI follows
        // the leading edge rather than averaging across passes.
        let latestBuildStage: BuildStage = "stats";
        const emitBuildProgress = () => {
          if (totalBuildsExpected === 0) return;
          onProgress(
            composeProgress({
              shardDone: doneAll,
              shardTotal: totalAll,
              shardFrac,
              buildFracs,
              totalBuildsExpected,
            }),
            latestBuildStage,
          );
        };
        const onAbort = () => {
          if (settled) return;
          settled = true;
          detach();
          if (signal) signal.removeEventListener("abort", onAbort);
          reject(new Error("aborted"));
        };
        if (signal) {
          if (signal.aborted) {
            reject(new Error("aborted"));
            return;
          }
          signal.addEventListener("abort", onAbort);
        }
        let remaining = allSlots.length;
        let buildsRemaining = 0;
        let nextBuildId = 1;
        const buildIdToPass = new Map<number, PassPlan["key"]>();

        // shardId → slot (O(1) lookup in the message handler instead of
        // scanning allSlots per message — ~20 ticks × n_shards messages
        // per run, trivial but cleaner).
        const slotById = new Map<number, ShardSlot>();
        for (const s of allSlots) slotById.set(s.shardId, s);
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

        const collectShardBuffers = (shards: RawShard[]): Transferable[] => {
          // Must match worker.ts `collectShardTransfers` — any buffer the
          // worker transferred back on shard-result needs to be transferred
          // forward on build, otherwise structured-clone fallback copies
          // multi-MB typed arrays and stalls the late stage of the run.
          const out: Transferable[] = [];
          for (const sh of shards) {
            out.push(sh.finalProfits.buffer);
            out.push(sh.pathMatrix.buffer);
            out.push(sh.maxDrawdowns.buffer);
            out.push(sh.maxRunUps.buffer);
            out.push(sh.runningMins.buffer);
            out.push(sh.longestBreakevens.buffer);
            out.push(sh.breakevenStreakAvgs.buffer);
            out.push(sh.longestCashless.buffer);
            out.push(sh.recoveryLengths.buffer);
            out.push(sh.breakevenStreakCounts.buffer);
            out.push(sh.cashlessStreakCounts.buffer);
            out.push(sh.rowProfits.buffer);
            out.push(sh.rowBountyProfits.buffer);
            out.push(sh.jackpotMask.buffer);
            if (sh.leaderboardPoints) out.push(sh.leaderboardPoints.buffer);
            if (sh.leaderboardPayouts) out.push(sh.leaderboardPayouts.buffer);
            if (sh.leaderboardExpectedPayouts) {
              out.push(sh.leaderboardExpectedPayouts.buffer);
            }
            if (sh.leaderboardWindows) out.push(sh.leaderboardWindows.buffer);
            if (sh.leaderboardPaidWindows) {
              out.push(sh.leaderboardPaidWindows.buffer);
            }
            if (sh.leaderboardRankSums) out.push(sh.leaderboardRankSums.buffer);
            if (sh.leaderboardKnockouts) out.push(sh.leaderboardKnockouts.buffer);
            if (sh.leaderboardFirsts) out.push(sh.leaderboardFirsts.buffer);
            if (sh.leaderboardSeconds) out.push(sh.leaderboardSeconds.buffer);
            if (sh.leaderboardThirds) out.push(sh.leaderboardThirds.buffer);
            out.push(sh.hiResCheckpointIdx.buffer);
            out.push(sh.hiResSampleIndices.buffer);
            out.push(sh.hiResBestPath.buffer);
            out.push(sh.hiResWorstPath.buffer);
            out.push(sh.hiResMin.buffer);
            out.push(sh.hiResMax.buffer);
            for (const p of sh.hiResPaths) out.push(p.buffer);
          }
          return out;
        };

        const dispatchBuild = (key: PassPlan["key"], workerIdx: number) => {
          const ctx = ctxs[key];
          const buildId = nextBuildId++;
          buildIdToPass.set(buildId, key);
          buildsRemaining++;
          totalBuildsExpected++;
          buildFracs.set(buildId, 0);
          const shards = ctx.shards.filter((x): x is RawShard => x !== null);
          const req: BuildRequest = {
            type: "build",
            jobId,
            buildId,
            input: {
              ...ctx.plan.input,
              calibrationMode: ctx.plan.calibrationMode,
            },
            calibrationMode: ctx.plan.calibrationMode,
            shards,
          };
          // Transfer every shard buffer — the worker now owns them, the
          // main thread doesn't need them again. Keeps the build entirely
          // off the main thread and avoids a multi-MB structured clone.
          pool.workers[workerIdx].postMessage(req, collectShardBuffers(shards));
        };

        const handler = (e: MessageEvent) => {
          if (settled || jobIdRef.current !== jobId) return;
          const msg = e.data as
            | ShardProgressMsg
            | ShardResultMsg
            | ShardErrorMsg
            | BuildProgressMsg
            | BuildResultMsg
            | BuildErrorMsg;
          if (msg.jobId !== jobId) return;
          if (msg.type === "build-progress") {
            const prev = buildFracs.get(msg.buildId) ?? 0;
            if (msg.frac > prev) {
              // Cap just under 1.0 — the serialize + postMessage back to main
              // is not part of msg.frac and we want the final tick to come
              // from the build-result handler, not from build-progress
              // overshooting into the "done" slot.
              buildFracs.set(msg.buildId, Math.min(BUILD_PROGRESS_CAP, msg.frac));
              latestBuildStage = msg.stage;
              emitBuildProgress();
            }
            return;
          }
          if (msg.type === "build-result") {
            const key = buildIdToPass.get(msg.buildId);
            if (key == null) return;
            ctxs[key].result = msg.result;
            buildFracs.set(msg.buildId, 1);
            buildsRemaining--;
            if (buildsRemaining === 0) {
              settled = true;
              detach();
              onProgress(1, latestBuildStage);
              const out: Record<PassPlan["key"], SimulationResult> =
                {} as never;
              for (const k of Object.keys(ctxs) as PassPlan["key"][]) {
                out[k] = ctxs[k].result!;
              }
              resolve(out);
            } else {
              emitBuildProgress();
            }
            return;
          }
          if (msg.type === "build-error") {
            settled = true;
            detach();
            reject(new Error(msg.message));
            return;
          }
          const slot = slotById.get(msg.shardId);
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
              // All shards collected. Dispatch the build to workers instead
              // of running on main thread — the envelope sorts / histograms
              // used to cause a 2–5 s freeze at 99% on 100k-sample runs.
              // Hand off to one worker per pass so a twin run parallelizes.
              lastEmit = 0;
              // Shards complete → transitioning into the build phase; tag
              // with the first build stage so the UI flips the label away
              // from "simulating" even before the first build-progress emit.
              onProgress(shardFrac, "stats");
              const keys = Object.keys(ctxs) as PassPlan["key"][];
              try {
                keys.forEach((k, i) => {
                  dispatchBuild(k, i % W);
                });
              } catch (err) {
                settled = true;
                detach();
                reject(err);
                return;
              }
              // Real build-phase progress is now driven by build-progress
              // messages from inside buildResult (see worker.ts). No fake
              // timer needed.
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

  // Shared pass-plan construction: builds the same `PassPlan[]` for both
  // foreground and background runs. The only thing background changes is the
  // `seed` on the input passed in — every other twin/PD-compare decision must
  // stay identical so cached sibling runs are apples-to-apples.
  const buildPasses = useCallback((input: SimulationInput): PassPlan[] => {
      const twin = !input.calibrationMode;
      const mode2 = input.compareMode ?? "random";
      // The "primedope" model preset means "I want to see PD's ITM-distribution
      // model as the primary result, with our honest α algo on the right for
      // comparison". Flip primary ↔ comparison calibrations so the left pane
      // renders primedope-binary-itm and the right pane renders α.
      const pdPresetFlip =
        twin && mode2 === "primedope" && input.modelPresetId === "primedope";
      // PrimeDope can't model progressive-KO payouts: their calculator has
      // no bounty field. When the user's schedule contains any PKO row, swap
      // the PrimeDope comparison pass for "same schedule, bounties stripped"
      // under PD's own binary-ITM calibration — alpha-on-stripped-schedule
      // was visually indistinguishable from primary (bounty EV just folds
      // back into the regular pool, same ROI target, ~5% sd delta), so the
      // comparison pane looked identical. Binary-ITM has a structurally
      // different PMF (two uniform bins) and produces a meaningfully
      // different envelope — the actual variance gap PD users would see.
      const hasPko = input.schedule.some(
        (r) => (r.bountyFraction ?? 0) > 0,
      );
      const pdPkoFallback = mode2 === "primedope" && hasPko;

      // Under pdPresetFlip+PKO, the LEFT pane is the binary-ITM run, so strip
      // bounties from the primary input instead of the comparison.
      const stripBounties = (si: SimulationInput): SimulationInput => ({
        ...si,
        schedule: si.schedule.map((r) => ({ ...r, bountyFraction: 0 })),
      });
      let primaryInput: SimulationInput = input;
      if (pdPresetFlip && hasPko) primaryInput = stripBounties(primaryInput);
      const passes: PassPlan[] = [
        {
          key: "primary",
          input: primaryInput,
          calibrationMode: pdPresetFlip ? "primedope-binary-itm" : "alpha",
          weight: twin ? 0.5 : 1,
        },
      ];
      if (twin) {
        let secondInput: SimulationInput;
        if (pdPkoFallback && !pdPresetFlip) {
          // Strip bounties from every row so the secondary pass runs the
          // *same* schedule minus the KO component. Same seed keeps the
          // comparison aligned tournament-to-tournament.
          secondInput = stripBounties(input);
        } else if (mode2 === "primedope") {
          secondInput = input;
        } else {
          secondInput = {
            ...input,
            seed:
              (((input.seed ^ 0xa5a5a5a5) >>> 0) ^
                ((Math.random() * 0xffffffff) >>> 0)) >>>
              0,
          };
        }
        passes.push({
          key: "comparison",
          input: secondInput,
          calibrationMode:
            pdPresetFlip || mode2 !== "primedope"
              ? "alpha"
              : "primedope-binary-itm",
          weight: 0.5,
        });
      }

      return passes;
    },
    [],
  );

  // Merge twin passes into a single SimulationResult (primary + optional
  // `comparison` sibling). Used by both foreground and background runs so
  // cached sibling runs have the same shape as the foreground result.
  const mergePasses = useCallback(
    (
      passes: PassPlan[],
      out: Record<PassPlan["key"], SimulationResult>,
    ): SimulationResult => {
      const primary = out.primary;
      const twin = passes.length > 1;
      const comparison = twin ? out.comparison : undefined;
      return comparison ? { ...primary, comparison } : primary;
    },
    [],
  );

  // Derive a distinct seed for the i-th background sibling of a batch.
  // Golden-ratio stride keeps siblings spread across the seed space so two
  // adjacent cached runs don't share low-order bits.
  const deriveSiblingSeed = (baseSeed: number, i: number): number =>
    ((baseSeed + i * 0x9e3779b1) >>> 0);

  const run = useCallback(
    async (input: SimulationInput) => {
      if (!poolRef.current) return;
      bgAbortRef.current?.abort();
      bgAbortRef.current = null;
      resetPool();
      const jobId = ++jobIdRef.current;
      // Bump batch version to orphan any in-flight background loop from a
      // prior run — its post-await `version` check will fail and it'll bail
      // out before overwriting the new cache.
      batchRef.current.version++;
      const myVersion = batchRef.current.version;
      const batchKey = computeBatchKey(input);
      batchRef.current.key = batchKey;
      batchRef.current.runs = [];
      batchRef.current.baseInput = input;
      setAvailableRuns(0);
      setActiveRunIdx(0);
      setActiveSeed(input.seed >>> 0);
      setBackgroundStatus("idle");
      pdJobIdRef.current++;
      setPdStatus("idle");
      setPdProgress(0);
      setPdResultOverride(null);
      setStatus("running");
      setProgress(0);
      setStage("simulating");
      setResult(null);
      setError(null);
      setElapsedMs(null);
      const t0 = performance.now();

      const passes = buildPasses(input);

      try {
        const out = await runJob(jobId, passes, (f, s) => {
          setProgress(f);
          setStage(s);
        });
        if (jobIdRef.current !== jobId) return;
        if (batchRef.current.version !== myVersion) return;
        const merged = mergePasses(passes, out);
        batchRef.current.runs.push({ seed: input.seed, result: merged });
        setAvailableRuns(1);
        setActiveRunIdx(0);
        setActiveSeed(input.seed >>> 0);
        setResult(merged);
        setProgress(1);
        setStage(null);
        const elapsed = performance.now() - t0;
        setElapsedMs(elapsed);
        setStatus("done");
        // Record a smoothed rate (ms per work unit) so the next run can
        // show an ETA. EMA blend at 0.6 of new observation; outlier
        // observations (≥2.5× change vs cached) are dropped entirely so a
        // single throttled tab can't poison the cache for the next clean
        // run. See `src/lib/ui/rateUpdate.ts` for the math.
        const rowCountTotal = input.schedule.reduce(
          (a, r) => a + Math.max(1, Math.floor(r.count)),
          0,
        );
        const work = workUnits(
          input.samples,
          Math.max(1, input.scheduleRepeats),
          rowCountTotal,
        );
        const update = computeNextRate({
          elapsedMs: elapsed,
          work,
          prevRate: loadRate(),
        });
        if (update.nextRate != null) {
          saveRate(update.nextRate);
          setLastRateMs(update.nextRate);
        }
      } catch (err) {
        if (jobIdRef.current !== jobId) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
        setStage(null);
        return;
      }

      // Background precompute loop. Runs sibling seeds on the same pool,
      // sequentially, until `MAX_CACHED_RUNS` is reached or a newer
      // foreground run bumps `batchRef.current.version`. Each sibling reuses
      // `runJob` but with a fresh jobId; progress goes nowhere (the
      // callback is a no-op) so the foreground progress bar stays at 1.
      setBackgroundStatus("computing");
      const bgController = new AbortController();
      bgAbortRef.current = bgController;
      for (let i = 1; i < MAX_CACHED_RUNS; i++) {
        if (batchRef.current.version !== myVersion) {
          if (bgAbortRef.current === bgController) bgAbortRef.current = null;
          return;
        }
        if (bgController.signal.aborted) {
          if (bgAbortRef.current === bgController) bgAbortRef.current = null;
          return;
        }
        const siblingSeed = deriveSiblingSeed(input.seed, i);
        const siblingInput: SimulationInput = { ...input, seed: siblingSeed };
        const siblingPasses = buildPasses(siblingInput);
        const bgJobId = ++jobIdRef.current;
        try {
          const bgOut = await runJob(
            bgJobId,
            siblingPasses,
            () => {},
            bgController.signal,
          );
          if (batchRef.current.version !== myVersion) {
            if (bgAbortRef.current === bgController) bgAbortRef.current = null;
            return;
          }
          if (jobIdRef.current !== bgJobId) {
            if (bgAbortRef.current === bgController) bgAbortRef.current = null;
            return;
          }
          const merged = mergePasses(siblingPasses, bgOut);
          batchRef.current.runs.push({ seed: siblingSeed, result: merged });
          setAvailableRuns(batchRef.current.runs.length);
        } catch {
          // Background errors (including aborts) are silent — the foreground
          // result is still valid, and the next run resets the batch.
          if (bgAbortRef.current === bgController) bgAbortRef.current = null;
          setBackgroundStatus("idle");
          return;
        }
      }
      if (batchRef.current.version === myVersion) {
        if (bgAbortRef.current === bgController) bgAbortRef.current = null;
        setBackgroundStatus("full");
      }
    },
    [runJob, buildPasses, mergePasses, resetPool],
  );

  // Isolated re-run of just the PrimeDope-comparison pass. Used by the
  // "PD payouts" toggle next to the compare chart so flipping it only
  // recomputes the right pane (with its own progress bar) instead of
  // invalidating the main result. Aborts background precompute since we
  // need the pool immediately; the user can re-run to refill the cache.
  const runPdOnly = useCallback(
    async (input: SimulationInput) => {
      if (!poolRef.current) return;
      const passes = buildPasses(input);
      const cmpPass = passes.find((p) => p.key === "comparison");
      if (!cmpPass) return;
      bgAbortRef.current?.abort();
      bgAbortRef.current = null;
      resetPool();
      setBackgroundStatus("idle");
      const myPdJob = ++pdJobIdRef.current;
      const myJobId = ++jobIdRef.current;
      setPdStatus("running");
      setPdProgress(0);
      try {
        const out = await runJob(
          myJobId,
          [cmpPass],
          (f) => {
            if (pdJobIdRef.current === myPdJob) setPdProgress(f);
          },
        );
        if (pdJobIdRef.current !== myPdJob) return;
        setPdResultOverride(out.comparison);
        setPdProgress(1);
        setPdStatus("done");
      } catch (err) {
        if (pdJobIdRef.current !== myPdJob) return;
        setPdStatus("error");
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [runJob, buildPasses, resetPool],
  );

  const selectRun = useCallback((idx: number) => {
    const runs = batchRef.current.runs;
    if (idx < 0 || idx >= runs.length) return;
    setActiveRunIdx(idx);
    setActiveSeed(runs[idx].seed >>> 0);
    setResult(runs[idx].result);
  }, []);

  return {
    status,
    progress,
    stage,
    result,
    error,
    elapsedMs,
    run,
    cancel,
    interruptBackground,
    estimateMs,
    availableRuns,
    activeRunIdx,
    activeSeed,
    selectRun,
    backgroundStatus,
    runPdOnly,
    pdStatus,
    pdProgress,
    pdResultOverride,
  };
}
