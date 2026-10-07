import { describe, expect, it } from "vitest";
import {
  OCEAN_KO_ODDS,
  buildOceanKoModel,
  createOceanKoScratch,
  oceanKoOddsBand,
  sampleOceanKoBounty,
  sampleOceanKoMultiplier,
} from "./oceanKo";
import { compileSchedule } from "./compile";
import { compiledEntryMoments } from "./scheduleMoments";
import { computeRowStats } from "./previewRowStats";
import { makeCheckpointGrid } from "./grids";
import { simulateShard } from "./hotLoop";
import { mulberry32 } from "./rng";
import type { SimulationInput } from "./types";

function input(overrides: Partial<SimulationInput> = {}): SimulationInput {
  return {
    schedule: [{
      id: "ocean", players: 100, buyIn: 92, rake: 8 / 92,
      bountyFraction: 50 / 92, gameType: "ocean-ko", roi: 0.2,
      payoutStructure: "mtt-standard", count: 1,
    }],
    scheduleRepeats: 5, samples: 60, bankroll: 1000, seed: 401,
    finishModel: { id: "power-law" },
    ...overrides,
  };
}

function sequence(values: number[]): () => number {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error("unexpected random draw");
    return values[i++];
  };
}

const officialOrdinary = [
  [400, 0.00002], [100, 0.0008], [10, 0.024], [2, 0.025],
  [1.5, 0.027], [1, 0.2], [0.7, 0.22], [0.5, 0.26228], [0.4, 0.2409],
] as const;

function midpoint(index: number): number {
  let sum = 0;
  for (let i = 0; i < index; i++) sum += officialOrdinary[i][1];
  return sum + officialOrdinary[index][1] / 2;
}

describe("Ocean KO published wheels", () => {
  it("preserves the mean and includes every rare tier in its second moment", () => {
    const expected = [14.172664, 4.3855, 1.627, 1.22375, 1.07];
    for (let j = 0; j < OCEAN_KO_ODDS.length; j++) {
      const table = OCEAN_KO_ODDS[j];
      let sum = 0;
      let mean = 0;
      let second = 0;
      for (let i = 0; i < table.multipliers.length; i++) {
        const m = table.multipliers[i];
        const p = table.probabilities[i];
        sum += p;
        mean += p * m;
        second += p * m * m;
      }
      expect(sum).toBeCloseTo(1, 14);
      expect(mean).toBeCloseTo(1, 14);
      expect(second).toBeCloseTo(expected[j], 12);
      expect(table.secondMoment).toBeCloseTo(second, 12);
    }
    expect(400 ** 2 * 0.00002 + 100 ** 2 * 0.0008).toBeCloseTo(11.2, 12);
  });

  it("requires both the gross ticket threshold and the Legendary dollar threshold", () => {
    expect(oceanKoOddsBand(9_999.99, 100)).toBe(0);
    expect(oceanKoOddsBand(10_000, 100)).toBe(1);
    expect(oceanKoOddsBand(50_000, 100)).toBe(2);
    expect(oceanKoOddsBand(250_000, 100)).toBe(3);
    expect(oceanKoOddsBand(1_000_000, 100)).toBe(4);
    expect(oceanKoOddsBand(50_000, 1_000)).toBe(0);
    expect(oceanKoOddsBand(50_000.01, 1_000)).toBe(2);
    expect(oceanKoOddsBand(10_000, 10_000)).toBe(0);
    expect(oceanKoOddsBand(500_001, 10_000)).toBe(3);
  });

  it("samples every ordinary tier at its actual CDF interval", () => {
    for (let i = 0; i < officialOrdinary.length; i++) {
      expect(sampleOceanKoMultiplier(50, 100, () => midpoint(i)))
        .toBe(officialOrdinary[i][0]);
    }
    expect(sampleOceanKoMultiplier(50, 100, () => 0)).toBe(400);
    expect(sampleOceanKoMultiplier(50, 100, () => 1 - Number.EPSILON)).toBe(0.4);
  });
});

describe("Ocean KO recursive-tree sampler", () => {
  it("splits a KO 50/50, then pays 100% of the winner's updated final spin", () => {
    const model = buildOceanKoModel(2, 50, 100);
    const scratch = createOceanKoScratch(2);
    const one = midpoint(5);
    expect(sampleOceanKoBounty(model, 0, sequence([0, one, one]), scratch)).toBe(100);
    expect(sampleOceanKoBounty(model, 1, sequence([]), scratch)).toBe(0);
    // A x400 first KO grows the winner's head to $10,050. Its final wheel
    // is now Legendary x50 maximum, not another ordinary x400 wheel.
    expect(sampleOceanKoBounty(model, 0, sequence([0, 0, 0]), scratch)).toBe(512_500);
    expect(scratch.jackpot).toBe(true);
  });

  it("propagates a descendant's spin before the parent is eliminated", () => {
    const model = buildOceanKoModel(3, 1, 2);
    const scratch = createOceanKoScratch(3);
    // Node 3 -> node 2, x10. Head 2 becomes 6, then x2 transfers 6 to
    // hero. Hero head 7, cash 6, final x1 cash 7: total 13.
    const draw = sampleOceanKoBounty(model, 0,
      sequence([0.75, midpoint(2), 0, midpoint(3), midpoint(5)]), scratch);
    expect(draw).toBe(13);
  });

  it("matches independent full enumeration and analytic moments for N=3", () => {
    const b = 0.001; // Even the maximum attainable head is below Legendary.
    const model = buildOceanKoModel(3, b, 2 * b);
    const scratch = createOceanKoScratch(3);
    let mean = 0;
    let second = 0;
    for (let parent = 0; parent < 2; parent++) {
      for (let a = 0; a < officialOrdinary.length; a++) {
        for (let c = 0; c < officialOrdinary.length; c++) {
          for (let d = 0; d < officialOrdinary.length; d++) {
            const [m3, p3] = officialOrdinary[a];
            const [m2, p2] = officialOrdinary[c];
            const [mf, pf] = officialOrdinary[d];
            const head = parent === 0
              ? b + 0.5 * m3 * b + 0.5 * m2 * b
              : b + 0.5 * m2 * (b + 0.5 * m3 * b);
            const expected = head - b + mf * head;
            const sampled = sampleOceanKoBounty(model, 0,
              sequence([parent === 0 ? 0.1 : 0.9, midpoint(a), 0, midpoint(c), midpoint(d)]), scratch);
            expect(sampled).toBeCloseTo(expected, 11);
            const weight = 0.5 * p3 * p2 * pf;
            mean += weight * sampled;
            second += weight * sampled * sampled;
          }
        }
      }
    }
    expect(mean / b).toBeCloseTo(2.75, 10);
    expect(second / b ** 2).toBeCloseTo(274.502219621181, 8);
    expect(model.bountyMeanByPlace[0]).toBeCloseTo(mean, 11);
    expect(model.bountySecondLowerByPlace[0]).toBeCloseTo(second, 11);
    expect(model.bountySecondUpperByPlace[0]).toBeCloseTo(second, 11);
    expect(model.bountyMeanByPlace[1] / b).toBeCloseTo(0.25, 10);
    expect(model.bountySecondUpperByPlace[1] / b ** 2).toBeCloseTo(1.771583, 10);
  });

  it("selects the exact subtree-size mixture instead of Poisson KO counts", () => {
    const model = buildOceanKoModel(3, 50, 100);
    const scratch = createOceanKoScratch(3);
    const one = midpoint(5);
    expect(sampleOceanKoBounty(model, 1, sequence([0.49, 0, one]), scratch)).toBe(25);
    expect(sampleOceanKoBounty(model, 1, sequence([0.5]), scratch)).toBe(0);
    const rng = mulberry32(812);
    let zero = 0;
    const samples = 20_000;
    for (let i = 0; i < samples; i++) {
      if (sampleOceanKoBounty(model, 1, rng, scratch) === 0) zero++;
    }
    expect(Math.abs(zero / samples - 0.5)).toBeLessThan(0.015);
  });

  it("pays the lone champion's final spin and does not normalize individual tournaments", () => {
    const model = buildOceanKoModel(1, 50, 100);
    const scratch = createOceanKoScratch(1);
    expect(sampleOceanKoBounty(model, 0, () => 0, scratch)).toBe(20_000);
    expect(sampleOceanKoBounty(model, 0, () => 0.99, scratch)).toBe(20);
    expect(model.bountyMeanByPlace[0]).toBe(50);
  });
});

describe("Ocean KO engine contract", () => {
  it("keeps ROI and preview EV exact, exposes conservative variance honestly", () => {
    const args = input();
    const entry = compileSchedule(args).flat[0];
    const stats = computeRowStats(args.schedule[0], args.finishModel);
    const moments = compiledEntryMoments(entry);
    expect(entry.analyticMeanSingle).toBeCloseTo(120, 8);
    expect(moments.meanDollar).toBeCloseTo(120, 8);
    expect(stats.evPerEntry).toBeCloseTo(120, 8);
    expect(stats.bountyEvPerEntry).toBeCloseTo(120 * 50 / 92, 8);
    expect(entry.oceanKo?.initialBounty).toBeCloseTo(50, 10);
    expect(entry.oceanKo?.fullTicket).toBeCloseTo(100, 10);
    expect(moments.varianceBounded).toBe(true);
    expect(moments.secondDollar).toBe(moments.secondDollarUpper);
    expect(moments.secondDollarLower).toBeLessThan(moments.secondDollarUpper!);
    expect(stats.payoutVarianceBounded).toBe(true);
    expect(stats.jackpotEvAvailable).toBe(false);
    expect(stats.payoutStd).toBeCloseTo(Math.sqrt(moments.secondDollar - moments.meanDollar ** 2), 7);
    expect(stats.payoutStdLower).toBeCloseTo(Math.sqrt(moments.secondDollarLower! - moments.meanDollar ** 2), 7);
    expect(entry.heatBountyByPlace).toBeNull();
    expect(entry.mysteryBountyLogVar).toBe(0);
  });

  it("calibrates EV by scaling payouts after actual-head tier selection", () => {
    const pmf = Float64Array.of(0.5, 0.5);
    const model = buildOceanKoModel(2, 50, 100, pmf, 100);
    const raw = buildOceanKoModel(2, 50, 100);
    expect(model.payoutScale).toBe(2);
    expect(model.initialBounty).toBe(50);
    expect(sampleOceanKoBounty(model, 0, sequence([0, 0, 0]), createOceanKoScratch(2)))
      .toBe(2 * 512_500);
    for (let i = 0; i < 2; i++) {
      expect(model.bountySecondUpperByPlace[i]).toBe(4 * raw.bountySecondUpperByPlace[i]);
    }
  });

  it("preserves the funded bounty mean at neutral uniform finishes", () => {
    for (const n of [1, 2, 3, 18, 100, 1000]) {
      const model = buildOceanKoModel(n, 50, 100);
      const mean = model.bountyMeanByPlace.reduce((sum, x) => sum + x, 0) / n;
      expect(mean).toBeCloseTo(50, 9);
      for (let i = 0; i < n; i++) {
        expect(model.bountySecondUpperByPlace[i]).toBeGreaterThanOrEqual(model.bountySecondLowerByPlace[i]);
        expect(model.bountySecondLowerByPlace[i]).toBeGreaterThanOrEqual(model.bountyMeanByPlace[i] ** 2 - 1e-7);
      }
    }
  });

  it("is deterministic and byte-identical across shard boundaries with field variants", () => {
    const args = input();
    args.schedule[0].fieldVariability = { kind: "uniform", min: 18, max: 100, buckets: 3 };
    const compiled = compileSchedule(args);
    const grid = makeCheckpointGrid(compiled.tournamentsPerSample);
    const all = simulateShard(args, compiled, 0, args.samples, grid);
    const repeat = simulateShard(args, compileSchedule(args), 0, args.samples, grid);
    const left = simulateShard(args, compiled, 0, 23, grid);
    const right = simulateShard(args, compiled, 23, args.samples, grid);
    expect(repeat.finalProfits).toEqual(all.finalProfits);
    expect([...left.finalProfits, ...right.finalProfits]).toEqual([...all.finalProfits]);
    expect([...left.jackpotMask, ...right.jackpotMask]).toEqual([...all.jackpotMask]);
    expect([...left.rowBountyProfits, ...right.rowBountyProfits]).toEqual([...all.rowBountyProfits]);
    expect(compiledEntryMoments(compiled.flat[0]).varianceBounded).toBe(true);
  });
});
