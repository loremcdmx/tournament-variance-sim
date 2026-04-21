import type { TournamentRow } from "./types";

export interface BattleRoyaleWinnerFirstResult {
  pmf: Float64Array;
  currentWinnings: number;
  feasible: boolean;
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

export function buildBattleRoyaleWinnerFirstPmf(opts: {
  N: number;
  payouts: readonly number[];
  prizePool: number;
  itmRate: number;
  targetWinnings: number;
  neutralPmf: Float64Array;
  neutralWinnings: number;
  finishBuckets: TournamentRow["finishBuckets"] | undefined;
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
  } = opts;

  if (N < 3 || hasManualShells(finishBuckets)) return null;
  const paidCount = payouts.reduce((n, p) => (p > 0 ? n + 1 : n), 0);
  if (paidCount !== 3) return null;

  const clampedItm = Math.max(0, Math.min(1, itmRate));
  if (clampedItm <= 0) return null;
  if (targetWinnings < neutralWinnings - 1e-9) return null;

  const prize1 = payouts[0] * prizePool;
  const prize2 = payouts[1] * prizePool;
  const prize3 = payouts[2] * prizePool;
  if (!(prize1 > prize2 && prize2 > prize3)) return null;

  let first = Math.max(0, neutralPmf[0] ?? 0);
  let second = Math.max(0, neutralPmf[1] ?? 0);
  let third = Math.max(0, clampedItm - first - second);

  const gainFirstVsThird = prize1 - prize3;
  const gainFirstVsSecond = prize1 - prize2;
  if (gainFirstVsThird <= 1e-12 || gainFirstVsSecond <= 1e-12) return null;

  let remainingGain = targetWinnings - neutralWinnings;
  if (remainingGain > 1e-9) {
    const shiftFromThird = Math.min(third, remainingGain / gainFirstVsThird);
    if (shiftFromThird > 0) {
      first += shiftFromThird;
      third -= shiftFromThird;
      remainingGain -= shiftFromThird * gainFirstVsThird;
    }
  }

  if (remainingGain > 1e-9) {
    const shiftFromSecond = Math.min(second, remainingGain / gainFirstVsSecond);
    if (shiftFromSecond > 0) {
      first += shiftFromSecond;
      second -= shiftFromSecond;
      remainingGain -= shiftFromSecond * gainFirstVsSecond;
    }
  }

  first = Math.max(0, first);
  second = Math.max(0, second);
  third = Math.max(0, clampedItm - first - second);

  const pmf = new Float64Array(N);
  pmf[0] = first;
  pmf[1] = second;
  pmf[2] = third;
  const rest = N - 3;
  if (rest > 0) {
    const q = (1 - clampedItm) / rest;
    for (let i = 3; i < N; i++) pmf[i] = q;
  }

  const currentWinnings = first * prize1 + second * prize2 + third * prize3;
  const feasible = Math.abs(currentWinnings - targetWinnings) <= 1e-6;
  return { pmf, currentWinnings, feasible };
}
