/**
 * Bench the post-hoc rakeback pipeline that fires when the user types in
 * the rakeback input or switches schedule/repeats. ResultsView runs three
 * heavy memos in series behind `useDeferredValue`:
 *
 *   1. `computeExpectedRakebackCurve` — linear scan of the schedule × x grid.
 *   2. `shiftResultByRakeback` — .map(shiftArr) over ~1000 hi-res paths,
 *      histogram CDF recompute, and…
 *   3. `aggregateStreaks` — the real cost: O(S · n²/stride²) chord scan
 *      per path with a closure `get()` that rewrites every read when
 *      `rbShift != null`.
 *
 * We run realistic shapes (the first ~1000 samples' hi-res trajectories,
 * ~10k checkpoints per path is the upper end). Numbers are wall-clock on
 * one machine; read as orientation for which stage dominates, not as
 * portable throughput.
 *
 * Env:
 *   BENCH_SAMPLES (default 10000) — samples (hi-res is first min(1000, S))
 *   BENCH_REPEATS (default 50)    — scheduleRepeats
 *   BENCH_RUNS    (default 8)     — timed runs per stage (warmup not counted)
 */
import { runSimulation } from "../src/lib/sim/engine";
import { aggregateStreaks } from "../src/lib/sim/pathStreaks";
import type { SimulationInput, TournamentRow } from "../src/lib/sim/types";

const SAMPLES = Number(process.env.BENCH_SAMPLES) || 10_000;
const REPEATS = Number(process.env.BENCH_REPEATS) || 50;
const RUNS = Number(process.env.BENCH_RUNS) || 8;

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

const input: SimulationInput = {
  schedule: [mkRow("mtt-gg-bounty", 500, { bountyFraction: 0.5 })],
  scheduleRepeats: REPEATS,
  samples: SAMPLES,
  bankroll: 1000,
  seed: 42,
  finishModel: { id: "power-law" },
};

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
console.log("Running engine to get a realistic SimulationResult…");
const t0 = performance.now();
const res = runSimulation(input);
console.log(`engine: ${(performance.now() - t0).toFixed(0)} ms`);
console.log(
  `paths.length=${res.samplePaths.paths.length}  x.length=${res.samplePaths.x.length}`,
);
console.log("-".repeat(72));
console.log(
  "stage".padEnd(32),
  pad("mean(ms)", 9),
  pad("p50", 7),
  pad("p95", 7),
  pad("sd", 7),
);
console.log("-".repeat(72));

// Build a realistic RB shift curve (linear, matches the deterministic
// rakebackBonusPerBullet accumulation ResultsView does).
const hiX = res.samplePaths.x;
const rbCurve = new Float64Array(hiX.length);
// Rakeback curve scales with tournaments played: ~ 0.3 × row.rake × row.buyIn × k
// where k is tournament index. Use hiX values (already in tournament units).
for (let i = 0; i < hiX.length; i++) {
  rbCurve[i] = 0.3 * 0.1 * 10 * hiX[i];
}
const signedCurve = new Float64Array(rbCurve.length);
for (let i = 0; i < rbCurve.length; i++) signedCurve[i] = -rbCurve[i];

type Stage = {
  name: string;
  fn: () => void;
};

const stages: Stage[] = [
  {
    name: "aggregateStreaks (rb=null)",
    fn: () => {
      aggregateStreaks(res.samplePaths.paths, hiX, null);
    },
  },
  {
    name: "aggregateStreaks (rb shifted)",
    fn: () => {
      aggregateStreaks(res.samplePaths.paths, hiX, signedCurve);
    },
  },
  {
    name: "shiftArr over all paths",
    fn: () => {
      const out: Float64Array[] = [];
      for (const p of res.samplePaths.paths) {
        const len = p.length;
        const shifted = new Float64Array(len);
        const K = Math.min(len, rbCurve.length);
        for (let i = 0; i < K; i++) shifted[i] = p[i] + rbCurve[i];
        for (let i = K; i < len; i++) shifted[i] = p[i];
        out.push(shifted);
      }
      // Use the result so the compiler can't DCE it.
      if (out.length > 0 && out[0].length > 0) {
        void out[0][0];
      }
    },
  },
  {
    name: "envelope shiftArr (10 arrays)",
    fn: () => {
      const envs = [
        res.envelopes.mean,
        res.envelopes.p05,
        res.envelopes.p95,
        res.envelopes.p15,
        res.envelopes.p85,
        res.envelopes.p025,
        res.envelopes.p975,
        res.envelopes.p0015,
        res.envelopes.p9985,
        res.envelopes.min,
        res.envelopes.max,
      ];
      for (const a of envs) {
        const len = a.length;
        const out = new Float64Array(len);
        const K = Math.min(len, rbCurve.length);
        for (let i = 0; i < K; i++) out[i] = a[i] + rbCurve[i];
        for (let i = K; i < len; i++) out[i] = a[i];
        void out[0];
      }
    },
  },
  {
    name: "histogram CDF recompute",
    fn: () => {
      const totalShift = rbCurve[rbCurve.length - 1];
      const shiftedHistEdges = res.histogram.binEdges.map((e) => e + totalShift);
      const totalCount = res.histogram.counts.reduce((a, c) => a + c, 0) || 1;
      let cumBelow = 0;
      for (let i = 0; i < res.histogram.counts.length; i++) {
        const lo = shiftedHistEdges[i];
        const hi = shiftedHistEdges[i + 1];
        const c = res.histogram.counts[i];
        if (hi <= 0) cumBelow += c;
        else if (lo < 0) cumBelow += c * ((0 - lo) / (hi - lo));
      }
      void (1 - cumBelow / totalCount);
    },
  },
];

for (const stage of stages) {
  stage.fn(); // warmup, not timed
  const times: number[] = [];
  for (let r = 0; r < RUNS; r++) {
    const t = performance.now();
    stage.fn();
    times.push(performance.now() - t);
  }
  console.log(
    stage.name.padEnd(32),
    pad(mean(times).toFixed(1), 9),
    pad(percentile(times, 0.5).toFixed(1), 7),
    pad(percentile(times, 0.95).toFixed(1), 7),
    pad(stdev(times).toFixed(1), 7),
  );
}

console.log("-".repeat(72));
console.log(
  "Read: the column that dominates is where a keystroke in the rakeback",
);
console.log(
  "input blocks. `useDeferredValue` hides it from the input frame but the",
);
console.log(
  "total wall-clock between click and visible update is the sum of the",
);
console.log("above (minus any unused branches for the default-off PD pane).");
