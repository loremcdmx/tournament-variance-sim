import { describe, expect, it } from "vitest";
import {
  battleRoyaleLeaderboardPoints,
  expectedLeaderboardPayoutFromBeatProb,
  normalizeBattleRoyaleLeaderboardConfig,
  payoutForLeaderboardRank,
  sampleBattleRoyaleLeaderboardWindow,
  sampleBinomial,
  type NormalizedBattleRoyaleLeaderboardConfig,
} from "./battleRoyaleLeaderboard";
import { mulberry32 } from "./rng";

// Reference that shares nothing with the module: every pmf term is its own
// log-sum, with no recursion and no Stirling series.
function logBinomialPmf(n: number, k: number, p: number): number {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log((n - k + i) / i);
  return s + k * Math.log(p) + (n - k) * Math.log1p(-p);
}

function bruteForceExpectedPayout(
  beatProb: number,
  cfg: NormalizedBattleRoyaleLeaderboardConfig,
): number {
  const nOpp = cfg.participants - 1;
  const maxBetter = Math.min(nOpp, cfg.maxPaidRank - 1);
  let sum = 0;
  for (let k = 0; k <= maxBetter; k++) {
    sum +=
      Math.exp(logBinomialPmf(nOpp, k, beatProb)) *
      payoutForLeaderboardRank(k + 1, cfg.payouts);
  }
  return sum;
}

function config(
  participants: number,
  payouts: { rankFrom: number; rankTo: number; prizeEach: number }[],
  opponentModel = { meanScore: 0, stdDevScore: 1 },
): NormalizedBattleRoyaleLeaderboardConfig {
  return normalizeBattleRoyaleLeaderboardConfig({
    participants,
    windowTournaments: 1,
    scoring: {
      entryPoints: 1,
      knockoutPoints: 1,
      firstPoints: 1,
      secondPoints: 1,
      thirdPoints: 1,
    },
    payouts,
    opponentModel: { kind: "normal", ...opponentModel },
  })!;
}

describe("battleRoyaleLeaderboard", () => {
  it("normalizes payout tiers and basic bounds", () => {
    const cfg = normalizeBattleRoyaleLeaderboardConfig({
      participants: 50.9,
      windowTournaments: 0,
      scoring: {
        entryPoints: 1,
        knockoutPoints: 4,
        firstPoints: 10,
        secondPoints: 6,
        thirdPoints: 3,
      },
      payouts: [
        { rankFrom: 5, rankTo: 3, prizeEach: 20 },
        { rankFrom: 1, rankTo: 1, prizeEach: 100 },
        { rankFrom: 40, rankTo: 90, prizeEach: 5 },
      ],
      opponentModel: { kind: "normal", meanScore: 30, stdDevScore: 9 },
    });

    expect(cfg).not.toBeNull();
    expect(cfg!.participants).toBe(50);
    expect(cfg!.windowTournaments).toBe(1);
    expect(cfg!.payouts).toEqual([
      { rankFrom: 1, rankTo: 1, prizeEach: 100 },
      { rankFrom: 3, rankTo: 5, prizeEach: 20 },
      { rankFrom: 40, rankTo: 50, prizeEach: 5 },
    ]);
    expect(cfg!.maxPaidRank).toBe(50);
  });

  it("drops a payout tier that starts beyond the field instead of paying it to last place", () => {
    const cfg = config(100, [
      { rankFrom: 1, rankTo: 1, prizeEach: 10 },
      { rankFrom: 90, rankTo: 120, prizeEach: 3 },
      { rankFrom: 150, rankTo: 200, prizeEach: 5 },
    ]);
    expect(cfg.payouts).toEqual([
      { rankFrom: 1, rankTo: 1, prizeEach: 10 },
      { rankFrom: 90, rankTo: 100, prizeEach: 3 },
    ]);
    expect(cfg.maxPaidRank).toBe(100);
    expect(payoutForLeaderboardRank(100, cfg.payouts)).toBe(3);
    expect(
      normalizeBattleRoyaleLeaderboardConfig({
        participants: 100,
        windowTournaments: 1,
        scoring: { entryPoints: 1, knockoutPoints: 1, firstPoints: 1, secondPoints: 1, thirdPoints: 1 },
        payouts: [{ rankFrom: 150, rankTo: 200, prizeEach: 5 }],
        opponentModel: { kind: "normal", meanScore: 0, stdDevScore: 1 },
      }),
    ).toBeNull();
  });

  it("computes points from place + knockout mix", () => {
    const scoring = {
      entryPoints: 1,
      knockoutPoints: 5,
      firstPoints: 12,
      secondPoints: 7,
      thirdPoints: 3,
    };
    expect(battleRoyaleLeaderboardPoints(scoring, 1, 4)).toBe(33);
    expect(battleRoyaleLeaderboardPoints(scoring, 2, 1)).toBe(13);
    expect(battleRoyaleLeaderboardPoints(scoring, 9, 0)).toBe(1);
  });

  it("maps ranks to prize bands", () => {
    const payouts = [
      { rankFrom: 1, rankTo: 1, prizeEach: 100 },
      { rankFrom: 2, rankTo: 3, prizeEach: 40 },
      { rankFrom: 4, rankTo: 10, prizeEach: 10 },
    ];
    expect(payoutForLeaderboardRank(1, payouts)).toBe(100);
    expect(payoutForLeaderboardRank(3, payouts)).toBe(40);
    expect(payoutForLeaderboardRank(9, payouts)).toBe(10);
    expect(payoutForLeaderboardRank(11, payouts)).toBe(0);
  });

  it("turns a crushing score into a top-rank payout", () => {
    const cfg = normalizeBattleRoyaleLeaderboardConfig({
      participants: 100,
      windowTournaments: 25,
      scoring: {
        entryPoints: 0,
        knockoutPoints: 4,
        firstPoints: 10,
        secondPoints: 5,
        thirdPoints: 2,
      },
      payouts: [{ rankFrom: 1, rankTo: 3, prizeEach: 50 }],
      opponentModel: { kind: "normal", meanScore: 30, stdDevScore: 4 },
    })!;
    const rng = () => 0.5;
    const settled = sampleBattleRoyaleLeaderboardWindow(200, cfg, rng);
    expect(settled.rank).toBe(1);
    expect(settled.payout).toBe(50);
    expect(settled.beatProb).toBe(0);
  });

  describe("expected payout for a large field", () => {
    it("does not underflow when q^nOpp is not representable", () => {
      const cfg = config(5000, [{ rankFrom: 1, rankTo: 1000, prizeEach: 10 }]);
      // 0.85^4999 and 0.8^4999 are both below the smallest double.
      expect(Math.pow(0.85, 4999)).toBe(0);
      expect(Math.pow(0.8, 4999)).toBe(0);

      const wellInside = expectedLeaderboardPayoutFromBeatProb(0.15, cfg);
      expect(wellInside).toBeCloseTo(10, 9);

      const nearBoundary = expectedLeaderboardPayoutFromBeatProb(0.2, cfg);
      const reference = bruteForceExpectedPayout(0.2, cfg);
      expect(reference).toBeGreaterThan(4);
      expect(reference).toBeLessThan(6);
      expect(nearBoundary / reference).toBeCloseTo(1, 9);
    });

    it("matches the brute-force sum where the recursion never underflowed", () => {
      const cfg = config(1000, [
        { rankFrom: 1, rankTo: 5, prizeEach: 100 },
        { rankFrom: 6, rankTo: 100, prizeEach: 10 },
      ]);
      for (const beatProb of [0.001, 0.03, 0.08, 0.5]) {
        const got = expectedLeaderboardPayoutFromBeatProb(beatProb, cfg);
        const want = bruteForceExpectedPayout(beatProb, cfg);
        expect(Math.abs(got - want)).toBeLessThanOrEqual(1e-9 * Math.max(1, want));
      }
    });

    it("keeps the edges: a sure win and a sure loss", () => {
      const cfg = config(5000, [{ rankFrom: 1, rankTo: 1000, prizeEach: 10 }]);
      expect(expectedLeaderboardPayoutFromBeatProb(0, cfg)).toBe(10);
      expect(expectedLeaderboardPayoutFromBeatProb(1, cfg)).toBe(0);
      expect(expectedLeaderboardPayoutFromBeatProb(0.5, cfg)).toBe(0);
    });
  });

  describe("better-opponent draw", () => {
    function ksDistance(n: number, p: number, draws: number, seed: number): number {
      const rng = mulberry32(seed);
      const counts = new Float64Array(n + 1);
      for (let i = 0; i < draws; i++) counts[sampleBinomial(n, p, rng)]++;
      let empirical = 0;
      let exact = 0;
      let worst = 0;
      for (let k = 0; k <= n; k++) {
        empirical += counts[k] / draws;
        exact += Math.exp(logBinomialPmf(n, k, p));
        worst = Math.max(worst, Math.abs(empirical - exact));
      }
      return worst;
    }

    it("follows the exact binomial where Poisson and normal shortcuts used to be", () => {
      // (60, .29) and (100, .15) sat in the Poisson branch (variance n p, not n p q);
      // (100, .9) in the mirrored one; (1000, .02) in the rounded-normal branch.
      for (const [n, p] of [
        [60, 0.29],
        [100, 0.15],
        [100, 0.9],
        [1000, 0.02],
        [2000, 0.3],
        [3000, 0.5],
        [300, 0.999],
        [40, 0.37],
      ] as const) {
        expect(ksDistance(n, p, 60_000, 0x5eed + n)).toBeLessThan(0.0105);
      }
    });

    it("handles the degenerate probabilities", () => {
      const rng = mulberry32(1);
      expect(sampleBinomial(500, 0, rng)).toBe(0);
      expect(sampleBinomial(500, 1, rng)).toBe(500);
      expect(sampleBinomial(0, 0.5, rng)).toBe(0);
      for (let i = 0; i < 2000; i++) {
        const draw = sampleBinomial(500, 1e-9, rng);
        expect(draw).toBeGreaterThanOrEqual(0);
        expect(draw).toBeLessThanOrEqual(500);
      }
    });

    it("pays out on average what expectedPayout says it does", () => {
      const cfg = config(100, [{ rankFrom: 1, rankTo: 20, prizeEach: 10 }]);
      const rng = mulberry32(0xbeef);
      const draws = 60_000;
      let total = 0;
      let expected = 0;
      for (let i = 0; i < draws; i++) {
        const settled = sampleBattleRoyaleLeaderboardWindow(1.0364, cfg, rng);
        total += settled.payout;
        expected = settled.expectedPayout;
      }
      // One payout is 10 with probability about .9: sd about 3, so 5 SE is .06.
      expect(Math.abs(total / draws - expected)).toBeLessThan(0.07);
      expect(expected).toBeGreaterThan(8.5);
    });
  });
});
