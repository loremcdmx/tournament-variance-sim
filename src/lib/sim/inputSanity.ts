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
import type { TournamentRow } from "./types";

export type SanityFindingId =
  | "tilt-fast-no-scale"
  | "tilt-slow-no-threshold"
  | "zero-bankroll"
  | "empirical-too-few-buckets"
  | "row-bounty-format-no-bounty"
  | "row-mystery-no-variance"
  | "row-pko-heat-no-bounty"
  | "row-reentry-slots-no-rate"
  | "row-reentry-rate-no-slots"
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
  bankroll: number;
  /** Active finishModelId — only `"empirical"` participates in the buckets check. */
  finishModelId: string;
  empiricalBuckets?: readonly number[];
}

/** Buckets shorter than this make resampling so coarse it's misleading. */
export const MIN_EMPIRICAL_BUCKETS = 50;

export function checkInputSanity(
  controls: SanityInputs,
  schedule: readonly TournamentRow[],
): SanityFinding[] {
  const findings: SanityFinding[] = [];

  if (controls.tiltFastGain !== 0 && controls.tiltFastScale === 0) {
    findings.push({ id: "tilt-fast-no-scale" });
  }

  if (controls.tiltSlowGain !== 0 && controls.tiltSlowThreshold <= 0) {
    findings.push({ id: "tilt-slow-no-threshold" });
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
    const maxEntries = row.maxEntries ?? 1;
    const reRate = row.reentryRate ?? (maxEntries > 1 ? 1 : 0);

    if (
      (fmt === "pko" || fmt === "mystery" || fmt === "mystery-royale") &&
      bounty === 0
    ) {
      findings.push({
        id: "row-bounty-format-no-bounty",
        rowIdx: idx,
        rowLabel: label,
      });
    }

    if (
      (fmt === "mystery" || fmt === "mystery-royale") &&
      variance === 0
    ) {
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

    if (maxEntries > 1 && reRate <= 0) {
      findings.push({
        id: "row-reentry-slots-no-rate",
        rowIdx: idx,
        rowLabel: label,
      });
    }

    if (maxEntries <= 1 && (row.reentryRate ?? 0) > 0) {
      findings.push({
        id: "row-reentry-rate-no-slots",
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
