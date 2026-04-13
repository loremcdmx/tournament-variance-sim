import { runSimulation } from "../src/lib/sim/engine.ts";
import type { SimulationInput } from "../src/lib/sim/types.ts";

const input: SimulationInput = {
  schedule: [
    {
      id: "r1",
      players: 500,
      buyIn: 10,
      rake: 0.1,
      roi: 0.2,
      payoutStructure: "mtt-standard",
      count: 1,
    },
  ],
  scheduleRepeats: 200,
  samples: 2_000,
  bankroll: 500,
  seed: 42,
  finishModel: { id: "power-law" },
};

const t0 = performance.now();
const r = runSimulation(input, () => {});
const dt = performance.now() - t0;

console.log("tournaments/sample:", r.tournamentsPerSample);
console.log("samples:", r.samples);
console.log("total buy-in:", r.totalBuyIn.toFixed(2));
console.log("expected profit:", r.expectedProfit.toFixed(2));
console.log("realized ROI:", (r.expectedProfit / r.totalBuyIn).toFixed(4));
console.log("stdDev:", r.stats.stdDev.toFixed(2));
console.log("P(profit):", (r.stats.probProfit * 100).toFixed(1) + "%");
console.log("RoR (BR=500):", (r.stats.riskOfRuin * 100).toFixed(2) + "%");
console.log("max DD mean:", r.stats.maxDrawdownMean.toFixed(2));
console.log("longest breakeven mean:", r.stats.longestBreakevenMean.toFixed(1));
console.log("min / max:", r.stats.min.toFixed(0), "/", r.stats.max.toFixed(0));
console.log(`elapsed: ${dt.toFixed(0)} ms`);
