/**
 * Prototype of the "fixed ITM rate" model the user proposed:
 *   - ITM rate is a user-supplied constant (say 16% for a decent grinder)
 *   - Distribution over non-paid places: uniform (no-skill there)
 *   - Distribution over paid places: concentrated toward top via a
 *     power-law on [1..paid], calibrated so E[W] = cost × (1+ROI)
 *   - No edge comes from "cashing more often" — only from "running deeper
 *     when cashing"
 *
 * Lets us answer: at ROI +10/20/50% on 100p and 900p, with ITM fixed at
 * say 16%, what does the per-place distribution look like? Does P(1st)
 * stay small as the user expects?
 */

import { primedopeCurveForPaid } from "../src/lib/sim/pdCurves";

interface Scenario {
  label: string;
  players: number;
  placesPaid: number;
  buyIn: number;
  rakePct: number;
  itmRate: number;
}

// All scenarios keep paid ≈ 15% of field (realistic MTT payout schedule).
// Paid counts are from PD's dropdown where possible.
const scenarios: Scenario[] = [
  { label: "100p   / paid=15  ", players: 100,   placesPaid: 15,  buyIn: 10, rakePct: 10, itmRate: 0.16 },
  { label: "500p   / paid=75  ", players: 500,   placesPaid: 75,  buyIn: 10, rakePct: 10, itmRate: 0.16 },
  { label: "1000p  / paid=150 ", players: 1000,  placesPaid: 150, buyIn: 10, rakePct: 10, itmRate: 0.16 },
  { label: "2000p  / paid=300 ", players: 2000,  placesPaid: 300, buyIn: 10, rakePct: 10, itmRate: 0.16 },
  { label: "5000p  / paid=700 ", players: 5000,  placesPaid: 700, buyIn: 10, rakePct: 10, itmRate: 0.16 },
];

const rois = [0.1, 0.2, 0.5];

/**
 * Power-law PMF over PAID places only: p_i ∝ i^{-α} for i in 1..paid,
 * normalized to sum to 1. α=0 → uniform within band (= PD's model).
 * Higher α → more concentrated at top of paid band.
 */
function powerLawWithinBand(paid: number, alpha: number): Float64Array {
  const out = new Float64Array(paid);
  let s = 0;
  for (let i = 1; i <= paid; i++) {
    const v = Math.pow(i, -alpha);
    out[i - 1] = v;
    s += v;
  }
  for (let i = 0; i < paid; i++) out[i] /= s;
  return out;
}

function expectedWinningsGivenCash(
  withinBandPmf: Float64Array,
  curve: number[],
  prizePoolPostRake: number,
): number {
  let ew = 0;
  for (let i = 0; i < withinBandPmf.length; i++) {
    ew += withinBandPmf[i] * curve[i] * prizePoolPostRake;
  }
  return ew;
}

/**
 * Binary search α so that itmRate × E[W|cash] = target E[W].
 * Returns {alpha, withinBandPmf}. If target cannot be hit at α=0 (too low)
 * or α=8 (too high), returns the closest bound.
 */
function calibrateWithinBand(
  paid: number,
  curve: number[],
  prizePoolPostRake: number,
  itmRate: number,
  targetEW: number,
): { alpha: number; pmf: Float64Array } {
  const targetGivenCash = targetEW / itmRate;
  // E[W|cash] bounds: α=-5 concentrates on worst paid place, α=8 on best
  const lo = -5;
  const hi = 8;
  const ewLo = expectedWinningsGivenCash(
    powerLawWithinBand(paid, lo),
    curve,
    prizePoolPostRake,
  );
  const ewHi = expectedWinningsGivenCash(
    powerLawWithinBand(paid, hi),
    curve,
    prizePoolPostRake,
  );
  if (targetGivenCash <= ewLo) return { alpha: lo, pmf: powerLawWithinBand(paid, lo) };
  if (targetGivenCash >= ewHi) return { alpha: hi, pmf: powerLawWithinBand(paid, hi) };
  let a = lo, b = hi;
  for (let iter = 0; iter < 60; iter++) {
    const m = (a + b) / 2;
    const ew = expectedWinningsGivenCash(powerLawWithinBand(paid, m), curve, prizePoolPostRake);
    if (ew < targetGivenCash) a = m;
    else b = m;
  }
  return { alpha: (a + b) / 2, pmf: powerLawWithinBand(paid, (a + b) / 2) };
}

const pct = (n: number, d = 2) => (n * 100).toFixed(d) + "%";
const bucketMass = (pmf: Float64Array, from: number, toIncl: number) => {
  let s = 0;
  for (let i = from - 1; i < toIncl && i < pmf.length; i++) s += pmf[i];
  return s;
};

console.log("=".repeat(110));
console.log("FIXED-ITM model: user-supplied ITM rate, skill = concentration WITHIN cashed band only");
console.log("=".repeat(110));

for (const sc of scenarios) {
  const { players: N, placesPaid: paid, buyIn, rakePct, itmRate } = sc;
  const curve = primedopeCurveForPaid(paid);
  const pool = N * buyIn;
  const poolPost = pool * (1 - rakePct / 100);
  const cost = buyIn * (1 + rakePct / 100);
  const noSkillFieldITM = paid / N;

  console.log(
    `\n━━━ ${sc.label} ━━━ cost=$${cost.toFixed(2)}  pool_post=$${poolPost}  field-avg ITM=${pct(noSkillFieldITM, 1)} ━━━`,
  );

  const ftEnd = Math.min(9, N);
  const top1 = 1;
  const mincashFrom = Math.max(1, paid - Math.floor(paid / 3) + 1);
  const buckets: Array<{ label: string; from: number; to: number }> = [
    { label: "1st", from: 1, to: 1 },
    { label: "top-3", from: 1, to: 3 },
    { label: `FT (1-${ftEnd})`, from: 1, to: ftEnd },
    { label: `top-1% (1-${Math.max(1, Math.round(N * 0.01))})`, from: 1, to: Math.max(1, Math.round(N * 0.01)) },
    { label: `ITM total`, from: 1, to: paid },
    { label: "minCash", from: mincashFrom, to: paid },
  ];

  console.log(
    `\n            ${"model".padEnd(14)}` +
      buckets.map((b) => b.label.padStart(11)).join("  ") +
      `   ${"α".padStart(7)}   EW|cash`,
  );
  // no-skill row: ITM=paid/N, uniform within band
  const nskWithinBand = new Float64Array(paid).fill(1 / paid);
  const nskPmf = new Float64Array(N);
  for (let i = 0; i < paid; i++) nskPmf[i] = noSkillFieldITM / paid;
  for (let i = paid; i < N; i++) nskPmf[i] = (1 - noSkillFieldITM) / (N - paid);
  const nskEWCash = expectedWinningsGivenCash(nskWithinBand, curve, poolPost);
  console.log(
    `            ${"no-skill".padEnd(14)}` +
      buckets
        .map((b) => pct(bucketMass(nskPmf, b.from, b.to)).padStart(11))
        .join("  ") +
      `   ${"—".padStart(7)}   $${nskEWCash.toFixed(0)}`,
  );

  for (const roi of rois) {
    const targetEW = cost * (1 + roi);
    const { alpha, pmf: withinBand } = calibrateWithinBand(
      paid,
      curve,
      poolPost,
      itmRate,
      targetEW,
    );
    // Assemble full PMF over 1..N: paid slots get withinBand × itmRate, rest uniform (1-itmRate)/(N-paid)
    const pmf = new Float64Array(N);
    for (let i = 0; i < paid; i++) pmf[i] = withinBand[i] * itmRate;
    for (let i = paid; i < N; i++) pmf[i] = (1 - itmRate) / (N - paid);
    const ewCash = expectedWinningsGivenCash(withinBand, curve, poolPost);
    const label = `ROI +${roi * 100}%`;
    console.log(
      `            ${label.padEnd(14)}` +
        buckets
          .map((b) => pct(bucketMass(pmf, b.from, b.to)).padStart(11))
          .join("  ") +
        `   ${alpha.toFixed(3).padStart(7)}   $${ewCash.toFixed(0)}`,
    );
  }
}

console.log();
console.log("=".repeat(110));
console.log("Read: at ITM=16% fixed, a +20% ROI player has P(1st) ≈ ?? on 100p");
console.log("      — skill ONLY shows up in how deep they run WHEN they cash.");
console.log("      ITM rate does NOT move with ROI because user fixed it.");
console.log("=".repeat(110));
