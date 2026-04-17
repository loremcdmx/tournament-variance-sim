/**
 * Supplementary PKO sweep at extra ROI points to densify the most-common
 * working-range ROIs (5 %, 15 %, 25 %, 30 %) for a joint fit with
 * scripts/fit_beta_pko.json. Same engine config as fit_beta_pko.ts.
 *
 *   npx tsx scripts/fit_beta_pko_dense.ts
 */

import { runSimulation } from "../src/lib/sim/engine";
import type { SimulationInput, TournamentRow } from "../src/lib/sim/types";

const FIELDS = [
  50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500,
  10_000, 15_000, 25_000, 50_000,
];
const ROIS = [0.05, 0.15, 0.25, 0.30];
const N_TOURNEYS = 500;
const SAMPLES = 120_000;
const BUY_IN = 50;
const RAKE = 0.10;
const BOUNTY_FRACTION = 0.5;
const PKO_HEAD_VAR = 0.4;

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
    payoutStructure: "mtt-gg-bounty",
    gameType: "pko",
    bountyFraction: BOUNTY_FRACTION,
    pkoHeadVar: PKO_HEAD_VAR,
    count: N_TOURNEYS,
  };
  const input: SimulationInput = {
    schedule: [row],
    scheduleRepeats: 1,
    samples: SAMPLES,
    bankroll: 0,
    seed: 20260417,
    finishModel: { id: "pko-realdata-linear" },
  };
  const r = runSimulation(input);
  const N = r.tournamentsPerSample;
  const abi = r.totalBuyIn / N;
  const sigmaRoi = (r.stats.stdDev / Math.sqrt(N)) / abi;
  return { field, sigmaRoi };
}

function fitLogLog(points: Point[]) {
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
  return { beta, intercept, r2: 1 - ssRes / ssTot };
}

async function main() {
  console.log(
    `fit_beta_pko_dense: N=${N_TOURNEYS} samples=${SAMPLES} buyIn=${BUY_IN} rake=${RAKE} bountyFraction=${BOUNTY_FRACTION} pkoHeadVar=${PKO_HEAD_VAR}`,
  );
  console.log(`payout=mtt-gg-bounty finishModel=pko-realdata-linear`);
  console.log(`fields (${FIELDS.length}): ${FIELDS.join(", ")}`);
  console.log(`rois   (${ROIS.length}): ${ROIS.map((r) => r.toFixed(2)).join(", ")}`);
  console.log("");

  const table: Record<number, Point[]> = {};
  const t0 = Date.now();
  for (const roi of ROIS) {
    const label = `roi=+${(roi * 100).toFixed(0)}%`;
    console.log(`==== ${label} ====`);
    const points: Point[] = [];
    const tR = Date.now();
    for (const field of FIELDS) {
      points.push(measure(field, roi));
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

  const out = {
    meta: {
      N: N_TOURNEYS,
      samples: SAMPLES,
      buyIn: BUY_IN,
      rake: RAKE,
      bountyFraction: BOUNTY_FRACTION,
      pkoHeadVar: PKO_HEAD_VAR,
      payout: "mtt-gg-bounty",
      finishModel: "pko-realdata-linear",
    },
    fields: FIELDS,
    rois: ROIS,
    table: Object.fromEntries(
      Object.entries(table).map(([k, v]) => [k, v.map((p) => p.sigmaRoi)]),
    ),
  };
  const fs = await import("node:fs");
  fs.writeFileSync(
    "scripts/fit_beta_pko_dense.json",
    JSON.stringify(out, null, 2),
  );
  console.log("");
  console.log(`wrote scripts/fit_beta_pko_dense.json`);
  console.log(`total wall time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
