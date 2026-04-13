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
