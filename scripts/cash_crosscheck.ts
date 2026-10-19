/**
 * Cash-mode cross-check harness.
 *
 * Runs our cash engine on a fixed matrix of scenarios and prints the
 * headline stats in a format designed for side-by-side comparison with
 * external variance calculators. Each scenario is chosen to probe a
 * different axis:
 *
 *   1. Baseline          — winrate 5 bb/100, SD 100, 100k hands
 *   2. Breakeven grinder — winrate 0 bb/100, pure variance
 *   3. High volume       — 1M hands, small winrate
 *   4. High volatility   — SD 140
 *   5. Losing player     — negative winrate
 *
 * Paths per scenario are capped so hands x paths stays inside the engine's own
 * work budget (`MAX_TOTAL_SIM_HANDS`, the ceiling the UI enforces): 20k paths of
 * 1M hands is 100x past it, which the app never runs. The analytic check at the
 * bottom is a z-score of the simulated mean against the analytic mean, so it
 * scales with the path count instead of promising a fixed percentage.
 *
 * Usage:
 *   npx tsx scripts/cash_crosscheck.ts
 *
 * Reference tools to compare against (all expose wr/sd/hands):
 *   - PrimeDope              https://www.primedope.com/poker-variance-calculator/
 *   - GamblingCalc           https://gamblingcalc.com/poker/variance-calculator-cash-games/
 *   - Limp Lab               https://www.limplab.com/calculators/variance
 *   - PokerLog               https://pokerlog.app/poker-tools/variance-calculator
 *
 * Paste the inputs listed below into each calculator and record the outputs
 * in the results table at the bottom of this file.
 */

import { simulateCash } from "../src/lib/sim/cashEngine";
import { MAX_TOTAL_SIM_HANDS } from "../src/lib/sim/cashInput";
import type { CashInput } from "../src/lib/sim/cashTypes";

interface Scenario {
  name: string;
  wrBb100: number;
  sdBb100: number;
  hands: number;
}

const SCENARIOS: Scenario[] = [
  { name: "baseline", wrBb100: 5, sdBb100: 100, hands: 100_000 },
  { name: "breakeven", wrBb100: 0, sdBb100: 100, hands: 100_000 },
  { name: "high-volume", wrBb100: 2, sdBb100: 100, hands: 1_000_000 },
  { name: "high-volatility", wrBb100: 5, sdBb100: 140, hands: 100_000 },
  { name: "losing", wrBb100: -3, sdBb100: 100, hands: 100_000 },
];

const MAX_SIMULATIONS = 20_000;
const BASE_SEED = 20260418;
// Risk threshold the engine reports `probBelowThresholdEver` against.
const THRESHOLD_BB = 100;

function pathsFor(s: Scenario): number {
  return Math.max(
    1,
    Math.min(MAX_SIMULATIONS, Math.floor(MAX_TOTAL_SIM_HANDS / s.hands)),
  );
}

function fmt(n: number, digits = 1): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function pct(p: number): string {
  return (p * 100).toFixed(2) + "%";
}

function runScenario(s: Scenario) {
  const input: CashInput = {
    type: "cash",
    wrBb100: s.wrBb100,
    sdBb100: s.sdBb100,
    hands: s.hands,
    nSimulations: pathsFor(s),
    bbSize: 1,
    rake: {
      enabled: false,
      contributedRakeBb100: 0,
      advertisedRbPct: 0,
      pvi: 1,
    },
    riskBlock: { thresholdBb: THRESHOLD_BB },
    baseSeed: BASE_SEED,
  };
  const r = simulateCash(input);
  const analyticSd = s.sdBb100 * Math.sqrt(s.hands / 100);
  const meanZ =
    (r.stats.meanFinalBb - r.stats.expectedEvBb) /
    (analyticSd / Math.sqrt(r.samples));

  // Per-path 95% CI: mean ± 1.96σ of the final-BR distribution (what external
  // calculators display as the "95% confidence band" around the trajectory).
  const ci95Lo = r.stats.meanFinalBb - 1.96 * r.stats.sdFinalBb;
  const ci95Hi = r.stats.meanFinalBb + 1.96 * r.stats.sdFinalBb;

  // Max drawdown stats (empirical from histogram bin midpoints).
  // For a better cross-check metric we compute P(DD ≥ X) manually.
  let pDd500 = 0;
  for (let i = 0; i < r.drawdownHistogram.counts.length; i++) {
    const mid = (r.drawdownHistogram.binEdges[i] + r.drawdownHistogram.binEdges[i + 1]) / 2;
    if (mid >= 500) pDd500 += r.drawdownHistogram.counts[i];
  }
  pDd500 /= r.samples;

  return {
    name: s.name,
    input: s,
    expectedEvBb: r.stats.expectedEvBb,
    meanFinalBb: r.stats.meanFinalBb,
    sdFinalBb: r.stats.sdFinalBb,
    ci95Lo,
    ci95Hi,
    probLoss: r.stats.probLoss,
    probBelowThreshold: r.stats.probBelowThresholdEver,
    pDd500,
    paths: r.samples,
    analyticSd,
    meanZ,
  };
}

function main(): void {
  console.log(
    `cash_crosscheck — up to ${MAX_SIMULATIONS.toLocaleString()} paths per scenario (capped at ${MAX_TOTAL_SIM_HANDS.toLocaleString()} total hands), seed ${BASE_SEED}`,
  );
  console.log("");

  for (const s of SCENARIOS) {
    const r = runScenario(s);
    console.log(`[${r.name}]`);
    console.log(
      `  inputs: wr=${r.input.wrBb100} bb/100, sd=${r.input.sdBb100} bb/100, hands=${r.input.hands.toLocaleString()}, paths=${r.paths.toLocaleString()}`,
    );
    console.log(`  E[final] (BB)         = ${fmt(r.expectedEvBb)}`);
    console.log(
      `  mean final (BB)        = ${fmt(r.meanFinalBb)}  (analytic=${fmt(r.expectedEvBb)})`,
    );
    console.log(
      `  SD of final (BB)      = ${fmt(r.sdFinalBb)}  (analytic=${fmt(r.analyticSd)})`,
    );
    console.log(`  z(mean vs analytic)   = ${fmt(r.meanZ, 2)}`);
    console.log(
      `  95% CI (±1.96σ) (BB)  = [${fmt(r.ci95Lo)}, ${fmt(r.ci95Hi)}]`,
    );
    console.log(`  P(loss)               = ${pct(r.probLoss)}`);
    console.log(
      `  P(min ≤ -${THRESHOLD_BB} BB)      = ${pct(r.probBelowThreshold)}`,
    );
    console.log(`  P(max DD ≥ 500 BB)    = ${pct(r.pDd500)}`);
    console.log("");
  }

  console.log("--- Analytic cross-check ---");
  console.log(
    "  For wr=5, sd=100, hands=100k: E=5000 BB, σ=sd×√(hands/100)=100×√1000≈3162 BB",
  );
  console.log(
    "  The simulated mean should sit within about ±3 standard errors of E (|z| ≤ 3);",
  );
  console.log(
    "  the standard error is σ/√paths, so a capped scenario is looser than a 20k-path one.",
  );
  console.log(
    "  z should scatter around 0 across seeds; a persistently positive z is the open cash-sampler offset in WISDOM.md.",
  );
}

main();
