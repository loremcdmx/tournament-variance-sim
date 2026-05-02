import { describe, it, expect } from "vitest";
import {
  computeNextRate,
  RATE_EMA_WEIGHT,
  RATE_OUTLIER_FACTOR,
} from "./rateUpdate";

describe("computeNextRate — fresh runs", () => {
  it("first-ever run (prevRate=null) accepts observation as-is", () => {
    const out = computeNextRate({ elapsedMs: 1000, work: 50_000, prevRate: null });
    expect(out.nextRate).toBeCloseTo(0.02, 9);
  });

  it("first-ever with weird small work returns the raw observed rate", () => {
    const out = computeNextRate({ elapsedMs: 100, work: 1, prevRate: null });
    expect(out.nextRate).toBe(100);
  });
});

describe("computeNextRate — invalid inputs", () => {
  it("rejects elapsedMs ≤ 0", () => {
    expect(computeNextRate({ elapsedMs: 0, work: 100, prevRate: null }))
      .toEqual({ nextRate: null, reason: "invalid" });
    expect(computeNextRate({ elapsedMs: -1, work: 100, prevRate: null }))
      .toEqual({ nextRate: null, reason: "invalid" });
  });

  it("rejects work ≤ 0", () => {
    expect(computeNextRate({ elapsedMs: 1000, work: 0, prevRate: null }))
      .toEqual({ nextRate: null, reason: "invalid" });
  });

  it("rejects non-finite inputs", () => {
    expect(computeNextRate({ elapsedMs: NaN, work: 100, prevRate: null }))
      .toEqual({ nextRate: null, reason: "invalid" });
    expect(computeNextRate({ elapsedMs: Infinity, work: 100, prevRate: null }))
      .toEqual({ nextRate: null, reason: "invalid" });
  });
});

describe("computeNextRate — EMA blending in steady state", () => {
  it("blends observed and prevRate with EMA weight 0.6", () => {
    // observed = 1000/50_000 = 0.02
    // prev = 0.025
    // ratio = 0.02/0.025 = 0.8, in-range
    // blend = 0.6 × 0.02 + 0.4 × 0.025 = 0.012 + 0.010 = 0.022
    const out = computeNextRate({
      elapsedMs: 1000,
      work: 50_000,
      prevRate: 0.025,
    });
    expect(out.nextRate).toBeCloseTo(0.022, 9);
    expect(out.reason).toBeUndefined();
  });

  it("returns prevRate when observation is identical", () => {
    const out = computeNextRate({
      elapsedMs: 1000,
      work: 50_000,
      prevRate: 0.02,
    });
    expect(out.nextRate).toBeCloseTo(0.02, 9);
  });

  it("EMA weight constant matches imported value", () => {
    expect(RATE_EMA_WEIGHT).toBe(0.6);
  });
});

describe("computeNextRate — outlier rejection", () => {
  it("accepts observations within the cap factor (e.g. 2x is in-range)", () => {
    // prev=0.020, observed=0.040 → ratio=2.0 < 2.5
    const out = computeNextRate({
      elapsedMs: 2000,
      work: 50_000,
      prevRate: 0.020,
    });
    expect(out.nextRate).not.toBeNull();
    // 0.6 × 0.040 + 0.4 × 0.020 = 0.024 + 0.008 = 0.032
    expect(out.nextRate).toBeCloseTo(0.032, 9);
  });

  it("rejects 3x slowdown as outlier-high", () => {
    // prev=0.020, observed=0.060 → ratio=3.0 > 2.5
    const out = computeNextRate({
      elapsedMs: 3000,
      work: 50_000,
      prevRate: 0.020,
    });
    expect(out.nextRate).toBeNull();
    expect(out.reason).toBe("outlier-high");
  });

  it("rejects extreme slowdown (10x — backgrounded tab)", () => {
    // prev=0.020, observed=0.200 → ratio=10.0 way over
    const out = computeNextRate({
      elapsedMs: 10_000,
      work: 50_000,
      prevRate: 0.020,
    });
    expect(out.nextRate).toBeNull();
    expect(out.reason).toBe("outlier-high");
  });

  it("rejects 3x speedup as outlier-low (e.g. caching artifact)", () => {
    // prev=0.060, observed=0.020 → ratio=1/3 < 1/2.5
    const out = computeNextRate({
      elapsedMs: 1000,
      work: 50_000,
      prevRate: 0.060,
    });
    expect(out.nextRate).toBeNull();
    expect(out.reason).toBe("outlier-low");
  });

  it("custom outlierFactor allows tighter / looser caps", () => {
    // With factor 1.5, ratio=2.0 is now an outlier
    const out = computeNextRate({
      elapsedMs: 2000,
      work: 50_000,
      prevRate: 0.020,
      outlierFactor: 1.5,
    });
    expect(out.nextRate).toBeNull();
    expect(out.reason).toBe("outlier-high");
  });

  it("default outlier factor matches imported constant", () => {
    expect(RATE_OUTLIER_FACTOR).toBe(2.5);
  });
});

describe("computeNextRate — convergence under repeated observations", () => {
  it("steady true rate converges quickly even with EMA weight 0.6", () => {
    let rate: number | null = 0.030; // bad starting estimate
    for (let i = 0; i < 8; i++) {
      // True rate is 0.020; each run reports it
      const out = computeNextRate({
        elapsedMs: 1000,
        work: 50_000,
        prevRate: rate,
      });
      if (out.nextRate != null) rate = out.nextRate;
    }
    // After 8 steady observations should be very close to true 0.020
    expect(rate).toBeCloseTo(0.020, 4);
  });

  it("a single outlier doesn't poison the cache", () => {
    let rate: number | null = 0.020;
    // 5 normal observations
    for (let i = 0; i < 5; i++) {
      const out = computeNextRate({
        elapsedMs: 1000,
        work: 50_000,
        prevRate: rate,
      });
      if (out.nextRate != null) rate = out.nextRate;
    }
    const beforeOutlier = rate!;
    // Outlier: tab backgrounded, takes 10×
    const outlier = computeNextRate({
      elapsedMs: 10_000,
      work: 50_000,
      prevRate: rate,
    });
    // Outlier rejected — rate unchanged
    expect(outlier.nextRate).toBeNull();
    expect(rate).toBe(beforeOutlier);
  });

  it("a sustained shift catches up over a few runs", () => {
    // Machine got 1.5x slower (but within cap); rate should settle near 1.5x
    let rate: number | null = 0.020;
    for (let i = 0; i < 10; i++) {
      const out = computeNextRate({
        elapsedMs: 1500, // 0.030 observed
        work: 50_000,
        prevRate: rate,
      });
      if (out.nextRate != null) rate = out.nextRate;
    }
    expect(rate).toBeCloseTo(0.030, 3);
  });
});
