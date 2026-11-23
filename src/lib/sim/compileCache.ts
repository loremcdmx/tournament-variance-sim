/**
 * Keeps the last compiled schedule of one worker, so the shards and the build
 * of a single job share one compile instead of repeating it per request.
 *
 * The key is the whole input plus the calibration mode, never a subset of
 * it: a field `compileSchedule` starts reading later can then never be served
 * a stale table. Compile is deterministic in its input, so a hit returns what a
 * fresh compile would, and nothing downstream writes to a compiled schedule
 * (`compileCache.test.ts` runs the hot loop and the build over a shared one).
 * One entry only: a worker holds a compiled schedule for the job it is on.
 */
import { compileSchedule } from "./compile";
import type { CompiledSchedule } from "./engineTypes";
import type { CalibrationMode, SimulationInput } from "./types";

type CompileFn = (input: SimulationInput, mode: CalibrationMode) => CompiledSchedule;

export interface CompileCache {
  get(input: SimulationInput, mode: CalibrationMode): CompiledSchedule;
  clear(): void;
}

// JSON turns NaN and ±Infinity into null, which a row could mean differently.
function keyOf(input: SimulationInput, mode: CalibrationMode): string {
  return JSON.stringify([mode, input], (_name, value: unknown) =>
    typeof value === "number" && !Number.isFinite(value)
      ? { nonFinite: String(value) }
      : value,
  );
}

const MAX_ENTRIES = 2;

export function createCompileCache(compile: CompileFn = compileSchedule): CompileCache {
  // Two slots keep both passes of a twin (primary + comparison) run warm
  // through shard execution and into build dispatch.
  const entries: Array<{ key: string; value: CompiledSchedule }> = [];
  return {
    get(input, mode) {
      const key = keyOf(input, mode);
      const hitIdx = entries.findIndex((e) => e.key === key);
      if (hitIdx >= 0) {
        const hit = entries[hitIdx];
        if (hitIdx !== entries.length - 1) {
          entries.splice(hitIdx, 1);
          entries.push(hit);
        }
        return hit.value;
      }
      const compiled = compile(input, mode);
      if (entries.length >= MAX_ENTRIES) entries.shift();
      entries.push({ key, value: compiled });
      return compiled;
    },
    clear() {
      entries.length = 0;
    },
  };
}
