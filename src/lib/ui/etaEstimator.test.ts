import { describe, expect, it } from "vitest";
import {
  BLEND_COMPLETE_AT_PROGRESS,
  PROJECTION_MIN_PROGRESS,
  TAIL_CUTOFF_MS,
  TAU_MID_MS,
  TAU_TAIL_MS,
  computeRemainingMs,
} from "./etaEstimator";

describe("computeRemainingMs", () => {
  it("returns null when there is nothing to estimate from yet", () => {
    const out = computeRemainingMs({
      elapsedMs: 0,
      progress: 0,
      estimatedMs: null,
      prevSmoothedMs: null,
      dtMs: 0,
    });
    expect(out).toBeNull();
  });

  it("uses bootstrap only when projection isn't trustworthy yet", () => {
    // progress below the floor — projection is too noisy to use.
    const out = computeRemainingMs({
      elapsedMs: 100,
      progress: PROJECTION_MIN_PROGRESS / 2,
      estimatedMs: 2000,
      prevSmoothedMs: null,
      dtMs: 16,
    });
    // raw = tEst - elapsed = 2000 - 100 = 1900
    expect(out).toBe(1900);
  });

  it("uses pure projection once blend weight hits 1", () => {
    // Equal or past the crossover → w=1, projection dominates.
    // elapsed=1000, progress=0.5 → projection=2000, raw=1000.
    const out = computeRemainingMs({
      elapsedMs: 1000,
      progress: BLEND_COMPLETE_AT_PROGRESS,
      estimatedMs: 10_000, // deliberately wildly wrong — should be ignored
      prevSmoothedMs: null,
      dtMs: 16,
    });
    expect(out).toBe(1000);
  });

  it("blends bootstrap and projection linearly in between", () => {
    // progress=0.25, weight = 0.25/0.5 = 0.5.
    // projection = 400/0.25 = 1600 → raw-projection = 1200
    // bootstrap = 2000 → raw-bootstrap = 1600
    // blended tEst = 0.5·2000 + 0.5·1600 = 1800, raw = 1400
    const out = computeRemainingMs({
      elapsedMs: 400,
      progress: 0.25,
      estimatedMs: 2000,
      prevSmoothedMs: null,
      dtMs: 16,
    });
    expect(out).toBeCloseTo(1400, 6);
  });

  it("never returns a negative raw estimate (clamps to 0)", () => {
    // Bootstrap underestimated the run; once elapsed overshoots it and
    // no projection is trustworthy yet, raw should clamp to 0 rather
    // than report a negative remaining.
    const out = computeRemainingMs({
      elapsedMs: 3000,
      progress: PROJECTION_MIN_PROGRESS / 2,
      estimatedMs: 2000,
      prevSmoothedMs: null,
      dtMs: 16,
    });
    expect(out).toBe(0);
  });

  it("ticks down monotonically by wall-clock dt when raw rises", () => {
    // Projection jitters up, but the display must not jump backwards.
    // prev=1000 ms, raw should be higher → emit prev - dt = 984.
    const out = computeRemainingMs({
      elapsedMs: 0, // forced high projection
      progress: 0.1,
      estimatedMs: 5000,
      prevSmoothedMs: 1000,
      dtMs: 16,
    });
    expect(out).toBe(984);
  });

  it("never emits below zero when counting down with large dt", () => {
    const out = computeRemainingMs({
      elapsedMs: 0,
      progress: 0.1,
      estimatedMs: 5000,
      prevSmoothedMs: 20,
      dtMs: 500,
    });
    expect(out).toBe(0);
  });

  it("uses the mid-run τ when prev is above the tail cutoff", () => {
    // Pick elapsed/progress so raw is well below prev so we exercise the
    // smoothing branch. prev=5000 (> cutoff → τ=400).
    const elapsedMs = 1000;
    const progress = 0.5;
    const prevSmoothedMs = 5000;
    const dtMs = 100;
    const out = computeRemainingMs({
      elapsedMs,
      progress,
      estimatedMs: null,
      prevSmoothedMs,
      dtMs,
    });
    // projection = 2000, raw = 1000. α = 1 - e^(-100/400).
    const alpha = 1 - Math.exp(-dtMs / TAU_MID_MS);
    const expected = alpha * 1000 + (1 - alpha) * prevSmoothedMs;
    expect(out).toBeCloseTo(expected, 6);
  });

  it("switches to the tail τ once prev drops below the cutoff", () => {
    // prev=1000 (< 1500 → τ=150), raw well below prev → smoothing applies.
    const elapsedMs = 900;
    const progress = 0.5;
    const prevSmoothedMs = 1000;
    const dtMs = 100;
    const out = computeRemainingMs({
      elapsedMs,
      progress,
      estimatedMs: null,
      prevSmoothedMs,
      dtMs,
    });
    // projection = 1800, raw = 900. α = 1 - e^(-100/150).
    const alpha = 1 - Math.exp(-dtMs / TAU_TAIL_MS);
    const expected = alpha * 900 + (1 - alpha) * prevSmoothedMs;
    expect(out).toBeCloseTo(expected, 6);
    // Sanity: tail τ should make the display move faster than mid τ for
    // the same inputs — verify by recomputing with mid τ and comparing
    // distance from prev.
    const midAlpha = 1 - Math.exp(-dtMs / TAU_MID_MS);
    const midOut = midAlpha * 900 + (1 - midAlpha) * prevSmoothedMs;
    expect(prevSmoothedMs - expected).toBeGreaterThan(
      prevSmoothedMs - midOut,
    );
  });

  it("never reinflates above prev when raw climbs (monotonic)", () => {
    // Simulate 20 steps of climbing raw → smoothed must be non-increasing.
    let prev: number | null = 3000;
    const history: number[] = [prev];
    for (let i = 0; i < 20; i++) {
      const next = computeRemainingMs({
        elapsedMs: 0,
        progress: 0.1,
        estimatedMs: 10_000 + i * 500, // projection keeps rising
        prevSmoothedMs: prev,
        dtMs: 16,
      });
      expect(next).not.toBeNull();
      expect(next!).toBeLessThanOrEqual(prev!);
      prev = next;
      history.push(next!);
    }
    // Total drop should be 20 · 16 = 320 ms (pure dt countdown).
    expect(history[0] - history[history.length - 1]).toBeCloseTo(320, 6);
  });

  it("keeps TAIL_CUTOFF, TAU_TAIL, and TAU_MID in the expected ordering", () => {
    // Sanity on the constants so a future tweak is forced through the test.
    expect(TAU_TAIL_MS).toBeLessThan(TAU_MID_MS);
    expect(TAIL_CUTOFF_MS).toBeGreaterThan(0);
    expect(PROJECTION_MIN_PROGRESS).toBeGreaterThan(0);
    expect(PROJECTION_MIN_PROGRESS).toBeLessThan(
      BLEND_COMPLETE_AT_PROGRESS,
    );
  });
});
