/**
 * Validate the user-facing Mystery convergence predictor against independent
 * fresh sims.
 *
 * We keep two predictors here:
 *   1. legacy promoted 2D fit (diagnostic only)
 *   2. runtime single-row analytic compile (the chart's current source)
 *
 * The point is not to defend the old fit anymore; it's to prove that the
 * runtime-centered Mystery widget can honestly show a numeric band across the
 * full UI box. So we probe both:
 *   - off-grid points between trained field / ROI cells
 *   - nasty edge points right on the UI-box boundaries
 *
 *   npx tsx scripts/xval_mystery.ts
 */

import {
  buildScheduleAnalyticBreakdown,
  runSimulation,
} from "../src/lib/sim/engine";
import { SIGMA_ROI_MYSTERY_RUNTIME_RESID } from "../src/lib/sim/convergenceFit";
import type { SimulationInput, TournamentRow } from "../src/lib/sim/types";

const N_TOURNEYS = 500;
const SAMPLES = 120_000;
const BUY_IN = 50;
const RAKE = 0.1;
// Different seed from earlier sweeps so this stays independent.
const SEED = 20260421;

const LEGACY_FIT = {
  a0: 2.33290,
  a1: -0.27564,
  a2: 0.02917,
  b1: 1.14218,
  b2: -0.09962,
  c: -0.08406,
};

const OFF_GRID: Array<{ afs: number; roi: number }> = [
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

const EDGE_BOX: Array<{ afs: number; roi: number }> = [
  { afs: 50, roi: -0.20 },
  { afs: 50, roi: 0.80 },
  { afs: 100, roi: -0.20 },
  { afs: 100, roi: 0.80 },
  { afs: 500, roi: -0.10 },
  { afs: 10000, roi: 0.30 },
  { afs: 50000, roi: -0.20 },
  { afs: 50000, roi: 0.40 },
  { afs: 50000, roi: 0.80 },
];

type Bucket = "off-grid" | "edge";

const POINTS: Array<{ afs: number; roi: number; bucket: Bucket }> = [
  ...OFF_GRID.map((p) => ({ ...p, bucket: "off-grid" as const })),
  ...EDGE_BOX.map((p) => ({ ...p, bucket: "edge" as const })),
];

function buildRow(afs: number, roi: number): TournamentRow {
  return {
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
}

function buildInput(afs: number, roi: number): SimulationInput {
  return {
    schedule: [buildRow(afs, roi)],
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

function predictLegacyFit(afs: number, roi: number): number {
  const L = Math.log(Math.max(1, afs));
  return Math.exp(
    LEGACY_FIT.a0 +
      LEGACY_FIT.a1 * L +
      LEGACY_FIT.a2 * L * L +
      LEGACY_FIT.b1 * roi +
      LEGACY_FIT.b2 * roi * roi +
      LEGACY_FIT.c * roi * L,
  );
}

function predictRuntime(afs: number, roi: number): number {
  const exact = buildScheduleAnalyticBreakdown({
    schedule: [buildRow(afs, roi)],
    finishModel: { id: "mystery-realdata-linear" },
  });
  if (!exact) throw new Error("mystery runtime breakdown failed");
  return exact.sigmaRoiPerTourney;
}

type RowResult = {
  bucket: Bucket;
  afs: number;
  roi: number;
  sigma: number;
  sigmaSE: number;
  legacy: number;
  runtime: number;
  legacyPct: number;
  runtimePct: number;
  legacySE: number;
  runtimeSE: number;
};

function summarize(label: string, rows: RowResult[]) {
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const max = (xs: number[]) => Math.max(...xs.map((x) => Math.abs(x)));
  const legacyPct = rows.map((r) => r.legacyPct);
  const runtimePct = rows.map((r) => r.runtimePct);
  const legacySE = rows.map((r) => r.legacySE);
  const runtimeSE = rows.map((r) => r.runtimeSE);

  console.log(`\n  ${label}:`);
  console.log(
    `    legacy fit     mean |Δ/σ| = ${mean(legacyPct.map(Math.abs)).toFixed(2)}%   max = ${max(legacyPct).toFixed(2)}%   mean |Δ/SE| = ${mean(legacySE.map(Math.abs)).toFixed(2)}`,
  );
  console.log(
    `    runtime exact  mean |Δ/σ| = ${mean(runtimePct.map(Math.abs)).toFixed(2)}%   max = ${max(runtimePct).toFixed(2)}%   mean |Δ/SE| = ${mean(runtimeSE.map(Math.abs)).toFixed(2)}`,
  );
}

async function main() {
  const t0 = Date.now();
  console.log(
    `xval_mystery: ${POINTS.length} fresh-sim points, N=${N_TOURNEYS}, samples=${SAMPLES}, seed=${SEED}`,
  );
  console.log(
    `  buckets: ${OFF_GRID.length} off-grid + ${EDGE_BOX.length} edge-of-box`,
  );
  console.log(
    `  runtime band candidate: ±${(SIGMA_ROI_MYSTERY_RUNTIME_RESID * 100).toFixed(1)}%`,
  );
  console.log("");
  console.log(
    "  bucket    field   roi      σ(actual)  σ(SE)    σ(fit)    Δfit/σ   σ(runtime)  Δrt/σ",
  );
  console.log(
    "  -------  ------  -------  ---------  -------  --------  -------  ----------  -------",
  );

  const rows: RowResult[] = [];
  for (const { afs, roi, bucket } of POINTS) {
    const { sigma, sigmaSE } = measure(afs, roi);
    const legacy = predictLegacyFit(afs, roi);
    const runtime = predictRuntime(afs, roi);
    const legacyPct = ((legacy - sigma) / sigma) * 100;
    const runtimePct = ((runtime - sigma) / sigma) * 100;
    const legacySE = (legacy - sigma) / sigmaSE;
    const runtimeSE = (runtime - sigma) / sigmaSE;
    rows.push({
      bucket,
      afs,
      roi,
      sigma,
      sigmaSE,
      legacy,
      runtime,
      legacyPct,
      runtimePct,
      legacySE,
      runtimeSE,
    });
    console.log(
      `  ${bucket.padEnd(7)} ${String(afs).padStart(6)} ${(roi * 100).toFixed(1).padStart(6)}%   ${sigma.toFixed(4).padStart(8)}  ${sigmaSE.toFixed(4).padStart(6)}   ${legacy.toFixed(4).padStart(8)}  ${legacyPct >= 0 ? "+" : ""}${legacyPct.toFixed(2).padStart(6)}%   ${runtime.toFixed(4).padStart(8)}  ${runtimePct >= 0 ? "+" : ""}${runtimePct.toFixed(2).padStart(6)}%`,
    );
  }

  summarize("off-grid only", rows.filter((r) => r.bucket === "off-grid"));
  summarize("edge box only", rows.filter((r) => r.bucket === "edge"));
  summarize("overall", rows);

  const runtimeMaxAbsPct = Math.max(...rows.map((r) => Math.abs(r.runtimePct)));
  console.log("");
  if (runtimeMaxAbsPct <= SIGMA_ROI_MYSTERY_RUNTIME_RESID * 100) {
    console.log(
      `  VERDICT: runtime Mystery predictor fits inside the validated ±${(SIGMA_ROI_MYSTERY_RUNTIME_RESID * 100).toFixed(1)}% residual band.`,
    );
  } else {
    console.log(
      `  VERDICT: runtime Mystery predictor exceeds the proposed ±${(SIGMA_ROI_MYSTERY_RUNTIME_RESID * 100).toFixed(1)}% residual band.`,
    );
  }
  console.log(`  total: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main();
