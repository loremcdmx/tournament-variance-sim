import { fieldVariantSizes } from "./fieldVariants";
import { inferGameType, normalizeGameTypeConsistency } from "./gameType";
import { applyItmTarget, type ItmTargetConfig } from "./itmTarget";
import { validateSchedule, type RowFeasibilityIssue } from "./validation";
import type { FinishModelConfig, TournamentRow } from "./types";

type FixKind = "match-roi" | "clear-locks" | "grinder" | "none";

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

function playsSeveralFields(row: TournamentRow): boolean {
  return fieldVariantSizes(normalizeGameTypeConsistency(row)).length > 1;
}

const ROI_SEARCH_STEPS = 24;

/**
 * A row with a Field-size range has to hit its ROI at every size at once, and
 * each size can only reach an interval of EV (pinned ITM, locks, the payout
 * table). The worst size's nearest reachable EV is a bound on the target: a
 * size that falls short caps it from above, one that overshoots floors it from
 * below. Moving the target to the nearest bound and asking again tightens the
 * bracket until a ROI passes or the bounds cross, which means no single ROI
 * fits every size. Matching the worst size alone flips the failure to another
 * size and back.
 */
function fitRoiAcrossFields(
  row: TournamentRow,
  first: RowFeasibilityIssue,
  model: FinishModelConfig,
  itmTargetCfg: ItmTargetConfig,
  entryCost: number,
): TournamentRow | null {
  let lower = -Infinity;
  let upper = Infinity;
  let issue = first;
  let target = issue.targetEv;
  let triedMidpoint = false;
  for (let step = 0; step < ROI_SEARCH_STEPS; step++) {
    if (issue.currentEv < issue.targetEv) upper = Math.min(upper, issue.currentEv);
    else lower = Math.max(lower, issue.currentEv);
    if (lower <= upper) {
      target = Math.min(upper, Math.max(lower, target));
    } else {
      if (triedMidpoint) return null;
      triedMidpoint = true;
      target = (lower + upper) / 2;
    }
    const roi = clampRoi(target / entryCost - 1);
    if (roi === null) return null;
    const candidate = { ...row, roi };
    const next = validateSchedule([rowForValidation(candidate, itmTargetCfg)], model).issues[0];
    if (!next) return candidate;
    if (next.reason) return null;
    issue = next;
  }
  return null;
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
  const ranged = playsSeveralFields(row);
  const matchedRoi =
    entryCost > 0 ? clampRoi(issue.currentEv / entryCost - 1) : null;
  if (matchedRoi !== null && issue.reason !== "inconsistent-finish-locks") {
    const matched: FeasibilityFixChoice = {
      kind: "match-roi",
      row: { ...row, roi: matchedRoi },
    };
    if (!ranged || candidatePasses(matched.row, model, itmTargetCfg)) {
      candidates.push(matched);
    } else {
      const fitted = fitRoiAcrossFields(row, issue, model, itmTargetCfg, entryCost);
      if (fitted) candidates.push({ kind: "match-roi", row: fitted });
    }
  }

  const gt = inferGameType(row);
  const isBountyEnvelope =
    gt === "mystery" || gt === "mystery-royale" || gt === "pko" || gt === "ocean-ko";
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
  if (viable.length === 0) {
    // Rewriting the ROI to one size's reachable EV would only move the failure
    // to another size, so a ranged row nothing can unblock stays as it is.
    if (ranged && issue.reason === undefined) return { kind: "none", row };
    return candidates[0] ?? { kind: "clear-locks", row };
  }
  return viable.reduce((best, candidate) =>
    changeScore(row, candidate.row) < changeScore(row, best.row)
      ? candidate
      : best,
  );
}

/**
 * The blocked rows a one-click fit leaves as they are, because no single ROI
 * (and no lock or ITM relaxation) clears every field size of their range.
 */
export function rowsFitCannotUnblock(
  schedule: readonly TournamentRow[],
  model: FinishModelConfig,
  itmTargetCfg: ItmTargetConfig,
): string[] {
  const live = applyItmTarget([...schedule], itmTargetCfg);
  const stuck: string[] = [];
  for (const issue of validateSchedule(live, model).issues) {
    const row = schedule.find((r) => r.id === issue.rowId);
    if (row && chooseClosestFeasibilityFix(row, issue, model, itmTargetCfg).kind === "none") {
      stuck.push(issue.rowId);
    }
  }
  return stuck;
}
