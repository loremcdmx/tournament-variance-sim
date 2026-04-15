/**
 * PokerDope parity matrix.
 *
 * Each scenario is configured to match PD's UI exactly: explicit
 * "Places paid" taken from their dropdown, their default sample size
 * (10000), and primedope-binary-itm calibration so the finish model
 * matches their Distribution object.
 *
 * We pre-resample the PD h[8] payout curve to the chosen paid count via
 * customPayouts — that removes any ambiguity about what our engine uses
 * vs. what the dropdown value implies.
 */

import { runSimulation } from "../src/lib/sim/engine";
import type { SimulationInput, TournamentRow } from "../src/lib/sim/types";

// PD's h[8] reference table — exact 15-slot curve from tmp_legacy.js.
const PD_H8 = [
  0.255, 0.16, 0.115, 0.09, 0.075, 0.06, 0.045, 0.035, 0.03, 0.025, 0.025,
  0.025, 0.02, 0.02, 0.02,
];

// Resample the 15-slot curve to `paid` slots via piecewise-linear CDF
// interpolation — same algorithm PD uses internally for non-15 paid counts.
function pdCurveAt(paid: number): number[] {
  if (paid === PD_H8.length) return PD_H8.slice();
  const srcCum: number[] = new Array(PD_H8.length + 1);
  srcCum[0] = 0;
  for (let i = 0; i < PD_H8.length; i++) srcCum[i + 1] = srcCum[i] + PD_H8[i];
  const total = srcCum[PD_H8.length];
  const sampleCum = (t: number): number => {
    const x = t * PD_H8.length;
    const lo = Math.floor(x);
    if (lo >= PD_H8.length) return total;
    const frac = x - lo;
    return srcCum[lo] + frac * (srcCum[lo + 1] - srcCum[lo]);
  };
  const out = new Array<number>(paid);
  let sum = 0;
  for (let i = 0; i < paid; i++) {
    const a = sampleCum(i / paid);
    const b = sampleCum((i + 1) / paid);
    out[i] = b - a;
    sum += out[i];
  }
  // Normalize to exactly 1 (guard float drift).
  for (let i = 0; i < paid; i++) out[i] /= sum;
  return out;
}

interface Scenario {
  name: string;
  players: number;
  placesPaid: number; // MUST be selected from PD's dropdown exactly
  buyIn: number;
  rakePct: number; // percent, as shown in PD UI
  roiPct: number; // percent, as shown in PD UI
  number: number; // "Number" field — tournaments played
  bankroll: number;
}

// Each scenario uses a paid count that's known to exist in PD's dropdown
// for its field size (confirmed against the 45p screenshot and standard
// 15%-rule breakpoints). Natural 15% paid: 45→6, 100→15, 200→30, 500→75,
// 1000→150. All are round multiples of 5 at/above 10 players, matching
// PD's dropdown step pattern.
const scenarios: Scenario[] = [
  {
    name: "S1 baseline 100p",
    players: 100,
    placesPaid: 15,
    buyIn: 50,
    rakePct: 11,
    roiPct: 10,
    number: 1000,
    bankroll: 1000,
  },
  {
    name: "S2 small 45p    ",
    players: 45,
    placesPaid: 6,
    buyIn: 30,
    rakePct: 10,
    roiPct: 15,
    number: 500,
    bankroll: 500,
  },
  {
    name: "S3 mid 200p     ",
    players: 200,
    placesPaid: 30,
    buyIn: 20,
    rakePct: 10,
    roiPct: 10,
    number: 1000,
    bankroll: 500,
  },
  {
    name: "S4 large 500p   ",
    players: 500,
    placesPaid: 75,
    buyIn: 10,
    rakePct: 10,
    roiPct: 10,
    number: 1000,
    bankroll: 300,
  },
  {
    name: "S5 high rake    ",
    players: 100,
    placesPaid: 15,
    buyIn: 25,
    rakePct: 20,
    roiPct: 5,
    number: 1000,
    bankroll: 500,
  },
  {
    name: "S6 break-even   ",
    players: 200,
    placesPaid: 30,
    buyIn: 50,
    rakePct: 10,
    roiPct: 0,
    number: 500,
    bankroll: 1000,
  },
  {
    name: "S7 losing -5%   ",
    players: 500,
    placesPaid: 75,
    buyIn: 20,
    rakePct: 10,
    roiPct: -5,
    number: 1000,
    bankroll: 500,
  },
  {
    name: "S8 high ROI 25% ",
    players: 100,
    placesPaid: 15,
    buyIn: 100,
    rakePct: 10,
    roiPct: 25,
    number: 200,
    bankroll: 2000,
  },
];

function runScenario(sc: Scenario) {
  const row: TournamentRow = {
    id: "r",
    label: sc.name,
    players: sc.players,
    buyIn: sc.buyIn,
    rake: sc.rakePct / 100,
    roi: sc.roiPct / 100,
    payoutStructure: "custom",
    customPayouts: pdCurveAt(sc.placesPaid),
    count: sc.number,
  };
  const input: SimulationInput = {
    schedule: [row],
    scheduleRepeats: 1,
    samples: 10_000, // match PD's default sample size
    bankroll: sc.bankroll,
    seed: 42,
    finishModel: { id: "power-law" },
    calibrationMode: "primedope-binary-itm",
  };
  return runSimulation(input);
}

const fmt = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 0 }).padStart(9);

console.log(
  "name              #players  Places  Buyin  Rake%  ROI%  Number  |        EV         SD     RoR50%     RoR5%     RoR1%",
);
console.log(
  "------------------+--------+-------+------+------+-----+-------+----------+----------+----------+---------+---------",
);
for (const sc of scenarios) {
  const r = runScenario(sc);
  const s = r.stats;
  const setup =
    `${String(sc.players).padStart(6)}` +
    `  ${String(sc.placesPaid).padStart(5)}` +
    `  $${String(sc.buyIn).padStart(3)}` +
    `  ${String(sc.rakePct).padStart(4)}%` +
    `  ${String(sc.roiPct).padStart(3)}%` +
    `  ${String(sc.number).padStart(5)}`;
  console.log(
    `${sc.name} ${setup}  | ${fmt(s.mean)} ${fmt(s.stdDev)} ${fmt(
      s.minBankrollRoR50pct ?? 0,
    )} ${fmt(s.minBankrollRoR5pct)} ${fmt(s.minBankrollRoR1pct)}`,
  );
}

console.log();
console.log(
  "Our numbers: 10,000 MC samples, primedope-binary-itm mode, PD h[8] payout curve resampled to the exact Places paid.",
);
