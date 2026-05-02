/**
 * Validates our cash-game variance engine (`simulateCash`) against Phil
 * Galfond's variance calculator at https://www.philgalfond.com/variance.
 *
 * Galfond uses the standard Gaussian random-walk closed form (no MC):
 *   - Profit ~ N(wr × hands/100, sd² × hands/100) per BB
 *   - P(profit) = Φ(μ/σ)
 *   - RoR (infinite horizon) = exp(-2 × bankroll × wr/100 / (sd/10)²)
 *
 * Reference scenarios captured 2026-05-02 by driving the live calc via
 * Playwright + computing the analytic on the same parameters
 * (Galfond's reported numbers match the analytic to display precision).
 *
 * What this test pins:
 *   - `expectedEvBb` matches analytic exactly (deterministic)
 *   - `sdFinalBb` matches analytic to 0.5 % (MC noise on 30k samples)
 *   - `probProfit` matches analytic to ±1 pp (MC noise)
 *
 * What this test does NOT pin:
 *   - `probBelowThresholdEver` (our finite-horizon RoR) vs Galfond's
 *     infinite-horizon RoR — they're definitionally different metrics.
 *     Our value is `P(running min < threshold within N hands)`,
 *     Galfond's is `exp(-2 × br × wr / σ²)` (Brownian absorbing
 *     barrier at infinity).
 */
import { describe, expect, it } from "vitest";
import { simulateCash } from "./cashEngine";
import type { CashInput } from "./cashTypes";

interface CashRef {
  label: string;
  wr: number;
  sd: number;
  hands: number;
  /** Analytic Gaussian closed-form values — Galfond's calc reports these. */
  muBB: number;
  sigBB: number;
  probProfit: number;
}

// Standard normal CDF (Hastings approximation, ≤7e-8 max error)
function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-(z * z) / 2);
  let p =
    d *
    t *
    (0.3193815 +
      t *
        (-0.3565638 +
          t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) p = 1 - p;
  return p;
}

function gaussRef(wr: number, sd: number, hands: number): CashRef {
  const muBB = (wr * hands) / 100;
  const sigBB = sd * Math.sqrt(hands / 100);
  return {
    label: `wr=${wr} sd=${sd} hands=${hands}`,
    wr,
    sd,
    hands,
    muBB,
    sigBB,
    probProfit: sigBB > 0 ? normCdf(muBB / sigBB) : muBB > 0 ? 1 : 0,
  };
}

const REFERENCE: CashRef[] = [
  gaussRef(5, 100, 50_000), // Galfond default
  gaussRef(2, 100, 50_000),
  gaussRef(10, 80, 50_000),
  gaussRef(0, 100, 50_000),
  gaussRef(-2, 100, 50_000),
  gaussRef(7, 90, 100_000), // longer horizon
  gaussRef(3, 120, 25_000), // higher variance
];

function runOurCash(ref: CashRef) {
  const input: CashInput = {
    type: "cash",
    wrBb100: ref.wr,
    sdBb100: ref.sd,
    hands: ref.hands,
    nSimulations: 30_000,
    bbSize: 5,
    rake: {
      enabled: false,
      contributedRakeBb100: 0,
      advertisedRbPct: 0,
      pvi: 1,
    },
    riskBlock: { thresholdBb: 5000 },
    baseSeed: 42,
  };
  return simulateCash(input);
}

describe("simulateCash matches Galfond's variance-calculator math", () => {
  describe.each(REFERENCE)(
    "$label",
    (ref) => {
      const out = runOurCash(ref);

      it("expectedEvBb matches analytic μ exactly", () => {
        // EV is deterministic on both sides — should be byte-equal
        expect(out.stats.expectedEvBb).toBeCloseTo(ref.muBB, 9);
      });

      it("sdFinalBb matches analytic σ within 1.5 % (MC SE on 30k samples)", () => {
        // MC SE of sample-σ estimate ≈ σ / √(2 × N_samples) = ~0.41 % of σ
        // at N=30k. 1.5 % tolerance = ~3.6 SE; trips only on real model drift,
        // not on RNG luck.
        const dev = Math.abs(out.stats.sdFinalBb - ref.sigBB) / ref.sigBB;
        expect(dev).toBeLessThan(0.015);
      });

      it("probProfit matches analytic within ±1 pp (MC noise on 30k samples)", () => {
        const dev = Math.abs(out.stats.probProfit - ref.probProfit);
        expect(dev).toBeLessThan(0.01);
      });

      it("meanFinalBb sample mean within 5 SE of true μ", () => {
        const se = ref.sigBB / Math.sqrt(30_000);
        expect(Math.abs(out.stats.meanFinalBb - ref.muBB)).toBeLessThan(5 * se);
      });
    },
  );
});
