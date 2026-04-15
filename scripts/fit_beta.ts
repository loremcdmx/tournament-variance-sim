/**
 * Empirical fit of σ_ROI as a function of (field, ROI). Sweeps a log-spaced
 * grid of field sizes across several ROI values, extracts per-tourney σ_ROI
 * from `result.stats.stdDev`, and fits a log-log model
 *
 *     σ_ROI(field, roi) ≈ C(roi) · field^β(roi)
 *
 * Used to calibrate the β constant (and eventual ROI dependence) in
 * ConvergenceChart.
 */

import { runSimulation } from "../src/lib/sim/engine";
import type { SimulationInput, TournamentRow } from "../src/lib/sim/types";

const FIELDS = [
  50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500,
  10_000, 15_000, 25_000, 50_000,
];
const ROIS = [-0.20, -0.10, 0, 0.10, 0.20, 0.40, 0.80];
const N_TOURNEYS = 500;
const SAMPLES = 60_000;
const BUY_IN = 50;
const RAKE = 0.10;

interface Point {
  field: number;
  sigmaRoi: number;
}

function measure(field: number, roi: number): Point {
  const row: TournamentRow = {
    id: "sweep",
    label: `f${field}`,
    players: field,
    buyIn: BUY_IN,
    rake: RAKE,
    roi,
    payoutStructure: "mtt-standard",
    count: N_TOURNEYS,
  };
  const input: SimulationInput = {
    schedule: [row],
    scheduleRepeats: 1,
    samples: SAMPLES,
    bankroll: 0,
    seed: 20260415,
    finishModel: { id: "power-law" },
  };
  const r = runSimulation(input);
  const N = r.tournamentsPerSample;
  const abi = r.totalBuyIn / N;
  const sigmaRoi = (r.stats.stdDev / Math.sqrt(N)) / abi;
  return { field, sigmaRoi };
}

function fitLogLog(points: Point[]): { beta: number; intercept: number; r2: number } {
  const xs = points.map((p) => Math.log(p.field));
  const ys = points.map((p) => Math.log(p.sigmaRoi));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const beta = num / den;
  const intercept = my - beta * mx;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = intercept + beta * xs[i];
    ssRes += (ys[i] - pred) ** 2;
    ssTot += (ys[i] - my) ** 2;
  }
  const r2 = 1 - ssRes / ssTot;
  return { beta, intercept, r2 };
}

async function main() {
  console.log(
    `fit_beta: N=${N_TOURNEYS} samples=${SAMPLES} buyIn=${BUY_IN} rake=${RAKE}`,
  );
  console.log(`fields (${FIELDS.length}): ${FIELDS.join(", ")}`);
  console.log(`rois   (${ROIS.length}): ${ROIS.map((r) => r.toFixed(2)).join(", ")}`);
  console.log("");

  const table: Record<number, Point[]> = {};
  const t0 = Date.now();
  for (const roi of ROIS) {
    const label = `roi=${roi >= 0 ? "+" : ""}${(roi * 100).toFixed(0)}%`;
    console.log(`==== ${label} ====`);
    const points: Point[] = [];
    const tR = Date.now();
    for (const field of FIELDS) {
      const p = measure(field, roi);
      points.push(p);
    }
    table[roi] = points;
    const fit = fitLogLog(points);
    const line = points
      .map((p) => `${p.field}:${p.sigmaRoi.toFixed(2)}`)
      .join("  ");
    console.log(`  ${line}`);
    console.log(
      `  fit: σ = ${Math.exp(fit.intercept).toFixed(4)} · field^${fit.beta.toFixed(4)}   R²=${fit.r2.toFixed(5)}   (${((Date.now() - tR) / 1000).toFixed(1)}s)`,
    );
  }

  console.log("");
  console.log("==== summary ====");
  console.log("  roi       C           β         R²");
  const fits: Array<{ roi: number; C: number; beta: number; r2: number }> = [];
  for (const roi of ROIS) {
    const f = fitLogLog(table[roi]);
    fits.push({ roi, C: Math.exp(f.intercept), beta: f.beta, r2: f.r2 });
    console.log(
      `  ${(roi * 100).toFixed(0).padStart(4)}%  ${f.intercept.toFixed(4).padStart(10)}  ${f.beta.toFixed(4)}  ${f.r2.toFixed(5)}   C=${Math.exp(f.intercept).toFixed(4)}`,
    );
  }

  // Global fit assuming a single β across all ROIs: σ = C(roi) · field^β.
  // Collapse by regressing log σ - log C_roi on log field with a shared slope.
  // Equivalently: per-ROI mean-center log σ and log field, then pool.
  const xs: number[] = [];
  const ys: number[] = [];
  for (const roi of ROIS) {
    const pts = table[roi];
    const lx = pts.map((p) => Math.log(p.field));
    const ly = pts.map((p) => Math.log(p.sigmaRoi));
    const mx = lx.reduce((a, b) => a + b, 0) / lx.length;
    const my = ly.reduce((a, b) => a + b, 0) / ly.length;
    for (let i = 0; i < lx.length; i++) {
      xs.push(lx[i] - mx);
      ys.push(ly[i] - my);
    }
  }
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += xs[i] * ys[i];
    den += xs[i] * xs[i];
  }
  const betaGlobal = num / den;
  let ssRes = 0;
  let ssTot = 0;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  for (let i = 0; i < xs.length; i++) {
    const pred = betaGlobal * xs[i];
    ssRes += (ys[i] - pred) ** 2;
    ssTot += (ys[i] - my) ** 2;
  }
  const r2Global = 1 - ssRes / ssTot;
  console.log("");
  console.log(
    `  global shared-β fit (ROI-demeaned):  β = ${betaGlobal.toFixed(4)}   R²=${r2Global.toFixed(5)}`,
  );

  // ROI-dependence of C: fit log(C) vs roi (linear), and C vs roi (linear).
  // Useful for picking a future closed-form C(roi).
  const cRois = fits.map((f) => f.roi);
  const cVals = fits.map((f) => f.C);
  const logCs = fits.map((f) => Math.log(f.C));
  const linFit = (xv: number[], yv: number[]) => {
    const n = xv.length;
    const mx = xv.reduce((a, b) => a + b, 0) / n;
    const my = yv.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (xv[i] - mx) * (yv[i] - my);
      den += (xv[i] - mx) ** 2;
    }
    const slope = num / den;
    const intercept = my - slope * mx;
    let sr = 0;
    let st = 0;
    for (let i = 0; i < n; i++) {
      const pred = intercept + slope * xv[i];
      sr += (yv[i] - pred) ** 2;
      st += (yv[i] - my) ** 2;
    }
    return { slope, intercept, r2: 1 - sr / st };
  };
  const linC = linFit(cRois, cVals);
  const linLogC = linFit(cRois, logCs);
  console.log(
    `  C(roi) linear:    C = ${linC.intercept.toFixed(4)} + ${linC.slope.toFixed(4)}·roi         R²=${linC.r2.toFixed(5)}`,
  );
  console.log(
    `  log C(roi) lin.:  log C = ${linLogC.intercept.toFixed(4)} + ${linLogC.slope.toFixed(4)}·roi   R²=${linLogC.r2.toFixed(5)}`,
  );

  // Emit JSON for downstream inspection.
  const out = {
    meta: { N: N_TOURNEYS, samples: SAMPLES, buyIn: BUY_IN, rake: RAKE },
    fields: FIELDS,
    rois: ROIS,
    table: Object.fromEntries(
      Object.entries(table).map(([k, v]) => [k, v.map((p) => p.sigmaRoi)]),
    ),
    perRoiFits: fits,
    globalBeta: betaGlobal,
    globalR2: r2Global,
  };
  const fs = await import("node:fs");
  fs.writeFileSync(
    "scripts/fit_beta.json",
    JSON.stringify(out, null, 2),
  );
  console.log("");
  console.log(`wrote scripts/fit_beta.json`);
  console.log(`total wall time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
