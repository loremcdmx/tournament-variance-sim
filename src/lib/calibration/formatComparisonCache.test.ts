import { describe, expect, it } from "vitest";
import { createFormatComparisonCache } from "./formatComparisonCache";
import { FORMAT_COMPARISON_DEFAULTS, type FormatComparisonSummary } from "./formatComparison";

const config = { ...FORMAT_COMPARISON_DEFAULTS };
const rows = ["freezeout", "pko", "mystery", "ocean-ko"].map(format => ({
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

  it("keeps the per-career maxima used for the shared risk grid as independent typed arrays", () => {
    const cache = createFormatComparisonCache();
    const withMaxima = structuredClone(rows);
    withMaxima[0].careerMaxima = { drawdownBI: Float64Array.of(1, 2, 3), evShortfallBI: Float64Array.of(4, 5, 6) };
    cache.put(config, withMaxima);
    withMaxima[0].careerMaxima.drawdownBI[0] = 99;
    const restored = cache.get(config)!;
    expect(restored[0].careerMaxima.drawdownBI).toBeInstanceOf(Float64Array);
    expect(Array.from(restored[0].careerMaxima.drawdownBI)).toEqual([1, 2, 3]);
    expect(Array.from(restored[0].careerMaxima.evShortfallBI)).toEqual([4, 5, 6]);
    restored[0].careerMaxima.evShortfallBI[0] = 77;
    expect(cache.get(config)![0].careerMaxima.evShortfallBI[0]).toBe(4);
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

  it("only caches the complete set of four distinct formats", () => {
    const cache = createFormatComparisonCache();
    cache.put(config, rows.slice(0, 3));
    expect(cache.get(config)).toBeUndefined();
    cache.put(config, [...rows.slice(0, 3), rows[0]]);
    expect(cache.get(config)).toBeUndefined();
    cache.put(config, [...rows, rows[0]]);
    expect(cache.get(config)).toBeUndefined();
    cache.put(config, rows);
    expect(cache.get(config)).toEqual(rows);
    expect(() => createFormatComparisonCache(-1)).toThrow();
  });
});
