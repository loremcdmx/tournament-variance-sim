/**
 * How far each closed-form surface (`lib/sigmaSurfaces.ts`) sits from the σ the
 * planning card of its format prints at the same point: `formatRuntimeSigma`,
 * the compile of the card's own row, under the app's default finish model
 * (`powerlaw-realdata-influenced`). It is why the surfaces live under
 * `scripts/` and not one forgotten argument away from a card; the figures in
 * docs/FITTING.md ("Current fits") are its output. Re-run it after a refit or a
 * change to the compile, a payout table or a finish model.
 *
 * Grid: every even field 50-600 and 80 log-spaced fields from 600 to 50 000,
 * ROI in 10-point steps over each tab's slider box, rake 10 %. Battle Royale:
 * AFS 18, ROI in 1-point steps over ±10 %, rake 8 %, its tab's default. Each is
 * the surface's own fit rake, so no rake rescale enters. Per format it prints
 * the p50 / p95 / max of |surface / card − 1| and the worst cell, with the
 * volume of the ±10 % row (95 % confidence) both ways.
 *
 *   npx tsx scripts/surface_vs_card_gap.ts [freeze|pko|mystery|mystery-royale]
 */
import { evalSigma, SIGMA_COEF_BY_FORMAT } from "./lib/sigmaSurfaces";
import { ciToZ, roiControlBoundsForFormat } from "../src/lib/sim/convergenceMath";
import { formatRuntimeSigma, type RuntimeSigmaFormat } from "../src/lib/sim/formatRuntimeSigma";

const FORMATS: RuntimeSigmaFormat[] = ["freeze", "pko", "mystery", "mystery-royale"];
const only = process.argv[2] as RuntimeSigmaFormat | undefined;
if (only !== undefined && !FORMATS.includes(only)) {
  throw new Error(`unknown format ${only}; one of ${FORMATS.join(", ")}`);
}

const FIELDS: number[] = [];
for (let f = 50; f <= 600; f += 2) FIELDS.push(f);
for (let i = 1; i <= 80; i++) {
  FIELDS.push(Math.round(Math.exp(Math.log(600) + ((Math.log(50_000) - Math.log(600)) * i) / 80)));
}
const finishModel = { id: "powerlaw-realdata-influenced" } as const;
const z95 = ciToZ(0.95);
const k10 = (sigma: number) => Math.ceil(Math.pow((z95 * sigma) / 0.1, 2));
const pct = (x: number) => `${(x * 100).toFixed(1)} %`;

for (const format of only ? [only] : FORMATS) {
  const isBr = format === "mystery-royale";
  const { min, max } = roiControlBoundsForFormat(format);
  const step = isBr ? 0.01 : 0.1;
  const rois: number[] = [];
  for (let r = min; r <= max + 1e-9; r += step) rois.push(Math.round(r * 100) / 100);
  const rake = isBr ? 0.08 : 0.1;
  const misses: number[] = [];
  let worst = { miss: -1, field: 0, roi: 0, surface: 0, card: 0 };
  for (const field of isBr ? [18] : FIELDS) {
    for (const roi of rois) {
      const card = formatRuntimeSigma(format, { afs: field, roi, rake, finishModel });
      if (card === null) throw new Error(`no runtime σ for ${format} at field ${field}, ROI ${roi}`);
      const surface = evalSigma(SIGMA_COEF_BY_FORMAT[format], field, roi);
      const miss = Math.abs(surface / card - 1);
      misses.push(miss);
      if (miss > worst.miss) worst = { miss, field, roi, surface, card };
    }
  }
  misses.sort((a, b) => a - b);
  const at = (q: number) => misses[Math.min(misses.length - 1, Math.floor(q * misses.length))];
  console.log(
    `${format.padEnd(15)} ${String(misses.length).padStart(5)} cells  p50 ${pct(at(0.5))}  p95 ${pct(at(0.95))}  max ${pct(misses[misses.length - 1])}` +
      `  worst: field ${worst.field}, ROI ${pct(worst.roi)}, σ ${worst.surface.toFixed(4)} vs ${worst.card.toFixed(4)}` +
      ` (${(worst.surface / worst.card).toFixed(2)}x), ±10 % row ${k10(worst.surface)} vs ${k10(worst.card)} tournaments`,
  );
}
