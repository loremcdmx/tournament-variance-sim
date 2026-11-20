import { targetEvTolerance } from "./finishModel";
import { inferGameType } from "./gameType";
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

function rowForValidation(
  row: TournamentRow,
  model: FinishModelConfig,
  itmTargetCfg: ItmTargetConfig,
): TournamentRow {
  return applyItmTarget([row], itmTargetCfg, model)[0] ?? row;
}

function issueOf(
  row: TournamentRow,
  model: FinishModelConfig,
  itmTargetCfg: ItmTargetConfig,
): RowFeasibilityIssue | undefined {
  return validateSchedule([rowForValidation(row, model, itmTargetCfg)], model).issues[0];
}

const ROI_SEARCH_STEPS = 24;

/**
 * A row with a Field-size range has to hit its ROI at every size at once, and
 * each size can only reach an interval of EV (pinned ITM, locks, the payout
 * table). The worst size's nearest reachable EV is a bound on the target: a
 * size that falls short caps it from above, one that overshoots floors it from
 * below. Moving the target to the nearest bound and asking again tightens the
 * bracket until a ROI passes or the bounds cross, which rules out the targets
 * the walk passed, not every other one. Matching the worst size alone flips
 * the failure to another size and back. A single-field row needs no walk: the
 * floor does not run on a natural solution that misses, so it passes at the
 * ROI matched to its issue's currentEv.
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
  let lastRoi = row.roi;
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
    // The same ROI again returns the same issue, which leaves the bounds and
    // the target where they are: the walk has stalled (at the ROI clamp,
    // usually) and every step left would repeat it.
    if (roi === null || roi === lastRoi) return null;
    lastRoi = roi;
    const candidate = { ...row, roi };
    const next = issueOf(candidate, model, itmTargetCfg);
    if (!next) return candidate;
    if (next.cause === "inconsistent-finish-locks") return null;
    issue = next;
  }
  return null;
}

/**
 * The ROI the walk passes at, moved toward the typed one to the edge of its
 * window (`towardTypedRoi`), or null when the walk finds none or the
 * bisection toward the typed ROI runs past `reach`.
 *
 * The first-place floor gives way to the target on both sides of break-even
 * (`calibrateShelledItm`), so a pinned ITM's reachable EV does not jump at
 * -rake/(1+rake) and leaves no window just under it for the walk to miss:
 * probing there changed no fit on 597 906 blocked rows (the α-adjustable
 * models, SNG and small-MTT tables, fields 2-60 and ranges, pinned ITMs,
 * finish locks, tilts and bounty rows).
 */
function fitRoi(
  row: TournamentRow,
  issue: RowFeasibilityIssue,
  model: FinishModelConfig,
  itmTargetCfg: ItmTargetConfig,
  entryCost: number,
  reach: number,
): TournamentRow | null {
  const walked = fitRoiAcrossFields(row, issue, model, itmTargetCfg, entryCost);
  return walked === null
    ? null
    : towardTypedRoi(row, walked.roi, model, itmTargetCfg, entryCost, reach);
}

/**
 * Three on-target tolerances of the target at `roi`, in ROI. A row whose EV
 * sits anywhere within one tolerance of the target at `roi` misses the target
 * this far on by more than one tolerance (two would let an EV at the far end
 * of the first pass again).
 */
function toleranceStep(entryCost: number, roi: number): number {
  return (3 * targetEvTolerance(entryCost * (1 + roi))) / entryCost;
}

/**
 * Moves a passing ROI toward the typed one, to the edge of its window on the
 * typed side. A walk reads its EV off one solve, which is not always a bound:
 * on a one-prize-level table a blank ITM follows the ROI up to 0.99 and then
 * falls back to the table's (`applyItmTarget`), so a heads-up PKO row at ROI
 * +100 % reads the fallback's EV and the walk stops at break-even, -9.1 %,
 * though the row passes up to +80 %. A ROI within the on-target tolerance of
 * the passing one plays the same EV, so the bisection runs only when a probe
 * `toleranceStep` further still passes; otherwise the row keeps the ROI it
 * plays exactly.
 */
function towardTypedRoi(
  row: TournamentRow,
  passing: number,
  model: FinishModelConfig,
  itmTargetCfg: ItmTargetConfig,
  entryCost: number,
  reach: number,
): TournamentRow | null {
  const typed = row.roi;
  const step = toleranceStep(entryCost, passing);
  const probe = passing + Math.sign(typed - passing) * step;
  if (Math.abs(typed - passing) <= step || issueOf({ ...row, roi: probe }, model, itmTargetCfg)) {
    return { ...row, roi: passing };
  }
  return bisectTowardTypedRoi(row, probe, model, itmTargetCfg, reach);
}

/** Bisection between a passing ROI and the typed one; null once past `reach`. */
function bisectTowardTypedRoi(
  row: TournamentRow,
  passing: number,
  model: FinishModelConfig,
  itmTargetCfg: ItmTargetConfig,
  reach: number,
): TournamentRow | null {
  const typed = row.roi;
  let passes = passing;
  let fails = typed;
  for (let step = 0; step < ROI_SEARCH_STEPS; step++) {
    const mid = (passes + fails) / 2;
    if (issueOf({ ...row, roi: mid }, model, itmTargetCfg)) {
      fails = mid;
      if (Math.abs(fails - typed) > reach) return null;
    } else {
      passes = mid;
    }
  }
  return { ...row, roi: passes };
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
 *
 * The search runs over the row's finish shape (as it is, without its finish
 * locks, without its ITM, the 16 % grinder ITM) and, on each shape, over the
 * ROI, so a lock or ITM change and a ROI change are made together where
 * neither alone is enough (a fixed shape whose KO EV the bounty pool cuts, a
 * pinned ITM). Every shape is tried at the typed ROI first; a shape that
 * fails there then takes the nearest ROI it reaches (`fitRoi`), and past the
 * walk that search stops where it can no longer beat the best candidate
 * (`changeScore`, which a ROI change only adds to). Contradictory locks rule
 * a shape out at every ROI.
 */
export function chooseClosestFeasibilityFix(
  row: TournamentRow,
  issue: RowFeasibilityIssue,
  model: FinishModelConfig,
  itmTargetCfg: ItmTargetConfig,
): FeasibilityFixChoice {
  const entryCost = row.buyIn * (1 + row.rake);
  const gt = inferGameType(row);
  const isBountyEnvelope =
    gt === "mystery" || gt === "mystery-royale" || gt === "pko" || gt === "ocean-ko";
  const shapes: FeasibilityFixChoice[] = [
    { kind: "match-roi", row },
    {
      kind: "clear-locks",
      row: isBountyEnvelope
        ? { ...row, itmRate: undefined, finishBuckets: undefined }
        : { ...row, finishBuckets: undefined },
    },
    { kind: "clear-locks", row: { ...row, itmRate: undefined, finishBuckets: undefined } },
    ...(isBountyEnvelope
      ? []
      : [{ kind: "grinder" as const, row: { ...row, itmRate: 0.16, finishBuckets: undefined } }]),
  ];

  let best: FeasibilityFixChoice | null = null;
  let bestScore = Infinity;
  // Two shapes are one search when validateSchedule sees the same row at the
  // typed ROI and applyItmTarget fills in the ITM of both or of neither: a
  // filled ITM can follow the ROI, a typed one cannot.
  const searched: { filled: boolean; played: TournamentRow }[] = [];
  const unfitted: { shape: FeasibilityFixChoice; issue: RowFeasibilityIssue; cost: number }[] = [];
  for (const shape of shapes) {
    const played = rowForValidation(shape.row, model, itmTargetCfg);
    const filled = !(shape.row.itmRate != null && shape.row.itmRate > 0);
    if (searched.some((s) => s.filled === filled && s.played.itmRate === played.itmRate &&
        s.played.finishBuckets === played.finishBuckets)) {
      continue;
    }
    searched.push({ filled, played });
    const cost = changeScore(row, shape.row);
    if (cost >= bestScore) continue;
    const shapeIssue = shape.row === row ? issue : validateSchedule([played], model).issues[0];
    if (shapeIssue === undefined) {
      best = shape;
      bestScore = cost;
    } else if (shapeIssue.cause !== "inconsistent-finish-locks" && entryCost > 0) {
      unfitted.push({ shape, issue: shapeIssue, cost });
    }
  }
  for (const { shape, issue: shapeIssue, cost } of unfitted) {
    if (cost >= bestScore) continue;
    const fitted = fitRoi(shape.row, shapeIssue, model, itmTargetCfg, entryCost, (bestScore - cost) / 100);
    if (fitted === null) continue;
    const score = changeScore(row, fitted);
    if (score < bestScore) {
      best = { kind: shape.kind, row: fitted };
      bestScore = score;
    }
  }
  // A candidate that still fails would only move the block somewhere else (for
  // a ranged row, to another field size), so a row nothing unblocks stays as
  // it is and the caller says so.
  return best ?? { kind: "none", row };
}

/**
 * The one-click fit of a row as the run would play it, or null when the row
 * is not blocked. validateSchedule judges every row on its own, so this is
 * the row's fit in any schedule.
 */
export function closestFixForRow(
  row: TournamentRow,
  model: FinishModelConfig,
  itmTargetCfg: ItmTargetConfig,
): FeasibilityFixChoice | null {
  const issue = issueOf(row, model, itmTargetCfg);
  return issue === undefined ? null : chooseClosestFeasibilityFix(row, issue, model, itmTargetCfg);
}
