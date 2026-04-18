/**
 * Reproduce exactly what ResultsView's rbStreaks toggle does:
 *   rbStreaks=true  → uses engine's `result` (RB baked into paths)
 *   rbStreaks=false → uses `shiftResultByRakeback(result, curve, -1)` which
 *                     re-derives histograms via aggregateStreaks(paths, -curve)
 *
 * Print side-by-side summaries so we can see whether the toggle actually
 * produces different histograms, and by how much.
 */

import { runSimulation } from "../src/lib/sim/engine";
import { aggregateStreaks } from "../src/lib/sim/pathStreaks";
import type { SimulationInput } from "../src/lib/sim/types";

function input(rb: number): SimulationInput {
  return {
    schedule: [
      {
        id: "r1",
        label: "probe",
        players: 1000,
        buyIn: 50,
        rake: 0.1,
        roi: 0.1,
        payoutStructure: "mtt-standard",
        count: 500,
      },
    ],
    scheduleRepeats: 1,
    samples: 4000,
    bankroll: 0,
    seed: 42,
    finishModel: { id: "powerlaw-realdata-influenced" },
    rakebackFracOfRake: rb,
  };
}

function summarize(label: string, hist: { binEdges: number[]; counts: number[] }) {
  const total = hist.counts.reduce((a, c) => a + c, 0);
  if (total === 0) {
    console.log(`  ${label}: empty`);
    return;
  }
  let cum = 0;
  let p50 = hist.binEdges[hist.binEdges.length - 1];
  let p95 = hist.binEdges[hist.binEdges.length - 1];
  for (let i = 0; i < hist.counts.length; i++) {
    cum += hist.counts[i];
    const mid = (hist.binEdges[i] + hist.binEdges[i + 1]) / 2;
    if (cum / total < 0.5) p50 = mid;
    if (cum / total < 0.95) p95 = mid;
  }
  const max = hist.binEdges[hist.binEdges.length - 1];
  console.log(
    `  ${label}: p50=${p50.toFixed(1)}, p95=${p95.toFixed(1)}, max=${max.toFixed(1)}, bins=${hist.counts.length}, total=${total}`,
  );
}

function main() {
  const rb = 0.3;
  const withRb = runSimulation(input(rb));

  console.log(`Samples: ${withRb.samples}, hi-res paths: ${withRb.samplePaths.paths.length}`);
  console.log(`\n=== ENGINE OUTPUT (rbStreaks=true: uses result directly, RB baked in) ===`);
  summarize("drawdownHistogram   ", withRb.drawdownHistogram);
  summarize("longestBreakevenHist", withRb.longestBreakevenHistogram);
  summarize("longestCashlessHist ", withRb.longestCashlessHistogram);
  summarize("recoveryHistogram   ", withRb.recoveryHistogram);

  // Replicate shiftResultByRakeback's aggregateStreaks call (rbStreaks=false branch).
  // In ResultsView: signedCurve = -1 * rakebackCurve.
  // rakebackCurve is built from totalBuyIn * rb × rake (per tournament, on the xHi grid).
  // For this schedule: rake=0.10, buyIn=50, rb=0.3 → $1.50 per tournament.
  // Build equivalent rakeback curve on the hi-res x axis.
  const xHi = withRb.samplePaths.x;
  const n = xHi.length;
  const totalTourn = xHi[n - 1];
  const rbPerTourn = rb * 0.1 * 50;
  const curve = new Float64Array(n);
  for (let i = 0; i < n; i++) curve[i] = rbPerTourn * xHi[i];
  const negCurve = new Float64Array(n);
  for (let i = 0; i < n; i++) negCurve[i] = -curve[i];

  const agg = aggregateStreaks(withRb.samplePaths.paths, xHi, negCurve);

  console.log(
    `\n=== aggregateStreaks(paths, -curve) (rbStreaks=false: UI re-derives) ===`,
  );
  console.log(
    `    RB curve: $${rbPerTourn.toFixed(2)}/tourn → total $${(rbPerTourn * totalTourn).toFixed(2)} over ${totalTourn} tourns`,
  );
  summarize("drawdownHistogram   ", agg.drawdownHistogram);
  summarize("longestBreakevenHist", agg.longestBreakevenHistogram);
  summarize("longestCashlessHist ", agg.longestCashlessHistogram);
  summarize("recoveryHistogram   ", agg.recoveryHistogram);

  console.log(`\n=== AS-IS aggregateStreaks(paths, null) (compare with engine for algorithm parity) ===`);
  const aggNull = aggregateStreaks(withRb.samplePaths.paths, xHi, null);
  summarize("drawdownHistogram   ", aggNull.drawdownHistogram);
  summarize("longestBreakevenHist", aggNull.longestBreakevenHistogram);
  summarize("longestCashlessHist ", aggNull.longestCashlessHistogram);
  summarize("recoveryHistogram   ", aggNull.recoveryHistogram);

  console.log(`\n=== DELTA (aggregateStreaks with -curve vs without) ===`);
  console.log(
    `  drawdown max:     ${agg.stats.maxDrawdownMean.toFixed(2)} (−rb) vs ${aggNull.stats.maxDrawdownMean.toFixed(2)} (no shift) → Δ ${(
      agg.stats.maxDrawdownMean - aggNull.stats.maxDrawdownMean
    ).toFixed(2)}`,
  );
  console.log(
    `  longestBE mean:   ${agg.stats.longestBreakevenMean.toFixed(2)} (−rb) vs ${aggNull.stats.longestBreakevenMean.toFixed(2)} (no shift) → Δ ${(
      agg.stats.longestBreakevenMean - aggNull.stats.longestBreakevenMean
    ).toFixed(2)}`,
  );
  console.log(
    `  recovery median:  ${agg.stats.recoveryMedian.toFixed(2)} (−rb) vs ${aggNull.stats.recoveryMedian.toFixed(2)} (no shift) → Δ ${(
      agg.stats.recoveryMedian - aggNull.stats.recoveryMedian
    ).toFixed(2)}`,
  );

  console.log(`\n=== ENGINE vs aggregateStreaks(paths, null) parity check ===`);
  console.log(
    `  drawdown max:     engine=${withRb.stats.maxDrawdownMean.toFixed(2)}, path-derived=${aggNull.stats.maxDrawdownMean.toFixed(2)}`,
  );
  console.log(
    `  longestBE mean:   engine=${withRb.stats.longestBreakevenMean.toFixed(2)}, path-derived=${aggNull.stats.longestBreakevenMean.toFixed(2)}`,
  );
}

main();
