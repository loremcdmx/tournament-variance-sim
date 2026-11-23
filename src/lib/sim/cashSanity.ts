/**
 * Soft sanity checks for Cash inputs. Mirrors MTT `inputSanity.ts`: never
 * blocks a run, only flags configurations the user likely did not intend or
 * should understand before interpreting the output.
 */
import { cashEffectiveSummary } from "./cashPlanning";
import type { CashInput } from "./cashTypes";

export type CashSanityCode =
  | "nonPositiveWinrate"
  | "extremeSd"
  | "zeroShareRow"
  | "rakeEnabledZeroRb"
  | "wrUncertaintyWide";

export interface CashSanityFinding {
  code: CashSanityCode;
  severity: "warn" | "info";
}

export function checkCashInputSanity(input: CashInput): CashSanityFinding[] {
  const out: CashSanityFinding[] = [];
  const summary = cashEffectiveSummary(input);

  if (summary.effectiveWrBb100 <= 0) {
    out.push({ code: "nonPositiveWinrate", severity: "warn" });
  }

  const maxSd =
    input.stakes && input.stakes.length > 0
      ? Math.max(...input.stakes.map((r) => r.sdBb100))
      : input.sdBb100;
  if (maxSd > 200) {
    out.push({ code: "extremeSd", severity: "info" });
  }

  if (input.stakes && input.stakes.length > 0) {
    if (input.stakes.some((r) => r.handShare <= 0)) {
      out.push({ code: "zeroShareRow", severity: "warn" });
    }
    const anyZeroRb = input.stakes.some(
      (r) =>
        r.rake.enabled &&
        (r.rake.contributedRakeBb100 <= 0 || r.rake.advertisedRbPct <= 0),
    );
    if (anyZeroRb) {
      out.push({ code: "rakeEnabledZeroRb", severity: "info" });
    }
  } else if (
    input.rake.enabled &&
    (input.rake.contributedRakeBb100 <= 0 || input.rake.advertisedRbPct <= 0)
  ) {
    out.push({ code: "rakeEnabledZeroRb", severity: "info" });
  }

  if (
    (input.wrStdErr ?? 0) > 0 &&
    summary.effectiveWrBb100 > 0 &&
    (input.wrStdErr ?? 0) >= summary.effectiveWrBb100
  ) {
    out.push({ code: "wrUncertaintyWide", severity: "info" });
  }

  return out;
}
