/**
 * Bench the synchronous work on the main thread between `onRun()` click
 * and the first shard dispatch. This is the gap where the "Запустить"
 * button has already been pressed but the bar hasn't budged yet — if
 * anything in the list below is slow, the bar visibly lags the click.
 *
 * Phases timed:
 *   1. validateSchedule  — feasibility check (α bisection per row for
 *                          finishBuckets rows).
 *   2. buildInput        — pure object construction.
 *   3. computeBatchKey   — JSON.stringify(input with seed=0). Shape is
 *                          empiricalBuckets (up to 500k ints) + schedule.
 *                          One call per click.
 *   4. buildPasses       — mostly object spreads.
 *   5. compileSchedule   — compiles every row × variants; includes
 *                          calibrateAlpha for finishBuckets rows.
 *                          NOTE: no longer main-thread — happens inside
 *                          the worker on shard dispatch. Kept here as a
 *                          reference for what a regression would cost.
 *   6. makeCheckpointGrid — grid setup per pass. Same — worker-side now.
 *   7. shard-slot setup  — O(W × oversub) slot bookkeeping.
 *
 * Env:
 *   BENCH_RUNS  (default 30) — timed runs per phase (plus 1 warmup)
 *   BENCH_BIG   (default 0)  — set to 1 to use a heavy input (big
 *                              empiricalBuckets + 10 rows + 20 scheduleRepeats)
 */
import { compileSchedule, makeCheckpointGrid } from "../src/lib/sim/engine";
import { validateSchedule } from "../src/lib/sim/validation";
import type {
  ControlsState as _ControlsState,
  SimulationInput,
  TournamentRow,
  FinishModelId,
} from "../src/lib/sim/types";

const RUNS = Number(process.env.BENCH_RUNS) || 30;
const BIG = process.env.BENCH_BIG === "1";

interface ControlsLite {
  scheduleRepeats: number;
  samples: number;
  bankroll: number;
  seed: number;
  finishModelId: FinishModelId;
  alphaOverride: number | null;
  compareWithPrimedope: boolean;
  usePrimedopePayouts: boolean;
  usePrimedopeFinishModel: boolean;
  usePrimedopeRakeMath: boolean;
  compareMode: "random" | "primedope";
  modelPresetId: string;
  roiStdErr: number;
  roiShockPerTourney: number;
  roiShockPerSession: number;
  roiDriftSigma: number;
  tiltFastGain: number;
  tiltFastScale: number;
  tiltSlowGain: number;
  tiltSlowThreshold: number;
  tiltSlowMinDuration: number;
  tiltSlowRecoveryFrac: number;
  rakebackPct: number;
  empiricalBuckets?: number[];
}

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

const controlsBase: ControlsLite = {
  scheduleRepeats: BIG ? 20 : 50,
  samples: 10_000,
  bankroll: 1000,
  seed: 42,
  finishModelId: "power-law",
  alphaOverride: null,
  compareWithPrimedope: BIG,
  usePrimedopePayouts: true,
  usePrimedopeFinishModel: true,
  usePrimedopeRakeMath: true,
  compareMode: "random",
  modelPresetId: "default",
  roiStdErr: 0,
  roiShockPerTourney: 0,
  roiShockPerSession: 0,
  roiDriftSigma: 0,
  tiltFastGain: 0,
  tiltFastScale: 0,
  tiltSlowGain: 0,
  tiltSlowThreshold: 0,
  tiltSlowMinDuration: 0,
  tiltSlowRecoveryFrac: 0,
  rakebackPct: 0,
};

const schedule: TournamentRow[] = BIG
  ? Array.from({ length: 10 }, (_, i) =>
      mkRow("mtt-gg-bounty", 500 + i * 100, { bountyFraction: 0.5 }),
    )
  : [mkRow("mtt-gg-bounty", 500, { bountyFraction: 0.5 })];

// Replicates page.tsx buildInput.
function buildInput(s: TournamentRow[], c: ControlsLite): SimulationInput {
  return {
    schedule: s,
    scheduleRepeats: c.scheduleRepeats,
    samples: c.samples,
    bankroll: c.bankroll,
    seed: 42,
    finishModel: {
      id: c.finishModelId,
      alpha: c.alphaOverride ?? undefined,
      empiricalBuckets:
        c.finishModelId === "empirical" ? c.empiricalBuckets : undefined,
    },
    compareWithPrimedope: c.compareWithPrimedope,
    usePrimedopePayouts: c.usePrimedopePayouts,
    usePrimedopeFinishModel: c.usePrimedopeFinishModel,
    usePrimedopeRakeMath: c.usePrimedopeRakeMath,
    compareMode: c.compareMode,
    modelPresetId: c.modelPresetId,
    roiStdErr: c.roiStdErr,
    roiShockPerTourney: c.roiShockPerTourney,
    roiShockPerSession: c.roiShockPerSession,
    roiDriftSigma: c.roiDriftSigma,
    tiltFastGain: c.tiltFastGain,
    tiltFastScale: c.tiltFastScale,
    tiltSlowGain: c.tiltSlowGain,
    tiltSlowThreshold: c.tiltSlowThreshold,
    tiltSlowMinDuration: c.tiltSlowMinDuration,
    tiltSlowRecoveryFrac: c.tiltSlowRecoveryFrac,
    rakebackFracOfRake: c.rakebackPct / 100,
  };
}

// Replicates useSimulation.computeBatchKey.
function computeBatchKey(input: SimulationInput): string {
  const rest = { ...input, seed: 0 };
  return JSON.stringify(rest);
}

// Replicates useSimulation.buildPasses (primary branch only — twin pass
// is structurally identical cost).
function buildPasses(input: SimulationInput) {
  const twin = !!input.compareWithPrimedope;
  const passes = [
    {
      key: "primary" as const,
      input: { ...input, compareWithPrimedope: false },
      calibrationMode: "alpha" as const,
      weight: twin ? 0.5 : 1,
    },
  ];
  if (twin) {
    passes.push({
      key: "comparison" as unknown as "primary",
      input: { ...input, compareWithPrimedope: false },
      calibrationMode: "alpha" as const,
      weight: 0.5,
    });
  }
  return passes;
}

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

const previewModel = {
  id: controlsBase.finishModelId,
  alpha: controlsBase.alphaOverride ?? undefined,
  empiricalBuckets:
    controlsBase.finishModelId === "empirical"
      ? controlsBase.empiricalBuckets
      : undefined,
};
const input = buildInput(schedule, controlsBase);
const passes = buildPasses(input);

console.log(
  `profile=${BIG ? "heavy" : "light"}  rows=${schedule.length}  repeats=${controlsBase.scheduleRepeats}  runs=${RUNS}`,
);
console.log("-".repeat(76));
console.log(
  "phase".padEnd(30),
  pad("mean(ms)", 9),
  pad("p50", 7),
  pad("p95", 7),
  pad("sd", 6),
  pad("size", 10),
);
console.log("-".repeat(76));

const phases: Array<{
  name: string;
  fn: () => unknown;
  /** optional descriptor of the work size */
  size?: () => string;
}> = [
  {
    name: "validateSchedule",
    fn: () => validateSchedule(schedule, previewModel),
  },
  {
    name: "buildInput",
    fn: () => buildInput(schedule, controlsBase),
  },
  {
    name: "computeBatchKey (JSON.stringify)",
    fn: () => computeBatchKey(input),
    size: () => `${computeBatchKey(input).length}ch`,
  },
  {
    name: "buildPasses",
    fn: () => buildPasses(input),
  },
  {
    name: "compileSchedule × passes",
    fn: () => {
      for (const p of passes) compileSchedule({ ...p.input, calibrationMode: p.calibrationMode }, p.calibrationMode);
    },
  },
  {
    name: "makeCheckpointGrid × passes",
    fn: () => {
      for (const p of passes) {
        const compiled = compileSchedule({ ...p.input, calibrationMode: p.calibrationMode }, p.calibrationMode);
        makeCheckpointGrid(compiled.tournamentsPerSample);
      }
    },
  },
];

for (const ph of phases) {
  ph.fn();
  const times: number[] = [];
  for (let r = 0; r < RUNS; r++) {
    const t = performance.now();
    ph.fn();
    times.push(performance.now() - t);
  }
  console.log(
    ph.name.padEnd(30),
    pad(mean(times).toFixed(3), 9),
    pad(percentile(times, 0.5).toFixed(3), 7),
    pad(percentile(times, 0.95).toFixed(3), 7),
    pad(stdev(times).toFixed(3), 6),
    pad(ph.size ? ph.size() : "-", 10),
  );
}

console.log("-".repeat(76));
// Main-thread click→dispatch budget is now ONLY the phases that actually
// run on the UI thread: validateSchedule + buildInput + computeBatchKey +
// buildPasses. compileSchedule and makeCheckpointGrid moved to the worker
// as of the #93 fix — re-measuring them here is a regression canary.
const mainThreadPhases = new Set([
  "validateSchedule",
  "buildInput",
  "computeBatchKey (JSON.stringify)",
  "buildPasses",
]);
const totalClickSync = phases.reduce((acc, ph) => {
  if (!mainThreadPhases.has(ph.name)) return acc;
  const times: number[] = [];
  for (let r = 0; r < 5; r++) {
    const t = performance.now();
    ph.fn();
    times.push(performance.now() - t);
  }
  return acc + mean(times);
}, 0);
console.log(
  `Sync main-thread work click→first shard dispatch: ${totalClickSync.toFixed(1)} ms`,
);
console.log(
  "Worker startup is NOT in this budget — the pool is spawned on mount,",
);
console.log(
  "so shard postMessage is effectively instant from here. compileSchedule",
);
console.log(
  "and makeCheckpointGrid now happen worker-side; they're listed above for",
);
console.log("regression tracking only.");
