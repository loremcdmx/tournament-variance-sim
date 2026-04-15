/**
 * Dump every PrimeDope payout table from tmp_legacy.js, expand the sparse
 * [place, fraction] format into a full per-place curve, compute analytical
 * binary-ITM σ for the 100-player / $50 / 10 % ROI reference, and report
 * which table best matches PD's reported sim SD of $5789.
 */

import { readFileSync } from "node:fs";

const src = readFileSync("tmp_legacy.js", "utf8");
// Pull out the `var h = [ ... ]` block via brace matching.
const start = src.indexOf("var g, h = [");
if (start < 0) throw new Error("h not found");
const open = src.indexOf("[", start);
let depth = 0;
let end = -1;
for (let i = open; i < src.length; i++) {
  const ch = src[i];
  if (ch === "[") depth++;
  else if (ch === "]") {
    depth--;
    if (depth === 0) {
      end = i;
      break;
    }
  }
}
if (end < 0) throw new Error("unmatched [");
const block = src.slice(open, end + 1);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h: [number, number][][] = eval(block);

console.log(`parsed h with ${h.length} tables`);

// Expand sparse [place, fraction] format into a per-place fraction array.
function expand(table: [number, number][], maxField: number): number[] {
  const out = new Array(maxField).fill(0);
  let prev = 0;
  for (const [place, frac] of table) {
    if (place > maxField) break;
    for (let p = prev + 1; p <= place; p++) out[p - 1] = frac;
    prev = place;
  }
  return out;
}

// Reference: 100 players, $50, 10 % ROI, PD-style EV → target = $55.
const N = 100;
const buyIn = 50;
const roi = 0.1;
const pool = N * buyIn;
const target = buyIn * (1 + roi); // $55, PD-style (rake out)

console.log(
  `ref: N=${N} buyIn=$${buyIn} pool=$${pool} target=$${target}  PD reports σ_1000≈$5789 (sim) / $5607 (math)`,
);
console.log("─".repeat(82));
console.log(
  "idx  paid  sum(frac)  1st%  σ₁($)   σ_1000($)   |Δ to 5789|   l(itm%)",
);
console.log("─".repeat(82));

const results: Array<{ idx: number; sd1k: number; paid: number }> = [];
for (let idx = 0; idx < h.length; idx++) {
  const tbl = h[idx];
  const fractions = expand(tbl, N);
  const sumFrac = fractions.reduce((a, b) => a + b, 0);
  // Skip tables that don't sum to ~1 (e.g. winner-takes-all degenerate)
  if (sumFrac < 0.5 || sumFrac > 1.5) {
    console.log(`${idx.toString().padStart(2)}  -    sum=${sumFrac.toFixed(2)} skipped`);
    continue;
  }
  const paid = fractions.reduce((n, f) => (f > 0 ? n + 1 : n), 0);
  if (paid === 0) continue;
  // Two-bin uniform: l = target * paid / pool
  const l = (target * paid) / pool;
  if (l > 1) {
    console.log(`${idx.toString().padStart(2)}  ${paid.toString().padStart(3)}  l>1 skipped`);
    continue;
  }
  const pPaid = l / paid;
  let mu = 0,
    mu2 = 0;
  for (let i = 0; i < paid; i++) {
    const prize = fractions[i] * pool;
    mu += pPaid * prize;
    mu2 += pPaid * prize * prize;
  }
  const sd1 = Math.sqrt(Math.max(0, mu2 - mu * mu));
  const sd1k = sd1 * Math.sqrt(1000);
  const delta = Math.abs(sd1k - 5789);
  console.log(
    `${idx.toString().padStart(2)}   ${paid.toString().padStart(3)}   ${sumFrac.toFixed(3)}     ${(fractions[0] * 100).toFixed(1).padStart(4)}  ${sd1.toFixed(1).padStart(6)}  ${sd1k.toFixed(0).padStart(7)}      ${delta.toFixed(0).padStart(5)}     ${(l * 100).toFixed(2).padStart(5)}`,
  );
  results.push({ idx, sd1k, paid });
}
console.log("─".repeat(82));

// Best match
results.sort((a, b) => Math.abs(a.sd1k - 5789) - Math.abs(b.sd1k - 5789));
console.log("\nbest 5 matches to PD sim σ=$5789:");
for (const r of results.slice(0, 5)) {
  console.log(`  idx=${r.idx}  paid=${r.paid}  σ_1000=$${r.sd1k.toFixed(0)}`);
}
console.log("\nbest 5 matches to PD math σ=$5607:");
results.sort((a, b) => Math.abs(a.sd1k - 5607) - Math.abs(b.sd1k - 5607));
for (const r of results.slice(0, 5)) {
  console.log(`  idx=${r.idx}  paid=${r.paid}  σ_1000=$${r.sd1k.toFixed(0)}`);
}
