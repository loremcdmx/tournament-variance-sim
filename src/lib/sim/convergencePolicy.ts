/**
 * Policy for the ConvergenceChart numeric ±band. Separated from the chart so
 * the contract lives in one place and can be tested without rendering.
 *
 * The closed-form σ_ROI fits for PKO and Mystery are too rough to support a
 * numeric uncertainty band right now — the stated residuals understate the
 * real drift at the edges of the fit box. Until a data-driven fitDrift ships,
 * any schedule that contains at least one PKO or Mystery row falls back to a
 * qualitative warning. Freeze and Mystery-Royale (fixed AFS) coefficients are
 * accurate enough over their calibration ranges to keep the numeric band.
 *
 * The rule is strict by design: no share threshold, no "mostly freeze"
 * override. A threshold introduces a magic number and leaves the user guessing
 * whether their 1% mix was counted or ignored.
 */

export type ConvergenceRowFormat =
  | "freeze"
  | "pko"
  | "mystery"
  | "mystery-royale";

export type ConvergenceBandPolicy =
  | { kind: "numeric" }
  | { kind: "warning"; reason: "contains-pko-or-mystery" };

export function getConvergenceBandPolicy(
  formats: readonly ConvergenceRowFormat[],
): ConvergenceBandPolicy {
  for (const f of formats) {
    if (f === "pko" || f === "mystery") {
      return { kind: "warning", reason: "contains-pko-or-mystery" };
    }
  }
  return { kind: "numeric" };
}
