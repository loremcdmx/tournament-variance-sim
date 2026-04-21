import type { TournamentRow } from "./types";
import { clampItmTopHeavyBias } from "./itmTopHeavy";

export interface BattleRoyaleWinnerFirstResult {
  pmf: Float64Array;
  currentWinnings: number;
  feasible: boolean;
}

export interface BattleRoyaleCashTargetResult {
  centerPmf: Float64Array;
  centerCashEV: number;
  desiredCashEV: number;
  minCashEV: number;
  maxCashEV: number;
}

function hasManualShells(
  finishBuckets: TournamentRow["finishBuckets"] | undefined,
): boolean {
  return (
    finishBuckets?.first != null ||
    finishBuckets?.top3 != null ||
    finishBuckets?.ft != null
  );
}

function normalizeTop3State(
  anchorPmf: Float64Array,
  itmRate: number,
): { first: number; second: number; third: number } {
  const clampedItm = Math.max(0, Math.min(1, itmRate));
  const first = Math.max(0, Math.min(clampedItm, anchorPmf[0] ?? 0));
  const second = Math.max(
    0,
    Math.min(clampedItm - first, anchorPmf[1] ?? 0),
  );
  const third = Math.max(0, clampedItm - first - second);
  return { first, second, third };
}

function currentCashEV(
  state: { first: number; second: number; third: number },
  prize1: number,
  prize2: number,
  prize3: number,
): number {
  return (
    state.first * prize1 +
    state.second * prize2 +
    state.third * prize3
  );
}

function buildFullPmf(
  N: number,
  itmRate: number,
  state: { first: number; second: number; third: number },
): Float64Array {
  const clampedItm = Math.max(0, Math.min(1, itmRate));
  const pmf = new Float64Array(N);
  pmf[0] = Math.max(0, state.first);
  pmf[1] = Math.max(0, state.second);
  pmf[2] = Math.max(0, clampedItm - pmf[0] - pmf[1]);
  const rest = N - 3;
  if (rest > 0) {
    const q = (1 - clampedItm) / rest;
    for (let i = 3; i < N; i++) pmf[i] = q;
  }
  return pmf;
}

function rebuildTop3StateForCashTarget(
  clampedItm: number,
  prize1: number,
  prize2: number,
  prize3: number,
  targetWinnings: number,
  first: number,
): { first: number; second: number; third: number } {
  const denom = prize2 - prize3;
  const alpha = (targetWinnings - prize3 * clampedItm) / denom;
  const beta = (prize1 - prize3) / denom;
  const second = alpha - beta * first;
  const third = clampedItm - first - second;
  return {
    first: Math.max(0, first),
    second: Math.max(0, second),
    third: Math.max(0, third),
  };
}

function top3FirstBounds(
  clampedItm: number,
  prize1: number,
  prize2: number,
  prize3: number,
  targetWinnings: number,
): { min: number; max: number } {
  const min = Math.max(0, (targetWinnings - prize2 * clampedItm) / (prize1 - prize2));
  const max = Math.min(
    clampedItm,
    (targetWinnings - prize3 * clampedItm) / (prize1 - prize3),
  );
  return {
    min: Math.max(0, min),
    max: Math.max(0, max),
  };
}

function canUseBattleRoyaleTop3Solver(opts: {
  N: number;
  payouts: readonly number[];
  itmRate: number;
  finishBuckets: TournamentRow["finishBuckets"] | undefined;
}): {
  clampedItm: number;
  prize1: number;
  prize2: number;
  prize3: number;
} | null {
  const { N, payouts, itmRate, finishBuckets } = opts;
  if (N < 3 || hasManualShells(finishBuckets)) return null;
  const paidCount = payouts.reduce((n, p) => (p > 0 ? n + 1 : n), 0);
  if (paidCount !== 3) return null;

  const clampedItm = Math.max(0, Math.min(1, itmRate));
  if (clampedItm <= 0) return null;

  const prize1 = payouts[0];
  const prize2 = payouts[1];
  const prize3 = payouts[2];
  if (!(prize1 > prize2 && prize2 > prize3)) return null;

  return { clampedItm, prize1, prize2, prize3 };
}

export function buildBattleRoyaleCashTargetPmf(opts: {
  N: number;
  payouts: readonly number[];
  prizePool: number;
  itmRate: number;
  targetWinnings: number;
  anchorPmf: Float64Array;
  anchorWinnings: number;
  finishBuckets: TournamentRow["finishBuckets"] | undefined;
  preferTopHeavy?: boolean;
  topHeavyBias?: number;
}): BattleRoyaleWinnerFirstResult | null {
  const {
    N,
    payouts,
    prizePool,
    itmRate,
    targetWinnings,
    anchorPmf,
    finishBuckets,
    preferTopHeavy = false,
    topHeavyBias = 0,
  } = opts;

  const meta = canUseBattleRoyaleTop3Solver({
    N,
    payouts,
    itmRate,
    finishBuckets,
  });
  if (!meta) return null;

  const { clampedItm } = meta;
  const prize1 = meta.prize1 * prizePool;
  const prize2 = meta.prize2 * prizePool;
  const prize3 = meta.prize3 * prizePool;
  const gainFirstVsThird = prize1 - prize3;
  const gainFirstVsSecond = prize1 - prize2;
  const gainSecondVsThird = prize2 - prize3;
  if (
    gainFirstVsThird <= 1e-12 ||
    gainFirstVsSecond <= 1e-12 ||
    gainSecondVsThird <= 1e-12
  ) {
    return null;
  }

  const minCashEV = clampedItm * prize3;
  const maxCashEV = clampedItm * prize1;
  let feasible = true;
  let clampedTarget = targetWinnings;
  if (clampedTarget < minCashEV) {
    clampedTarget = minCashEV;
    feasible = false;
  } else if (clampedTarget > maxCashEV) {
    clampedTarget = maxCashEV;
    feasible = false;
  }

  const anchorState = normalizeTop3State(anchorPmf, clampedItm);
  const anchorCashEV = currentCashEV(anchorState, prize1, prize2, prize3);
  const state = { ...anchorState };
  if (clampedTarget >= anchorCashEV - 1e-9) {
    let remainingGain = clampedTarget - anchorCashEV;
    if (remainingGain > 1e-9) {
      const shiftFromThird = Math.min(
        state.third,
        remainingGain / gainFirstVsThird,
      );
      if (shiftFromThird > 0) {
        state.first += shiftFromThird;
        state.third -= shiftFromThird;
        remainingGain -= shiftFromThird * gainFirstVsThird;
      }
    }

    if (remainingGain > 1e-9) {
      const shiftFromSecond = Math.min(
        state.second,
        remainingGain / gainFirstVsSecond,
      );
      if (shiftFromSecond > 0) {
        state.first += shiftFromSecond;
        state.second -= shiftFromSecond;
        remainingGain -= shiftFromSecond * gainFirstVsSecond;
      }
    }

    if (remainingGain > 1e-6) feasible = false;
  } else {
    let remainingLoss = anchorCashEV - clampedTarget;
    if (preferTopHeavy && remainingLoss > 1e-9) {
      const shiftFromSecond = Math.min(
        state.second,
        remainingLoss / gainSecondVsThird,
      );
      if (shiftFromSecond > 0) {
        state.second -= shiftFromSecond;
        state.third += shiftFromSecond;
        remainingLoss -= shiftFromSecond * gainSecondVsThird;
      }
    }

    if (remainingLoss > 1e-9) {
      const shiftFromFirst = Math.min(
        state.first,
        remainingLoss / gainFirstVsThird,
      );
      if (shiftFromFirst > 0) {
        state.first -= shiftFromFirst;
        state.third += shiftFromFirst;
        remainingLoss -= shiftFromFirst * gainFirstVsThird;
      }
    }

    if (!preferTopHeavy && remainingLoss > 1e-9) {
      const shiftFromSecond = Math.min(
        state.second,
        remainingLoss / gainSecondVsThird,
      );
      if (shiftFromSecond > 0) {
        state.second -= shiftFromSecond;
        state.third += shiftFromSecond;
        remainingLoss -= shiftFromSecond * gainSecondVsThird;
      }
    }

    if (remainingLoss > 1e-6) feasible = false;
  }

  const clampedTopHeavyBias = clampItmTopHeavyBias(topHeavyBias);
  if (Math.abs(clampedTopHeavyBias) > 1e-9) {
    const bounds = top3FirstBounds(
      clampedItm,
      prize1,
      prize2,
      prize3,
      clampedTarget,
    );
    const defaultFirst = Math.max(bounds.min, Math.min(bounds.max, state.first));
    const targetFirst =
      clampedTopHeavyBias >= 0
        ? defaultFirst + (bounds.max - defaultFirst) * clampedTopHeavyBias
        : defaultFirst + (defaultFirst - bounds.min) * clampedTopHeavyBias;
    const biasedState = rebuildTop3StateForCashTarget(
      clampedItm,
      prize1,
      prize2,
      prize3,
      clampedTarget,
      Math.max(bounds.min, Math.min(bounds.max, targetFirst)),
    );
    state.first = biasedState.first;
    state.second = biasedState.second;
    state.third = biasedState.third;
  }

  const pmf = buildFullPmf(N, clampedItm, state);
  const currentWinnings = currentCashEV(state, prize1, prize2, prize3);
  if (Math.abs(currentWinnings - targetWinnings) > 1e-6) feasible = false;
  return { pmf, currentWinnings, feasible };
}

export function resolveBattleRoyaleCashTarget(opts: {
  N: number;
  payouts: readonly number[];
  prizePool: number;
  itmRate: number;
  centerCashTarget: number;
  bias: number;
  neutralPmf: Float64Array;
  neutralWinnings: number;
  finishBuckets: TournamentRow["finishBuckets"] | undefined;
  preferTopHeavy?: boolean;
  topHeavyBias?: number;
}): BattleRoyaleCashTargetResult | null {
  const {
    N,
    payouts,
    prizePool,
    itmRate,
    centerCashTarget,
    bias,
    neutralPmf,
    neutralWinnings,
    finishBuckets,
    preferTopHeavy = false,
    topHeavyBias = 0,
  } = opts;

  const meta = canUseBattleRoyaleTop3Solver({
    N,
    payouts,
    itmRate,
    finishBuckets,
  });
  if (!meta) return null;

  const center = buildBattleRoyaleCashTargetPmf({
    N,
    payouts,
    prizePool,
    itmRate,
    targetWinnings: centerCashTarget,
    anchorPmf: neutralPmf,
    anchorWinnings: neutralWinnings,
    finishBuckets,
    preferTopHeavy,
    topHeavyBias,
  });
  if (!center) return null;

  const maxCashEV = meta.clampedItm * meta.prize1 * prizePool;
  const minCashEV = meta.clampedItm * meta.prize3 * prizePool;
  const clampedBias = Math.max(-0.25, Math.min(0.25, bias));
  let desiredCashEV = center.currentWinnings;
  if (clampedBias >= 0) {
    desiredCashEV +=
      (maxCashEV - center.currentWinnings) * (clampedBias / 0.25);
  } else {
    desiredCashEV +=
      (minCashEV - center.currentWinnings) * (-clampedBias / 0.25);
  }

  return {
    centerPmf: center.pmf,
    centerCashEV: center.currentWinnings,
    desiredCashEV,
    minCashEV,
    maxCashEV,
  };
}

export function buildBattleRoyaleWinnerFirstPmf(opts: {
  N: number;
  payouts: readonly number[];
  prizePool: number;
  itmRate: number;
  targetWinnings: number;
  neutralPmf: Float64Array;
  neutralWinnings: number;
  finishBuckets: TournamentRow["finishBuckets"] | undefined;
  preferTopHeavy?: boolean;
  topHeavyBias?: number;
}): BattleRoyaleWinnerFirstResult | null {
  const {
    N,
    payouts,
    prizePool,
    itmRate,
    targetWinnings,
    neutralPmf,
    neutralWinnings,
    finishBuckets,
    preferTopHeavy = false,
    topHeavyBias = 0,
  } = opts;
  return buildBattleRoyaleCashTargetPmf({
    N,
    payouts,
    prizePool,
    itmRate,
    targetWinnings,
    anchorPmf: neutralPmf,
    anchorWinnings: neutralWinnings,
    finishBuckets,
    preferTopHeavy,
    topHeavyBias,
  });
}
