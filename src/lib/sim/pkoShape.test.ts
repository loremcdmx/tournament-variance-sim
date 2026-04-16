import { describe, it, expect } from "vitest";
import { buildFinishPMF } from "./finishModel";
import {
  PKO_REALDATA_ITM_RATE,
  PKO_REALDATA_CASH_BAND_PCT,
  buildPkoCashPMF,
} from "./pkoShape";
import type { FinishModelId } from "./types";

const VARIANT_IDS: FinishModelId[] = [
  "pko-realdata-step",
  "pko-realdata-linear",
  "pko-realdata-tilt",
];

describe("buildPkoCashPMF", () => {
  it.each(["step", "linear", "tilt"] as const)(
    "%s variant sums to 1 on representative field sizes",
    (v) => {
      for (const N of [50, 150, 500, 1500, 3000]) {
        const pmf = buildPkoCashPMF(N, v, 0);
        expect(pmf).toHaveLength(N);
        const s = pmf.reduce((a, b) => a + b, 0);
        expect(s).toBeCloseTo(1, 10);
      }
    },
  );

  it.each(["step", "linear", "tilt"] as const)(
    "%s variant concentrates ITM_RATE mass in top cash band",
    (v) => {
      const N = 1500;
      const pmf = buildPkoCashPMF(N, v, 0);
      const cashCount = Math.ceil((N * PKO_REALDATA_CASH_BAND_PCT) / 100);
      let cashMass = 0;
      for (let i = 0; i < cashCount; i++) cashMass += pmf[i];
      expect(cashMass).toBeCloseTo(PKO_REALDATA_ITM_RATE, 8);
    },
  );

  it("step variant has non-uniform OOTM tail (PKO-specific)", () => {
    const N = 1500;
    const pmf = buildPkoCashPMF(N, "step", 0);
    const cashCount = Math.ceil((N * PKO_REALDATA_CASH_BAND_PCT) / 100);
    // Unlike freeze, OOTM is shaped: first-bust should be less probable
    // than mid-field non-cash places.
    const firstBust = pmf[N - 1]; // rank N = first bust = x ≈ 0.5
    const midOotm = pmf[Math.floor(N * 0.75)]; // roughly x ≈ 25 (hump zone)
    expect(midOotm).toBeGreaterThan(firstBust);
  });

  it("tilt α>0 pushes mass toward the winner", () => {
    const N = 1500;
    const flat = buildPkoCashPMF(N, "tilt", 0);
    const tilted = buildPkoCashPMF(N, "tilt", 0.2);
    expect(tilted[0]).toBeGreaterThan(flat[0]);
    const cashCount = Math.ceil((N * PKO_REALDATA_CASH_BAND_PCT) / 100);
    expect(tilted[cashCount - 1]).toBeLessThan(flat[cashCount - 1]);
  });

  it("tilt α<0 pushes mass toward the bubble", () => {
    const N = 1500;
    const flat = buildPkoCashPMF(N, "tilt", 0);
    const tilted = buildPkoCashPMF(N, "tilt", -0.2);
    expect(tilted[0]).toBeLessThan(flat[0]);
    const cashCount = Math.ceil((N * PKO_REALDATA_CASH_BAND_PCT) / 100);
    expect(tilted[cashCount - 1]).toBeGreaterThan(flat[cashCount - 1]);
  });

  it.each(VARIANT_IDS)(
    "buildFinishPMF routes %s through the pko-realdata builder",
    (id) => {
      const N = 600;
      const pmf = buildFinishPMF(N, { id }, 0);
      const s = pmf.reduce((a, b) => a + b, 0);
      expect(s).toBeCloseTo(1, 10);
      // Winner bucket density must exceed first-bust density.
      expect(pmf[0]).toBeGreaterThan(pmf[N - 1]);
    },
  );
});
