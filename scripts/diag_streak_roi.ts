/**
 * Diagnostic: does `breakevenStreakMean` and `maxDrawdownMedian` grow with ROI
 * in a fixed schedule? Beta tester observed that higher ROI produces deeper
 * typical drawdown and longer "any streak" length — the opposite of naive
 * intuition (higher edge → smaller swings).
 *
 * Hypothesis matrix:
 *   A) Real math: higher ROI → higher per-tourney σ (α-calibration concentrates
 *      pmf on top → bigger rare cashes → deeper local dips). σ²/drift ratio
 *      may rise faster than drift for reasonable ROI range.
 *   B) Bounty-variance scaling (#7 audit): in fixed-shape models, bountyMean
 *      is residual-reconciled to `totalEV − cashEV`, so higher ROI pumps
 *      bountyMean → per-KO $ variance scales linearly with bountyMean.
 *   C) Bug in streak aggregation.
 *
 * Falsifier: rerun each cell with `pkoHeadVar=0, mysteryBountyVariance=0`.
 * If the ROI→streak trend vanishes, it was channel B (bounty variance).
 * If it remains, it's channel A (drift-vs-σ competition, not a bug).
 *
 *   npx tsx scripts/diag_streak_roi.ts
 */

import { runSimulation } from "../src/lib/sim/engine";
import type { FinishModelId, SimulationInput, TournamentRow } from "../src/lib/sim/types";

const SAMPLES = 2000;
const COUNT = 3000;
const REPEATS = 12;
const SEED = 20260420;
const ROIS = [0.02, 0.10];
const MODELS: FinishModelId[] = [
  "powerlaw-realdata-influenced",
  "mystery-realdata-linear",
];
const RAKEBACK_LEVELS = [0, 0.5];

function buildRow(roi: number, bountyVarianceOff: boolean): TournamentRow {
  return {
    id: "diag",
    label: `diag-${roi}`,
    players: 18,
    buyIn: 10 / 1.08,
    rake: 0.08,
    roi,
    payoutStructure: "battle-royale",
    gameType: "mystery-royale",
    bountyFraction: 0.42,
    pkoHeadVar: bountyVarianceOff ? 0 : 0.4,
    mysteryBountyVariance: bountyVarianceOff ? 0 : 1.8,
    itmRate: 0.18,
    count: COUNT,
  };
}

function buildInput(
  roi: number,
  finishModelId: FinishModelId,
  bountyVarianceOff: boolean,
  rakebackFrac: number,
): SimulationInput {
  return {
    schedule: [buildRow(roi, bountyVarianceOff)],
    scheduleRepeats: REPEATS,
    samples: SAMPLES,
    bankroll: 0,
    seed: SEED,
    finishModel: { id: finishModelId },
    rakebackFracOfRake: rakebackFrac,
  };
}

interface Cell {
  roi: number;
  model: FinishModelId;
  bountyOff: boolean;
  rbFrac: number;
  beStreakMean: number;
  maxDdMedian: number;
  maxDdWorst: number;
  maxDdP99: number;
  sigma: number;
}

function runCell(
  roi: number,
  model: FinishModelId,
  bountyOff: boolean,
  rbFrac: number,
): Cell {
  const r = runSimulation(buildInput(roi, model, bountyOff, rbFrac));
  return {
    roi,
    model,
    bountyOff,
    rbFrac,
    beStreakMean: r.stats.breakevenStreakMean,
    maxDdMedian: r.stats.maxDrawdownMedian,
    maxDdWorst: r.stats.maxDrawdownWorst,
    maxDdP99: r.stats.maxDrawdownP99,
    sigma: r.stats.stdDev,
  };
}

function fmt(n: number, w = 7, digits = 1): string {
  return n.toFixed(digits).padStart(w);
}

async function main() {
  const t0 = Date.now();
  const totalPath = COUNT * REPEATS;
  console.log(
    `diag_streak_roi: samples=${SAMPLES}, count=${COUNT}, repeats=${REPEATS}, path length=${totalPath} tourneys, schedule=3k PKO 42% bounty, seed=${SEED}`,
  );
  console.log(`  ROI grid: ${ROIS.map((r) => `${(r * 100).toFixed(0)}%`).join(", ")}`);
  console.log(`  Rakeback levels: ${RAKEBACK_LEVELS.map((r) => `${(r * 100).toFixed(0)}%`).join(", ")}`);
  console.log("");

  for (const model of MODELS) {
    for (const bountyOff of [false, true]) {
      for (const rbFrac of RAKEBACK_LEVELS) {
        const lblBounty = bountyOff ? "bounty-σ=0" : "bounty-σ=default";
        const lblRb = rbFrac > 0 ? `rb=${(rbFrac * 100).toFixed(0)}%` : "no-rb";
        console.log(
          `=== model=${model}, ${lblBounty}, ${lblRb} =========================`,
        );
        console.log(
          "   roi   beStreakMean  maxDD-median  maxDD-P99    maxDD-worst   σ_total",
        );
        console.log(
          "  -----  ------------  ------------  -----------  ------------  -----------",
        );
        const cells: Cell[] = [];
        for (const roi of ROIS) {
          const c = runCell(roi, model, bountyOff, rbFrac);
          cells.push(c);
          console.log(
            `  ${fmt(roi * 100, 4, 0)}%  ${fmt(c.beStreakMean, 12, 1)}  ${fmt(c.maxDdMedian, 12, 1)}  ${fmt(c.maxDdP99, 11, 1)}  ${fmt(c.maxDdWorst, 12, 1)}  ${fmt(c.sigma, 10, 1)}`,
          );
        }
        const beDelta = cells[1].beStreakMean - cells[0].beStreakMean;
        const ddDelta = cells[1].maxDdMedian - cells[0].maxDdMedian;
        console.log(
          `    ROI 2% → 10%: Δ beStreakMean = ${beDelta >= 0 ? "+" : ""}${beDelta.toFixed(1)}, Δ maxDdMedian = ${ddDelta >= 0 ? "+" : ""}${ddDelta.toFixed(1)}`,
        );
        console.log("");
      }
    }
  }
  console.log(`total: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main();
