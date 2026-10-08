/**
 * Calibrate the numeric band around the planning cards' runtime σ.
 *
 * The convergence chips and the prove-edge card take their point σ from
 * `formatRuntimeSigma` (the engine's analytic twin of the format's default
 * one-row schedule). The band printed around it is only honest if it covers
 * how far that analytic σ can sit from what the engine actually samples. This
 * script measures that: for every cell of a (format × field × ROI × rake) grid
 * it runs the real hot loop on the very row the card compiles, takes the
 * Monte-Carlo σ of one tournament in buy-ins and compares it with the
 * analytic σ.
 *
 *   BANDS_WORKERS=10 npx tsx scripts/fit_runtime_sigma_bands.ts
 *
 * Env:
 *   BANDS_WORKERS   child processes (default 8)
 *   BANDS_FILTER    keep only cells whose id contains this text (pilot runs)
 *   BANDS_QUICK=1   ~2 % of the normal budget, for a smoke run
 *   BANDS_BATCHES / BANDS_BR_BATCHES   batches per cell (500 000 samples x 10 tournaments each;
 *                   default 24, and 800 for Battle Royale grid cells)
 *   BANDS_RESUME=1  reuse finished batches left in the tmp dir by an aborted run
 *   BANDS_TMP       tmp dir for batch results (default scripts/.fit_runtime_bands_tmp)
 *
 * Writes `scripts/fit_runtime_sigma_bands.json` (the table behind
 * `src/lib/sim/runtimeSigmaBands.ts`) and prints the table as markdown.
 *
 * Reading the numbers:
 * - `ratio` = σ_MC / σ_analytic; `se` is the relative standard error of σ_MC,
 *   the larger of a kurtosis estimate and a batch-means estimate. Plain
 *   normal-theory SE is not used: the right tail (bounties, BR envelopes) makes
 *   it far too small.
 * - `dev` = |ratio − 1| + 2·se. A format's `resid` is the largest `dev` over
 *   its cells (the box the card gates on is the extent of those cells),
 *   rounded up to a whole percent, never below 1 %.
 * - Battle Royale carries a 10 000x envelope that is hit about once per 2.5 M
 *   tournaments, so its `se` stays above 1 % even at a billion tournaments.
 *   Where `se` is larger than the gap the cell cannot tell a gap from noise.
 */
import { fork, execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

import { compileSchedule } from "../src/lib/sim/compile";
import { makeCheckpointGrid } from "../src/lib/sim/grids";
import { simulateShard } from "../src/lib/sim/hotLoop";
import {
  buildFormatRuntimeRow,
  formatRuntimeSigma,
  type RuntimeSigmaFormat,
} from "../src/lib/sim/formatRuntimeSigma";
import type { ItmTargetConfig } from "../src/lib/sim/itmTarget";
import type { FinishModelConfig, SimulationInput } from "../src/lib/sim/types";

type CellTag = "core" | "edge" | "rake" | "model" | "itm";

interface Cell {
  id: string;
  tag: CellTag;
  format: RuntimeSigmaFormat;
  afs: number;
  roi: number;
  rake: number;
  finishModelId: string;
  /** Global ITM target in percent (run settings); absent = the payout table's paid share. */
  itmPct?: number;
}

interface BatchMoments {
  cell: string;
  batch: number;
  n: number;
  mean: number;
  m2: number;
  m3: number;
  m4: number;
}

const DEFAULT_MODEL = "powerlaw-realdata-influenced";
/** Tournaments per simulated sample. Small N keeps the per-sample buffers tiny. */
const N_PER_SAMPLE = 10;
const BATCH_SAMPLES = 500_000;
const QUICK = process.env.BANDS_QUICK === "1";
/** Batches per cell; total tournaments per cell = batches × samples × N. */
const BATCHES_STANDARD = Number(process.env.BANDS_BATCHES ?? (QUICK ? 2 : 24));
const BATCHES_BR = Number(process.env.BANDS_BR_BATCHES ?? (QUICK ? 4 : 800));
/** Battle Royale probes (rake, finish model) are only sanity checks, so they get a quarter. */
const BATCHES_BR_PROBE = Math.max(1, Math.round(BATCHES_BR / 4));

const CORE_AFS = [100, 300, 1000, 3000, 10000];
const CORE_ROI = [-0.2, 0, 0.1, 0.3, 0.6, 1.0];
/** The slider ends the cards actually expose, outside the specified grid. */
const EDGE_AFS = [50, 50000];
const EDGE_ROI = [-0.3];
const RAKE_PROBES = [0, 0.2];
const MODEL_PROBES = ["power-law", "linear-skill"];
/** Global ITM targets below and above the payout tables' own paid shares. Battle Royale rows carry their own ITM, so the target does not touch them. */
const ITM_PROBES = [12, 25];
const PROBE_AFS = 1000;
const PROBE_ROI = 0.1;
const BR_AFS = 18;
const BR_RAKE = 0.08;
const STD_RAKE = 0.1;

function cellId(c: Omit<Cell, "id">): string {
  const base = `${c.format}|afs${c.afs}|roi${c.roi}|rake${c.rake}|${c.finishModelId}`;
  return c.itmPct === undefined ? base : `${base}|itm${c.itmPct}`;
}

function buildCells(): Cell[] {
  const cells: Cell[] = [];
  const push = (c: Omit<Cell, "id">) => cells.push({ ...c, id: cellId(c) });
  for (const format of ["freeze", "pko", "mystery"] as const) {
    for (const afs of CORE_AFS)
      for (const roi of CORE_ROI)
        push({ tag: "core", format, afs, roi, rake: STD_RAKE, finishModelId: DEFAULT_MODEL });
    for (const afs of [...EDGE_AFS, ...CORE_AFS])
      for (const roi of [...CORE_ROI, ...EDGE_ROI]) {
        if (CORE_AFS.includes(afs) && CORE_ROI.includes(roi)) continue;
        push({ tag: "edge", format, afs, roi, rake: STD_RAKE, finishModelId: DEFAULT_MODEL });
      }
    for (const rake of RAKE_PROBES)
      push({ tag: "rake", format, afs: PROBE_AFS, roi: PROBE_ROI, rake, finishModelId: DEFAULT_MODEL });
    for (const finishModelId of MODEL_PROBES)
      push({ tag: "model", format, afs: PROBE_AFS, roi: PROBE_ROI, rake: STD_RAKE, finishModelId });
    for (const itmPct of ITM_PROBES)
      push({ tag: "itm", format, afs: PROBE_AFS, roi: PROBE_ROI, rake: STD_RAKE, finishModelId: DEFAULT_MODEL, itmPct });
  }
  for (const roi of CORE_ROI)
    push({ tag: "core", format: "mystery-royale", afs: BR_AFS, roi, rake: BR_RAKE, finishModelId: DEFAULT_MODEL });
  for (const rake of RAKE_PROBES)
    push({ tag: "rake", format: "mystery-royale", afs: BR_AFS, roi: PROBE_ROI, rake, finishModelId: DEFAULT_MODEL });
  for (const finishModelId of MODEL_PROBES)
    push({ tag: "model", format: "mystery-royale", afs: BR_AFS, roi: PROBE_ROI, rake: BR_RAKE, finishModelId });
  const filter = process.env.BANDS_FILTER;
  return filter ? cells.filter((c) => c.id.includes(filter)) : cells;
}

function batchesFor(cell: Cell): number {
  if (cell.format !== "mystery-royale") return BATCHES_STANDARD;
  return cell.tag === "core" ? BATCHES_BR : BATCHES_BR_PROBE;
}

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function modelOf(cell: Cell): FinishModelConfig {
  return { id: cell.finishModelId as FinishModelConfig["id"] };
}

function itmTargetOf(cell: Cell): ItmTargetConfig | undefined {
  return cell.itmPct === undefined ? undefined : { enabled: true, pct: cell.itmPct };
}

function inputFor(cell: Cell): SimulationInput {
  const row = {
    ...buildFormatRuntimeRow(cell.format, {
      afs: cell.afs,
      roi: cell.roi,
      rake: cell.rake,
      itmTarget: itmTargetOf(cell),
    }),
    count: N_PER_SAMPLE,
  };
  return {
    schedule: [row],
    scheduleRepeats: 1,
    samples: batchesFor(cell) * BATCH_SAMPLES,
    bankroll: 0,
    seed: fnv1a(cell.id),
    finishModel: modelOf(cell),
  };
}

function momentsOf(values: Float64Array): Omit<BatchMoments, "cell" | "batch"> {
  const n = values.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += values[i];
  const mean = sum / n;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (let i = 0; i < n; i++) {
    const d = values[i] - mean;
    const d2 = d * d;
    m2 += d2;
    m3 += d2 * d;
    m4 += d2 * d2;
  }
  return { n, mean, m2, m3, m4 };
}

/** Pébay's pairwise update of central sums (M2, M3, M4) of two samples. */
function mergeMoments(
  a: { n: number; mean: number; m2: number; m3: number; m4: number },
  b: { n: number; mean: number; m2: number; m3: number; m4: number },
) {
  const n = a.n + b.n;
  const delta = b.mean - a.mean;
  const delta2 = delta * delta;
  const mean = a.mean + (delta * b.n) / n;
  const m2 = a.m2 + b.m2 + (delta2 * a.n * b.n) / n;
  const m3 =
    a.m3 +
    b.m3 +
    (delta2 * delta * a.n * b.n * (a.n - b.n)) / (n * n) +
    (3 * delta * (a.n * b.m2 - b.n * a.m2)) / n;
  const m4 =
    a.m4 +
    b.m4 +
    (delta2 * delta2 * a.n * b.n * (a.n * a.n - a.n * b.n + b.n * b.n)) / (n * n * n) +
    (6 * delta2 * (a.n * a.n * b.m2 + b.n * b.n * a.m2)) / (n * n) +
    (4 * delta * (a.n * b.m3 - b.n * a.m3)) / n;
  return { n, mean, m2, m3, m4 };
}

// ---------------------------------------------------------------- worker ---

async function worker(): Promise<void> {
  const idx = Number(process.env.WORKER_IDX);
  const slices = Number(process.env.N_SLICES);
  const tmp = process.env.BANDS_TMP!;
  const outPath = path.join(tmp, `w${idx}.jsonl`);
  const done = new Set<string>();
  if (process.env.BANDS_RESUME === "1") {
    for (const f of await fs.readdir(tmp)) {
      if (!f.endsWith(".jsonl")) continue;
      for (const line of (await fs.readFile(path.join(tmp, f), "utf8")).split("\n")) {
        if (!line) continue;
        const r = JSON.parse(line) as BatchMoments;
        done.add(`${r.cell}#${r.batch}`);
      }
    }
  }
  const jobs: Array<{ cell: Cell; batch: number }> = [];
  for (const cell of buildCells())
    for (let b = 0; b < batchesFor(cell); b++) jobs.push({ cell, batch: b });
  // Interleave cells so every worker sees the same mix of cheap and heavy jobs.
  const mine = jobs.filter((_, i) => i % slices === idx);
  let cached: { id: string; input: SimulationInput; compiled: ReturnType<typeof compileSchedule> } | null = null;
  for (const { cell, batch } of mine) {
    if (done.has(`${cell.id}#${batch}`)) continue;
    if (!cached || cached.id !== cell.id) {
      const input = inputFor(cell);
      cached = { id: cell.id, input, compiled: compileSchedule(input, "alpha") };
    }
    const { input, compiled } = cached;
    const shard = simulateShard(
      input,
      compiled,
      batch * BATCH_SAMPLES,
      (batch + 1) * BATCH_SAMPLES,
      makeCheckpointGrid(compiled.tournamentsPerSample),
    );
    const rec: BatchMoments = { cell: cell.id, batch, ...momentsOf(shard.finalProfits) };
    await fs.appendFile(outPath, JSON.stringify(rec) + "\n");
  }
}

// ---------------------------------------------------------------- parent ---

interface CellResult extends Cell {
  sigmaAnalytic: number;
  sigmaMc: number;
  ratio: number;
  se: number;
  seKurtosis: number;
  seBatch: number;
  dev: number;
  kurtosis: number;
  roiAnalytic: number;
  roiMc: number;
  tournaments: number;
}

function summarize(cell: Cell, batches: BatchMoments[]): CellResult {
  const input = inputFor(cell);
  const row = input.schedule[0];
  const cost = row.buyIn * (1 + row.rake);
  let acc = { n: 0, mean: 0, m2: 0, m3: 0, m4: 0 };
  batches.forEach((b, i) => {
    acc = i === 0 ? { n: b.n, mean: b.mean, m2: b.m2, m3: b.m3, m4: b.m4 } : mergeMoments(acc, b);
  });
  const variance = acc.m2 / (acc.n - 1);
  const perTourney = (v: number) => Math.sqrt(v / N_PER_SAMPLE) / cost;
  const sigmaMc = perTourney(variance);
  const kurtosis = (acc.n * acc.m4) / (acc.m2 * acc.m2);
  const seKurtosis = 0.5 * Math.sqrt((kurtosis - 1) / acc.n);
  const batchVars = batches.map((b) => b.m2 / (b.n - 1));
  const bm = batchVars.reduce((s, v) => s + v, 0) / batchVars.length;
  const bsd = Math.sqrt(
    batchVars.reduce((s, v) => s + (v - bm) * (v - bm), 0) / Math.max(1, batchVars.length - 1),
  );
  const seBatch = (0.5 * bsd) / Math.sqrt(batchVars.length) / bm;
  const se = Math.max(seKurtosis, seBatch);
  const sigmaAnalytic = formatRuntimeSigma(cell.format, {
    afs: cell.afs,
    roi: cell.roi,
    rake: cell.rake,
    finishModel: modelOf(cell),
    itmTarget: itmTargetOf(cell),
  })!;
  const compiled = compileSchedule(input, "alpha");
  const entry = compiled.flat[0];
  const ratio = sigmaMc / sigmaAnalytic;
  return {
    ...cell,
    sigmaAnalytic,
    sigmaMc,
    ratio,
    se,
    seKurtosis,
    seBatch,
    dev: Math.abs(ratio - 1) + 2 * se,
    kurtosis,
    roiAnalytic: entry.analyticMeanSingle / entry.singleCost - 1,
    roiMc: acc.mean / N_PER_SAMPLE / cost,
    tournaments: acc.n * N_PER_SAMPLE,
  };
}

function ceilPercent(x: number): number {
  return Math.max(0.01, Math.ceil(x * 100 - 1e-9) / 100);
}

const pct = (x: number, d = 2) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`;

function printTable(results: CellResult[]): void {
  console.log("| format | AFS | ROI | rake | model | tag | σ analytic | σ MC | MC/analytic − 1 | SE | dev | κ | ROI analytic | ROI MC |");
  console.log("| --- | ---: | ---: | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const r of results) {
    console.log(
      `| ${r.format} | ${r.afs} | ${r.roi} | ${r.rake} | ${r.finishModelId === DEFAULT_MODEL ? "default" : r.finishModelId}${r.itmPct === undefined ? "" : ` itm ${r.itmPct}%`} | ${r.tag} | ${r.sigmaAnalytic.toFixed(3)} | ${r.sigmaMc.toFixed(3)} | ${pct(r.ratio - 1)} | ${(r.se * 100).toFixed(2)}% | ${(r.dev * 100).toFixed(2)}% | ${r.kurtosis.toFixed(0)} | ${pct(r.roiAnalytic, 1)} | ${pct(r.roiMc, 1)} |`,
    );
  }
}

interface BandSpec {
  resid: number;
  afsMin: number;
  afsMax: number;
  roiMin: number;
  roiMax: number;
}

/**
 * The band a format publishes: the box is the extent of its grid (the cards
 * hide the band outside it) and `resid` is the largest `dev` of the cells in
 * it, rounded up to a whole percent. Rake and finish-model probes sit inside
 * the box and are covered by the same number.
 */
function specFor(cells: CellResult[]): BandSpec {
  const afs = cells.map((c) => c.afs);
  const roi = cells.map((c) => c.roi);
  return {
    resid: ceilPercent(Math.max(...cells.map((c) => c.dev))),
    afsMin: Math.min(...afs),
    afsMax: Math.max(...afs),
    roiMin: Math.min(...roi),
    roiMax: Math.max(...roi),
  };
}

/** MC/analytic − 1 in percent with the SE in brackets, field down, ROI across. */
function printGrids(results: CellResult[]): void {
  for (const format of ["freeze", "pko", "mystery", "mystery-royale"] as const) {
    const cells = results.filter(
      (r) =>
        r.format === format &&
        r.finishModelId === DEFAULT_MODEL &&
        (r.tag === "core" || r.tag === "edge"),
    );
    if (cells.length === 0) continue;
    const rois = [...new Set(cells.map((c) => c.roi))].sort((x, y) => x - y);
    const fields = [...new Set(cells.map((c) => c.afs))].sort((x, y) => x - y);
    console.log(`
${format} (rake ${cells[0].rake}), MC/analytic − 1 in % (SE in %)`);
    console.log(`| AFS ↓ ROI → | ${rois.map((r) => `${r * 100}%`).join(" | ")} |`);
    console.log(`| ---: | ${rois.map(() => "---:").join(" | ")} |`);
    for (const afs of fields) {
      const row = rois.map((roi) => {
        const c = cells.find((x) => x.afs === afs && x.roi === roi);
        return c ? `${pct(c.ratio - 1, 1)} (${(c.se * 100).toFixed(1)})` : "";
      });
      console.log(`| ${afs} | ${row.join(" | ")} |`);
    }
  }
}

async function main(): Promise<void> {
  const nWorkers = Number(process.env.BANDS_WORKERS ?? 8);
  const tmp =
    process.env.BANDS_TMP ?? path.join(process.cwd(), "scripts", ".fit_runtime_bands_tmp");
  await fs.mkdir(tmp, { recursive: true });
  if (process.env.BANDS_RESUME !== "1") {
    for (const f of await fs.readdir(tmp)) {
      if (f.endsWith(".jsonl")) await fs.rm(path.join(tmp, f));
    }
  }
  const cells = buildCells();
  const totalJobs = cells.reduce((s, c) => s + batchesFor(c), 0);
  const totalTournaments = cells.reduce(
    (s, c) => s + batchesFor(c) * BATCH_SAMPLES * N_PER_SAMPLE,
    0,
  );
  console.log(
    `fit_runtime_sigma_bands: ${cells.length} cells, ${totalJobs} batches, ` +
      `${(totalTournaments / 1e9).toFixed(2)} G tournaments, ${nWorkers} workers`,
  );
  const t0 = Date.now();
  await Promise.all(
    Array.from(
      { length: nWorkers },
      (_, idx) =>
        new Promise<void>((resolve, reject) => {
          const child = fork(__filename, [], {
            env: {
              ...process.env,
              WORKER_IDX: String(idx),
              N_SLICES: String(nWorkers),
              BANDS_TMP: tmp,
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
  console.log(`simulated in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const byCell = new Map<string, BatchMoments[]>();
  for (const f of await fs.readdir(tmp)) {
    if (!f.endsWith(".jsonl")) continue;
    for (const line of (await fs.readFile(path.join(tmp, f), "utf8")).split("\n")) {
      if (!line) continue;
      const r = JSON.parse(line) as BatchMoments;
      const list = byCell.get(r.cell) ?? [];
      list.push(r);
      byCell.set(r.cell, list);
    }
  }
  const results: CellResult[] = [];
  for (const cell of cells) {
    const batches = (byCell.get(cell.id) ?? []).sort((a, b) => a.batch - b.batch);
    if (batches.length !== batchesFor(cell)) {
      throw new Error(`cell ${cell.id}: ${batches.length}/${batchesFor(cell)} batches`);
    }
    results.push(summarize(cell, batches));
  }

  printTable(results);
  console.log("");
  printGrids(results);

  const formats: RuntimeSigmaFormat[] = ["freeze", "pko", "mystery", "mystery-royale"];
  const table: Record<string, BandSpec> = {};
  const summary: Record<string, unknown> = {};
  console.log("");
  for (const format of formats) {
    const mine = results.filter((r) => r.format === format);
    if (mine.length === 0) continue;
    const spec = specFor(mine);
    table[format] = spec;
    const worst = mine.reduce((w, r) => (r.dev > w.dev ? r : w), mine[0]);
    const core = mine.filter((r) => r.tag === "core");
    const worstCore = core.reduce((w, r) => (r.dev > w.dev ? r : w), core[0]);
    summary[format] = {
      cells: mine.length,
      maxAbsGap: Math.max(...mine.map((r) => Math.abs(r.ratio - 1))),
      maxSe: Math.max(...mine.map((r) => r.se)),
      residSpecifiedGridOnly: ceilPercent(worstCore.dev),
      worst: { id: worst.id, ratio: worst.ratio, se: worst.se, dev: worst.dev },
    };
    console.log(
      `${format}: resid=${(spec.resid * 100).toFixed(0)}% (specified grid only: ${(ceilPercent(worstCore.dev) * 100).toFixed(0)}%)  ` +
        `max|gap|=${(Math.max(...mine.map((r) => Math.abs(r.ratio - 1))) * 100).toFixed(2)}%  ` +
        `max SE=${(Math.max(...mine.map((r) => r.se)) * 100).toFixed(2)}%  worst=${worst.id}`,
    );
  }
  console.log("\nsrc/lib/sim/runtimeSigmaBands.ts:");
  for (const format of formats) {
    const t = table[format];
    if (!t) continue;
    console.log(
      `  ${JSON.stringify(format)}: { resid: ${t.resid}, afsMin: ${t.afsMin}, afsMax: ${t.afsMax}, roiMin: ${t.roiMin}, roiMax: ${t.roiMax} },`,
    );
  }

  let head = "unknown";
  try {
    head = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    /* not a checkout */
  }
  const out = path.join(process.cwd(), "scripts", "fit_runtime_sigma_bands.json");
  await fs.writeFile(
    out,
    JSON.stringify(
      {
        meta: {
          script: "scripts/fit_runtime_sigma_bands.ts",
          head,
          nPerSample: N_PER_SAMPLE,
          batchSamples: BATCH_SAMPLES,
          batchesStandard: BATCHES_STANDARD,
          batchesBr: BATCHES_BR,
          quick: QUICK,
          tournaments: totalTournaments,
          defaultModel: DEFAULT_MODEL,
          coreAfs: CORE_AFS,
          coreRoi: CORE_ROI,
          edgeAfs: EDGE_AFS,
          edgeRoi: EDGE_ROI,
          rakeProbes: RAKE_PROBES,
          modelProbes: MODEL_PROBES,
        },
        table,
        summary,
        cells: results,
      },
      null,
      1,
    ),
  );
  console.log(`\nwrote ${out} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

if (process.env.WORKER_IDX !== undefined) {
  void worker();
} else {
  void main();
}
