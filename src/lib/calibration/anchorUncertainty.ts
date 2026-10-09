/**
 * Sampling error of the empirical Space anchor, from the same raw moments the
 * anchor is built from. Each calendar month of the training window contributes
 * additive sums over its player/tournament clusters, so pooling months is exact
 * and dropping one month is a plain subtraction. σ and ROI are those of
 * `exposureComponents` (S_ij from raw moments), the numbers the page shows.
 */
import { exposureComponents } from "./oceanTransport";
import type { SpaceJointMoments } from "./types";

/** One month of one cap: cluster count and the raw sums behind the 12 moments. */
export interface MonthlyMomentSums {
  month: string;
  n: number;
  sk: number;
  sk2: number;
  sx: number;
  sx2: number;
  sxk: number;
  sc: number;
  sc2: number;
  sck: number;
  sb: number;
  sb2: number;
  sbk: number;
  scb: number;
}

export interface AnchorJackknife {
  months: number;
  sigma: number;
  roi: number;
  /** Standard error of σ, BI per tournament. */
  sigmaSE: number;
  /** Standard error of ROI, as a fraction. */
  roiSE: number;
  sigmaLeaveOneOut: number[];
  roiLeaveOneOut: number[];
}

export function pooledMoments(rows: readonly MonthlyMomentSums[]): SpaceJointMoments {
  const sum = (pick: (row: MonthlyMomentSums) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const n = sum(row => row.n);
  return {
    meanK: sum(row => row.sk) / n, secondK: sum(row => row.sk2) / n,
    meanProfit: sum(row => row.sx) / n, secondProfit: sum(row => row.sx2) / n, crossProfitK: sum(row => row.sxk) / n,
    meanCash: sum(row => row.sc) / n, secondCash: sum(row => row.sc2) / n, crossCashK: sum(row => row.sck) / n,
    meanBounty: sum(row => row.sb) / n, secondBounty: sum(row => row.sb2) / n, crossBountyK: sum(row => row.sbk) / n,
    crossCashBounty: sum(row => row.scb) / n,
  };
}

function sigmaAndRoi(rows: readonly MonthlyMomentSums[]): { sigma: number; roi: number } {
  const components = exposureComponents(pooledMoments(rows));
  if (!components) throw new Error("anchor moments are not a valid covariance structure");
  return { sigma: components.sigma, roi: components.roi };
}

/** Delete-one-month jackknife: SE = sqrt((M-1)/M * sum((theta_i - mean(theta_i))^2)). */
function jackknifeSE(leaveOneOut: readonly number[]): number {
  const m = leaveOneOut.length;
  const mean = leaveOneOut.reduce((total, value) => total + value, 0) / m;
  return Math.sqrt((m - 1) / m * leaveOneOut.reduce((total, value) => total + (value - mean) ** 2, 0));
}

export function monthJackknife(rows: readonly MonthlyMomentSums[]): AnchorJackknife {
  const months = [...new Set(rows.map(row => row.month))].sort();
  if (months.length < 3 || months.length !== rows.length) throw new Error("jackknife needs one row per month and at least three months");
  const full = sigmaAndRoi(rows);
  const leaveOut = months.map(month => sigmaAndRoi(rows.filter(row => row.month !== month)));
  const sigmaLeaveOneOut = leaveOut.map(item => item.sigma);
  const roiLeaveOneOut = leaveOut.map(item => item.roi);
  return {
    months: months.length, sigma: full.sigma, roi: full.roi,
    sigmaSE: jackknifeSE(sigmaLeaveOneOut), roiSE: jackknifeSE(roiLeaveOneOut),
    sigmaLeaveOneOut, roiLeaveOneOut,
  };
}
