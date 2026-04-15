import { describe, it, expect } from "vitest";
import { primedopeCurveForPaid } from "./pdCurves";

const NATIVE_PAIDS = [
  1, 2, 3, 4, 5, 6, 8, 9, 10, 15, 20, 25, 30, 35, 40, 50, 60, 75, 100, 125,
  150, 175, 200, 225, 250, 275, 300, 350, 400, 450, 500, 550, 600, 700,
];

describe("primedopeCurveForPaid", () => {
  it.each(NATIVE_PAIDS)("paid=%i sums to 1 and is length paid", (paid) => {
    const curve = primedopeCurveForPaid(paid);
    expect(curve).toHaveLength(paid);
    const s = curve.reduce((a, b) => a + b, 0);
    expect(s).toBeCloseTo(1, 10);
  });

  it.each(NATIVE_PAIDS)("paid=%i is monotone descending by place", (paid) => {
    const curve = primedopeCurveForPaid(paid);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]).toBeLessThanOrEqual(curve[i - 1] + 1e-12);
    }
  });

  it("first-place fraction shrinks as the field grows", () => {
    const samples = [15, 30, 60, 150, 300, 700];
    let prev = Infinity;
    for (const paid of samples) {
      const first = primedopeCurveForPaid(paid)[0];
      expect(first).toBeLessThan(prev);
      prev = first;
    }
  });

  it("spread (Σf²) shrinks as the field grows — σ-per-tourney decays", () => {
    const samples = [15, 30, 60, 150, 300, 700];
    let prev = Infinity;
    for (const paid of samples) {
      const curve = primedopeCurveForPaid(paid);
      // Σf² is proportional to the σ² contribution of the payout shape in
      // PD's closed-form math — it must strictly decrease with bigger fields.
      const sumSq = curve.reduce((a, b) => a + b * b, 0);
      expect(sumSq).toBeLessThan(prev);
      prev = sumSq;
    }
  });

  it("off-dropdown paid lands on the smallest native ≥ request", () => {
    const curve = primedopeCurveForPaid(12);
    expect(curve).toHaveLength(12);
    expect(curve.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it("paid beyond largest native pads with zeros", () => {
    const curve = primedopeCurveForPaid(900);
    expect(curve).toHaveLength(900);
    expect(curve.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(curve[899]).toBe(0);
  });
});
