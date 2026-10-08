import { describe, expect, it } from "vitest";
import { compileSchedule } from "./compile";
import {
  createDownsideReportState, DOWNSIDE_TIE_TOLERANCE, observeDownsideReport, resetDownsideReportState,
} from "./downsideReport";
import { mergeShards } from "./engine";
import { makeCheckpointGrid } from "./grids";
import { simulateShard } from "./hotLoop";
import type { SimulationInput } from "./types";

function smallInput(): SimulationInput {
  return {
    schedule: [{ id: "ocean", gameType: "ocean-ko", players: 20, buyIn: 92,
      rake: 8 / 92, bountyFraction: 50 / 92, roi: 0.1, count: 12, payoutStructure: "mtt-gg-bounty" }],
    scheduleRepeats: 1, samples: 20, seed: 71183, bankroll: 1000,
    finishModel: { id: "power-law" },
  };
}

describe("every-entry downside observation", () => {
  it("separates a peak drawdown, missing EV and consecutive losses", () => {
    const state = createDownsideReportState();
    const profits = [5, 3, 3, 5, 4, 3, 4, 8];
    let previous = 0;
    profits.forEach((profit, index) => {
      observeDownsideReport(state, profit, index + 1, profit - previous, 1);
      previous = profit;
    });
    expect(state.maxEvShortfall).toBe(3);
    expect(state.entriesBelowEv).toBe(3);
    expect(state.longestBelowEv).toBe(3);
    expect(state.longestUnderwater).toBe(3);
    expect(state.longestLosingEntries).toBe(2);
    expect(state.belowEvRun).toBe(0);
    expect(state.underwaterRun).toBe(0);
    resetDownsideReportState(state);
    expect(state).toEqual(createDownsideReportState());
  });

  it("counts the unfinished final streak and does not call breakeven a loss", () => {
    const state = createDownsideReportState();
    observeDownsideReport(state, -1, 0.1, -1, 1);
    observeDownsideReport(state, -1, 0.2, 0, 1);
    observeDownsideReport(state, -2, 0.3, -1, 1);
    expect(state.longestUnderwater).toBe(3);
    expect(state.longestBelowEv).toBe(3);
    expect(state.longestLosingEntries).toBe(1);
    expect(state.maxEvShortfall).toBe(2.3);
  });

  it("treats float-noise break-even entries as ties, not losses or dips below the peak", () => {
    // Battle Royale: a break-even entry can sum to -1.78e-15 instead of 0.
    const noise = -1.78e-15;
    const ticket = 10;
    const state = createDownsideReportState();
    let profit = 0;
    const observe = (delta: number, expected: number) => {
      profit += delta;
      observeDownsideReport(state, profit, expected, delta, ticket);
    };
    observe(30, 5);
    observe(noise, 10);
    observe(noise, 15);
    observe(0, 20);
    expect(profit).toBeLessThan(30);
    expect(state.longestLosingEntries).toBe(0);
    expect(state.longestUnderwater).toBe(0);
    expect(state.underwaterRun).toBe(0);
    expect(state.losingRun).toBe(0);
    // A tie that follows noise does not hide the next real loss from the peak.
    observe(-0.01, 25);
    observe(noise, 30);
    expect(state.longestLosingEntries).toBe(1);
    expect(state.longestUnderwater).toBe(2);
    expect(state.peak).toBe(30);
  });

  it("keeps the tolerance relative to the ticket and strict beyond it", () => {
    const ticket = 100;
    const eps = DOWNSIDE_TIE_TOLERANCE * ticket;
    const state = createDownsideReportState();
    observeDownsideReport(state, 50, 40, 50, ticket);
    observeDownsideReport(state, 50 - eps / 2, 40, -eps / 2, ticket);
    expect(state.longestLosingEntries).toBe(0);
    expect(state.longestUnderwater).toBe(0);
    observeDownsideReport(state, 50 - 2 * eps, 40, -2 * eps, ticket);
    expect(state.longestLosingEntries).toBe(1);
    expect(state.longestUnderwater).toBe(1);
    // EV ties get the same treatment: a profit within the tolerance of EV is not below it.
    const ev = createDownsideReportState();
    observeDownsideReport(ev, 10 - eps / 2, 10, 10, ticket);
    expect(ev.longestBelowEv).toBe(0);
    expect(ev.entriesBelowEv).toBe(0);
    observeDownsideReport(ev, 10 - 2 * eps, 10, 0, ticket);
    expect(ev.longestBelowEv).toBe(1);
  });

  it("leaves every existing random output byte-identical when enabled", () => {
    const input = smallInput();
    const compiled = compileSchedule(input);
    const grid = makeCheckpointGrid(compiled.tournamentsPerSample);
    const off = simulateShard(input, compiled, 0, input.samples, grid);
    const on = simulateShard({ ...input, collectDownsideReport: true }, compiled, 0, input.samples, grid);
    const { downsideReport, ...legacy } = on;
    expect(downsideReport).toBeDefined();
    expect(off).not.toHaveProperty("downsideReport");
    expect(legacy).toEqual(off);
  });

  // Wiring check only: it replays the stored paths through the same observer and the
  // engine's own EV table. The independent reference is the describe block below.
  it("feeds the observer every entry of the stored full-resolution path", () => {
    const input = { ...smallInput(), collectDownsideReport: true };
    const compiled = compileSchedule(input);
    const grid = makeCheckpointGrid(compiled.tournamentsPerSample);
    const shard = simulateShard(input, compiled, 0, input.samples, grid);
    for (let sample = 0; sample < input.samples; sample++) {
      const path = shard.hiResPaths[sample];
      const state = createDownsideReportState();
      let ev = 0;
      for (let i = 1; i < path.length; i++) {
        ev += compiled.flat[i - 1].analyticMeanSingle - compiled.flat[i - 1].singleCost;
        observeDownsideReport(state, path[i], ev, path[i] - path[i - 1], compiled.flat[i - 1].singleCost);
      }
      expect(shard.downsideReport!.maxEvShortfall[sample]).toBe(state.maxEvShortfall);
      expect(shard.downsideReport!.entriesBelowEv[sample]).toBe(state.entriesBelowEv);
      expect(shard.downsideReport!.longestBelowEv[sample]).toBe(state.longestBelowEv);
      expect(shard.downsideReport!.longestUnderwater[sample]).toBe(state.longestUnderwater);
      expect(shard.downsideReport!.longestLosingEntries[sample]).toBe(state.longestLosingEntries);
    }
  });

  it("preserves downside observations across arbitrary shard boundaries and order", () => {
    const input = { ...smallInput(), collectDownsideReport: true };
    const compiled = compileSchedule(input);
    const grid = makeCheckpointGrid(compiled.tournamentsPerSample);
    const full = simulateShard(input, compiled, 0, input.samples, grid);
    const first = simulateShard(input, compiled, 0, 7, grid);
    const second = simulateShard(input, compiled, 7, input.samples, grid);
    const merged = mergeShards([second, first], input.samples, grid.K + 1, 1);
    expect(merged.downsideReport).toEqual(full.downsideReport);
    expect(merged.finalProfits).toEqual(full.finalProfits);
    expect(merged.maxDrawdowns).toEqual(full.maxDrawdowns);
    const uncollected = simulateShard({ ...input, collectDownsideReport: false }, compiled, 0, 7, grid);
    expect(() => mergeShards([second, uncollected], input.samples, grid.K + 1, 1)).toThrow("collected and uncollected");
  });

  it("observes careers beyond the 1000-path display limit and independently of checkpoint sparsity", () => {
    const input = { ...smallInput(), samples: 1003, collectDownsideReport: true };
    const compiled = compileSchedule(input);
    const fullGrid = makeCheckpointGrid(compiled.tournamentsPerSample);
    const endpointGrid = { K: 1, checkpointIdx: Int32Array.of(0, compiled.tournamentsPerSample) };
    const detailed = simulateShard(input, compiled, 1000, 1003, fullGrid);
    const sparse = simulateShard(input, compiled, 1000, 1003, endpointGrid);
    expect(detailed.hiResPaths).toHaveLength(0);
    expect(detailed.downsideReport!.maxEvShortfall).toHaveLength(3);
    expect(detailed.downsideReport).toEqual(sparse.downsideReport);
    expect(detailed.finalProfits).toEqual(sparse.finalProfits);
  });
});

/** Longest stretch of consecutive `true` flags. */
function longestRun(flags: readonly boolean[]): number {
  let best = 0;
  let run = 0;
  for (const flag of flags) {
    run = flag ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/**
 * Plain-loop reference for one career. It shares nothing with `observeDownsideReport`:
 * no streaming state, one flag per entry, the running peak and the EV line rebuilt
 * from scratch. `path[0]` is the start; entry t moves `path[t-1]` to `path[t]`, with
 * the EV gained and the ticket paid by that entry given per entry. A tie is a gap of
 * at most 1e-9 of that entry's ticket.
 */
function referenceDownside(path: ArrayLike<number>, evGain: readonly number[], tickets: readonly number[]) {
  const entries = path.length - 1;
  const below: boolean[] = [];
  const underwater: boolean[] = [];
  const losing: boolean[] = [];
  let ev = 0;
  let maxShortfall = 0;
  let maxDrawdown = 0;
  for (let t = 1; t <= entries; t++) {
    const tie = 1e-9 * tickets[t - 1];
    ev += evGain[t - 1];
    const peakBefore = Math.max(...Array.from({ length: t }, (_, index) => path[index]));
    const peakNow = Math.max(peakBefore, path[t]);
    below.push(ev - path[t] > tie);
    underwater.push(path[t] < peakBefore - tie);
    losing.push(path[t] - path[t - 1] < -tie);
    maxShortfall = Math.max(maxShortfall, ev - path[t]);
    maxDrawdown = Math.max(maxDrawdown, peakNow - path[t]);
  }
  return {
    maxEvShortfall: maxShortfall,
    maxDrawdown,
    entriesBelowEv: below.filter(Boolean).length,
    longestBelowEv: longestRun(below),
    longestUnderwater: longestRun(underwater),
    longestLosingEntries: longestRun(losing),
  };
}

/** What the row promises per entry, from its inputs alone: ROI on the full ticket plus the rakeback credit. */
function promisedEvGain(input: SimulationInput, rowIdx: number) {
  const row = input.schedule[rowIdx];
  const ticket = row.buyIn * (1 + row.rake);
  return { ticket, evGain: row.roi * ticket + (input.rakebackFracOfRake ?? 0) * row.rake * row.buyIn };
}

function mixedInput(): SimulationInput {
  return {
    schedule: [
      { id: "freeze", gameType: "freezeout", players: 200, buyIn: 20, rake: 0.1, roi: 0.05, count: 25, payoutStructure: "mtt-standard" },
      { id: "pko", gameType: "pko", players: 100, buyIn: 50, rake: 0.1, bountyFraction: 0.5, roi: -0.1, count: 20, payoutStructure: "mtt-gg-bounty" },
      { id: "ocean", gameType: "ocean-ko", players: 30, buyIn: 92, rake: 8 / 92, bountyFraction: 50 / 92, roi: 0.2, count: 15, payoutStructure: "mtt-gg-bounty" },
    ],
    scheduleRepeats: 1, samples: 40, seed: 20261008, bankroll: 1000, finishModel: { id: "power-law" }, rakebackFracOfRake: 0.3,
  };
}

describe("downside metrics against a separate plain-loop reference", () => {
  it("gets the hand-worked path of the observer test right", () => {
    const reference = referenceDownside([0, 5, 3, 3, 5, 4, 3, 4, 8], Array(8).fill(1), Array(8).fill(1));
    expect(reference).toEqual({
      maxEvShortfall: 3, maxDrawdown: 2, entriesBelowEv: 3, longestBelowEv: 3, longestUnderwater: 3, longestLosingEntries: 2,
    });
    // A tie with the peak or with EV is not below it; float noise of a break-even entry is a tie too.
    const ties = referenceDownside([0, 30, 30 - 1.78e-15, 30 - 1.78e-15, 30 - 0.01], [5, 5, 5, 5], [10, 10, 10, 10]);
    expect(ties.longestUnderwater).toBe(1);
    expect(ties.longestLosingEntries).toBe(1);
  });

  it("agrees on twenty Ocean careers and on forty careers of a mixed schedule with rakeback", () => {
    expect(DOWNSIDE_TIE_TOLERANCE).toBe(1e-9);
    for (const base of [smallInput(), mixedInput()]) {
      const input = { ...base, collectDownsideReport: true };
      const compiled = compileSchedule(input);
      const grid = makeCheckpointGrid(compiled.tournamentsPerSample);
      const shard = simulateShard(input, compiled, 0, input.samples, grid);
      const promised = compiled.flat.map(entry => promisedEvGain(input, entry.rowIdx));
      compiled.flat.forEach((entry, index) => {
        expect(promised[index].ticket).toBeCloseTo(entry.singleCost, 9);
        expect(promised[index].evGain).toBeCloseTo(entry.analyticMeanSingle - entry.singleCost + entry.rakebackBonusPerBullet, 9);
      });
      const evGain = promised.map(item => item.evGain);
      const tickets = promised.map(item => item.ticket);
      const underwaterLengths = new Set<number>();
      const drawdowns = new Set<number>();
      for (let sample = 0; sample < input.samples; sample++) {
        const path = shard.hiResPaths[sample];
        expect(path).toHaveLength(compiled.tournamentsPerSample + 1);
        const reference = referenceDownside(path, evGain, tickets);
        const report = shard.downsideReport!;
        expect(report.maxEvShortfall[sample]).toBeCloseTo(reference.maxEvShortfall, 9);
        expect(report.entriesBelowEv[sample]).toBe(reference.entriesBelowEv);
        expect(report.longestBelowEv[sample]).toBe(reference.longestBelowEv);
        expect(report.longestUnderwater[sample]).toBe(reference.longestUnderwater);
        expect(report.longestLosingEntries[sample]).toBe(reference.longestLosingEntries);
        expect(shard.maxDrawdowns[sample]).toBeCloseTo(reference.maxDrawdown, 9);
        expect(shard.finalProfits[sample]).toBe(path[path.length - 1]);
        underwaterLengths.add(reference.longestUnderwater);
        drawdowns.add(reference.maxDrawdown);
      }
      // The agreement would prove little if every career looked the same.
      expect(underwaterLengths.size).toBeGreaterThan(3);
      expect(drawdowns.size).toBeGreaterThan(10);
    }
  });
});
