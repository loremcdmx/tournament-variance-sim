/**
 * Policy for the ConvergenceChart numeric ±band. Separated from the chart so
 * the contract lives in one place and can be unit-tested without rendering.
 *
 * The fits are only validated inside an explicit training box per format.
 * Anything outside (e.g. ROI=−30 % for PKO/Mystery, field > 50 000 for
 * non-MBR, field !== 18 for MBR) is extrapolation and not band-worthy —
 * policy reports `outside-fit-box`. Mystery is stricter: although its current
 * 2D fit is good on the canonical grid overall, off-grid drift is still too
 * wide in low-field / edge-ROI corners, so numeric bands are only allowed in
 * a narrower revalidated safe box. In-box-but-outside-safe-box Mystery reports
 * `contains-mystery`. Battle Royale is also point-only for now: the averaged
 * tab uses a runtime single-row estimate, but its old residual policy is no
 * longer trusted, so in-box MBR reports `contains-mystery-royale`. The point
 * estimate is still shown as a ballpark; only the numeric ±band is
 * suppressed.
 */

import type { TournamentRow } from "./types";

export type ConvergenceRowFormat =
  | "freeze"
  | "pko"
  | "mystery"
  | "mystery-royale";

export type ConvergenceBandPolicy =
  | { kind: "numeric" }
  | {
      kind: "warning";
      reason:
        | "contains-mystery"
        | "contains-mystery-royale"
        | "outside-fit-box";
    };

export interface FitBoxSample {
  format: ConvergenceRowFormat;
  field: number;
  roi: number;
}

export const CONVERGENCE_FIELD_MIN = 50;
export const CONVERGENCE_FIELD_MAX = 50_000;
export const CONVERGENCE_KO_ROI_MIN = -0.20;
export const CONVERGENCE_KO_ROI_MAX = 0.80;
export const CONVERGENCE_MYSTERY_NUMERIC_FIELD_MIN = 500;
export const CONVERGENCE_MYSTERY_NUMERIC_FIELD_MAX = 10_000;
export const CONVERGENCE_MYSTERY_NUMERIC_ROI_MIN = -0.10;
export const CONVERGENCE_MYSTERY_NUMERIC_ROI_MAX = 0.30;
export const CONVERGENCE_MBR_FIELD = 18;
export const CONVERGENCE_MBR_ROI_MIN = -0.10;
export const CONVERGENCE_MBR_ROI_MAX = 0.10;

const FIT_BOX_EPS = 1e-9;

function betweenInclusive(value: number, min: number, max: number): boolean {
  return value >= min - FIT_BOX_EPS && value <= max + FIT_BOX_EPS;
}

/**
 * Map a TournamentRow to its ConvergenceChart format classification.
 *
 * Precedence (strict, top wins):
 *   1. `row.gameType` — the canonical explicit signal.
 *   2. `row.payoutStructure` — legacy explicit signal for rows that
 *      pre-date `gameType` but have a format-specific payout table.
 *   3. `row.bountyFraction` + `row.mysteryBountyVariance` — structural
 *      fallback for fully untagged rows. Only distinguishes freeze / pko /
 *      mystery; MBR is NEVER inferred from variance alone because
 *      `applyGameType("mystery")` sets `mysteryBountyVariance = 2.0`, so a
 *      variance threshold would misclassify plain Mystery as MBR.
 *
 * Unknown / inconsistent → fall through the chain; freeze is the safe
 * default for rows with no bounty signal at all.
 */
export function inferRowFormat(row: TournamentRow): ConvergenceRowFormat {
  // (1) Explicit gameType wins over every other signal.
  if (row.gameType === "mystery-royale") return "mystery-royale";
  if (row.gameType === "mystery") return "mystery";
  if (row.gameType === "pko") return "pko";
  if (
    row.gameType === "freezeout" ||
    row.gameType === "freezeout-reentry"
  ) {
    return "freeze";
  }

  // (2) Legacy payoutStructure (no gameType set).
  if (row.payoutStructure === "battle-royale") return "mystery-royale";
  if (row.payoutStructure === "mtt-gg-mystery") return "mystery";

  // (3) Structural fallback — gameType and payoutStructure both silent.
  const b = row.bountyFraction ?? 0;
  const m = row.mysteryBountyVariance ?? 0;
  if (b > 0 && m > 0) return "mystery";
  if (b > 0 || row.payoutStructure === "mtt-gg-bounty") return "pko";
  return "freeze";
}

/**
 * Per-format training-box bounds. A sample outside this box is an
 * extrapolation of the closed-form σ fit — the point estimate is still
 * shown as a directional ballpark, but the numeric ±band is suppressed.
 *
 * Freeze: field ∈ [50, 50 000]; ROI unrestricted because the current
 * production fit is ROI-invariant (`C1 === 0` in `SIGMA_ROI_FREEZE`).
 * If that ever changes — i.e. if `C1 != 0` — this contract MUST be
 * updated. A canary test (`freeze ROI-invariant contract`) in
 * `convergencePolicy.test.ts` will fail the moment `C1` changes, making
 * the drift impossible to miss.
 *
 * PKO / Mystery: field ∈ [50, 50 000], ROI ∈ [−0.20, +0.80] — the 11×18
 * grid the 2D log-poly was fit on (scripts/fit_beta_{pko,mystery}.json).
 *
 * Mystery Battle Royale: `field === 18` strictly. MBR is a structural
 * 18-max format at GG; non-18 rows are a different game and the
 * `fit_beta_mystery_royale.json` coefficients don't generalize.
 * ROI ∈ [−0.10, +0.10] matches the UI slider range the fit covers.
 */
export function isInsideFitBox(sample: FitBoxSample): boolean {
  const { format, field, roi } = sample;
  switch (format) {
    case "freeze":
      return betweenInclusive(
        field,
        CONVERGENCE_FIELD_MIN,
        CONVERGENCE_FIELD_MAX,
      );
    case "pko":
      return (
        betweenInclusive(
          field,
          CONVERGENCE_FIELD_MIN,
          CONVERGENCE_FIELD_MAX,
        ) &&
        betweenInclusive(roi, CONVERGENCE_KO_ROI_MIN, CONVERGENCE_KO_ROI_MAX)
      );
    case "mystery":
      return (
        betweenInclusive(
          field,
          CONVERGENCE_FIELD_MIN,
          CONVERGENCE_FIELD_MAX,
        ) &&
        betweenInclusive(roi, CONVERGENCE_KO_ROI_MIN, CONVERGENCE_KO_ROI_MAX)
      );
    case "mystery-royale":
      return (
        Math.abs(field - CONVERGENCE_MBR_FIELD) <= FIT_BOX_EPS &&
        betweenInclusive(
          roi,
          CONVERGENCE_MBR_ROI_MIN,
          CONVERGENCE_MBR_ROI_MAX,
        )
      );
  }
}

/**
 * Mystery numeric bands are deliberately stricter than the raw fit box.
 *
 * Evidence currently supports a stable "working pocket" around the mid-field,
 * non-extreme ROI controls that the widget defaults into:
 *   - canonical userNarrow grid: p95 ≈ 3.8%, max ≈ 4.1%
 *   - off-grid hold-outs in the same neighborhood stay single-digit
 *
 * Outside this pocket we still show the point estimate, but suppress the
 * numeric range until the full-box Mystery policy is revalidated.
 */
export function isInsideMysteryNumericBox(sample: FitBoxSample): boolean {
  return (
    sample.format === "mystery" &&
    betweenInclusive(
      sample.field,
      CONVERGENCE_MYSTERY_NUMERIC_FIELD_MIN,
      CONVERGENCE_MYSTERY_NUMERIC_FIELD_MAX,
    ) &&
    betweenInclusive(
      sample.roi,
      CONVERGENCE_MYSTERY_NUMERIC_ROI_MIN,
      CONVERGENCE_MYSTERY_NUMERIC_ROI_MAX,
    )
  );
}

export function getConvergenceBandPolicy(
  samples: readonly FitBoxSample[],
): ConvergenceBandPolicy {
  for (const s of samples) {
    if (!isInsideFitBox(s)) {
      return { kind: "warning", reason: "outside-fit-box" };
    }
  }
  for (const s of samples) {
    if (s.format === "mystery" && !isInsideMysteryNumericBox(s)) {
      return { kind: "warning", reason: "contains-mystery" };
    }
  }
  for (const s of samples) {
    if (s.format === "mystery-royale") {
      return { kind: "warning", reason: "contains-mystery-royale" };
    }
  }
  return { kind: "numeric" };
}
