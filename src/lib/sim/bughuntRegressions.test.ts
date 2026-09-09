import { describe, expect, it } from "vitest";
import { compileSchedule } from "./compile";
import { applyItmTarget } from "./itmTarget";
import { validateSchedule } from "./validation";
import { chooseClosestFeasibilityFix } from "./feasibilityFix";
import { getPayoutTable } from "./payouts";
import { buildBinaryItmAssets, calibrateShelledItm } from "./finishModel";
import { computeRowStats } from "./previewRowStats";
import { computeScalarStats } from "./resultStats";
import { buildConvergence } from "./resultCurves";
import { buildExactBreakdown } from "./convergenceMath";
import { computeProveEdge, PROVE_EDGE_POSITIVE_CANDIDATES } from "./proveEdge";
import { buildResult, makeCheckpointGrid, mergeShards, runSimulation, simulateShard } from "./engine";
import type { SimulationInput, TournamentRow } from "./types";

const row: TournamentRow = { id: "r", players: 500, buyIn: 10, rake: .1, roi: .05, payoutStructure: "mtt-standard", count: 1 };
const model = { id: "power-law" } as const;
function input(r: TournamentRow, extra: Partial<SimulationInput> = {}): SimulationInput {
  return { schedule: [r], scheduleRepeats: 1, samples: 100, seed: 42, bankroll: 1000, finishModel: model, ...extra };
}
const sum = (values: Iterable<number>) => Array.from(values).reduce((a, b) => a + b, 0);

describe("bughunt: distribution integrity", () => {
  it("all-paid defaults and explicit/global ITM cannot create missing mass", () => {
    for (const enabled of [false, true]) {
      const schedule = applyItmTarget([{ ...row, players: 2, payoutStructure: "sng-65-35", itmRate: .99 }], { enabled, pct: 18.7 });
      expect(schedule[0].itmRate).toBe(1);
      expect(validateSchedule(schedule, model).ok).toBe(true);
      const compiled = compileSchedule(input(schedule[0]), "alpha");
      expect(compiled.flat[0].itm).toBeCloseTo(1, 12);
      expect(compiled.flat[0].analyticMeanSingle).toBeCloseTo(11.55, 8);
      const direct = calibrateShelledItm(2, 2, [.65, .35], 20, 11.55, .99, undefined, model);
      expect(sum(direct.pmf)).toBeCloseTo(1, 12);
    }
  });

  it("coincident FT/ITM locks retain the complete PKO probability distribution", () => {
    const r: TournamentRow = { ...row, players: 50, gameType: "pko", payoutStructure: "mtt-gg-bounty", bountyFraction: .5, itmRate: .18, finishBuckets: { top3: .04, ft: .08 } };
    const validation = validateSchedule([r], model);
    expect(validation.ok).toBe(false);
    expect(validation.issues[0].reason).toBe("inconsistent-finish-locks");
    expect(validateSchedule([r], { id: "powerlaw-realdata-influenced" }).issues[0]?.reason).toBe("inconsistent-finish-locks");
    const fix = chooseClosestFeasibilityFix(r, validation.issues[0], model, { enabled: false, pct: 18.7 });
    expect(fix.kind).toBe("clear-locks");
    expect(validateSchedule(applyItmTarget([fix.row], { enabled: false, pct: 18.7 }), model).ok).toBe(true);
    expect(validateSchedule([{ ...r, finishBuckets: { top3: .04, ft: .18 } }], model).ok).toBe(true);
    const compiled = compileSchedule(input(r), "alpha").flat[0];
    expect(compiled.itm).toBeCloseTo(.18, 12);
    expect(compiled.analyticMeanSingle).toBeCloseTo(11.55, 8);
    const pmf = new Float64Array(compiled.aliasProb.length);
    for (let i = 0; i < pmf.length; i++) {
      pmf[i] += compiled.aliasProb[i] / pmf.length;
      pmf[compiled.aliasIdx[i]] += (1 - compiled.aliasProb[i]) / pmf.length;
    }
    const exactWinnings = sum(pmf.map((p, i) => p * (compiled.prizeByPlace[i] + (compiled.bountyByPlace?.[i] ?? 0))));
    expect(exactWinnings).toBeCloseTo(11.55, 8);
  });

  it("impossible nested or coincident pinned shells are blocked", () => {
    for (const finishBuckets of [{ first: .1, top3: .05 }, { top3: .2 }, { ft: .08 }]) {
      expect(validateSchedule([{ ...row, players: 50, itmRate: .18, finishBuckets }], model).issues[0]?.reason).toBe("inconsistent-finish-locks");
    }
    expect(validateSchedule([{ ...row, players: 2, payoutStructure: "sng-65-35", itmRate: 1, finishBuckets: { top3: .99 } }], model).issues[0]?.reason).toBe("inconsistent-finish-locks");
  });

  it.each([
    ["mtt-flat", 235], ["mtt-pokerstars", 371], ["mtt-flat", 50000], ["mtt-standard", 100000], ["mtt-primedope", 100000],
  ] as const)("%s conserves the pool at field %i", (structure, players) => {
    const payouts = getPayoutTable(structure, players);
    expect(sum(payouts)).toBeCloseTo(1, 9);
    expect(payouts.every((v, i) => v >= 0 && (i === 0 || v <= payouts[i - 1]))).toBe(true);
    const binary = buildBinaryItmAssets(players, payouts.length, payouts, players * 10, 12.1);
    expect(sum(binary.pmf.map((p, i) => p * binary.prizeByPlace[i]))).toBeCloseTo(12.1, 7);
  });

  it.each(["sng-65-35", "sng-50-30-20", "mtt-sunday-million", "mtt-primedope"] as const)("%s never assigns prizes to nonexistent players", (structure) => {
    for (const players of [1, 2, 3, 8]) {
      const payouts = getPayoutTable(structure, players, Array(10).fill(1));
      expect(payouts.length).toBeLessThanOrEqual(players);
      expect(sum(payouts)).toBeCloseTo(1, 9);
    }
  });

  it("sit-through preview and engine agree on effective ITM and every tier", () => {
    const r = applyItmTarget([{ ...row, roi: .2, sitThroughPayJumps: true, payJumpAggression: .5 }], { enabled: false, pct: 18.7 })[0];
    const preview = computeRowStats(r, model), compiled = compileSchedule(input(r), "alpha").flat[0];
    expect(preview.itm).toBeCloseTo(compiled.itm, 10);
    expect(preview.itm).toBeLessThan(r.itmRate!);
    expect(preview.evPerEntry).toBeCloseTo(compiled.analyticMeanSingle, 8);
    for (const tier of preview.tiers) {
      let probability = 0;
      const n = compiled.aliasProb.length;
      for (let i = 0; i < n; i++) {
        if (i >= tier.posLo - 1 && i < tier.posHi) probability += compiled.aliasProb[i] / n;
        const alias = compiled.aliasIdx[i];
        if (alias >= tier.posLo - 1 && alias < tier.posHi) probability += (1 - compiled.aliasProb[i]) / n;
      }
      expect(tier.field).toBeCloseTo(probability, 10);
    }
  });

  it("impossible PD target is disclosed and expected profit uses attained EV", () => {
    const r: TournamentRow = { ...row, players: 2, payoutStructure: "sng-65-35", itmRate: 1 };
    const out = runSimulation(input(r, { calibrationMode: "primedope-binary-itm", usePrimedopePayouts: false }));
    expect(out.calibrationWarnings).toEqual([{ rowId: "r", kind: "primedope-target-clamped", targetWinnings: 11.55, actualWinnings: 9 }]);
    expect(out.expectedProfit).toBe(-2);
    expect(sum(buildBinaryItmAssets(2, 2, [.65, .35], 20, 5).pmf)).toBe(1);
  });
});

describe("bughunt: finite-horizon risk and recovery", () => {
  it("the quoted bankroll really meets the advertised risk even when losses tie", () => {
    const finals = Float64Array.from({ length: 100 }, (_, i) => i < 54 ? -11 : 19);
    const mins = finals.map((v) => Math.min(0, v));
    const s = computeScalarStats(finals, mins, 100, 1, 11, 11);
    expect(s.minBankrollRoR1pct).toBe(11.01);
    expect(sum(mins.map(v => v <= -s.minBankrollRoR1pct ? 1 : 0)) / 100).toBeLessThanOrEqual(.01);
  });

  it("Gaussian risk falls with bankroll instead of overflowing for negative drift", () => {
    const finals = Float64Array.from({ length: 100 }, (_, i) => -1000 + (i % 2 ? 10 : -10));
    const at = (bankroll: number) => computeScalarStats(finals, finals, 100, 100, bankroll, 1100);
    expect(at(900).riskOfRuinGaussian).toBeGreaterThan(.99);
    expect(at(1000).riskOfRuinGaussian).toBeGreaterThan(.49);
    expect(at(1100).riskOfRuinGaussian).toBeLessThan(1e-10);
    expect(at(2200).riskOfRuinGaussian).toBeLessThan(1e-10);
    expect(at(2200).minBankrollRoR1pctGaussian).toBeGreaterThan(1000);
    expect(at(2200).minBankrollRoR1pctGaussian).toBeLessThan(1100);
  });

  it("zero-variance losses ruin only if the finite total loss reaches the bankroll", () => {
    const loss = new Float64Array(100).fill(-10);
    expect(computeScalarStats(loss, loss, 100, 1, 11, 11).riskOfRuinGaussian).toBe(0);
    expect(computeScalarStats(loss, loss, 100, 1, 10, 11).riskOfRuinGaussian).toBe(1);
  });

  it("no drawdown does not count as unrecovered", () => {
    const out = runSimulation(input({ ...row, players: 6, payoutStructure: "sng-50-30-20" }));
    const losing = Array.from(out.finalProfits).filter(v => v < 0).length / out.samples;
    expect(losing).toBeGreaterThan(0);
    expect(losing).toBeLessThan(1);
    expect(out.stats.recoveryUnrecoveredShare).toBe(losing);
  });
});

describe("bughunt: convergence and sharding", () => {
  it("rejects unrepresentable schedule totals before compiling huge rows", () => {
    expect(() => compileSchedule(input({ ...row, count: Number.MAX_SAFE_INTEGER }, { scheduleRepeats: 2 }), "alpha")).toThrow("safe integer");
    expect(() => compileSchedule(input({ ...row, count: Number.MAX_SAFE_INTEGER + 1 }), "alpha")).toThrow("safe integer");
  });
  it("small sample grids include every checkpoint and finish at the true mean", () => {
    for (let samples = 1; samples < 80; samples++) {
      const curve = buildConvergence(Float64Array.from({ length: samples }, (_, i) => 100 + i), samples);
      expect(curve.x.every((v, i) => v === i + 1)).toBe(true);
      expect(curve.mean.at(-1)).toBeCloseTo(100 + (samples - 1) / 2, 10);
    }
  });

  it("out-of-box field variants suppress both schedule widgets' numeric bands", () => {
    const schedule: TournamentRow[] = [{ ...row, players: 50, fieldVariability: { kind: "uniform", min: 20, max: 100, buckets: 5 } }];
    const breakdown = buildExactBreakdown(schedule)!;
    expect(breakdown.perRow[0].afs).toBeGreaterThan(50);
    expect(breakdown.perRow[0].fieldMin).toBeLessThan(50);
    expect(breakdown.sigmaEffLo).toBe(breakdown.sigmaEff);
    expect(computeProveEdge({ format: "exact", schedule, afs: 50, rake: .1, z: 1.96, currentRoi: .05, candidates: [.05] }).bandPolicy).toBe("outside-fit-box");
  });

  it("BR anchor remains in-box while out-of-box candidate rows keep only points", () => {
    const proof = computeProveEdge({ format: "mystery-royale", afs: 18, rake: .08, z: 1.96, currentRoi: .05, candidates: PROVE_EDGE_POSITIVE_CANDIDATES });
    expect(proof.bandPolicy).toBe("numeric");
    expect(proof.anchor.sigmaLo).toBeLessThan(proof.anchor.sigma);
    expect(proof.rows.find(r => r.roi === .3)?.sigmaLo).toBe(proof.rows.find(r => r.roi === .3)?.sigma);
  });

  it("full retained path output is invariant to pool size and shard arrival order", () => {
    const i = input({ ...row, players: 50, count: 3 }, { samples: 1201, roiStdErr: .01, roiShockPerTourney: .02 });
    const c = compileSchedule(i, "alpha"), grid = makeCheckpointGrid(c.tournamentsPerSample);
    const one = buildResult(i, c, simulateShard(i, c, 0, i.samples, grid), "alpha", grid);
    const pieces = [[0, 333], [333, 1000], [1000, 1201]].map(([lo, hi]) => simulateShard(i, c, lo, hi, grid));
    const joined = mergeShards(pieces.reverse(), i.samples, grid.K + 1, 1);
    const many = buildResult(i, c, joined, "alpha", grid);
    expect(many).toEqual(one);
  });

  it("satellite ticket counters ignore money channels and survive sharding", () => {
    const r: TournamentRow = { ...row, players: 100, payoutStructure: "satellite-ticket", count: 5, roi: .2, itmRate: .132 };
    const i = input(r, { samples: 101, rakebackFracOfRake: .2, roiShockPerTourney: 1 });
    const withNoise = runSimulation(i), clean = runSimulation({ ...i, rakebackFracOfRake: 0, roiShockPerTourney: 0 });
    expect(withNoise.satelliteSeatsWon).toEqual(clean.satelliteSeatsWon);
    expect(withNoise.satelliteSeatsWon).toHaveLength(101);
    expect(sum(clean.satelliteSeatsWon!)).toBeGreaterThan(0);
    for (let sample = 0; sample < 101; sample++) {
      // Ten $100 tickets in this $1000 pool; clean profits have only the
      // ticket payouts and five $11 entry costs.
      expect(clean.satelliteSeatsWon![sample]).toBe(Math.round((clean.rowProfits[sample] + 55) / 100));
    }
    const c = compileSchedule(i, "alpha"), grid = makeCheckpointGrid(5);
    const m = mergeShards([simulateShard(i, c, 0, 50, grid), simulateShard(i, c, 50, 101, grid)], 101, grid.K + 1, 1);
    expect(buildResult(i, c, m, "alpha", grid).satelliteSeatsWon).toEqual(withNoise.satelliteSeatsWon);
  });
});
