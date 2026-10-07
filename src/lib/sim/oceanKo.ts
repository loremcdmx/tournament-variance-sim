/**
 * GGPoker Ocean KO, official tables checked 2026-10-07:
 * https://br-1.ggpoker.com/tournaments/ocean-ko/
 * https://ssl.gg-global-cdn.com/bd/front/img/web/ocean_ko_probabilities_lavel.webp
 * https://ssl.gg-global-cdn.com/bd/front/img/web/ocean_ko_level_bounty_value.webp
 *
 * The knockout tree is a uniform-killer model, not a poker strategy model.
 * Rank j chooses its killer uniformly from ranks 1..j-1. Every knockout rolls
 * against the victim's ACTUAL head; half is paid and half added to the killer.
 * Thus cash before elimination equals current head minus starting head. The
 * champion additionally rolls their updated head and receives 100% of it.
 *
 * Sampling only the hero's descendant subtree is exact for this tree model.
 * Its size is 1+BetaBinomial(N-p,1,p-1), with mean N/p. Conditional on size,
 * it is itself a uniform recursive tree. This avoids simulating the full field
 * for every early finish, while retaining inherited jackpots and tier changes.
 *
 * Mean payouts are exact. Second moments are rigorous bounds, NOT estimates:
 * the adaptive odds require a head distribution, which first/second moments
 * cannot identify. Analytic envelopes below include the rare x400 outcomes;
 * an ordinary short Monte Carlo must not be used to claim they are negligible.
 * The existing finish/ROI calibration applies one fixed payoutScale to the
 * final haul; this is an edge-model assumption, not per-tournament conservation.
 */

export interface OceanKoOdds {
  multipliers: readonly number[];
  probabilities: readonly number[];
  secondMoment: number;
}

export const OCEAN_KO_ODDS: readonly OceanKoOdds[] = [
  {
    multipliers: [400, 100, 10, 2, 1.5, 1, 0.7, 0.5, 0.4],
    probabilities: [0.00002, 0.0008, 0.024, 0.025, 0.027, 0.2, 0.22, 0.26228, 0.2409],
    secondMoment: 14.172664,
  },
  {
    multipliers: [50, 10, 2, 1.5, 1, 0.5],
    probabilities: [0.001, 0.01, 0.03, 0.12, 0.381, 0.458],
    secondMoment: 4.3855,
  },
  {
    multipliers: [10, 2.5, 1.5, 1, 0.6],
    probabilities: [0.005, 0.04, 0.2, 0.2425, 0.5125],
    secondMoment: 1.627,
  },
  {
    multipliers: [2.5, 1.5, 1, 0.65],
    probabilities: [0.05, 0.2, 0.25, 0.5],
    secondMoment: 1.22375,
  },
  {
    multipliers: [1.5, 1, 0.8],
    probabilities: [0.2, 0.3, 0.5],
    secondMoment: 1.07,
  },
];

/** Levels 1..10 share one odds table. Legendary requires BOTH >50 full
 * tickets and its dollar threshold. At the exact 50-ticket boundary we keep
 * the ordinary table, following the official article's "exceeds" wording.
 * The support FAQ disagrees with the detailed odds image on some maxima;
 * the detailed published probability table above is the model's source. */
export function oceanKoOddsBand(head: number, fullTicket: number): number {
  if (head <= 50 * fullTicket || head < 10_000) return 0;
  if (head < 50_000) return 1;
  if (head < 250_000) return 2;
  if (head < 1_000_000) return 3;
  return 4;
}

export function sampleOceanKoMultiplier(
  head: number,
  fullTicket: number,
  rng: () => number,
): number {
  const odds = OCEAN_KO_ODDS[oceanKoOddsBand(head, fullTicket)];
  const u = rng();
  let cumulative = 0;
  for (let i = 0; i < odds.multipliers.length - 1; i++) {
    cumulative += odds.probabilities[i];
    if (u < cumulative) return odds.multipliers[i];
  }
  return odds.multipliers[odds.multipliers.length - 1];
}

export interface OceanKoModel {
  fieldSize: number;
  initialBounty: number;
  fullTicket: number;
  payoutScale: number;
  bountyMeanByPlace: Float64Array;
  bountySecondLowerByPlace: Float64Array;
  bountySecondUpperByPlace: Float64Array;
}

export interface OceanKoScratch {
  heads: Float64Array;
  /** A x100/x400 spin in the hero's bounty ancestry, including final spin. */
  jackpot: boolean;
}

/** Only called once per shard (or by tests), never inside tournament loops. */
export function createOceanKoScratch(maxFieldSize: number): OceanKoScratch {
  return { heads: new Float64Array(maxFieldSize), jackpot: false };
}

export function sampleOceanKoBounty(
  model: OceanKoModel,
  placeIndex: number,
  rng: () => number,
  scratch: OceanKoScratch,
): number {
  const { fieldSize: n, initialBounty: b, fullTicket, payoutScale } = model;
  scratch.jackpot = false;
  if (!(b > 0) || !(payoutScale > 0)) return 0;
  const p = placeIndex + 1;
  let size = 1;
  if (p === 1) {
    size = n;
  } else if (p < n) {
    // P(K >= k+1) / P(K >= k) = (N-p-k+1)/(N-k).
    // O(K) inversion is no more expensive than the required O(K) tree.
    const u = rng();
    let survival = 1;
    while (size <= n - p) {
      survival *= (n - p - size + 1) / (n - size);
      if (u >= survival) break;
      size++;
    }
  }
  const heads = scratch.heads;
  heads.fill(b, 0, size);
  for (let j = size - 1; j > 0; j--) {
    const parent = Math.floor(rng() * j);
    const multiplier = sampleOceanKoMultiplier(heads[j], fullTicket, rng);
    if (multiplier >= 100) scratch.jackpot = true;
    heads[parent] += 0.5 * multiplier * heads[j];
  }
  let cash = heads[0] - b;
  if (p === 1) {
    const multiplier = sampleOceanKoMultiplier(heads[0], fullTicket, rng);
    if (multiplier >= 100) scratch.jackpot = true;
    cash += multiplier * heads[0];
  }
  return cash * payoutScale;
}

/** Upper envelope for E[s(H) H²], where a=E[H], q>=E[H²]. For each slope
 * sj, both sj H²+Cj and sj H²+Dj H majorize s(H)H² pointwise. Their minimum
 * expectations remains a valid upper bound. Never evaluate s at mean head. */
function spinSecondUpper(
  a: number,
  q: number,
  maxHead: number,
  initialHead: number,
  fullTicket: number,
): number {
  const ordinaryEnd = 50 * fullTicket;
  let upper = Infinity;
  for (let j = 0; j < OCEAN_KO_ODDS.length; j++) {
    const slope = OCEAN_KO_ODDS[j].secondMoment;
    let constant = 0;
    let linear = 0;
    for (let i = 0; i < j; i++) {
      const dollars = i === 0 ? 10_000 : i === 1 ? 50_000 : i === 2 ? 250_000 : 1_000_000;
      const endpoint = Math.min(maxHead, Math.max(ordinaryEnd, dollars));
      if (endpoint < initialHead) continue;
      const excess = OCEAN_KO_ODDS[i].secondMoment - slope;
      constant = Math.max(constant, excess * endpoint * endpoint);
      linear = Math.max(linear, excess * endpoint);
    }
    upper = Math.min(upper, slope * q + constant, slope * q + linear * a);
  }
  return upper;
}

/** A deterministic support bound on total head mass after one elimination.
 * Keeping all survivor heads >= initialBounty tightens early-stage bounds and
 * makes the analytic twin exact whenever Legendary is provably unreachable. */
function maxAddedHeadMass(maxHead: number, initialHead: number, fullTicket: number): number {
  let added = 0;
  for (let i = 0; i < 4; i++) {
    const dollars = i === 0 ? 10_000 : i === 1 ? 50_000 : i === 2 ? 250_000 : 1_000_000;
    const endpoint = Math.min(maxHead, Math.max(50 * fullTicket, dollars));
    if (endpoint < initialHead) continue;
    added = Math.max(added, (OCEAN_KO_ODDS[i].multipliers[0] / 2 - 1) * endpoint);
  }
  return added;
}

export function buildOceanKoModel(
  fieldSize: number,
  initialBounty: number,
  fullTicket: number,
  pmf?: Float64Array,
  targetBountyMean?: number,
): OceanKoModel {
  const n = fieldSize;
  const b = initialBounty;
  const means = new Float64Array(n);
  const lower = new Float64Array(n);
  const upper = new Float64Array(n);
  let a = b;
  let qLower = b * b;
  let qUpper = b * b;
  let pair = b * b;
  let totalHeadUpper = n * b;
  for (let alive = n; alive >= 1; alive--) {
    const maxHead = Math.max(b, totalHeadUpper - (alive - 1) * b);
    const sMin = OCEAN_KO_ODDS[oceanKoOddsBand(maxHead, fullTicket)].secondMoment;
    const spunLower = sMin * qLower;
    const spunUpper = Math.max(spunLower, spinSecondUpper(a, qUpper, maxHead, b, fullTicket));
    const i = alive - 1;
    if (alive === 1) {
      means[i] = 2 * a - b;
      lower[i] = Math.max(means[i] * means[i], 3 * qLower + spunLower - 4 * b * a + b * b);
      upper[i] = Math.max(lower[i], 3 * qUpper + spunUpper - 4 * b * a + b * b);
    } else {
      means[i] = a - b;
      lower[i] = Math.max(means[i] * means[i], qLower - 2 * b * a + b * b);
      upper[i] = Math.max(lower[i], qUpper - 2 * b * a + b * b);
      // Exchangeable survivor heads: a=E[H], q=E[H²], pair=E[Hi Hj].
      // E[M|H]=1 makes a and pair exact even at adaptive Legendary tiers.
      const remaining = alive - 1;
      a *= 1 + 1 / (2 * remaining);
      qLower += (pair + spunLower / 4) / remaining;
      qUpper += (pair + spunUpper / 4) / remaining;
      pair *= alive / remaining;
      totalHeadUpper += maxAddedHeadMass(maxHead, b, fullTicket);
    }
  }
  let payoutScale = 1;
  if (pmf && targetBountyMean != null) {
    let mean = 0;
    for (let i = 0; i < n; i++) mean += pmf[i] * means[i];
    if (targetBountyMean > 0 && !(mean > 0)) {
      throw new Error("Ocean KO: the finish model has no bounty-paying outcomes for the requested ROI");
    }
    payoutScale = mean > 0 ? targetBountyMean / mean : 0;
    for (let i = 0; i < n; i++) {
      means[i] *= payoutScale;
      lower[i] *= payoutScale * payoutScale;
      upper[i] *= payoutScale * payoutScale;
    }
  }
  return {
    fieldSize: n,
    initialBounty: b,
    fullTicket,
    payoutScale,
    bountyMeanByPlace: means,
    bountySecondLowerByPlace: lower,
    bountySecondUpperByPlace: upper,
  };
}
