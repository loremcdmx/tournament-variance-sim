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
import { compileSchedule, makeCheckpointGrid, runSimulation, simulateShard } from "./engine";
import { STREAM_FINISH, sampleStream } from "./rng";
import type {
  SimulationInput,
  SimulationResult,
  TournamentRow,
} from "./types";

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

/** Realized schedule ROI and its Monte Carlo standard error. `expectedProfit`
 *  is a compile-time constant no hot-loop channel can move, so mean checks
 *  must read the sampled profits. */
function realizedRoi(r: SimulationResult): { roi: number; se: number } {
  return {
    roi: r.stats.mean / r.totalBuyIn,
    se: r.stats.stdDev / Math.sqrt(r.samples) / r.totalBuyIn,
  };
}

const TARGET_ROI = 0.10;
// se ≈ 0.003 at 12k samples on this schedule, so 3.5·se pins any channel
// bias below ~1 ROI point.
const SE_CEILING = 0.005;

describe("engine — ROI shocks", () => {
  it("zero shock = baseline (deterministic given seed, identical bit-for-bit)", () => {
    const a = runSimulation(baseInput());
    const b = runSimulation(baseInput());
    expect(a.expectedProfit).toBe(b.expectedProfit);
    for (let i = 0; i < a.finalProfits.length; i++) {
      expect(a.finalProfits[i]).toBe(b.finalProfits[i]);
    }
  });

  it("per-tourney shock is zero-mean: realized ROI stays within 3.5 SE of target", () => {
    const shocked = runSimulation(
      baseInput({ samples: 12_000, roiShockPerTourney: 0.10 }),
    );
    const { roi, se } = realizedRoi(shocked);
    expect(se).toBeLessThan(SE_CEILING);
    expect(Math.abs(roi - TARGET_ROI)).toBeLessThan(3.5 * se);
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

  it("ROI std-err is zero-mean per sample: realized ROI stays within 3.5 SE of target", () => {
    const withErr = runSimulation(
      baseInput({ samples: 12_000, roiStdErr: 0.10 }),
    );
    const { roi, se } = realizedRoi(withErr);
    expect(se).toBeLessThan(SE_CEILING);
    expect(Math.abs(roi - TARGET_ROI)).toBeLessThan(3.5 * se);
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

  it("drift is zero-mean: realized ROI stays within 3.5 SE of target", () => {
    const withDrift = runSimulation(
      baseInput({ samples: 12_000, roiDriftSigma: 0.10 }),
    );
    const { roi, se } = realizedRoi(withDrift);
    expect(Number.isFinite(roi)).toBe(true);
    expect(se).toBeLessThan(SE_CEILING);
    expect(Math.abs(roi - TARGET_ROI)).toBeLessThan(3.5 * se);
  });

  it("drift inflates cross-sample variance by the AR(1) closed form", () => {
    const samples = 12_000;
    const sigma = 0.10;
    const rho = 0.95;
    const N = 200;
    const single = 50 * 1.10;
    const baseline = runSimulation(baseInput({ samples }));
    const withDrift = runSimulation(
      baseInput({ samples, roiDriftSigma: sigma, roiDriftRho: rho }),
    );

    // Single-row schedule ⇒ one pass per tournament, so the AR(1) steps once
    // per entry: d_i = ρ·d_{i−1} + ε_i, ε ~ N(0, σ²(1−ρ²)), d_{−1} = 0.
    // Var(d_i) = σ²(1−ρ^{2(i+1)}), Cov(d_i, d_j) = ρ^{j−i}·Var(d_i) for i<j.
    // Each entry's profit gains d_i·single, so the sample profit picks up
    // D = single·Σd_i on top of the finish draws.
    let varSumDrift = 0;
    for (let i = 0; i < N; i++) {
      const vi = sigma * sigma * (1 - Math.pow(rho, 2 * (i + 1)));
      varSumDrift += vi;
      for (let j = i + 1; j < N; j++) {
        varSumDrift += 2 * Math.pow(rho, j - i) * vi;
      }
    }
    const theoryExcess = single * single * varSumDrift;

    // The finish stream is seeded independently of the shock stream, so both
    // runs share byte-identical finish draws and differ only by D:
    //   Var̂_on − Var̂_off = Var̂(D) + 2·Côv(base, D)
    //   SE² ≈ 2·σ_D⁴/n + 4·σ_base²·σ_D²/n
    // Power at σ=0.10, ρ=0.95, N=200, n=12k: theoryExcess ≈ 2.0e5 against
    // SE ≈ 2.9e4, i.e. the expected excess is ≈ 7 SE — a missing or
    // mis-scaled drift channel fails by a wide margin. (Two independently
    // seeded runs would put the same excess at ≈ 1 SE of variance noise.)
    const varBase = variance(baseline.finalProfits);
    const se = Math.sqrt(
      (2 * theoryExcess * theoryExcess + 4 * varBase * theoryExcess) / samples,
    );
    expect(theoryExcess / se).toBeGreaterThan(5);

    const measuredExcess =
      variance(withDrift.finalProfits) - variance(baseline.finalProfits);
    expect(Math.abs(measuredExcess - theoryExcess)).toBeLessThan(4 * se);
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

function shardFinals(input: SimulationInput, from = 0, to = input.samples): Float64Array {
  const compiled = compileSchedule(input, "alpha");
  const grid = makeCheckpointGrid(compiled.tournamentsPerSample);
  return simulateShard(input, compiled, from, to, grid).finalProfits;
}

function meanAndSe(xs: ArrayLike<number>): { mean: number; se: number } {
  let mean = 0;
  for (let i = 0; i < xs.length; i++) mean += xs[i];
  mean /= xs.length;
  let m2 = 0;
  for (let i = 0; i < xs.length; i++) m2 += (xs[i] - mean) ** 2;
  return { mean, se: Math.sqrt(m2 / (xs.length - 1) / xs.length) };
}

describe("engine — slow tilt on the drift-free path", () => {
  it("follows the documented state machine on profit minus the expected-profit line", () => {
    // An independent replica written from the types.ts description: both
    // swings and both exits are read on x = profit − Σ E[profit] of the
    // entries played so far. A small threshold makes it switch often.
    const input = baseInput({
      scheduleRepeats: 2000,
      samples: 40,
      rakebackFracOfRake: 0.3,
      tiltSlowGain: 0.08,
      tiltSlowThreshold: 400,
      tiltSlowMinDuration: 25,
      tiltSlowRecoveryFrac: 0.5,
    });
    const compiled = compileSchedule(input, "alpha");
    const engine = shardFinals(input);
    const e = compiled.flat[0];
    const step = e.analyticMeanSingle - e.singleCost + e.rakebackBonusPerBullet;
    let up = 0;
    let down = 0;
    for (let s = 0; s < input.samples; s++) {
      const rng = sampleStream(input.seed, s, STREAM_FINISH);
      let profit = 0;
      let expected = 0;
      let xMax = 0;
      let xMin = 0;
      let state = 0;
      let anchor = 0;
      let swing = 0;
      let streak = 0;
      let streakSide = 0;
      for (let i = 0; i < compiled.tournamentsPerSample; i++) {
        const x = profit - expected;
        let shift = 0;
        if (state === 0) {
          const side = xMax - x >= 400 ? -1 : x - xMin >= 400 ? 1 : 0;
          if (side !== streakSide) streak = 0;
          streakSide = side;
          if (side !== 0 && ++streak >= 25) {
            state = side;
            anchor = x;
            swing = side === -1 ? xMax - x : x - xMin;
            streak = 0;
            streakSide = 0;
          }
        } else if (state === -1) {
          shift = -0.08;
          down++;
          if (x - anchor >= 0.5 * swing) state = 0;
        } else {
          shift = 0.08;
          up++;
          if (anchor - x >= 0.5 * swing) state = 0;
        }
        const r = rng() * e.aliasProb.length;
        const k = r | 0;
        const place = r - k < e.aliasProb[k] ? k : e.aliasIdx[k];
        profit += e.prizeByPlace[place] - (e.singleCost - shift * e.singleCost) + e.rakebackBonusPerBullet;
        expected += step;
        const xAfter = profit - expected;
        if (xAfter > xMax) xMax = xAfter;
        if (xAfter < xMin) xMin = xAfter;
      }
      expect(engine[s], `sample ${s}`).toBe(profit);
    }
    expect(up).toBeGreaterThan(0);
    expect(down).toBeGreaterThan(0);
  });

  it("treats a winner and a loser alike: the ROI shift stays near zero for both", () => {
    // On the raw path a winner's rise from the all-time low only grows, so
    // the old reference kept a +20 % player in "up" (+4.6 pp of ROI here) and
    // a −20 % player in "down" (−4.6 pp). The bound is 4 SE (SE ≈ 0.19 pp at
    // 400 samples) and 1 pp; the seed is fixed, so it cannot flake.
    for (const roi of [0.2, -0.2]) {
      const clean = baseInput({
        schedule: [{ ...freezeRow(), roi }],
        scheduleRepeats: 10_000,
        samples: 400,
      });
      const tilted = {
        ...clean,
        tiltSlowGain: 0.05,
        tiltSlowThreshold: 5500,
        tiltSlowMinDuration: 200,
        tiltSlowRecoveryFrac: 0.5,
      };
      const cost = compileSchedule(clean, "alpha").totalBuyIn;
      const on = shardFinals(tilted);
      const off = shardFinals(clean);
      const shift = meanAndSe(Array.from(on, (p, i) => ((p - off[i]) / cost) * 100));
      expect(Math.abs(shift.mean), `ROI ${roi}`).toBeLessThan(Math.min(1, 4 * shift.se));
    }
  });
});

describe("engine — session length", () => {
  const sessionNoise = { roiShockPerSession: 0.2, roiDriftSigma: 0.05 };

  it("an unset length keeps one session per schedule pass, bit for bit", () => {
    const passes = baseInput({
      schedule: [freezeRow(), { ...freezeRow(), id: "b", buyIn: 20, count: 3 }],
      scheduleRepeats: 50,
      samples: 300,
      ...sessionNoise,
    });
    const unset = shardFinals(passes);
    const perPass = shardFinals({ ...passes, tournamentsPerSession: 4 });
    expect(Array.from(perPass)).toEqual(Array.from(unset));
    expect(Array.from(shardFinals({ ...passes, tournamentsPerSession: 7 }))).not.toEqual(Array.from(unset));
  });

  it("does not depend on how the same distance is stored: one pass of 4,000 = 80 passes of 50", () => {
    const noisy = (count: number, scheduleRepeats: number) =>
      baseInput({
        schedule: [{ ...freezeRow(), count }],
        scheduleRepeats,
        samples: 500,
        tournamentsPerSession: 50,
        ...sessionNoise,
      });
    expect(Array.from(shardFinals(noisy(4000, 1)))).toEqual(Array.from(shardFinals(noisy(50, 80))));
  });

  it("gives the same spread when the row order differs too", () => {
    // Two rows, stored as [a, b] × 1 and as [b, a] × 80: different pass
    // order, so not the same bytes, but the same distribution. Without the
    // session length the first run would be one session (shock σ 0.2 on the
    // whole run) and the second 80. The bound is 4 SE of the difference of
    // two sd estimates (4th-moment SE); fixed seed, so it cannot flake.
    const a = freezeRow();
    const b = { ...freezeRow(), id: "b", buyIn: 20 };
    const run = (schedule: TournamentRow[], scheduleRepeats: number) =>
      shardFinals(baseInput({ schedule, scheduleRepeats, samples: 3000, tournamentsPerSession: 50, ...sessionNoise }));
    const sdAndSe = (xs: Float64Array) => {
      const { mean } = meanAndSe(xs);
      let m2 = 0;
      let m4 = 0;
      for (const x of xs) {
        m2 += (x - mean) ** 2;
        m4 += (x - mean) ** 4;
      }
      m2 /= xs.length;
      m4 /= xs.length;
      const sd = Math.sqrt(m2);
      return { sd, se: Math.sqrt((m4 - m2 * m2) / xs.length) / (2 * sd) };
    };
    const one = sdAndSe(run([{ ...a, count: 2000 }, { ...b, count: 2000 }], 1));
    const many = sdAndSe(run([{ ...b, count: 25 }, { ...a, count: 25 }], 80));
    expect(Math.abs(one.sd - many.sd)).toBeLessThan(4 * Math.hypot(one.se, many.se));
  });

  it("redraws the session shock every that many tournaments: the variance closed form", () => {
    // Session shock alone, L = 50 tournaments, N = 2000: each sample gains
    // D = single · σ · Σ_sessions L · z, Var(D) = single² σ² L N. The finish
    // stream is shared with the clean run, so (as in the drift test)
    // SE² ≈ (2 Var(D)² + 4 Var_base Var(D)) / n. A length read as one pass
    // (one tournament here) would give 1/50 of the excess.
    const samples = 4000;
    const sigma = 0.2;
    const L = 50;
    const clean = baseInput({ scheduleRepeats: 2000, samples });
    const shocked = { ...clean, roiShockPerSession: sigma, tournamentsPerSession: L };
    const single = 50 * 1.1;
    const theory = single * single * sigma * sigma * L * 2000;
    const off = shardFinals(clean);
    const varBase = variance(off);
    const se = Math.sqrt((2 * theory * theory + 4 * varBase * theory) / samples);
    expect(theory / se).toBeGreaterThan(8);
    const measured = variance(shardFinals(shocked)) - varBase;
    expect(Math.abs(measured - theory)).toBeLessThan(4 * se);
  });

  it("counts sessions within the sample, so shard boundaries do not move them", () => {
    const input = baseInput({ scheduleRepeats: 300, samples: 90, tournamentsPerSession: 37, ...sessionNoise });
    const whole = shardFinals(input);
    const split = [...shardFinals(input, 0, 31), ...shardFinals(input, 31, 90)];
    expect(split).toEqual(Array.from(whole));
  });
});
