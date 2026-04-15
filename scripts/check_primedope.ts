import { runSimulation } from "../src/lib/sim/engine";

const base = {
  schedule: [
    {
      id: "pd-1",
      label: "$50 MTT",
      players: 100,
      buyIn: 50,
      rake: 0.11,
      roi: 0.1,
      payoutStructure: "mtt-standard" as const,
      count: 1000,
    },
  ],
  scheduleRepeats: 1,
  samples: 5000,
  bankroll: 1000,
  seed: 42,
  finishModel: { id: "power-law" as const },
  compareWithPrimedope: true,
  primedopeStyleEV: true,
};

const r = runSimulation(base);
const binary = r.comparison!;

console.log("=== PrimeDope reference (100p, $50, 11% rake, 10% ROI, 1000 tourneys) ===");
console.log("PrimeDope site: EV=$5000 SD(math)=$5607 SD(sim)=$5789");
console.log("                RoR 5%=$6301 RoR 1%=$9243");
console.log();
console.log("Alpha (our default):");
console.log("  mean:", binary.stats ? r.stats.mean.toFixed(0) : "-", "SD:", r.stats.stdDev.toFixed(0));
console.log("  RoR50%:", r.stats.minBankrollRoR50pct?.toFixed(0), "RoR5%:", r.stats.minBankrollRoR5pct.toFixed(0), "RoR1%:", r.stats.minBankrollRoR1pct.toFixed(0));
console.log();
console.log("Binary-ITM (new PrimeDope-compat):");
console.log("  mean:", binary.stats.mean.toFixed(0), "SD:", binary.stats.stdDev.toFixed(0));
console.log("  RoR50%:", binary.stats.minBankrollRoR50pct?.toFixed(0), "RoR5%:", binary.stats.minBankrollRoR5pct.toFixed(0), "RoR1%:", binary.stats.minBankrollRoR1pct.toFixed(0));
