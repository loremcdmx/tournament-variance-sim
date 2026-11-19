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

/**
 * The bounty take at every finishing place of the uniform-killer progressive tree, with
 * every killer assignment enumerated: each bust pays half the victim's head to a killer
 * uniform among the players still in, the other half joins the killer's head, and the
 * winner also cashes the own final head. Unit starting head.
 */
function enumeratedTree(players: number) {
  const sum = new Float64Array(players);
  const sumSquares = new Float64Array(players);
  const none = new Float64Array(players);
  const killer = new Int32Array(players + 1);
  const head = new Float64Array(players + 1);
  const cash = new Float64Array(players + 1);
  let leaves = 0;
  const walk = (rank: number): void => {
    if (rank > 1) {
      for (let k = 1; k < rank; k++) {
        killer[rank] = k;
        walk(rank - 1);
      }
      return;
    }
    head.fill(1);
    cash.fill(0);
    for (let r = players; r >= 2; r--) {
      const half = head[r] / 2;
      cash[killer[r]] += half;
      head[killer[r]] += half;
    }
    cash[1] += head[1];
    for (let r = 1; r <= players; r++) {
      sum[r - 1] += cash[r];
      sumSquares[r - 1] += cash[r] * cash[r];
      if (cash[r] === 0) none[r - 1]++;
    }
    leaves++;
  };
  walk(players);
  return Array.from({ length: players }, (_, i) => ({
    mean: sum[i] / leaves,
    variance: sumSquares[i] / leaves - (sum[i] / leaves) ** 2,
    none: none[i] / leaves,
  }));
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

  it("plays the enumerated tree at every finishing place: mean, spread and the chance of no bounty", () => {
    // Unlike the test above, this one does not read the engine's own moments. Each place of
    // fields of 4 to 9 is played alone (the finish draw pinned to it), 50 000 tournaments, and
    // its bounty is compared with the exact tree in dollars. z of the variance uses the
    // sample's own kurtosis, SE(var) = var * sqrt((kurtosis - 1) / S), which needs a kurtosis
    // above 1: both places of a 3-player field are a fair coin, so that field is left out. z of
    // the no-bounty share is binomial. The seeds are fixed, so the test cannot flake; at them
    // the largest |z| over the 26 places is 2.54. Measured on altered engines: leaving the
    // count's excess at 2nd and 3rd place unshrunk reads z 12.9, a Poisson count with a flat
    // head noise 103 (and 16 % of 4-player winners without a bounty), the per-place
    // log-variance 20 % too wide or too narrow +10.4 / -13.4, a shrink toward the whole place
    // mean -224 (no-bounty share).
    const samples = 50_000;
    for (const players of [4, 5, 6, 7, 9]) {
      const tree = enumeratedTree(players);
      for (let place = 0; place < players - 1; place++) {
        const input = pkoInput({ players }, samples, 600 + 10 * players + place);
        const compiled = compileSchedule(input, "alpha");
        const entry = compiled.flat[0];
        entry.aliasProb.fill(0);
        entry.aliasIdx.fill(place);
        const shard = simulateShard(input, compiled, 0, samples, makeCheckpointGrid(compiled.tournamentsPerSample));
        const scale = entry.bountyByPlace![0] / tree[0].mean;
        const mean = tree[place].mean * scale;
        const variance = tree[place].variance * scale * scale;
        let sum = 0;
        let none = 0;
        for (const bounty of shard.rowBountyProfits) {
          sum += bounty;
          if (bounty === 0) none++;
        }
        const sampleMean = sum / samples;
        let m2 = 0;
        let m4 = 0;
        for (const bounty of shard.rowBountyProfits) {
          const d = bounty - sampleMean;
          m2 += d * d;
          m4 += d ** 4;
        }
        const sampleVariance = m2 / (samples - 1);
        const kurtosis = (samples * m4) / (m2 * m2);
        const noBounty = tree[place].none;
        const z = [
          (sampleMean - mean) / Math.sqrt(sampleVariance / samples),
          (sampleVariance - variance) / (sampleVariance * Math.sqrt((kurtosis - 1) / samples)),
        ];
        if (noBounty > 0) z.push((none / samples - noBounty) / Math.sqrt((noBounty * (1 - noBounty)) / samples));
        else expect(none, `N=${players} winners without a bounty`).toBe(0);
        expect(Math.max(...z.map(Math.abs)), `N=${players} place ${place + 1}: z ${z.map(v => v.toFixed(2))}`).toBeLessThan(4);
      }
    }
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
