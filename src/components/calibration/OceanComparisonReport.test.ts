import { describe, expect, it } from "vitest";
import { oceanNumberFormat } from "./OceanComparisonReport";

describe("Ocean report numbers", () => {
  // Raw values from the format comparison at ROI 0 (ticket 100, AFS 1000,
  // distance 1000, seed 20261008): float residue on both sides of zero.
  it.each(["en", "ru"] as const)("prints a value that rounds to zero as 0, never -0 (%s)", (locale) => {
    const one = oceanNumberFormat(locale, 1);
    for (const value of [-9.21e-15 * 100, -1.05e-11, -0.04, 0, -0]) expect(one.format(value)).toBe("0");
  });

  it("keeps the minus on a value that survives rounding", () => {
    expect(oceanNumberFormat("en", 1).format(-0.06)).toBe("-0.1");
    expect(oceanNumberFormat("ru", 1).format(-1234.5)).toBe("-1 234,5");
  });
});
