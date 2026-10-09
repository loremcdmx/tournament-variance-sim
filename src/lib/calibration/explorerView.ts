/** Pure read-outs of the "Space -> Ocean" block: what the page rounds and which warnings it derives from the precision table. */
import type { EmpiricalBridgeData } from "./oceanTransport";

type Precision = NonNullable<EmpiricalBridgeData["numericPrecision"]>;
export type PrecisionRow = Precision["rows"][number];

/** σ, its standard error and ROI are shown to one decimal: the anchor's own error is two to three percent. */
export const SIGMA_DECIMALS = 1;
export const ROI_DECIMALS = 1;
/** The θ block exists to show differences of a few hundredths of a BI; one decimal would print "6,2–6,2". */
export const THETA_SIGMA_DECIMALS = 2;
/** The result SD over a distance is rounded to tens of BI: hundreds would print Space and Ocean as the same "≈ 1 000". */
export const DISTANCE_SD_STEP_BI = 10;
/** Counts such as players keep two significant digits. */
export const DISTANCE_SD_SIGNIFICANT_DIGITS = 2;

export function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || !(step > 0)) return value;
  return Math.round(value / step) * step;
}

export function roundSignificant(value: number, digits = DISTANCE_SD_SIGNIFICANT_DIGITS): number {
  if (!Number.isFinite(value) || value === 0) return value;
  const step = 10 ** (Math.floor(Math.log10(Math.abs(value))) - digits + 1);
  return Math.round(value / step) * step;
}

export function passesPrecisionGate(row: PrecisionRow, gates: Precision["gates"]): boolean {
  return row.bountyResidualSdRatioRelativeSE <= gates.maxResidualSdRatioRelativeSE
    && row.bountyMeanRatioRelativeSE <= gates.maxMeanRatioRelativeSE;
}

export function precisionRowFor(precision: Precision | undefined, theta: number, capBountyBI: number, ticket: number): PrecisionRow | undefined {
  return precision?.rows.find(row => row.theta === theta && row.capBountyBI === capBountyBI && row.target === `ocean-usd${ticket}`);
}

export function precisionCount(precision: Precision): { passed: number; total: number } {
  return { passed: precision.rows.filter(row => passesPrecisionGate(row, precision.gates)).length, total: precision.rows.length };
}

export interface SigmaScenario {
  theta: number;
  sigma: number;
}

export interface SigmaRangeEnd extends SigmaScenario {
  /** Whether the scenario's row in the precision table meets both thresholds; null if the table has no such row. */
  meetsPrecision: boolean | null;
}

/** The σ range across knockout-participation scenarios, with the precision verdict of the scenarios that set its ends. */
export function sigmaRange(
  scenarios: readonly SigmaScenario[], precision: Precision | undefined, capBountyBI: number, ticket: number,
): { lower: SigmaRangeEnd; upper: SigmaRangeEnd } | null {
  if (scenarios.length === 0) return null;
  const end = (scenario: SigmaScenario): SigmaRangeEnd => {
    const row = precisionRowFor(precision, scenario.theta, capBountyBI, ticket);
    return { ...scenario, meetsPrecision: precision && row ? passesPrecisionGate(row, precision.gates) : null };
  };
  const lower = scenarios.reduce((best, item) => item.sigma < best.sigma ? item : best);
  const upper = scenarios.reduce((best, item) => item.sigma > best.sigma ? item : best);
  return { lower: end(lower), upper: end(upper) };
}
