/**
 * Policy for the ConvergenceChart numeric ±band. Separated from the chart so
 * the contract lives in one place and can be unit-tested without rendering.
 *
 * Mystery's closed-form σ_ROI fit still leaves a wide tail on LOO xval
 * (p95 ≈ 17 %, max ≈ 30 % on the production grid after the 2D log-poly refit
 * of 2026-04-20) — enough to render a numeric uncertainty band dishonestly
 * tight, so any schedule containing a Mystery row falls back to a
 * qualitative warning.
 *
 * Additionally, the fits are only validated inside an explicit training box
 * per format. Anything outside (e.g. ROI=−30 % for PKO/Mystery, field > 50 000
 * for non-MBR, field !== 18 for MBR) is extrapolation and not band-worthy —
 * policy reports `outside-fit-box`. The point estimate is still shown as a
 * ballpark; only the numeric ±band is suppressed.
 *
 * Priority when a sample is both Mystery and outside-box:
 * `contains-mystery` wins. It's the more informative reason (the band would
 * be hidden even in-box), and the outside-box signal is subsumed. A test
 * locks this precedence so it doesn't regress silently.
 *
 * The rule is strict by design: no share threshold, no "mostly PKO"
 * override. A threshold introduces a magic number and leaves the user
 * guessing whether their 1 % Mystery mix was counted or ignored.
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
      reason: "contains-mystery" | "outside-fit-box";
    };

export interface FitBoxSample {
  format: ConvergenceRowFormat;
  field: number;
  roi: number;
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
      return field >= 50 && field <= 50_000;
    case "pko":
      return (
        field >= 50 && field <= 50_000 && roi >= -0.20 && roi <= 0.80
      );
    case "mystery":
      return (
        field >= 50 && field <= 50_000 && roi >= -0.20 && roi <= 0.80
      );
    case "mystery-royale":
      return field === 18 && roi >= -0.10 && roi <= 0.10;
  }
}

export function getConvergenceBandPolicy(
  samples: readonly FitBoxSample[],
): ConvergenceBandPolicy {
  // Pass 1: Mystery presence taints the whole schedule regardless of box.
  // This reason is strictly more informative than outside-fit-box — the
  // band would be hidden even if every sample were in-box — so it wins.
  for (const s of samples) {
    if (s.format === "mystery") {
      return { kind: "warning", reason: "contains-mystery" };
    }
  }
  // Pass 2: any sample outside its per-format training box hides the band.
  for (const s of samples) {
    if (!isInsideFitBox(s)) {
      return { kind: "warning", reason: "outside-fit-box" };
    }
  }
  return { kind: "numeric" };
}
