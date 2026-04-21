/**
 * Pre-run feasibility checks on `TournamentRow`s. Catches inputs that
 * would make α-calibration impossible (target ROI outside the achievable
 * band for the given payout structure + field) and surfaces them to the
 * UI as structured warnings rather than silent clamps. Runs on the main
 * thread before the worker dispatch.
 */
import { applyBountyBias, calibrateShelledItm } from "./finishModel";
import {
  clampBountyMean,
  isBattleRoyaleRow,
} from "./bountySplit";
import {
  buildBattleRoyaleCashTargetPmf,
  resolveBattleRoyaleCashTarget,
} from "./battleRoyaleWinnerFirst";
import { normalizeBrMrConsistency } from "./gameType";
import { getPayoutTable } from "./payouts";
import type { FinishModelConfig, TournamentRow } from "./types";

export interface RowFeasibilityIssue {
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
    const row = normalizeBrMrConsistency(rawRow);
    if (row.itmRate == null || row.itmRate <= 0) return;

    const lateRegMult = Math.max(1, row.lateRegMultiplier ?? 1);
    const N = Math.max(2, Math.floor(row.players * lateRegMult));

    const maxEntries = Math.max(1, Math.floor(row.maxEntries ?? 1));
    const reRate = Math.max(
      0,
      Math.min(1, row.reentryRate ?? (maxEntries > 1 ? 1 : 0)),
    );
    let reentryExpected = 0;
    if (maxEntries > 1 && reRate > 0) {
      if (reRate === 1) {
        reentryExpected = maxEntries - 1;
      } else {
        const M = maxEntries - 1;
        reentryExpected = (reRate * (1 - Math.pow(reRate, M))) / (1 - reRate);
      }
    }

    const payouts = getPayoutTable(row.payoutStructure, N, row.customPayouts);
    const paidCount = payouts.reduce((n, p) => (p > 0 ? n + 1 : n), 0);
    const effectiveSeats = N * (1 + reentryExpected);
    const basePool = effectiveSeats * row.buyIn;
    const overlay = Math.max(0, (row.guarantee ?? 0) - basePool);
    const entryCost = row.buyIn * (1 + row.rake);
    const totalWinningsEV = entryCost * (1 + row.roi);
    const bountyFraction = Math.max(0, Math.min(0.9, row.bountyFraction ?? 0));
    const bias = Math.max(-0.25, Math.min(0.25, row.bountyEvBias ?? 0));
    let bountyMean = 0;
    let prizePool = basePool + overlay;
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
      prizePool = prizePool * (1 - bountyFraction);
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
      const neutralTargetRegular = Math.max(0.01, entryCost - neutralBountyMean);
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
      const centerCashTarget = Math.max(0.01, totalWinningsEV * 0.5);
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
    const targetRegular = Math.max(0.01, totalWinningsEV - bountyMean);

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
      bountyFraction > 0 && r.currentWinnings <= totalWinningsEV + 1e-3;
    const feasible = r.feasible || residualCanCloseTotal;
    if (!feasible) {
      const targetEv = bountyFraction > 0 ? totalWinningsEV : targetRegular;
      const currentEv =
        bountyFraction > 0
          ? r.currentWinnings + Math.max(0, totalWinningsEV - r.currentWinnings)
          : r.currentWinnings;
      issues.push({
        rowId: row.id,
        rowIdx: idx,
        label: row.label || `#${idx + 1}`,
        targetEv,
        currentEv,
        gap: currentEv - targetEv,
      });
    }
  });
  return { ok: issues.length === 0, issues };
}
