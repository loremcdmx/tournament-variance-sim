/**
 * Profiler for engine hot loop. Runs a fixed workload and reports
 * tourneys/sec under several preset conditions so we can measure the
 * effect of optimizations without clicking through the UI.
 */

import { SCENARIOS as DEMOS } from "../src/lib/scenarios";
import { runSimulation } from "../src/lib/sim/engine";
import { STANDARD_PRESETS, applyModelPatch } from "../src/lib/sim/modelPresets";
import type { SimulationInput, TournamentRow } from "../src/lib/sim/types";
import { buildSimulationInput } from "../src/lib/ui/simulationInput";

interface Scenario {
  name: string;
  row: Partial<TournamentRow>;
  samples: number;
  N: number;
  /** A built-in model preset, sent the way Run sends it: tilt depths in dollars, windows set. */
  preset?: "realistic-solo" | "steady-reg";
  /** Unsets the tilt windows: the all-time extremes an engine API caller gets. */
  allTime?: boolean;
}

// 3000 tournaments, so both windows (250 and 1000) roll over several times: a
// run no longer than its window is a single block of the window code.
const TILT_ROW: Partial<TournamentRow> = { players: 500, buyIn: 22, rake: 0.1, roi: 0.05 };

const SCENARIOS: Scenario[] = [
  {
    name: "freezeout-1k",
    row: { players: 1000, buyIn: 50, rake: 0.1, roi: 0.1 },
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
  { name: "solo-tilt", row: TILT_ROW, samples: 4_000, N: 3_000, preset: "realistic-solo" },
  { name: "solo-tilt-all-time", row: TILT_ROW, samples: 4_000, N: 3_000, preset: "realistic-solo", allTime: true },
  { name: "steady-tilt", row: TILT_ROW, samples: 4_000, N: 3_000, preset: "steady-reg" },
  { name: "steady-tilt-all-time", row: TILT_ROW, samples: 4_000, N: 3_000, preset: "steady-reg", allTime: true },
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
  if (sc.preset) {
    const preset = STANDARD_PRESETS.find((p) => p.id === sc.preset)!;
    const controls = applyModelPatch(
      { ...DEMOS[0].controls, scheduleRepeats: 1, samples: sc.samples, seed: 42 },
      preset.patch,
      preset.id,
    );
    const input = buildSimulationInput([row], controls, true);
    return sc.allTime ? { ...input, tiltFastWindow: undefined, tiltSlowWindow: undefined } : input;
  }
  return {
    schedule: [row],
    scheduleRepeats: 1,
    samples: sc.samples,
    bankroll: 0,
    seed: 42,
    finishModel: { id: "power-law" },
    calibrationMode: "alpha",
  };
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
