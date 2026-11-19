/**
 * Re-measure a canonical σ_ROI grid (PKO or Mystery) on the CURRENT engine.
 *
 *   FORMAT=pko npx tsx scripts/resweep_sigma.ts       # about a second
 *   FORMAT=mystery npx tsx scripts/resweep_sigma.ts
 *
 * A cell is the σ of one tournament of the canonical row in buy-ins, read from
 * the engine's compile (`compiledEntryMoments`, the σ behind
 * `stats.sigmaPerTournamentAnalytic` and the planning cards). The row has no
 * noise, tilt or heat channel, so its tournaments are independent and this is
 * the exact σ of what the hot loop draws: the value a Monte-Carlo sweep of the
 * same cell converges to, without its noise. `fit_runtime_sigma_bands.ts`
 * measures how close the hot loop stays to it. A grid goes stale whenever the
 * compile, a payout table or a finish model changes; re-run before refitting.
 *
 * Writes scripts/fit_beta_{pko,mystery}.json, which `refit_2d_logpoly.ts` reads.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import { compileSchedule } from "../src/lib/sim/compile";
import { compiledEntryMoments } from "../src/lib/sim/scheduleMoments";
import type { SimulationInput, TournamentRow } from "../src/lib/sim/types";

const FIELDS = [
  50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500,
  10000, 15000, 25000, 50000,
];
const ROIS = [-0.2, -0.1, 0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.8];
const FORMAT = (process.env.FORMAT ?? "pko") as "pko" | "mystery";

const RECIPES = {
  pko: {
    buyIn: 50,
    rake: 0.1,
    bountyFraction: 0.5,
    payout: "mtt-gg-bounty",
    gameType: "pko",
    finishModel: "pko-realdata-linear",
  },
  mystery: {
    buyIn: 50,
    rake: 0.1,
    bountyFraction: 0.5,
    mysteryBountyVariance: 2.0,
    payout: "mtt-gg-mystery",
    gameType: "mystery",
    finishModel: "mystery-realdata-linear",
  },
} as const;
const META = RECIPES[FORMAT] as Record<string, unknown> & {
  buyIn: number; rake: number; bountyFraction: number; payout: string;
  gameType: string; finishModel: string; mysteryBountyVariance?: number;
};

function sigmaRoiPerTourney(field: number, roi: number): number {
  const row = {
    id: "p",
    label: "p",
    players: field,
    buyIn: META.buyIn,
    rake: META.rake,
    roi,
    count: 1,
    payoutStructure: META.payout,
    gameType: META.gameType,
    bountyFraction: META.bountyFraction,
    ...(META.mysteryBountyVariance !== undefined
      ? { mysteryBountyVariance: META.mysteryBountyVariance }
      : {}),
  } as unknown as TournamentRow;
  const input = {
    schedule: [row],
    scheduleRepeats: 1,
    samples: 1,
    bankroll: 0,
    seed: 1,
    finishModel: { id: META.finishModel },
  } as unknown as SimulationInput;
  const entry = compileSchedule(input, "alpha").flat[0];
  const m = compiledEntryMoments(entry);
  return Math.sqrt(m.secondDollar - m.meanDollar * m.meanDollar) / entry.singleCost;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const table: Record<string, number[]> = {};
  for (const roi of ROIS) {
    table[String(roi)] = FIELDS.map((f) => sigmaRoiPerTourney(f, roi));
  }

  // Per-ROI log-log power-law fits (diagnostic parity with the old artifact).
  const perRoiFits = ROIS.map((roi) => {
    const ys = table[String(roi)].map((s) => Math.log(s));
    const xs = FIELDS.map((f) => Math.log(f));
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
    const logC = my - beta * mx;
    let ssRes = 0;
    let ssTot = 0;
    for (let i = 0; i < n; i++) {
      const pred = logC + beta * xs[i];
      ssRes += (ys[i] - pred) ** 2;
      ssTot += (ys[i] - my) ** 2;
    }
    return { roi, C: Math.exp(logC), beta, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0 };
  });

  const artifact = {
    meta: {
      ...META,
      sigma: "compiledEntryMoments: exact per-tournament sigma of the compiled row, in buy-ins",
      regeneratedBy: "scripts/resweep_sigma.ts",
    },
    fields: FIELDS,
    rois: ROIS,
    table,
    perRoiFits,
  };
  await fs.writeFile(
    path.join(process.cwd(), "scripts", `fit_beta_${FORMAT}.json`),
    JSON.stringify(artifact, null, 2),
  );
  console.log(
    `resweep_${FORMAT}: ${FIELDS.length * ROIS.length} cells in ` +
      `${((Date.now() - t0) / 1000).toFixed(1)}s → scripts/fit_beta_${FORMAT}.json`,
  );
}

void main();
