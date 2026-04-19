/**
 * Engine perf microbench. Reports wall-clock on a small matrix of
 * schedules (freezeout / PKO / mystery-log-normal / BR). Intentionally
 * local — numbers are one machine / one moment; treat as a sanity
 * bracket, not a benchmark of the engine's absolute throughput.
 *
 * Methodology:
 *   - Warmup pass is not counted.
 *   - Timed runs: BENCH_RUNS (default 15).
 *   - Report mean / median / p95 / stdev, plus throughput in
 *     tournament-units/sec (samples × scheduleRepeats / seconds).
 *   - Accuracy: realized ROI with its standard error SE = sd / √n and
 *     z = (realized − target) / SE. |z| > 2 is suspicious at this budget.
 *
 * Env:
 *   BENCH_SAMPLES (default 10000) — samples per run
 *   BENCH_REPEATS (default 50)    — scheduleRepeats per sample
 *   BENCH_RUNS    (default 15)    — timed runs per scenario
 */
import { runSimulation } from "../src/lib/sim/engine";
import type { SimulationInput, TournamentRow } from "../src/lib/sim/types";

function mkRow(
  payout: TournamentRow["payoutStructure"],
  players: number,
  extras: Partial<TournamentRow> = {},
): TournamentRow {
  return {
    id: `${payout}-${players}`,
    label: `${payout}-${players}`,
    players,
    buyIn: 10,
    rake: 0.1,
    roi: 0.15,
    payoutStructure: payout,
    count: 1,
    ...extras,
  };
}

const SAMPLES = Number(process.env.BENCH_SAMPLES) || 10_000;
const REPEATS = Number(process.env.BENCH_REPEATS) || 50;
const RUNS = Number(process.env.BENCH_RUNS) || 15;

const scenarios: Array<{ name: string; input: SimulationInput }> = [
  {
    name: "freezeout-180",
    input: {
      schedule: [mkRow("mtt-standard", 180)],
      scheduleRepeats: REPEATS,
      samples: SAMPLES,
      bankroll: 1000,
      seed: 42,
      finishModel: { id: "power-law" },
    },
  },
  {
    name: "pko-180",
    input: {
      schedule: [mkRow("mtt-gg-bounty", 180, { bountyFraction: 0.5 })],
      scheduleRepeats: REPEATS,
      samples: SAMPLES,
      bankroll: 1000,
      seed: 42,
      finishModel: { id: "power-law" },
    },
  },
  {
    name: "pko-mystery-noise-500",
    input: {
      schedule: [
        mkRow("mtt-gg-bounty", 500, {
          bountyFraction: 0.5,
          mysteryBountyVariance: 0.9,
        }),
      ],
      scheduleRepeats: REPEATS,
      samples: SAMPLES,
      bankroll: 1000,
      seed: 42,
      finishModel: { id: "power-law" },
    },
  },
  {
    name: "br-180-σ1.8",
    input: {
      schedule: [
        mkRow("battle-royale", 180, {
          bountyFraction: 0.5,
          mysteryBountyVariance: 1.8,
        }),
      ],
      scheduleRepeats: REPEATS,
      samples: SAMPLES,
      bankroll: 1000,
      seed: 42,
      finishModel: { id: "power-law" },
    },
  },
  {
    name: "br-1000-σ1.8",
    input: {
      schedule: [
        mkRow("battle-royale", 1000, {
          bountyFraction: 0.5,
          mysteryBountyVariance: 1.8,
        }),
      ],
      scheduleRepeats: REPEATS,
      samples: SAMPLES,
      bankroll: 1000,
      seed: 42,
      finishModel: { id: "power-law" },
    },
  },
];

function mean(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let v = 0;
  for (const x of xs) v += (x - m) * (x - m);
  return Math.sqrt(v / (xs.length - 1));
}
function percentile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

function pad(s: string | number, n: number): string {
  return String(s).padStart(n);
}

console.log(
  `samples=${SAMPLES}  scheduleRepeats=${REPEATS}  runs=${RUNS} (plus 1 warmup)`,
);
console.log("-".repeat(96));
console.log(
  "scenario".padEnd(22),
  pad("mean(ms)", 9),
  pad("p50", 7),
  pad("p95", 7),
  pad("sd", 6),
  pad("units/s", 10),
  pad("ROI%", 7),
  pad("SE", 6),
  pad("z", 6),
  pad("jp%", 6),
);
console.log("-".repeat(96));

for (const s of scenarios) {
  // Warmup — not timed, not reported.
  runSimulation(s.input);

  const times: number[] = [];
  // Accuracy / jackpot stats from timed runs only.
  const finalProfits: number[] = [];
  let jpHits = 0;
  let jpTotal = 0;
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now();
    const res = runSimulation(s.input);
    times.push(performance.now() - t0);
    for (let i = 0; i < res.finalProfits.length; i++) {
      finalProfits.push(res.finalProfits[i]);
    }
    for (let i = 0; i < res.jackpotMask.length; i++) jpHits += res.jackpotMask[i];
    jpTotal += res.jackpotMask.length;
  }

  const totalCost =
    s.input.schedule[0].buyIn *
    (1 + s.input.schedule[0].rake) *
    REPEATS;
  const meanProfit = mean(finalProfits);
  const sdProfit = stdev(finalProfits);
  const roi = meanProfit / totalCost;
  const seProfit = sdProfit / Math.sqrt(finalProfits.length);
  const seRoi = seProfit / totalCost;
  const target = s.input.schedule[0].roi;
  const z = (roi - target) / seRoi;

  const unitsPerSec = (SAMPLES * REPEATS) / (mean(times) / 1000);
  const jpPct = (100 * jpHits) / jpTotal;

  console.log(
    s.name.padEnd(22),
    pad(mean(times).toFixed(1), 9),
    pad(percentile(times, 0.5).toFixed(1), 7),
    pad(percentile(times, 0.95).toFixed(1), 7),
    pad(stdev(times).toFixed(1), 6),
    pad(unitsPerSec.toFixed(0), 10),
    pad((roi * 100).toFixed(2), 7),
    pad((seRoi * 100).toFixed(3), 6),
    pad(z.toFixed(2), 6),
    pad(jpPct.toFixed(3), 6),
  );
}

console.log("-".repeat(96));
console.log("Determinism — br-180-σ1.8 ×2 with same seed:");
const refScen = scenarios[3].input;
const a = runSimulation(refScen);
const b = runSimulation(refScen);
let fpMatch = true;
for (let i = 0; i < a.finalProfits.length; i++) {
  if (a.finalProfits[i] !== b.finalProfits[i]) {
    fpMatch = false;
    break;
  }
}
let jmMatch = true;
for (let i = 0; i < a.jackpotMask.length; i++) {
  if (a.jackpotMask[i] !== b.jackpotMask[i]) {
    jmMatch = false;
    break;
  }
}
console.log(
  `  finalProfits identical: ${fpMatch}  jackpotMask identical: ${jmMatch}`,
);
console.log(
  "\nNote: numbers are one-machine / one-moment. units/s and p95 are not stable",
);
console.log(
  "across hardware or background load. Use |z| > 2 on ROI as a sanity flag, not",
);
console.log("a strict acceptance gate — sampling noise dominates at this budget.");
