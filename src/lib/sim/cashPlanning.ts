/**
 * Closed-form Cash-game planning math: sample-size confidence bands,
 * "Prove edge vs 0" volume calculator, and finite-horizon Brownian first-passage
 * Risk of Ruin / bankroll sizing.
 *
 * Pure TS (no React, no clock/random) — safe in `src/lib/sim/`.
 * Reuses `ciToZ` (`convergenceMath.ts`) and `normalCdf` (`simNumerics.ts`) so
 * MTT and Cash planning share identical normal-theory quantiles.
 */
import { compileStakeSchedule } from "./cashEngine";
import type { CashInput } from "./cashTypes";
import { ciToZ } from "./convergenceMath";
import { normalCdf } from "./simNumerics";

export const CASH_PLANNING_DISTANCES = [
  10_000,
  25_000,
  50_000,
  100_000,
  250_000,
  500_000,
  1_000_000,
] as const;

export const CASH_PROVE_EDGE_WRS = [1, 2, 3, 4, 5, 7, 10] as const;

export interface CashEffectiveSummary {
  effectiveWrBb100: number;
  effectiveSdBb100: number;
  wrPerHand: number;
  varPerHand: number;
  totalRakeBb: number;
  totalRbBb: number;
  expectedEvBb: number;
  expectedEvUsd: number;
  hourlyEvUsd?: number;
}

export function cashEffectiveSummary(input: CashInput): CashEffectiveSummary {
  const { rows } = compileStakeSchedule(input);
  let expectedEvBb = 0;
  let totalVarianceBb2 = 0;
  let totalRakeBb = 0;
  let totalRbBb = 0;
  for (const r of rows) {
    expectedEvBb += (r.driftPerHand + r.rbPerHand) * r.rowHands;
    totalVarianceBb2 += r.rowHands * r.sdPerHand * r.sdPerHand;
    totalRakeBb += r.totalRakeRefBb;
    totalRbBb += r.totalRbRefBb;
  }
  const hands = Math.max(1, input.hands);
  const wrPerHand = expectedEvBb / hands;
  const varPerHand = totalVarianceBb2 / hands;
  const expectedEvUsd = expectedEvBb * input.bbSize;
  const hourlyEvUsd = input.hoursBlock
    ? (expectedEvUsd / hands) * input.hoursBlock.handsPerHour
    : undefined;
  return {
    effectiveWrBb100: wrPerHand * 100,
    effectiveSdBb100: Math.sqrt(Math.max(0, varPerHand)) * 10,
    wrPerHand,
    varPerHand,
    totalRakeBb,
    totalRbBb,
    expectedEvBb,
    expectedEvUsd,
    hourlyEvUsd,
  };
}

export interface CashConvergenceRow {
  hands: number;
  expectedEvBb: number;
  halfWidthBb100: number;
  loBb100: number;
  hiBb100: number;
  probProfit: number;
}

/**
 * Exact normal-theory confidence interval for observed winrate over each
 * hand distance: `wr ± z · sd / √(hands / 100)`.
 */
export function computeCashConvergenceRows(
  wrBb100: number,
  sdBb100: number,
  confidencePct: number,
  distances: readonly number[] = CASH_PLANNING_DISTANCES,
): CashConvergenceRow[] {
  const z = ciToZ(Math.min(0.999, Math.max(0.5, confidencePct / 100)));
  const sd = Math.max(0, sdBb100);
  return distances.map((hands) => {
    const blocks = Math.max(0.01, hands / 100);
    const se = sd / Math.sqrt(blocks);
    const halfWidthBb100 = z * se;
    const probProfit =
      se <= 0 ? (wrBb100 > 0 ? 1 : 0) : normalCdf(wrBb100 / se);
    return {
      hands,
      expectedEvBb: wrBb100 * blocks,
      halfWidthBb100,
      loBb100: wrBb100 - halfWidthBb100,
      hiBb100: wrBb100 + halfWidthBb100,
      probProfit,
    };
  });
}

export interface CashProveEdgeRow {
  wrBb100: number;
  /** Hands needed so a true `wrBb100` clears the two-sided zero bar with probability `max(50%, C)`. */
  handsRequired: number;
  /** Hours required when `handsPerHour > 0`, else null. */
  hoursRequired: number | null;
  /** Minimum bankroll (BB) for 5% asymptotic RoR at this WR and SD. */
  bankroll5pctBb: number;
  /** Minimum bankroll (BB) for 1% asymptotic RoR at this WR and SD. */
  bankroll1pctBb: number;
}

/**
 * Exact normal-theory sample size to distinguish true `wr` from 0 at
 * confidence `C` (matching MTT `proveEdge.ts`):
 *   z_sig = Φ⁻¹((1 + C)/2)
 *   z_pow = max(0, Φ⁻¹(C))
 *   hands = ceil(100 · ((z_sig + z_pow) · sd / |wr|)²)
 */
export function computeCashProveEdgeRows(
  sdBb100: number,
  confidencePct: number,
  handsPerHour?: number,
  candidateWrs: readonly number[] = CASH_PROVE_EDGE_WRS,
): CashProveEdgeRow[] {
  const cFrac = Math.min(0.999, Math.max(0.5, confidencePct / 100));
  const zSig = ciToZ(cFrac);
  const zPow = cFrac > 0.5 ? ciToZ(2 * cFrac - 1) : 0;
  const sd = Math.max(0, sdBb100);
  const varPer100 = sd * sd;
  return candidateWrs.map((wrBb100) => {
    const absWr = Math.abs(wrBb100);
    const handsRequired =
      absWr <= 0 || sd <= 0
        ? absWr <= 0
          ? Infinity
          : 100
        : Math.ceil(100 * (((zSig + zPow) * sd) / absWr) ** 2);
    const hoursRequired =
      handsPerHour && handsPerHour > 0 && Number.isFinite(handsRequired)
        ? handsRequired / handsPerHour
        : null;
    const bankrollFor = (alpha: number) =>
      wrBb100 <= 0
        ? Infinity
        : varPer100 <= 0
          ? 0
          : (-varPer100 * Math.log(alpha)) / (2 * wrBb100);
    return {
      wrBb100,
      handsRequired,
      hoursRequired,
      bankroll5pctBb: bankrollFor(0.05),
      bankroll1pctBb: bankrollFor(0.01),
    };
  });
}

/**
 * Exact finite-horizon Brownian first-passage Risk of Ruin:
 *   P(min_{t <= H} B(t) <= -B) = Φ((-B - μH)/(σ√H)) + exp(-2μB/σ²) Φ((-B + μH)/(σ√H))
 * Uses the same numerically stable Mills/erfc split as MTT `resultStats.ts`.
 */
export function cashFiniteHorizonRor(
  bankrollBb: number,
  wrPerHand: number,
  varPerHand: number,
  hands: number,
): number {
  if (bankrollBb <= 0) return 1;
  if (hands <= 0) return 0;
  if (varPerHand <= 0) return wrPerHand * hands <= -bankrollBb ? 1 : 0;
  const sigma = Math.sqrt(varPerHand * hands);
  const a = (-bankrollBb - wrPerHand * hands) / sigma;
  const b = (-bankrollBb + wrPerHand * hands) / sigma;
  const expArg = (-2 * wrPerHand * bankrollBb) / varPerHand;
  let reflected: number;
  if (b < -8) {
    const inv = 1 / (b * b);
    const mills =
      1 - inv + 3 * inv ** 2 - 15 * inv ** 3 + 105 * inv ** 4 - 945 * inv ** 5;
    reflected =
      (Math.exp(-0.5 * a * a) * mills) / (-b * Math.sqrt(2 * Math.PI));
  } else if (b < 0) {
    const t = 1 / (1 + 0.3275911 * (-b / Math.SQRT2));
    const erfcFactor =
      ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
        0.284496736) *
        t +
        0.254829592) *
      t;
    reflected = 0.5 * erfcFactor * Math.exp(-0.5 * a * a);
  } else {
    reflected = Math.exp(expArg) * normalCdf(b);
  }
  return Math.min(1, Math.max(0, normalCdf(a) + reflected));
}
