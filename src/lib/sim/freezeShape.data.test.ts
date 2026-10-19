import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildFinishPMF } from "./finishModel";
import {
  FREEZE_REALDATA_BUCKETS,
  FREEZE_REALDATA_BUCKET_WIDTH,
  FREEZE_REALDATA_CASH_BAND_PCT,
  FREEZE_REALDATA_CUT_X,
  FREEZE_REALDATA_ITM_RATE,
  buildFreezeCashPMF,
} from "./freezeShape";

/**
 * The freeze finish shapes are the real-data histogram in
 * `data/finish-shapes/freeze-cash.json`, copied into `freezeShape.ts`. These
 * tests tie the shipped table and the shipped builders to that file.
 */

interface DataBucket {
  x: number;
  density: number;
}

const DATA = JSON.parse(
  readFileSync(join(process.cwd(), "data", "finish-shapes", "freeze-cash.json"), "utf8"),
) as {
  itm_rate_empirical: number;
  cash_cutoff_x: number;
  cash_band_width_pct: number;
  bucket_width_pct: number;
  buckets_cash_conditional: DataBucket[];
};

const REAL = DATA.buckets_cash_conditional;
const REAL_DENSITY = REAL.map((b) => b.density);

// The cash-conditional density the builder's pmf puts in each data bucket
// (bucket x covers (x - 0.5, x], place i sits at x = (N - i + 1) / N * 100).
function binToDataBuckets(pmf: Float64Array): number[] {
  const N = pmf.length;
  const cashCount = Math.ceil((N * FREEZE_REALDATA_CASH_BAND_PCT) / 100);
  const out = REAL.map(() => 0);
  let cash = 0;
  for (let rank = 1; rank <= cashCount; rank++) {
    const x = ((N - rank + 1) / N) * 100;
    const bucketX = Math.ceil(x * 2 - 1e-9) / 2;
    const idx = REAL.findIndex((b) => Math.abs(b.x - bucketX) < 1e-9);
    if (idx >= 0) out[idx] += pmf[rank - 1];
    cash += pmf[rank - 1];
  }
  return out.map((v) => v / cash);
}

function rmse(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s / a.length);
}

describe("freeze real-data shape vs data/finish-shapes/freeze-cash.json", () => {
  it("the shipped bucket table and constants are the data file", () => {
    expect(FREEZE_REALDATA_BUCKETS).toHaveLength(REAL.length);
    for (let i = 0; i < REAL.length; i++) {
      expect(FREEZE_REALDATA_BUCKETS[i][0]).toBe(REAL[i].x);
      expect(FREEZE_REALDATA_BUCKETS[i][1]).toBeCloseTo(REAL[i].density, 14);
    }
    expect(REAL_DENSITY.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
    expect(FREEZE_REALDATA_CUT_X).toBe(DATA.cash_cutoff_x);
    expect(FREEZE_REALDATA_CASH_BAND_PCT).toBe(DATA.cash_band_width_pct);
    expect(FREEZE_REALDATA_BUCKET_WIDTH).toBe(DATA.bucket_width_pct);
    expect(FREEZE_REALDATA_ITM_RATE).toBe(DATA.itm_rate_empirical);
  });

  it("step keeps the data's shape on every bucket the cash band reaches", () => {
    // N = 1000 puts five places in each 0.5 % bucket. The builder's 15.5 % band
    // stops above the data's lowest bucket (84.5), so the rest are rescaled by
    // one common factor and nothing else moves.
    const binned = binToDataBuckets(buildFreezeCashPMF(1000, "step", 0));
    const reached = REAL.map((b, i) => (b.x > FREEZE_REALDATA_CUT_X ? i : -1)).filter((i) => i >= 0);
    const factor = binned[reached[0]] / REAL_DENSITY[reached[0]];
    expect(factor).toBeGreaterThan(1);
    expect(factor).toBeLessThan(1.05);
    for (const i of reached) {
      expect(binned[i] / REAL_DENSITY[i]).toBeCloseTo(factor, 9);
    }
    expect(binned[0]).toBe(0);
    expect(rmse(binned, REAL_DENSITY)).toBeLessThan(0.006);
  });

  it("tilt at zero is the step shape", () => {
    for (const N of [400, 1000, 1500, 3000]) {
      expect(Array.from(buildFreezeCashPMF(N, "tilt", 0))).toEqual(
        Array.from(buildFreezeCashPMF(N, "step", 0)),
      );
    }
  });

  it("linear stays within a bucket-width interpolation of step", () => {
    const step = binToDataBuckets(buildFreezeCashPMF(1000, "step", 0));
    const linear = binToDataBuckets(buildFreezeCashPMF(1000, "linear", 0));
    expect(rmse(linear, step)).toBeLessThan(0.002);
    expect(rmse(linear, REAL_DENSITY)).toBeLessThan(0.006);
  });

  it("the power-law real-data model follows the histogram's ramp to the winner", () => {
    const N = 1000;
    const binned = binToDataBuckets(buildFinishPMF(N, { id: "powerlaw-realdata-influenced" }, 0));
    expect(rmse(binned, REAL_DENSITY)).toBeLessThan(0.007);
    // Heavier at the winner's end than at the bubble end, as in the data.
    const top = binned.slice(-4).reduce((s, v) => s + v, 0);
    const bottom = binned.slice(0, 4).reduce((s, v) => s + v, 0);
    expect(top).toBeGreaterThan(bottom);
  });

  it("every variant puts the data's ITM rate in the cash band and spreads the rest evenly", () => {
    const N = 1000;
    const cashCount = Math.ceil((N * FREEZE_REALDATA_CASH_BAND_PCT) / 100);
    for (const variant of ["step", "linear", "tilt"] as const) {
      const pmf = buildFreezeCashPMF(N, variant, 0.1);
      let cash = 0;
      for (let i = 0; i < cashCount; i++) cash += pmf[i];
      expect(cash).toBeCloseTo(DATA.itm_rate_empirical, 12);
      for (let i = cashCount + 1; i < N; i++) expect(pmf[i]).toBeCloseTo(pmf[cashCount], 14);
    }
  });
});
