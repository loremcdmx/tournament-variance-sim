import { describe, expect, it } from "vitest";
import { createFormatComparisonCache } from "./formatComparisonCache";
import { FORMAT_COMPARISON_DEFAULTS, type FormatComparisonSummary } from "./formatComparison";

const config = { ...FORMAT_COMPARISON_DEFAULTS };
const rows = ["freezeout", "pko", "mystery", "ocean-ko", "mystery-royale"].map(format => ({
  format, seed: config.seed, downsideCurve: [{ entries: 100, minBI: -17 }],
})) as FormatComparisonSummary[];

describe("completed comparison cache", () => {
  it("keeps exact values and protects both stored config and rows from later edits", () => {
    const cache = createFormatComparisonCache();
    const mutableConfig = { ...config };
    const mutableRows = structuredClone(rows);
    cache.put(mutableConfig, mutableRows);
    mutableConfig.roi = 0.3;
    mutableRows[0].downsideCurve[0].minBI = 999;
    const restored = cache.get(config)!;
    expect(restored).toEqual(rows);
    restored[0].downsideCurve[0].minBI = 888;
    expect(cache.get(config)).toEqual(rows);
  });

  it("never reuses a report after any calculation input changes", () => {
    const cache = createFormatComparisonCache();
    cache.put(config, rows);
    for (const key of Object.keys(config) as (keyof typeof config)[]) {
      expect(cache.get({ ...config, [key]: config[key] + 1 })).toBeUndefined();
    }
  });

  it("retains only the three most recently used complete reports", () => {
    const cache = createFormatComparisonCache();
    cache.put(config, rows);
    cache.put({ ...config, seed: 2 }, rows);
    cache.put({ ...config, seed: 3 }, rows);
    expect(cache.get(config)).toEqual(rows);
    cache.put({ ...config, seed: 4 }, rows);
    expect(cache.get({ ...config, seed: 2 })).toBeUndefined();
    expect(cache.get(config)).toEqual(rows);
    expect(cache.get({ ...config, seed: 3 })).toEqual(rows);
    expect(cache.get({ ...config, seed: 4 })).toEqual(rows);
  });

  it("does not cache incomplete or duplicated format sets", () => {
    const cache = createFormatComparisonCache();
    cache.put(config, rows.slice(0, 4));
    expect(cache.get(config)).toBeUndefined();
    cache.put(config, [...rows.slice(0, 4), rows[0]]);
    expect(cache.get(config)).toBeUndefined();
    expect(() => createFormatComparisonCache(-1)).toThrow();
  });
});
