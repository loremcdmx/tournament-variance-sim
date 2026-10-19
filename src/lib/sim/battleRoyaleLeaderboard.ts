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
    .map((tier) => ({
      rankFrom: Math.min(tier.rankFrom, tier.rankTo),
      rankTo: Math.min(Math.max(tier.rankFrom, tier.rankTo), participants),
      prizeEach: tier.prizeEach,
    }))
    // A tier that starts past the last place has no one to pay; clamping its
    // start as well squeezed it onto last place.
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

const SMALLEST_NORMAL_DOUBLE = 2 ** -1022;
const LOG_SMALLEST_DOUBLE = -745;

// q^nOpp leaves double range from about nOpp * ln(1 / q) = 708; the linear
// recurrence then multiplies a zero (or a denormal that has lost its digits)
// for every later term, so the log of the term is carried instead.
function expectedPayoutInLogSpace(
  beatProb: number,
  q: number,
  nOpp: number,
  maxBetter: number,
  payouts: readonly BattleRoyaleLeaderboardPayoutTier[],
): number {
  const logOdds = Math.log(beatProb / q);
  const mode = (nOpp + 1) * beatProb;
  let logProb = nOpp * Math.log(q);
  let expected = 0;
  for (let better = 0; better <= maxBetter; better++) {
    if (better > 0) {
      logProb += Math.log((nOpp - better + 1) / better) + logOdds;
    }
    if (logProb > LOG_SMALLEST_DOUBLE) {
      expected += Math.exp(logProb) * payoutForLeaderboardRank(better + 1, payouts);
    } else if (better > mode) {
      break;
    }
  }
  return expected;
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
  if (prob < SMALLEST_NORMAL_DOUBLE) {
    return expectedPayoutInLogSpace(beatProb, q, nOpp, maxBetter, config.payouts);
  }
  let expected = prob * payoutForLeaderboardRank(1, config.payouts);
  for (let better = 1; better <= maxBetter; better++) {
    prob *= ((nOpp - better + 1) / better) * (beatProb / q);
    expected +=
      prob * payoutForLeaderboardRank(better + 1, config.payouts);
  }
  return expected;
}

function logFactorial(k: number): number {
  if (k < 2) return 0;
  if (k < 20) {
    let sum = 0;
    for (let i = 2; i <= k; i++) sum += Math.log(i);
    return sum;
  }
  const inv = 1 / k;
  const inv2 = inv * inv;
  return (
    k * Math.log(k) -
    k +
    0.5 * Math.log(2 * Math.PI * k) +
    inv * (1 / 12 - inv2 * (1 / 360 - inv2 / 1260))
  );
}

// Walking the outcomes outward from the mode, instead of up from zero, is
// still an exact inverse-CDF draw (any fixed order of the outcomes partitions
// [0, 1)), but it starts on a term that is representable for any n and ends
// after about a standard deviation of steps.
export function sampleBinomial(n: number, p: number, rng: () => number): number {
  if (n <= 0) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return n;
  if (n <= 48) {
    let acc = 0;
    for (let i = 0; i < n; i++) if (rng() < p) acc++;
    return acc;
  }

  const q = 1 - p;
  const odds = p / q;
  const mode = Math.min(n, Math.floor((n + 1) * p));
  const u = rng();
  let pmfUp = Math.exp(
    logFactorial(n) -
      logFactorial(mode) -
      logFactorial(n - mode) +
      mode * Math.log(p) +
      (n - mode) * Math.log(q),
  );
  let pmfDown = pmfUp;
  let cumulative = pmfUp;
  if (u < cumulative) return mode;
  let up = mode;
  let down = mode;
  // Past 12 standard deviations (and a floor of 64 for the Poisson-like thin
  // tails) less than 2^-32 of the mass is left, below what rng() can resolve;
  // the bound keeps an absurd field from walking n outcomes.
  const reach = Math.ceil(12 * Math.sqrt(n * p * q)) + 64;
  for (let step = 0; step < reach && (up < n || down > 0); step++) {
    if (up < n) {
      pmfUp *= ((n - up) / (up + 1)) * odds;
      up++;
      cumulative += pmfUp;
      if (u < cumulative) return up;
    }
    if (down > 0) {
      pmfDown *= (down / (n - down + 1)) / odds;
      down--;
      cumulative += pmfDown;
      if (u < cumulative) return down;
    }
  }
  return mode;
}

export function sampleBattleRoyaleLeaderboardWindow(
  score: number,
  config: NormalizedBattleRoyaleLeaderboardConfig,
  rng: () => number,
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
  const better = sampleBinomial(nOpp, beatProb, rng);
  const rank = better + 1;
  return {
    rank,
    payout: payoutForLeaderboardRank(rank, config.payouts),
    beatProb,
    expectedPayout: expectedLeaderboardPayoutFromBeatProb(beatProb, config),
  };
}
