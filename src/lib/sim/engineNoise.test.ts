/**
 * Tests for the engine's stochastic noise channels — tilt (fast / slow),
 * ROI shocks (per-tournament / per-session), and ROI drift. These channels
 * sit in the hot loop and ship to users via the controls panel; previously
 * none of them had assertions on actual integration into per-sample profit.
 *
 * Approach: run small simulations with one channel turned ON in isolation,
 * compare to a reference run where it's OFF. The directional / magnitude
 * effects are checked, not bit-exact values.
 */
import { describe, it, expect } from "vitest";
import { runSimulation } from "./engine";
import type { SimulationInput, TournamentRow } from "./types";

function freezeRow(): TournamentRow {
  return {
    id: "noise-row",
    label: "freeze noise probe",
    players: 200,
    buyIn: 50,
    rake: 0.10,
    roi: 0.10,
    payoutStructure: "mtt-standard",
    gameType: "freezeout",
    count: 1,
  };
}

function baseInput(overrides: Partial<SimulationInput> = {}): SimulationInput {
  return {
    schedule: [freezeRow()],
    scheduleRepeats: 200,
    samples: 4000,
    bankroll: 1_000_000,
    seed: 7,
    finishModel: { id: "power-law" },
    ...overrides,
  };
}

function variance(arr: Float64Array): number {
  let mean = 0;
  for (let i = 0; i < arr.length; i++) mean += arr[i];
  mean /= arr.length;
  let m2 = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] - mean;
    m2 += d * d;
  }
  return m2 / Math.max(1, arr.length - 1);
}

describe("engine — ROI shocks", () => {
  it("zero shock = baseline (deterministic given seed, identical bit-for-bit)", () => {
    const a = runSimulation(baseInput());
    const b = runSimulation(baseInput());
    expect(a.expectedProfit).toBe(b.expectedProfit);
    for (let i = 0; i < a.finalProfits.length; i++) {
      expect(a.finalProfits[i]).toBe(b.finalProfits[i]);
    }
  });

  it("per-tourney shock keeps mean near target (zero-mean)", () => {
    const shocked = runSimulation(
      baseInput({ samples: 12_000, roiShockPerTourney: 0.10 }),
    );
    const buyIn = 50 * 1.10;
    const totalCost = buyIn * 200;
    expect(shocked.expectedProfit / totalCost).toBeCloseTo(0.10, 1);
  });

  it("per-tourney shock activates (result paths differ from baseline)", () => {
    const baseline = runSimulation(baseInput());
    const shocked = runSimulation(baseInput({ roiShockPerTourney: 0.10 }));
    // RNG sequence diverges as shocks consume gauss draws → finalProfits
    // can't be bit-identical
    let identical = true;
    for (let i = 0; i < baseline.finalProfits.length; i++) {
      if (baseline.finalProfits[i] !== shocked.finalProfits[i]) {
        identical = false;
        break;
      }
    }
    expect(identical).toBe(false);
  });

  it("ROI std-err shock keeps mean near target (zero-mean per sample)", () => {
    const withErr = runSimulation(
      baseInput({ samples: 12_000, roiStdErr: 0.10 }),
    );
    const buyIn = 50 * 1.10;
    const totalCost = buyIn * 200;
    expect(withErr.expectedProfit / totalCost).toBeCloseTo(0.10, 1);
  });

  it("ROI std-err inflates cross-sample variance (each sample uses a perturbed ROI)", () => {
    const baseline = runSimulation(baseInput({ samples: 12_000 }));
    const withErr = runSimulation(
      baseInput({ samples: 12_000, roiStdErr: 0.20 }),
    );
    expect(variance(withErr.finalProfits)).toBeGreaterThan(
      variance(baseline.finalProfits) * 1.10,
    );
  });

  it("drift sigma keeps mean intact and produces finite results", () => {
    const withDrift = runSimulation(
      baseInput({ samples: 12_000, roiDriftSigma: 0.10 }),
    );
    expect(Number.isFinite(withDrift.expectedProfit)).toBe(true);
    const buyIn = 50 * 1.10;
    const totalCost = buyIn * 200;
    // Drift can perturb mean modestly per sample but should average out
    expect(withDrift.expectedProfit / totalCost).toBeCloseTo(0.10, 0);
  });
});

describe("engine — tilt fast", () => {
  it("zero gain ≡ no effect (deterministic match)", () => {
    const off = runSimulation(baseInput());
    const onZero = runSimulation(baseInput({ tiltFastGain: 0, tiltFastScale: 5000 }));
    for (let i = 0; i < off.finalProfits.length; i++) {
      expect(onZero.finalProfits[i]).toBeCloseTo(off.finalProfits[i], 9);
    }
  });

  it("negative gain is a tilter: lowers mean and p05 and deepens drawdowns", () => {
    const baseline = runSimulation(baseInput());
    const tilted = runSimulation(
      baseInput({ tiltFastGain: -0.30, tiltFastScale: 2000 }),
    );
    expect(tilted.stats.mean).toBeLessThan(baseline.stats.mean);
    expect(tilted.stats.p05).toBeLessThan(baseline.stats.p05);
    expect(tilted.stats.maxDrawdownMean).toBeGreaterThan(
      baseline.stats.maxDrawdownMean,
    );
  });

  it("positive gain plays sharper when down: raises mean and p05", () => {
    const baseline = runSimulation(baseInput());
    const steadied = runSimulation(
      baseInput({ tiltFastGain: 0.30, tiltFastScale: 2000 }),
    );
    expect(steadied.stats.mean).toBeGreaterThan(baseline.stats.mean);
    expect(steadied.stats.p05).toBeGreaterThan(baseline.stats.p05);
  });

  it("reacts to the current drawdown instead of applying a permanent gain bias", () => {
    // A saturated channel would cost the full |gain| on every entry. The tanh
    // argument resets whenever the path makes a new high, so the realized ROI
    // penalty must stay well short of that ceiling.
    const baseline = runSimulation(baseInput());
    const tilted = runSimulation(
      baseInput({ tiltFastGain: -0.30, tiltFastScale: 2000 }),
    );
    const penalty = baseline.stats.mean - tilted.stats.mean;
    expect(penalty).toBeGreaterThan(0);
    expect(penalty).toBeLessThan(0.30 * tilted.totalBuyIn * 0.8);
  });

  it("scale sets the activation depth: shallower scale bites harder", () => {
    const baseline = runSimulation(baseInput());
    const tight = runSimulation(
      baseInput({ tiltFastGain: -0.30, tiltFastScale: 500 }),
    );
    const mid = runSimulation(
      baseInput({ tiltFastGain: -0.30, tiltFastScale: 2000 }),
    );
    const loose = runSimulation(
      baseInput({ tiltFastGain: -0.30, tiltFastScale: 50_000 }),
    );
    expect(tight.stats.mean).toBeLessThan(mid.stats.mean);
    expect(mid.stats.mean).toBeLessThan(loose.stats.mean);
    expect(loose.stats.mean).toBeLessThan(baseline.stats.mean);
  });

  it("tiltFastScale is clamped to ≥1 (no div-by-zero crash)", () => {
    const r = runSimulation(
      baseInput({ tiltFastGain: -0.30, tiltFastScale: 0 }),
    );
    expect(Number.isFinite(r.expectedProfit)).toBe(true);
    for (let i = 0; i < r.finalProfits.length; i++) {
      expect(Number.isFinite(r.finalProfits[i])).toBe(true);
    }
  });
});

describe("engine — tilt slow (state machine)", () => {
  it("threshold = 0 → tilt OFF (engine gate)", () => {
    const a = runSimulation(baseInput());
    const b = runSimulation(
      baseInput({
        tiltSlowGain: -0.10,
        tiltSlowThreshold: 0,
        tiltSlowMinDuration: 10,
        tiltSlowRecoveryFrac: 0.5,
      }),
    );
    for (let i = 0; i < a.finalProfits.length; i++) {
      expect(b.finalProfits[i]).toBeCloseTo(a.finalProfits[i], 9);
    }
  });

  it("min-duration = 0 → tilt OFF (engine gate)", () => {
    const a = runSimulation(baseInput());
    const b = runSimulation(
      baseInput({
        tiltSlowGain: -0.10,
        tiltSlowThreshold: 100,
        tiltSlowMinDuration: 0,
        tiltSlowRecoveryFrac: 0.5,
      }),
    );
    for (let i = 0; i < a.finalProfits.length; i++) {
      expect(b.finalProfits[i]).toBeCloseTo(a.finalProfits[i], 9);
    }
  });

  it("gain = 0 → tilt OFF (engine gate)", () => {
    const a = runSimulation(baseInput());
    const b = runSimulation(
      baseInput({
        tiltSlowGain: 0,
        tiltSlowThreshold: 100,
        tiltSlowMinDuration: 50,
        tiltSlowRecoveryFrac: 0.5,
      }),
    );
    for (let i = 0; i < a.finalProfits.length; i++) {
      expect(b.finalProfits[i]).toBeCloseTo(a.finalProfits[i], 9);
    }
  });

  // Longer schedule + break-even ROI so swings are wide enough to trip the
  // state machine in both directions.
  const longFlat = (overrides: Partial<SimulationInput> = {}): SimulationInput =>
    baseInput({
      scheduleRepeats: 1000,
      schedule: [{ ...freezeRow(), roi: 0 }],
      samples: 800,
      ...overrides,
    });

  // Sign convention here is the mirror of tiltFastGain: the `down` state
  // shifts ROI by −tiltSlowGain, so the tilter is the POSITIVE gain.
  const slowTilt = (
    gain: number,
    minDuration = 30,
  ): SimulationInput =>
    longFlat({
      tiltSlowGain: gain,
      tiltSlowThreshold: 100,
      tiltSlowMinDuration: minDuration,
      tiltSlowRecoveryFrac: 0.5,
    });

  it("positive gain is a tilter: lowers mean and p05 and deepens drawdowns", () => {
    const baseline = runSimulation(longFlat());
    const tilted = runSimulation(slowTilt(0.20));
    expect(tilted.stats.mean).toBeLessThan(baseline.stats.mean);
    expect(tilted.stats.p05).toBeLessThan(baseline.stats.p05);
    expect(tilted.stats.maxDrawdownMean).toBeGreaterThan(
      baseline.stats.maxDrawdownMean,
    );
  });

  it("negative gain fights back on downswings: raises mean and p05", () => {
    const baseline = runSimulation(longFlat());
    const steadied = runSimulation(slowTilt(-0.20));
    expect(steadied.stats.mean).toBeGreaterThan(baseline.stats.mean);
    expect(steadied.stats.p05).toBeGreaterThan(baseline.stats.p05);
  });

  it("longer required streak means less time tilted", () => {
    const baseline = runSimulation(longFlat());
    const quick = runSimulation(slowTilt(0.20, 30));
    const slow = runSimulation(slowTilt(0.20, 300));
    expect(quick.stats.mean).toBeLessThan(slow.stats.mean);
    expect(slow.stats.mean).toBeLessThan(baseline.stats.mean);
  });
});
