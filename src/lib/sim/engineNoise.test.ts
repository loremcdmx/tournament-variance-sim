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

  it("active fast tilt changes per-sample variance (drawdown↔upswing transfer)", () => {
    // Tilt fast trades ROI between drawdown and upswing regimes. On
    // average the symmetry preserves mean but inflates per-sample variance
    // because individual paths diverge based on which regime they spend
    // more time in.
    const baseline = runSimulation(baseInput());
    const tilted = runSimulation(
      baseInput({ tiltFastGain: -0.30, tiltFastScale: 2000 }),
    );
    expect(variance(tilted.finalProfits)).not.toBeCloseTo(
      variance(baseline.finalProfits),
      0,
    );
  });

  it("scale parameter changes the tilt's activation depth (different variance signature)", () => {
    const tight = runSimulation(
      baseInput({ tiltFastGain: -0.30, tiltFastScale: 500 }),
    );
    const loose = runSimulation(
      baseInput({ tiltFastGain: -0.30, tiltFastScale: 50_000 }),
    );
    // Different scales produce different variance signatures
    expect(variance(tight.finalProfits)).not.toBeCloseTo(
      variance(loose.finalProfits),
      0,
    );
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

  it("active slow tilt changes the result distribution (state-machine engaged on long runs)", () => {
    // Use a longer schedule + lower ROI so drawdowns are wide enough to
    // trigger the tiltSlow state machine.
    const longLossy = (overrides: Partial<SimulationInput> = {}): SimulationInput =>
      baseInput({
        scheduleRepeats: 1000,
        schedule: [{ ...freezeRow(), roi: 0 }],
        samples: 800,
        ...overrides,
      });
    const baseline = runSimulation(longLossy());
    const tilted = runSimulation(
      longLossy({
        tiltSlowGain: -0.20,
        tiltSlowThreshold: 100,
        tiltSlowMinDuration: 30,
        tiltSlowRecoveryFrac: 0.5,
      }),
    );
    expect(variance(tilted.finalProfits)).not.toBeCloseTo(
      variance(baseline.finalProfits),
      0,
    );
  });
});
