/**
 * One-shot analyzer for `data/variance-fits/continuous.jsonl`.
 * Surfaces divergences between our α model and the PrimeDope model so we
 * can spot systematic bias vs random noise. Prints:
 *   - overall ratio distribution (pd σ / our σ)
 *   - worst-N divergent cells
 *   - breakdown by scenario kind, finish model, payout
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..");
const file = join(repoRoot, "data", "variance-fits", "continuous.jsonl");

interface Rec {
  ts: number;
  key: string;
  cell: any;
  samples: number;
  seed: number;
  alpha: { sigmaRoi: number; meanRoi: number; wallMs: number };
  pd: { sigmaRoi: number; meanRoi: number; wallMs: number };
}

const text = readFileSync(file, "utf-8");
const recs: Rec[] = [];
for (const line of text.split("\n")) {
  if (!line.trim()) continue;
  try {
    recs.push(JSON.parse(line));
  } catch {}
}

console.log(`total records: ${recs.length}`);
console.log(`unique cells: ${new Set(recs.map((r) => r.key)).size}`);
const first = recs[0].ts;
const last = recs[recs.length - 1].ts;
console.log(
  `time span: ${((last - first) / 60_000).toFixed(1)}m  ` +
    `(${((last - first) / recs.length / 1000).toFixed(2)}s/rec avg)`,
);

// Aggregate by cell key: average σ for each model, then compute ratio per cell.
interface Agg {
  cell: any;
  n: number;
  alphaSum: number;
  pdSum: number;
  alphaMeanRoiSum: number;
  pdMeanRoiSum: number;
  alphaSqSum: number;
  pdSqSum: number;
}
const byKey = new Map<string, Agg>();
for (const r of recs) {
  let a = byKey.get(r.key);
  if (!a) {
    a = {
      cell: r.cell,
      n: 0,
      alphaSum: 0,
      pdSum: 0,
      alphaMeanRoiSum: 0,
      pdMeanRoiSum: 0,
      alphaSqSum: 0,
      pdSqSum: 0,
    };
    byKey.set(r.key, a);
  }
  a.n++;
  a.alphaSum += r.alpha.sigmaRoi;
  a.pdSum += r.pd.sigmaRoi;
  a.alphaSqSum += r.alpha.sigmaRoi * r.alpha.sigmaRoi;
  a.pdSqSum += r.pd.sigmaRoi * r.pd.sigmaRoi;
  a.alphaMeanRoiSum += r.alpha.meanRoi;
  a.pdMeanRoiSum += r.pd.meanRoi;
}

interface CellSummary {
  key: string;
  cell: any;
  n: number;
  aSigma: number;
  pSigma: number;
  ratio: number;
  aMeanRoi: number;
  pMeanRoi: number;
  aSe: number;
  pSe: number;
}
const cells: CellSummary[] = [];
for (const [key, a] of byKey) {
  const aMean = a.alphaSum / a.n;
  const pMean = a.pdSum / a.n;
  const aVar = Math.max(0, a.alphaSqSum / a.n - aMean * aMean);
  const pVar = Math.max(0, a.pdSqSum / a.n - pMean * pMean);
  cells.push({
    key,
    cell: a.cell,
    n: a.n,
    aSigma: aMean,
    pSigma: pMean,
    ratio: aMean > 0 ? pMean / aMean : NaN,
    aMeanRoi: a.alphaMeanRoiSum / a.n,
    pMeanRoi: a.pdMeanRoiSum / a.n,
    aSe: Math.sqrt(aVar / Math.max(1, a.n)),
    pSe: Math.sqrt(pVar / Math.max(1, a.n)),
  });
}

// Overall ratio distribution.
const ratios = cells
  .filter((c) => Number.isFinite(c.ratio) && c.ratio > 0)
  .map((c) => c.ratio)
  .sort((a, b) => a - b);
const pct = (p: number) =>
  ratios[Math.min(ratios.length - 1, Math.floor(p * (ratios.length - 1)))];
console.log("");
console.log("--- σ(pd) / σ(alpha) per-cell ratio distribution ---");
console.log(
  `n=${ratios.length}  p05=${pct(0.05).toFixed(3)}  p25=${pct(0.25).toFixed(3)}  ` +
    `median=${pct(0.5).toFixed(3)}  mean=${(ratios.reduce((a, b) => a + b, 0) / ratios.length).toFixed(3)}  ` +
    `p75=${pct(0.75).toFixed(3)}  p95=${pct(0.95).toFixed(3)}  max=${pct(1).toFixed(3)}`,
);

const within5 = ratios.filter((r) => r >= 0.95 && r <= 1.05).length;
const within10 = ratios.filter((r) => r >= 0.9 && r <= 1.1).length;
const within20 = ratios.filter((r) => r >= 0.8 && r <= 1.2).length;
console.log(
  `cells within ±5%: ${within5} (${((within5 / ratios.length) * 100).toFixed(1)}%)`,
);
console.log(
  `cells within ±10%: ${within10} (${((within10 / ratios.length) * 100).toFixed(1)}%)`,
);
console.log(
  `cells within ±20%: ${within20} (${((within20 / ratios.length) * 100).toFixed(1)}%)`,
);

// Worst-20 cells by |log ratio|.
const worst = [...cells]
  .filter((c) => Number.isFinite(c.ratio))
  .sort((a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio)))
  .slice(0, 25);
console.log("");
console.log("--- 25 worst divergent cells (|log ratio|) ---");
for (const c of worst) {
  const kind = c.cell.kind;
  const fm = c.cell.finishModel;
  let descr: string;
  if (kind === "mixedTwo" || kind === "mixedFour") {
    descr = `${kind} rows=${c.cell.rows.length} fm=${fm}`;
  } else {
    descr = `${kind} f${c.cell.field} roi${(c.cell.roi * 100).toFixed(0)} ${c.cell.payout} fm=${fm} N=${c.cell.nTourneys}`;
  }
  console.log(
    `  n=${c.n} σα=${c.aSigma.toFixed(2)}±${c.aSe.toFixed(2)} σpd=${c.pSigma.toFixed(2)}±${c.pSe.toFixed(2)} r=${c.ratio.toFixed(3)}  ${descr}`,
  );
}

// Breakdown by scenario kind.
function groupRatios(
  label: string,
  keyFn: (c: CellSummary) => string | null,
) {
  const groups = new Map<string, number[]>();
  for (const c of cells) {
    if (!Number.isFinite(c.ratio)) continue;
    const k = keyFn(c);
    if (k == null) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(c.ratio);
  }
  console.log("");
  console.log(`--- ratio by ${label} ---`);
  const rows: Array<{ k: string; n: number; median: number; mean: number }> = [];
  for (const [k, arr] of groups) {
    arr.sort((a, b) => a - b);
    const median = arr[Math.floor(arr.length / 2)];
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    rows.push({ k, n: arr.length, median, mean });
  }
  rows.sort((a, b) => Math.abs(Math.log(b.median)) - Math.abs(Math.log(a.median)));
  for (const r of rows) {
    console.log(
      `  ${r.k.padEnd(22)} n=${String(r.n).padStart(4)}  median=${r.median.toFixed(3)}  mean=${r.mean.toFixed(3)}`,
    );
  }
}

groupRatios("scenario kind", (c) => c.cell.kind);
groupRatios("finish model", (c) => c.cell.finishModel ?? null);
groupRatios("payout (single-row only)", (c) =>
  c.cell.kind === "mixedTwo" || c.cell.kind === "mixedFour" ? null : c.cell.payout,
);
groupRatios("field size bucket (single-row only)", (c) => {
  if (c.cell.kind === "mixedTwo" || c.cell.kind === "mixedFour") return null;
  const f = c.cell.field;
  if (f < 100) return "<100";
  if (f < 500) return "100-500";
  if (f < 2000) return "500-2k";
  if (f < 10000) return "2k-10k";
  return "10k+";
});
groupRatios("roi bucket (single-row only)", (c) => {
  if (c.cell.kind === "mixedTwo" || c.cell.kind === "mixedFour") return null;
  const r = c.cell.roi;
  if (r < -0.05) return "loss";
  if (r < 0.1) return "flat";
  if (r < 0.3) return "mid";
  return "high";
});
groupRatios("N tourneys bucket (single-row only)", (c) => {
  if (c.cell.kind === "mixedTwo" || c.cell.kind === "mixedFour") return null;
  const n = c.cell.nTourneys;
  if (n <= 100) return "≤100";
  if (n <= 500) return "100-500";
  if (n <= 1000) return "500-1k";
  return "1k+";
});
