import { describe, expect, it } from "vitest";
import {
  BUILD_PROGRESS_CAP,
  nextBuildShare,
  shardFracFromBuildShare,
  shardProgressFracFor,
} from "./progressConstants";

describe("progress constants", () => {
  it("keeps build progress below the final done tick", () => {
    expect(BUILD_PROGRESS_CAP).toBeGreaterThan(0.95);
    expect(BUILD_PROGRESS_CAP).toBeLessThan(1);
  });

  it("reserves more tail headroom as sample count grows", () => {
    const at10k = shardProgressFracFor(10_000);
    const at100k = shardProgressFracFor(100_000);
    const at1m = shardProgressFracFor(1_000_000);
    const at10m = shardProgressFracFor(10_000_000);

    expect(at10k).toBeCloseTo(0.8, 6);
    expect(at100k).toBeCloseTo(0.7, 6);
    expect(at1m).toBeCloseTo(0.6, 6);
    expect(at10m).toBeCloseTo(0.55, 6);
  });

  it("never allocates a negative or tiny shard phase", () => {
    expect(shardProgressFracFor(0)).toBeGreaterThan(0.5);
    expect(shardProgressFracFor(1)).toBeGreaterThan(0.5);
    expect(shardProgressFracFor(Number.NaN)).toBeGreaterThan(0.5);
  });
});

describe("nextBuildShare", () => {
  it("first observation is clamped and taken as-is", () => {
    expect(nextBuildShare(null, 0.12)).toBeCloseTo(0.12, 12);
    expect(nextBuildShare(null, 0.001)).toBeCloseTo(0.02, 12);
    expect(nextBuildShare(null, 0.9)).toBeCloseTo(0.85, 12);
  });

  it("blends 50/50 with the previous cache", () => {
    expect(nextBuildShare(0.1, 0.2)).toBeCloseTo(0.15, 12);
  });

  it("one pathological run cannot push the cache past the clamp", () => {
    expect(nextBuildShare(0.8, 0.99)).toBeCloseTo(0.825, 12);
    expect(nextBuildShare(0.85, 0.99)).toBeCloseTo(0.85, 12);
  });
});

describe("shardFracFromBuildShare", () => {
  it("falls back to the samples heuristic when unmeasured", () => {
    expect(shardFracFromBuildShare(null, 10_000)).toBe(
      shardProgressFracFor(10_000),
    );
    expect(shardFracFromBuildShare(0, 10_000)).toBe(
      shardProgressFracFor(10_000),
    );
  });

  it("time-linear seam: share of the capped bar equals the build share", () => {
    // 10% build time → seam at 0.9 · cap, so the bar moves at one speed.
    expect(shardFracFromBuildShare(0.1, 10_000)).toBeCloseTo(
      0.9 * BUILD_PROGRESS_CAP,
      12,
    );
  });

  it("clamps to [0.12, 0.95] so neither phase collapses visually", () => {
    expect(shardFracFromBuildShare(0.85, 10_000)).toBeGreaterThanOrEqual(0.12);
    expect(shardFracFromBuildShare(0.02, 10_000)).toBeLessThanOrEqual(0.95);
  });

  it("honors a measured build-dominated run (65% build → seam ≈ 0.34)", () => {
    expect(shardFracFromBuildShare(0.65, 200_000)).toBeCloseTo(
      0.35 * BUILD_PROGRESS_CAP,
      12,
    );
  });
});
