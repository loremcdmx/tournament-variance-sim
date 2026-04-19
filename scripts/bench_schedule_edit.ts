/**
 * Bench the deferred main-thread work triggered by one keystroke in the
 * schedule editor. `useDeferredValue` keeps the input box responsive, but
 * once React commits the deferred render the browser is blocked on these
 * synchronous memos — so if the total is >50 ms the user feels a "pause"
 * after they stop typing.
 *
 * Stages timed (ordered by what actually runs per keystroke):
 *   1. validateSchedule  — feasibility banner / row highlights.
 *   2. computeRowStats   — FinishPMFPreview α bisection + PMF + tier agg.
 *                          ONE call per keystroke (only the selected row
 *                          is previewed, but the memo rebuilds whenever
 *                          its row object identity changes).
 *
 * Light profile: one simple freezeout row. Represents the default user.
 * Heavy profile: ITM-locked PKO row with 9-place FT payout — exercises
 * the bisection paths `calibrateShelledItm` and `calibrateAlpha`.
 *
 * Env:
 *   BENCH_RUNS (default 50) — timed runs per stage (plus 1 warmup)
 *   BENCH_HEAVY (default 0) — set to 1 to use an ITM-locked PKO row
 */
import { validateSchedule } from "../src/lib/sim/validation";
import {
  buildFinishPMF,
  calibrateAlpha,
  calibrateShelledItm,
} from "../src/lib/sim/finishModel";
import { getPayoutTable } from "../src/lib/sim/payouts";
import type { FinishModelConfig, TournamentRow } from "../src/lib/sim/types";

const RUNS = Number(process.env.BENCH_RUNS) || 50;
const HEAVY = process.env.BENCH_HEAVY === "1";

const previewModel: FinishModelConfig = { id: "power-law" };

const lightRow: TournamentRow = {
  id: "r1",
  label: "regular 500",
  players: 500,
  buyIn: 10,
  rake: 0.1,
  roi: 0.1,
  payoutStructure: "mtt-gg-standard",
  count: 1,
};

const heavyRow: TournamentRow = {
  id: "r1",
  label: "pko-itm-locked",
  players: 1000,
  buyIn: 25,
  rake: 0.08,
  roi: 0.15,
  payoutStructure: "mtt-gg-bounty",
  count: 5,
  bountyFraction: 0.5,
  itmRate: 0.18, // triggers calibrateShelledItm bisection
};

const row = HEAVY ? heavyRow : lightRow;
const schedule: TournamentRow[] = [row];

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

// Replica of computeRowStats's heaviest path without the JSX around it —
// just the calibration + PMF build. If this dominates the bench, FinishPMFPreview
// is worth memoizing by a stable row hash or moving to a worker.
function previewHeavyPath(r: TournamentRow, model: FinishModelConfig): number {
  const N = Math.max(2, Math.floor(r.players));
  const payouts = getPayoutTable(r.payoutStructure, N, r.customPayouts);
  const basePool = r.players * r.buyIn;
  const entryCost = r.buyIn * (1 + r.rake);
  const bountyFraction = Math.max(0, Math.min(0.9, r.bountyFraction ?? 0));
  const bountyPerSeat = r.buyIn * bountyFraction;
  const bountyLift = Math.max(0.1, Math.min(3, (1 + r.rake) * (1 + r.roi)));
  const defaultBountyMean = bountyPerSeat * bountyLift;
  const bountyMean = bountyFraction > 0 ? defaultBountyMean : 0;
  const prizePool = basePool * (1 - bountyFraction);
  const targetRegular = Math.max(0.01, entryCost * (1 + r.roi) - bountyMean);
  const effectiveROI = targetRegular / entryCost - 1;
  if (r.itmRate != null && r.itmRate > 0) {
    const fi = calibrateShelledItm(
      N,
      payouts.reduce((n, p) => (p > 0 ? n + 1 : n), 0),
      payouts,
      prizePool,
      targetRegular,
      r.itmRate,
      r.finishBuckets,
      model,
    );
    return fi.alpha;
  }
  const alpha = calibrateAlpha(
    N,
    payouts,
    prizePool,
    entryCost,
    effectiveROI,
    model,
  );
  buildFinishPMF(N, model, alpha);
  return alpha;
}

console.log(`profile=${HEAVY ? "heavy" : "light"}  row=${row.label}  runs=${RUNS}`);
console.log("-".repeat(70));
console.log(
  "stage".padEnd(30),
  pad("mean(ms)", 9),
  pad("p50", 7),
  pad("p95", 7),
  pad("sd", 6),
);
console.log("-".repeat(70));

type Stage = { name: string; fn: () => void };

const stages: Stage[] = [
  {
    name: "validateSchedule",
    fn: () => {
      validateSchedule(schedule, previewModel);
    },
  },
  {
    name: "computeRowStats heavy path",
    fn: () => {
      previewHeavyPath(row, previewModel);
    },
  },
];

for (const stage of stages) {
  stage.fn();
  const times: number[] = [];
  for (let r = 0; r < RUNS; r++) {
    const t = performance.now();
    stage.fn();
    times.push(performance.now() - t);
  }
  console.log(
    stage.name.padEnd(30),
    pad(mean(times).toFixed(3), 9),
    pad(percentile(times, 0.5).toFixed(3), 7),
    pad(percentile(times, 0.95).toFixed(3), 7),
    pad(stdev(times).toFixed(3), 6),
  );
}

console.log("-".repeat(70));
console.log(
  "Total is the approx post-defer main-thread pause per keystroke.",
);
console.log(
  "Anything >30 ms on the heavy profile is a candidate for memoization",
);
console.log("or worker offload. Light profile should be well under 5 ms.");
