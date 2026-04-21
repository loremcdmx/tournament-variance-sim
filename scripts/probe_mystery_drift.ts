/**
 * Quick drift check for Mystery σ_ROI coefficients.
 *
 * fit_beta_mystery.json (Apr 17 19:36) was fit on a pre-adbf278 engine.
 * adbf278 restricted the mystery harmonic KO window to top-9 FT — the same
 * change that previously forced a BR convergence revalidation. Since Mystery shares
 * the `isMystery` branch in engine.ts, the same shift should apply — but
 * Mystery uses σ² = 2.0 log-normal (not BR tier-draw) so magnitude may differ.
 *
 * Probe 5 field/ROI combinations. If |Δ/σ| > 2% systematically → full resweep.
 *
 *   npx tsx scripts/probe_mystery_drift.ts
 */

import { runSimulation } from "../src/lib/sim/engine";
import type { SimulationInput, TournamentRow } from "../src/lib/sim/types";

const N_TOURNEYS = 500;
const SAMPLES = 120_000;
const BUY_IN = 50;
const RAKE = 0.1;
const SEED = 20260418;

// 5 probe points spanning low/mid/high field × low/high ROI.
const PROBES: Array<{ afs: number; roi: number; jsonSigma: number }> = [
  { afs: 200, roi: 0, jsonSigma: 4.790026 },
  { afs: 1000, roi: 0, jsonSigma: 5.570339 },
  { afs: 1000, roi: 0.2, jsonSigma: 6.186468 },
  { afs: 5000, roi: 0, jsonSigma: 8.197538 },
  { afs: 10000, roi: 0.2, jsonSigma: 10.628936 },
];

function buildInput(afs: number, roi: number): SimulationInput {
  const row: TournamentRow = {
    id: "mys-probe",
    label: `mys-probe-${afs}-${roi}`,
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

function measure(afs: number, roi: number): number {
  const r = runSimulation(buildInput(afs, roi));
  const N = r.tournamentsPerSample;
  const abi = r.totalBuyIn / N;
  return (r.stats.stdDev / Math.sqrt(N)) / abi;
}

async function main() {
  const t0 = Date.now();
  console.log(
    `probe_mystery_drift: ${PROBES.length} points, N=${N_TOURNEYS}, samples=${SAMPLES}, seed=${SEED}`,
  );
  console.log("");
  console.log(
    "  afs      roi   σ(fresh)  σ(json)   Δ        Δ/σ(%)",
  );
  console.log(
    "  ----  -------  ---------  --------  -------  ------",
  );
  const drifts: number[] = [];
  for (const p of PROBES) {
    const s = measure(p.afs, p.roi);
    const d = s - p.jsonSigma;
    const dPct = (d / p.jsonSigma) * 100;
    drifts.push(dPct);
    console.log(
      `  ${String(p.afs).padStart(5)} ${(p.roi * 100).toFixed(1).padStart(5)}%   ${s.toFixed(4).padStart(8)}  ${p.jsonSigma.toFixed(4).padStart(7)}   ${d >= 0 ? "+" : ""}${d.toFixed(4).padStart(6)}   ${dPct >= 0 ? "+" : ""}${dPct.toFixed(2)}%`,
    );
  }
  const meanDriftPct = drifts.reduce((a, b) => a + b, 0) / drifts.length;
  const maxAbsDriftPct = Math.max(...drifts.map((d) => Math.abs(d)));
  console.log("");
  console.log(`  mean drift  = ${meanDriftPct >= 0 ? "+" : ""}${meanDriftPct.toFixed(2)}%`);
  console.log(`  max |drift| = ${maxAbsDriftPct.toFixed(2)}%`);
  if (maxAbsDriftPct > 2.0) {
    console.log(`  → VERDICT: |drift| > 2%, full Mystery resweep required.`);
  } else {
    console.log(`  → VERDICT: within noise, Mystery coefficients still OK.`);
  }
  console.log(`  total: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main();
