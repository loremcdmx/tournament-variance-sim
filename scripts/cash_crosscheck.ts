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

const N_SIMULATIONS = 20_000;
const BASE_SEED = 20260418;

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
    nSimulations: N_SIMULATIONS,
    bbSize: 1,
    rake: {
      enabled: false,
      contributedRakeBb100: 0,
      advertisedRbPct: 0,
      pvi: 1,
    },
    baseSeed: BASE_SEED,
  };
  const r = simulateCash(input);

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
    probSub100: r.stats.probSub100Bb,
    pDd500,
  };
}

function main(): void {
  console.log(
    `cash_crosscheck — ${N_SIMULATIONS.toLocaleString()} paths per scenario, seed ${BASE_SEED}`,
  );
  console.log("");

  for (const s of SCENARIOS) {
    const r = runScenario(s);
    console.log(`[${r.name}]`);
    console.log(
      `  inputs: wr=${r.input.wrBb100} bb/100, sd=${r.input.sdBb100} bb/100, hands=${r.input.hands.toLocaleString()}`,
    );
    console.log(`  E[final] (BB)         = ${fmt(r.expectedEvBb)}`);
    console.log(
      `  mean final (BB)        = ${fmt(r.meanFinalBb)}  (analytic=${fmt(r.expectedEvBb)})`,
    );
    console.log(`  SD of final (BB)      = ${fmt(r.sdFinalBb)}`);
    console.log(
      `  95% CI (±1.96σ) (BB)  = [${fmt(r.ci95Lo)}, ${fmt(r.ci95Hi)}]`,
    );
    console.log(`  P(loss)               = ${pct(r.probLoss)}`);
    console.log(`  P(min ≤ -100 BB)      = ${pct(r.probSub100)}`);
    console.log(`  P(max DD ≥ 500 BB)    = ${pct(r.pDd500)}`);
    console.log("");
  }

  console.log("--- Analytic cross-check ---");
  console.log(
    "  For wr=5, sd=100, hands=100k: E=5000 BB, σ=sd×√(hands/100)=100×√1000≈3162 BB",
  );
  console.log("  Our SD should be within ~1% of σ_analytic.");
}

main();
