/**
 * Parallel σ_ROI sweep runner — spawns N tsx child processes, each handling
 * a slice of the job list, then aggregates results. Four sweeps in one run:
 *
 *   - pko:            (7 ROIs × 18 fields) + (4 dense ROIs × 18 fields) → merged
 *   - freeze_rd:      7 ROIs × 18 fields
 *   - mystery:        (7 ROIs × 18 fields) + (4 dense ROIs × 18 fields) → merged
 *   - mystery_royale: (7 ROIs × 18 fields) + (4 dense ROIs × 18 fields) → merged
 *
 *   npx tsx scripts/fit_sigma_parallel.ts
 *
 * Env:
 *   N_WORKERS=12                number of parallel child processes (default 12)
 *   WORKER_IDX=i  N_SLICES=n    internal; worker slice of (i mod n)
 *   SWEEP=mystery_only          skip pko/freeze/royale, run mystery only
 *   SWEEP=mystery_royale_only   skip pko/freeze/mystery, run royale only
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { runSimulation } from "../src/lib/sim/engine";
import type { SimulationInput, TournamentRow } from "../src/lib/sim/types";

type SweepId =
  | "pko"
  | "pko_dense"
  | "freeze_rd"
  | "mystery"
  | "mystery_dense"
  | "mystery_royale"
  | "mystery_royale_dense";

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
  // Per-format rake override. Mystery Battle Royale runs at 8% on GGPoker since
  // March 2024 (verified via PokerListings + WorldPokerDeals). Fitting against
  // the real-world rake means the ConvergenceChart baseline for Royale matches
  // the format's actual math at slider-default 8%, instead of forcing the
  // rake-rescale to do compensation work at every render.
  RAKE_ROYALE: 0.08,
  SEED: 20260417,
  BOUNTY_FRACTION: 0.5,
  PKO_HEAD_VAR: 0.4,
  // Bumped 0.8 → 2.0 (#71): log-normal σ² = 0.8 gave P(X > 100·mean) = 1e-8,
  // i.e. no jackpot tail. σ² = 2.0 gives ~3.7e-5, in line with BR empirical
  // tier data (#92). Still lighter than true non-BR Mystery but defensible.
  MYSTERY_LOG_VAR: 2.0,
  MYSTERY_ROYALE_LOG_VAR: 1.8,
};

const FIELDS = [
  50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500,
  10_000, 15_000, 25_000, 50_000, 75_000, 100_000, 150_000, 200_000,
];
const ROIS_MAIN = [-0.20, -0.10, 0, 0.10, 0.20, 0.40, 0.80];
const ROIS_DENSE = [0.05, 0.15, 0.25, 0.30];

function allJobs(): Job[] {
  const mysteryOnly = process.env.SWEEP === "mystery_only";
  const royaleOnly = process.env.SWEEP === "mystery_royale_only";
  const jobs: Job[] = [];
  if (!mysteryOnly && !royaleOnly) {
    for (const roi of ROIS_MAIN)
      for (const field of FIELDS) jobs.push({ sweep: "pko", field, roi });
    for (const roi of ROIS_DENSE)
      for (const field of FIELDS) jobs.push({ sweep: "pko_dense", field, roi });
    for (const roi of ROIS_MAIN)
      for (const field of FIELDS)
        jobs.push({ sweep: "freeze_rd", field, roi });
  }
  if (!royaleOnly) {
    for (const roi of ROIS_MAIN)
      for (const field of FIELDS) jobs.push({ sweep: "mystery", field, roi });
    for (const roi of ROIS_DENSE)
      for (const field of FIELDS)
        jobs.push({ sweep: "mystery_dense", field, roi });
  }
  if (!mysteryOnly) {
    for (const roi of ROIS_MAIN)
      for (const field of FIELDS)
        jobs.push({ sweep: "mystery_royale", field, roi });
    for (const roi of ROIS_DENSE)
      for (const field of FIELDS)
        jobs.push({ sweep: "mystery_royale_dense", field, roi });
  }
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
  const isFreeze = j.sweep === "freeze_rd";
  const isMystery = j.sweep === "mystery" || j.sweep === "mystery_dense";
  const isRoyale =
    j.sweep === "mystery_royale" || j.sweep === "mystery_royale_dense";
  let row: TournamentRow;
  if (isFreeze) {
    row = {
      id: "sweep",
      label: `f${j.field}`,
      players: j.field,
      buyIn: COMMON.BUY_IN,
      rake: COMMON.RAKE,
      roi: j.roi,
      payoutStructure: "mtt-standard",
      gameType: "freezeout",
      count: COMMON.N_TOURNEYS,
    };
  } else if (isMystery || isRoyale) {
    row = {
      id: "sweep",
      label: `f${j.field}`,
      players: j.field,
      buyIn: COMMON.BUY_IN,
      rake: isRoyale ? COMMON.RAKE_ROYALE : COMMON.RAKE,
      roi: j.roi,
      payoutStructure: isRoyale ? "battle-royale" : "mtt-gg-mystery",
      gameType: isRoyale ? "mystery-royale" : "mystery",
      bountyFraction: COMMON.BOUNTY_FRACTION,
      mysteryBountyVariance: isRoyale
        ? COMMON.MYSTERY_ROYALE_LOG_VAR
        : COMMON.MYSTERY_LOG_VAR,
      pkoHeadVar: COMMON.PKO_HEAD_VAR,
      count: COMMON.N_TOURNEYS,
    };
  } else {
    row = {
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
  }
  const finishId = isFreeze
    ? "freeze-realdata-linear"
    : isMystery || isRoyale
      ? "mystery-realdata-linear"
      : "pko-realdata-linear";
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

// Quadratic log-log fit: log σ = a + b1·log field + b2·(log field)². A
// pooled version across all ROIs using centered log-field — captures the
// saturation/acceleration curvature that single-β misses at extreme AFS.
function fitQuadraticPooled(
  rois: number[],
  table: Record<number, Array<{ field: number; sigmaRoi: number }>>,
): { a: number; b1: number; b2: number; r2: number } {
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
  const n = xs.length;
  let Sx = 0, Sx2 = 0, Sx3 = 0, Sx4 = 0, Sy = 0, Sxy = 0, Sx2y = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    Sx += x;
    Sx2 += x * x;
    Sx3 += x * x * x;
    Sx4 += x * x * x * x;
    Sy += y;
    Sxy += x * y;
    Sx2y += x * x * y;
  }
  // Normal equations for [a, b1, b2] given centered ys and xs (so Sx and Sy
  // aren't exactly zero because rows were centered per-ROI, but close to).
  const M = [
    [n, Sx, Sx2],
    [Sx, Sx2, Sx3],
    [Sx2, Sx3, Sx4],
  ];
  const b = [Sy, Sxy, Sx2y];
  const sol = solve3x3(M, b);
  const [a, b1, b2] = sol;
  let sr = 0;
  let st = 0;
  const myAll = Sy / n;
  for (let i = 0; i < n; i++) {
    const pred = a + b1 * xs[i] + b2 * xs[i] * xs[i];
    sr += (ys[i] - pred) ** 2;
    st += (ys[i] - myAll) ** 2;
  }
  return { a, b1, b2, r2: st > 0 ? 1 - sr / st : 1 };
}

function solve3x3(M: number[][], b: number[]): [number, number, number] {
  const A = M.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(A[row][col]) > Math.abs(A[piv][col])) piv = row;
    }
    if (piv !== col) [A[col], A[piv]] = [A[piv], A[col]];
    const d = A[col][col];
    if (Math.abs(d) < 1e-12) return [0, 0, 0];
    for (let j = col; j < 4; j++) A[col][j] /= d;
    for (let row = 0; row < 3; row++) {
      if (row === col) continue;
      const f = A[row][col];
      for (let j = col; j < 4; j++) A[row][j] -= f * A[col][j];
    }
  }
  return [A[0][3], A[1][3], A[2][3]];
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
  const quad = fitQuadraticPooled(rois, table);
  console.log(
    `  quad log-poly: log σ = ${quad.a.toFixed(4)} + ${quad.b1.toFixed(4)}·log f + ${quad.b2.toFixed(4)}·(log f)²  R²=${quad.r2.toFixed(5)}`,
  );
  return { fits, betaGlobal, r2Global, linC, quad };
}

async function mainOrchestrate() {
  const N_WORKERS = Number(process.env.N_WORKERS ?? 12);
  const mysteryOnly = process.env.SWEEP === "mystery_only";
  const royaleOnly = process.env.SWEEP === "mystery_royale_only";
  const jobs = allJobs();
  console.log(
    `fit_sigma_parallel: ${jobs.length} jobs across ${N_WORKERS} workers`,
  );
  if (!mysteryOnly && !royaleOnly) {
    console.log(
      `  pko(main):         ${ROIS_MAIN.length} ROIs × ${FIELDS.length} fields`,
    );
    console.log(
      `  pko(dense):        ${ROIS_DENSE.length} ROIs × ${FIELDS.length} fields`,
    );
    console.log(
      `  freeze_rd:         ${ROIS_MAIN.length} ROIs × ${FIELDS.length} fields`,
    );
  }
  if (!royaleOnly) {
    console.log(
      `  mystery:           ${ROIS_MAIN.length} ROIs × ${FIELDS.length} fields`,
    );
    console.log(
      `  mystery(dense):    ${ROIS_DENSE.length} ROIs × ${FIELDS.length} fields`,
    );
  }
  if (!mysteryOnly) {
    console.log(
      `  royale:            ${ROIS_MAIN.length} ROIs × ${FIELDS.length} fields`,
    );
    console.log(
      `  royale(dense):     ${ROIS_DENSE.length} ROIs × ${FIELDS.length} fields`,
    );
  }
  console.log(
    `  samples=${COMMON.SAMPLES} N=${COMMON.N_TOURNEYS} buyIn=${COMMON.BUY_IN} rake=${COMMON.RAKE} (royale rake=${COMMON.RAKE_ROYALE})`,
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

  const mergedRois = [...ROIS_MAIN, ...ROIS_DENSE].sort((a, b) => a - b);

  const cleanupTmp = async () => {
    for (let i = 0; i < N_WORKERS; i++) {
      await fs.unlink(`${tmpDir}/worker_${i}.json`).catch(() => {});
    }
    await fs.rmdir(tmpDir).catch(() => {});
  };

  const writeMysteryFile = async (
    path: string,
    logVar: number,
    summary: ReturnType<typeof summarize>,
    mergedTable: Record<number, Array<{ field: number; sigmaRoi: number }>>,
    rakeOverride?: number,
  ) => {
    await fs.writeFile(
      path,
      JSON.stringify(
        {
          meta: {
            N: COMMON.N_TOURNEYS,
            samples: COMMON.SAMPLES,
            buyIn: COMMON.BUY_IN,
            rake: rakeOverride ?? COMMON.RAKE,
            bountyFraction: COMMON.BOUNTY_FRACTION,
            mysteryBountyVariance: logVar,
            pkoHeadVar: COMMON.PKO_HEAD_VAR,
            payout: "mtt-gg-bounty",
            finishModel: "mystery-realdata-linear",
            mergedWithDense: true,
          },
          fields: FIELDS,
          rois: mergedRois,
          table: Object.fromEntries(
            Object.entries(mergedTable).map(([k, v]) => [
              k,
              v.map((p) => p.sigmaRoi),
            ]),
          ),
          perRoiFits: summary.fits,
          globalBeta: summary.betaGlobal,
          globalR2: summary.r2Global,
          cRoiLinear: {
            C0: summary.linC.intercept,
            C1: summary.linC.slope,
            r2: summary.linC.r2,
          },
          logPolyPooled: summary.quad,
        },
        null,
        2,
      ),
    );
  };

  if (royaleOnly) {
    const royaleTable = byRoi("mystery_royale", ROIS_MAIN);
    const royaleDenseTable = byRoi("mystery_royale_dense", ROIS_DENSE);
    const royaleMergedTable = { ...royaleTable, ...royaleDenseTable };
    const royaleSummary = summarize(
      "mystery-royale MERGED (11 ROIs)",
      mergedRois,
      royaleMergedTable,
    );
    await writeMysteryFile(
      "scripts/fit_beta_mystery_royale.json",
      COMMON.MYSTERY_ROYALE_LOG_VAR,
      royaleSummary,
      royaleMergedTable,
      COMMON.RAKE_ROYALE,
    );
    console.log("");
    console.log("wrote scripts/fit_beta_mystery_royale.json (11 ROIs merged)");
    await cleanupTmp();
    console.log("");
    console.log(`total wall time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return;
  }

  const mysteryTable = byRoi("mystery", ROIS_MAIN);
  const mysteryDenseTable = byRoi("mystery_dense", ROIS_DENSE);
  const mysteryMergedTable: Record<
    number,
    Array<{ field: number; sigmaRoi: number }>
  > = { ...mysteryTable, ...mysteryDenseTable };
  const mysterySummary = summarize(
    "mystery MERGED (11 ROIs)",
    mergedRois,
    mysteryMergedTable,
  );

  if (mysteryOnly) {
    await writeMysteryFile(
      "scripts/fit_beta_mystery.json",
      COMMON.MYSTERY_LOG_VAR,
      mysterySummary,
      mysteryMergedTable,
    );
    console.log("");
    console.log("wrote scripts/fit_beta_mystery.json (11 ROIs merged)");
    await cleanupTmp();
    console.log("");
    console.log(`total wall time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return;
  }

  const pkoTable = byRoi("pko", ROIS_MAIN);
  const pkoDenseTable = byRoi("pko_dense", ROIS_DENSE);
  const freezeTable = byRoi("freeze_rd", ROIS_MAIN);

  const pkoCoreSummary = summarize("pko core (7 ROIs)", ROIS_MAIN, pkoTable);
  const pkoMergedRois = mergedRois;
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
        logPolyPooled: pkoMergedSummary.quad,
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
        logPolyPooled: freezeSummary.quad,
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

  await writeMysteryFile(
    "scripts/fit_beta_mystery.json",
    COMMON.MYSTERY_LOG_VAR,
    mysterySummary,
    mysteryMergedTable,
  );
  console.log("wrote scripts/fit_beta_mystery.json (11 ROIs merged)");

  const royaleTable = byRoi("mystery_royale", ROIS_MAIN);
  const royaleDenseTable = byRoi("mystery_royale_dense", ROIS_DENSE);
  const royaleMergedTable: Record<
    number,
    Array<{ field: number; sigmaRoi: number }>
  > = { ...royaleTable, ...royaleDenseTable };
  const royaleSummary = summarize(
    "mystery-royale MERGED (11 ROIs)",
    mergedRois,
    royaleMergedTable,
  );
  await writeMysteryFile(
    "scripts/fit_beta_mystery_royale.json",
    COMMON.MYSTERY_ROYALE_LOG_VAR,
    royaleSummary,
    royaleMergedTable,
    COMMON.RAKE_ROYALE,
  );
  console.log("wrote scripts/fit_beta_mystery_royale.json (11 ROIs merged)");

  await cleanupTmp();

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
