/**
 * Diff real payout samples against our modelled structures.
 *
 *   npx tsx scripts/compare_real_samples.ts
 *
 * For each sample in `data/payout-samples/`, prints:
 *   • real stats  (1st%, 2nd/1st, top9%, min-cash-bi, paid%)
 *   • model stats from `buildRealisticCurve` via getPayoutTable
 *     for a compatible structure preset (mtt-standard, mtt-pokerstars,
 *     mtt-gg, mtt-gg-bounty) — picked from sample metadata.
 */

import { loadAllSamples } from "./lib/loadPayoutSamples";
import { summarizeSample, type PayoutSample } from "../src/lib/sim/realPayouts";
import { getPayoutTable } from "../src/lib/sim/payouts";
import type { PayoutStructureId } from "../src/lib/sim/types";

interface ModelStats {
  firstShare: number;
  secondShare: number;
  ftRatio: number;
  top9Share: number;
  minCashBuyIns: number;
  paidPct: number;
}

function summarizeModel(
  structure: PayoutStructureId,
  players: number,
  buyIn: number,
): ModelStats {
  const t = getPayoutTable(structure, players);
  const firstShare = t[0] ?? 0;
  const secondShare = t[1] ?? 0;
  let top9 = 0;
  for (let i = 0; i < Math.min(9, t.length); i++) top9 += t[i];
  const minFrac = t[t.length - 1] ?? 0;
  return {
    firstShare,
    secondShare,
    ftRatio: secondShare > 0 ? firstShare / secondShare : 0,
    top9Share: top9,
    minCashBuyIns: (minFrac * players * buyIn) / buyIn,
    paidPct: t.length / players,
  };
}

function pickStructuresFor(s: PayoutSample): PayoutStructureId[] {
  if (s.format === "bounty") return ["mtt-gg-bounty"];
  if (s.source === "PokerStars") {
    return ["mtt-pokerstars", "mtt-sunday-million"];
  }
  if (s.source === "GGPoker") return ["mtt-gg", "mtt-standard"];
  return ["mtt-standard"];
}

function pct(x: number, digits = 2): string {
  return `${(x * 100).toFixed(digits)}%`;
}

function signed(x: number, digits = 2): string {
  const v = (x * 100).toFixed(digits);
  const num = Number(v);
  if (num > 0) return `+${v}pp`;
  return `${v}pp`;
}

function main() {
  const samples = loadAllSamples();
  if (samples.length === 0) {
    console.log("No samples found in data/payout-samples/");
    return;
  }

  for (const s of samples) {
    const real = summarizeSample(s);
    console.log(`\n=== ${s.id}`);
    console.log(
      `    ${s.source} · ${s.tournament} · ${s.entries} entries · ${s.currency} ${s.buyIn}`,
    );
    if (s.partial) {
      console.log(
        `    [partial: ${(real.coverage * 100).toFixed(0)}% of paid places captured]`,
      );
    }
    const poolErr = (real.poolSumError * 100).toFixed(3);
    console.log(`    pool-sum error vs. posted: ${poolErr}%`);
    console.log();
    console.log(
      `    real   · 1st=${pct(real.firstShare)}  2nd/1st=${real.ftRatio.toFixed(
        3,
      )}  top9=${pct(real.top9Share)}  min=${real.minCashBuyIns.toFixed(
        2,
      )}×bi  paid=${pct(real.paidPct, 1)}`,
    );

    for (const structure of pickStructuresFor(s)) {
      const m = summarizeModel(structure, s.entries, s.buyIn);
      const d1 = m.firstShare - real.firstShare;
      const dTop9 = m.top9Share - real.top9Share;
      const dMin = m.minCashBuyIns - real.minCashBuyIns;
      const dPaid = m.paidPct - real.paidPct;
      console.log(
        `    ${structure.padEnd(20)} 1st=${pct(m.firstShare)} (${signed(
          d1,
        )})  2nd/1st=${m.ftRatio.toFixed(3)}  top9=${pct(
          m.top9Share,
        )} (${signed(dTop9)})  min=${m.minCashBuyIns.toFixed(2)}×bi (${
          dMin >= 0 ? "+" : ""
        }${dMin.toFixed(2)})  paid=${pct(m.paidPct, 1)} (${signed(dPaid, 1)})`,
      );
    }
  }
}

main();
