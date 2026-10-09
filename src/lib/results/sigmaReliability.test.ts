import { describe, expect, it } from "vitest";
import {
  HEAVY_TAIL_EXCESS_KURTOSIS,
  formatSigmaError,
  hasHeavyTail,
  sigmaRelativeError,
} from "./sigmaReliability";

describe("heavy-tail flag", () => {
  it("is off for freezeout-like tails and on well above the threshold", () => {
    expect(hasHeavyTail({ kurtosis: 0.4 })).toBe(false);
    expect(hasHeavyTail({ kurtosis: HEAVY_TAIL_EXCESS_KURTOSIS })).toBe(false);
    expect(hasHeavyTail({ kurtosis: HEAVY_TAIL_EXCESS_KURTOSIS + 0.01 })).toBe(true);
    expect(hasHeavyTail({ kurtosis: 300 })).toBe(true);
  });
});

describe("σ error readout", () => {
  it("is the standard error as a share of σ", () => {
    expect(sigmaRelativeError({ stdDev: 200, mcSeStdDev: 24 })).toBeCloseTo(0.12, 12);
  });

  it("is unavailable for a degenerate run", () => {
    expect(sigmaRelativeError({ stdDev: 0, mcSeStdDev: 0 })).toBeNull();
    expect(sigmaRelativeError({ stdDev: 5, mcSeStdDev: Number.NaN })).toBeNull();
  });

  it("prints one decimal under 10% and whole percents above", () => {
    expect(formatSigmaError(0.0432)).toBe("±4.3%");
    expect(formatSigmaError(0.0432, "ru-RU")).toBe("±4,3%");
    expect(formatSigmaError(0.124)).toBe("±12%");
    expect(formatSigmaError(0.5)).toBe("±50%");
  });
});
