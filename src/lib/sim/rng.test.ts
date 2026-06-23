import { describe, it, expect } from "vitest";
import { mulberry32, mixSeed } from "./rng";

describe("mulberry32", () => {
  it("is deterministic given the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it("produces values in [0, 1)", () => {
    const r = mulberry32(1);
    for (let i = 0; i < 10_000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("has mean ≈ 0.5 over many samples", () => {
    const r = mulberry32(123);
    let sum = 0;
    const n = 100_000;
    for (let i = 0; i < n; i++) sum += r();
    const mean = sum / n;
    expect(mean).toBeGreaterThan(0.495);
    expect(mean).toBeLessThan(0.505);
  });

  it("is decorrelated across mixSeed sample indices", () => {
    const first = mulberry32(mixSeed(42, 0))();
    const second = mulberry32(mixSeed(42, 1))();
    expect(first).not.toBe(second);
  });
});

// Pearson correlation of two equal-length numeric arrays.
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i];
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
  }
  const cov = sxy / n - (sx / n) * (sy / n);
  const vx = sxx / n - (sx / n) * (sx / n);
  const vy = syy / n - (sy / n) * (sy / n);
  return cov / Math.sqrt(vx * vy);
}

// The engine derives per-channel streams by XOR-ing the base seed with fixed
// constants BEFORE mixSeed, then seeds an independent mulberry32 per sample.
// mulberry32 is known to correlate on nearby raw seeds, so the load-bearing
// claim is that mixSeed avalanches enough that these streams are independent.
// A plain inequality check (above) would pass even for a correlated generator;
// these assert actual statistical independence.
describe("mixSeed channel/sample decorrelation", () => {
  const SEED = 0xc0ffee;
  const CHANNEL_OFFSETS = [0, 0xbeef, 0xb01dface, 0x1eadeb0b];

  it("cross-channel first-draws are uncorrelated", () => {
    const N = 20_000;
    const streams = CHANNEL_OFFSETS.map((off) => {
      const out = new Array<number>(N);
      for (let s = 0; s < N; s++) out[s] = mulberry32(mixSeed((SEED ^ off) >>> 0, s))();
      return out;
    });
    for (let a = 0; a < streams.length; a++) {
      for (let b = a + 1; b < streams.length; b++) {
        expect(Math.abs(pearson(streams[a], streams[b]))).toBeLessThan(0.03);
      }
    }
  });

  it("consecutive-sample first-draws are uncorrelated", () => {
    const N = 20_000;
    const xs = new Array<number>(N);
    const ys = new Array<number>(N);
    for (let s = 0; s < N; s++) {
      xs[s] = mulberry32(mixSeed(SEED, s))();
      ys[s] = mulberry32(mixSeed(SEED, s + 1))();
    }
    expect(Math.abs(pearson(xs, ys))).toBeLessThan(0.03);
  });

  it("has ~zero lag-1 autocorrelation within a single stream", () => {
    const N = 50_000;
    const r = mulberry32(mixSeed(SEED, 7));
    const stream = new Array<number>(N);
    for (let i = 0; i < N; i++) stream[i] = r();
    expect(Math.abs(pearson(stream.slice(0, -1), stream.slice(1)))).toBeLessThan(0.02);
  });

  it("passes a 100-bin chi-square uniformity test", () => {
    const N = 100_000;
    const bins = 100;
    const counts = new Array<number>(bins).fill(0);
    const r = mulberry32(mixSeed(SEED, 11));
    for (let i = 0; i < N; i++) counts[Math.min(bins - 1, (r() * bins) | 0)]++;
    const expected = N / bins;
    let chi2 = 0;
    for (const c of counts) chi2 += (c - expected) * (c - expected) / expected;
    // df=99; even the 0.1% critical value is ~148. Generous bound; the seed is
    // fixed so the value is deterministic.
    expect(chi2).toBeLessThan(150);
  });
});
