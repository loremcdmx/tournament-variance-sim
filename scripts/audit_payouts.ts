/**
 * Sanity-audit every built-in payout structure across a realistic AFS
 * range. For each (structure, N) we print:
 *   - paid count  (should be 10–20 % of field for most, 100 % for WTA)
 *   - 1st place %
 *   - 2nd/1st ratio (top-heaviness)
 *   - top-10 cumulative %
 *   - last-paid %    (min cash floor — real rooms pay ~1.5× buy-in ≈ 1.5/N)
 *   - last-paid × N  (equivalent to "min cash in buy-in units" — should be ~1.5)
 */
import { getPayoutTable } from "../src/lib/sim/payouts";
import type { PayoutStructureId } from "../src/lib/sim/types";

const STRUCTURES: PayoutStructureId[] = [
  "mtt-standard",
  "mtt-flat",
  "mtt-top-heavy",
  "mtt-primedope",
  "mtt-pokerstars",
  "mtt-gg",
  "mtt-sunday-million",
  "mtt-gg-bounty",
];

const FIELDS = [20, 50, 100, 500, 1000, 5000, 20000];

function pct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

for (const s of STRUCTURES) {
  console.log(`\n=== ${s} ===`);
  console.log(
    "   N   paid   1st     2/1    top10    min     min×N  buy-in eq.",
  );
  for (const N of FIELDS) {
    const t = getPayoutTable(s, N);
    const paid = t.length;
    const first = t[0];
    const ratio = paid > 1 ? t[1] / t[0] : NaN;
    const top10 = t.slice(0, Math.min(10, paid)).reduce((a, b) => a + b, 0);
    const min = t[paid - 1];
    // min-cash expressed in buy-in units: fraction × N × buyIn / buyIn = fraction × N
    const minInBuyIns = min * N;
    console.log(
      `${String(N).padStart(5)} ${String(paid).padStart(5)}  ${pct(first).padStart(6)}  ${ratio.toFixed(2)}  ${pct(top10).padStart(6)}  ${pct(min).padStart(8)}  ${minInBuyIns.toFixed(2).padStart(5)}× buy-in`,
    );
  }
}
