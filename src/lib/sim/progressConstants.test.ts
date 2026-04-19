import { describe, expect, it } from "vitest";
import { BUILD_PROGRESS_CAP, shardProgressFracFor } from "./progressConstants";

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
