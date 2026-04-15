import { runSimulation } from "../src/lib/sim/engine.ts";
import type { SimulationInput } from "../src/lib/sim/types.ts";

const input: SimulationInput = {
  schedule: [
    {
      id: "r1",
      players: 5000,
      buyIn: 50,
      rake: 0.10,
      roi: 0.10,
      payoutStructure: "mtt-standard",
      count: 1,
    },
  ],
  scheduleRepeats: 1000,
  samples: 100_000,
  bankroll: 5000,
  seed: 42,
  finishModel: { id: "power-law" },
};

const t0 = performance.now();
const r = runSimulation(input, () => {});
const dt = performance.now() - t0;

const s = r.stats;
const totalBI = r.totalBuyIn;
const pct = (x: number) => (x * 100).toFixed(2) + "%";
const m = (x: number) =>
  (x >= 0 ? "" : "-") + "$" + Math.abs(Math.round(x)).toLocaleString();

console.log("=== SANITY: 1 tournament, 5000 field, $50 buy-in, 10% rake, +10% ROI ===");
console.log("tournaments:", r.tournamentsPerSample.toLocaleString(), "× samples:", r.samples.toLocaleString());
console.log("total buy-in (per sample):", m(totalBI));
console.log("expected EV (math):      ", m(r.expectedProfit), " realized ROI:", pct(r.expectedProfit / totalBI));
console.log("mean profit:             ", m(s.mean), pct(s.mean / totalBI));
console.log("median:                  ", m(s.median));
console.log("stdDev per-sample:       ", m(s.stdDev));
console.log("stdDev per-tourney:      ", m(s.stdDev / Math.sqrt(r.tournamentsPerSample)));
console.log("itm rate:                ", pct(s.itmRate));
console.log("P(profit):               ", pct(s.probProfit));
console.log("RoR (BR=" + input.bankroll + "):", pct(s.riskOfRuin));
console.log("max DD mean:             ", m(s.maxDrawdownMean));
console.log("max DD worst:            ", m(s.maxDrawdownWorst));
console.log("longest breakeven mean:  ", Math.round(s.longestBreakevenMean), "tourneys");
console.log("longest cashless mean:   ", Math.round(s.longestCashlessMean), "tourneys");
console.log("longest cashless worst:  ", Math.round(s.longestCashlessWorst), "tourneys");
console.log("p05..p95..p99:           ", m(s.p05), " .. ", m(s.p95), " .. ", m(s.p99));
console.log("min / max:               ", m(s.min), "/", m(s.max));
console.log("var95:                   ", m(s.var95));
console.log("cvar95:                  ", m(s.cvar95));
console.log("sharpe:                  ", s.sharpe.toFixed(3));
console.log("elapsed:", dt.toFixed(0), "ms");

// --- Sanity checks ---
const checks: Array<[string, boolean, string]> = [];
const roi = s.mean / totalBI;
checks.push([
  "realized ROI within ±2pp of target (10%)",
  Math.abs(roi - 0.10) < 0.02,
  `got ${pct(roi)}`,
]);
// For a right-skewed top-heavy MTT at +10% ROI over 1k tourneys,
// median < mean is expected — P(profit) in 35–55% is actually honest.
checks.push([
  "P(profit) in honest right-skew band (35–60%)",
  s.probProfit > 0.35 && s.probProfit < 0.60,
  pct(s.probProfit) + " (median " + m(s.median) + " < mean " + m(s.mean) + " — right-skew)",
]);
checks.push([
  "median < mean (right-skew sanity)",
  s.median < s.mean && s.mean > 0,
  `med ${m(s.median)}, mean ${m(s.mean)}`,
]);
checks.push([
  "ITM close to mtt-standard (~15%) — slight lift ok",
  s.itmRate > 0.12 && s.itmRate < 0.22,
  pct(s.itmRate),
]);
checks.push([
  "stdDev positive and < totalBuyIn",
  s.stdDev > 0 && s.stdDev < totalBI,
  m(s.stdDev),
]);
// 100 ABIs on a 5k-field top-heavy MTT is famously underrolled —
// standard advice is 300–500 ABIs. High RoR here is honest.
checks.push([
  "RoR @ 100 ABIs is high (>60%) — honest underroll warning",
  s.riskOfRuin > 0.60,
  pct(s.riskOfRuin),
]);
checks.push([
  "longest breakeven streak in 50–3000 range",
  s.longestBreakevenMean > 50 && s.longestBreakevenMean < 3000,
  `${Math.round(s.longestBreakevenMean)}`,
]);
// p05 is the deep-loss tail — should be very negative, definitely finite
checks.push([
  "p05 is finite and negative",
  Number.isFinite(s.p05) && s.p05 < 0,
  m(s.p05),
]);
checks.push([
  "no NaN/Inf anywhere",
  [
    s.mean, s.median, s.stdDev, s.probProfit, s.riskOfRuin, s.itmRate,
    s.maxDrawdownMean, s.p05, s.p95, s.p99, s.var95, s.cvar95,
    s.longestCashlessMean, s.longestBreakevenMean,
  ].every((v) => Number.isFinite(v)),
  "",
]);
// Per-sample invariant: worst DD observed must be >= worst end-of-run loss.
checks.push([
  "max DD worst >= |min profit| (per-sample invariant)",
  s.maxDrawdownWorst >= Math.abs(Math.min(0, s.min)),
  `DD worst ${m(s.maxDrawdownWorst)} vs |min| ${m(Math.abs(s.min))}`,
]);

console.log("\n=== CHECKS ===");
let allPass = true;
for (const [name, ok, note] of checks) {
  console.log((ok ? "✓" : "✗") + " " + name + (note ? "  → " + note : ""));
  if (!ok) allPass = false;
}
console.log(allPass ? "\nALL GREEN" : "\nSOME CHECKS FAILED");
