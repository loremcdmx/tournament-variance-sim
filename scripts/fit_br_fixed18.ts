/**
 * Refit σ_ROI coefficients for mystery-royale at the locked AFS = 18.
 *
 * Background: post-#92 the BR bounty draw is a discrete 10-tier
 * envelope distribution (not log-normal σ²=1.8). AFS is also locked to
 * 18 in the UI (#76/#93), so the field-sweep in `fit_sigma_parallel.ts`
 * only needs a single point per ROI. We fit σ(roi) = C0 + C1·roi with
 * β = 0 baked in — 18^β is absorbed into the C coefficients.
 *
 *   npx tsx scripts/fit_br_fixed18.ts
 */

import { promises as fs } from "node:fs";
import { runSimulation } from "../src/lib/sim/engine";
import type { SimulationInput, TournamentRow } from "../src/lib/sim/types";

const N_TOURNEYS = 500;
const SAMPLES = 200_000;
const BUY_IN = 50;
const RAKE = 0.08; // GG Mystery Battle Royale real rake
const SEED = 20260417;
const AFS = 18;

const ROIS = [
  -0.2, -0.1, 0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.8,
];

function buildInput(roi: number): SimulationInput {
  const row: TournamentRow = {
    id: "br-fit",
    label: `br-roi${roi}`,
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

function measure(roi: number): number {
  const r = runSimulation(buildInput(roi));
  const N = r.tournamentsPerSample;
  const abi = r.totalBuyIn / N;
  return (r.stats.stdDev / Math.sqrt(N)) / abi;
}

function linFit(xv: number[], yv: number[]) {
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
}

async function main() {
  const t0 = Date.now();
  console.log(
    `fit_br_fixed18: ${ROIS.length} ROIs @ AFS=${AFS}, ` +
      `N=${N_TOURNEYS}, samples=${SAMPLES}, rake=${RAKE}`,
  );
  const measurements: Array<{ roi: number; sigmaRoi: number }> = [];
  for (const roi of ROIS) {
    const s = measure(roi);
    measurements.push({ roi, sigmaRoi: s });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(`  roi=${(roi * 100).toFixed(1).padStart(5)}%  σ=${s.toFixed(4)}  (${elapsed}s)`);
  }

  const xs = measurements.map((m) => m.roi);
  const ys = measurements.map((m) => m.sigmaRoi);
  const fit = linFit(xs, ys);
  console.log("");
  console.log(`  C0=${fit.intercept.toFixed(4)}  C1=${fit.slope.toFixed(4)}  R²=${fit.r2.toFixed(5)}`);
  console.log(`  (β=0 — AFS locked at 18, field sweep is degenerate)`);

  const outPath = "scripts/fit_beta_mystery_royale.json";
  await fs.writeFile(
    outPath,
    JSON.stringify(
      {
        meta: {
          N: N_TOURNEYS,
          samples: SAMPLES,
          buyIn: BUY_IN,
          rake: RAKE,
          bountyFraction: 0.5,
          pkoHeadVar: 0,
          payout: "battle-royale",
          finishModel: "mystery-realdata-linear",
          fixedAfs: AFS,
          note: "BR AFS locked at 18 in UI; β=0. σ_ROI = C0 + C1·roi (evaluated at AFS=18).",
        },
        rois: xs,
        sigmas: ys,
        cRoiLinear: {
          C0: fit.intercept,
          C1: fit.slope,
          r2: fit.r2,
        },
      },
      null,
      2,
    ),
  );
  console.log(`wrote ${outPath}`);
  console.log(`total: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main();
