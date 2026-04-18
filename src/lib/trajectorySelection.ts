export type RunMode = "worst" | "random" | "best";

/**
 * Rank sampled trajectory paths by how the UI should reveal them.
 *
 * `random` preserves the engine's sampled order, so the first N visible runs
 * are an unbiased prefix of the captured paths. `best` and `worst` sort by
 * final profit, with ties broken by original index to keep the output stable.
 */
export function rankedRunIndices(
  paths: readonly ArrayLike<number>[],
  mode: RunMode,
): number[] {
  const total = paths.length;
  if (total === 0) return [];
  if (mode === "random") {
    return Array.from({ length: total }, (_, i) => i);
  }

  const ranked: Array<{ idx: number; finalProfit: number }> = new Array(total);
  for (let i = 0; i < total; i++) {
    const path = paths[i];
    ranked[i] = {
      idx: i,
      finalProfit: path.length > 0 ? (path[path.length - 1] ?? 0) : 0,
    };
  }

  ranked.sort((a, b) => {
    if (a.finalProfit === b.finalProfit) return a.idx - b.idx;
    return mode === "worst"
      ? a.finalProfit - b.finalProfit
      : b.finalProfit - a.finalProfit;
  });
  return ranked.map((row) => row.idx);
}
