import { describe, expect, it } from "vitest";
import { computeScalarStats } from "./resultStats";

// Right-skewed by construction: a fat cluster of small losses and two big
// scores, the shape of an MTT final-profit distribution.
const SKEWED = [-10, -8, -5, -3, -1, 0, 2, 4, 50, 120];
const S = SKEWED.length;
const N = 10;
const TOTAL_BUY_IN = 100;

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sampleSd(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(
    xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1),
  );
}

function g1Skewness(xs: number[]): number {
  const n = xs.length;
  const m = mean(xs);
  const sd = sampleSd(xs);
  const sumZ3 = xs.reduce((a, x) => a + ((x - m) / sd) ** 3, 0);
  return (n / ((n - 1) * (n - 2))) * sumZ3;
}

function g2Kurtosis(xs: number[]): number {
  const n = xs.length;
  const m = mean(xs);
  const sd = sampleSd(xs);
  const sumZ4 = xs.reduce((a, x) => a + ((x - m) / sd) ** 4, 0);
  const a = (n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3));
  const b = (3 * (n - 1) * (n - 1)) / ((n - 2) * (n - 3));
  return a * sumZ4 - b;
}

function quantile(xs: number[], p: number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(p * (sorted.length - 1))];
}

function stats(
  finals: number[],
  runningMins: number[],
  bankroll: number,
  totalBuyIn = TOTAL_BUY_IN,
) {
  return computeScalarStats(
    Float64Array.from(finals),
    Float64Array.from(runningMins),
    finals.length,
    N,
    bankroll,
    totalBuyIn,
  );
}

describe("computeScalarStats quantiles and tail risk", () => {
  const runningMins = SKEWED.map((v) => Math.min(0, v) - 1);
  const out = stats(SKEWED, runningMins, 0);

  it("reads p05 / p95 / min / max / median off the sorted sample", () => {
    expect(out.min).toBe(-10);
    expect(out.max).toBe(120);
    expect(out.median).toBe(quantile(SKEWED, 0.5));
    expect(out.p05).toBe(quantile(SKEWED, 0.05));
    expect(out.p95).toBe(quantile(SKEWED, 0.95));
    expect(out.p01).toBe(-10);
    expect(out.p99).toBe(50);
  });

  it("VaR is the negated quantile and CVaR the mean of the tail at or below it", () => {
    expect(out.var95).toBe(-quantile(SKEWED, 0.05));
    expect(out.var99).toBe(-quantile(SKEWED, 0.01));
    const q95 = quantile(SKEWED, 0.05);
    const tail95 = SKEWED.filter((v) => v <= q95);
    expect(out.cvar95).toBeCloseTo(-mean(tail95), 12);
    const q99 = quantile(SKEWED, 0.01);
    const tail99 = SKEWED.filter((v) => v <= q99);
    expect(out.cvar99).toBeCloseTo(-mean(tail99), 12);
  });

  it("mean / stdDev / probProfit match direct arithmetic", () => {
    expect(out.mean).toBeCloseTo(mean(SKEWED), 12);
    expect(out.stdDev).toBeCloseTo(sampleSd(SKEWED), 12);
    expect(out.probProfit).toBe(4 / S);
  });
});

describe("computeScalarStats higher moments", () => {
  const out = stats(
    SKEWED,
    SKEWED.map((v) => Math.min(0, v)),
    0,
  );

  it("skewness is positive on a right-skewed sample and equals G1", () => {
    expect(out.skewness).toBeGreaterThan(0);
    expect(Math.abs(out.skewness - g1Skewness(SKEWED))).toBeLessThan(1e-12);
  });

  it("kurtosis equals the bias-corrected G2 estimator", () => {
    expect(Math.abs(out.kurtosis - g2Kurtosis(SKEWED))).toBeLessThan(1e-12);
  });

  it("flips sign when the sample is mirrored", () => {
    const mirrored = stats(
      SKEWED.map((v) => -v),
      SKEWED.map((v) => Math.min(0, -v)),
      0,
    );
    expect(mirrored.skewness).toBeCloseTo(-out.skewness, 12);
    expect(mirrored.kurtosis).toBeCloseTo(out.kurtosis, 12);
  });

  it("degenerate constant sample yields zero moments instead of NaN", () => {
    const flat = stats([5, 5, 5, 5], [0, 0, 0, 0], 0);
    expect(flat.stdDev).toBe(0);
    expect(flat.skewness).toBe(0);
    expect(flat.kurtosis).toBe(0);
    expect(flat.sharpe).toBe(0);
  });
});

describe("computeScalarStats risk / reward ratios", () => {
  const bankroll = 100;
  const out = stats(
    SKEWED,
    SKEWED.map((v) => Math.min(0, v)),
    bankroll,
  );

  it("Kelly bankroll is σ²/μ and the fraction is the stake's share of it", () => {
    const m = mean(SKEWED);
    const variance = sampleSd(SKEWED) ** 2;
    expect(out.kellyBankroll).toBeCloseTo(variance / m, 9);
    expect(out.kellyFraction).toBeCloseTo((TOTAL_BUY_IN * m) / variance, 12);
    expect(out.kellyFraction * out.kellyBankroll).toBeCloseTo(TOTAL_BUY_IN, 9);
  });

  it("Kelly is undefined for a losing schedule", () => {
    const losing = stats(
      SKEWED.map((v) => v - 100),
      SKEWED.map((v) => Math.min(0, v - 100)),
      bankroll,
    );
    expect(losing.kellyBankroll).toBe(Infinity);
    expect(losing.kellyFraction).toBe(0);
  });

  it("Sortino divides by the textbook downside deviation over all samples", () => {
    const downSigma = Math.sqrt(
      SKEWED.reduce((a, v) => a + Math.min(0, v) ** 2, 0) / S,
    );
    expect(out.sortino).toBeCloseTo(mean(SKEWED) / downSigma, 12);
    expect(out.sharpe).toBeCloseTo(mean(SKEWED) / sampleSd(SKEWED), 12);
    expect(out.sortino).toBeGreaterThan(out.sharpe);
  });

  it("log growth is the mean log wealth ratio when no sample ruins", () => {
    const expected = mean(SKEWED.map((v) => Math.log(1 + v / bankroll)));
    expect(out.logGrowthRate).toBeCloseTo(expected, 12);
  });

  it("log growth winsorises ruin samples at ln(0.01)", () => {
    const finals = [-200, 10, 10, 10];
    const ruined = stats(finals, finals.map((v) => Math.min(0, v)), bankroll);
    const expected =
      (Math.log(0.01) + 3 * Math.log(1 + 10 / bankroll)) / finals.length;
    expect(ruined.logGrowthRate).toBeCloseTo(expected, 12);
  });

  it("log growth is zero without a bankroll", () => {
    const noBankroll = stats(SKEWED, SKEWED.map((v) => Math.min(0, v)), 0);
    expect(noBankroll.logGrowthRate).toBe(0);
  });
});

describe("computeScalarStats bankroll requirements", () => {
  // 101 samples with distinct running minima so every RoR quantile lands on
  // a different loss; finals are right-skewed (quadratic ramp).
  const size = 101;
  const finals = Array.from({ length: size }, (_, i) => (i * i) / 50 - 60);
  const runningMins = Array.from({ length: size }, (_, i) => -(i + 1));

  it("1% RoR bankroll is strictly above the 5% one on skewed data", () => {
    const out = stats(finals, runningMins, 0);
    const worstLosses = runningMins.map((v) => -v).sort((a, b) => a - b);
    expect(out.minBankrollRoR1pct).toBe(worstLosses[Math.floor(0.99 * (size - 1))]);
    expect(out.minBankrollRoR5pct).toBe(worstLosses[Math.floor(0.95 * (size - 1))]);
    expect(out.minBankrollRoR15pct).toBe(worstLosses[Math.floor(0.85 * (size - 1))]);
    expect(out.minBankrollRoR50pct).toBe(worstLosses[Math.floor(0.5 * (size - 1))]);
    expect(out.minBankrollRoR1pct).toBeGreaterThan(out.minBankrollRoR5pct);
    expect(out.minBankrollRoR5pct).toBeGreaterThan(out.minBankrollRoR15pct);
    expect(out.minBankrollRoR15pct).toBeGreaterThan(out.minBankrollRoR50pct);
  });

  it("neverBelowZeroFrac counts runs whose running min stayed non-negative", () => {
    const mins = [0, -1, 0, -5, 3];
    const out = stats([1, 1, 1, 1, 1], mins, 0);
    expect(out.neverBelowZeroFrac).toBe(3 / 5);
  });
});

describe("computeScalarStats probUpNeverBusted", () => {
  // final > 0 in 4 of 6 runs; of those, run #3 busted mid-way (running min
  // hit −bankroll exactly) and run #4 dipped below it.
  const finals = [-20, 15, 30, 40, 5, -3];
  const runningMins = [-20, -10, -50, -60, -49, -3];
  const bankroll = 50;

  it("counts runs that finished up AND never touched −bankroll", () => {
    const out = stats(finals, runningMins, bankroll);
    expect(out.probProfit).toBe(4 / 6);
    expect(out.probUpNeverBusted).toBe(2 / 6);
  });

  it("is never above probProfit", () => {
    const out = stats(finals, runningMins, bankroll);
    expect(out.probUpNeverBusted).not.toBeNull();
    expect(out.probUpNeverBusted!).toBeLessThanOrEqual(out.probProfit);
  });

  it("equals probProfit when no run ever busts", () => {
    const out = stats(finals, runningMins, 1000);
    expect(out.probUpNeverBusted).toBe(out.probProfit);
  });

  it("is null without a bankroll", () => {
    const out = stats(finals, runningMins, 0);
    expect(out.probUpNeverBusted).toBeNull();
  });
});
