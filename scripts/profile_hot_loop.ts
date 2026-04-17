/**
 * Profiler for engine hot loop. Runs a fixed workload and reports
 * tourneys/sec under several preset conditions so we can measure the
 * effect of optimizations without clicking through the UI.
 */

import { runSimulation } from "../src/lib/sim/engine";
import type { SimulationInput, TournamentRow } from "../src/lib/sim/types";

interface Scenario {
  name: string;
  row: Partial<TournamentRow>;
  samples: number;
  N: number;
}

const SCENARIOS: Scenario[] = [
  {
    name: "freezeout-1k",
    row: { players: 1000, buyIn: 50, rake: 0.1, roi: 0.1 },
    samples: 20_000,
    N: 500,
  },
  {
    name: "re-entry-1k",
    row: {
      players: 1000,
      buyIn: 50,
      rake: 0.1,
      roi: 0.1,
      maxEntries: 3,
      reEntryRate: 0.6,
    },
    samples: 20_000,
    N: 500,
  },
  {
    name: "pko-3k",
    row: {
      players: 3000,
      buyIn: 55,
      rake: 0.09,
      roi: 0.15,
      bountyFraction: 0.5,
      pkoHeat: 0.35,
    },
    samples: 10_000,
    N: 300,
  },
  {
    name: "tilt+shocks",
    row: { players: 500, buyIn: 22, rake: 0.1, roi: 0.05 },
    samples: 20_000,
    N: 500,
  },
];

function buildInput(sc: Scenario): SimulationInput {
  const row: TournamentRow = {
    id: "p",
    label: "p",
    players: 1000,
    buyIn: 50,
    rake: 0.1,
    roi: 0.1,
    payoutStructure: "mtt-standard",
    count: sc.N,
    ...sc.row,
  } as TournamentRow;
  const base: SimulationInput = {
    schedule: [row],
    scheduleRepeats: 1,
    samples: sc.samples,
    bankroll: 0,
    seed: 42,
    finishModel: { id: "power-law" },
    calibrationMode: "alpha",
  };
  if (sc.name === "tilt+shocks") {
    return {
      ...base,
      roiStdErr: 0.05,
      roiShockPerTourney: 0.02,
      tiltFastGain: 0.03,
      tiltFastScale: 500,
      tiltSlowGain: 0.02,
    };
  }
  return base;
}

async function main() {
  console.log("scenario             | samples | N    | ms      | tourneys/sec");
  console.log("-".repeat(70));
  for (const sc of SCENARIOS) {
    const input = buildInput(sc);
    // Warm-up
    runSimulation({ ...input, samples: Math.min(500, sc.samples) });
    const runs = 3;
    let best = Infinity;
    for (let k = 0; k < runs; k++) {
      const t0 = performance.now();
      runSimulation(input);
      const dt = performance.now() - t0;
      if (dt < best) best = dt;
    }
    const totalTourneys = sc.samples * sc.N;
    const tps = (totalTourneys / best) * 1000;
    console.log(
      `${sc.name.padEnd(20)} | ${String(sc.samples).padStart(7)} | ${String(sc.N).padStart(4)} | ${best.toFixed(0).padStart(7)} | ${tps.toExponential(3)}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
