import { inferGameType } from "./gameType";
import { applyItmTarget, type ItmTargetConfig } from "./itmTarget";
import { validateSchedule, type RowFeasibilityIssue } from "./validation";
import type { FinishModelConfig, TournamentRow } from "./types";

type FixKind = "match-roi" | "clear-locks" | "grinder";

export interface FeasibilityFixChoice {
  kind: FixKind;
  row: TournamentRow;
}

const ROI_MIN = -0.99;
const ROI_MAX = 100;

function clampRoi(v: number): number | null {
  if (!Number.isFinite(v)) return null;
  return Math.max(ROI_MIN, Math.min(ROI_MAX, v));
}

function rowForValidation(row: TournamentRow, itmTargetCfg: ItmTargetConfig): TournamentRow {
  return applyItmTarget([row], itmTargetCfg)[0] ?? row;
}

function candidatePasses(
  row: TournamentRow,
  model: FinishModelConfig,
  itmTargetCfg: ItmTargetConfig,
): boolean {
  return validateSchedule([rowForValidation(row, itmTargetCfg)], model).ok;
}

function changeScore(base: TournamentRow, next: TournamentRow): number {
  let score = 0;
  score += Math.abs((next.roi ?? 0) - (base.roi ?? 0)) * 100;
  if ((base.itmRate ?? null) !== (next.itmRate ?? null)) score += 30;
  if (base.finishBuckets !== next.finishBuckets) score += 18;
  return score;
}

/**
 * Pick the smallest one-click edit that makes a blocked row feasible.
 * The first candidate preserves the user's locked finish shape and moves ROI
 * to the EV the current shape can actually produce. Fallback candidates relax
 * locks only when that is closer or the ROI candidate still fails.
 */
export function chooseClosestFeasibilityFix(
  row: TournamentRow,
  issue: RowFeasibilityIssue,
  model: FinishModelConfig,
  itmTargetCfg: ItmTargetConfig,
): FeasibilityFixChoice {
  const candidates: FeasibilityFixChoice[] = [];
  const entryCost = row.buyIn * (1 + row.rake);
  const matchedRoi =
    entryCost > 0 ? clampRoi(issue.currentEv / entryCost - 1) : null;
  if (matchedRoi !== null) {
    candidates.push({ kind: "match-roi", row: { ...row, roi: matchedRoi } });
  }

  const gt = inferGameType(row);
  const isBountyEnvelope =
    gt === "mystery" || gt === "mystery-royale" || gt === "pko";
  candidates.push({
    kind: "clear-locks",
    row: isBountyEnvelope
      ? { ...row, itmRate: undefined, finishBuckets: undefined }
      : { ...row, finishBuckets: undefined },
  });
  candidates.push({
    kind: "clear-locks",
    row: { ...row, itmRate: undefined, finishBuckets: undefined },
  });
  if (!isBountyEnvelope) {
    candidates.push({
      kind: "grinder",
      row: { ...row, itmRate: 0.16, finishBuckets: undefined },
    });
  }

  const viable = candidates.filter((candidate) =>
    candidatePasses(candidate.row, model, itmTargetCfg),
  );
  if (viable.length === 0) return candidates[0] ?? { kind: "clear-locks", row };
  return viable.reduce((best, candidate) =>
    changeScore(row, candidate.row) < changeScore(row, best.row)
      ? candidate
      : best,
  );
}
