import { describe, it, expect } from "vitest";
import {
  applyItmTopHeavyToFreeBand,
  clampItmTopHeavyBias,
  ITM_TOP_HEAVY_BIAS_STEP,
  MAX_ITM_TOP_HEAVY_BIAS,
  MIN_ITM_TOP_HEAVY_BIAS,
} from "./itmTopHeavy";

describe("clampItmTopHeavyBias", () => {
  it("returns 0 for non-finite input", () => {
    expect(clampItmTopHeavyBias(NaN)).toBe(0);
    expect(clampItmTopHeavyBias(Infinity)).toBe(0);
    expect(clampItmTopHeavyBias(-Infinity)).toBe(0);
  });

  it("clamps below MIN to MIN", () => {
    expect(clampItmTopHeavyBias(-2)).toBe(MIN_ITM_TOP_HEAVY_BIAS);
    expect(clampItmTopHeavyBias(-100)).toBe(MIN_ITM_TOP_HEAVY_BIAS);
  });

  it("clamps above MAX to MAX", () => {
    expect(clampItmTopHeavyBias(2)).toBe(MAX_ITM_TOP_HEAVY_BIAS);
    expect(clampItmTopHeavyBias(100)).toBe(MAX_ITM_TOP_HEAVY_BIAS);
  });

  it("passes through values inside the band", () => {
    expect(clampItmTopHeavyBias(0)).toBe(0);
    expect(clampItmTopHeavyBias(0.5)).toBe(0.5);
    expect(clampItmTopHeavyBias(-0.7)).toBe(-0.7);
    expect(clampItmTopHeavyBias(MAX_ITM_TOP_HEAVY_BIAS)).toBe(MAX_ITM_TOP_HEAVY_BIAS);
    expect(clampItmTopHeavyBias(MIN_ITM_TOP_HEAVY_BIAS)).toBe(MIN_ITM_TOP_HEAVY_BIAS);
  });

  it("step granularity matches the slider's wire step", () => {
    expect(ITM_TOP_HEAVY_BIAS_STEP).toBe(0.05);
    expect(MIN_ITM_TOP_HEAVY_BIAS).toBe(-1);
    expect(MAX_ITM_TOP_HEAVY_BIAS).toBe(1);
  });
});

describe("applyItmTopHeavyToFreeBand", () => {
  function makeBand(values: number[]): Float64Array {
    const f = new Float64Array(values.length);
    for (let i = 0; i < values.length; i++) f[i] = values[i];
    return f;
  }

  it("zero bias is identity (band unchanged, freeSum equals sum of free indices)", () => {
    const band = makeBand([0.10, 0.08, 0.06, 0.04, 0.02]);
    const freeIdx = [0, 1, 2, 3, 4];
    const { adjusted, freeSum } = applyItmTopHeavyToFreeBand(band, freeIdx, 0);
    expect(Array.from(adjusted)).toEqual(Array.from(band));
    expect(freeSum).toBeCloseTo(0.30, 9);
    // input band shouldn't be mutated
    expect(band[0]).toBe(0.10);
  });

  it("empty freeIndices returns adjusted=band, freeSum=0", () => {
    const band = makeBand([0.10, 0.08]);
    const { adjusted, freeSum } = applyItmTopHeavyToFreeBand(band, [], 0.5);
    expect(Array.from(adjusted)).toEqual(Array.from(band));
    expect(freeSum).toBe(0);
  });

  it("single free index is unchanged regardless of bias (no rank to skew)", () => {
    const band = makeBand([0.10, 0.08, 0.06]);
    const { adjusted, freeSum } = applyItmTopHeavyToFreeBand(band, [1], 1);
    expect(adjusted[0]).toBeCloseTo(0.10, 12);
    expect(adjusted[1]).toBeCloseTo(0.08, 12);
    expect(adjusted[2]).toBeCloseTo(0.06, 12);
    expect(freeSum).toBeCloseTo(0.08, 12);
  });

  it("positive bias amplifies the END of freeIndices (upstream convention: end = top placement)", () => {
    const band = makeBand([0.10, 0.10, 0.10, 0.10, 0.10]);
    const freeIdx = [0, 1, 2, 3, 4];
    const { adjusted } = applyItmTopHeavyToFreeBand(band, freeIdx, 1);
    expect(adjusted[freeIdx[0]]).toBeLessThan(0.10);
    expect(adjusted[freeIdx[freeIdx.length - 1]]).toBeGreaterThan(0.10);
    // Monotonically increasing across freeIdx order (rank goes from +1 to −1,
    // strength = −clamped*2.2, so positive bias raises higher orders).
    for (let i = 1; i < freeIdx.length; i++) {
      expect(adjusted[freeIdx[i]]).toBeGreaterThan(adjusted[freeIdx[i - 1]] - 1e-12);
    }
  });

  it("negative bias amplifies the START of freeIndices", () => {
    const band = makeBand([0.10, 0.10, 0.10, 0.10, 0.10]);
    const freeIdx = [0, 1, 2, 3, 4];
    const { adjusted } = applyItmTopHeavyToFreeBand(band, freeIdx, -1);
    expect(adjusted[freeIdx[0]]).toBeGreaterThan(0.10);
    expect(adjusted[freeIdx[freeIdx.length - 1]]).toBeLessThan(0.10);
    for (let i = 1; i < freeIdx.length; i++) {
      expect(adjusted[freeIdx[i]]).toBeLessThan(adjusted[freeIdx[i - 1]] + 1e-12);
    }
  });

  it("bias = +1 vs -1 produce inverse skews (composition is symmetric around the middle)", () => {
    const band = makeBand([0.10, 0.10, 0.10]);
    const pos = applyItmTopHeavyToFreeBand(band, [0, 1, 2], 1);
    const neg = applyItmTopHeavyToFreeBand(band, [0, 1, 2], -1);
    // Middle index unchanged for both
    expect(pos.adjusted[1]).toBeCloseTo(neg.adjusted[1], 9);
    // Endpoints swap
    expect(pos.adjusted[0]).toBeCloseTo(neg.adjusted[2], 9);
    expect(pos.adjusted[2]).toBeCloseTo(neg.adjusted[0], 9);
  });

  it("bias clamps beyond [-1, +1] (no runaway exponentials)", () => {
    const band = makeBand([0.10, 0.10, 0.10, 0.10, 0.10]);
    const at1 = applyItmTopHeavyToFreeBand(band, [0, 1, 2, 3, 4], 1);
    const at100 = applyItmTopHeavyToFreeBand(band, [0, 1, 2, 3, 4], 100);
    for (let i = 0; i < 5; i++) {
      expect(at100.adjusted[i]).toBeCloseTo(at1.adjusted[i], 12);
    }
  });

  it("freeSum reflects the post-bias sum across only the free indices", () => {
    const band = makeBand([0.10, 0.10, 0.10, 0.10]);
    const freeIdx = [1, 2]; // skip first and last (pinned)
    const { adjusted, freeSum } = applyItmTopHeavyToFreeBand(band, freeIdx, 0.5);
    // pinned positions unchanged
    expect(adjusted[0]).toBeCloseTo(0.10, 12);
    expect(adjusted[3]).toBeCloseTo(0.10, 12);
    // freeSum is sum over freeIdx only
    expect(freeSum).toBeCloseTo(adjusted[1] + adjusted[2], 12);
  });

  it("non-free indices are never modified even at extreme bias", () => {
    const band = makeBand([0.50, 0.10, 0.10, 0.10, 0.50]);
    const freeIdx = [1, 2, 3];
    const { adjusted } = applyItmTopHeavyToFreeBand(band, freeIdx, 1);
    expect(adjusted[0]).toBe(0.50);
    expect(adjusted[4]).toBe(0.50);
  });

  it("non-uniform input band: negative bias preserves descending rank when input is descending", () => {
    // Negative bias amplifies start of freeIndices, dampens end — same direction
    // as the input gradient (descending), so monotonicity is preserved.
    const band = makeBand([0.20, 0.15, 0.10, 0.05]);
    const freeIdx = [0, 1, 2, 3];
    const { adjusted } = applyItmTopHeavyToFreeBand(band, freeIdx, -0.5);
    for (let i = 1; i < freeIdx.length; i++) {
      expect(adjusted[freeIdx[i]]).toBeLessThan(adjusted[freeIdx[i - 1]]);
    }
  });

  it("result is a fresh Float64Array (input band not mutated)", () => {
    const band = makeBand([0.10, 0.10, 0.10]);
    const original = Array.from(band);
    applyItmTopHeavyToFreeBand(band, [0, 1, 2], 0.7);
    expect(Array.from(band)).toEqual(original);
  });
});
