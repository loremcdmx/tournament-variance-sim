/**
 * Mini-sweep for #109b (AFS ceiling 50k -> 200k).
 *
 * This is intentionally narrower than scripts/fit_sigma_parallel.ts: it only
 * checks the extrapolation band the UI would expose if the convergence widget
 * slider moved from 50k to 200k. The gate is conservative:
 *
 *   max |(sigma_fit - sigma_measured) / sigma_measured| <= runtime resid
 *
 * per format. That maps directly to the uncertainty budget already displayed
 * (or hidden, for Mystery) by the convergence widget.
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { runSimulation } from "../src/lib/sim/engine";
import {
  evalSigma,
  SIGMA_COEF_BY_FORMAT,
} from "../src/lib/sim/convergenceFit";
import type { ConvergenceRowFormat } from "../src/lib/sim/convergencePolicy";
import type { SimulationInput, TournamentRow } from "../src/lib/sim/types";

type ProbeFormat = Exclude<ConvergenceRowFormat, "mystery-royale">;

interface Job {
  format: ProbeFormat;
  field: number;
  roi: number;
}

interface Cell extends Job {
  sigmaMeasured: number;
  sigmaFit: number;
  resid: number;
}

interface Summary {
  count: number;
  threshold: number;
  meanSignedResid: number;
  rmsResid: number;
  p95AbsResid: number;
  maxAbsResid: number;
  passed: boolean;
  worstCell: Cell | null;
}

const COMMON = {
  N_TOURNEYS: Number(process.env.AFS_PROBE_TOURNEYS ?? 500),
  SAMPLES: Number(process.env.AFS_PROBE_SAMPLES ?? 120_000),
  BUY_IN: 50,
  RAKE: 0.10,
  SEED: 20260420,
  BOUNTY_FRACTION: 0.5,
  PKO_HEAD_VAR: 0.4,
  MYSTERY_LOG_VAR: 2.0,
};

const PROBE_FIELDS = [75_000, 100_000, 150_000, 200_000];
const PROBE_ROIS = [-0.20, 0, 0.10, 0.40, 0.80];
const PROBE_FORMATS: ProbeFormat[] = ["freeze", "pko", "mystery"];

function allJobs(): Job[] {
  const jobs: Job[] = [];
  for (const format of PROBE_FORMATS) {
    for (const roi of PROBE_ROIS) {
      for (const field of PROBE_FIELDS) {
        jobs.push({ format, field, roi });
      }
    }
  }
  jobs.sort((a, b) => hash(JSON.stringify(a)) - hash(JSON.stringify(b)));
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

function buildRow(j: Job): TournamentRow {
  const base = {
    id: "afs-probe",
    label: `${j.format}-${j.field}`,
    players: j.field,
    buyIn: COMMON.BUY_IN,
    rake: COMMON.RAKE,
    roi: j.roi,
    count: COMMON.N_TOURNEYS,
  };
  if (j.format === "freeze") {
    return {
      ...base,
      payoutStructure: "mtt-standard",
      gameType: "freezeout",
    };
  }
  if (j.format === "pko") {
    return {
      ...base,
      payoutStructure: "mtt-gg-bounty",
      gameType: "pko",
      bountyFraction: COMMON.BOUNTY_FRACTION,
      pkoHeadVar: COMMON.PKO_HEAD_VAR,
    };
  }
  return {
    ...base,
    payoutStructure: "mtt-gg-mystery",
    gameType: "mystery",
    bountyFraction: COMMON.BOUNTY_FRACTION,
    mysteryBountyVariance: COMMON.MYSTERY_LOG_VAR,
    pkoHeadVar: COMMON.PKO_HEAD_VAR,
  };
}

function buildInput(j: Job): SimulationInput {
  const finishId =
    j.format === "freeze"
      ? "freeze-realdata-linear"
      : j.format === "pko"
        ? "pko-realdata-linear"
        : "mystery-realdata-linear";
  return {
    schedule: [buildRow(j)],
    scheduleRepeats: 1,
    samples: COMMON.SAMPLES,
    bankroll: 0,
    seed: COMMON.SEED,
    finishModel: { id: finishId },
  };
}

function measure(j: Job): Cell {
  const r = runSimulation(buildInput(j));
  const tournaments = r.tournamentsPerSample;
  const abi = r.totalBuyIn / tournaments;
  const sigmaMeasured = (r.stats.stdDev / Math.sqrt(tournaments)) / abi;
  const sigmaFit = evalSigma(SIGMA_COEF_BY_FORMAT[j.format], j.field, j.roi);
  return {
    ...j,
    sigmaMeasured,
    sigmaFit,
    resid: (sigmaFit - sigmaMeasured) / sigmaMeasured,
  };
}

async function workerMain(): Promise<void> {
  const idx = Number(process.env.AFS_PROBE_WORKER_IDX);
  const slices = Number(process.env.AFS_PROBE_SLICES);
  const outPath = process.env.AFS_PROBE_OUT_PATH;
  if (!outPath) throw new Error("AFS_PROBE_OUT_PATH missing");
  const jobs = allJobs().filter((_, i) => i % slices === idx);
  const cells: Cell[] = [];
  const t0 = Date.now();
  for (let i = 0; i < jobs.length; i++) {
    const c = measure(jobs[i]);
    cells.push(c);
    process.stdout.write(
      `w${idx} ${i + 1}/${jobs.length} ${c.format} field=${c.field} roi=${(c.roi * 100).toFixed(0)}% ` +
        `meas=${c.sigmaMeasured.toFixed(3)} fit=${c.sigmaFit.toFixed(3)} resid=${(100 * c.resid).toFixed(1)}% ` +
        `(${((Date.now() - t0) / 1000).toFixed(0)}s)\n`,
    );
  }
  await fs.writeFile(outPath, JSON.stringify(cells));
}

function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function summarize(format: ProbeFormat, cells: Cell[]): Summary {
  const threshold = SIGMA_COEF_BY_FORMAT[format].resid;
  const subset = cells.filter((c) => c.format === format);
  const resids = subset.map((c) => c.resid);
  const abs = resids.map(Math.abs);
  const n = subset.length;
  let worst: Cell | null = null;
  for (const c of subset) {
    if (!worst || Math.abs(c.resid) > Math.abs(worst.resid)) {
      worst = c;
    }
  }
  const meanSignedResid =
    n > 0 ? resids.reduce((a, b) => a + b, 0) / n : 0;
  const rmsResid =
    n > 0 ? Math.sqrt(resids.reduce((a, b) => a + b * b, 0) / n) : 0;
  const maxAbsResid = abs.reduce((a, b) => Math.max(a, b), 0);
  return {
    count: n,
    threshold,
    meanSignedResid,
    rmsResid,
    p95AbsResid: quantile(abs, 0.95),
    maxAbsResid,
    passed: maxAbsResid <= threshold + 1e-12,
    worstCell: worst,
  };
}

async function main(): Promise<void> {
  if (process.env.AFS_PROBE_WORKER_IDX != null) {
    await workerMain();
    return;
  }

  const workerCount = Math.max(
    1,
    Number(
      process.env.AFS_PROBE_WORKERS ??
        Math.min(8, Math.max(1, availableParallelism() - 1)),
    ),
  );
  const jobs = allJobs();
  console.log(
    `probe_afs_ceiling: ${jobs.length} jobs across ${workerCount} workers`,
  );
  console.log(
    `  fields=${PROBE_FIELDS.join(", ")} rois=${PROBE_ROIS.map((r) => `${Math.round(r * 100)}%`).join(", ")}`,
  );
  console.log(
    `  samples=${COMMON.SAMPLES} tourneys=${COMMON.N_TOURNEYS} seed=${COMMON.SEED}`,
  );

  const tmpDir = "scripts/.afs_ceiling_tmp";
  await fs.mkdir(tmpDir, { recursive: true });
  const scriptPath = fileURLToPath(import.meta.url);
  const t0 = Date.now();

  await Promise.all(
    Array.from({ length: workerCount }, (_, idx) =>
      new Promise<void>((resolve, reject) => {
        const outPath = `${tmpDir}/worker_${idx}.json`;
        const child = spawn("npx", ["tsx", scriptPath], {
          env: {
            ...process.env,
            AFS_PROBE_WORKER_IDX: String(idx),
            AFS_PROBE_SLICES: String(workerCount),
            AFS_PROBE_OUT_PATH: outPath,
          },
          stdio: ["ignore", "inherit", "inherit"],
          shell: true,
        });
        child.on("error", reject);
        child.on("exit", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`worker ${idx} exited ${code}`));
        });
      }),
    ),
  );

  const cells: Cell[] = [];
  for (let i = 0; i < workerCount; i++) {
    const raw = await fs.readFile(`${tmpDir}/worker_${i}.json`, "utf-8");
    cells.push(...(JSON.parse(raw) as Cell[]));
    await fs.unlink(`${tmpDir}/worker_${i}.json`).catch(() => {});
  }
  await fs.rmdir(tmpDir).catch(() => {});
  cells.sort(
    (a, b) =>
      PROBE_FORMATS.indexOf(a.format) - PROBE_FORMATS.indexOf(b.format) ||
      a.roi - b.roi ||
      a.field - b.field,
  );

  const summaries = Object.fromEntries(
    PROBE_FORMATS.map((format) => [format, summarize(format, cells)]),
  ) as Record<ProbeFormat, Summary>;
  const passed = PROBE_FORMATS.every((format) => summaries[format].passed);
  const report = {
    generatedAt: new Date().toISOString(),
    criterion:
      "Pass if max absolute residual at 75k..200k is <= the runtime residual budget for each format.",
    meta: {
      ...COMMON,
      fields: PROBE_FIELDS,
      rois: PROBE_ROIS,
      formats: PROBE_FORMATS,
      workerCount,
    },
    summaries,
    cells,
    passed,
  };
  const outPath =
    process.env.AFS_PROBE_REPORT_PATH ?? "scripts/afs_ceiling_probe.json";
  await fs.writeFile(outPath, JSON.stringify(report, null, 2));

  console.log("");
  for (const format of PROBE_FORMATS) {
    const s = summaries[format];
    console.log(
      `${format.padEnd(7)} ${s.passed ? "PASS" : "FAIL"} ` +
        `max=${(100 * s.maxAbsResid).toFixed(2)}% ` +
        `p95=${(100 * s.p95AbsResid).toFixed(2)}% ` +
        `threshold=${(100 * s.threshold).toFixed(2)}%`,
    );
  }
  console.log(
    `wrote ${outPath}; total wall time ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );

  if (!passed && process.env.AFS_PROBE_FAIL_ON_THRESHOLD !== "0") {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
