import { describe, expect, it } from "vitest";
import { compileSchedule } from "./compile";
import { getPayoutTable } from "./payouts";
import { compiledEntryMoments } from "./scheduleMoments";
import type { SimulationInput, TournamentRow } from "./types";

const TOLERANCE = 1e-9;

function freezeout(overrides: Partial<TournamentRow>): TournamentRow {
  return { id: "freeze", gameType: "freezeout", players: 200, buyIn: 50, rake: 0.1, roi: 0.1, count: 1, payoutStructure: "sng-50-30-20", ...overrides };
}

function compileOne(row: TournamentRow, finishModel: SimulationInput["finishModel"]) {
  const input: SimulationInput = { schedule: [row], scheduleRepeats: 1, samples: 1, seed: 1, bankroll: 1000, finishModel };
  return compileSchedule(input).flat[0];
}

/** Power-law finish: P(place i) = i^-alpha / sum_j j^-alpha. Written out here, not taken from the engine. */
function powerLawPmf(places: number, alpha: number): number[] {
  const weights = Array.from({ length: places }, (_, index) => (index + 1) ** -alpha);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map(weight => weight / total);
}

/** E and sigma of one entry straight from the finish PMF and a table of prizes by place. */
function directMoments(pmf: readonly number[], prizeByPlace: readonly number[]) {
  let mean = 0;
  let second = 0;
  pmf.forEach((probability, index) => {
    const prize = prizeByPlace[index] ?? 0;
    mean += probability * prize;
    second += probability * prize * prize;
  });
  return { mean, sigma: Math.sqrt(second - mean * mean) };
}

const relative = (actual: number, expected: number) => Math.abs(actual - expected) / Math.abs(expected);

describe("exact moments of a freezeout entry", () => {
  it("match E and sigma from the finish PMF and the payout table of the row, no simulation", () => {
    const row = freezeout({});
    const alpha = 1.15;
    const entry = compileOne(row, { id: "power-law", alpha });
    const table = [0.5, 0.3, 0.2];
    const pool = row.players * row.buyIn;
    const prizes = table.map(share => share * pool);
    const pmf = powerLawPmf(row.players, alpha);
    expect(pmf.reduce((sum, probability) => sum + probability, 0)).toBeCloseTo(1, 12);
    expect(entry.alpha).toBe(alpha);

    const direct = directMoments(pmf, prizes);
    const moments = compiledEntryMoments(entry);
    expect(relative(moments.meanDollar, direct.mean)).toBeLessThan(TOLERANCE);
    expect(relative(Math.sqrt(moments.secondDollar - moments.meanDollar ** 2), direct.sigma)).toBeLessThan(TOLERANCE);
    expect(moments.varianceBounded).toBeUndefined();
  });

  it("match on a realistic 500-player table with the finish solved to hit the row's ROI", () => {
    const row = freezeout({ players: 500, buyIn: 100, rake: 0.08, roi: 0.12, payoutStructure: "mtt-standard" });
    const entry = compileOne(row, { id: "power-law" });
    const table = getPayoutTable(row.payoutStructure, row.players);
    expect(table.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 9);
    const prizes = table.map(share => share * row.players * row.buyIn);
    const pmf = powerLawPmf(row.players, entry.alpha);

    const direct = directMoments(pmf, prizes);
    const cost = row.buyIn * (1 + row.rake);
    // The calibration contract, independent of the engine's own bookkeeping: E[prize] = cost * (1 + ROI).
    expect(relative(direct.mean, cost * (1 + row.roi))).toBeLessThan(TOLERANCE);
    const moments = compiledEntryMoments(entry);
    expect(relative(moments.meanDollar, direct.mean)).toBeLessThan(TOLERANCE);
    expect(relative(Math.sqrt(moments.secondDollar - moments.meanDollar ** 2), direct.sigma)).toBeLessThan(TOLERANCE);
    expect(relative(Math.sqrt(moments.secondDollar - moments.meanDollar ** 2) / cost, direct.sigma / cost)).toBeLessThan(TOLERANCE);
  });

  it("move with the finish shape: a flatter finish distribution has a different sigma", () => {
    const row = freezeout({});
    const sharp = compiledEntryMoments(compileOne(row, { id: "power-law", alpha: 2 }));
    const flat = compiledEntryMoments(compileOne(row, { id: "power-law", alpha: 0.5 }));
    const sigma = (m: { meanDollar: number; secondDollar: number }) => Math.sqrt(m.secondDollar - m.meanDollar ** 2);
    expect(sigma(sharp)).not.toBeCloseTo(sigma(flat), 3);
    expect(sharp.meanDollar).toBeGreaterThan(flat.meanDollar);
  });
});

/**
 * The model's own elimination picture, played exactly: ranks N..2 bust in turn, each
 * killer is uniform among the ranks still alive, a knockout pays half the victim's head
 * in cash and moves the other half onto the killer's head, and the winner also cashes
 * the own final head. Every killer assignment is enumerated, so for N <= 7 the moments
 * of each rank's bounty take are exact. Unit starting head.
 */
function eliminationTree(players: number) {
  const mean = new Float64Array(players);
  const second = new Float64Array(players);
  const killer = new Int32Array(players + 1);
  const head = new Float64Array(players + 1);
  const cash = new Float64Array(players + 1);
  let leaves = 0;
  const walk = (rank: number): void => {
    if (rank === 1) {
      head.fill(1);
      cash.fill(0);
      for (let r = players; r >= 2; r--) {
        const half = head[r] / 2;
        cash[killer[r]] += half;
        head[killer[r]] += half;
      }
      cash[1] += head[1];
      for (let r = 1; r <= players; r++) {
        mean[r - 1] += cash[r];
        second[r - 1] += cash[r] * cash[r];
      }
      leaves++;
      return;
    }
    for (let k = 1; k < rank; k++) {
      killer[rank] = k;
      walk(rank - 1);
    }
  };
  walk(players);
  const variance = new Float64Array(players);
  for (let i = 0; i < players; i++) {
    mean[i] /= leaves;
    variance[i] = second[i] / leaves - mean[i] * mean[i];
  }
  return { mean, variance };
}

/**
 * The same tree's per-rank moments by a second-moment recursion over the busts (the
 * hero's cash, the hero's head and a typical other head with their cross moments), for
 * fields too large to enumerate. Checked against `eliminationTree` below.
 */
function eliminationTreeRecursion(players: number) {
  const mean = new Float64Array(players);
  const variance = new Float64Array(players);
  let a = 0, b = 1, c = 1, A = 0, Bq = 1, D = 0, E1 = 0, F = 1, G = 1, K = 1;
  for (let alive = players; alive >= 2; alive--) {
    const q = 1 / (alive - 1);
    const next = {
      a: a + (q * c) / 2, b: b + (q * c) / 2, c: c + (q * c) / 2,
      A: A + q * (E1 + G / 4), Bq: Bq + q * (F + G / 4), D: D + q * (E1 / 2 + F / 2 + G / 4),
      E1: E1 + q * (K / 2) + q * (E1 / 2), F: F + q * (K / 2) + q * (F / 2), G: G + q * (K + G / 4), K: K * (1 + q),
    };
    ({ a, b, c, A, Bq, D, E1, F, G, K } = next);
    const place = alive - 1;
    if (place >= 2) {
      mean[place - 1] = a;
      variance[place - 1] = A - a * a;
    } else {
      mean[0] = a + b;
      variance[0] = A + 2 * D + Bq - (a + b) * (a + b);
    }
  }
  return { mean, variance };
}

function pko(players: number, overrides: Partial<TournamentRow> = {}): TournamentRow {
  return {
    id: "pko", gameType: "pko", payoutStructure: "mtt-gg-bounty", bountyFraction: 0.5, pkoHeadVar: 0.4,
    players, buyIn: 100, rake: 0.1, roi: 0.05, count: 1, ...overrides,
  };
}

function pmfOf(entry: ReturnType<typeof compileOne>): Float64Array {
  const n = entry.aliasProb.length;
  const pmf = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    pmf[i] += entry.aliasProb[i] / n;
    pmf[entry.aliasIdx[i]] += (1 - entry.aliasProb[i]) / n;
  }
  return pmf;
}

/** Mean and variance of the bounty at one place: the entry played with all its mass on that place and no prize. */
function bountyAtPlace(entry: ReturnType<typeof compileOne>, place: number) {
  const n = entry.aliasProb.length;
  const moments = compiledEntryMoments({
    ...entry,
    aliasProb: new Float64Array(n),
    aliasIdx: new Int32Array(n).fill(place),
    prizeByPlace: new Float64Array(n),
  });
  return { mean: moments.meanDollar, variance: moments.secondDollar - moments.meanDollar ** 2 };
}

/** Sigma of one entry with the engine's pmf, prizes and bounty means but the tree's spread at every place. */
function treeSigma(entry: ReturnType<typeof compileOne>, tree: { mean: Float64Array; variance: Float64Array }) {
  const pmf = pmfOf(entry);
  const scale = entry.bountyByPlace![0] / tree.mean[0];
  let mean = 0;
  let second = 0;
  for (let i = 0; i < pmf.length; i++) {
    const value = entry.prizeByPlace[i] + entry.bountyByPlace![i];
    mean += pmf[i] * value;
    second += pmf[i] * (value * value + tree.variance[i] * scale * scale);
  }
  return Math.sqrt(second - mean * mean);
}

const sigmaOf = (m: { meanDollar: number; secondDollar: number }) => Math.sqrt(m.secondDollar - m.meanDollar ** 2);
const REALDATA = { id: "powerlaw-realdata-influenced" } as const;

describe("PKO bounty against the exact elimination tree", () => {
  it("the moment recursion reproduces the enumerated tree", () => {
    for (let players = 2; players <= 7; players++) {
      const exact = eliminationTree(players);
      const recursion = eliminationTreeRecursion(players);
      for (let i = 0; i < players; i++) {
        expect(recursion.mean[i]).toBeCloseTo(exact.mean[i], 12);
        expect(recursion.variance[i]).toBeCloseTo(exact.variance[i], 10);
      }
    }
  });

  it("keeps the tree's mean at every place, with and without head noise", () => {
    for (let players = 2; players <= 7; players++) {
      const tree = eliminationTree(players);
      for (const pkoHeadVar of [0, 0.4]) {
        const entry = compileOne(pko(players, { pkoHeadVar }), REALDATA);
        const scale = entry.bountyByPlace![0] / tree.mean[0];
        for (let i = 0; i < players; i++) {
          expect(Math.abs(bountyAtPlace(entry, i).mean - tree.mean[i] * scale)).toBeLessThan(1e-9 * scale);
        }
      }
    }
  });

  it("matches the tree's spread at every place, also where the knockout count alone runs over", () => {
    // The Bernoulli knockouts at their stage's mean cash spread more than the tree at 2nd place
    // in fields of 4 to 44 and 3rd in fields of 5 to 10 (sd 1.038x at 2nd of 7 players), and
    // those places are shrunk onto the tree; everywhere else a log-normal factor widens them.
    for (let players = 2; players <= 7; players++) {
      const tree = eliminationTree(players);
      for (const pkoHeadVar of [0, 0.4]) {
        const entry = compileOne(pko(players, { pkoHeadVar }), REALDATA);
        const scale = entry.bountyByPlace![0] / tree.mean[0];
        expect(bountyAtPlace(entry, players - 1).variance).toBe(0);
        for (let i = 0; i < players - 1; i++) {
          const treeSd = Math.sqrt(tree.variance[i]) * scale;
          const sd = Math.sqrt(Math.max(0, bountyAtPlace(entry, i).variance));
          if (treeSd < 1e-9 * scale) {
            expect(sd).toBeLessThan(1e-6 * scale);
            continue;
          }
          expect(sd / treeSd, `N=${players} place ${i + 1}`).toBeCloseTo(1, 9);
        }
      }
    }
  });

  it("shrinks only the places where the count over-spreads, and meets the factor where they end", () => {
    for (let players = 2; players <= 60; players++) {
      const entry = compileOne(pko(players), REALDATA);
      const shrunk: number[] = [];
      for (let i = 0; i < players - 1; i++) {
        if (entry.pkoHaulShrink![i] < 1) {
          shrunk.push(i + 1);
          expect(entry.pkoKoLogSigma![i]).toBe(0);
        } else {
          expect(entry.pkoHaulShift![i]).toBe(0);
        }
      }
      const expected = [...(players >= 4 && players <= 44 ? [2] : []), ...(players >= 5 && players <= 10 ? [3] : [])];
      expect(shrunk, `N=${players}`).toEqual(expected);
    }
    expect(compileOne(pko(44), REALDATA).pkoHaulShrink![1] ** 2).toBeGreaterThan(0.999);
    expect(compileOne(pko(45), REALDATA).pkoKoLogSigma![1] ** 2).toBeLessThan(0.001);
  });

  it("puts sigma per tournament on the tree's at every field, bounty share and ROI", () => {
    // Every place has the tree's mean and variance, so only rounding is left. A target the
    // finish model cannot reach (calibration warning) is skipped: its pmf is not the row's.
    let checked = 0;
    for (const players of [2, 3, 4, 5, 6, 7, 9, 13, 18, 27, 50, 180, 1000, 5000]) {
      const tree = players <= 7 ? eliminationTree(players) : eliminationTreeRecursion(players);
      for (const bountyFraction of [0.2, 0.5, 0.9]) {
        for (const roi of [-0.3, -1 / 11, 0.1, 0.5, 1, 2]) {
          const entry = compileOne(pko(players, { bountyFraction, roi }), REALDATA);
          if (entry.calibrationWarning) continue;
          checked++;
          const ratio = sigmaOf(compiledEntryMoments(entry)) / treeSigma(entry, tree);
          expect(Math.abs(ratio - 1), `N=${players} share=${bountyFraction} roi=${roi}`).toBeLessThan(1e-9);
        }
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it("does not read pkoHeadVar on a PKO row", () => {
    for (const players of [6, 500]) {
      const off = compiledEntryMoments(compileOne(pko(players, { pkoHeadVar: 0 }), REALDATA));
      const wide = compiledEntryMoments(compileOne(pko(players, { pkoHeadVar: 1.5 }), REALDATA));
      expect(wide.secondDollar).toBe(off.secondDollar);
    }
  });

  it("pays a heads-up winner exactly both heads", () => {
    const entry = compileOne(pko(2), REALDATA);
    expect(bountyAtPlace(entry, 0).variance).toBeCloseTo(0, 9);
    expect(entry.bountyByPlace![1]).toBe(0);
  });

  it("adds up the place means of every heat bin: the knockouts and the own head average to the raw weight", () => {
    for (const players of [2, 6, 9, 180]) {
      const entry = compileOne(pko(players, { pkoHeat: 0.5 }), REALDATA);
      const koCash = entry.pkoKoCash!;
      for (let place = 0; place < players; place++) {
        let haul = place === 0 ? entry.pkoWinnerHead : 0;
        for (let j = place + 1; j < players; j++) haul += koCash[j] / j;
        if (entry.pkoRawInv![place] === 0) expect(haul).toBe(0);
        else expect(haul * entry.pkoRawInv![place]).toBeCloseTo(1, 12);
      }
      const pmf = pmfOf(entry);
      const budget = pmf.reduce((sum, p, i) => sum + p * entry.bountyByPlace![i], 0);
      for (const bin of entry.heatBountyByPlace!) {
        expect(pmf.reduce((sum, p, i) => sum + p * bin[i], 0)).toBeCloseTo(budget, 9);
      }
    }
  });

  it("leaves Mystery and Battle Royale on their Poisson knockout draw", () => {
    const mystery = compileOne(pko(500, { gameType: "mystery", mysteryBountyVariance: 2, pkoHeadVar: undefined }), REALDATA);
    const royale = compileOne({ ...pko(18, { pkoHeadVar: undefined }), gameType: "mystery-royale", payoutStructure: "battle-royale", buyIn: 10, rake: 0.08 }, REALDATA);
    for (const entry of [mystery, royale]) {
      expect(entry.pkoKoCash).toBeNull();
      expect(entry.pkoRawInv).toBeNull();
      expect(entry.pkoKoLogSigma).toBeNull();
      expect(entry.pkoHaulVariance).toBeNull();
      expect(entry.pkoWinnerHead).toBe(0);
    }
  });
});
