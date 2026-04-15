import { runSimulation } from "../src/lib/sim/engine";
import type { SimulationInput, TournamentRow } from "../src/lib/sim/types";

const row: TournamentRow = {
  id: "r",
  players: 5000,
  buyIn: 50,
  rake: 0.11,
  roi: 0.15,
  payoutStructure: "mtt-standard",
  count: 1000,
  maxEntries: 2,
  reentryRate: 1,
};
const base: SimulationInput = {
  schedule: [row],
  scheduleRepeats: 100,
  samples: 5000,
  bankroll: 1000,
  seed: 42,
  finishModel: { id: "power-law" },
};

const fmt$ = (v: number) => `$${Math.round(v).toLocaleString()}`;
const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;

function row2(tag: string, r: ReturnType<typeof runSimulation>) {
  const roi = r.expectedProfit / r.totalBuyIn;
  console.log(
    `${tag.padEnd(38)} mean=${fmt$(r.stats.mean).padStart(12)}  sd=${fmt$(r.stats.stdDev).padStart(11)}  roi=${fmtPct(roi)}  itm=${fmtPct(r.stats.itmRate)}  totalBuyIn=${fmt$(r.totalBuyIn)}`,
  );
}

console.log("== Isolating which PD flag drives the SD gap ==\n");

const alpha = runSimulation({ ...base, calibrationMode: "alpha" });
row2("alpha (baseline mtt-standard)", alpha);

// PD with all defaults-on (= the UI twin run)
const pdDefault = runSimulation({ ...base, calibrationMode: "primedope-binary-itm" });
row2("pd default (all flags on)", pdDefault);

// PD but with mtt-standard payouts (isolate finish model + rake math only)
const pdStdPayouts = runSimulation({
  ...base,
  calibrationMode: "primedope-binary-itm",
  usePrimedopePayouts: false,
});
row2("pd + mtt-standard payouts", pdStdPayouts);

// PD, mtt-standard, rakeMath off
const pdNoRakeMath = runSimulation({
  ...base,
  calibrationMode: "primedope-binary-itm",
  usePrimedopePayouts: false,
  usePrimedopeRakeMath: false,
});
row2("pd + stdPayouts + no rakeMath", pdNoRakeMath);

// PD, mtt-standard, finishModel off (should approach alpha)
const pdNoFinish = runSimulation({
  ...base,
  calibrationMode: "primedope-binary-itm",
  usePrimedopePayouts: false,
  usePrimedopeRakeMath: false,
  usePrimedopeFinishModel: false,
});
row2("pd + stdPayouts + no rake + no finish", pdNoFinish);
