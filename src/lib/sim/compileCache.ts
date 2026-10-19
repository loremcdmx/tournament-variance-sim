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

export function createCompileCache(compile: CompileFn = compileSchedule): CompileCache {
  let lastKey: string | null = null;
  let last: CompiledSchedule | null = null;
  return {
    get(input, mode) {
      const key = keyOf(input, mode);
      if (last !== null && key === lastKey) return last;
      lastKey = null;
      last = null;
      const compiled = compile(input, mode);
      lastKey = key;
      last = compiled;
      return compiled;
    },
    clear() {
      lastKey = null;
      last = null;
    },
  };
}
