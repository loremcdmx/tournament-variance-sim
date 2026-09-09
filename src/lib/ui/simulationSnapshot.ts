import type { PersistedState } from "@/lib/persistence";
import type { SimulationInput, SimulationResult } from "@/lib/sim/types";

export type PrimeDopePatch = Partial<Pick<SimulationInput,
  "usePrimedopePayouts" | "usePrimedopeFinishModel" | "usePrimedopeRakeMath"
>>;

export interface CachedSimulationRun {
  seed: number;
  input: SimulationInput;
  result: SimulationResult;
  source?: PersistedState;
}

export function cacheSimulationRun(
  input: SimulationInput,
  result: SimulationResult,
  source?: PersistedState,
): CachedSimulationRun {
  return {
    seed: input.seed,
    input: structuredClone(input),
    result,
    source: source ? {
      ...structuredClone(source),
      controls: { ...structuredClone(source.controls), seed: input.seed >>> 0 },
    } : undefined,
  };
}

export function replacePrimeDopeResult(
  cached: CachedSimulationRun,
  input: SimulationInput,
  result: SimulationResult,
  key: "primary" | "comparison",
): CachedSimulationRun {
  const nextResult = key === "primary"
    ? { ...result, comparison: cached.result.comparison }
    : { ...cached.result, comparison: result };
  const source = cached.source ? {
    ...cached.source,
    controls: {
      ...cached.source.controls,
      usePrimedopePayouts: input.usePrimedopePayouts ?? true,
      usePrimedopeFinishModel: input.usePrimedopeFinishModel ?? true,
      usePrimedopeRakeMath: input.usePrimedopeRakeMath ?? true,
    },
  } : undefined;
  return cacheSimulationRun(input, nextResult, source);
}
