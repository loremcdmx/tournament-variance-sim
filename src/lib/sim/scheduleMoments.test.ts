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
