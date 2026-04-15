/**
 * Skill-shape sweep: isolate the finish-model contribution to σ.
 *
 * Fix the payout curve (PD h[8] resampled to 187 paid) and the field
 * (1000 players). Sweep ROI across {0, 10, 25, 50, 100}%. At each ROI,
 * run PD binary-ITM (uniform-in-money) and our alpha (power-law
 * concentrated on top). The σ gap shows exactly how much PD undercounts
 * top-heavy variance when skill rises — payouts are identical, paid is
 * identical, only the finish PMF shape differs.
 *
 * Bonus readout: the σ gap at ROI=0 is the null-control (both models
 * should agree: no skill → no top concentration). At ROI=100% the gap
 * should be at its widest.
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
const PAID = 187; // fixed — 18.7% ITM
const BUYIN = 20;
const RAKE = 0.1;
const SAMPLES = 1500;
const SEED = 42;
const BANKROLL = 50_000;
const HORIZON = 50_000;
const CURVE = pdCurveAt(PAID);
const ROIS = [0, 0.1, 0.25, 0.5, 1.0];

interface RunOut {
  mode: "alpha" | "pd";
  roi: number;
  meanAbi: number;
  sdAbi: number;
  realizedItm: number;
}

function runOne(mode: "alpha" | "pd", roi: number): RunOut {
  const row: TournamentRow = {
    id: "r",
    label: `roi${roi}`,
    players: PLAYERS,
    buyIn: BUYIN,
    rake: RAKE,
    roi,
    payoutStructure: "custom",
    customPayouts: CURVE,
    count: HORIZON,
  };
  const input: SimulationInput = {
    schedule: [row],
    scheduleRepeats: 1,
    samples: SAMPLES,
    bankroll: BANKROLL,
    seed: SEED,
    finishModel: { id: "power-law" },
    calibrationMode: mode === "pd" ? "primedope-binary-itm" : "alpha",
    ...(mode === "pd"
      ? { usePrimedopePayouts: false, usePrimedopeRakeMath: false }
      : {}),
  };
  const r = runSimulation(input);
  const abi = BUYIN * (1 + RAKE);
  return {
    mode,
    roi,
    meanAbi: r.stats.mean / abi,
    sdAbi: r.stats.stdDev / abi,
    realizedItm: r.stats.itmRate,
  };
}

console.log(
  `\nSkill-shape sweep — fixed payouts (PD h[8] @ ${PAID} paid, 18.7% ITM), field=${PLAYERS}, buy-in=$${BUYIN}, rake=${(RAKE * 100) | 0}%`,
);
console.log(
  `samples=${SAMPLES}  horizon=${HORIZON.toLocaleString()}  seed=${SEED}\n`,
);

console.log(
  "ROI %    | HONEST σ (ABI)  PD σ (ABI)   σ ratio (H/PD)   HONEST ITM   PD ITM",
);
console.log(
  "---------|--------------   ----------   --------------   ----------   --------",
);

const rows: { roi: number; h: RunOut; p: RunOut }[] = [];
for (const roi of ROIS) {
  const h = runOne("alpha", roi);
  const p = runOne("pd", roi);
  const ratio = h.sdAbi / p.sdAbi;
  console.log(
    `  ${(roi * 100).toFixed(0).padStart(3)}%   |    ${h.sdAbi.toFixed(1).padStart(7)}      ${p.sdAbi.toFixed(1).padStart(7)}     ×${ratio.toFixed(3).padStart(6)}       ${(h.realizedItm * 100).toFixed(2).padStart(6)}%     ${(p.realizedItm * 100).toFixed(2).padStart(6)}%`,
  );
  rows.push({ roi, h, p });
}

console.log(
  "\n=== Interpretation ===\n" +
    "ROI=0% row is the null control: no skill, both models should agree.\n" +
    "Growing ratio with ROI = alpha concentrates skill on the top-of-money,\n" +
    "where PD binary-ITM spreads it uniformly across all cash slots.",
);

const null0 = rows.find((r) => r.roi === 0)!;
const top = rows.find((r) => r.roi === 1.0)!;
const nullRatio = null0.h.sdAbi / null0.p.sdAbi;
const topRatio = top.h.sdAbi / top.p.sdAbi;
console.log(
  `\nNull control σ ratio @ ROI=0%:  ×${nullRatio.toFixed(3)}   (should be ≈1)`,
);
console.log(
  `Max-skill σ ratio @ ROI=100%:   ×${topRatio.toFixed(3)}   (skill premium)`,
);
console.log(
  `Implied "PD undercounts σ by":  ${((topRatio - 1) * 100).toFixed(1)}% at ROI=100%`,
);
