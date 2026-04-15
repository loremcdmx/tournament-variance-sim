export interface PayoutSamplePlace {
  from: number;
  to: number;
  prize: number;
}

export interface PayoutSampleBounty {
  type: "progressive" | "regular";
  pctOfBuyIn: number;
  note?: string;
}

export interface PayoutSample {
  id: string;
  source: string;
  tournament: string;
  gameType: string;
  format: "regular" | "bounty" | "satellite" | "sng";
  currency: string;
  buyIn: number;
  entries: number;
  uniqueEntries?: number;
  reEntries?: number;
  prizePool: number;
  paid: number;
  capturedAt: string;
  partial?: boolean;
  partialNote?: string;
  places: PayoutSamplePlace[];
  bounty?: PayoutSampleBounty;
}

export interface PayoutSampleStats {
  paid: number;
  paidPct: number;
  firstShare: number;
  secondShare: number;
  thirdShare: number;
  ftRatio: number;
  top3Share: number;
  top9Share: number;
  minCashBuyIns: number;
  poolSumError: number;
  coverage: number;
}

export function validateSample(s: PayoutSample): void {
  if (!Array.isArray(s.places) || s.places.length === 0) {
    throw new Error(`sample ${s.id}: empty places`);
  }
  let expected = 1;
  const maxRank = s.partial
    ? s.places[s.places.length - 1].to
    : s.paid;
  for (const p of s.places) {
    if (p.from !== expected) {
      throw new Error(
        `sample ${s.id}: gap or overlap at place ${expected} (got from=${p.from})`,
      );
    }
    if (p.to < p.from) {
      throw new Error(`sample ${s.id}: inverted range ${p.from}..${p.to}`);
    }
    if (p.prize < 0 || !Number.isFinite(p.prize)) {
      throw new Error(`sample ${s.id}: bad prize at ${p.from}..${p.to}`);
    }
    expected = p.to + 1;
  }
  if (expected - 1 !== maxRank) {
    throw new Error(
      `sample ${s.id}: places end at ${expected - 1}, expected ${maxRank}`,
    );
  }
}

/**
 * Expand range-compressed places to a per-place array of prize fractions
 * (of the regular-side prize pool). For partial samples, only the covered
 * prefix is returned.
 */
export function expandFractions(s: PayoutSample): number[] {
  const out: number[] = [];
  for (const p of s.places) {
    for (let r = p.from; r <= p.to; r++) {
      out.push(p.prize / s.prizePool);
    }
  }
  return out;
}

export function summarizeSample(s: PayoutSample): PayoutSampleStats {
  const fr = expandFractions(s);
  const paid = s.paid;
  const coverage = fr.length / paid;

  let poolSum = 0;
  for (const p of s.places) {
    poolSum += p.prize * (p.to - p.from + 1);
  }
  const poolSumError = poolSum / s.prizePool - 1;

  const firstShare = fr[0] ?? 0;
  const secondShare = fr[1] ?? 0;
  const thirdShare = fr[2] ?? 0;
  const ftRatio = secondShare > 0 ? firstShare / secondShare : 0;

  const top3Share = (fr[0] ?? 0) + (fr[1] ?? 0) + (fr[2] ?? 0);
  let top9Share = 0;
  for (let i = 0; i < Math.min(9, fr.length); i++) top9Share += fr[i];

  const minPrize = s.places[s.places.length - 1].prize;
  const minCashBuyIns = minPrize / s.buyIn;

  return {
    paid,
    paidPct: paid / s.entries,
    firstShare,
    secondShare,
    thirdShare,
    ftRatio,
    top3Share,
    top9Share,
    minCashBuyIns,
    poolSumError,
    coverage,
  };
}
