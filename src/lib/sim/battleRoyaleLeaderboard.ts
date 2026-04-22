import type {
  BattleRoyaleLeaderboardConfig,
  BattleRoyaleLeaderboardPayoutTier,
  BattleRoyaleLeaderboardScoring,
} from "./types";

export interface NormalizedBattleRoyaleLeaderboardConfig {
  participants: number;
  windowTournaments: number;
  awardPartialWindow: boolean;
  scoring: {
    entryPoints: number;
    knockoutPoints: number;
    firstPoints: number;
    secondPoints: number;
    thirdPoints: number;
  };
  payouts: BattleRoyaleLeaderboardPayoutTier[];
  opponentModel: {
    meanScore: number;
    stdDevScore: number;
  };
  maxPaidRank: number;
}

function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const a = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-a * a);
  return 0.5 * (1 + sign * y);
}

function normalizePayouts(
  payouts: BattleRoyaleLeaderboardPayoutTier[],
  participants: number,
): BattleRoyaleLeaderboardPayoutTier[] {
  return payouts
    .map((tier) => ({
      rankFrom: Math.max(1, Math.floor(tier.rankFrom)),
      rankTo: Math.max(1, Math.floor(tier.rankTo)),
      prizeEach: Number.isFinite(tier.prizeEach) ? Math.max(0, tier.prizeEach) : 0,
    }))
    .filter((tier) => tier.prizeEach > 0)
    .map((tier) => {
      const lo = Math.min(tier.rankFrom, tier.rankTo);
      const hi = Math.max(tier.rankFrom, tier.rankTo);
      return {
        rankFrom: Math.min(lo, participants),
        rankTo: Math.min(hi, participants),
        prizeEach: tier.prizeEach,
      };
    })
    .filter((tier) => tier.rankFrom <= tier.rankTo)
    .sort((a, b) => a.rankFrom - b.rankFrom || a.rankTo - b.rankTo);
}

export function normalizeBattleRoyaleLeaderboardConfig(
  config: BattleRoyaleLeaderboardConfig | null | undefined,
): NormalizedBattleRoyaleLeaderboardConfig | null {
  if (!config) return null;
  const participants = Math.max(2, Math.floor(config.participants));
  const windowTournaments = Math.max(1, Math.floor(config.windowTournaments));
  const payouts = normalizePayouts(config.payouts, participants);
  if (payouts.length === 0) return null;
  const model = config.opponentModel;
  if (model.kind !== "normal") return null;
  const stdDevScore = Number.isFinite(model.stdDevScore)
    ? Math.max(1e-9, model.stdDevScore)
    : 1e-9;
  const scoring = config.scoring;
  return {
    participants,
    windowTournaments,
    awardPartialWindow: config.awardPartialWindow !== false,
    scoring: {
      entryPoints: Number.isFinite(scoring.entryPoints) ? scoring.entryPoints ?? 0 : 0,
      knockoutPoints: Number.isFinite(scoring.knockoutPoints)
        ? scoring.knockoutPoints
        : 0,
      firstPoints: Number.isFinite(scoring.firstPoints) ? scoring.firstPoints : 0,
      secondPoints: Number.isFinite(scoring.secondPoints) ? scoring.secondPoints : 0,
      thirdPoints: Number.isFinite(scoring.thirdPoints) ? scoring.thirdPoints : 0,
    },
    payouts,
    opponentModel: {
      meanScore: Number.isFinite(model.meanScore) ? model.meanScore : 0,
      stdDevScore,
    },
    maxPaidRank: payouts.reduce((m, tier) => Math.max(m, tier.rankTo), 0),
  };
}

export function battleRoyaleLeaderboardPoints(
  scoring: BattleRoyaleLeaderboardScoring | NormalizedBattleRoyaleLeaderboardConfig["scoring"],
  place: number,
  knockouts: number,
): number {
  let points = Number.isFinite(scoring.entryPoints) ? (scoring.entryPoints ?? 0) : 0;
  if (place === 1) points += scoring.firstPoints;
  else if (place === 2) points += scoring.secondPoints;
  else if (place === 3) points += scoring.thirdPoints;
  if (Number.isFinite(knockouts) && knockouts > 0) {
    points += knockouts * scoring.knockoutPoints;
  }
  return points;
}

export function payoutForLeaderboardRank(
  rank: number,
  payouts: readonly BattleRoyaleLeaderboardPayoutTier[],
): number {
  for (const tier of payouts) {
    if (rank >= tier.rankFrom && rank <= tier.rankTo) return tier.prizeEach;
  }
  return 0;
}

export function expectedLeaderboardPayoutFromBeatProb(
  beatProb: number,
  config: NormalizedBattleRoyaleLeaderboardConfig,
): number {
  const nOpp = Math.max(0, config.participants - 1);
  const maxBetter = Math.min(nOpp, config.maxPaidRank - 1);
  if (maxBetter < 0) return 0;
  if (beatProb <= 0) return payoutForLeaderboardRank(1, config.payouts);
  if (beatProb >= 1) return 0;

  const q = 1 - beatProb;
  let prob = Math.pow(q, nOpp);
  let expected = prob * payoutForLeaderboardRank(1, config.payouts);
  for (let better = 1; better <= maxBetter; better++) {
    prob *= ((nOpp - better + 1) / better) * (beatProb / q);
    expected +=
      prob * payoutForLeaderboardRank(better + 1, config.payouts);
  }
  return expected;
}

function poissonKnuth(lambda: number, rng: () => number): number {
  const L = Math.exp(-lambda);
  let p = 1;
  let k = 0;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

function sampleBinomial(
  n: number,
  p: number,
  rng: () => number,
  gauss: () => number,
): number {
  if (n <= 0) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return n;
  if (n <= 48) {
    let acc = 0;
    for (let i = 0; i < n; i++) if (rng() < p) acc++;
    return acc;
  }

  const mean = n * p;
  const meanFail = n * (1 - p);
  if (mean < 18) return Math.min(n, poissonKnuth(mean, rng));
  if (meanFail < 18) return Math.max(0, n - poissonKnuth(meanFail, rng));

  const sigma = Math.sqrt(n * p * (1 - p));
  const draw = Math.round(mean + sigma * gauss());
  if (draw < 0) return 0;
  if (draw > n) return n;
  return draw;
}

export function sampleBattleRoyaleLeaderboardWindow(
  score: number,
  config: NormalizedBattleRoyaleLeaderboardConfig,
  rng: () => number,
  gauss: () => number,
): { rank: number; payout: number; beatProb: number; expectedPayout: number } {
  const nOpp = Math.max(0, config.participants - 1);
  const { meanScore, stdDevScore } = config.opponentModel;
  let beatProb = 0.5;
  if (stdDevScore > 1e-9) {
    beatProb = 1 - normalCdf((score - meanScore) / stdDevScore);
  } else if (score > meanScore) {
    beatProb = 0;
  } else if (score < meanScore) {
    beatProb = 1;
  }
  if (beatProb < 0) beatProb = 0;
  else if (beatProb > 1) beatProb = 1;
  const better = sampleBinomial(nOpp, beatProb, rng, gauss);
  const rank = better + 1;
  return {
    rank,
    payout: payoutForLeaderboardRank(rank, config.payouts),
    beatProb,
    expectedPayout: expectedLeaderboardPayoutFromBeatProb(beatProb, config),
  };
}
