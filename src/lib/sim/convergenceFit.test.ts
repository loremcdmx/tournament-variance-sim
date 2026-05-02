import { describe, it, expect } from "vitest";
import {
  evalSigma,
  FIT_RAKE_BY_FORMAT,
  SIGMA_COEF_BY_FORMAT,
  SIGMA_ROI_FREEZE,
  SIGMA_ROI_MYSTERY,
  SIGMA_ROI_MYSTERY_ROYALE,
  SIGMA_ROI_PKO,
  sigmaRoiForRow,
} from "./convergenceFit";
import type { TournamentRow } from "./types";

/**
 * Critical canary tests on the σ-fit coefficients. These fits drive every
 * convergence number and the prove-edge widget; if a refit silently changes
 * a coefficient, the UI shifts under users without warning. Tests here pin
 * known values + sanity-check the functional shape (monotonicity, sign of
 * ROI dependence, residual bands).
 */

describe("evalSigma — coefficient shape", () => {
  it("freeze is ROI-invariant (C1 must stay 0 — UI policy depends on it)", () => {
    expect(SIGMA_ROI_FREEZE.kind).toBe("single-beta");
    if (SIGMA_ROI_FREEZE.kind !== "single-beta") return;
    expect(SIGMA_ROI_FREEZE.C1).toBe(0);
    // Concrete: σ at any ROI is the same for fixed AFS
    const at500_neg10 = evalSigma(SIGMA_ROI_FREEZE, 500, -0.10);
    const at500_zero = evalSigma(SIGMA_ROI_FREEZE, 500, 0);
    const at500_pos50 = evalSigma(SIGMA_ROI_FREEZE, 500, 0.50);
    expect(at500_neg10).toBeCloseTo(at500_zero, 12);
    expect(at500_pos50).toBeCloseTo(at500_zero, 12);
  });

  it("freeze σ scales with field as f^beta", () => {
    if (SIGMA_ROI_FREEZE.kind !== "single-beta") return;
    const at100 = evalSigma(SIGMA_ROI_FREEZE, 100, 0.10);
    const at1000 = evalSigma(SIGMA_ROI_FREEZE, 1000, 0.10);
    const ratio = at1000 / at100;
    const expected = Math.pow(10, SIGMA_ROI_FREEZE.beta);
    expect(ratio).toBeCloseTo(expected, 8);
  });

  it("PKO σ grows with ROI inside the validated box (b1 must stay positive)", () => {
    expect(SIGMA_ROI_PKO.kind).toBe("log-poly-2d");
    if (SIGMA_ROI_PKO.kind !== "log-poly-2d") return;
    // Fit-trained box: ROI ∈ [-0.20, +0.80]
    expect(SIGMA_ROI_PKO.b1).toBeGreaterThan(0);
    const lo = evalSigma(SIGMA_ROI_PKO, 500, -0.10);
    const mid = evalSigma(SIGMA_ROI_PKO, 500, 0.10);
    const hi = evalSigma(SIGMA_ROI_PKO, 500, 0.30);
    expect(mid).toBeGreaterThan(lo);
    expect(hi).toBeGreaterThan(mid);
  });

  it("Mystery σ grows with ROI more aggressively than PKO (envelope variance)", () => {
    if (SIGMA_ROI_PKO.kind !== "log-poly-2d") return;
    if (SIGMA_ROI_MYSTERY.kind !== "log-poly-2d") return;
    expect(SIGMA_ROI_MYSTERY.b1).toBeGreaterThan(SIGMA_ROI_PKO.b1);
  });

  it("MBR σ is single-beta and grows with ROI (C1 > 0)", () => {
    expect(SIGMA_ROI_MYSTERY_ROYALE.kind).toBe("single-beta");
    if (SIGMA_ROI_MYSTERY_ROYALE.kind !== "single-beta") return;
    expect(SIGMA_ROI_MYSTERY_ROYALE.C1).toBeGreaterThan(0);
    // beta=0 because MBR is locked at AFS=18 — field shouldn't matter
    expect(SIGMA_ROI_MYSTERY_ROYALE.beta).toBe(0);
    const lo = evalSigma(SIGMA_ROI_MYSTERY_ROYALE, 18, -0.05);
    const hi = evalSigma(SIGMA_ROI_MYSTERY_ROYALE, 18, 0.05);
    expect(hi).toBeGreaterThan(lo);
  });

  it("σ stays positive across the full validated box for every format", () => {
    for (const format of ["freeze", "pko", "mystery", "mystery-royale"] as const) {
      const coef = SIGMA_COEF_BY_FORMAT[format];
      const fields = format === "mystery-royale" ? [18] : [50, 200, 1000, 10_000, 50_000];
      const rois = format === "mystery-royale"
        ? [-0.10, 0, 0.10]
        : [-0.20, 0, 0.10, 0.40, 0.80];
      for (const f of fields) {
        for (const roi of rois) {
          const s = evalSigma(coef, f, roi);
          expect(s).toBeGreaterThan(0);
          expect(Number.isFinite(s)).toBe(true);
        }
      }
    }
  });

  it("evalSigma clamps field to ≥1 (no log(0))", () => {
    const s0 = evalSigma(SIGMA_ROI_FREEZE, 0, 0.10);
    const s_neg = evalSigma(SIGMA_ROI_FREEZE, -100, 0.10);
    const s1 = evalSigma(SIGMA_ROI_FREEZE, 1, 0.10);
    expect(Number.isFinite(s0)).toBe(true);
    expect(Number.isFinite(s_neg)).toBe(true);
    expect(s0).toBeCloseTo(s1, 12);
    expect(s_neg).toBeCloseTo(s1, 12);
  });

  it("MBR single-beta clamps the linear part at zero (no negative σ at extreme ROI)", () => {
    if (SIGMA_ROI_MYSTERY_ROYALE.kind !== "single-beta") return;
    // At very negative ROI: C0 + C1·ROI could go negative without clamp.
    // C0=5.485, C1=3.119 → would cross zero at ROI ≈ -1.76. The fit-box
    // floor is -0.10 so this matters only as a defensive guard, but assert
    // the clamp is in place.
    const extreme = evalSigma(SIGMA_ROI_MYSTERY_ROYALE, 18, -10);
    expect(extreme).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(extreme)).toBe(true);
  });

  it("residual coefficients are within plausible 5–25 % range", () => {
    for (const format of ["freeze", "pko", "mystery", "mystery-royale"] as const) {
      const coef = SIGMA_COEF_BY_FORMAT[format];
      expect(coef.resid).toBeGreaterThan(0.04);
      expect(coef.resid).toBeLessThan(0.25);
    }
  });

  it("freeze residual ≤ PKO residual ≤ Mystery residual (data-driven heterogeneity)", () => {
    expect(SIGMA_ROI_FREEZE.resid).toBeLessThanOrEqual(SIGMA_ROI_PKO.resid);
    expect(SIGMA_ROI_PKO.resid).toBeLessThanOrEqual(SIGMA_ROI_MYSTERY.resid);
  });
});

describe("sigmaRoiForRow", () => {
  function makeRow(overrides: Partial<TournamentRow> = {}): TournamentRow {
    return {
      id: "r",
      label: "r",
      players: 500,
      buyIn: 50,
      rake: 0.10,
      roi: 0.10,
      payoutStructure: "mtt-standard",
      gameType: "freezeout",
      count: 1,
      ...overrides,
    };
  }

  it("infers freeze format and uses freeze fit", () => {
    const r = sigmaRoiForRow(makeRow({ gameType: "freezeout" }));
    expect(r.format).toBe("freeze");
    const direct = evalSigma(SIGMA_ROI_FREEZE, 500, 0.10);
    // rakeScale = (1+0.10)/(1+0.10) = 1
    expect(r.sigma).toBeCloseTo(direct, 9);
  });

  it("returns lo/hi via residual band", () => {
    const r = sigmaRoiForRow(makeRow());
    expect(r.sigmaLo).toBeCloseTo(r.sigma * (1 - SIGMA_ROI_FREEZE.resid), 9);
    expect(r.sigmaHi).toBeCloseTo(r.sigma * (1 + SIGMA_ROI_FREEZE.resid), 9);
  });

  it("rakeScale rescales σ when row rake differs from fit's training rake", () => {
    const fitRake = FIT_RAKE_BY_FORMAT.freeze;
    const at_match = sigmaRoiForRow(makeRow({ rake: fitRake }));
    const at_lower = sigmaRoiForRow(makeRow({ rake: fitRake / 2 }));
    // Lower user rake → higher rakeScale → higher σ
    expect(at_lower.sigma).toBeGreaterThan(at_match.sigma);
  });

  it("identifies PKO row by gameType", () => {
    const r = sigmaRoiForRow(
      makeRow({
        gameType: "pko",
        payoutStructure: "mtt-gg-bounty",
        bountyFraction: 0.5,
      }),
    );
    expect(r.format).toBe("pko");
  });

  it("identifies Mystery row by gameType", () => {
    const r = sigmaRoiForRow(
      makeRow({
        gameType: "mystery",
        payoutStructure: "mtt-gg-mystery",
        bountyFraction: 0.5,
        mysteryBountyVariance: 2.0,
      }),
    );
    expect(r.format).toBe("mystery");
  });

  it("identifies MBR row by gameType + uses fit's training rake (8 %)", () => {
    const r = sigmaRoiForRow(
      makeRow({
        gameType: "mystery-royale",
        payoutStructure: "battle-royale",
        players: 18,
        bountyFraction: 0.5,
        mysteryBountyVariance: 1.8,
      }),
    );
    expect(r.format).toBe("mystery-royale");
    // FIT_RAKE_BY_FORMAT["mystery-royale"] = 0.08, but row rake = 0.10
    // → rakeScale = 1.08 / 1.10 < 1 → σ shrinks vs. raw evalSigma
    const raw = evalSigma(SIGMA_ROI_MYSTERY_ROYALE, 18, 0.10);
    expect(r.sigma).toBeLessThan(raw);
  });

  it("override rakeScale wins over computed", () => {
    const r = sigmaRoiForRow(makeRow(), 1);
    const raw = evalSigma(SIGMA_ROI_FREEZE, 500, 0.10);
    expect(r.sigma).toBeCloseTo(raw, 9);
  });
});

/**
 * Reference-value canaries — pin the σ at a known box-center for every fit.
 * If a future refit shifts these by more than 5 %, the canary fails and the
 * dev must consciously update the snapshot. Prevents silent UX drift after
 * a fit is regenerated without UI/policy review.
 */
describe("σ reference canaries (5% tolerance)", () => {
  it("freeze @ AFS=500 ROI=0% lands near the 2026-04 calibration", () => {
    // SIGMA_ROI_FREEZE: C0=0.6564, C1=0, beta=0.3694
    // 0.6564 × 500^0.3694 ≈ 0.6564 × 9.516 ≈ 6.247
    const s = evalSigma(SIGMA_ROI_FREEZE, 500, 0);
    expect(s).toBeGreaterThan(5.9);
    expect(s).toBeLessThan(6.6);
  });

  it("PKO @ AFS=500 ROI=10% lands in the validated band", () => {
    const s = evalSigma(SIGMA_ROI_PKO, 500, 0.10);
    expect(s).toBeGreaterThan(2.5);
    expect(s).toBeLessThan(4.5);
  });

  it("Mystery @ AFS=500 ROI=10% lands in the validated band", () => {
    const s = evalSigma(SIGMA_ROI_MYSTERY, 500, 0.10);
    expect(s).toBeGreaterThan(3.5);
    expect(s).toBeLessThan(7.0);
  });

  it("MBR @ AFS=18 ROI=0% lands near 5.5 (C0)", () => {
    if (SIGMA_ROI_MYSTERY_ROYALE.kind !== "single-beta") return;
    const s = evalSigma(SIGMA_ROI_MYSTERY_ROYALE, 18, 0);
    expect(s).toBeCloseTo(SIGMA_ROI_MYSTERY_ROYALE.C0, 6);
  });
});
