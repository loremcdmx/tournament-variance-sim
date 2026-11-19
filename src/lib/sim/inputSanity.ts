/**
 * Input sanity checks. Catches *internally inconsistent* input combinations
 * that the engine would compute honestly but the user almost certainly did
 * not mean — e.g. a tilt handle with `gain != 0` and `scale = 0`, a row
 * tagged as PKO/Mystery with `bountyFraction = 0`, or a schedule row with
 * `count = 0`.
 *
 * This is intentionally orthogonal to `validateSchedule()` (which catches
 * α-calibration infeasibility — engine-blocking). Sanity findings never
 * block a run; they surface as soft warnings so the user can spot a dead
 * handle or a misconfigured row before reading "honest but useless"
 * results.
 */
import { fieldVariantSizes } from "./fieldVariants";
import { inferGameType } from "./gameType";
import { countScheduleTournaments } from "./scheduleTarget";
import type { TournamentRow } from "./types";

export type SanityFindingId =
  | "tilt-fast-no-scale"
  | "tilt-slow-no-threshold"
  | "tilt-slow-no-min-duration"
  | "session-noise-whole-run"
  | "zero-bankroll"
  | "empirical-too-few-buckets"
  | "row-bounty-format-no-bounty"
  | "row-mystery-no-variance"
  | "row-pko-heat-no-bounty"
  | "row-pko-single-table"
  | "row-zero-count";

export interface SanityFinding {
  id: SanityFindingId;
  /** When the finding is bound to a specific schedule row. */
  rowIdx?: number;
  rowLabel?: string;
}

export interface SanityInputs {
  tiltFastGain: number;
  tiltFastScale: number;
  tiltSlowGain: number;
  tiltSlowThreshold: number;
  /** Tournaments of streak before the slow-tilt state flips; unset means the engine's 500. */
  tiltSlowMinDuration?: number;
  roiShockPerSession?: number;
  roiDriftSigma?: number;
  /** Unset means the engine's fallback, one session per schedule pass. */
  tournamentsPerSession?: number;
  scheduleRepeats?: number;
  bankroll: number;
  /** Active finishModelId — only `"empirical"` participates in the buckets check. */
  finishModelId: string;
  empiricalBuckets?: readonly number[];
}

const DEFAULT_TILT_SLOW_MIN_DURATION = 500;

/** Buckets shorter than this make resampling so coarse it's misleading. */
export const MIN_EMPIRICAL_BUCKETS = 50;

/**
 * The hot loop draws a PKO row's KO count as Poisson and adds head-size
 * noise; on one table the real count is far tighter (heads-up the bounty is
 * fixed by the result), so σ comes out about 30 % high heads-up, 5 % at 18
 * players, 3.6 % at 50, 1.4 % at 180 and under 1 % from 500 up. The warning
 * stops at one table, where the excess is largest.
 */
export const PKO_SINGLE_TABLE_MAX_FIELD = 18;

export function checkInputSanity(
  controls: SanityInputs,
  schedule: readonly TournamentRow[],
): SanityFinding[] {
  const findings: SanityFinding[] = [];

  if (controls.tiltFastGain !== 0 && controls.tiltFastScale === 0) {
    findings.push({ id: "tilt-fast-no-scale" });
  }

  // hotLoop switches slow tilt off unless gain != 0, threshold > 0 and the
  // floored minimum duration > 0; each dead setting gets its own finding.
  if (controls.tiltSlowGain !== 0 && controls.tiltSlowThreshold <= 0) {
    findings.push({ id: "tilt-slow-no-threshold" });
  }

  if (
    controls.tiltSlowGain !== 0 &&
    !(Math.floor(controls.tiltSlowMinDuration ?? DEFAULT_TILT_SLOW_MIN_DURATION) > 0)
  ) {
    findings.push({ id: "tilt-slow-no-min-duration" });
  }

  // With one session for the whole run the shock is drawn once, so it acts as
  // a second per-run ROI offset next to roiStdErr, and the drift takes one step.
  if (
    ((controls.roiShockPerSession ?? 0) > 0 || (controls.roiDriftSigma ?? 0) > 0) &&
    controls.scheduleRepeats !== undefined
  ) {
    const perPass = countScheduleTournaments(schedule);
    const perSample = perPass * Math.max(1, Math.floor(controls.scheduleRepeats));
    const sessionLength =
      controls.tournamentsPerSession === undefined || Number.isNaN(controls.tournamentsPerSession)
        ? perPass
        : Math.max(1, Math.floor(controls.tournamentsPerSession));
    if (sessionLength >= perSample) findings.push({ id: "session-noise-whole-run" });
  }

  if (controls.bankroll <= 0 && schedule.length > 0) {
    findings.push({ id: "zero-bankroll" });
  }

  if (
    controls.finishModelId === "empirical" &&
    (controls.empiricalBuckets?.length ?? 0) < MIN_EMPIRICAL_BUCKETS
  ) {
    findings.push({ id: "empirical-too-few-buckets" });
  }

  schedule.forEach((row, idx) => {
    const label = row.label || `#${idx + 1}`;
    const fmt = row.gameType;
    const bounty = row.bountyFraction ?? 0;
    const variance = row.mysteryBountyVariance ?? 0;
    const count = row.count ?? 0;
    const heat = row.pkoHeat ?? 0;

    if (
      (fmt === "pko" || fmt === "ocean-ko" || fmt === "mystery" || fmt === "mystery-royale") &&
      bounty === 0
    ) {
      findings.push({
        id: "row-bounty-format-no-bounty",
        rowIdx: idx,
        rowLabel: label,
      });
    }

    // Battle Royale envelopes come from the fixed GG tier table, so σ² is
    // irrelevant there; only plain Mystery reads the log-normal variance.
    if (fmt === "mystery" && variance === 0) {
      findings.push({
        id: "row-mystery-no-variance",
        rowIdx: idx,
        rowLabel: label,
      });
    }

    if (heat > 0 && bounty === 0) {
      findings.push({
        id: "row-pko-heat-no-bounty",
        rowIdx: idx,
        rowLabel: label,
      });
    }

    if (
      inferGameType(row) === "pko" &&
      bounty > 0 &&
      Math.floor(Math.min(...fieldVariantSizes(row)) * Math.max(1, row.lateRegMultiplier ?? 1)) <=
        PKO_SINGLE_TABLE_MAX_FIELD
    ) {
      findings.push({
        id: "row-pko-single-table",
        rowIdx: idx,
        rowLabel: label,
      });
    }

    if (count === 0) {
      findings.push({
        id: "row-zero-count",
        rowIdx: idx,
        rowLabel: label,
      });
    }
  });

  return findings;
}
