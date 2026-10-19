import { compileSchedule, runSimulation } from "../src/lib/sim/engine";
import type { SimulationInput, TournamentRow } from "../src/lib/sim/types";

const row: TournamentRow = {
  id: "r", label: "PD-repro", players: 2000, buyIn: 10,
  rake: 0.10, roi: 0.20, payoutStructure: "mtt-standard", count: 10000,
};
const input: SimulationInput = {
  schedule: [row], scheduleRepeats: 1, samples: 10000,
  bankroll: 1000, seed: 42, finishModel: { id: "power-law" },
  primedopeStyleEV: true,
  usePrimedopePayouts: true,
  usePrimedopeFinishModel: true,
  usePrimedopeRakeMath: true,
};
// One calibration per engine call: the primary pane is the alpha run, the PD
// pane is a second call with the binary-ITM calibration.
const pdInput: SimulationInput = { ...input, calibrationMode: "primedope-binary-itm" };
const r = runSimulation({ ...input, calibrationMode: "alpha" });
const pd = runSimulation(pdInput);
const pdExact = compileSchedule(pdInput, "primedope-binary-itm");
console.log("primary EV/SD:", r.stats.mean.toFixed(0), r.stats.stdDev.toFixed(0));
console.log("comparison (PD pane) exact EV / MC mean / SD:", pdExact.expectedProfit.toFixed(0), pd.stats.mean.toFixed(0), pd.stats.stdDev.toFixed(0));
console.log("PD site says: EV=20000 SD(math)=12030 SD(sim)=11936");
