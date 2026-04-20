/**
 * Refit PKO and Mystery σ surfaces from canonical fit_beta_{pko,mystery}.json
 * using 2D log-polynomial with ROI×log(field) interaction:
 *
 *   log σ = a0 + a1·L + a2·L² + b1·R + b2·R² + c·R·L
 *   (L = log field, R = roi)
 *
 * Outputs per-format:
 *   - 6 coefficients
 *   - in-sample R²
 *   - leave-one-out xval residuals (mean |Δ/σ|, max, ±resid for UI)
 *   - comparison vs current production single-β constants
 *
 * No new measurements — reuses the existing 11×18 = 198 production data
 * points per format (120k samples each, N=500). This is the right data set
 * for promoting new production coefficients: denser and better-sampled than
 * any ad-hoc re-run, and matches the exact assumptions in production code.
 *
 *   npx tsx scripts/refit_2d_logpoly.ts
 */

import { promises as fs } from "node:fs";

interface FitBetaFile {
  meta: Record<string, unknown>;
  fields: number[];
  rois: number[];
  table: Record<string, number[]>; // roi -> [sigma at field[0], sigma at field[1], ...]
}

interface DataPoint {
  field: number;
  roi: number;
  sigma: number;
}

function loadData(path: string): DataPoint[] {
  const raw = require(path) as FitBetaFile;
  const pts: DataPoint[] = [];
  for (const r of raw.rois) {
    const row = raw.table[String(r)];
    if (!row || row.length !== raw.fields.length) {
      throw new Error(`mismatched table row for roi=${r} in ${path}`);
    }
    for (let i = 0; i < raw.fields.length; i++) {
      pts.push({ field: raw.fields[i], roi: r, sigma: row[i] });
    }
  }
  return pts;
}

// ============================ Linear algebra ============================

function solve(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[piv][col])) piv = row;
    }
    if (piv !== col) [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    if (Math.abs(d) < 1e-14) throw new Error(`singular col=${col}`);
    for (let j = col; j <= n; j++) M[col][j] /= d;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = M[row][col];
      for (let j = col; j <= n; j++) M[row][j] -= f * M[col][j];
    }
  }
  return M.map((row) => row[n]);
}

function olsFit(
  X: number[][],
  y: number[],
): { coef: number[]; predict: (features: number[]) => number } {
  const p = X[0].length;
  const XtX: number[][] = Array.from({ length: p }, () => Array(p).fill(0));
  const Xty: number[] = Array(p).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let j = 0; j < p; j++) {
      Xty[j] += X[i][j] * y[i];
      for (let k = 0; k < p; k++) {
        XtX[j][k] += X[i][j] * X[i][k];
      }
    }
  }
  const coef = solve(XtX, Xty);
  const predict = (features: number[]) => {
    let s = 0;
    for (let j = 0; j < features.length; j++) s += coef[j] * features[j];
    return s;
  };
  return { coef, predict };
}

// ============================ Model definitions =========================

function featuresSingleBeta(field: number, roi: number): {
  xC: number[]; // for C fit: [1, roi]
  xBeta: number[]; // for β fit: [1, log field] (per-roi-centered)
} {
  return {
    xC: [1, roi],
    xBeta: [1, Math.log(field)],
  };
}

// 2D log-poly: log σ = a0 + a1·L + a2·L² + b1·R + b2·R² + c·R·L
function features2DLogPoly(field: number, roi: number): number[] {
  const L = Math.log(field);
  const R = roi;
  return [1, L, L * L, R, R * R, R * L];
}

function fitSingleBeta(data: DataPoint[]): {
  C0: number;
  C1: number;
  beta: number;
  predict: (field: number, roi: number) => number;
} {
  // Per-ROI log-log fit to estimate β each ROI, then average.
  // Actually: production uses a pooled centered regression for β, then linear
  // C(roi). Mirror that exactly.
  const rois = Array.from(new Set(data.map((d) => d.roi))).sort((a, b) => a - b);
  const lxCentered: number[] = [];
  const lyCentered: number[] = [];
  const cByRoi: Array<{ roi: number; C: number }> = [];
  for (const r of rois) {
    const pts = data.filter((d) => d.roi === r);
    const lxs = pts.map((p) => Math.log(p.field));
    const lys = pts.map((p) => Math.log(p.sigma));
    const mx = lxs.reduce((a, b) => a + b, 0) / lxs.length;
    const my = lys.reduce((a, b) => a + b, 0) / lys.length;
    for (let i = 0; i < lxs.length; i++) {
      lxCentered.push(lxs[i] - mx);
      lyCentered.push(lys[i] - my);
    }
    // Save (mx, my) for C computation later after β is known.
    cByRoi.push({ roi: r, C: NaN }); // placeholder
  }
  // Pooled β
  let num = 0;
  let den = 0;
  for (let i = 0; i < lxCentered.length; i++) {
    num += lxCentered[i] * lyCentered[i];
    den += lxCentered[i] * lxCentered[i];
  }
  const beta = num / den;
  // Recompute per-ROI C using β.
  for (let i = 0; i < rois.length; i++) {
    const r = rois[i];
    const pts = data.filter((d) => d.roi === r);
    const lxs = pts.map((p) => Math.log(p.field));
    const lys = pts.map((p) => Math.log(p.sigma));
    const mx = lxs.reduce((a, b) => a + b, 0) / lxs.length;
    const my = lys.reduce((a, b) => a + b, 0) / lys.length;
    cByRoi[i].C = Math.exp(my - beta * mx);
  }
  // Linear C(roi) fit
  const rxs = cByRoi.map((c) => c.roi);
  const cys = cByRoi.map((c) => c.C);
  const mx = rxs.reduce((a, b) => a + b, 0) / rxs.length;
  const my = cys.reduce((a, b) => a + b, 0) / cys.length;
  let num2 = 0;
  let den2 = 0;
  for (let i = 0; i < rxs.length; i++) {
    num2 += (rxs[i] - mx) * (cys[i] - my);
    den2 += (rxs[i] - mx) ** 2;
  }
  const C1 = num2 / den2;
  const C0 = my - C1 * mx;
  return {
    C0,
    C1,
    beta,
    predict: (f, r) => Math.max(0, C0 + C1 * r) * Math.pow(f, beta),
  };
}

function fit2DLogPoly(data: DataPoint[]): {
  coef: number[];
  predict: (field: number, roi: number) => number;
} {
  const X: number[][] = [];
  const y: number[] = [];
  for (const d of data) {
    X.push(features2DLogPoly(d.field, d.roi));
    y.push(Math.log(d.sigma));
  }
  const { coef } = olsFit(X, y);
  return {
    coef,
    predict: (f, r) => Math.exp(olsPredict(coef, features2DLogPoly(f, r))),
  };
}

function olsPredict(coef: number[], features: number[]): number {
  let s = 0;
  for (let i = 0; i < coef.length; i++) s += coef[i] * features[i];
  return s;
}

// ============================ Cross-validation ==========================

function rSquared(data: DataPoint[], predict: (f: number, r: number) => number): number {
  const yMean = data.reduce((a, b) => a + b.sigma, 0) / data.length;
  let sr = 0;
  let st = 0;
  for (const d of data) {
    const p = predict(d.field, d.roi);
    sr += (d.sigma - p) ** 2;
    st += (d.sigma - yMean) ** 2;
  }
  return st > 0 ? 1 - sr / st : 1;
}

function leaveOneOutXval(
  data: DataPoint[],
  fitter: (d: DataPoint[]) => (f: number, r: number) => number,
): { meanAbsPct: number; maxAbsPct: number; p95AbsPct: number; p99AbsPct: number; residuals: number[] } {
  const residuals: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const held = data[i];
    const train = data.filter((_, j) => j !== i);
    const predict = fitter(train);
    const pred = predict(held.field, held.roi);
    const rel = Math.abs((pred - held.sigma) / held.sigma) * 100;
    residuals.push(rel);
  }
  residuals.sort((a, b) => a - b);
  const mean = residuals.reduce((a, b) => a + b, 0) / residuals.length;
  const max = residuals[residuals.length - 1];
  const p = (q: number) =>
    residuals[Math.min(residuals.length - 1, Math.floor(q * residuals.length))];
  return {
    meanAbsPct: mean,
    maxAbsPct: max,
    p95AbsPct: p(0.95),
    p99AbsPct: p(0.99),
    residuals,
  };
}

// =============================== Main ===================================

function report(name: string, data: DataPoint[]) {
  console.log(`\n================== ${name.toUpperCase()} ==================`);
  console.log(`  data points: ${data.length} (${new Set(data.map((d) => d.roi)).size} ROIs × ${new Set(data.map((d) => d.field)).size} fields)`);
  console.log(`  field range: ${Math.min(...data.map((d) => d.field))} – ${Math.max(...data.map((d) => d.field)).toLocaleString()}`);
  console.log(`  roi range: ${(Math.min(...data.map((d) => d.roi)) * 100).toFixed(0)}% – ${(Math.max(...data.map((d) => d.roi)) * 100).toFixed(0)}%`);

  const fitA = fitSingleBeta(data);
  const r2A = rSquared(data, fitA.predict);
  const xvalA = leaveOneOutXval(data, (train) => fitSingleBeta(train).predict);

  const fitB = fit2DLogPoly(data);
  const r2B = rSquared(data, fitB.predict);
  const xvalB = leaveOneOutXval(data, (train) => fit2DLogPoly(train).predict);

  console.log("");
  console.log("  === Model A: single-β (current production form) ===");
  console.log(`    σ = (${fitA.C0.toFixed(4)} + ${fitA.C1.toFixed(4)}·roi) · field^${fitA.beta.toFixed(4)}`);
  console.log(`    in-sample R²        = ${r2A.toFixed(5)}`);
  console.log(`    LOO xval mean |Δ/σ| = ${xvalA.meanAbsPct.toFixed(2)}%`);
  console.log(`    LOO xval p95  |Δ/σ| = ${xvalA.p95AbsPct.toFixed(2)}%`);
  console.log(`    LOO xval p99  |Δ/σ| = ${xvalA.p99AbsPct.toFixed(2)}%`);
  console.log(`    LOO xval max  |Δ/σ| = ${xvalA.maxAbsPct.toFixed(2)}%`);

  console.log("");
  console.log("  === Model B: 2D log-poly with interaction ===");
  const [a0, a1, a2, b1, b2, c] = fitB.coef;
  console.log(`    log σ = ${a0.toFixed(4)} + ${a1.toFixed(4)}·L + ${a2.toFixed(4)}·L² + ${b1.toFixed(4)}·R + ${b2.toFixed(4)}·R² + ${c.toFixed(4)}·R·L`);
  console.log(`    in-sample R²        = ${r2B.toFixed(5)}`);
  console.log(`    LOO xval mean |Δ/σ| = ${xvalB.meanAbsPct.toFixed(2)}%`);
  console.log(`    LOO xval p95  |Δ/σ| = ${xvalB.p95AbsPct.toFixed(2)}%`);
  console.log(`    LOO xval p99  |Δ/σ| = ${xvalB.p99AbsPct.toFixed(2)}%`);
  console.log(`    LOO xval max  |Δ/σ| = ${xvalB.maxAbsPct.toFixed(2)}%`);

  const improveMean = ((xvalA.meanAbsPct - xvalB.meanAbsPct) / xvalA.meanAbsPct) * 100;
  const improveMax = ((xvalA.maxAbsPct - xvalB.maxAbsPct) / xvalA.maxAbsPct) * 100;
  console.log("");
  console.log(`  Improvement: mean −${improveMean.toFixed(1)}%, max −${improveMax.toFixed(1)}%`);
  console.log("");
  console.log(`  === Production-ready constants ===`);
  console.log(`  const SIGMA_ROI_${name.toUpperCase()}_2D = {`);
  console.log(`    a0: ${a0.toFixed(5)},`);
  console.log(`    a1: ${a1.toFixed(5)},`);
  console.log(`    a2: ${a2.toFixed(5)},`);
  console.log(`    b1: ${b1.toFixed(5)},`);
  console.log(`    b2: ${b2.toFixed(5)},`);
  console.log(`    c:  ${c.toFixed(5)},`);
  // Use p95 as resid — conservative band that encompasses 95% of observed drift.
  console.log(`    resid: ${(xvalB.p95AbsPct / 100).toFixed(3)},  // p95 LOO = ${xvalB.p95AbsPct.toFixed(1)}% (mean ${xvalB.meanAbsPct.toFixed(1)}%, max ${xvalB.maxAbsPct.toFixed(1)}%)`);
  console.log(`  };`);

  return { fitA, fitB, r2A, r2B, xvalA, xvalB };
}

async function main() {
  const cwd = process.cwd();
  const pkoPath = `${cwd}/scripts/fit_beta_pko.json`;
  const mysteryPath = `${cwd}/scripts/fit_beta_mystery.json`;

  const pkoData = loadData(pkoPath);
  const mysteryData = loadData(mysteryPath);

  console.log(`refit_2d_logpoly: promoting 2D log-poly from canonical fit_beta_*.json`);
  console.log(`  (no new simulator runs — 198 production data points per format)`);

  report("pko", pkoData);
  report("mystery", mysteryData);
}

main();
