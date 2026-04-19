import { describe, expect, it } from "vitest";
import { composeProgress } from "./progressAggregation";
import { BUILD_PROGRESS_CAP } from "./progressConstants";

describe("composeProgress", () => {
  it("reports 0 at the start of the shard phase", () => {
    expect(
      composeProgress({
        shardDone: 0,
        shardTotal: 10_000,
        shardFrac: 0.8,
        buildFracs: new Map(),
        totalBuildsExpected: 0,
      }),
    ).toBe(0);
  });

  it("scales linearly within the shard phase up to shardFrac", () => {
    const out = composeProgress({
      shardDone: 2500,
      shardTotal: 10_000,
      shardFrac: 0.8,
      buildFracs: new Map(),
      totalBuildsExpected: 0,
    });
    expect(out).toBeCloseTo(0.2, 6);
  });

  it("ends the shard phase exactly at shardFrac", () => {
    const out = composeProgress({
      shardDone: 10_000,
      shardTotal: 10_000,
      shardFrac: 0.7,
      buildFracs: new Map(),
      totalBuildsExpected: 0,
    });
    expect(out).toBeCloseTo(0.7, 6);
  });

  it("jumps onto the build track once any build message arrives", () => {
    // First build-progress ticks in at 0.25 with 1 of 1 expected builds.
    const out = composeProgress({
      shardDone: 10_000, // shard done; irrelevant once builds start
      shardTotal: 10_000,
      shardFrac: 0.8,
      buildFracs: new Map([[1, 0.25]]),
      totalBuildsExpected: 1,
    });
    // headroom = BUILD_PROGRESS_CAP - 0.8 ≈ 0.185; at 0.25 avg → ~0.046 add.
    expect(out).toBeCloseTo(0.8 + (BUILD_PROGRESS_CAP - 0.8) * 0.25, 6);
  });

  it("averages across passes when both foreground + compare are building", () => {
    const out = composeProgress({
      shardDone: 0, // ignored in build phase
      shardTotal: 10_000,
      shardFrac: 0.6,
      buildFracs: new Map([
        [1, 0.4],
        [2, 0.8],
      ]),
      totalBuildsExpected: 2,
    });
    const avg = (0.4 + 0.8) / 2;
    expect(out).toBeCloseTo(0.6 + (BUILD_PROGRESS_CAP - 0.6) * avg, 6);
  });

  it("pegs at the cap when avg hits 1.0 (final snap is caller's job)", () => {
    const out = composeProgress({
      shardDone: 0,
      shardTotal: 10_000,
      shardFrac: 0.55,
      buildFracs: new Map([[1, 1.0]]),
      totalBuildsExpected: 1,
    });
    expect(out).toBeCloseTo(BUILD_PROGRESS_CAP, 6);
    expect(out).toBeLessThan(1);
  });

  it("clamps a noisy avg > 1 to the cap (defence in depth)", () => {
    const out = composeProgress({
      shardDone: 0,
      shardTotal: 10_000,
      shardFrac: 0.6,
      buildFracs: new Map([[1, 1.5]]), // worker shouldn't send >1 but if it does…
      totalBuildsExpected: 1,
    });
    expect(out).toBeCloseTo(BUILD_PROGRESS_CAP, 6);
  });

  it("ignores build map when totalBuildsExpected=0 (e.g. all single-pass)", () => {
    // Defensive: if no builds were ever announced, still track shard
    // progress cleanly even if buildFracs somehow has a stray entry.
    const out = composeProgress({
      shardDone: 500,
      shardTotal: 1000,
      shardFrac: 0.75,
      buildFracs: new Map([[1, 0.5]]),
      totalBuildsExpected: 0,
    });
    expect(out).toBeCloseTo(0.75 * 0.5, 6);
  });

  it("is monotonic as shard work completes within the shard phase", () => {
    const xs: number[] = [];
    for (let i = 0; i <= 10; i++) {
      xs.push(
        composeProgress({
          shardDone: i * 1000,
          shardTotal: 10_000,
          shardFrac: 0.8,
          buildFracs: new Map(),
          totalBuildsExpected: 0,
        }),
      );
    }
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1]);
    }
  });

  it("stays below 1 across all valid states (cap contract)", () => {
    const cases: Array<Parameters<typeof composeProgress>[0]> = [
      { shardDone: 10_000, shardTotal: 10_000, shardFrac: 0.8, buildFracs: new Map(), totalBuildsExpected: 0 },
      { shardDone: 0, shardTotal: 10_000, shardFrac: 0.55, buildFracs: new Map([[1, 1.0]]), totalBuildsExpected: 1 },
      { shardDone: 0, shardTotal: 10_000, shardFrac: 0.55, buildFracs: new Map([[1, 1.0], [2, 1.0]]), totalBuildsExpected: 2 },
    ];
    for (const c of cases) {
      expect(composeProgress(c)).toBeLessThan(1);
    }
  });

  it("honours a custom cap (parameterizable for future tests)", () => {
    const out = composeProgress({
      shardDone: 0,
      shardTotal: 10_000,
      shardFrac: 0.5,
      buildFracs: new Map([[1, 0.5]]),
      totalBuildsExpected: 1,
      cap: 0.9,
    });
    expect(out).toBeCloseTo(0.5 + (0.9 - 0.5) * 0.5, 6);
  });
});
