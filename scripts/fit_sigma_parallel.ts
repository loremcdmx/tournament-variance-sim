/**
 * Parallel σ_ROI sweep runner — spawns N tsx child processes, each handling
 * a slice of the job list, then aggregates results. Three sweeps in one run:
 *
 *   - pko:          (7 ROIs × 18 fields) + (4 dense ROIs × 18 fields) → merged
 *   - freeze_rd:    7 ROIs × 18 fields
 *
 *   npx tsx scripts/fit_sigma_parallel.ts
 *
 * Env:
 *   N_WORKERS=12            number of parallel child processes (default 12)
 *   WORKER_IDX=i  N_SLICES=n  internal; worker slice of (i mod n)
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { runSimulation } from "../src/lib/sim/engine";
import type { SimulationInput, TournamentRow } from "../src/lib/sim/types";

type SweepId = "pko" | "pko_dense" | "freeze_rd";

interface Job {
  sweep: SweepId;
  field: number;
  roi: number;
}

interface JobResult extends Job {
  sigmaRoi: number;
}

const COMMON = {
  N_TOURNEYS: 500,
  SAMPLES: 120_000,
  BUY_IN: 50,
  RAKE: 0.10,
  SEED: 20260417,
  BOUNTY_FRACTION: 0.5,
  PKO_HEAD_VAR: 0.4,
};

const FIELDS = [
  50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500,
  10_000, 15_000, 25_000, 50_000,
];
const ROIS_MAIN = [-0.20, -0.10, 0, 0.10, 0.20, 0.40, 0.80];
const ROIS_DENSE = [0.05, 0.15, 0.25, 0.30];

function allJobs(): Job[] {
  const jobs: Job[] = [];
  for (const roi of ROIS_MAIN)
    for (const field of FIELDS) jobs.push({ sweep: "pko", field, roi });
  for (const roi of ROIS_DENSE)
    for (const field of FIELDS) jobs.push({ sweep: "pko_dense", field, roi });
  for (const roi of ROIS_MAIN)
    for (const field of FIELDS)
      jobs.push({ sweep: "freeze_rd", field, roi });
  // Deterministic "shuffle" — interleave by index hash so each slice has a
  // mix of sweep types and field sizes, not a contiguous block.
  jobs.sort((a, b) => {
    const ka = hash(JSON.stringify(a));
    const kb = hash(JSON.stringify(b));
    return ka - kb;
  });
  return jobs;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function buildInput(j: Job): SimulationInput {
  const row: TournamentRow =
    j.sweep === "freeze_rd"
      ? {
          id: "sweep",
          label: `f${j.field}`,
          players: j.field,
          buyIn: COMMON.BUY_IN,
          rake: COMMON.RAKE,
          roi: j.roi,
          payoutStructure: "mtt-standard",
          gameType: "freezeout",
          count: COMMON.N_TOURNEYS,
        }
      : {
          id: "sweep",
          label: `f${j.field}`,
          players: j.field,
          buyIn: COMMON.BUY_IN,
          rake: COMMON.RAKE,
          roi: j.roi,
          payoutStructure: "mtt-gg-bounty",
          gameType: "pko",
          bountyFraction: COMMON.BOUNTY_FRACTION,
          pkoHeadVar: COMMON.PKO_HEAD_VAR,
          count: COMMON.N_TOURNEYS,
        };
  const finishId =
    j.sweep === "freeze_rd" ? "freeze-realdata-linear" : "pko-realdata-linear";
  return {
    schedule: [row],
    scheduleRepeats: 1,
    samples: COMMON.SAMPLES,
    bankroll: 0,
    seed: COMMON.SEED,
    finishModel: { id: finishId },
  };
}

function measure(j: Job): JobResult {
  const r = runSimulation(buildInput(j));
  const N = r.tournamentsPerSample;
  const abi = r.totalBuyIn / N;
  const sigmaRoi = (r.stats.stdDev / Math.sqrt(N)) / abi;
  return { ...j, sigmaRoi };
}

// ============================== Worker mode ==============================

async function workerMain() {
  const idx = Number(process.env.WORKER_IDX);
  const slices = Number(process.env.N_SLICES);
  const outPath = process.env.OUT_PATH!;
  const jobs = allJobs().filter((_, i) => i % slices === idx);
  const results: JobResult[] = [];
  const t0 = Date.now();
  for (let i = 0; i < jobs.length; i++) {
    const r = measure(jobs[i]);
    results.push(r);
    process.stdout.write(
      `w${idx} ${i + 1}/${jobs.length} ${r.sweep} f=${r.field} roi=${(r.roi * 100).toFixed(0)}% σ=${r.sigmaRoi.toFixed(3)} (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`,
    );
  }
  await fs.writeFile(outPath, JSON.stringify(results));
}

// =============================== Main mode ===============================

function fitLogLog(pts: Array<{ field: number; sigmaRoi: number }>) {
  const xs = pts.map((p) => Math.log(p.field));
  const ys = pts.map((p) => Math.log(p.sigmaRoi));
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
  let sr = 0;
  let st = 0;
  for (let i = 0; i < n; i++) {
    const pred = intercept + beta * xs[i];
    sr += (ys[i] - pred) ** 2;
    st += (ys[i] - my) ** 2;
  }
  return { beta, intercept, r2: 1 - sr / st };
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

function summarize(
  name: string,
  rois: number[],
  table: Record<number, Array<{ field: number; sigmaRoi: number }>>,
) {
  console.log("");
  console.log(`==== ${name} summary ====`);
  const fits: Array<{ roi: number; C: number; beta: number; r2: number }> = [];
  for (const roi of rois) {
    const f = fitLogLog(table[roi]);
    fits.push({ roi, C: Math.exp(f.intercept), beta: f.beta, r2: f.r2 });
    console.log(
      `  roi=${(roi * 100).toFixed(0).padStart(4)}%  C=${Math.exp(f.intercept).toFixed(4)}  β=${f.beta.toFixed(4)}  R²=${f.r2.toFixed(5)}`,
    );
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (const roi of rois) {
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
  let sr = 0;
  let st = 0;
  const myAll = ys.reduce((a, b) => a + b, 0) / ys.length;
  for (let i = 0; i < xs.length; i++) {
    const pred = betaGlobal * xs[i];
    sr += (ys[i] - pred) ** 2;
    st += (ys[i] - myAll) ** 2;
  }
  const r2Global = 1 - sr / st;
  console.log(`  global β=${betaGlobal.toFixed(4)}  R²=${r2Global.toFixed(5)}`);
  const cRois = fits.map((f) => f.roi);
  const cVals = fits.map((f) => f.C);
  const linC = linFit(cRois, cVals);
  console.log(
    `  C(roi) lin: C = ${linC.intercept.toFixed(4)} + ${linC.slope.toFixed(4)}·roi  R²=${linC.r2.toFixed(5)}`,
  );
  return { fits, betaGlobal, r2Global, linC };
}

async function mainOrchestrate() {
  const N_WORKERS = Number(process.env.N_WORKERS ?? 12);
  const jobs = allJobs();
  console.log(
    `fit_sigma_parallel: ${jobs.length} jobs across ${N_WORKERS} workers`,
  );
  console.log(
    `  pko(main):  ${ROIS_MAIN.length} ROIs × ${FIELDS.length} fields`,
  );
  console.log(
    `  pko(dense): ${ROIS_DENSE.length} ROIs × ${FIELDS.length} fields`,
  );
  console.log(
    `  freeze_rd:  ${ROIS_MAIN.length} ROIs × ${FIELDS.length} fields`,
  );
  console.log(
    `  samples=${COMMON.SAMPLES} N=${COMMON.N_TOURNEYS} buyIn=${COMMON.BUY_IN} rake=${COMMON.RAKE}`,
  );

  const scriptPath = fileURLToPath(import.meta.url);
  const tmpDir = "scripts/.fit_par_tmp";
  await fs.mkdir(tmpDir, { recursive: true });

  const t0 = Date.now();
  await Promise.all(
    Array.from({ length: N_WORKERS }, (_, idx) =>
      new Promise<void>((resolve, reject) => {
        const outPath = `${tmpDir}/worker_${idx}.json`;
        const child = spawn("npx", ["tsx", scriptPath], {
          env: {
            ...process.env,
            WORKER_IDX: String(idx),
            N_SLICES: String(N_WORKERS),
            OUT_PATH: outPath,
          },
          stdio: ["ignore", "inherit", "inherit"],
          shell: true,
        });
        child.on("error", reject);
        child.on("exit", (code) => {
          if (code !== 0) reject(new Error(`worker ${idx} exited ${code}`));
          else resolve();
        });
      }),
    ),
  );

  // Aggregate all worker outputs.
  const results: JobResult[] = [];
  for (let i = 0; i < N_WORKERS; i++) {
    const raw = await fs.readFile(`${tmpDir}/worker_${i}.json`, "utf-8");
    results.push(...(JSON.parse(raw) as JobResult[]));
  }

  const byRoi = (sweep: SweepId, rois: number[]) => {
    const table: Record<number, Array<{ field: number; sigmaRoi: number }>> = {};
    for (const roi of rois) table[roi] = [];
    for (const r of results) {
      if (r.sweep !== sweep) continue;
      const arr = table[r.roi];
      if (arr) arr.push({ field: r.field, sigmaRoi: r.sigmaRoi });
    }
    for (const roi of rois) table[roi].sort((a, b) => a.field - b.field);
    return table;
  };

  const pkoTable = byRoi("pko", ROIS_MAIN);
  const pkoDenseTable = byRoi("pko_dense", ROIS_DENSE);
  const freezeTable = byRoi("freeze_rd", ROIS_MAIN);

  const pkoCoreSummary = summarize("pko core (7 ROIs)", ROIS_MAIN, pkoTable);
  const pkoMergedRois = [...ROIS_MAIN, ...ROIS_DENSE].sort((a, b) => a - b);
  const pkoMergedTable: Record<
    number,
    Array<{ field: number; sigmaRoi: number }>
  > = { ...pkoTable, ...pkoDenseTable };
  const pkoMergedSummary = summarize(
    "pko MERGED (11 ROIs)",
    pkoMergedRois,
    pkoMergedTable,
  );
  const freezeSummary = summarize("freeze_rd", ROIS_MAIN, freezeTable);

  await fs.writeFile(
    "scripts/fit_beta_pko.json",
    JSON.stringify(
      {
        meta: {
          N: COMMON.N_TOURNEYS,
          samples: COMMON.SAMPLES,
          buyIn: COMMON.BUY_IN,
          rake: COMMON.RAKE,
          bountyFraction: COMMON.BOUNTY_FRACTION,
          pkoHeadVar: COMMON.PKO_HEAD_VAR,
          payout: "mtt-gg-bounty",
          finishModel: "pko-realdata-linear",
          mergedWithDense: true,
        },
        fields: FIELDS,
        rois: pkoMergedRois,
        table: Object.fromEntries(
          Object.entries(pkoMergedTable).map(([k, v]) => [
            k,
            v.map((p) => p.sigmaRoi),
          ]),
        ),
        perRoiFits: pkoMergedSummary.fits,
        globalBeta: pkoMergedSummary.betaGlobal,
        globalR2: pkoMergedSummary.r2Global,
        cRoiLinear: {
          C0: pkoMergedSummary.linC.intercept,
          C1: pkoMergedSummary.linC.slope,
          r2: pkoMergedSummary.linC.r2,
        },
      },
      null,
      2,
    ),
  );
  console.log("");
  console.log("wrote scripts/fit_beta_pko.json (11 ROIs merged)");

  await fs.writeFile(
    "scripts/fit_beta_freeze_realdata.json",
    JSON.stringify(
      {
        meta: {
          N: COMMON.N_TOURNEYS,
          samples: COMMON.SAMPLES,
          buyIn: COMMON.BUY_IN,
          rake: COMMON.RAKE,
          payout: "mtt-standard",
          finishModel: "freeze-realdata-linear",
        },
        fields: FIELDS,
        rois: ROIS_MAIN,
        table: Object.fromEntries(
          Object.entries(freezeTable).map(([k, v]) => [
            k,
            v.map((p) => p.sigmaRoi),
          ]),
        ),
        perRoiFits: freezeSummary.fits,
        globalBeta: freezeSummary.betaGlobal,
        globalR2: freezeSummary.r2Global,
        cRoiLinear: {
          C0: freezeSummary.linC.intercept,
          C1: freezeSummary.linC.slope,
          r2: freezeSummary.linC.r2,
        },
      },
      null,
      2,
    ),
  );
  console.log("wrote scripts/fit_beta_freeze_realdata.json");

  await fs.writeFile(
    "scripts/fit_beta_pko_core.json",
    JSON.stringify(
      {
        rois: ROIS_MAIN,
        perRoiFits: pkoCoreSummary.fits,
        globalBeta: pkoCoreSummary.betaGlobal,
        globalR2: pkoCoreSummary.r2Global,
        cRoiLinear: {
          C0: pkoCoreSummary.linC.intercept,
          C1: pkoCoreSummary.linC.slope,
          r2: pkoCoreSummary.linC.r2,
        },
      },
      null,
      2,
    ),
  );
  console.log("wrote scripts/fit_beta_pko_core.json (7-ROI subset for compare)");

  // Clean up temp files.
  for (let i = 0; i < N_WORKERS; i++) {
    await fs.unlink(`${tmpDir}/worker_${i}.json`).catch(() => {});
  }
  await fs.rmdir(tmpDir).catch(() => {});

  console.log("");
  console.log(`total wall time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

if (process.env.WORKER_IDX != null) {
  workerMain().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  mainOrchestrate().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
