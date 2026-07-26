/**
 * Battle Royale leaderboard side-channel aggregation. Present only when the
 * hot loop recorded leaderboard buffers; rescales the sampled payouts onto
 * the compiled promo budget before reporting points/payout moments.
 */
import { normalizeBattleRoyaleLeaderboardConfig } from "./battleRoyaleLeaderboard";
import type { CompiledSchedule, RawShard } from "./engineTypes";
import type {
  BattleRoyaleLeaderboardResult,
  SimulationInput,
} from "./types";

export function buildLeaderboardResult(
  input: SimulationInput,
  compiled: CompiledSchedule,
  shard: RawShard,
  S: number,
): BattleRoyaleLeaderboardResult | undefined {
  const {
    leaderboardPoints,
    leaderboardPayouts,
    leaderboardExpectedPayouts,
    leaderboardWindows,
    leaderboardPaidWindows,
    leaderboardRankSums,
    leaderboardKnockouts,
    leaderboardFirsts,
    leaderboardSeconds,
    leaderboardThirds,
  } = shard;
  if (
    leaderboardPoints === null ||
    leaderboardPayouts === null ||
    leaderboardExpectedPayouts === null ||
    leaderboardWindows === null ||
    leaderboardPaidWindows === null ||
    leaderboardRankSums === null ||
    leaderboardKnockouts === null ||
    leaderboardFirsts === null ||
    leaderboardSeconds === null ||
    leaderboardThirds === null
  ) {
    return undefined;
  }
  let pointsMeanAcc = 0;
  let windowsAcc = 0;
  let paidWindowsAcc = 0;
  let rankAcc = 0;
  let koAcc = 0;
  let firstAcc = 0;
  let secondAcc = 0;
  let thirdAcc = 0;
  for (let i = 0; i < S; i++) {
    pointsMeanAcc += leaderboardPoints[i];
    windowsAcc += leaderboardWindows[i];
    paidWindowsAcc += leaderboardPaidWindows[i];
    rankAcc += leaderboardRankSums[i];
    koAcc += leaderboardKnockouts[i];
    firstAcc += leaderboardFirsts[i];
    secondAcc += leaderboardSeconds[i];
    thirdAcc += leaderboardThirds[i];
  }
  const meanPoints = pointsMeanAcc / S;
  let rawMeanPayout = 0;
  for (let i = 0; i < S; i++) {
    rawMeanPayout += leaderboardExpectedPayouts[i];
  }
  rawMeanPayout /= S;
  const splitMode =
    !!input.battleRoyaleLeaderboard?.includedRowIds &&
    input.battleRoyaleLeaderboard.includedRowIds.length > 0;
  const targetMeanPayout = splitMode
    ? Math.max(0, compiled.expectedLeaderboardPromo)
    : rawMeanPayout;
  const payoutScale =
    rawMeanPayout > 0 ? targetMeanPayout / rawMeanPayout : 1;
  if (payoutScale !== 1) {
    for (let i = 0; i < S; i++) leaderboardPayouts[i] *= payoutScale;
  }
  let pointsVarAcc = 0;
  let payoutVarAcc = 0;
  for (let i = 0; i < S; i++) {
    const dp = leaderboardPoints[i] - meanPoints;
    pointsVarAcc += dp * dp;
  }
  const meanPayout = targetMeanPayout;
  for (let i = 0; i < S; i++) {
    const dy = leaderboardPayouts[i] - meanPayout;
    payoutVarAcc += dy * dy;
  }
  const payoutSorted = leaderboardPayouts.slice().sort();
  const payoutPct = (p: number) =>
    payoutSorted[Math.min(S - 1, Math.max(0, Math.floor(p * (S - 1))))];
  const leaderboardConfig = normalizeBattleRoyaleLeaderboardConfig(
    input.battleRoyaleLeaderboard,
  )!;
  return {
    points: leaderboardPoints,
    payouts: leaderboardPayouts,
    windows: leaderboardWindows,
    paidWindows: leaderboardPaidWindows,
    rankSums: leaderboardRankSums,
    knockouts: leaderboardKnockouts,
    firsts: leaderboardFirsts,
    seconds: leaderboardSeconds,
    thirds: leaderboardThirds,
    stats: {
      meanPoints,
      stdDevPoints: Math.sqrt(pointsVarAcc / Math.max(1, S - 1)),
      meanPayout,
      stdDevPayout: Math.sqrt(payoutVarAcc / Math.max(1, S - 1)),
      p95Payout: payoutPct(0.95),
      p99Payout: payoutPct(0.99),
      meanWindows: windowsAcc / S,
      meanPaidWindows: paidWindowsAcc / S,
      paidWindowShare: windowsAcc > 0 ? paidWindowsAcc / windowsAcc : 0,
      meanRank: windowsAcc > 0 ? rankAcc / windowsAcc : 0,
      meanKnockouts: koAcc / S,
      meanFirsts: firstAcc / S,
      meanSeconds: secondAcc / S,
      meanThirds: thirdAcc / S,
    },
    config: {
      participants: leaderboardConfig.participants,
      windowTournaments: leaderboardConfig.windowTournaments,
      awardPartialWindow: leaderboardConfig.awardPartialWindow,
      maxPaidRank: leaderboardConfig.maxPaidRank,
    },
    sourceMix: {
      directRakebackMean: compiled.expectedBattleRoyaleSplitDirectRakeback,
      leaderboardMeanTarget: targetMeanPayout,
      totalPromoMean:
        compiled.expectedBattleRoyaleSplitDirectRakeback + targetMeanPayout,
      rows: compiled.battleRoyaleLeaderboardMix,
    },
  };
}
