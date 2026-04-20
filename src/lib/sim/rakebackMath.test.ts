import { describe, expect, it } from "vitest";
import {
  preRakebackRoiFromReportedRoi,
  rakebackRoiContribution,
  reportedRoiFromPreRakebackRoi,
} from "./rakebackMath";

describe("rakeback ROI math", () => {
  it("converts rakeback as share of full ticket cost", () => {
    expect(rakebackRoiContribution(0.08, 40)).toBeCloseTo(0.02962963, 8);
  });

  it("converts reported Battle Royale ROI into the pre-rakeback row ROI", () => {
    expect(preRakebackRoiFromReportedRoi(0.05, 0.08, 40)).toBeCloseTo(
      0.02037037,
      8,
    );
    expect(preRakebackRoiFromReportedRoi(0.07, 0.08, 40)).toBeCloseTo(
      0.04037037,
      8,
    );
  });

  it("round-trips reported ROI through pre-rakeback ROI", () => {
    const reported = 0.06;
    const pre = preRakebackRoiFromReportedRoi(reported, 0.08, 40);
    expect(reportedRoiFromPreRakebackRoi(pre, 0.08, 40)).toBeCloseTo(
      reported,
      12,
    );
  });

  it("ignores invalid or negative rakeback inputs", () => {
    expect(rakebackRoiContribution(0.08, -20)).toBe(0);
    expect(rakebackRoiContribution(Number.NaN, 40)).toBe(0);
  });
});
