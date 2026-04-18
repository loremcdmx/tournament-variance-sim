import { describe, it, expect } from "vitest";
import { makeBrTierSampler } from "./brBountyTiers";
import { mulberry32 } from "./rng";

describe("makeBrTierSampler", () => {
  const BUY_INS = [0.25, 1, 3, 10, 25];

  it.each(BUY_INS)("E[ratio] = 1 under the alias distribution for $%s", (buyIn) => {
    const s = makeBrTierSampler(buyIn);
    let expect1 = 0;
    for (let i = 0; i < s.ratios.length; i++) expect1 += s.probs[i] * s.ratios[i];
    expect(expect1).toBeCloseTo(1, 9);
  });

  it.each(BUY_INS)("probs sum to 1 for $%s", (buyIn) => {
    const s = makeBrTierSampler(buyIn);
    let sum = 0;
    for (const p of s.probs) sum += p;
    expect(sum).toBeCloseTo(1, 9);
  });

  it.each(BUY_INS)("Vose alias is well-formed for $%s", (buyIn) => {
    const s = makeBrTierSampler(buyIn);
    expect(s.aliasProb.length).toBe(10);
    expect(s.aliasIdx.length).toBe(10);
    for (let i = 0; i < 10; i++) {
      expect(s.aliasProb[i]).toBeGreaterThanOrEqual(0);
      expect(s.aliasProb[i]).toBeLessThanOrEqual(1);
      expect(s.aliasIdx[i]).toBeGreaterThanOrEqual(0);
      expect(s.aliasIdx[i]).toBeLessThan(10);
    }
  });

  it("MC mean converges to E[ratio] = 1 on 1M draws", () => {
    // Heavy tail: jackpot tier at ~10000× with freq ≈ 6e-7 contributes
    // half the mean. Hit count at N=1M is Poisson(0.6), so ±1 jackpot
    // hits moves the sample mean by ~1%. Loose tolerance is intentional.
    const s = makeBrTierSampler(1);
    const rng = mulberry32(0xdeadbeef);
    const N = 1_000_000;
    let acc = 0;
    for (let n = 0; n < N; n++) {
      const r = rng() * 10;
      const i = r | 0;
      const pick = r - i < s.aliasProb[i] ? i : s.aliasIdx[i];
      acc += s.ratios[pick];
    }
    const mcMean = acc / N;
    expect(Math.abs(mcMean - 1)).toBeLessThan(0.05);
  });

  it("jackpot tier sits at ~10000× at $1 buy-in", () => {
    const s = makeBrTierSampler(1);
    // $1 profile: top tier $10000, raw mean ≈ $0.945 → ratio ≈ 10582
    expect(s.ratios[0]).toBeGreaterThan(10000);
    expect(s.ratios[0]).toBeLessThan(11000);
    // Freq 60/1e8 → prob 6e-7 after normalisation
    expect(s.probs[0]).toBeGreaterThan(5e-7);
    expect(s.probs[0]).toBeLessThan(1e-6);
  });

  it("micro-stakes $0.25 profile tilts jackpot higher than $1", () => {
    const micro = makeBrTierSampler(0.25);
    const standard = makeBrTierSampler(1);
    expect(micro.ratios[0]).toBeGreaterThan(standard.ratios[0] * 1.5);
  });

  it("snap-to-nearest: sub-50¢ → $0.25 profile", () => {
    const s20c = makeBrTierSampler(0.2);
    const s25c = makeBrTierSampler(0.25);
    for (let i = 0; i < 10; i++) {
      expect(s20c.ratios[i]).toBeCloseTo(s25c.ratios[i], 9);
      expect(s20c.probs[i]).toBeCloseTo(s25c.probs[i], 15);
    }
    // $0.25 and $1 profiles differ — jackpot tier ratio is not close
    const s1 = makeBrTierSampler(1);
    expect(Math.abs(s20c.ratios[0] - s1.ratios[0])).toBeGreaterThan(5000);
  });

  it("above $25 → $25 profile", () => {
    const s100 = makeBrTierSampler(100);
    const s25 = makeBrTierSampler(25);
    for (let i = 0; i < 10; i++) {
      expect(s100.ratios[i]).toBeCloseTo(s25.ratios[i], 9);
    }
  });
});
