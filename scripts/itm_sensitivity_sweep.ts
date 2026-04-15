/**
 * ITM sensitivity sweep at fixed ROI.
 *
 * Hypothesis: PokerDope's ITM% is a cosmetic parameter — its finish model
 * ignores the width of the money bubble, so σ(profit/ABI) stays flat as
 * ITM% moves at fixed ROI. Our honest alpha-calibrated model should show
 * a clear monotone drop in σ as ITM widens (more frequent cashes → lower
 * variance of banked profit).
 *
 * Method: single scenario, identical PD payout curve resampled to each
 * placesPaid target, two calibration modes, two horizons. We diff σ at
 * each ITM level against the 18.7% baseline (matches user's UI screen).
 */

import { runSimulation } from "../src/lib/sim/engine";
import type { SimulationInput, TournamentRow } from "../src/lib/sim/types";

const PD_H8 = [
  0.255, 0.16, 0.115, 0.09, 0.075, 0.06, 0.045, 0.035, 0.03, 0.025, 0.025,
  0.025, 0.02, 0.02, 0.02,
];

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
  for (let i = 0; i < paid; i++) out[i] /= sum;
  return out;
}

const PLAYERS = 1000;
const BUYIN = 20;
const RAKE = 0.1;
const ROI = 1.0; // 100%
const SAMPLES = 1500;
const SEED = 42;
const BANKROLL = 50_000;

const ITM_TARGETS = [0.15, 0.187, 0.23, 0.28, 0.33];
const HORIZONS = [10_000, 50_000];
const MODES: Array<{ key: "alpha" | "pd"; label: string }> = [
  { key: "alpha", label: "HONEST (alpha)" },
  { key: "pd", label: "PD FAITHFUL    " },
];

interface RunOut {
  mode: string;
  horizon: number;
  itmTarget: number;
  paid: number;
  placesPct: number;
  meanAbi: number;
  sdAbi: number;
  realizedItm: number;
}

function runOne(
  mode: "alpha" | "pd",
  horizon: number,
  itmTarget: number,
): RunOut {
  const paid = Math.max(1, Math.round(PLAYERS * itmTarget));
  const curve = pdCurveAt(paid);
  const row: TournamentRow = {
    id: "r",
    label: `itm${paid}`,
    players: PLAYERS,
    buyIn: BUYIN,
    rake: RAKE,
    roi: ROI,
    payoutStructure: "custom",
    customPayouts: curve,
    count: horizon,
  };
  const input: SimulationInput = {
    schedule: [row],
    scheduleRepeats: 1,
    samples: SAMPLES,
    bankroll: BANKROLL,
    seed: SEED,
    finishModel: { id: "power-law" },
    calibrationMode: mode === "pd" ? "primedope-binary-itm" : "alpha",
    // Isolate the finish-model effect: force both modes onto identical
    // payouts (our pdCurveAt resample) and identical rake math. Without
    // these flags the PD branch swaps in `primedopeCurveForPaid` and its
    // prize-pool = buyin*(1-rake) convention, conflating three variables.
    ...(mode === "pd"
      ? { usePrimedopePayouts: false, usePrimedopeRakeMath: false }
      : {}),
  };
  const r = runSimulation(input);
  const abi = BUYIN * (1 + RAKE);
  return {
    mode,
    horizon,
    itmTarget,
    paid,
    placesPct: paid / PLAYERS,
    meanAbi: r.stats.mean / abi,
    sdAbi: r.stats.stdDev / abi,
    realizedItm: r.stats.itmRate,
  };
}

console.log(
  `\nITM sensitivity sweep — ROI=${(ROI * 100) | 0}%, field=${PLAYERS}, buy-in=$${BUYIN}, rake=${(RAKE * 100) | 0}%`,
);
console.log(
  `samples=${SAMPLES}  seed=${SEED}  (same PD payout curve resampled per ITM)`,
);
console.log();

const results: RunOut[] = [];
for (const mode of MODES) {
  for (const horizon of HORIZONS) {
    console.log(
      `[${mode.label}] horizon=${horizon.toLocaleString()} tournaments`,
    );
    console.log(
      "  ITM target  paid   realized ITM    mean (ABI)    σ (ABI)    Δσ vs 18.7%",
    );
    console.log(
      "  ----------  -----  ------------    ----------   ---------   -----------",
    );
    const rows = ITM_TARGETS.map((itm) => runOne(mode.key, horizon, itm));
    const baseline = rows.find((r) => r.itmTarget === 0.187)!.sdAbi;
    for (const r of rows) {
      const delta = (r.sdAbi / baseline - 1) * 100;
      const deltaStr =
        r.itmTarget === 0.187
          ? "   (base)"
          : `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}%`;
      console.log(
        `  ${(r.itmTarget * 100).toFixed(1).padStart(6)}%    ${String(r.paid).padStart(4)}    ${(r.realizedItm * 100).toFixed(2).padStart(6)}%        ${r.meanAbi.toFixed(1).padStart(8)}    ${r.sdAbi.toFixed(1).padStart(7)}     ${deltaStr}`,
      );
      results.push(r);
    }
    console.log();
  }
}

// Verdict: σ ratio max/min per mode at horizon=50k.
console.log("=== VERDICT @ horizon=50,000 ===");
for (const mode of MODES) {
  const rows = results.filter(
    (r) => r.mode === mode.key && r.horizon === 50_000,
  );
  const sds = rows.map((r) => r.sdAbi);
  const maxSd = Math.max(...sds);
  const minSd = Math.min(...sds);
  const ratio = maxSd / minSd;
  const spread = ((maxSd - minSd) / minSd) * 100;
  console.log(
    `  ${mode.label}: σ range ${minSd.toFixed(1)} → ${maxSd.toFixed(1)} ABI (spread ${spread.toFixed(1)}%, ratio ×${ratio.toFixed(3)})`,
  );
}
console.log();
console.log(
  "If PD spread ≈ 0% → ITM is cosmetic in PD (hypothesis confirmed).",
);
console.log(
  "If honest spread > PD spread → our model responds to ITM as expected.",
);
