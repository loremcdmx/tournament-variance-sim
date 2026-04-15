/**
 * Freeze cash-zone finish-shape data from a 2026-04 real-data histogram.
 *
 * Source: freezout place-probability histogram, AFS 400-10k, ranks 2-12,
 * no re-entry/rebuy. 160,959 finishes. x-axis convention is
 * `x = (N - place + 1) / N * 100`, so x=100 is the winner and x=84.5 is the
 * bubble of the cash zone. Empirical ITM rate on the sample is 18.7%; the
 * histogram is cash-conditional (sums to 1 across the 32 buckets from 84.5
 * to 100 in 0.5% steps).
 *
 * Three variants wire this shape into the finish model:
 *   - step   — place density = density of the bucket containing its x.
 *   - linear — linear interpolation between neighbouring bucket centres.
 *   - tilt   — step with a `(1 − x/100)^(−α_tilt)` multiplicative knob that
 *              lets the user push mass toward the winner (α>0) or bubble
 *              (α<0) without abandoning the real-data shape.
 *
 * All three distribute `ITM_RATE` over the top `CASH_BAND_PCT%` of the
 * field and spread the remaining (1 − ITM_RATE) uniformly across the
 * out-of-the-money tail. `paidCount` and per-row `itmRate` are intentionally
 * ignored so the shape reproduces the empirical ratio regardless of
 * tournament structure — pick a power-law / empirical model if you need
 * ROI / ITM to be driven by row inputs instead.
 */

export const FREEZE_REALDATA_CUT_X = 84.5;
export const FREEZE_REALDATA_BUCKET_WIDTH = 0.5;
export const FREEZE_REALDATA_ITM_RATE = 0.187;
export const FREEZE_REALDATA_CASH_BAND_PCT = 15.5; // 100 − 84.5

// Cash-conditional density per 0.5% bucket, sum=1 across 32 buckets.
// Keep in sync with `data/finish-shapes/freeze-cash.json`.
export const FREEZE_REALDATA_BUCKETS: ReadonlyArray<readonly [number, number]> = [
  [84.5, 0.02747905258296497],
  [85, 0.02708319588309032],
  [85.5, 0.026918255591475884],
  [86, 0.030118097248795935],
  [86.5, 0.02926040773240087],
  [87, 0.029425348024015308],
  [87.5, 0.02959028831562974],
  [88, 0.030909810648545227],
  [88.5, 0.030316025598733257],
  [89, 0.029788216665567066],
  [89.5, 0.029557300257306855],
  [90, 0.030447977832024808],
  [90.5, 0.03054694200699347],
  [91, 0.03189945239823184],
  [91.5, 0.030118097248795935],
  [92, 0.029392359965692418],
  [92.5, 0.029326383849046646],
  [93, 0.03213036880649205],
  [93.5, 0.030843834531899452],
  [94, 0.03166853598997163],
  [94.5, 0.03189945239823184],
  [95, 0.03239427327307515],
  [95.5, 0.032196344923137825],
  [96, 0.035297222405489215],
  [96.5, 0.03341690308108465],
  [97, 0.03272415385630402],
  [97.5, 0.035165270172197664],
  [98, 0.03295507026456423],
  [98.5, 0.033548855314376194],
  [99, 0.035165270172197664],
  [99.5, 0.03500032988058323],
  [100, 0.03341690308108465],
];

export type FreezeRealDataVariant = "step" | "linear" | "tilt";

const BUCKET_COUNT = FREEZE_REALDATA_BUCKETS.length;

function stepDensity(x: number): number {
  // Bucket label X covers (X − 0.5, X]. Clamp below-range x into the
  // leftmost bucket so places with very wide structural cash don't hit 0.
  if (x <= FREEZE_REALDATA_CUT_X) return FREEZE_REALDATA_BUCKETS[0][1];
  if (x >= 100) return FREEZE_REALDATA_BUCKETS[BUCKET_COUNT - 1][1];
  const bx = Math.ceil(x * 2) / 2;
  const idx = Math.round((bx - FREEZE_REALDATA_CUT_X) * 2);
  if (idx < 0) return FREEZE_REALDATA_BUCKETS[0][1];
  if (idx >= BUCKET_COUNT) return FREEZE_REALDATA_BUCKETS[BUCKET_COUNT - 1][1];
  return FREEZE_REALDATA_BUCKETS[idx][1];
}

function linearDensity(x: number): number {
  if (x <= FREEZE_REALDATA_CUT_X) return FREEZE_REALDATA_BUCKETS[0][1];
  if (x >= 100) return FREEZE_REALDATA_BUCKETS[BUCKET_COUNT - 1][1];
  const t = (x - FREEZE_REALDATA_CUT_X) / FREEZE_REALDATA_BUCKET_WIDTH;
  const lo = Math.floor(t);
  const hi = Math.min(BUCKET_COUNT - 1, lo + 1);
  const frac = t - lo;
  return (
    FREEZE_REALDATA_BUCKETS[lo][1] * (1 - frac) +
    FREEZE_REALDATA_BUCKETS[hi][1] * frac
  );
}

function tiltMultiplier(x: number, alphaTilt: number): number {
  const u = Math.max(1e-4, 1 - (x - 0.25) / 100);
  return Math.pow(u, -alphaTilt);
}

/**
 * Build the full finish PMF (length N) for one of the three real-data
 * freeze shapes. Cash zone = top `FREEZE_REALDATA_CASH_BAND_PCT%` of N,
 * carrying `FREEZE_REALDATA_ITM_RATE` mass; OOTM tail is uniform.
 */
/**
 * Binary-search α for the pure power-law p_i ∝ i^(-α) so that the top
 * `CASH_BAND_PCT%` of the field carries exactly `ITM_RATE` probability mass.
 * This anchors a classic power-law finish model to the empirical freeze
 * cash rate without changing its shape elsewhere — "power-law, real-data
 * influenced" in the literal sense.
 *
 * `buildFinishPMF` then uses the returned α in the standard power-law branch,
 * so the full PMF remains a single-family curve over 1..N.
 */
export function powerLawAlphaForRealdataItm(N: number): number {
  if (N < 10) return 0;
  const K = Math.max(
    1,
    Math.min(N, Math.ceil((N * FREEZE_REALDATA_CASH_BAND_PCT) / 100)),
  );
  if (K >= N) return 0;
  const target = FREEZE_REALDATA_ITM_RATE;
  // cashShare is monotone increasing in α: larger α → head-heavier curve.
  const cashShare = (a: number): number => {
    let top = 0;
    let tot = 0;
    for (let i = 1; i <= N; i++) {
      const v = Math.pow(i, -a);
      tot += v;
      if (i <= K) top += v;
    }
    return tot > 0 ? top / tot : 0;
  };
  let lo = -5;
  let hi = 10;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (cashShare(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function buildFreezeCashPMF(
  N: number,
  variant: FreezeRealDataVariant,
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
    Math.min(N, Math.ceil((N * FREEZE_REALDATA_CASH_BAND_PCT) / 100)),
  );
  const cashMass = FREEZE_REALDATA_ITM_RATE;

  let cs = 0;
  for (let rank = 1; rank <= cashCount; rank++) {
    const x = ((N - rank + 1) / N) * 100;
    let d: number;
    if (variant === "linear") d = linearDensity(x);
    else if (variant === "tilt") d = stepDensity(x) * tiltMultiplier(x, alphaTilt);
    else d = stepDensity(x);
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
