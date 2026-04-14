// Parse the `h` payout anchor tables out of tmp_legacy.js and dump
// them to scripts/pd_curves.json. Each curve is stored as the compact
// anchor array [[place, fraction], ...] — exactly what PD stores.
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync("tmp_legacy.js", "utf-8");
const start = src.indexOf("var g, h = [");
if (start < 0) throw new Error("h table not found");
let depth = 0;
let i = src.indexOf("[", start);
let end = -1;
for (; i < src.length; i++) {
  const ch = src[i];
  if (ch === "[") depth++;
  else if (ch === "]") {
    depth--;
    if (depth === 0) {
      end = i + 1;
      break;
    }
  }
}
if (end < 0) throw new Error("unterminated h");
const literal = src.slice(start + "var g, h = ".length, end);
// eslint-disable-next-line no-eval
const h = eval(literal);
// Trim trailing zero-frac anchors (PD's PayoutTable.d() does this too —
// it splices everything past the last non-zero anchor).
const anchors = h.map((curve) => {
  let last = -1;
  for (let j = 0; j < curve.length; j++) if (curve[j][1] > 0) last = j;
  return curve.slice(0, last + 1);
});
// Paid count per curve = last anchor place.
const meta = anchors.map((c, idx) => ({
  idx,
  paid: c[c.length - 1][0],
  nAnchors: c.length,
}));
writeFileSync("scripts/pd_curves.json", JSON.stringify(anchors));
console.log(`wrote ${anchors.length} curves`);
for (const m of meta) console.log(`  h[${m.idx}] paid=${m.paid} anchors=${m.nAnchors}`);
