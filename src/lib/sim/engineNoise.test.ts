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
import { DICT } from "@/lib/i18n/dict";
import { SCENARIOS } from "@/lib/scenarios";
import { buildSimulationInput } from "@/lib/ui/simulationInput";
import { compileSchedule, makeCheckpointGrid, runSimulation, simulateShard } from "./engine";
import { applyItmTarget } from "./itmTarget";
import { STANDARD_PRESETS, applyModelPatch } from "./modelPresets";
import { STREAM_FINISH, STREAM_SKILL, sampleStream } from "./rng";
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
    // entries played so far. A small threshold makes it switch often, and a
    // recovery share of 0.25 tells r from 1 - r.
    const input = baseInput({
      scheduleRepeats: 2000,
      samples: 40,
      rakebackFracOfRake: 0.3,
      tiltSlowGain: 0.08,
      tiltSlowThreshold: 400,
      tiltSlowMinDuration: 25,
      tiltSlowRecoveryFrac: 0.25,
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
          if (x - anchor >= 0.25 * swing) state = 0;
        } else {
          shift = 0.08;
          up++;
          if (anchor - x >= 0.25 * swing) state = 0;
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

// Independent replicas of the windowed tilts on a one-row freezeout: the slow
// one keeps its window extremes in monotonic deques, the fast one scans the
// stored path back W points; neither uses the hot loop's blocks.
function scanExtremes(path: Float64Array, i: number, window: number): { hi: number; lo: number } {
  let hi = -Infinity;
  let lo = Infinity;
  for (let j = Math.max(0, i - window); j <= i; j++) {
    if (path[j] > hi) hi = path[j];
    if (path[j] < lo) lo = path[j];
  }
  return { hi, lo };
}

interface SlowReplay {
  finals: number[];
  /** Share of each sample's first `checkpoint` tournaments spent in a tilt state. */
  shares: number[][];
  up: number;
  down: number;
  /** Exits the anchored all-time rule would also have taken, and the rest. */
  anchoredExits: number;
  forgottenExits: number;
  /** Per finished state: tournaments played in it, and the share of its swing won back by the exit. */
  lengths: number[];
  wonBack: number[];
}

// The engine's per-sample ROI noise, drawn in its order from STREAM_SKILL by
// a Marsaglia polar pair (u·m first, v·m cached for the next call).
function polarGauss(rng: () => number): () => number {
  let cached: number | null = null;
  return () => {
    if (cached !== null) {
      const v = cached;
      cached = null;
      return v;
    }
    let u: number;
    let v: number;
    let s: number;
    do {
      u = rng() * 2 - 1;
      v = rng() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    cached = v * m;
    return u * m;
  };
}

function replaySlowWindow(input: SimulationInput, checkpoints: number[] = []): SlowReplay {
  const compiled = compileSchedule(input, "alpha");
  const e = compiled.flat[0];
  const step = e.analyticMeanSingle - e.singleCost + e.rakebackBonusPerBullet;
  const n = compiled.tournamentsPerSample;
  const window = input.tiltSlowWindow!;
  const threshold = input.tiltSlowThreshold!;
  const minDuration = input.tiltSlowMinDuration!;
  const gain = input.tiltSlowGain!;
  const recovery = input.tiltSlowRecoveryFrac!;
  const stdErr = input.roiStdErr ?? 0;
  const perTourney = input.roiShockPerTourney ?? 0;
  const perSession = input.roiShockPerSession ?? 0;
  const driftSigma = input.roiDriftSigma ?? 0;
  const rho = 0.95;
  const innovation = driftSigma * Math.sqrt(1 - rho * rho);
  const sessionLength = input.tournamentsPerSession ?? compiled.tournamentsPerPass;
  const xs = new Float64Array(n + 1);
  const maxQ = new Int32Array(n + 1);
  const minQ = new Int32Array(n + 1);
  const out: SlowReplay = {
    finals: [],
    shares: checkpoints.map(() => []),
    up: 0,
    down: 0,
    anchoredExits: 0,
    forgottenExits: 0,
    lengths: [],
    wonBack: [],
  };
  for (let s = 0; s < input.samples; s++) {
    const rng = sampleStream(input.seed, s, STREAM_FINISH);
    const gauss = polarGauss(sampleStream(input.seed, s, STREAM_SKILL));
    const skill = stdErr > 0 ? gauss() * stdErr : 0;
    let drift = 0;
    let sessionShock = 0;
    let profit = 0;
    let expected = 0;
    let state = 0;
    let anchor = 0;
    let swing = 0;
    let enteredAt = 0;
    let streak = 0;
    let streakSide = 0;
    let up = 0;
    let down = 0;
    let c = 0;
    let maxHead = 0;
    let maxTail = 0;
    let minHead = 0;
    let minTail = 0;
    for (let i = 0; i < n; i++) {
      const x = xs[i];
      while (maxTail > maxHead && xs[maxQ[maxTail - 1]] <= x) maxTail--;
      maxQ[maxTail++] = i;
      while (minTail > minHead && xs[minQ[minTail - 1]] >= x) minTail--;
      minQ[minTail++] = i;
      while (maxQ[maxHead] < i - window) maxHead++;
      while (minQ[minHead] < i - window) minHead++;
      const hi = xs[maxQ[maxHead]];
      const lo = xs[minQ[minHead]];
      if (i % sessionLength === 0) {
        if (perSession > 0) sessionShock = gauss() * perSession;
        if (driftSigma > 0) drift = rho * drift + gauss() * innovation;
      }
      const tourneyShock = perTourney > 0 ? gauss() * perTourney : 0;
      let shift = 0;
      if (state === 0) {
        const side = hi - x >= threshold ? -1 : x - lo >= threshold ? 1 : 0;
        if (side !== streakSide) streak = 0;
        streakSide = side;
        if (side !== 0 && ++streak >= minDuration) {
          state = side;
          anchor = x;
          swing = side === -1 ? hi - x : x - lo;
          enteredAt = i;
          streak = 0;
          streakSide = 0;
        }
      } else {
        shift = state * gain;
        if (state === -1) down++;
        else up++;
        const remaining = state === -1 ? hi - x : x - lo;
        if (remaining <= (1 - recovery) * swing) {
          const won = (state * (anchor - x)) / swing;
          if (won >= recovery) out.anchoredExits++;
          else out.forgottenExits++;
          out.lengths.push(i - enteredAt);
          out.wonBack.push(won);
          state = 0;
        }
      }
      const delta = skill + drift + sessionShock + tourneyShock + shift;
      const r = rng() * e.aliasProb.length;
      const k = r | 0;
      const place = r - k < e.aliasProb[k] ? k : e.aliasIdx[k];
      profit += e.prizeByPlace[place] - (e.singleCost - delta * e.singleCost) + e.rakebackBonusPerBullet;
      expected += step;
      xs[i + 1] = profit - expected;
      if (c < checkpoints.length && i + 1 === checkpoints[c]) out.shares[c++].push((up + down) / (i + 1));
    }
    out.up += up;
    out.down += down;
    out.finals.push(profit);
  }
  return out;
}

describe("engine — tilt over a trailing window", () => {
  it("slow tilt: both swings and both exits are read over the last W tournaments", () => {
    // A small window and threshold make it switch often in both directions;
    // the exit fires both while the old extreme is remembered (where it is
    // the anchored rule) and after it has left the window.
    const input = baseInput({
      scheduleRepeats: 2000,
      samples: 40,
      rakebackFracOfRake: 0.3,
      tiltSlowGain: 0.08,
      tiltSlowThreshold: 2500,
      tiltSlowMinDuration: 25,
      tiltSlowRecoveryFrac: 0.5,
      tiltSlowWindow: 150,
    });
    const replay = replaySlowWindow(input);
    expect(Array.from(shardFinals(input))).toEqual(replay.finals);
    expect(replay.up).toBeGreaterThan(0);
    expect(replay.down).toBeGreaterThan(0);
    expect(replay.anchoredExits).toBeGreaterThan(0);
    expect(replay.forgottenExits).toBeGreaterThan(0);
  });

  it("fast tilt: the drawdown is read from the best profit of the last W tournaments", () => {
    const replay = (input: SimulationInput) => {
      const compiled = compileSchedule(input, "alpha");
      const e = compiled.flat[0];
      const n = compiled.tournamentsPerSample;
      const profits = new Float64Array(n + 1);
      const finals: number[] = [];
      for (let s = 0; s < input.samples; s++) {
        const rng = sampleStream(input.seed, s, STREAM_FINISH);
        for (let i = 0; i < n; i++) {
          const { hi } = scanExtremes(profits, i, input.tiltFastWindow!);
          const shift = input.tiltFastGain! * Math.tanh((hi - profits[i]) / input.tiltFastScale!);
          const r = rng() * e.aliasProb.length;
          const k = r | 0;
          const place = r - k < e.aliasProb[k] ? k : e.aliasIdx[k];
          profits[i + 1] = profits[i] + (e.prizeByPlace[place] - (e.singleCost - shift * e.singleCost) + e.rakebackBonusPerBullet);
        }
        finals.push(profits[n]);
      }
      return finals;
    };
    const input = baseInput({ scheduleRepeats: 2000, samples: 40, tiltFastGain: -0.3, tiltFastScale: 500, tiltFastWindow: 50 });
    expect(Array.from(shardFinals(input))).toEqual(replay(input));
    // Window edges: one point back, a window one short of the run, the run, and past it.
    for (const window of [1, 2, 7, 299, 300, 305]) {
      const edge = baseInput({ scheduleRepeats: 300, samples: 12, tiltFastGain: -0.3, tiltFastScale: 300, tiltFastWindow: window });
      expect(Array.from(shardFinals(edge)), `window ${window}`).toEqual(replay(edge));
    }
  });

  it("slow tilt: windows from one tournament to past the end of the run", () => {
    for (const window of [1, 2, 7, 299, 300, 305]) {
      const input = baseInput({
        scheduleRepeats: 300,
        samples: 12,
        tiltSlowGain: 0.08,
        tiltSlowThreshold: 60,
        tiltSlowMinDuration: 2,
        tiltSlowRecoveryFrac: 0.5,
        tiltSlowWindow: window,
      });
      const replay = replaySlowWindow(input);
      expect(Array.from(shardFinals(input)), `window ${window}`).toEqual(replay.finals);
      expect(replay.up + replay.down, `window ${window}`).toBeGreaterThan(0);
    }
  });

  it("slow tilt: a state ends once the gap to the window's extreme is down to 1 - r of its swing", () => {
    // r = tiltSlowRecoveryFrac. At the 0.5 of the other windowed cases r and 1 - r are the
    // same number; at 0.25 they are not. At 1 the gap must close to exactly 0, a new extreme
    // of the window, which "<=" accepts and "<" never does.
    for (const recovery of [0.25, 1]) {
      const input = baseInput({
        scheduleRepeats: 2000,
        samples: 40,
        tiltSlowGain: 0.08,
        tiltSlowThreshold: 2500,
        tiltSlowMinDuration: 25,
        tiltSlowRecoveryFrac: recovery,
        tiltSlowWindow: 150,
      });
      const replay = replaySlowWindow(input);
      expect(Array.from(shardFinals(input)), `r = ${recovery}`).toEqual(replay.finals);
      expect(replay.lengths.length, `r = ${recovery}`).toBeGreaterThan(20);
    }
  });

  it("slow tilt: the first window holds the point before the first tournament", () => {
    // Heads-up, winner takes all: a win moves x up by 39.5 and a loss down by 60.5. A
    // sample that wins its first two tournaments stays above 0 and sits 79 above point 0
    // but only 39.5 above its lowest point since, so a threshold of 60 puts it in "up"
    // before its third tournament only if point 0 is in the window's minimum. A sample that
    // loses its first one is below 0 from the start, and only point 0 is 60 above it. At
    // this seed 12 of the 40 samples start with two wins and 18 with a loss.
    const input = baseInput({
      schedule: [{ ...freezeRow(), players: 2, payoutStructure: "winner-takes-all" }],
      scheduleRepeats: 300,
      samples: 40,
      tiltSlowGain: 0.08,
      tiltSlowThreshold: 60,
      tiltSlowMinDuration: 1,
      tiltSlowRecoveryFrac: 0.5,
      tiltSlowWindow: 20,
    });
    const replay = replaySlowWindow(input);
    expect(Array.from(shardFinals(input))).toEqual(replay.finals);
    const e = compileSchedule(input, "alpha").flat[0];
    expect(e.analyticMeanSingle).toBeCloseTo(60.5, 9);
    let startsAbove = 0;
    let startsBelow = 0;
    for (let s = 0; s < input.samples; s++) {
      const rng = sampleStream(input.seed, s, STREAM_FINISH);
      const won = () => {
        const r = rng() * e.aliasProb.length;
        const k = r | 0;
        return (r - k < e.aliasProb[k] ? k : e.aliasIdx[k]) === 0;
      };
      const first = won();
      if (!first) startsBelow++;
      else if (won()) startsAbove++;
    }
    expect(startsAbove).toBeGreaterThan(5);
    expect(startsBelow).toBeGreaterThan(5);
  });

  it("how often the slow tilt fires does not grow with the distance", () => {
    // Shares counted by the replica, which the first assertion ties to the
    // engine bit for bit. Over the window (W = 200) the run spends 17.4 % of
    // its first 2,000 tournaments tilted and 17.8 % of 20,000; on all-time
    // extremes the same threshold gives 74 % and 97 %. Per-sample shares of
    // 40 samples have an SE of about 1.5 pp, so 4 pp is over 2.5 SE of the
    // paired difference and the fixed seed cannot flake.
    const input = baseInput({
      scheduleRepeats: 20_000,
      samples: 40,
      tiltSlowGain: 0.08,
      tiltSlowThreshold: 5000,
      tiltSlowMinDuration: 50,
      tiltSlowRecoveryFrac: 0.5,
      tiltSlowWindow: 200,
    });
    const replay = replaySlowWindow(input, [2000, 20_000]);
    expect(Array.from(shardFinals(input))).toEqual(replay.finals);
    const short = meanAndSe(replay.shares[0]);
    const long = meanAndSe(replay.shares[1]);
    expect(Math.abs(long.mean - short.mean)).toBeLessThan(0.04);
    expect(short.mean).toBeGreaterThan(0.1);
    expect(short.mean).toBeLessThan(0.3);
  });

  it("steady-reg: the share, the length and the end of a tilt are what its tagline quotes", () => {
    // The app's steady-reg run, preset noise included, replayed bit for bit,
    // so the replica's counts are the engine's. A share "about q" passes when
    // the mean lies within 3 SE of q ± half its last printed digit; the seed
    // is fixed, so the counts are the same on every run.
    const steady = STANDARD_PRESETS.find((preset) => preset.id === "steady-reg")!.patch;
    const tagline = DICT["preset.steadyReg.tagline"];
    const run = (players: number, samples: number, roi: number, n: number) => {
      const schedule = applyItmTarget([{ ...freezeRow(), players, roi, count: n }], { enabled: false, pct: 18.7 });
      const controls = applyModelPatch({ ...SCENARIOS[0].controls, scheduleRepeats: 1, samples, seed: 42, rakebackPct: 20 }, steady, "steady-reg");
      const input = buildSimulationInput(schedule, controls, true);
      const replay = replaySlowWindow(input, [10_000, n]);
      expect(Array.from(shardFinals(input)), `${players} players, ROI ${roi}`).toEqual(replay.finals);
      return replay;
    };
    const quotesShare = (shares: number[], low: number, high: number, digit: number) => {
      const { mean, se } = meanAndSe(shares);
      return mean > low - digit / 2 - 3 * se && mean < high + digit / 2 + 3 * se;
    };

    // Measured 1.02 % / 1.29 % at 10,000 / 50,000 tournaments (1,000 players)
    // and 6.35 % / 7.25 % (3,000 players). On all-time extremes the same
    // threshold gives 50 % / 89 % and 63 % / 91 %.
    expect(tagline.en).toContain("a 1,000-player regular spends about 1% of a run tilted and a 3,000-player regular 6–7%, over 10,000 tournaments as over 100,000");
    expect(tagline.ru).toContain("регуляр на полях в 1 000 игроков проводит в тильте около 1% дистанции, а регуляр на полях в 3 000 — 6–7%, и за 10 000 турниров, и за 100 000");
    const regular = run(1000, 60, 0.1, 50_000);
    const bigField = run(3000, 40, 0.1, 50_000);
    for (const shares of regular.shares) expect(quotesShare(shares, 0.01, 0.01, 0.01)).toBe(true);
    for (const shares of bigField.shares) expect(quotesShare(shares, 0.06, 0.07, 0.01)).toBe(true);

    // Measured 3.87 % and 11.8 % over 20,000 tournaments; a losing regular is
    // never in "down" here.
    expect(tagline.en).toContain("at 3,000 players it is about 3.5% at −10% ROI and 12% at +30%");
    expect(tagline.ru).toContain("на полях в 3 000 при ROI −10% это около 3,5%, а при +30% — около 12%");
    const losing = run(3000, 40, -0.1, 20_000);
    const strong = run(3000, 40, 0.3, 20_000);
    expect(quotesShare(losing.shares[1], 0.035, 0.035, 0.001)).toBe(true);
    expect(quotesShare(strong.shares[1], 0.12, 0.12, 0.01)).toBe(true);
    expect(losing.down).toBe(0);

    // The exit reads the gap to the window's extreme. The extreme a state
    // started from was usually set before its entry streak and leaves the
    // window first, so almost no state ends on winning half the swing back
    // (6 of 529 here) and the median state won back 4-8 % of it. Median
    // lengths 429 (1,000 players) and 501; quoted to the nearest hundred.
    expect(tagline.en).toContain("a tilt usually ends when the one it started from drops out of them rather than because the swing turned back, typically after 400 to 500 tournaments");
    expect(tagline.ru).toContain("тильт, как правило, заканчивается, когда точка, от которой он начался, выпадает из этого отрезка, а не потому, что качели развернулись, и длится 400–500 турниров");
    for (const [label, replay] of Object.entries({ regular, bigField, losing, strong })) {
      const exits = replay.lengths.length;
      const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
      expect(exits, label).toBeGreaterThan(50);
      expect(replay.anchoredExits, label).toBeLessThan(0.05 * exits);
      expect(median(replay.wonBack), label).toBeLessThan(0.25);
      expect(median(replay.lengths), label).toBeGreaterThanOrEqual(350);
      expect(median(replay.lengths), label).toBeLessThan(550);
    }
  });

  it("an unset, zero, fractional or NaN window keeps the all-time extremes bit for bit", () => {
    const tilts = {
      tiltFastGain: -0.3,
      tiltFastScale: 500,
      tiltSlowGain: 0.08,
      tiltSlowThreshold: 2500,
      tiltSlowMinDuration: 25,
      tiltSlowRecoveryFrac: 0.5,
    };
    const input = baseInput({ scheduleRepeats: 2000, samples: 60, ...tilts });
    const allTime = Array.from(shardFinals(input));
    for (const window of [0, 0.5, Number.NaN, -3]) {
      const finals = Array.from(shardFinals({ ...input, tiltFastWindow: window, tiltSlowWindow: window }));
      expect(finals, String(window)).toEqual(allTime);
    }
    // A fast window at least as long as the run holds every point: the same peak.
    expect(Array.from(shardFinals({ ...input, tiltSlowGain: 0, tiltFastWindow: 2000 }))).toEqual(
      Array.from(shardFinals({ ...input, tiltSlowGain: 0 })),
    );
    expect(Array.from(shardFinals({ ...input, tiltFastWindow: 300, tiltSlowWindow: 300 }))).not.toEqual(allTime);
  });

  it("resets its memory per sample, so shard boundaries do not move a run", () => {
    const input = baseInput({
      scheduleRepeats: 1500,
      samples: 50,
      tiltFastGain: -0.3,
      tiltFastScale: 500,
      tiltFastWindow: 40,
      tiltSlowGain: 0.08,
      tiltSlowThreshold: 2500,
      tiltSlowMinDuration: 25,
      tiltSlowRecoveryFrac: 0.5,
      tiltSlowWindow: 150,
    });
    const whole = Array.from(shardFinals(input));
    expect([...shardFinals(input, 0, 1), ...shardFinals(input, 1, 23), ...shardFinals(input, 23, 50)]).toEqual(whole);
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
