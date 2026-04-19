/**
 * Cross-validate BR σ_ROI fit on INDEPENDENT ROI points.
 *
 * fit_br_fixed18.ts trains on 11 ROIs and reports R². R² on training data
 * can look perfect even if the model misses a systematic non-linearity.
 * This script measures σ_ROI on 10 held-out ROI points and compares
 * against the linear predictor C0 + C1·roi + residuals.
 *
 *   npx tsx scripts/xval_br.ts
 */

import { runSimulation } from "../src/lib/sim/engine";
import type { SimulationInput, TournamentRow } from "../src/lib/sim/types";

const N_TOURNEYS = 500;
const SAMPLES = 200_000;
const BUY_IN = 50;
const RAKE = 0.08;
const AFS = 18;
// Different seed from training run (20260417) — independence of samples.
const SEED = 20260418;

// Held-out ROIs that don't appear in fit_br_fixed18.ts training set.
// Dense around the real-world band (-5%..+15%) where BR regs actually live.
const HELD_OUT = [-0.15, -0.05, 0.02, 0.07, 0.12, 0.18, 0.22, 0.35, 0.5, 0.6];

// Freshly-fitted coefficients (fit_beta_mystery_royale.json, 2026-04-18).
const C0 = 8.1534;
const C1 = 7.9063;

function buildInput(roi: number): SimulationInput {
  const row: TournamentRow = {
    id: "br-xval",
    label: `br-xval-${roi}`,
    players: AFS,
    buyIn: BUY_IN,
    rake: RAKE,
    roi,
    payoutStructure: "battle-royale",
    gameType: "mystery-royale",
    bountyFraction: 0.5,
    mysteryBountyVariance: 1.8,
    pkoHeadVar: 0,
    itmRate: 0.18,
    count: N_TOURNEYS,
  };
  return {
    schedule: [row],
    scheduleRepeats: 1,
    samples: SAMPLES,
    bankroll: 0,
    seed: SEED,
    finishModel: { id: "mystery-realdata-linear" },
  };
}

function measure(roi: number): { sigma: number; sigmaSE: number } {
  const r = runSimulation(buildInput(roi));
  const N = r.tournamentsPerSample;
  const abi = r.totalBuyIn / N;
  const sigma = (r.stats.stdDev / Math.sqrt(N)) / abi;
  // Standard error of σ estimate ≈ σ / sqrt(2(samples-1)) for normal data.
  const sigmaSE = sigma / Math.sqrt(2 * (SAMPLES - 1));
  return { sigma, sigmaSE };
}

async function main() {
  const t0 = Date.now();
  console.log(
    `xval_br: ${HELD_OUT.length} held-out ROIs @ AFS=${AFS}, N=${N_TOURNEYS}, samples=${SAMPLES}, seed=${SEED}`,
  );
  console.log(`  predictor: σ = ${C0} + ${C1} × roi`);
  console.log("");
  console.log(
    "  roi      σ(actual)  σ(SE)    σ(pred)    Δ        Δ/σ(SE)  Δ/σ(%)",
  );
  console.log(
    "  -------  ---------  -------  ---------  -------  -------  -------",
  );
  const rows: Array<{
    roi: number;
    sigma: number;
    sigmaSE: number;
    pred: number;
    resid: number;
    residStd: number;
    residPct: number;
  }> = [];
  for (const roi of HELD_OUT) {
    const { sigma, sigmaSE } = measure(roi);
    const pred = C0 + C1 * roi;
    const resid = sigma - pred;
    const residStd = resid / sigmaSE;
    const residPct = (resid / sigma) * 100;
    rows.push({ roi, sigma, sigmaSE, pred, resid, residStd, residPct });
    console.log(
      `  ${(roi * 100).toFixed(1).padStart(5)}%   ${sigma.toFixed(4).padStart(8)}  ${sigmaSE.toFixed(4).padStart(6)}   ${pred.toFixed(4).padStart(8)}   ${resid >= 0 ? "+" : ""}${resid.toFixed(4)}  ${residStd >= 0 ? "+" : ""}${residStd.toFixed(2).padStart(5)}   ${residPct >= 0 ? "+" : ""}${residPct.toFixed(2)}%`,
    );
  }

  // Aggregate stats
  const n = rows.length;
  const meanAbsResid = rows.reduce((s, r) => s + Math.abs(r.resid), 0) / n;
  const maxAbsResidPct = Math.max(...rows.map((r) => Math.abs(r.residPct)));
  const rmseResid = Math.sqrt(
    rows.reduce((s, r) => s + r.resid * r.resid, 0) / n,
  );
  const meanAbsResidSE = rows.reduce((s, r) => s + Math.abs(r.residStd), 0) / n;

  console.log("");
  console.log("  Aggregate residuals on held-out ROIs:");
  console.log(`    mean |resid|     = ${meanAbsResid.toFixed(4)}`);
  console.log(`    RMSE             = ${rmseResid.toFixed(4)}`);
  console.log(`    mean |resid/SE|  = ${meanAbsResidSE.toFixed(2)}  (SE-normalized; <2 = noise-indistinguishable)`);
  console.log(`    max |resid/σ|    = ${maxAbsResidPct.toFixed(2)}%`);

  // Try quadratic fit on held-out: σ = a + b·roi + c·roi²
  const xs = rows.map((r) => r.roi);
  const ys = rows.map((r) => r.sigma);
  const { a, b, c, r2 } = quadFit(xs, ys);
  console.log("");
  console.log("  Quadratic fit on held-out only (independent data):");
  console.log(`    σ = ${a.toFixed(4)} + ${b.toFixed(4)}·roi + ${c.toFixed(4)}·roi²`);
  console.log(`    R² = ${r2.toFixed(6)}  (linear training R² was 0.99999)`);
  console.log(`    curvature term |c·(roi_max)²| = ${Math.abs(c * 0.6 * 0.6).toFixed(4)} at roi=60%`);

  console.log("");
  console.log(`  total: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

function quadFit(xs: number[], ys: number[]): {
  a: number;
  b: number;
  c: number;
  r2: number;
} {
  // Normal-equations solve for [a, b, c] with columns [1, x, x²].
  const n = xs.length;
  let s0 = n;
  let s1 = 0,
    s2 = 0,
    s3 = 0,
    s4 = 0;
  let y0 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    s1 += x;
    s2 += x * x;
    s3 += x * x * x;
    s4 += x * x * x * x;
    y0 += y;
    y1 += y * x;
    y2 += y * x * x;
  }
  const A = [
    [s0, s1, s2],
    [s1, s2, s3],
    [s2, s3, s4],
  ];
  const Y = [y0, y1, y2];
  const [a, b, c] = solve3(A, Y);
  const my = y0 / n;
  let sr = 0,
    st = 0;
  for (let i = 0; i < n; i++) {
    const pred = a + b * xs[i] + c * xs[i] * xs[i];
    sr += (ys[i] - pred) ** 2;
    st += (ys[i] - my) ** 2;
  }
  return { a, b, c, r2: 1 - sr / st };
}

function solve3(A: number[][], Y: number[]): [number, number, number] {
  // Cramer's rule, fine for 3×3.
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  const mk = (idx: number) => {
    const M = A.map((r) => [...r]);
    for (let i = 0; i < 3; i++) M[i][idx] = Y[i];
    return M;
  };
  return [det(mk(0)) / D, det(mk(1)) / D, det(mk(2)) / D];
}

main();
