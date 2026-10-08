import type { FormatComparisonConfig, FormatComparisonSummary } from "./formatComparison";

const REQUIRED_FORMATS = ["freezeout", "pko", "mystery", "ocean-ko", "mystery-royale"] as const;

function configKey(config: FormatComparisonConfig): string {
  return JSON.stringify([
    config.ticket, config.players, config.roi, config.distance,
    config.samples, config.seed, config.mysteryLogVariance,
  ]);
}

/** Session-only: no result from a previous page load or numerical era is persisted. */
export function createFormatComparisonCache(capacity = 3) {
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error("comparison cache: invalid capacity");
  const entries = new Map<string, FormatComparisonSummary[]>();
  return {
    get(config: FormatComparisonConfig): FormatComparisonSummary[] | undefined {
      const key = configKey(config);
      const rows = entries.get(key);
      if (!rows) return undefined;
      entries.delete(key);
      entries.set(key, rows);
      return structuredClone(rows);
    },
    put(config: FormatComparisonConfig, rows: FormatComparisonSummary[]): void {
      if (rows.length !== REQUIRED_FORMATS.length || !REQUIRED_FORMATS.every((format, index) => rows[index].format === format)) return;
      const key = configKey(config);
      entries.delete(key);
      entries.set(key, structuredClone(rows));
      while (entries.size > capacity) entries.delete(entries.keys().next().value!);
    },
  };
}

export const formatComparisonCache = createFormatComparisonCache();
