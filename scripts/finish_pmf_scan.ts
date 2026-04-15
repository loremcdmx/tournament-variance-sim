/**
 * Show the per-place finish PMF that our power-law + α-calibration
 * assigns to a skilled player at different ROI levels, for two field
 * sizes. Quantifies how much "extra" FT/top-1%/ITM frequency a
 * given ROI buys you vs a no-skill uniform baseline.
 */

import { buildFinishPMF, calibrateAlpha } from "../src/lib/sim/finishModel";
import { primedopeCurveForPaid } from "../src/lib/sim/pdCurves";
import type { FinishModelConfig } from "../src/lib/sim/types";

interface Scenario {
  label: string;
  players: number;
  placesPaid: number;
  buyIn: number;
  rakePct: number;
}

const scenarios: Scenario[] = [
  { label: "100p / paid=15 / 10% rake", players: 100, placesPaid: 15, buyIn: 10, rakePct: 10 },
  { label: "900p / paid=135 / 10% rake", players: 900, placesPaid: 135, buyIn: 10, rakePct: 10 },
];

const rois = [0.1, 0.2, 0.5];

const models: Array<{ label: string; cfg: FinishModelConfig }> = [
  { label: "power-law       ", cfg: { id: "power-law" } },
  { label: "linear-skill    ", cfg: { id: "linear-skill" } },
  { label: "stretched-exp β=1", cfg: { id: "stretched-exp", beta: 1 } },
  { label: "stretched-exp β=0.5", cfg: { id: "stretched-exp", beta: 0.5 } },
  { label: "plackett-luce   ", cfg: { id: "plackett-luce" } },
];

function bucketMass(pmf: Float64Array, from: number, toInclusive: number): number {
  let s = 0;
  for (let i = from - 1; i < toInclusive && i < pmf.length; i++) s += pmf[i];
  return s;
}

function pct(n: number, digits = 2): string {
  return (n * 100).toFixed(digits) + "%";
}

function ratio(a: number, b: number): string {
  if (b <= 0) return "∞";
  return (a / b).toFixed(2) + "x";
}

console.log("=".repeat(110));
console.log("Finish-place PMF scan — power-law (default) with α calibrated to target ROI");
console.log("=".repeat(110));

for (const sc of scenarios) {
  const N = sc.players;
  const paid = sc.placesPaid;
  const curve = primedopeCurveForPaid(paid);
  const prizePool = N * sc.buyIn;
  const costPerEntry = sc.buyIn * (1 + sc.rakePct / 100);

  console.log();
  console.log(
    `\n━━━ ${sc.label} ━━━ buyIn=$${sc.buyIn} (cost $${costPerEntry.toFixed(2)})  pool=$${prizePool} ━━━`,
  );

  const ftEnd = Math.min(9, N);
  const top1pct = Math.max(1, Math.round(N * 0.01));
  const mincashFrom = Math.max(1, paid - Math.floor(paid / 3) + 1);
  const buckets: Array<{ label: string; from: number; to: number }> = [
    { label: "1st", from: 1, to: 1 },
    { label: "top-3", from: 1, to: 3 },
    { label: `FT (1-${ftEnd})`, from: 1, to: ftEnd },
    { label: `top1% (1-${top1pct})`, from: 1, to: top1pct },
    { label: `ITM (1-${paid})`, from: 1, to: paid },
    { label: "minCash", from: mincashFrom, to: paid },
    { label: `no cash`, from: paid + 1, to: N },
  ];

  for (const roi of rois) {
    console.log(
      `\n  ROI +${roi * 100}%   ` +
        `${"model".padEnd(20)}` +
        buckets.map((b) => b.label.padStart(10)).join("  ") +
        `   ${"P1/PN".padStart(8)}   ${"α".padStart(7)}`,
    );
    // no-skill row
    const uniformPmf = new Float64Array(N).fill(1 / N);
    console.log(
      `            ${"no-skill".padEnd(20)}` +
        buckets
          .map((b) => pct(bucketMass(uniformPmf, b.from, b.to)).padStart(10))
          .join("  ") +
        `   ${"1.0".padStart(8)}   ${"—".padStart(7)}`,
    );
    // each model
    for (const m of models) {
      const alpha = calibrateAlpha(
        N,
        curve,
        prizePool,
        costPerEntry,
        roi,
        m.cfg,
      );
      const pmf = buildFinishPMF(N, m.cfg, alpha);
      const p1pn = pmf[N - 1] > 0 ? pmf[0] / pmf[N - 1] : Infinity;
      console.log(
        `            ${m.label.padEnd(20)}` +
          buckets
            .map((b) => pct(bucketMass(pmf, b.from, b.to)).padStart(10))
            .join("  ") +
          `   ${p1pn.toFixed(1).padStart(8)}   ${alpha.toFixed(3).padStart(7)}`,
      );
    }
  }
}

console.log();
console.log("=".repeat(110));
console.log("How to read: 'top-3  3.00% → 4.80% (1.60x)' means a +10% ROI power-law player");
console.log("is 60% more likely to finish top-3 than a no-skill player. No-skill is 1/N uniform.");
console.log("The same player is slightly LESS likely to min-cash than no-skill — their edge");
console.log("comes from deep runs, not mincashing more often. This is exactly what PD's");
console.log("uniform-within-cashed-band model fails to capture.");
