/**
 * Per-row variance decomposition. Splits the schedule's mean and variance
 * back onto the rows that produced it, plus the per-row Kelly readouts the
 * decomposition chart shows next to each bar.
 */
import type { CompiledSchedule } from "./engineTypes";
import type { RowDecomposition } from "./types";

export function buildRowDecomposition(
  rowProfits: Float64Array,
  rowBountyProfits: Float64Array,
  S: number,
  numRows: number,
  compiled: CompiledSchedule,
): RowDecomposition[] {
  // Single sequential pass over rowProfits (row-major by sample): accumulate
  // ΣX and ΣX² per row, then compute mean/variance via E[X²]−E[X]². Replaces
  // two stride-numRows column scans, better cache behavior for numRows>2.
  const decomposition: RowDecomposition[] = new Array(numRows);
  const rowMeans = new Float64Array(numRows);
  const rowVariances = new Float64Array(numRows);
  const rowSumSq = new Float64Array(numRows);
  const rowBountySums = new Float64Array(numRows);
  for (let s = 0; s < S; s++) {
    const base = s * numRows;
    for (let r = 0; r < numRows; r++) {
      const v = rowProfits[base + r];
      rowMeans[r] += v;
      rowSumSq[r] += v * v;
      rowBountySums[r] += rowBountyProfits[base + r];
    }
  }
  for (let r = 0; r < numRows; r++) {
    const m = rowMeans[r] / S;
    rowMeans[r] = m;
    // Sample variance: (ΣX² − S·m²) / (S−1). Clamp at 0 for the all-equal
    // degenerate case where floating-point cancellation can dip negative.
    rowVariances[r] =
      S > 1 ? Math.max(0, (rowSumSq[r] - S * m * m) / (S - 1)) : 0;
  }
  const totalRowVarSum = rowVariances.reduce((a, b) => a + b, 0) || 1;
  for (let r = 0; r < numRows; r++) {
    // Per-row Kelly: f* = mean / variance on the row's slot distribution.
    // Only meaningful when the row has positive EV and non-zero variance;
    // otherwise Kelly is undefined (we emit 0 / Infinity respectively).
    const rv = rowVariances[r];
    const rm = rowMeans[r];
    // Same convention as the schedule-level Kelly: B* = σ²/μ,
    // f* = rowBuyIns / B* (dimensionless).
    const rowKellyBankroll =
      rm > 0 && rv > 1e-9 ? rv / rm : Number.POSITIVE_INFINITY;
    const rowKellyFraction =
      rm > 0 && rv > 1e-9 ? compiled.rowBuyIns[r] / rowKellyBankroll : 0;
    decomposition[r] = {
      rowId: compiled.rowIds[r],
      label: compiled.rowLabels[r],
      mean: rm,
      stdDev: Math.sqrt(rv),
      varianceShare: rv / totalRowVarSum,
      bountyMean: rowBountySums[r] / S,
      tournamentsPerSample: compiled.rowCounts[r],
      totalBuyIn: compiled.rowBuyIns[r],
      kellyFraction: rowKellyFraction,
      kellyBankroll: rowKellyBankroll,
    };
  }
  return decomposition;
}
