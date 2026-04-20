/**
 * Sanity check: does a full 2D log-polynomial fit close the residual gap for
 * PKO / Mystery where single-β (C0+C1·roi)·field^β leaves ~17.6% xval residual?
 *
 * Motivation: existing fit_sigma_parallel.ts writes `logPolyPooled` with
 * quadratic-in-log(field) structure, but it's pooled across ROIs with per-ROI
 * centering (a, b1, b2 only) so it's not evaluable at arbitrary (field, roi).
 * True runtime-usable 2D form needs: log σ = a + b1·L + b2·L² + c1·R + c2·R²
 *                                            + d·R·L  (L=log field, R=roi).
 * Six parameters instead of three — still cheap to store and eval.
 *
 * Compares:
 *   A) single-β (current production)
 *   B) 2D log-poly (interaction + ROI-quadratic)
 *
 * Metrics: train R², held-out xval residual (10 off-grid points), mean |Δ/σ|.
 *
 *   npx tsx scripts/diag_fit_form_compare.ts
 *
 * Runs serial (~3-5 min total for PKO+Mystery at SAMPLES=20k).
 */

import { runSimulation } from "../src/lib/sim/engine";
import type { FinishModelId, SimulationInput, TournamentRow } from "../src/lib/sim/types";

const SAMPLES = 20_000;
const N_TOURNEYS = 500;
const BUY_IN = 50;
const RAKE = 0.10;
const SEED = 20260420;

const TRAIN_FIELDS = [50, 100, 300, 1000, 3000, 10_000, 30_000, 100_000];
const TRAIN_ROIS = [-0.10, 0.0, 0.05, 0.10, 0.15, 0.20, 0.30];

// 10 held-out points not on train grid.
const HELD_OUT: Array<{ field: number; roi: number }> = [
  { field: 75, roi: -0.05 },
  { field: 200, roi: 0.02 },
  { field: 500, roi: 0.07 },
  { field: 1500, roi: 0.12 },
  { field: 5000, roi: 0.17 },
  { field: 15_000, roi: 0.25 },
  { field: 50_000, roi: 0.08 },
  { field: 150_000, roi: 0.13 },
  { field: 400, roi: 0.03 },
  { field: 8000, roi: 0.22 },
];

type Format = "pko" | "mystery";

function buildRow(format: Format, field: number, roi: number): TournamentRow {
  if (format === "mystery") {
    return {
      id: "diag",
      label: `${format}-${field}-${roi}`,
      players: field,
      buyIn: BUY_IN,
      rake: RAKE,
      roi,
      payoutStructure: "mtt-gg-mystery",
      gameType: "mystery",
      bountyFraction: 0.5,
      mysteryBountyVariance: 2.0,
      pkoHeadVar: 0.4,
      count: N_TOURNEYS,
    };
  }
  return {
    id: "diag",
    label: `${format}-${field}-${roi}`,
    players: field,
    buyIn: BUY_IN,
    rake: RAKE,
    roi,
    payoutStructure: "mtt-gg-bounty",
    gameType: "pko",
    bountyFraction: 0.5,
    pkoHeadVar: 0.4,
    count: N_TOURNEYS,
  };
}

function buildInput(format: Format, field: number, roi: number): SimulationInput {
  const finishId: FinishModelId =
    format === "mystery" ? "mystery-realdata-linear" : "pko-realdata-linear";
  return {
    schedule: [buildRow(format, field, roi)],
    scheduleRepeats: 1,
    samples: SAMPLES,
    bankroll: 0,
    seed: SEED,
    finishModel: { id: finishId },
  };
}

function measure(format: Format, field: number, roi: number): number {
  const r = runSimulation(buildInput(format, field, roi));
  const N = r.tournamentsPerSample;
  const abi = r.totalBuyIn / N;
  return (r.stats.stdDev / Math.sqrt(N)) / abi;
}

// ============================= Linear algebra =============================

function solveSymmetric(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[piv][col])) piv = row;
    }
    if (piv !== col) [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    if (Math.abs(d) < 1e-14) throw new Error(`singular at col=${col}`);
    for (let j = col; j <= n; j++) M[col][j] /= d;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = M[row][col];
      for (let j = col; j <= n; j++) M[row][j] -= f * M[col][j];
    }
  }
  return M.map((row) => row[n]);
}

function olsFit(X: number[][], y: number[]): {
  coef: number[];
  r2: number;
  yHat: number[];
} {
  const n = X.length;
  const p = X[0].length;
  const XtX = Array.from({ length: p }, () => Array(p).fill(0));
  const Xty = Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      Xty[j] += X[i][j] * y[i];
      for (let k = 0; k < p; k++) {
        XtX[j][k] += X[i][j] * X[i][k];
      }
    }
  }
  const coef = solveSymmetric(XtX, Xty);
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  let sr = 0;
  let st = 0;
  const yHat: number[] = [];
  for (let i = 0; i < n; i++) {
    let p2 = 0;
    for (let j = 0; j < X[i].length; j++) p2 += coef[j] * X[i][j];
    yHat.push(p2);
    sr += (y[i] - p2) ** 2;
    st += (y[i] - yMean) ** 2;
  }
  return { coef, r2: st > 0 ? 1 - sr / st : 1, yHat };
}

// ============================== Model A: single-β =========================
//   σ = (C0 + C1·roi) · field^β
// Fit β globally via log σ vs log field regression pooled across ROIs
// (centered), then linear C(roi).

function fitSingleBeta(
  fields: number[],
  rois: number[],
  sigma: Record<string, number>,
): {
  C0: number;
  C1: number;
  beta: number;
  predict: (f: number, r: number) => number;
  inSampleR2: number;
} {
  const lxCentered: number[] = [];
  const lyCentered: number[] = [];
  const perRoi: Record<number, { mx: number; my: number; lxs: number[]; lys: number[] }> = {};

  for (const r of rois) {
    const lxs = fields.map((f) => Math.log(f));
    const lys = fields.map((f) => Math.log(sigma[`${f}|${r}`]));
    const mx = lxs.reduce((a, b) => a + b, 0) / lxs.length;
    const my = lys.reduce((a, b) => a + b, 0) / lys.length;
    perRoi[r] = { mx, my, lxs, lys };
    for (let i = 0; i < lxs.length; i++) {
      lxCentered.push(lxs[i] - mx);
      lyCentered.push(lys[i] - my);
    }
  }

  // beta from centered pooled regression through origin
  let num = 0;
  let den = 0;
  for (let i = 0; i < lxCentered.length; i++) {
    num += lxCentered[i] * lyCentered[i];
    den += lxCentered[i] * lxCentered[i];
  }
  const beta = num / den;

  // Per-ROI C from intercept fit: C = exp(mean(lys) - beta·mean(lxs))
  const cs: { roi: number; C: number }[] = [];
  for (const r of rois) {
    const { mx, my } = perRoi[r];
    cs.push({ roi: r, C: Math.exp(my - beta * mx) });
  }

  // Linear C(roi) = C0 + C1·roi
  const mx = cs.reduce((a, b) => a + b.roi, 0) / cs.length;
  const my = cs.reduce((a, b) => a + b.C, 0) / cs.length;
  let num2 = 0;
  let den2 = 0;
  for (const { roi, C } of cs) {
    num2 += (roi - mx) * (C - my);
    den2 += (roi - mx) ** 2;
  }
  const C1 = num2 / den2;
  const C0 = my - C1 * mx;

  const predict = (f: number, r: number) =>
    Math.max(0, C0 + C1 * r) * Math.pow(f, beta);

  // In-sample R² on raw σ (not log σ) — fair comparison vs model B later.
  let sr = 0;
  let st = 0;
  const sigmas: number[] = [];
  for (const r of rois) for (const f of fields) sigmas.push(sigma[`${f}|${r}`]);
  const sMean = sigmas.reduce((a, b) => a + b, 0) / sigmas.length;
  for (const r of rois) {
    for (const f of fields) {
      const obs = sigma[`${f}|${r}`];
      const pred = predict(f, r);
      sr += (obs - pred) ** 2;
      st += (obs - sMean) ** 2;
    }
  }

  return { C0, C1, beta, predict, inSampleR2: st > 0 ? 1 - sr / st : 1 };
}

// ============================= Model B: 2D log-poly =======================
//   log σ = a0 + a1·L + a2·L² + b1·R + b2·R² + c·R·L
// where L = log(field), R = roi. Six parameters, evaluable at arbitrary
// (field, roi), includes curvature on both axes plus interaction.

function fit2DLogPoly(
  fields: number[],
  rois: number[],
  sigma: Record<string, number>,
): {
  coef: number[]; // [a0, a1, a2, b1, b2, c]
  predict: (f: number, r: number) => number;
  inSampleR2: number;
} {
  const X: number[][] = [];
  const y: number[] = [];
  for (const r of rois) {
    for (const f of fields) {
      const L = Math.log(f);
      const R = r;
      X.push([1, L, L * L, R, R * R, R * L]);
      y.push(Math.log(sigma[`${f}|${r}`]));
    }
  }
  const { coef } = olsFit(X, y);
  const [a0, a1, a2, b1, b2, c] = coef;
  const predict = (f: number, r: number) => {
    const L = Math.log(f);
    return Math.exp(a0 + a1 * L + a2 * L * L + b1 * r + b2 * r * r + c * r * L);
  };

  // In-sample R² on raw σ for fair vs Model A.
  let sr = 0;
  let st = 0;
  const sigmas: number[] = [];
  for (const r of rois) for (const f of fields) sigmas.push(sigma[`${f}|${r}`]);
  const sMean = sigmas.reduce((a, b) => a + b, 0) / sigmas.length;
  for (const r of rois) {
    for (const f of fields) {
      const obs = sigma[`${f}|${r}`];
      const pred = predict(f, r);
      sr += (obs - pred) ** 2;
      st += (obs - sMean) ** 2;
    }
  }

  return { coef, predict, inSampleR2: st > 0 ? 1 - sr / st : 1 };
}

// =============================== Main =====================================

interface FitReport {
  format: Format;
  singleBeta: { C0: number; C1: number; beta: number; inR2: number; xvalMeanAbsPct: number; xvalMaxAbsPct: number };
  logPoly2D: { coef: number[]; inR2: number; xvalMeanAbsPct: number; xvalMaxAbsPct: number };
}

async function measureFormat(format: Format): Promise<FitReport> {
  console.log(`\n==== ${format.toUpperCase()} ====`);
  console.log(`  Measuring train grid: ${TRAIN_FIELDS.length} fields × ${TRAIN_ROIS.length} ROIs = ${TRAIN_FIELDS.length * TRAIN_ROIS.length} points`);
  const sigma: Record<string, number> = {};
  const t0 = Date.now();
  let done = 0;
  const total = TRAIN_FIELDS.length * TRAIN_ROIS.length;
  for (const r of TRAIN_ROIS) {
    for (const f of TRAIN_FIELDS) {
      sigma[`${f}|${r}`] = measure(format, f, r);
      done++;
      if (done % 14 === 0 || done === total) {
        process.stdout.write(
          `\r    ${done}/${total} (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
        );
      }
    }
  }
  console.log("");

  console.log(`  Measuring held-out: ${HELD_OUT.length} points`);
  const heldOut: Array<{ field: number; roi: number; sigma: number }> = [];
  for (const { field, roi } of HELD_OUT) {
    heldOut.push({ field, roi, sigma: measure(format, field, roi) });
  }

  const fitA = fitSingleBeta(TRAIN_FIELDS, TRAIN_ROIS, sigma);
  const fitB = fit2DLogPoly(TRAIN_FIELDS, TRAIN_ROIS, sigma);

  const xvalA = heldOut.map(({ field, roi, sigma }) => {
    const pred = fitA.predict(field, roi);
    return { field, roi, obs: sigma, pred, absPct: Math.abs((pred - sigma) / sigma) * 100 };
  });
  const xvalB = heldOut.map(({ field, roi, sigma }) => {
    const pred = fitB.predict(field, roi);
    return { field, roi, obs: sigma, pred, absPct: Math.abs((pred - sigma) / sigma) * 100 };
  });
  const meanA = xvalA.reduce((s, x) => s + x.absPct, 0) / xvalA.length;
  const maxA = Math.max(...xvalA.map((x) => x.absPct));
  const meanB = xvalB.reduce((s, x) => s + x.absPct, 0) / xvalB.length;
  const maxB = Math.max(...xvalB.map((x) => x.absPct));

  console.log("");
  console.log("  === Model A: single-β (current prod) ===");
  console.log(`    σ = (${fitA.C0.toFixed(4)} + ${fitA.C1.toFixed(4)}·roi) · field^${fitA.beta.toFixed(4)}`);
  console.log(`    in-sample R²        = ${fitA.inSampleR2.toFixed(5)}`);
  console.log(`    held-out mean |Δ/σ| = ${meanA.toFixed(2)}%`);
  console.log(`    held-out max  |Δ/σ| = ${maxA.toFixed(2)}%`);

  console.log("");
  console.log("  === Model B: 2D log-poly (interaction + ROI-quadratic) ===");
  const [a0, a1, a2, b1, b2, cc] = fitB.coef;
  console.log(`    log σ = ${a0.toFixed(4)} + ${a1.toFixed(4)}·L + ${a2.toFixed(4)}·L² + ${b1.toFixed(4)}·R + ${b2.toFixed(4)}·R² + ${cc.toFixed(4)}·R·L`);
  console.log(`    in-sample R²        = ${fitB.inSampleR2.toFixed(5)}`);
  console.log(`    held-out mean |Δ/σ| = ${meanB.toFixed(2)}%`);
  console.log(`    held-out max  |Δ/σ| = ${maxB.toFixed(2)}%`);

  console.log("");
  console.log("  === Per-held-out comparison ===");
  console.log("    field   roi    σ(obs)  σ(A-sβ)  |Δ/σ|A   σ(B-2D)  |Δ/σ|B");
  console.log("    ------  -----  ------  -------  -------  -------  -------");
  for (let i = 0; i < heldOut.length; i++) {
    const { field, roi, sigma: obs } = heldOut[i];
    console.log(
      `    ${String(field).padStart(6)}  ${(roi * 100).toFixed(0).padStart(3)}%   ${obs.toFixed(3).padStart(6)}  ${xvalA[i].pred.toFixed(3).padStart(7)}  ${xvalA[i].absPct.toFixed(2).padStart(6)}%  ${xvalB[i].pred.toFixed(3).padStart(7)}  ${xvalB[i].absPct.toFixed(2).padStart(6)}%`,
    );
  }

  console.log("");
  const delta = meanA - meanB;
  const pct = ((meanA - meanB) / meanA) * 100;
  console.log(
    `  Verdict: 2D log-poly reduces mean xval residual by ${delta.toFixed(2)}pp (${pct.toFixed(1)}% of A's residual)`,
  );

  return {
    format,
    singleBeta: {
      C0: fitA.C0,
      C1: fitA.C1,
      beta: fitA.beta,
      inR2: fitA.inSampleR2,
      xvalMeanAbsPct: meanA,
      xvalMaxAbsPct: maxA,
    },
    logPoly2D: {
      coef: fitB.coef,
      inR2: fitB.inSampleR2,
      xvalMeanAbsPct: meanB,
      xvalMaxAbsPct: maxB,
    },
  };
}

async function main() {
  const t0 = Date.now();
  console.log(
    `diag_fit_form_compare: train ${TRAIN_FIELDS.length}×${TRAIN_ROIS.length} + held-out ${HELD_OUT.length}, samples=${SAMPLES}, N=${N_TOURNEYS}, seed=${SEED}`,
  );
  console.log(
    `  Field range: ${TRAIN_FIELDS[0]} – ${TRAIN_FIELDS[TRAIN_FIELDS.length - 1].toLocaleString()}`,
  );
  console.log(`  ROI range:   ${TRAIN_ROIS[0] * 100}% – ${TRAIN_ROIS[TRAIN_ROIS.length - 1] * 100}%`);

  const pko = await measureFormat("pko");
  const mystery = await measureFormat("mystery");

  console.log("\n========================================");
  console.log("SUMMARY");
  console.log("========================================");
  for (const report of [pko, mystery]) {
    console.log(`\n${report.format.toUpperCase()}:`);
    console.log(
      `  single-β:    mean |Δ/σ| = ${report.singleBeta.xvalMeanAbsPct.toFixed(2)}%,  max = ${report.singleBeta.xvalMaxAbsPct.toFixed(2)}%`,
    );
    console.log(
      `  2D log-poly: mean |Δ/σ| = ${report.logPoly2D.xvalMeanAbsPct.toFixed(2)}%,  max = ${report.logPoly2D.xvalMaxAbsPct.toFixed(2)}%`,
    );
    const improvement =
      ((report.singleBeta.xvalMeanAbsPct - report.logPoly2D.xvalMeanAbsPct) /
        report.singleBeta.xvalMeanAbsPct) *
      100;
    console.log(`  improvement: ${improvement.toFixed(1)}%`);
  }

  const bothBelow5 =
    pko.logPoly2D.xvalMeanAbsPct < 5 && mystery.logPoly2D.xvalMeanAbsPct < 5;
  const bothBelow10 =
    pko.logPoly2D.xvalMeanAbsPct < 10 && mystery.logPoly2D.xvalMeanAbsPct < 10;

  console.log("");
  if (bothBelow5) {
    console.log("VERDICT: 2D log-poly gets both formats below 5% mean residual — candidate for numeric band.");
  } else if (bothBelow10) {
    console.log("VERDICT: 2D log-poly halves residual into 5–10% range — consider tighter resid but keep band hidden for Mystery.");
  } else {
    console.log("VERDICT: 2D log-poly doesn't close the gap enough — placeholder hold stands.");
  }

  console.log(`\ntotal: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main();
