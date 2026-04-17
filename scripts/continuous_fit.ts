/**
 * Continuous variance-fit harness. Runs forever, sampling experiments from a
 * broad catalog of (field, roi, rake, buyIn, N, payout, finishModel, roiStdErr,
 * schedule-shape) scenarios, measuring σ_ROI under BOTH calibration modes
 * (our α model and PrimeDope's binary-ITM), and appending each cell result as
 * a JSONL record to `data/variance-fits/continuous.jsonl`.
 *
 * Key properties:
 *   - Resumable. Restart the process and it reads the existing JSONL to
 *     rebuild cell-count state, skipping cells that already have enough
 *     samples and prioritising the least-measured live ones.
 *   - Append-only. A SIGINT mid-write loses at most one partial line, which
 *     the loader tolerates.
 *   - Both models in one pass. Each iteration runs the same (params, seed)
 *     twice — once alpha, once PD — so downstream analysis can diff them
 *     without any extra alignment.
 *
 * Run:
 *   npx tsx scripts/continuous_fit.ts
 * Resume is automatic; to start fresh, delete or rename the JSONL file.
 *
 * Environment knobs:
 *   CF_SAMPLES      default 30000 — MC samples per cell per iteration
 *   CF_TARGET_RUNS  default 8     — distinct seeds per cellKey before de-prioritising
 *   CF_PRINT_EVERY  default 1     — iterations between status prints
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runSimulation } from "../src/lib/sim/engine";
import type {
  FinishModelId,
  PayoutStructureId,
  SimulationInput,
  TournamentRow,
  CalibrationMode,
} from "../src/lib/sim/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..");
const outDir = join(repoRoot, "data", "variance-fits");
const outFile = join(outDir, "continuous.jsonl");

const SAMPLES = Number(process.env.CF_SAMPLES) || 30_000;
const TARGET_RUNS_PER_CELL = Number(process.env.CF_TARGET_RUNS) || 8;
const PRINT_EVERY = Number(process.env.CF_PRINT_EVERY) || 1;

// ---------- experiment catalog ----------

const FIELDS = [
  20, 50, 100, 200, 350, 500, 750, 1000, 1500, 2500, 4000, 6000, 10_000, 18_000,
  30_000, 50_000,
];
const ROIS = [-0.20, -0.10, 0, 0.05, 0.10, 0.20, 0.35, 0.50, 0.80];
const RAKES = [0.05, 0.08, 0.10, 0.15, 0.20];
const BUYINS = [5, 50, 215, 1050];
const N_TOURNEYS_CHOICES = [100, 300, 500, 1000, 2000];
const PAYOUTS: PayoutStructureId[] = [
  "mtt-standard",
  "mtt-primedope",
  "mtt-flat",
  "mtt-top-heavy",
  "mtt-pokerstars",
  "mtt-gg",
  "mtt-sunday-million",
  "winner-takes-all",
  "sng-50-30-20",
];
const FINISH_MODELS: FinishModelId[] = [
  "power-law",
  "linear-skill",
  "stretched-exp",
  "plackett-luce",
  "uniform",
];
const ROI_STD_ERRS = [0, 0.03, 0.08];

type ScenarioKind =
  | "singleRow" // one row, full grid
  | "mixedTwo" // two-row mixed schedule
  | "mixedFour" // four-row mixed (varied fields)
  | "reEntryLike" // single row with count^N reflecting re-entry spam
  | "shortSession" // N small (≤ 100)
  | "longGrind"; // N large (≥ 1500)

const SCENARIO_WEIGHTS: Array<[ScenarioKind, number]> = [
  ["singleRow", 5],
  ["mixedTwo", 2],
  ["mixedFour", 1],
  ["reEntryLike", 1],
  ["shortSession", 1],
  ["longGrind", 2],
];

// ---------- cell description ----------

interface SingleCell {
  kind: "singleRow" | "shortSession" | "longGrind" | "reEntryLike";
  field: number;
  roi: number;
  rake: number;
  buyIn: number;
  nTourneys: number;
  payout: PayoutStructureId;
  finishModel: FinishModelId;
  roiStdErr: number;
}

interface MixedCell {
  kind: "mixedTwo" | "mixedFour";
  rows: Array<{
    field: number;
    roi: number;
    rake: number;
    buyIn: number;
    count: number;
    payout: PayoutStructureId;
  }>;
  finishModel: FinishModelId;
  roiStdErr: number;
}

type Cell = SingleCell | MixedCell;

function isMixed(c: Cell): c is MixedCell {
  return c.kind === "mixedTwo" || c.kind === "mixedFour";
}

function cellKey(c: Cell): string {
  const h = createHash("sha1");
  h.update(JSON.stringify(c));
  return h.digest("hex").slice(0, 12);
}

// ---------- samplers ----------

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function weightedPick<T>(choices: Array<[T, number]>, rng: () => number): T {
  const total = choices.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [v, w] of choices) {
    r -= w;
    if (r <= 0) return v;
  }
  return choices[choices.length - 1]![0];
}

function buildSingleCell(
  kind: SingleCell["kind"],
  rng: () => number,
): SingleCell {
  const nTourneys =
    kind === "shortSession"
      ? pick([50, 75, 100], rng)
      : kind === "longGrind"
        ? pick([1500, 2500, 4000], rng)
        : kind === "reEntryLike"
          ? pick([500, 1000], rng)
          : pick(N_TOURNEYS_CHOICES, rng);
  return {
    kind,
    field: pick(FIELDS, rng),
    roi: pick(ROIS, rng),
    rake: pick(RAKES, rng),
    buyIn: pick(BUYINS, rng),
    nTourneys,
    payout: pick(PAYOUTS, rng),
    finishModel: pick(FINISH_MODELS, rng),
    roiStdErr: pick(ROI_STD_ERRS, rng),
  };
}

function buildMixedCell(
  kind: "mixedTwo" | "mixedFour",
  rng: () => number,
): MixedCell {
  const n = kind === "mixedTwo" ? 2 : 4;
  const rows: MixedCell["rows"] = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      field: pick(FIELDS, rng),
      roi: pick(ROIS, rng),
      rake: pick(RAKES, rng),
      buyIn: pick(BUYINS, rng),
      count: pick([50, 100, 200, 400], rng),
      payout: pick(PAYOUTS, rng),
    });
  }
  return {
    kind,
    rows,
    finishModel: pick(FINISH_MODELS, rng),
    roiStdErr: pick(ROI_STD_ERRS, rng),
  };
}

function sampleCell(rng: () => number): Cell {
  const kind = weightedPick(SCENARIO_WEIGHTS, rng);
  if (kind === "mixedTwo" || kind === "mixedFour") {
    return buildMixedCell(kind, rng);
  }
  return buildSingleCell(kind, rng);
}

// ---------- engine ----------

interface CellMeasurement {
  sigmaRoi: number;
  sigmaTotal: number;
  meanRoi: number;
  totalBuyIn: number;
  nTourneys: number;
  wallMs: number;
}

function describeCell(cell: Cell): string {
  if (isMixed(cell)) return `${cell.kind}×${cell.rows.length}`;
  return `f${cell.field} roi${(cell.roi * 100).toFixed(0)} ${cell.payout}`;
}

function cellToSchedule(cell: Cell): TournamentRow[] {
  if (isMixed(cell)) {
    return cell.rows.map((r, i) => ({
      id: `r${i}`,
      label: `r${i}`,
      players: r.field,
      buyIn: r.buyIn,
      rake: r.rake,
      roi: r.roi,
      payoutStructure: r.payout,
      count: r.count,
    }));
  }
  return [
    {
      id: "r0",
      label: "r0",
      players: cell.field,
      buyIn: cell.buyIn,
      rake: cell.rake,
      roi: cell.roi,
      payoutStructure: cell.payout,
      count: cell.nTourneys,
    },
  ];
}

function measure(
  cell: Cell,
  seed: number,
  calibrationMode: CalibrationMode,
): CellMeasurement {
  const schedule = cellToSchedule(cell);

  const input: SimulationInput = {
    schedule,
    scheduleRepeats: 1,
    samples: SAMPLES,
    bankroll: 0,
    seed,
    finishModel: { id: cell.finishModel },
    roiStdErr: cell.roiStdErr,
    calibrationMode,
  };
  const t0 = Date.now();
  const r = runSimulation(input);
  const wallMs = Date.now() - t0;
  const N = r.tournamentsPerSample;
  const sigmaTotal = r.stats.stdDev;
  const abi = r.totalBuyIn / N;
  const sigmaRoi = abi > 0 ? sigmaTotal / Math.sqrt(N) / abi : 0;
  return {
    sigmaRoi,
    sigmaTotal,
    meanRoi: r.totalBuyIn > 0 ? r.expectedProfit / r.totalBuyIn : 0,
    totalBuyIn: r.totalBuyIn,
    nTourneys: N,
    wallMs,
  };
}

// ---------- JSONL state ----------

interface Record {
  ts: number;
  key: string;
  cell: Cell;
  samples: number;
  seed: number;
  alpha: CellMeasurement;
  pd: CellMeasurement;
}

function loadCellCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  if (!existsSync(outFile)) return counts;
  const raw = readFileSync(outFile, "utf-8");
  let priorIters = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as Record;
      counts.set(rec.key, (counts.get(rec.key) ?? 0) + 1);
      priorIters++;
    } catch {
      // skip partial/truncated last line
    }
  }
  console.log(
    `[continuous_fit] resumed: ${priorIters} prior records across ${counts.size} unique cells`,
  );
  return counts;
}

// ---------- driver ----------

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const counts = loadCellCounts();
  const rng = mulberry32(Date.now() & 0x7fffffff);

  console.log(
    `[continuous_fit] samples=${SAMPLES} target=${TARGET_RUNS_PER_CELL} out=${outFile}`,
  );
  console.log("[continuous_fit] Ctrl-C to stop. Safe to resume at any time.");

  const t0 = Date.now();
  let iter = 0;
  while (true) {
    iter++;

    // Sample candidate cells; bias toward under-measured ones. We draw 8
    // candidates and pick the one with the lowest existing count (ties
    // broken randomly via draw order). This is a cheap stand-in for a real
    // priority queue and avoids the degenerate "keep hitting the same 3
    // cells forever" regime that straight random sampling drifts into.
    let bestCell: Cell | null = null;
    let bestKey = "";
    let bestCount = Infinity;
    for (let i = 0; i < 8; i++) {
      const c = sampleCell(rng);
      const k = cellKey(c);
      const n = counts.get(k) ?? 0;
      if (n < bestCount) {
        bestCell = c;
        bestKey = k;
        bestCount = n;
        if (n === 0) break;
      }
    }
    if (!bestCell) continue;

    const seed = Math.floor(rng() * 0x7fffffff);
    let alpha: CellMeasurement;
    let pd: CellMeasurement;
    try {
      alpha = measure(bestCell, seed, "alpha");
      pd = measure(bestCell, seed, "primedope-binary-itm");
    } catch (err) {
      console.error(
        `[continuous_fit] iter=${iter} key=${bestKey} threw: ${String(err)}`,
      );
      continue;
    }

    const rec: Record = {
      ts: Date.now(),
      key: bestKey,
      cell: bestCell,
      samples: SAMPLES,
      seed,
      alpha,
      pd,
    };
    appendFileSync(outFile, JSON.stringify(rec) + "\n");
    counts.set(bestKey, (counts.get(bestKey) ?? 0) + 1);

    if (iter % PRINT_EVERY === 0) {
      const elapsedM = ((Date.now() - t0) / 60_000).toFixed(1);
      const ratio = alpha.sigmaRoi > 0 ? pd.sigmaRoi / alpha.sigmaRoi : 0;
      const descr = describeCell(bestCell);
      console.log(
        `[${iter.toString().padStart(5)}] ${elapsedM}m  ${bestKey}  n=${bestCount + 1}  ${descr}  σα=${alpha.sigmaRoi.toFixed(3)} σpd=${pd.sigmaRoi.toFixed(3)} r=${ratio.toFixed(3)}  ${alpha.wallMs + pd.wallMs}ms`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
