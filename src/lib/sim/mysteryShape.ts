/**
 * Mystery-bounty finish-shape.
 *
 * Mystery tournaments are phase-split: the bounty pool only activates at the
 * ITM bubble. Pre-ITM play is freezeout-like (no KO incentive, tight bubble
 * play), so the non-cash zone is uniform — exactly the shape the freeze real-
 * data sample takes. Post-ITM play becomes bounty-aware (envelopes drop on
 * every cash KO), so the cash zone inherits PKO's cash-conditional density —
 * winner-heavier than freeze because every KO pays.
 *
 * No direct mystery-format histogram is available, so we splice the two
 * empirical halves at x = 84.5 % (top 15.5 % = cash zone, matching the 18.7 %
 * ITM rate shared by both source samples).
 *
 * See `freezeShape.ts` and `pkoShape.ts` for the source distributions.
 */

import {
  PKO_REALDATA_BUCKET_WIDTH,
  PKO_REALDATA_CASH_BAND_PCT,
  PKO_REALDATA_CASH_BUCKETS,
  PKO_REALDATA_CUT_X,
  PKO_REALDATA_ITM_RATE,
} from "./pkoShape";

export const MYSTERY_REALDATA_CUT_X = PKO_REALDATA_CUT_X;
export const MYSTERY_REALDATA_BUCKET_WIDTH = PKO_REALDATA_BUCKET_WIDTH;
export const MYSTERY_REALDATA_ITM_RATE = PKO_REALDATA_ITM_RATE;
export const MYSTERY_REALDATA_CASH_BAND_PCT = PKO_REALDATA_CASH_BAND_PCT;

const CASH_COUNT = PKO_REALDATA_CASH_BUCKETS.length;

export type MysteryRealDataVariant = "step" | "linear" | "tilt";

function cashStepDensity(x: number): number {
  if (x <= MYSTERY_REALDATA_CUT_X) return PKO_REALDATA_CASH_BUCKETS[0][1];
  if (x >= 100) return PKO_REALDATA_CASH_BUCKETS[CASH_COUNT - 1][1];
  const bx = Math.ceil(x * 2) / 2;
  const idx = Math.round((bx - MYSTERY_REALDATA_CUT_X) * 2);
  if (idx < 0) return PKO_REALDATA_CASH_BUCKETS[0][1];
  if (idx >= CASH_COUNT) return PKO_REALDATA_CASH_BUCKETS[CASH_COUNT - 1][1];
  return PKO_REALDATA_CASH_BUCKETS[idx][1];
}

function cashLinearDensity(x: number): number {
  if (x <= MYSTERY_REALDATA_CUT_X) return PKO_REALDATA_CASH_BUCKETS[0][1];
  if (x >= 100) return PKO_REALDATA_CASH_BUCKETS[CASH_COUNT - 1][1];
  const t = (x - MYSTERY_REALDATA_CUT_X) / MYSTERY_REALDATA_BUCKET_WIDTH;
  const lo = Math.floor(t);
  const hi = Math.min(CASH_COUNT - 1, lo + 1);
  const frac = t - lo;
  return (
    PKO_REALDATA_CASH_BUCKETS[lo][1] * (1 - frac) +
    PKO_REALDATA_CASH_BUCKETS[hi][1] * frac
  );
}

function tiltMultiplier(x: number, alphaTilt: number): number {
  const u = Math.max(1e-4, 1 - (x - 0.25) / 100);
  return Math.pow(u, -alphaTilt);
}

/**
 * Build the full finish PMF (length N) for one of the three real-data mystery
 * shapes. Cash zone = top `CASH_BAND_PCT%` of N, carrying `ITM_RATE` mass;
 * OOTM tail is uniform (pre-ITM freezeout play).
 */
export function buildMysteryCashPMF(
  N: number,
  variant: MysteryRealDataVariant,
  alphaTilt: number,
): Float64Array {
  const pmf = new Float64Array(N);
  if (N <= 0) return pmf;
  if (N === 1) {
    pmf[0] = 1;
    return pmf;
  }

  const cashCount = Math.max(
    1,
    Math.min(N, Math.ceil((N * MYSTERY_REALDATA_CASH_BAND_PCT) / 100)),
  );
  const cashMass = MYSTERY_REALDATA_ITM_RATE;

  let cs = 0;
  for (let rank = 1; rank <= cashCount; rank++) {
    const x = ((N - rank + 1) / N) * 100;
    let d: number;
    if (variant === "linear") d = cashLinearDensity(x);
    else if (variant === "tilt") d = cashStepDensity(x) * tiltMultiplier(x, alphaTilt);
    else d = cashStepDensity(x);
    pmf[rank - 1] = d;
    cs += d;
  }
  if (cs > 0) {
    const scale = cashMass / cs;
    for (let i = 0; i < cashCount; i++) pmf[i] *= scale;
  }

  const ootmCount = N - cashCount;
  if (ootmCount > 0) {
    const q = (1 - cashMass) / ootmCount;
    for (let i = cashCount; i < N; i++) pmf[i] = q;
  }

  return pmf;
}
