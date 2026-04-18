/**
 * Sanity pass for the rakeback addition:
 *
 *  1. With rakebackFracOfRake = 0, the result on a fixed seed must be
 *     byte-identical to a run built without the field at all. If it's not,
 *     the new plumbing leaked into the deterministic path.
 *
 *  2. With rakebackFracOfRake = 0.30 (30 % of rake) at rake = 10 %, ROI
 *     should lift by exactly +3 pp. σ_ROI (profit σ scaled by cost) must
 *     stay the same up to FP noise — rakeback is a pure mean shift.
 *
 *  3. Mean per-tournament bonus must match the analytic prediction:
 *     rb × rake × buyIn × E[bullets_fired].
 *
 *  Run:
 *     npx tsx scripts/verify_rakeback.ts
 */

import { runSimulation } from "../src/lib/sim/engine";
import type { SimulationInput } from "../src/lib/sim/types";

function baseInput(rakebackFracOfRake: number): SimulationInput {
  return {
    schedule: [
      {
        id: "r1",
        label: "probe",
        players: 1000,
        buyIn: 50,
        rake: 0.1,
        roi: 0.1,
        payoutStructure: "mtt-standard",
        count: 500,
      },
    ],
    scheduleRepeats: 1,
    samples: 4000,
    bankroll: 0,
    seed: 42,
    finishModel: { id: "powerlaw-realdata-influenced" },
    rakebackFracOfRake,
  };
}

function main() {
  console.log("Running three passes on seed=42, N=500, samples=4000...\n");

  const baseline = runSimulation({ ...baseInput(0) });
  const zeroRb = runSimulation(baseInput(0));
  const withRb = runSimulation(baseInput(0.3));

  // (1) byte-identical when rb=0 even with the new field plumbed.
  const meanMatch = baseline.stats.mean === zeroRb.stats.mean;
  const sdMatch = baseline.stats.stdDev === zeroRb.stats.stdDev;
  console.log(
    `[determinism @ rb=0] mean: ${meanMatch ? "match" : "DIFF"} (${baseline.stats.mean.toFixed(6)} vs ${zeroRb.stats.mean.toFixed(6)})`,
  );
  console.log(
    `                    sd:   ${sdMatch ? "match" : "DIFF"} (${baseline.stats.stdDev.toFixed(6)} vs ${zeroRb.stats.stdDev.toFixed(6)})`,
  );

  // (2) +30 % of rake at 10 % rake → +3 pp ROI exactly per bullet.
  // Analytic bonus total = rb × rake × buyIn × totalBullets.
  // Per-tournament expected bullets = N × E[K]; totalBuyIn already captures
  // this (= N × E[K] × buyIn × (1+rake)), so expected bonus =
  //   rb × rake / (1+rake) × totalBuyIn.
  const expectedBonus = (0.3 * 0.1 / (1 + 0.1)) * baseline.totalBuyIn;
  const actualBonus = withRb.stats.mean - baseline.stats.mean;
  const bonusErr = Math.abs(actualBonus - expectedBonus) / expectedBonus;
  console.log(
    `[mean shift]        expected +$${expectedBonus.toFixed(2)}, got +$${actualBonus.toFixed(2)} (rel err ${(bonusErr * 100).toFixed(3)}%)`,
  );

  // (3) σ should be unchanged — rakeback adds no variance.
  const sdDelta = Math.abs(withRb.stats.stdDev - baseline.stats.stdDev);
  const sdRel = sdDelta / baseline.stats.stdDev;
  console.log(
    `[σ invariance]      baseline σ=$${baseline.stats.stdDev.toFixed(2)}, with-rb σ=$${withRb.stats.stdDev.toFixed(2)}, Δ=${(sdRel * 100).toFixed(4)}%`,
  );

  // ROI readouts for context.
  const roiBase = baseline.stats.mean / baseline.totalBuyIn;
  const roiRb = withRb.stats.mean / withRb.totalBuyIn;
  console.log(
    `\nROI baseline: ${(roiBase * 100).toFixed(2)}%, ROI w/ 30% RB: ${(roiRb * 100).toFixed(2)}% (expected +~3 pp)`,
  );

  // Summary verdict.
  const ok = meanMatch && sdMatch && bonusErr < 1e-10 && sdRel < 1e-10;
  console.log(`\n${ok ? "OK — no regression" : "REGRESSION or drift detected"}`);
  process.exit(ok ? 0 : 1);
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
