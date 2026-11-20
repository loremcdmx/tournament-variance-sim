/**
 * Refit the BR runtime helper line at the locked AFS = 18.
 *
 * The BR convergence tab centers on `formatRuntimeSigma("mystery-royale")`, the
 * compile of the editor's default BR row on the $10 ticket. This script reads
 * that same σ at a few ROIs inside the BR slider box (AFS fixed at 18, ROI in
 * [-10%, +10%]) and fits the compact line `SIGMA_ROI_MYSTERY_ROYALE`
 * (`scripts/lib/sigmaSurfaces.ts`) that `xval_br.ts` checks. No card reads the
 * line. A row of another ticket draws another envelope table, so it is not this
 * line's to describe.
 *
 * β stays 0 by construction because the BR widget never varies field size.
 * `xval_br.ts` checks the line against the engine's Monte Carlo of that row.
 *
 *   npx tsx scripts/fit_br_fixed18.ts
 */

import { promises as fs } from "node:fs";
import {
  formatRuntimeSigma,
  RUNTIME_SIGMA_BR_FIELD,
  RUNTIME_SIGMA_BR_TICKET,
} from "../src/lib/sim/formatRuntimeSigma";

const RAKE = 0.08; // GG Mystery Battle Royale real rake
const AFS = RUNTIME_SIGMA_BR_FIELD;
const FINISH_MODEL = "powerlaw-realdata-influenced";

const ROIS = [-0.1, -0.05, 0, 0.05, 0.1];

function measure(roi: number): number {
  const sigma = formatRuntimeSigma("mystery-royale", {
    afs: AFS,
    roi,
    rake: RAKE,
    finishModel: { id: FINISH_MODEL },
  });
  if (sigma === null) {
    throw new Error(`failed to compile BR runtime row for roi=${roi}`);
  }
  return sigma;
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
          ticket: RUNTIME_SIGMA_BR_TICKET,
          rake: RAKE,
          row: "buildFormatRuntimeRow(\"mystery-royale\"): the editor's default Battle Royale row",
          payout: "battle-royale",
          finishModel: FINISH_MODEL,
          fixedAfs: AFS,
          roiMin: -0.1,
          roiMax: 0.1,
          sigma: "formatRuntimeSigma: exact per-tournament sigma of the compiled row, in buy-ins",
          regeneratedBy: "scripts/fit_br_fixed18.ts",
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
