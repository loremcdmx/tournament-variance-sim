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
 *   - `sdFinalBb`, `probProfit`, `meanFinalBb` match analytic within 4-5 MC
 *     standard errors of the sample count the engine ACTUALLY runs
 *
 * The fixtures ask for 30k samples, but `normalizeCashInput` caps
 * samples × hands at `MAX_TOTAL_SIM_HANDS`, so a 50k-hand scenario runs
 * 4 000 paths (2 000 at 100k hands). Tolerances are derived from
 * `out.samples`, not from the requested count — an earlier fixed 1.5 %
 * σ tolerance was ~1.3 SE at 4 000 paths and only held on one lucky seed.
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
  /** Bankroll for asymptotic RoR check, in BB. */
  bankrollBB: number;
  /** Analytic Gaussian closed-form values — Galfond's calc reports these. */
  muBB: number;
  sigBB: number;
  probProfit: number;
  /** Galfond closed-form infinite-horizon RoR. */
  ror: number;
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

function gaussRef(
  wr: number,
  sd: number,
  hands: number,
  bankrollBB = 5000,
): CashRef {
  const muBB = (wr * hands) / 100;
  const sigBB = sd * Math.sqrt(hands / 100);
  // Galfond RoR: closed-form Brownian absorbing barrier
  // exp(-2 × br × wr_bb100 / sd_bb100²); RoR = 1 when wr ≤ 0.
  const ror =
    wr <= 0 ? 1 : Math.exp((-2 * bankrollBB * wr) / (sd * sd));
  return {
    label: `wr=${wr} sd=${sd} hands=${hands} br=${bankrollBB}BB`,
    wr,
    sd,
    hands,
    bankrollBB,
    muBB,
    sigBB,
    probProfit: sigBB > 0 ? normCdf(muBB / sigBB) : muBB > 0 ? 1 : 0,
    ror,
  };
}

const REFERENCE: CashRef[] = [
  gaussRef(5, 100, 50_000, 5000), // Galfond default
  gaussRef(2, 100, 50_000, 5000),
  gaussRef(10, 80, 50_000, 3000),
  gaussRef(0, 100, 50_000, 5000),
  gaussRef(-2, 100, 50_000, 5000),
  gaussRef(7, 90, 100_000, 4000), // longer horizon
  gaussRef(3, 120, 25_000, 6000), // higher variance
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
    riskBlock: { thresholdBb: ref.bankrollBB },
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

      it("sdFinalBb matches analytic σ within 4 MC SE of the realized sample count", () => {
        // Sample-σ SE ≈ σ / √(2 × samples) — ~1.1 % at the 4 000 paths the
        // hands budget allows here. 4 SE trips on real model drift, not RNG luck.
        const seRel = 1 / Math.sqrt(2 * out.samples);
        const dev = Math.abs(out.stats.sdFinalBb - ref.sigBB) / ref.sigBB;
        expect(dev).toBeLessThan(4 * seRel);
      });

      it("probProfit matches analytic within 4 MC SE of the realized sample count", () => {
        const p = ref.probProfit;
        const se = Math.sqrt((p * (1 - p)) / out.samples);
        const dev = Math.abs(out.stats.probProfit - p);
        expect(dev).toBeLessThan(4 * se);
      });

      it("meanFinalBb sample mean within 5 SE of true μ", () => {
        const se = ref.sigBB / Math.sqrt(out.samples);
        expect(Math.abs(out.stats.meanFinalBb - ref.muBB)).toBeLessThan(5 * se);
      });

      it("riskOfRuinAsymptotic matches Galfond's closed-form Brownian RoR", () => {
        // No MC noise on this — pure closed-form. Should match to ~1e-12.
        expect(out.stats.riskOfRuinAsymptotic).toBeCloseTo(ref.ror, 9);
      });
    },
  );
});
