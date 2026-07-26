/**
 * Re-measure a canonical σ_ROI grid (PKO or Mystery) with the CURRENT engine.
 *
 * The shipped SIGMA_ROI_PKO surface was fit on a grid measured by an older
 * engine build. A 2026 audit found the current engine produces ~10-14% more
 * σ at small fields × high ROI than that stored grid, so the surface (and any
 * refit of it) is stale there. This regenerates the grid using the exact
 * canonical recipe recorded in fit_beta_pko.json's `meta`, so the output is a
 * drop-in replacement that `refit_2d_logpoly.ts` can consume.
 *
 *   FORMAT=pko npx tsx scripts/resweep_sigma.ts        # 16 workers
 *   FORMAT=mystery N_WORKERS=8 npx tsx scripts/resweep_sigma.ts
 *
 * Row recipes mirror scripts/fit_sigma_parallel.ts exactly. Writes
 * scripts/fit_beta_{pko,mystery}.json (back up the old one first).
 */
import { fork } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

import { runSimulation } from "../src/lib/sim/engine";
import type { SimulationInput, TournamentRow } from "../src/lib/sim/types";

// Canonical recipe — must match fit_beta_pko.json meta exactly.
const FIELDS = [
  50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500,
  10000, 15000, 25000, 50000,
];
const ROIS = [-0.2, -0.1, 0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.8];
const FORMAT = (process.env.FORMAT ?? "pko") as "pko" | "mystery";

// Recipes mirror scripts/fit_sigma_parallel.ts buildInput().
const RECIPES = {
  pko: {
    N: 500,
    samples: 120000,
    buyIn: 50,
    rake: 0.1,
    bountyFraction: 0.5,
    pkoHeadVar: 0.4,
    payout: "mtt-gg-bounty",
    gameType: "pko",
    finishModel: "pko-realdata-linear",
  },
  mystery: {
    N: 500,
    samples: 120000,
    buyIn: 50,
    rake: 0.1,
    bountyFraction: 0.5,
    pkoHeadVar: 0.4,
    mysteryBountyVariance: 2.0,
    payout: "mtt-gg-mystery",
    gameType: "mystery",
    finishModel: "mystery-realdata-linear",
  },
} as const;
const META = RECIPES[FORMAT] as Record<string, unknown> & {
  N: number; samples: number; buyIn: number; rake: number;
  bountyFraction: number; pkoHeadVar: number; payout: string;
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
    count: META.N,
    payoutStructure: META.payout,
    gameType: META.gameType,
    bountyFraction: META.bountyFraction,
    pkoHeadVar: META.pkoHeadVar,
    ...(META.mysteryBountyVariance !== undefined
      ? { mysteryBountyVariance: META.mysteryBountyVariance }
      : {}),
  } as unknown as TournamentRow;
  const input = {
    schedule: [row],
    scheduleRepeats: 1,
    samples: META.samples,
    bankroll: 1e9,
    // Deterministic per-cell seed so the sweep is reproducible.
    seed: (0x5eed ^ (field * 2654435761 + Math.round(roi * 1000))) >>> 0,
    finishModel: { id: META.finishModel },
  } as unknown as SimulationInput;
  const res = runSimulation(input);
  const a = res.finalProfits;
  let m = 0;
  for (let i = 0; i < a.length; i++) m += a[i];
  m /= a.length;
  let v = 0;
  for (let i = 0; i < a.length; i++) v += (a[i] - m) * (a[i] - m);
  const sd = Math.sqrt(v / a.length);
  // count=N tournaments per sample → per-tournament σ_ROI.
  return (sd / res.totalBuyIn) * Math.sqrt(META.N);
}

interface Cell {
  field: number;
  roi: number;
  sigma: number;
}

async function worker(): Promise<void> {
  const idx = Number(process.env.WORKER_IDX);
  const slices = Number(process.env.N_SLICES);
  const outPath = process.env.OUT_PATH!;
  const jobs: Array<{ field: number; roi: number }> = [];
  for (const field of FIELDS) for (const roi of ROIS) jobs.push({ field, roi });
  const mine = jobs.filter((_, i) => i % slices === idx);
  const out: Cell[] = [];
  for (const j of mine) {
    out.push({ field: j.field, roi: j.roi, sigma: sigmaRoiPerTourney(j.field, j.roi) });
    process.stderr.write(`  [w${idx}] ${j.field}×${j.roi} done\n`);
  }
  await fs.writeFile(outPath, JSON.stringify(out));
}

async function main(): Promise<void> {
  const N_WORKERS = Number(process.env.N_WORKERS ?? 16);
  const tmpDir = path.join(process.cwd(), "scripts", `.resweep_tmp_${FORMAT}`);
  await fs.mkdir(tmpDir, { recursive: true });
  const total = FIELDS.length * ROIS.length;
  console.log(
    `resweep_${FORMAT}: ${total} cells (${FIELDS.length} fields × ${ROIS.length} ROIs), ` +
      `${META.samples} samples × N=${META.N}, across ${N_WORKERS} workers`,
  );
  const t0 = Date.now();
  const outs = Array.from({ length: N_WORKERS }, (_, i) =>
    path.join(tmpDir, `w${i}.json`),
  );
  await Promise.all(
    Array.from({ length: N_WORKERS }, (_, idx) =>
      new Promise<void>((resolve, reject) => {
        const child = fork(__filename, [], {
          env: {
            ...process.env,
            WORKER_IDX: String(idx),
            N_SLICES: String(N_WORKERS),
            OUT_PATH: outs[idx],
          },
          execArgv: ["--import", "tsx"],
          stdio: ["ignore", "inherit", "inherit", "ipc"],
        });
        child.on("exit", (code) =>
          code === 0 ? resolve() : reject(new Error(`worker ${idx} exit ${code}`)),
        );
      }),
    ),
  );

  const cells: Cell[] = [];
  for (const o of outs) cells.push(...JSON.parse(await fs.readFile(o, "utf8")));

  const table: Record<string, number[]> = {};
  for (const roi of ROIS) {
    table[String(roi)] = FIELDS.map((f) => {
      const c = cells.find((x) => x.field === f && x.roi === roi);
      if (!c) throw new Error(`missing cell ${f}×${roi}`);
      return c.sigma;
    });
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
    meta: { ...META, regeneratedBy: "scripts/resweep_sigma.ts" },
    fields: FIELDS,
    rois: ROIS,
    table,
    perRoiFits,
  };
  await fs.writeFile(
    path.join(process.cwd(), "scripts", `fit_beta_${FORMAT}.json`),
    JSON.stringify(artifact, null, 2),
  );
  await fs.rm(tmpDir, { recursive: true, force: true });
  console.log(
    `done in ${((Date.now() - t0) / 1000).toFixed(1)}s → scripts/fit_beta_${FORMAT}.json`,
  );
}

if (process.env.WORKER_IDX !== undefined) {
  void worker();
} else {
  void main();
}
