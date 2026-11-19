import { describe, expect, it } from "vitest";
import { compileSchedule, makeCheckpointGrid, simulateShard } from "./engine";
import { compiledEntryMoments } from "./scheduleMoments";
import type { SimulationInput, TournamentRow } from "./types";

function pkoInput(row: Partial<TournamentRow>, samples: number, seed: number): SimulationInput {
  return {
    schedule: [{
      id: "pko", label: "pko", gameType: "pko", payoutStructure: "mtt-gg-bounty", bountyFraction: 0.5,
      pkoHeadVar: 0.4, players: 9, buyIn: 100, rake: 0.1, roi: 0.1, count: 1, ...row,
    }],
    scheduleRepeats: 1,
    samples,
    bankroll: 0,
    seed,
    finishModel: { id: "powerlaw-realdata-influenced" },
  };
}

function run(input: SimulationInput, from = 0, to = input.samples) {
  const compiled = compileSchedule(input, "alpha");
  return { compiled, shard: simulateShard(input, compiled, from, to, makeCheckpointGrid(compiled.tournamentsPerSample)) };
}

describe("PKO knockouts in the hot loop", () => {
  it("sample sigma and mean agree with compiledEntryMoments at every field, heat, bounty share and ROI", () => {
    // 20 000 samples of 10 tournaments per case. z of the variance uses the sample's own
    // kurtosis, SE(var) = var * sqrt((kurtosis - 1) / S). The seeds are fixed, so the test
    // cannot flake; at them the largest |z| over the 38 cases is 2.06 (variance) and 1.73
    // (mean), so the bound 4 has room for that noise.
    const perSample = 10;
    const samples = 20_000;
    const cases: Partial<TournamentRow>[] = [];
    for (const players of [2, 3, 6, 9, 18, 50, 180, 1000, 5000])
      for (const pkoHeat of [0, 0.5])
        for (const [bountyFraction, roi] of [[0.5, 0.1], [0.9, 0.5]]) cases.push({ players, pkoHeat, bountyFraction, roi });
    cases.push({ players: 30, fieldVariability: { kind: "uniform", min: 6, max: 60, buckets: 5 } });
    cases.push({ players: 9, mysteryBountyVariance: 0.5 });
    cases.forEach((row, index) => {
      const input = pkoInput({ ...row, count: perSample }, samples, 4100 + index);
      const { compiled, shard } = run(input);
      const moments = compiledEntryMoments(compiled.flat[0]);
      const cost = compiled.flat[0].singleCost;
      const mean = perSample * (moments.meanDollar - cost);
      const variance = perSample * (moments.secondDollar - moments.meanDollar ** 2);
      const values = shard.finalProfits;
      let sum = 0;
      for (const v of values) sum += v;
      const sampleMean = sum / samples;
      let m2 = 0;
      let m4 = 0;
      for (const v of values) {
        const d = v - sampleMean;
        m2 += d * d;
        m4 += d ** 4;
      }
      const sampleVariance = m2 / (samples - 1);
      const kurtosis = (samples * m4) / (m2 * m2);
      const zVariance = (sampleVariance - variance) / (sampleVariance * Math.sqrt((kurtosis - 1) / samples));
      const zMean = (sampleMean - mean) / Math.sqrt(sampleVariance / samples);
      expect(Math.abs(zVariance), JSON.stringify(row)).toBeLessThan(4);
      expect(Math.abs(zMean), JSON.stringify(row)).toBeLessThan(4);
    });
  });

  it("a winner always collects at least the own head and makes the last knockout", () => {
    // Winners are told apart by their prize, so only fields whose first prize is unique.
    for (const players of [2, 6, 9, 18]) {
      const samples = 20_000;
      const { compiled, shard } = run(pkoInput({ players }, samples, 77 + players));
      const entry = compiled.flat[0];
      const ownHead = entry.bountyByPlace![0] * entry.pkoWinnerHead * entry.pkoRawInv![0];
      expect(entry.prizeByPlace[0]).toBeGreaterThan(entry.prizeByPlace[1]);
      const winnerCash = entry.prizeByPlace[0] - entry.singleCost;
      let winners = 0;
      let leastWinnerBounty = Infinity;
      for (let s = 0; s < samples; s++) {
        const bounty = shard.rowBountyProfits[s];
        if (Math.abs(shard.finalProfits[s] - bounty - winnerCash) < 1e-9) {
          winners++;
          leastWinnerBounty = Math.min(leastWinnerBounty, bounty);
        }
      }
      expect(winners).toBeGreaterThan(100);
      expect(ownHead).toBeGreaterThan(0);
      expect(leastWinnerBounty, `N=${players}`).toBeGreaterThan(ownHead);
    }
  });

  it("pays a heads-up winner exactly both heads and the loser nothing", () => {
    const samples = 5_000;
    const { compiled, shard } = run(pkoInput({ players: 2 }, samples, 3));
    const entry = compiled.flat[0];
    for (let s = 0; s < samples; s++) {
      const bounty = shard.rowBountyProfits[s];
      const won = Math.abs(shard.finalProfits[s] - bounty - (entry.prizeByPlace[0] - entry.singleCost)) < 1e-9;
      expect(bounty).toBeCloseTo(won ? entry.bountyByPlace![0] : 0, 9);
    }
  });

  it("takes the head spread from the tree, not from pkoHeadVar", () => {
    const off = run(pkoInput({ players: 9, pkoHeadVar: 0, count: 5 }, 2_000, 21)).shard;
    const wide = run(pkoInput({ players: 9, pkoHeadVar: 1.5, count: 5 }, 2_000, 21)).shard;
    expect(Buffer.from(wide.finalProfits.buffer).equals(Buffer.from(off.finalProfits.buffer))).toBe(true);
  });

  it("does not depend on where the shards split", () => {
    const input = pkoInput({ players: 6, pkoHeat: 0.5, count: 3 }, 1_001, 12);
    const whole = run(input).shard;
    const head = run(input, 0, 377).shard;
    const tail = run(input, 377, input.samples).shard;
    const joined = new Float64Array(input.samples);
    joined.set(head.finalProfits, 0);
    joined.set(tail.finalProfits, 377);
    expect(Buffer.from(joined.buffer).equals(Buffer.from(whole.finalProfits.buffer))).toBe(true);
  });
});
