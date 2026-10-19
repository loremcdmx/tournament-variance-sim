/**
 * Pre-run feasibility checks on `TournamentRow`s. Catches inputs that
 * would make α-calibration impossible (target ROI outside the achievable
 * band for the given payout structure + field) and surfaces them to the
 * UI as structured warnings rather than silent clamps. Runs on the main
 * thread before the worker dispatch.
 */
import {
  applyBountyBias,
  calibrateShelledItm,
  cashTargetFloor,
  isAlphaAdjustable,
  targetEvTolerance,
  withinTargetEv,
} from "./finishModel";
import { buildScheduleAnalyticBreakdown } from "./compile";
import {
  clampBountyMean,
  isBattleRoyaleRow,
} from "./bountySplit";
import {
  buildBattleRoyaleCashTargetPmf,
  resolveBattleRoyaleCashTarget,
} from "./battleRoyaleWinnerFirst";
import { fieldVariantSizes } from "./fieldVariants";
import { normalizeGameTypeConsistency } from "./gameType";
import { getPayoutTable } from "./payouts";
import type { FinishModelConfig, TournamentRow } from "./types";

export interface RowFeasibilityIssue {
  reason?: "inconsistent-finish-locks";
  rowId: string;
  rowIdx: number;
  label: string;
  targetEv: number;
  currentEv: number;
  gap: number;
}

export interface ScheduleFeasibility {
  ok: boolean;
  issues: RowFeasibilityIssue[];
}

/**
 * Replicates engine.ts compileSingleEntry's calibration pre-step closely
 * enough to decide feasibility of the fixed-ITM shelled solver for each
 * row. Fixed-ITM rows can be infeasible when explicit shell locks or the
 * solver's equilibrium first-place floor leave no alpha room to hit the
 * requested cash target; everything else is trivially OK (the α solver
 * clamps silently and PD-binary-itm is always feasible by construction).
 * A row with a Field-size range is checked at every field size the engine
 * plays, and reports the size that misses its target the most. A model with no
 * α to move (uniform, empirical, realdata-*) is held to its shell locks only:
 * its shape, not the typed ROI, decides what the row pays.
 *
 * NOTE: this mirrors engine-side math, not sim-side. If engine.ts changes
 * its targetRegular formula (bounty lift, rake convention, overlay), update
 * here too — or the run-blocking banner will disagree with reality.
 */
export function validateSchedule(
  schedule: readonly TournamentRow[],
  model: FinishModelConfig,
): ScheduleFeasibility {
  const issues: RowFeasibilityIssue[] = [];
  schedule.forEach((rawRow, idx) => {
    const row = normalizeGameTypeConsistency(rawRow);
    if (row.itmRate == null || row.itmRate <= 0) {
      if (!isAlphaAdjustable(model)) return;
      const analytic = buildScheduleAnalyticBreakdown({
        schedule: [{ ...row, count: 1 }],
        finishModel: model,
      });
      const meanSingle = analytic?.perRow[0]?.meanSingle;
      const targetEv = row.buyIn * (1 + row.rake) * (1 + row.roi);
      if (meanSingle == null || !Number.isFinite(meanSingle)) return;
      const gap = meanSingle - targetEv;
      if (withinTargetEv(meanSingle, targetEv)) return;
      issues.push({
        rowId: row.id,
        rowIdx: idx,
        label: row.label || `#${idx + 1}`,
        targetEv,
        currentEv: meanSingle,
        gap,
      });
      return;
    }

    // The engine compiles one entry per field-size bucket and pins the same
    // ITM and locks on each, so a small bucket can be unreachable while the
    // nominal field is fine. Report the bucket that misses the most.
    let worst: RowFeasibilityIssue | null = null;
    for (const players of fieldVariantSizes(row)) {
      const issue = fixedItmIssueAtField(
        { ...row, itmRate: row.itmRate, players, fieldVariability: undefined },
        idx,
        model,
      );
      if (issue === null) continue;
      if (issue.reason) {
        worst = issue;
        break;
      }
      if (worst === null || relativeGap(issue) > relativeGap(worst)) worst = issue;
    }
    if (worst !== null) issues.push(worst);
  });
  return { ok: issues.length === 0, issues };
}

function relativeGap(issue: RowFeasibilityIssue): number {
  return Math.abs(issue.gap) / Math.max(1e-9, Math.abs(issue.targetEv));
}

/** The fixed-ITM feasibility check for one row at the field size in `row.players`. */
function fixedItmIssueAtField(
  row: TournamentRow & { itmRate: number },
  idx: number,
  model: FinishModelConfig,
): RowFeasibilityIssue | null {
  const lateRegMult = Math.max(1, row.lateRegMultiplier ?? 1);
  const N = Math.max(2, Math.floor(row.players * lateRegMult));

  const payouts = getPayoutTable(row.payoutStructure, N, row.customPayouts);
  const paidCount = payouts.reduce((n, p) => (p > 0 ? n + 1 : n), 0);
  // The shelled solver normalizes even invalid raw inputs, but a pinned
  // probability must not silently change in an interactive run.
  const ignoresShellLocks = /^(freeze|pko|mystery)-realdata-(step|linear|tilt)$/.test(model.id);
  if (!ignoresShellLocks && row.finishBuckets) {
    const locks = row.finishBuckets;
    const boundaries = [
      [1, locks.first],
      [Math.min(3, paidCount), locks.top3],
      [Math.min(9, paidCount), locks.ft],
      [paidCount, paidCount === N ? 1 : row.itmRate],
    ] as const;
    let previousEnd = 0;
    let previousMass = 0;
    let inconsistent = false;
    for (const [end, mass] of boundaries) {
      if (mass == null) continue;
      if (!Number.isFinite(mass) || mass < previousMass - 1e-9 || mass > 1 ||
          (end === previousEnd && Math.abs(mass - previousMass) > 1e-9)) {
        inconsistent = true;
        break;
      }
      previousEnd = end;
      previousMass = mass;
    }
    // P(top-3) alone pins no layer, so the solver would drop it while the
    // row still validated. It needs P(1st) or P(FT) beside it. With three or
    // fewer paid places the Top-3 shell is the whole ITM band, which the
    // boundary walk above already holds to the row's ITM.
    if (locks.top3 != null && locks.first == null && locks.ft == null && paidCount > 3) {
      inconsistent = true;
    }
    if (inconsistent) {
      const targetEv = row.buyIn * (1 + row.rake) * (1 + row.roi);
      return {
        rowId: row.id, rowIdx: idx, label: row.label || `#${idx + 1}`,
        targetEv, currentEv: targetEv, gap: 0,
        reason: "inconsistent-finish-locks",
      };
    }
  }
  const basePool = N * row.buyIn;
  const overlay = Math.max(0, (row.guarantee ?? 0) - basePool);
  const entryCost = row.buyIn * (1 + row.rake);
  const totalWinningsEV = entryCost * (1 + row.roi);
  const bountyFraction = Math.max(0, Math.min(0.9, row.bountyFraction ?? 0));
  const bias = Math.max(-0.25, Math.min(0.25, row.bountyEvBias ?? 0));
  let bountyMean = 0;
  // Same overlay rule as compileEntry: bounties are carved from the
  // entry-funded pool only; a guarantee top-up stays entirely in cash.
  const prizePool = basePool * (1 - bountyFraction) + overlay;
  let battleRoyaleCenter: {
    pmf: Float64Array;
    cashEV: number;
  } | null = null;
  if (bountyFraction > 0) {
    const bountyPerSeat = row.buyIn * bountyFraction;
    const bountyLift = Math.max(
      0.1,
      Math.min(3, (1 + row.rake) * (1 + row.roi)),
    );
    const defaultBountyMean = bountyPerSeat * bountyLift;
    bountyMean = applyBountyBias(defaultBountyMean, totalWinningsEV, bias);
  }

  if (
    bountyFraction > 0 &&
    isBattleRoyaleRow(row) &&
    row.itmRate != null &&
    row.itmRate > 0
  ) {
    // Mirror engine.ts: BR fixed-ITM exposes the full feasible cash/KO EV
    // interval around a true 50/50 gross-EV midpoint.
    const neutralBountyMean = entryCost * bountyFraction;
    const cashFloor = cashTargetFloor(entryCost);
    const neutralTargetRegular = Math.max(cashFloor, entryCost - neutralBountyMean);
    const neutral = calibrateShelledItm(
      N,
      paidCount,
      payouts,
      prizePool,
      neutralTargetRegular,
      row.itmRate,
      row.finishBuckets,
      model,
      row.itmTopHeavyBias ?? 0,
    );
    const centerCashTarget = Math.max(cashFloor, totalWinningsEV * 0.5);
    const resolvedCash = resolveBattleRoyaleCashTarget({
      N,
      payouts,
      prizePool,
      itmRate: row.itmRate,
      centerCashTarget,
      bias,
      neutralPmf: neutral.pmf,
      neutralWinnings: neutral.currentWinnings,
      finishBuckets: row.finishBuckets,
      preferTopHeavy: row.roi > 0,
      topHeavyBias: row.itmTopHeavyBias ?? 0,
    });
    if (resolvedCash) {
      battleRoyaleCenter = {
        pmf: resolvedCash.centerPmf,
        cashEV: resolvedCash.centerCashEV,
      };
    }
    const desiredCashEV = resolvedCash
      ? resolvedCash.desiredCashEV
      : centerCashTarget;
    bountyMean = clampBountyMean(totalWinningsEV - desiredCashEV, totalWinningsEV);
  }
  const targetRegular = Math.max(cashTargetFloor(entryCost), totalWinningsEV - bountyMean);

  const winnerFirst = isBattleRoyaleRow(row) && battleRoyaleCenter
    ? buildBattleRoyaleCashTargetPmf({
        N,
        payouts,
        prizePool,
        itmRate: row.itmRate,
        targetWinnings: targetRegular,
        anchorPmf: battleRoyaleCenter.pmf,
        anchorWinnings: battleRoyaleCenter.cashEV,
        finishBuckets: row.finishBuckets,
        preferTopHeavy: row.roi > 0,
        topHeavyBias: row.itmTopHeavyBias ?? 0,
      })
    : null;
  const r = winnerFirst ?? calibrateShelledItm(
    N,
    paidCount,
    payouts,
    prizePool,
    targetRegular,
    row.itmRate,
    row.finishBuckets,
    model,
    row.itmTopHeavyBias ?? 0,
  );
  const residualCanCloseTotal =
    bountyFraction > 0 &&
    r.currentWinnings <= totalWinningsEV + targetEvTolerance(totalWinningsEV);
  const feasible = r.feasible || residualCanCloseTotal;
  if (!feasible) {
    const targetEv = bountyFraction > 0 ? totalWinningsEV : targetRegular;
    const currentEv =
      bountyFraction > 0
        ? r.currentWinnings + Math.max(0, totalWinningsEV - r.currentWinnings)
        : r.currentWinnings;
    return {
      rowId: row.id,
      rowIdx: idx,
      label: row.label || `#${idx + 1}`,
      targetEv,
      currentEv,
      gap: currentEv - targetEv,
    };
  }
  return null;
}
