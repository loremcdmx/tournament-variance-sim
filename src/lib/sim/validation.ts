import { calibrateShelledItm } from "./finishModel";
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
 * row. Only rows that actually use itmRate + shell locks can be infeasible;
 * everything else is trivially OK (the α solver clamps silently and PD-
 * binary-itm is always feasible by construction).
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
  schedule.forEach((row, idx) => {
    if (row.itmRate == null || row.itmRate <= 0) return;
    if (!row.finishBuckets) return;
    const hasLock =
      row.finishBuckets.first != null ||
      row.finishBuckets.top3 != null ||
      row.finishBuckets.ft != null;
    if (!hasLock) return;

    const N = Math.max(2, Math.floor(row.players));
    const payouts = getPayoutTable(row.payoutStructure, N, row.customPayouts);
    const paidCount = payouts.reduce((n, p) => (p > 0 ? n + 1 : n), 0);
    const basePool = row.players * row.buyIn;
    const entryCost = row.buyIn * (1 + row.rake);
    const bountyFraction = Math.max(0, Math.min(0.9, row.bountyFraction ?? 0));
    const bountyPerSeat = row.buyIn * bountyFraction;
    const bountyLift = Math.max(0.1, Math.min(3, 1 + row.roi));
    const bountyMean = bountyPerSeat * bountyLift;
    const prizePool = basePool * (1 - bountyFraction);
    const targetRegular = Math.max(0.01, entryCost * (1 + row.roi) - bountyMean);

    const r = calibrateShelledItm(
      N,
      paidCount,
      payouts,
      prizePool,
      targetRegular,
      row.itmRate,
      row.finishBuckets,
      model,
    );
    if (!r.feasible) {
      issues.push({
        rowId: row.id,
        rowIdx: idx,
        label: row.label || `#${idx + 1}`,
        targetEv: targetRegular,
        currentEv: r.currentWinnings,
        gap: r.currentWinnings - targetRegular,
      });
    }
  });
  return { ok: issues.length === 0, issues };
}
