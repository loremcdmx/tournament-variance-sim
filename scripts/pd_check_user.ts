import { runSimulation } from "../src/lib/sim/engine";
import type { SimulationInput, TournamentRow } from "../src/lib/sim/types";

const row: TournamentRow = {
  id: "r", label: "PD-repro", players: 2000, buyIn: 10,
  rake: 0.10, roi: 0.20, payoutStructure: "mtt-standard", count: 10000,
};
const input: SimulationInput = {
  schedule: [row], scheduleRepeats: 1, samples: 10000,
  bankroll: 1000, seed: 42, finishModel: { id: "power-law" },
  compareWithPrimedope: true,
  usePrimedopePayouts: true,
  usePrimedopeFinishModel: true,
  usePrimedopeRakeMath: true,
};
const r = runSimulation(input);
console.log("primary EV/SD:", r.stats.mean.toFixed(0), r.stats.stdDev.toFixed(0));
if (r.comparison) {
  console.log("comparison (PD pane) EV/SD:", r.comparison.stats.mean.toFixed(0), r.comparison.stats.stdDev.toFixed(0));
}
console.log("PD site says: EV=20000 SD(math)=12030 SD(sim)=11936");
