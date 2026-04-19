/**
 * Fit α (skill concentration) to an empirical finish-shape JSON.
 *
 *   npx tsx scripts/calibrate_alpha_empirical.ts \
 *     --input data/finish-shapes/my-fund-freeze.json \
 *     [--output data/finish-shapes/my-fund-freeze.alpha.json] \
 *     [--field-size 1000] \
 *     [--model power-law|stretched-exp|plackett-luce|all] \
 *     [--beta 1]  # only used by stretched-exp
 *
 * Strategy: resample the empirical raw-over-all-finishes histogram onto a
 * discrete PMF over places 1..N, then grid + golden-section search for the
 * α that minimises KL(empirical || model). Reports best-fit α, the KL
 * divergence, and a coarse goodness-of-fit (L1 distance on the tail).
 *
 * Use alongside scripts/ingest_finishes.ts: re-run ingest with
 * `--filter-roi-bucket winning|breakeven|losing` to get per-bucket shape
 * JSONs, then calibrate each one to build an α-by-ROI-bucket table.
 */

import fs from "node:fs";
import path from "node:path";
import { buildFinishPMF } from "../src/lib/sim/finishModel";
import type { FinishModelConfig, FinishModelId } from "../src/lib/sim/types";

// ---------- shape JSON (match ingest_finishes output) ----------------------

interface Bucket {
  x: number;
  density: number;
}

interface ShapeFile {
  source?: string;
  sample_size?: number;
  cash_cutoff_x?: number;
  cash_band_width_pct?: number;
  bucket_width_pct?: number;
  itm_rate_empirical?: number;
  buckets_raw_over_all_finishes?: Bucket[];
  buckets_cash_conditional?: Bucket[];
}

// ---------- args -----------------------------------------------------------

interface Args {
  input: string;
  output: string;
  fieldSize: number;
  models: FinishModelId[];
  beta: number;
}

const SUPPORTED_MODELS: readonly FinishModelId[] = [
  "power-law",
  "stretched-exp",
  "plackett-luce",
];

function parseArgs(argv: string[]): Args {
  const out: Args = {
    input: "",
    output: "",
    fieldSize: 1000,
    models: [...SUPPORTED_MODELS],
    beta: 1,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--input":
      case "-i":
        out.input = next();
        break;
      case "--output":
      case "-o":
        out.output = next();
        break;
      case "--field-size":
      case "-n":
        out.fieldSize = Number(next());
        break;
      case "--model": {
        const v = next();
        if (v === "all") out.models = [...SUPPORTED_MODELS];
        else out.models = [v as FinishModelId];
        break;
      }
      case "--beta":
        out.beta = Number(next());
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        if (a.startsWith("--")) {
          console.error(`unknown flag: ${a}`);
          process.exit(2);
        }
    }
  }
  if (!out.input) {
    console.error("missing --input <path>");
    process.exit(2);
  }
  if (!out.output) {
    const base = path.basename(out.input, path.extname(out.input));
    out.output = path.join(path.dirname(out.input), `${base}.alpha.json`);
  }
  return out;
}

function printHelp(): void {
  console.log(`Fit α to an empirical finish-shape JSON.

Usage:
  npx tsx scripts/calibrate_alpha_empirical.ts --input <shape.json> [options]

Options:
  --input, -i <path>         Finish-shape JSON from ingest_finishes.ts (required)
  --output, -o <path>        Output JSON (default: <input>.alpha.json)
  --field-size, -n <int>     Field size N at which to evaluate α (default 1000)
  --model <id>               "power-law" | "stretched-exp" | "plackett-luce" | "all" (default all)
  --beta <number>            β for stretched-exp (default 1)
`);
}

// ---------- empirical → discrete PMF on 1..N --------------------------------

function buildEmpiricalPMF(shape: ShapeFile, N: number): Float64Array {
  const buckets = shape.buckets_raw_over_all_finishes;
  if (!buckets || buckets.length === 0) {
    throw new Error(
      `input is missing buckets_raw_over_all_finishes; re-run ingest_finishes`,
    );
  }
  const width = shape.bucket_width_pct ?? 0.5;
  const pmf = new Float64Array(N);

  // Strategy: for every place i in 1..N compute its x_pct = (N-i+1)/N*100,
  // find the bucket that contains it, assign density. Then renormalise.
  // Buckets are right-closed: label X covers (X-width, X].
  // Missing bucket (e.g. x below cash_cutoff) gets the implicit OOTM density
  // spread uniformly over the tail: (1 − Σ cash_density) / (count of tail places).
  const known = new Map<number, number>();
  for (const b of buckets) known.set(b.x, b.density);

  const knownMass = Array.from(known.values()).reduce((a, b) => a + b, 0);
  let coveredPlaces = 0;
  for (let i = 1; i <= N; i++) {
    const x = ((N - i + 1) / N) * 100;
    const bx = x >= 100 ? 100 : Math.min(100, Math.ceil(x / width) * width);
    if (known.has(bx)) coveredPlaces++;
  }

  const tailDensity =
    coveredPlaces < N && knownMass < 1
      ? (1 - knownMass) / (N - coveredPlaces)
      : 0;

  let s = 0;
  for (let i = 1; i <= N; i++) {
    const x = ((N - i + 1) / N) * 100;
    const bx = x >= 100 ? 100 : Math.min(100, Math.ceil(x / width) * width);
    const v = known.get(bx) ?? tailDensity;
    pmf[i - 1] = Math.max(0, v);
    s += pmf[i - 1];
  }
  if (s > 0) {
    for (let i = 0; i < N; i++) pmf[i] /= s;
  } else {
    pmf.fill(1 / N);
  }
  return pmf;
}

// ---------- objective: KL(empirical || model) ------------------------------

function klDivergence(pEmp: Float64Array, pModel: Float64Array): number {
  const EPS = 1e-12;
  let kl = 0;
  for (let i = 0; i < pEmp.length; i++) {
    const p = pEmp[i];
    if (p <= 0) continue;
    const q = Math.max(EPS, pModel[i]);
    kl += p * Math.log(p / q);
  }
  return kl;
}

function l1Distance(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s;
}

// ---------- search: coarse grid → golden section ---------------------------

function fitAlpha(
  N: number,
  pEmp: Float64Array,
  model: FinishModelConfig,
  range: { lo: number; hi: number },
): { alpha: number; kl: number; l1: number } {
  // Coarse grid pass to land near the basin.
  const gridSteps = 40;
  let best = { alpha: range.lo, kl: Infinity };
  for (let g = 0; g <= gridSteps; g++) {
    const a = range.lo + ((range.hi - range.lo) * g) / gridSteps;
    const pm = buildFinishPMF(N, model, a);
    const kl = klDivergence(pEmp, pm);
    if (kl < best.kl) best = { alpha: a, kl };
  }

  // Golden-section refinement around the best grid point.
  const halfStep = (range.hi - range.lo) / gridSteps;
  let lo = Math.max(range.lo, best.alpha - halfStep);
  let hi = Math.min(range.hi, best.alpha + halfStep);
  const phi = (Math.sqrt(5) - 1) / 2;
  let c = hi - phi * (hi - lo);
  let d = lo + phi * (hi - lo);
  let fc = klDivergence(pEmp, buildFinishPMF(N, model, c));
  let fd = klDivergence(pEmp, buildFinishPMF(N, model, d));
  for (let iter = 0; iter < 60; iter++) {
    if (fc < fd) {
      hi = d;
      d = c;
      fd = fc;
      c = hi - phi * (hi - lo);
      fc = klDivergence(pEmp, buildFinishPMF(N, model, c));
    } else {
      lo = c;
      c = d;
      fc = fd;
      d = lo + phi * (hi - lo);
      fd = klDivergence(pEmp, buildFinishPMF(N, model, d));
    }
    if (Math.abs(hi - lo) < 1e-6) break;
  }
  const alpha = (lo + hi) / 2;
  const pm = buildFinishPMF(N, model, alpha);
  return { alpha, kl: klDivergence(pEmp, pm), l1: l1Distance(pEmp, pm) };
}

function rangeForModel(id: FinishModelId): { lo: number; hi: number } {
  switch (id) {
    case "stretched-exp":
      return { lo: -5, hi: 8 };
    case "plackett-luce":
      return { lo: -4, hi: 6 };
    case "power-law":
    default:
      return { lo: -6, hi: 25 };
  }
}

// ---------- main -----------------------------------------------------------

function run() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.input)) {
    console.error(`input not found: ${args.input}`);
    process.exit(2);
  }
  const shape: ShapeFile = JSON.parse(fs.readFileSync(args.input, "utf8"));
  const pEmp = buildEmpiricalPMF(shape, args.fieldSize);

  const fits: Array<{
    model: FinishModelId;
    alpha: number;
    kl: number;
    l1: number;
    beta?: number;
  }> = [];
  for (const modelId of args.models) {
    const cfg: FinishModelConfig =
      modelId === "stretched-exp"
        ? { id: "stretched-exp", beta: args.beta }
        : { id: modelId };
    const r = fitAlpha(args.fieldSize, pEmp, cfg, rangeForModel(modelId));
    fits.push({
      model: modelId,
      alpha: Number(r.alpha.toFixed(6)),
      kl: Number(r.kl.toFixed(6)),
      l1: Number(r.l1.toFixed(6)),
      ...(modelId === "stretched-exp" ? { beta: args.beta } : {}),
    });
  }

  fits.sort((a, b) => a.kl - b.kl);

  const out = {
    input: path.basename(args.input),
    source: shape.source ?? null,
    sample_size: shape.sample_size ?? null,
    field_size: args.fieldSize,
    fits,
    best: fits[0],
    convention:
      "alpha fit by minimising KL(empirical || model) over discrete place-PMF",
  };

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, JSON.stringify(out, null, 2) + "\n", "utf8");

  console.log(`wrote ${args.output}`);
  console.log(`field size: N = ${args.fieldSize}`);
  console.log(`best: ${out.best.model} α=${out.best.alpha} KL=${out.best.kl}`);
  console.log(`all fits (sorted by KL ascending):`);
  for (const f of fits) {
    const tag = f.model === "stretched-exp" ? `(β=${f.beta})` : "";
    console.log(
      `  ${f.model.padEnd(16)} ${tag.padEnd(8)} α=${f.alpha.toFixed(4)}  KL=${f.kl.toFixed(4)}  L1=${f.l1.toFixed(4)}`,
    );
  }
}

run();
