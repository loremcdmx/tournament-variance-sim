import { describe, expect, it } from "vitest";
import { commitCiPct, commitMixPct, commitRakePct, commitRoiFraction } from "./convergenceInputs";

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
