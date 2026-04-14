// Read scripts/pd_payout_curves.json (full per-place fractions) and
// compress into anchor form [[place, fraction], ...] where each anchor
// means "places prev+1..place all get this fraction". Writes
// scripts/pd_live_curves.json ready for inlining in src/lib/sim/pdCurves.ts.
import { readFileSync, writeFileSync } from "node:fs";

const curves = JSON.parse(readFileSync("scripts/pd_payout_curves.json", "utf-8"));

function compact(fractions) {
  const anchors = [];
  let runStart = 0;
  for (let i = 1; i <= fractions.length; i++) {
    if (i === fractions.length || fractions[i] !== fractions[runStart]) {
      anchors.push([i, fractions[runStart]]);
      runStart = i;
    }
  }
  return anchors;
}

const out = curves.map((c) => ({ paid: c.paid, anchors: compact(c.fractions) }));
writeFileSync("scripts/pd_live_curves.json", JSON.stringify(out));

// Stats
for (const c of out) {
  console.log(
    `paid=${String(c.paid).padStart(4)}  anchors=${String(c.anchors.length).padStart(3)}  ` +
      `last=[${c.anchors[c.anchors.length - 1].join(",")}]`,
  );
}
const bytes = readFileSync("scripts/pd_live_curves.json").length;
console.log(`\ntotal bytes: ${bytes}`);
