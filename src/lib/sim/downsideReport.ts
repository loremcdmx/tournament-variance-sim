import type { DownsideReportArrays } from "./engineTypes";

export interface DownsideReportState {
  maxEvShortfall: number;
  entriesBelowEv: number;
  longestBelowEv: number;
  longestUnderwater: number;
  longestLosingEntries: number;
  belowEvRun: number;
  underwaterRun: number;
  losingRun: number;
  peak: number;
}

export function createDownsideReportArrays(samples: number): DownsideReportArrays {
  return {
    maxEvShortfall: new Float64Array(samples),
    entriesBelowEv: new Uint32Array(samples),
    longestBelowEv: new Uint32Array(samples),
    longestUnderwater: new Uint32Array(samples),
    longestLosingEntries: new Uint32Array(samples),
  };
}

export function createDownsideReportState(): DownsideReportState {
  return {
    maxEvShortfall: 0, entriesBelowEv: 0, longestBelowEv: 0,
    longestUnderwater: 0, longestLosingEntries: 0,
    belowEvRun: 0, underwaterRun: 0, losingRun: 0, peak: 0,
  };
}

export function resetDownsideReportState(state: DownsideReportState): void {
  state.maxEvShortfall = 0;
  state.entriesBelowEv = 0;
  state.longestBelowEv = 0;
  state.longestUnderwater = 0;
  state.longestLosingEntries = 0;
  state.belowEvRun = 0;
  state.underwaterRun = 0;
  state.losingRun = 0;
  state.peak = 0;
}

/** Observes every entry endpoint; ties with EV / the prior high end a streak.
 * No payout or RNG state is changed, and no memory is allocated per entry. */
export function observeDownsideReport(
  state: DownsideReportState,
  profit: number,
  expectedProfit: number,
  delta: number,
): void {
  const deficit = expectedProfit - profit;
  if (deficit > state.maxEvShortfall) state.maxEvShortfall = deficit;
  if (deficit > 0) {
    state.entriesBelowEv++;
    state.belowEvRun++;
    if (state.belowEvRun > state.longestBelowEv) state.longestBelowEv = state.belowEvRun;
  } else {
    state.belowEvRun = 0;
  }
  if (profit < state.peak) {
    state.underwaterRun++;
    if (state.underwaterRun > state.longestUnderwater) state.longestUnderwater = state.underwaterRun;
  } else {
    state.peak = profit;
    state.underwaterRun = 0;
  }
  if (delta < 0) {
    state.losingRun++;
    if (state.losingRun > state.longestLosingEntries) state.longestLosingEntries = state.losingRun;
  } else {
    state.losingRun = 0;
  }
}

export function saveDownsideReportState(
  arrays: DownsideReportArrays, sample: number, state: DownsideReportState,
): void {
  arrays.maxEvShortfall[sample] = state.maxEvShortfall;
  arrays.entriesBelowEv[sample] = state.entriesBelowEv;
  arrays.longestBelowEv[sample] = state.longestBelowEv;
  arrays.longestUnderwater[sample] = state.longestUnderwater;
  arrays.longestLosingEntries[sample] = state.longestLosingEntries;
}
