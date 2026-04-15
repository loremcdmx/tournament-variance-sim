/**
 * Comprehensive engine variance sweep. Drives the simulator across many
 * (field, ROI, N, rake, buy-in, payout, finish-model) slices and writes the
 * raw data plus per-experiment fits to `data/variance-fits/sweep-v1.json`,
 * which then serves as the authoritative ground truth for any analytic
 * model we slap on top (e.g. the ConvergenceChart σ formula).
 *
 * Experiments:
 *   1. fieldRoiGrid       — σ vs (field, ROI) at defaults; the headline fit.
 *   2. nTourneysCLT       — σ_per_tourney should be flat in N if CLT holds.
 *   3. buyInInvariance    — σ_ROI should be scale-invariant in buy-in.
 *   4. rakeSweep          — does rake shift σ? (affects effective ROI too)
 *   5. payoutSweep        — β and C per payout structure.
 *   6. finishModelSweep   — β and C per finish model (shape of skill dist).
 *   7. seedStability      — noise floor of each (field, ROI) cell across seeds.
 *
 * Run:  npx tsx scripts/variance_sweep.ts
 * Force rerun even if srcHash matches:  VS_FORCE=1 npx tsx scripts/...
 */

import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runSimulation } from "../src/lib/sim/engine";
import type {
  FinishModelId,
  PayoutStructureId,
  SimulationInput,
  TournamentRow,
} from "../src/lib/sim/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..");

// ---------- config ----------

const DEFAULT_SAMPLES = Number(process.env.VS_SAMPLES) || 60_000;
const FORCE = !!process.env.VS_FORCE;

interface CellConfig {
  field: number;
  roi: number;
  rake: number;
  buyIn: number;
  nTourneys: number;
  samples: number;
  payout: PayoutStructureId;
  finishModel: FinishModelId;
  seed: number;
}

const BASE: CellConfig = {
  field: 1000,
  roi: 0.10,
  rake: 0.10,
  buyIn: 50,
  nTourneys: 500,
  samples: DEFAULT_SAMPLES,
  payout: "mtt-standard",
  finishModel: "power-law",
  seed: 20260415,
};

// ---------- engine wrapper ----------

interface CellResult {
  sigmaRoi: number; // per-tourney σ of ROI (CLT-scaled to one tourney)
  sigmaTotal: number; // raw σ across N tourneys in one sample
  meanRoi: number; // realized ROI (sanity check vs input)
  totalBuyIn: number;
  nTourneys: number;
}

function measure(cfg: CellConfig): CellResult {
  const row: TournamentRow = {
    id: "sweep",
    label: "sweep",
    players: cfg.field,
    buyIn: cfg.buyIn,
    rake: cfg.rake,
    roi: cfg.roi,
    payoutStructure: cfg.payout,
    count: cfg.nTourneys,
  };
  const input: SimulationInput = {
    schedule: [row],
    scheduleRepeats: 1,
    samples: cfg.samples,
    bankroll: 0,
    seed: cfg.seed,
    finishModel: { id: cfg.finishModel },
  };
  const r = runSimulation(input);
  const N = r.tournamentsPerSample;
  const sigmaTotal = r.stats.stdDev;
  const abi = r.totalBuyIn / N;
  const sigmaRoi = abi > 0 ? (sigmaTotal / Math.sqrt(N)) / abi : 0;
  return {
    sigmaRoi,
    sigmaTotal,
    meanRoi: r.totalBuyIn > 0 ? r.expectedProfit / r.totalBuyIn : 0,
    totalBuyIn: r.totalBuyIn,
    nTourneys: N,
  };
}

// ---------- fit helpers ----------

interface LinFit {
  slope: number;
  intercept: number;
  r2: number;
}

function linFit(xs: number[], ys: number[]): LinFit {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, r2: 0 };
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const slope = den > 0 ? num / den : 0;
  const intercept = my - slope * mx;
  let sr = 0;
  let st = 0;
  for (let i = 0; i < n; i++) {
    const pred = intercept + slope * xs[i];
    sr += (ys[i] - pred) ** 2;
    st += (ys[i] - my) ** 2;
  }
  return { slope, intercept, r2: st > 0 ? 1 - sr / st : 1 };
}

function logLogFit(
  fields: number[],
  sigmas: number[],
): { beta: number; logC: number; C: number; r2: number } {
  const valid: Array<[number, number]> = [];
  for (let i = 0; i < fields.length; i++) {
    if (sigmas[i] > 0 && fields[i] > 0) {
      valid.push([Math.log(fields[i]), Math.log(sigmas[i])]);
    }
  }
  const f = linFit(
    valid.map((v) => v[0]),
    valid.map((v) => v[1]),
  );
  return {
    beta: f.slope,
    logC: f.intercept,
    C: Math.exp(f.intercept),
    r2: f.r2,
  };
}

function relSpread(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean <= 0) return 0;
  const max = Math.max(...values);
  const min = Math.min(...values);
  return (max - min) / mean;
}

// ---------- experiment: fieldRoiGrid ----------

const GRID_FIELDS = [
  50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500,
  10_000, 15_000, 25_000, 50_000,
];
const GRID_ROIS = [-0.20, -0.10, 0, 0.10, 0.20, 0.40, 0.80];

function expFieldRoiGrid() {
  const byRoi: Record<
    string,
    { field: number; sigmaRoi: number; meanRoi: number }[]
  > = {};
  for (const roi of GRID_ROIS) {
    byRoi[String(roi)] = [];
    for (const field of GRID_FIELDS) {
      const r = measure({ ...BASE, field, roi });
      byRoi[String(roi)].push({
        field,
        sigmaRoi: r.sigmaRoi,
        meanRoi: r.meanRoi,
      });
    }
  }
  const perRoi = GRID_ROIS.map((roi) => {
    const pts = byRoi[String(roi)];
    const f = logLogFit(
      pts.map((p) => p.field),
      pts.map((p) => p.sigmaRoi),
    );
    return { roi, beta: f.beta, C: f.C, r2: f.r2 };
  });
  // Pooled β (per-ROI mean-centered log-log regression).
  const xs: number[] = [];
  const ys: number[] = [];
  for (const roi of GRID_ROIS) {
    const pts = byRoi[String(roi)];
    const lx = pts.map((p) => Math.log(p.field));
    const ly = pts.map((p) => Math.log(p.sigmaRoi));
    const mx = lx.reduce((a, b) => a + b, 0) / lx.length;
    const my = ly.reduce((a, b) => a + b, 0) / ly.length;
    for (let i = 0; i < lx.length; i++) {
      xs.push(lx[i] - mx);
      ys.push(ly[i] - my);
    }
  }
  const pooledRaw = linFit(xs, ys);
  // Fits for C(roi).
  const cLin = linFit(
    perRoi.map((p) => p.roi),
    perRoi.map((p) => p.C),
  );
  const cLog = linFit(
    perRoi.map((p) => p.roi),
    perRoi.map((p) => Math.log(p.C)),
  );
  return {
    fields: GRID_FIELDS,
    rois: GRID_ROIS,
    data: byRoi,
    fits: {
      perRoi,
      pooledBeta: pooledRaw.slope,
      pooledBetaR2: pooledRaw.r2,
      cLinear: { C0: cLin.intercept, C1: cLin.slope, r2: cLin.r2 },
      cLogLinear: { logC0: cLog.intercept, logC1: cLog.slope, r2: cLog.r2 },
    },
  };
}

// ---------- experiment: nTourneysCLT ----------

function expNTourneysCLT() {
  const Ns = [1, 5, 25, 100, 500, 2000];
  const ROIS = [0, 0.10, 0.40];
  const FIELDS = [200, 1000, 5000];
  const data: Array<{
    field: number;
    roi: number;
    n: number;
    sigmaRoi: number;
    meanRoi: number;
  }> = [];
  const perRoiField: Record<string, number[]> = {};
  for (const field of FIELDS) {
    for (const roi of ROIS) {
      const sigmas: number[] = [];
      for (const n of Ns) {
        const r = measure({ ...BASE, field, roi, nTourneys: n });
        data.push({
          field,
          roi,
          n,
          sigmaRoi: r.sigmaRoi,
          meanRoi: r.meanRoi,
        });
        sigmas.push(r.sigmaRoi);
      }
      perRoiField[`${field}|${roi}`] = sigmas;
    }
  }
  const spreads = Object.values(perRoiField).map(relSpread);
  return {
    Ns,
    data,
    maxRelativeSpread: Math.max(...spreads),
    meanRelativeSpread:
      spreads.reduce((a, b) => a + b, 0) / spreads.length,
  };
}

// ---------- experiment: buyInInvariance ----------

function expBuyInInvariance() {
  const buyIns = [1, 5, 50, 500, 5000];
  const FIELDS = [100, 1000, 10_000];
  const ROIS = [0, 0.10];
  const data: Array<{
    buyIn: number;
    field: number;
    roi: number;
    sigmaRoi: number;
  }> = [];
  const perCell: Record<string, number[]> = {};
  for (const field of FIELDS) {
    for (const roi of ROIS) {
      const sigmas: number[] = [];
      for (const buyIn of buyIns) {
        const r = measure({ ...BASE, buyIn, field, roi });
        data.push({ buyIn, field, roi, sigmaRoi: r.sigmaRoi });
        sigmas.push(r.sigmaRoi);
      }
      perCell[`${field}|${roi}`] = sigmas;
    }
  }
  const spreads = Object.values(perCell).map(relSpread);
  return {
    buyIns,
    data,
    maxRelativeSpread: Math.max(...spreads),
    meanRelativeSpread:
      spreads.reduce((a, b) => a + b, 0) / spreads.length,
  };
}

// ---------- experiment: rakeSweep ----------

function expRakeSweep() {
  const rakes = [0.03, 0.05, 0.08, 0.10, 0.12, 0.15];
  const FIELDS = [100, 500, 1000, 5000];
  const ROIS = [0, 0.10, 0.40];
  const data: Array<{
    rake: number;
    field: number;
    roi: number;
    sigmaRoi: number;
    meanRoi: number;
  }> = [];
  for (const rake of rakes) {
    for (const field of FIELDS) {
      for (const roi of ROIS) {
        const r = measure({ ...BASE, rake, field, roi });
        data.push({
          rake,
          field,
          roi,
          sigmaRoi: r.sigmaRoi,
          meanRoi: r.meanRoi,
        });
      }
    }
  }
  // Slope of σ vs rake at field=1000, roi=0.10 for quick-read.
  const slice = data
    .filter((d) => d.field === 1000 && d.roi === 0.10)
    .sort((a, b) => a.rake - b.rake);
  const rakeFit = linFit(
    slice.map((d) => d.rake),
    slice.map((d) => d.sigmaRoi),
  );
  return { rakes, data, rakeSlopeAt1000x10pct: rakeFit };
}

// ---------- experiment: payoutSweep ----------

const PAYOUT_IDS: PayoutStructureId[] = [
  "mtt-standard",
  "mtt-flat",
  "mtt-top-heavy",
  "mtt-pokerstars",
  "mtt-gg",
  "mtt-sunday-million",
  "winner-takes-all",
];

function expPayoutSweep() {
  const FIELDS = [50, 200, 1000, 5000, 25_000];
  const data: Record<string, { field: number; sigmaRoi: number }[]> = {};
  for (const payout of PAYOUT_IDS) {
    data[payout] = [];
    for (const field of FIELDS) {
      try {
        const r = measure({ ...BASE, payout, field });
        data[payout].push({ field, sigmaRoi: r.sigmaRoi });
      } catch (e) {
        data[payout].push({ field, sigmaRoi: 0 });
      }
    }
  }
  const fits = PAYOUT_IDS.map((payout) => {
    const pts = data[payout];
    const f = logLogFit(
      pts.map((p) => p.field),
      pts.map((p) => p.sigmaRoi),
    );
    return { payout, beta: f.beta, C: f.C, r2: f.r2 };
  });
  return { payouts: PAYOUT_IDS, fields: FIELDS, data, fits };
}

// ---------- experiment: finishModelSweep ----------

const FINISH_MODELS: FinishModelId[] = [
  "power-law",
  "linear-skill",
  "stretched-exp",
  "plackett-luce",
  "uniform",
  "freeze-realdata-linear",
  "powerlaw-realdata-influenced",
];

function expFinishModelSweep() {
  const FIELDS = [50, 200, 1000, 5000, 25_000];
  const data: Record<
    string,
    { field: number; sigmaRoi: number; meanRoi: number }[]
  > = {};
  for (const fm of FINISH_MODELS) {
    data[fm] = [];
    for (const field of FIELDS) {
      try {
        const r = measure({ ...BASE, finishModel: fm, field });
        data[fm].push({ field, sigmaRoi: r.sigmaRoi, meanRoi: r.meanRoi });
      } catch {
        data[fm].push({ field, sigmaRoi: 0, meanRoi: 0 });
      }
    }
  }
  const fits = FINISH_MODELS.map((fm) => {
    const pts = data[fm];
    const f = logLogFit(
      pts.map((p) => p.field),
      pts.map((p) => p.sigmaRoi),
    );
    return { finishModel: fm, beta: f.beta, C: f.C, r2: f.r2 };
  });
  return { finishModels: FINISH_MODELS, fields: FIELDS, data, fits };
}

// ---------- experiment: seedStability ----------

function expSeedStability() {
  const seeds = [1, 2, 3, 4, 5].map((i) => 20260415 + i * 1_000_003);
  const CELLS: Array<{ field: number; roi: number }> = [
    { field: 100, roi: 0 },
    { field: 1000, roi: 0.10 },
    { field: 10_000, roi: 0.10 },
  ];
  const data: Array<{
    field: number;
    roi: number;
    sigmaRois: number[];
    mean: number;
    relativeSpread: number;
  }> = [];
  for (const cell of CELLS) {
    const sigmas = seeds.map((seed) => {
      const r = measure({ ...BASE, field: cell.field, roi: cell.roi, seed });
      return r.sigmaRoi;
    });
    const mean = sigmas.reduce((a, b) => a + b, 0) / sigmas.length;
    data.push({
      field: cell.field,
      roi: cell.roi,
      sigmaRois: sigmas,
      mean,
      relativeSpread: relSpread(sigmas),
    });
  }
  return { seeds, data };
}

// ---------- main ----------

function srcHash(): string {
  const h = createHash("sha256");
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      const p = join(dir, entry);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (/\.(ts)$/.test(entry) && !entry.endsWith(".test.ts")) {
        h.update(entry);
        h.update(readFileSync(p));
      }
    }
  };
  walk(join(repoRoot, "src", "lib", "sim"));
  return h.digest("hex").slice(0, 16);
}

async function main() {
  const hash = srcHash();
  const outPath = join(repoRoot, "data", "variance-fits", "sweep-v1.json");

  if (!FORCE) {
    try {
      const existing = JSON.parse(readFileSync(outPath, "utf8"));
      if (existing.meta?.srcHash === hash && existing.meta?.samples >= DEFAULT_SAMPLES) {
        console.log(
          `sweep-v1.json up to date (srcHash=${hash}, samples=${existing.meta.samples}) — skipping`,
        );
        return;
      }
    } catch {}
  }

  const t0 = Date.now();
  console.log(`variance_sweep srcHash=${hash} samples=${DEFAULT_SAMPLES}`);

  const timed = <T>(name: string, fn: () => T): T => {
    const t = Date.now();
    process.stdout.write(`  ${name.padEnd(22)} `);
    const v = fn();
    console.log(`${((Date.now() - t) / 1000).toFixed(1)}s`);
    return v;
  };

  const experiments = {
    fieldRoiGrid: timed("fieldRoiGrid", expFieldRoiGrid),
    nTourneysCLT: timed("nTourneysCLT", expNTourneysCLT),
    buyInInvariance: timed("buyInInvariance", expBuyInInvariance),
    rakeSweep: timed("rakeSweep", expRakeSweep),
    payoutSweep: timed("payoutSweep", expPayoutSweep),
    finishModelSweep: timed("finishModelSweep", expFinishModelSweep),
    seedStability: timed("seedStability", expSeedStability),
  };

  const totalSec = (Date.now() - t0) / 1000;

  const out = {
    meta: {
      version: 1,
      srcHash: hash,
      generatedAt: new Date().toISOString(),
      samples: DEFAULT_SAMPLES,
      base: BASE,
      totalSec,
    },
    experiments,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2));

  // ---- headline summary ----
  console.log("");
  console.log("==== headline fits ====");
  const g = experiments.fieldRoiGrid.fits;
  console.log(
    `field×ROI grid:  β_pooled = ${g.pooledBeta.toFixed(4)}   R²=${g.pooledBetaR2.toFixed(4)}`,
  );
  console.log(
    `                 C(roi)  = ${g.cLinear.C0.toFixed(4)} + ${g.cLinear.C1.toFixed(4)}·roi   R²=${g.cLinear.r2.toFixed(4)}`,
  );
  console.log(
    `                 logC    = ${g.cLogLinear.logC0.toFixed(4)} + ${g.cLogLinear.logC1.toFixed(4)}·roi   R²=${g.cLogLinear.r2.toFixed(4)}`,
  );
  console.log(`                 per-ROI β:`);
  for (const p of g.perRoi) {
    console.log(
      `                   roi=${(p.roi * 100).toFixed(0).padStart(4)}%  β=${p.beta.toFixed(4)}  C=${p.C.toFixed(4)}  R²=${p.r2.toFixed(4)}`,
    );
  }

  console.log("");
  console.log(
    `CLT check (σ_per_tourney flat in N):  max relative spread = ${(experiments.nTourneysCLT.maxRelativeSpread * 100).toFixed(2)}%   mean = ${(experiments.nTourneysCLT.meanRelativeSpread * 100).toFixed(2)}%`,
  );
  console.log(
    `buy-in invariance:                    max relative spread = ${(experiments.buyInInvariance.maxRelativeSpread * 100).toFixed(2)}%   mean = ${(experiments.buyInInvariance.meanRelativeSpread * 100).toFixed(2)}%`,
  );

  const rake = experiments.rakeSweep.rakeSlopeAt1000x10pct;
  console.log(
    `rake slope (field=1000, roi=10%):     dσ/drake = ${rake.slope.toFixed(3)}   intercept=${rake.intercept.toFixed(4)}   R²=${rake.r2.toFixed(4)}`,
  );

  console.log("");
  console.log("==== payout-structure fits ====");
  for (const f of experiments.payoutSweep.fits) {
    console.log(
      `  ${f.payout.padEnd(20)} β=${f.beta.toFixed(4)}  C=${f.C.toFixed(4)}  R²=${f.r2.toFixed(4)}`,
    );
  }

  console.log("");
  console.log("==== finish-model fits ====");
  for (const f of experiments.finishModelSweep.fits) {
    console.log(
      `  ${f.finishModel.padEnd(32)} β=${f.beta.toFixed(4)}  C=${f.C.toFixed(4)}  R²=${f.r2.toFixed(4)}`,
    );
  }

  console.log("");
  console.log("==== seed stability (sampling noise floor) ====");
  for (const s of experiments.seedStability.data) {
    console.log(
      `  field=${String(s.field).padStart(6)}  roi=${(s.roi * 100).toFixed(0).padStart(3)}%   mean σ=${s.mean.toFixed(4)}   spread=${(s.relativeSpread * 100).toFixed(2)}%`,
    );
  }

  console.log("");
  console.log(
    `wrote ${outPath}\nwall time: ${totalSec.toFixed(1)}s`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
