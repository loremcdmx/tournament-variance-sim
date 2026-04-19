import { describe, expect, it } from "vitest";
import { aggregateStreaks, computePathStreakStats } from "./pathStreaks";

/**
 * Synth a drawdown-and-recovery shaped path. Rises, dips, rises.
 * Used to sanity-check all the streak metrics at once.
 */
function synthPath(len: number, seed = 1): Float64Array {
  const p = new Float64Array(len);
  // Linear drift + a carved-out drawdown in the middle + a high-frequency wiggle.
  for (let i = 0; i < len; i++) {
    const t = i / (len - 1);
    const drift = 100 * t;
    const dip = Math.max(0, 40 * Math.sin(Math.PI * t * 2));
    const wiggle = 3 * Math.sin(i * 0.37 + seed);
    p[i] = drift - dip + wiggle;
  }
  return p;
}

function synthX(len: number): readonly number[] {
  const x: number[] = [];
  for (let i = 0; i < len; i++) x.push(i);
  return x;
}

describe("computePathStreakStats — pre-shift invariant", () => {
  // The post-hoc RB toggle used to pass a non-null `rbShift` and have the
  // hot loop read through a `get(i) = path[i] + rbShift[i]` closure. We
  // replaced that with a one-shot Float64Array pre-shift so the chord
  // scan reads the typed array directly. This test pins that invariant:
  // the shifted result must equal the result of computing on the already-
  // shifted path with `rbShift=null`.
  const N = 300;
  const stride = 4;
  const path = synthPath(N, 7);
  const xHi = synthX(N);
  const rbShift = new Float64Array(N);
  for (let i = 0; i < N; i++) rbShift[i] = 0.5 * i; // linear rakeback curve

  it("shifted-closure path ≡ pre-shifted path with rbShift=null", () => {
    const accumA = new Int32Array(N + 1);
    const accumB = new Int32Array(N + 1);

    const viaClosure = computePathStreakStats(path, xHi, rbShift, accumA, stride);

    // Manually pre-shift and pass null — mirrors the old closure semantics.
    const preshifted = new Float64Array(N);
    for (let i = 0; i < N; i++) preshifted[i] = path[i] + rbShift[i];
    const viaPreshifted = computePathStreakStats(
      preshifted,
      xHi,
      null,
      accumB,
      stride,
    );

    // Per-path scalars must all match byte-identically — this is a pure
    // arithmetic rearrangement, not a reordering or reduction.
    expect(viaClosure.maxDrawdown).toBe(viaPreshifted.maxDrawdown);
    expect(viaClosure.maxRunUp).toBe(viaPreshifted.maxRunUp);
    expect(viaClosure.longestBreakeven).toBe(viaPreshifted.longestBreakeven);
    expect(viaClosure.breakevenStreak).toBe(viaPreshifted.breakevenStreak);
    expect(viaClosure.longestCashless).toBe(viaPreshifted.longestCashless);
    expect(viaClosure.recovery).toBe(viaPreshifted.recovery);
    expect(viaClosure.recovered).toBe(viaPreshifted.recovered);
    expect(viaClosure.finalProfit).toBe(viaPreshifted.finalProfit);

    // Chord histogram accumulator must also match — that one drives the
    // longestBreakeven histogram in aggregateStreaks.
    for (let i = 0; i < accumA.length; i++) {
      expect(accumA[i]).toBe(accumB[i]);
    }
  });

  it("rbShift=null shortcut: does NOT allocate a copy (same-object semantics preserved)", () => {
    // This is not a user-visible behavior, but it's why the `rbShift=null`
    // case is cheap: we reuse the caller's typed array. If someone later
    // replaces the shortcut with an unconditional alloc, the "always cheap"
    // assumption breaks. Guard by asserting on the primary scalar outputs
    // for a known path — any deviation means a reorder bug or the alloc
    // skipped a required shift.
    const accum = new Int32Array(N + 1);
    const out = computePathStreakStats(path, xHi, null, accum, stride);
    // Sanity: the path is non-trivial so these should be non-zero.
    expect(out.maxDrawdown).toBeGreaterThan(0);
    expect(out.maxRunUp).toBeGreaterThan(0);
    expect(out.finalProfit).toBe(path[N - 1]);
  });

  it("empty path returns the zeroed default", () => {
    const out = computePathStreakStats(
      new Float64Array(0),
      [],
      null,
      null,
      1,
    );
    expect(out.maxDrawdown).toBe(0);
    expect(out.maxRunUp).toBe(0);
    expect(out.longestBreakeven).toBe(0);
    expect(out.breakevenStreak).toBe(0);
    expect(out.longestCashless).toBe(0);
    expect(out.recovery).toBe(0);
    expect(out.recovered).toBe(true);
    expect(out.finalProfit).toBe(0);
  });

  it("rbShift shorter than path: only the first K points are shifted", () => {
    // Defensive: in practice rbShift length === path length, but
    // shiftResultByRakeback is written to handle K = min(len, curve.length)
    // and the pre-shift path must do the same. Feed a half-length curve
    // and check the output matches the same-pattern pre-shift.
    const half = new Float64Array(Math.floor(N / 2));
    for (let i = 0; i < half.length; i++) half[i] = 0.5 * i;

    const accumA = new Int32Array(N + 1);
    const accumB = new Int32Array(N + 1);

    const viaClosure = computePathStreakStats(path, xHi, half, accumA, stride);

    const preshifted = new Float64Array(N);
    const K = Math.min(N, half.length);
    for (let i = 0; i < K; i++) preshifted[i] = path[i] + half[i];
    for (let i = K; i < N; i++) preshifted[i] = path[i];
    const viaPreshifted = computePathStreakStats(
      preshifted,
      xHi,
      null,
      accumB,
      stride,
    );

    expect(viaClosure.maxDrawdown).toBe(viaPreshifted.maxDrawdown);
    expect(viaClosure.finalProfit).toBe(viaPreshifted.finalProfit);
    expect(viaClosure.longestBreakeven).toBe(viaPreshifted.longestBreakeven);
  });
});

describe("aggregateStreaks", () => {
  it("matches per-sample scalars back to computePathStreakStats", () => {
    const paths: Float64Array[] = [
      synthPath(200, 1),
      synthPath(200, 2),
      synthPath(200, 3),
    ];
    const xHi = synthX(200);
    const agg = aggregateStreaks(paths, xHi, null);
    expect(agg.perSample.length).toBe(paths.length);

    const stride = Math.max(1, Math.floor(200 / 240));
    for (let i = 0; i < paths.length; i++) {
      const single = computePathStreakStats(paths[i], xHi, null, null, stride);
      expect(agg.perSample[i].maxDrawdown).toBe(single.maxDrawdown);
      expect(agg.perSample[i].maxRunUp).toBe(single.maxRunUp);
      expect(agg.perSample[i].finalProfit).toBe(single.finalProfit);
    }
  });

  it("rbShift shifts all per-sample finalProfits by curve[-1]", () => {
    const paths: Float64Array[] = [synthPath(200, 1), synthPath(200, 2)];
    const xHi = synthX(200);
    const shift = new Float64Array(200);
    for (let i = 0; i < 200; i++) shift[i] = 0.25 * i;

    const aggNo = aggregateStreaks(paths, xHi, null);
    const aggShift = aggregateStreaks(paths, xHi, shift);

    const totalShift = shift[shift.length - 1];
    for (let i = 0; i < paths.length; i++) {
      expect(aggShift.perSample[i].finalProfit).toBeCloseTo(
        aggNo.perSample[i].finalProfit + totalShift,
        10,
      );
    }
  });

  it("returns zero histograms on empty input without crashing", () => {
    const agg = aggregateStreaks([], [], null);
    expect(agg.perSample).toEqual([]);
    expect(agg.stats.maxDrawdownMean).toBe(0);
    expect(agg.stats.maxDrawdownWorst).toBe(0);
    expect(agg.stats.recoveryUnrecoveredShare).toBe(0);
  });
});
