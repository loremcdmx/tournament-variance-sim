import { runSimulation } from "../src/lib/sim/engine";
import type { SimulationInput, TournamentRow } from "../src/lib/sim/types";

const row: TournamentRow = {
  id: "r",
  label: "coin-mini 500/10+1 ROI100",
  players: 500,
  buyIn: 10,
  rake: 1 / 11,
  roi: 1.0,
  payoutStructure: "mtt-gg",
  count: 10_000,
};

const base: SimulationInput = {
  schedule: [row],
  scheduleRepeats: 1,
  samples: 10_000,
  bankroll: 1000,
  seed: 42,
  finishModel: { id: "power-law" },
};

const alphaInput: SimulationInput = { ...base, calibrationMode: "alpha" };
const pdInput: SimulationInput = {
  ...base,
  calibrationMode: "primedope-binary-itm",
  usePrimedopePayouts: true,
  usePrimedopeFinishModel: true,
  usePrimedopeRakeMath: true,
};

const a = runSimulation(alphaInput);
const p = runSimulation(pdInput);

console.log("LEFT  alpha      :", {
  ev: a.stats.mean.toFixed(1),
  sd: a.stats.stdDev.toFixed(1),
});
console.log("RIGHT binary-ITM :", {
  ev: p.stats.mean.toFixed(1),
  sd: p.stats.stdDev.toFixed(1),
});
console.log("sd ratio ours/pd:", (a.stats.stdDev / p.stats.stdDev).toFixed(3));
