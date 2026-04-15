import { describe, it, expect } from "vitest";
import { buildFinishPMF, calibrateAlpha } from "./finishModel";
import {
  FREEZE_REALDATA_ITM_RATE,
  FREEZE_REALDATA_CASH_BAND_PCT,
  buildFreezeCashPMF,
  powerLawAlphaForRealdataItm,
} from "./freezeShape";
import type { FinishModelId } from "./types";

const VARIANT_IDS: FinishModelId[] = [
  "freeze-realdata-step",
  "freeze-realdata-linear",
  "freeze-realdata-tilt",
];

describe("buildFreezeCashPMF", () => {
  it.each(["step", "linear", "tilt"] as const)(
    "%s variant sums to 1 on representative field sizes",
    (v) => {
      for (const N of [50, 150, 500, 1500, 3000]) {
        const pmf = buildFreezeCashPMF(N, v, 0);
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
      const pmf = buildFreezeCashPMF(N, v, 0);
      const cashCount = Math.ceil((N * FREEZE_REALDATA_CASH_BAND_PCT) / 100);
      let cashMass = 0;
      for (let i = 0; i < cashCount; i++) cashMass += pmf[i];
      expect(cashMass).toBeCloseTo(FREEZE_REALDATA_ITM_RATE, 8);
    },
  );

  it("step variant has uniform OOTM tail", () => {
    const N = 1500;
    const pmf = buildFreezeCashPMF(N, "step", 0);
    const cashCount = Math.ceil((N * FREEZE_REALDATA_CASH_BAND_PCT) / 100);
    const first = pmf[cashCount];
    for (let i = cashCount + 1; i < N; i++) {
      expect(pmf[i]).toBeCloseTo(first, 12);
    }
  });

  it("tilt α>0 pushes mass toward the winner", () => {
    const N = 1500;
    const flat = buildFreezeCashPMF(N, "tilt", 0);
    const tilted = buildFreezeCashPMF(N, "tilt", 0.2);
    // Winner-side (rank 1) must gain under positive tilt.
    expect(tilted[0]).toBeGreaterThan(flat[0]);
    // Bubble-side (last cash place) must lose.
    const cashCount = Math.ceil((N * FREEZE_REALDATA_CASH_BAND_PCT) / 100);
    expect(tilted[cashCount - 1]).toBeLessThan(flat[cashCount - 1]);
  });

  it("tilt α<0 pushes mass toward the bubble", () => {
    const N = 1500;
    const flat = buildFreezeCashPMF(N, "tilt", 0);
    const tilted = buildFreezeCashPMF(N, "tilt", -0.2);
    expect(tilted[0]).toBeLessThan(flat[0]);
    const cashCount = Math.ceil((N * FREEZE_REALDATA_CASH_BAND_PCT) / 100);
    expect(tilted[cashCount - 1]).toBeGreaterThan(flat[cashCount - 1]);
  });

  it.each(VARIANT_IDS)(
    "buildFinishPMF routes %s through the freeze-realdata builder",
    (id) => {
      const N = 600;
      const pmf = buildFinishPMF(N, { id }, 0);
      const s = pmf.reduce((a, b) => a + b, 0);
      expect(s).toBeCloseTo(1, 10);
      // Winner bucket density must exceed OOTM uniform density.
      const ootm = pmf[N - 1];
      expect(pmf[0]).toBeGreaterThan(ootm);
    },
  );

  describe("powerlaw-realdata-influenced", () => {
    it("powerLawAlphaForRealdataItm reproduces ITM_RATE on representative N", () => {
      // Sanity check on the helper itself — it's no longer wired into
      // calibration but stays exposed as a reference value for docs/UI.
      for (const N of [200, 600, 1500, 3000]) {
        const alpha = powerLawAlphaForRealdataItm(N);
        const pmf = buildFinishPMF(N, { id: "power-law" }, alpha);
        const K = Math.ceil((N * FREEZE_REALDATA_CASH_BAND_PCT) / 100);
        let topMass = 0;
        for (let i = 0; i < K; i++) topMass += pmf[i];
        expect(topMass).toBeCloseTo(FREEZE_REALDATA_ITM_RATE, 3);
        expect(alpha).toBeGreaterThan(0);
        expect(alpha).toBeLessThan(1);
      }
    });

    it("calibrateAlpha obeys target ROI (does not pin real-data α)", () => {
      // Same binary search as the plain power-law model.
      const N = 1500;
      const payouts = [0.3, 0.2, 0.13, 0.09, 0.07, 0.05, 0.04, 0.03, 0.02];
      const a0 = calibrateAlpha(
        N,
        payouts,
        1000,
        10,
        0,
        { id: "powerlaw-realdata-influenced" },
      );
      const a1 = calibrateAlpha(
        N,
        payouts,
        1000,
        10,
        0.5,
        { id: "powerlaw-realdata-influenced" },
      );
      // Higher target ROI must push α higher (more top-heavy).
      expect(a1).toBeGreaterThan(a0);
      // Matches the plain power-law model for the same inputs.
      const pl = calibrateAlpha(N, payouts, 1000, 10, 0, { id: "power-law" });
      expect(a0).toBeCloseTo(pl, 10);
    });

    it("user-override α wins over auto-fit", () => {
      const N = 1000;
      const overridden = calibrateAlpha(
        N,
        [0.5, 0.3, 0.2],
        1000,
        10,
        0,
        { id: "powerlaw-realdata-influenced", alpha: 0.9 },
      );
      expect(overridden).toBe(0.9);
    });
  });
});
