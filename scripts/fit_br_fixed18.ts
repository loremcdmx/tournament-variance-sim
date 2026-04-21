/**
 * Refit the BR runtime helper line at the locked AFS = 18.
 *
 * The shipped BR convergence tab now centers on a runtime single-row compile,
 * not on the old wide sim-fit line. This script rebuilds the compact helper
 * line that tracks that runtime center inside the only user-visible BR box:
 * AFS fixed at 18, ROI in [-10%, +10%].
 *
 * β stays 0 by construction because the BR widget never varies field size.
 * Independent sim validation of the helper band lives in xval_br.ts.
 *
 *   npx tsx scripts/fit_br_fixed18.ts
 */

import { promises as fs } from "node:fs";
import { buildExactBreakdown } from "../src/lib/sim/convergenceMath";
import type { TournamentRow } from "../src/lib/sim/types";

const BUY_IN = 50;
const RAKE = 0.08; // GG Mystery Battle Royale real rake
const AFS = 18;

const ROIS = [-0.1, -0.05, 0, 0.05, 0.1];

function measure(roi: number): number {
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
    count: 1,
  };
  const exact = buildExactBreakdown([row], {
    finishModel: { id: "powerlaw-realdata-influenced" },
  });
  if (!exact) {
    throw new Error(`failed to compile BR runtime row for roi=${roi}`);
  }
  return exact.sigmaEff;
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
    `fit_br_fixed18: ${ROIS.length} runtime ROI points @ AFS=${AFS}, rake=${RAKE}`,
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
          buyIn: BUY_IN,
          rake: RAKE,
          bountyFraction: 0.5,
          pkoHeadVar: 0,
          payout: "battle-royale",
          finishModel: "powerlaw-realdata-influenced",
          fixedAfs: AFS,
          roiMin: -0.1,
          roiMax: 0.1,
          note: "BR runtime helper line for the validated UI box. Point estimate in the widget comes from runtime single-row compile; xval_br.ts validates the ±resid band against independent simulations.",
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
