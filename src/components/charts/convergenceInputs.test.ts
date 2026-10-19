import { describe, expect, it } from "vitest";
import {
  commitCiPct,
  commitMixPct,
  commitRakePct,
  commitRoiFraction,
  convergenceResetTargets,
} from "./convergenceInputs";

// A cleared box, a space, or a lone "-" (a number input reports it as "") is not
// a number. Number("") is 0, which used to commit the clamp minimum: CI 75, ROI
// 0, rake 0, and the card re-priced the run with no hint the box was only cleared.
describe("convergence card number boxes", () => {
  it.each(["", "  ", "-"])("leave CI, ROI, rake and a mix share alone for %j", (raw) => {
    expect(commitCiPct(raw)).toBeNull();
    expect(commitRakePct(raw)).toBeNull();
    expect(commitRoiFraction(raw, -0.5, 1)).toBeNull();
    expect(commitMixPct(raw)).toBeNull();
  });

  it("holds a mix share to 0..100 and keeps a real zero", () => {
    expect(commitMixPct("0")).toBe(0);
    expect(commitMixPct("33")).toBe(33);
    expect(commitMixPct("150")).toBe(100);
    expect(commitMixPct("-5")).toBe(0);
  });

  it("clamps a real number into the box bounds", () => {
    expect(commitCiPct("50")).toBe(75);
    expect(commitCiPct("99.99")).toBe(99.9);
    expect(commitCiPct("90")).toBe(90);
    expect(commitRakePct("-3")).toBe(0);
    expect(commitRakePct("30")).toBe(20);
    expect(commitRakePct("7.5")).toBe(7.5);
  });

  it("reads ROI as percent, returns a fraction, and keeps it inside the format bounds", () => {
    expect(commitRoiFraction("10", -0.3, 0.5)).toBeCloseTo(0.1, 12);
    expect(commitRoiFraction("-20", -0.3, 0.5)).toBeCloseTo(-0.2, 12);
    expect(commitRoiFraction("-80", -0.3, 0.5)).toBe(-0.3);
    expect(commitRoiFraction("900", -0.3, 0.5)).toBe(0.5);
    expect(commitRoiFraction("0", -0.3, 0.5)).toBe(0);
  });
});

describe("where the AFS and ROI reset buttons land", () => {
  const bounds = { roiMin: -0.3, roiMax: 1 };

  it("keeps a schedule that sits inside the controls' ranges as it is", () => {
    const t = convergenceResetTargets({ avgField: 1000, roi: 0.1, ...bounds });
    expect(t.afs.value).toBeCloseTo(1000, 6);
    expect(t.afs.clamped).toBe(false);
    expect(t.roi).toEqual({ value: 0.1, clamped: false });
  });

  it("lands a small field on the 50 floor and a huge one on the 50,000 ceiling, and says so", () => {
    const small = convergenceResetTargets({ avgField: 18, roi: 0.1, ...bounds });
    expect(small.afs.value).toBeCloseTo(50, 6);
    expect(small.afs.clamped).toBe(true);
    const huge = convergenceResetTargets({ avgField: 200_000, roi: 0.1, ...bounds });
    expect(huge.afs.value).toBeCloseTo(50_000, 3);
    expect(huge.afs.clamped).toBe(true);
  });

  it("holds ROI to the bounds of the format on screen, and says so", () => {
    const hot = convergenceResetTargets({ avgField: 1000, roi: 1.5, ...bounds });
    expect(hot.roi).toEqual({ value: 1, clamped: true });
    const cold = convergenceResetTargets({ avgField: 1000, roi: -0.9, roiMin: -0.2, roiMax: 0.8 });
    expect(cold.roi).toEqual({ value: -0.2, clamped: true });
  });
});
