/**
 * Cross-validate Mystery σ_ROI fit on INDEPENDENT (field, ROI) points.
 *
 * Training (fit_beta_mystery.json, 2026-04-18) used 18 fields × 11 ROIs.
 * This script measures σ_ROI on held-out combinations not in the training
 * grid, comparing against the runtime 2D log-poly Mystery predictor.
 *
 *   npx tsx scripts/xval_mystery.ts
 */

import { runSimulation } from "../src/lib/sim/engine";
import type { SimulationInput, TournamentRow } from "../src/lib/sim/types";

const N_TOURNEYS = 500;
const SAMPLES = 120_000;
const BUY_IN = 50;
const RAKE = 0.1;
// Different seed from training (20260417/20260418) — independence of samples.
const SEED = 20260419;

// Runtime Mystery coefficients from ConvergenceChart.tsx.
const MYSTERY = {
  a0: 2.33290,
  a1: -0.27564,
  a2: 0.02917,
  b1: 1.14218,
  b2: -0.09962,
  c: -0.08406,
};

// Held-out (field, ROI) pairs: none of these appear in the training grid.
// Fields chosen between training grid points; ROIs chosen between the 11 trained ROIs.
const HELD_OUT: Array<{ afs: number; roi: number }> = [
  { afs: 125, roi: -0.15 },
  { afs: 250, roi: -0.05 },
  { afs: 400, roi: 0.02 },
  { afs: 600, roi: 0.07 },
  { afs: 1200, roi: 0.12 },
  { afs: 2500, roi: 0.18 },
  { afs: 4000, roi: 0.22 },
  { afs: 8000, roi: 0.35 },
  { afs: 20000, roi: 0.5 },
  { afs: 35000, roi: 0.6 },
];

function buildInput(afs: number, roi: number): SimulationInput {
  const row: TournamentRow = {
    id: "mys-xval",
    label: `mys-xval-${afs}-${roi}`,
    players: afs,
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
  return {
    schedule: [row],
    scheduleRepeats: 1,
    samples: SAMPLES,
    bankroll: 0,
    seed: SEED,
    finishModel: { id: "mystery-realdata-linear" },
  };
}

function measure(afs: number, roi: number): { sigma: number; sigmaSE: number } {
  const r = runSimulation(buildInput(afs, roi));
  const N = r.tournamentsPerSample;
  const abi = r.totalBuyIn / N;
  const sigma = (r.stats.stdDev / Math.sqrt(N)) / abi;
  const sigmaSE = sigma / Math.sqrt(2 * (SAMPLES - 1));
  return { sigma, sigmaSE };
}

function predictMystery(afs: number, roi: number): number {
  const L = Math.log(Math.max(1, afs));
  return Math.exp(
    MYSTERY.a0 +
      MYSTERY.a1 * L +
      MYSTERY.a2 * L * L +
      MYSTERY.b1 * roi +
      MYSTERY.b2 * roi * roi +
      MYSTERY.c * roi * L,
  );
}

async function main() {
  const t0 = Date.now();
  console.log(
    `xval_mystery: ${HELD_OUT.length} held-out (field,roi) points, N=${N_TOURNEYS}, samples=${SAMPLES}, seed=${SEED}`,
  );
  console.log(
    "  predictor: log σ = a0 + a1·L + a2·L² + b1·R + b2·R² + c·R·L",
  );
  console.log("");
  console.log(
    "  field   roi      σ(actual)  σ(SE)    σ(pred)    Δ        Δ/σ(SE)  Δ/σ(%)",
  );
  console.log(
    "  ------  -------  ---------  -------  ---------  -------  -------  -------",
  );
  const rows: Array<{
    afs: number;
    roi: number;
    sigma: number;
    sigmaSE: number;
    pred: number;
    resid: number;
    residStd: number;
    residPct: number;
  }> = [];
  for (const { afs, roi } of HELD_OUT) {
    const { sigma, sigmaSE } = measure(afs, roi);
    const pred = predictMystery(afs, roi);
    const resid = sigma - pred;
    const residStd = resid / sigmaSE;
    const residPct = (resid / sigma) * 100;
    rows.push({ afs, roi, sigma, sigmaSE, pred, resid, residStd, residPct });
    console.log(
      `  ${String(afs).padStart(6)}  ${(roi * 100).toFixed(1).padStart(5)}%   ${sigma.toFixed(4).padStart(8)}  ${sigmaSE.toFixed(4).padStart(6)}   ${pred.toFixed(4).padStart(8)}   ${resid >= 0 ? "+" : ""}${resid.toFixed(4)}  ${residStd >= 0 ? "+" : ""}${residStd.toFixed(2).padStart(5)}   ${residPct >= 0 ? "+" : ""}${residPct.toFixed(2)}%`,
    );
  }

  const n = rows.length;
  const meanAbsResid = rows.reduce((s, r) => s + Math.abs(r.resid), 0) / n;
  const maxAbsResidPct = Math.max(...rows.map((r) => Math.abs(r.residPct)));
  const rmseResid = Math.sqrt(
    rows.reduce((s, r) => s + r.resid * r.resid, 0) / n,
  );
  const meanAbsResidSE = rows.reduce((s, r) => s + Math.abs(r.residStd), 0) / n;
  const meanAbsResidPct = rows.reduce((s, r) => s + Math.abs(r.residPct), 0) / n;

  console.log("");
  console.log("  Aggregate residuals on held-out (field, roi):");
  console.log(`    mean |resid|     = ${meanAbsResid.toFixed(4)}`);
  console.log(`    RMSE             = ${rmseResid.toFixed(4)}`);
  console.log(`    mean |resid/σ|   = ${meanAbsResidPct.toFixed(2)}%`);
  console.log(`    max  |resid/σ|   = ${maxAbsResidPct.toFixed(2)}%`);
  console.log(`    mean |resid/SE|  = ${meanAbsResidSE.toFixed(2)}  (<2 = noise-indistinguishable)`);

  console.log("");
  console.log(`  total: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main();
