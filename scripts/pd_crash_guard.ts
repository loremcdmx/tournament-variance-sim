/**
 * Replay PokerDope's 4 crash vectors through our engine to confirm
 * none of them blow up the way PD's PHP backend does.
 *
 * Each probe runs a very small sim (samples=500, N=200) just to force
 * compilation + a few iterations of the hot loop.
 */
import { runSimulation } from "../src/lib/sim/engine";
import type { SimulationInput, TournamentRow } from "../src/lib/sim/types";

const base: TournamentRow = {
  id: "r",
  label: "pd-crash",
  players: 100,
  buyIn: 50,
  rake: 0.11,
  roi: 0.1,
  payoutStructure: "mtt-primedope",
  count: 200,
};
const wrap = (row: TournamentRow): SimulationInput => ({
  schedule: [row],
  scheduleRepeats: 1,
  samples: 500,
  bankroll: 1000,
  seed: 42,
  finishModel: { id: "power-law" },
  calibrationMode: "primedope-binary-itm",
  primedopeStyleEV: true,
});

interface Vector {
  name: string;
  row: TournamentRow;
}
const vectors: Vector[] = [
  {
    name: "V1 ROI overflow (+566 %)",
    row: { ...base, roi: 5.66 },
  },
  {
    name: "V2 fractional buy-in $0.01",
    row: { ...base, buyIn: 0.01 },
  },
  {
    name: "V3 places_paid == players (custom 100 seats)",
    row: {
      ...base,
      players: 10,
      payoutStructure: "custom",
      customPayouts: new Array(10).fill(0.1),
    },
  },
  {
    name: "V4 rake = 100 %",
    row: { ...base, rake: 1 },
  },
];

let pass = 0;
for (const v of vectors) {
  try {
    const r = runSimulation(wrap(v.row));
    const ev = r.stats.mean.toFixed(0);
    const sd = r.stats.stdDev.toFixed(0);
    console.log(`  ok  ${v.name.padEnd(50)} EV=${ev} SD=${sd}`);
    pass++;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ERR ${v.name.padEnd(50)} ${msg}`);
  }
}
console.log(`\n${pass}/${vectors.length} survived`);
process.exit(pass === vectors.length ? 0 : 1);
