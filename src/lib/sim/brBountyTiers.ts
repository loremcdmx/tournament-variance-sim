/**
 * GGPoker Mystery Battle Royale — 10-tier discrete envelope distribution.
 *
 * Scraped from ggpoker.com/poker-games/mystery-battle-royale (2026-04).
 * Each of the 5 published buy-in tiers ($0.25 / $1 / $3 / $10 / $25)
 * lists 10 envelope values plus per-100M frequencies. Frequencies sum
 * to exactly 1e8 per profile.
 *
 * Engine consumption: the hot loop draws a tier index from the Vose
 * alias table, then multiplies `perKO` (the pool-accounting per-KO
 * mean) by `ratios[pick]`. `ratios` are normalised to E[ratio] = 1
 * under the profile's own frequency distribution, so pool-based EV
 * is preserved — only the shape of the variance changes.
 *
 * Why per-buy-in profiles: micro-stakes ($0.25) tilt the top-tier
 * jackpot up to 20000× buy-in vs 10000× at higher stakes. The mid
 * tiers ($1/$3/$10) carry identical ratios; $25 rounds the small tiers
 * by a few percent. Snap-to-nearest on log scale covers the 5 tiers
 * and falls back to the $1 profile outside GG's published range.
 */

interface RawProfile {
  buyIn: number;
  values: number[];
  freqs: number[]; // per 100M envelopes, sums to 1e8
}

const RAW_PROFILES: RawProfile[] = [
  {
    buyIn: 0.25,
    values: [5000, 250, 25, 2.5, 0.5, 0.37, 0.25, 0.18, 0.13, 0.06],
    freqs: [
      30, 400, 4000, 3_500_000, 3_600_000, 3_800_000, 4_000_000, 23_000_000,
      35_046_650, 27_048_920,
    ],
  },
  {
    buyIn: 1,
    values: [10000, 1000, 100, 10, 2, 1.5, 1, 0.75, 0.5, 0.25],
    freqs: [
      60, 400, 4000, 3_500_000, 3_600_000, 3_800_000, 4_000_000, 23_000_000,
      33_704_460, 28_391_080,
    ],
  },
  {
    buyIn: 3,
    values: [30000, 3000, 300, 30, 6, 4.5, 3, 2.25, 1.5, 0.75],
    freqs: [
      80, 400, 4000, 3_500_000, 3_600_000, 3_800_000, 4_000_000, 23_000_000,
      32_904_480, 29_191_040,
    ],
  },
  {
    buyIn: 10,
    values: [100000, 10000, 1000, 100, 20, 15, 10, 7.5, 5, 2.5],
    freqs: [
      100, 400, 4000, 3_500_000, 3_600_000, 3_800_000, 4_000_000, 23_000_000,
      32_104_500, 29_991_000,
    ],
  },
  {
    buyIn: 25,
    values: [250000, 25000, 2500, 250, 50, 37, 25, 18, 13, 6],
    freqs: [
      100, 400, 4000, 3_500_000, 3_600_000, 3_800_000, 4_000_000, 23_000_000,
      33_618_140, 28_477_360,
    ],
  },
];

export interface BrTierSampler {
  /** Published mean envelope value for the snapped GG profile. In Battle
   *  Royale this stays fixed when the bounty budget changes; only the
   *  expected number of envelope drops should move. */
  meanValue: number;
  /** Per-tier multipliers normalised so Σ probs[i] × ratios[i] = 1. Multiply
   *  `perKO` by `ratios[pick]` to realise a single envelope draw. */
  ratios: Float64Array;
  /** Discrete probability of each tier. Length 10, sums to 1. */
  probs: Float64Array;
  /** Vose alias probability table — O(1) tier draw via one uniform. */
  aliasProb: Float64Array;
  /** Vose alias index table, parallel to `aliasProb`. */
  aliasIdx: Int32Array;
}

/**
 * Snap a buy-in to the nearest published GG profile. Boundaries sit at
 * the geometric midpoints between tiers (√(a·b)) so log-scale errors are
 * symmetric. Outside the published range ($0.25..$25) we extrapolate with
 * the edge profile — shape stays sane even if the caller uses a custom
 * buy-in that GG doesn't publish.
 */
function pickProfile(buyIn: number): RawProfile {
  if (buyIn < 0.5) return RAW_PROFILES[0]; // <$0.50 → $0.25 profile
  if (buyIn < Math.sqrt(1 * 3)) return RAW_PROFILES[1]; // <$1.73 → $1
  if (buyIn < Math.sqrt(3 * 10)) return RAW_PROFILES[2]; // <$5.48 → $3
  if (buyIn < Math.sqrt(10 * 25)) return RAW_PROFILES[3]; // <$15.81 → $10
  return RAW_PROFILES[4]; // $25 and above
}

/**
 * Vose alias method — O(n) build, O(1) sample. Standard textbook
 * implementation; stable, no dependency on input order.
 */
function buildVoseAlias(probs: Float64Array): {
  aliasProb: Float64Array;
  aliasIdx: Int32Array;
} {
  const n = probs.length;
  const aliasProb = new Float64Array(n);
  const aliasIdx = new Int32Array(n);
  const scaled = new Float64Array(n);
  for (let i = 0; i < n; i++) scaled[i] = probs[i] * n;
  const small: number[] = [];
  const large: number[] = [];
  for (let i = 0; i < n; i++) {
    if (scaled[i] < 1) small.push(i);
    else large.push(i);
  }
  while (small.length > 0 && large.length > 0) {
    const s = small.pop()!;
    const l = large.pop()!;
    aliasProb[s] = scaled[s];
    aliasIdx[s] = l;
    scaled[l] = scaled[l] + scaled[s] - 1;
    if (scaled[l] < 1) small.push(l);
    else large.push(l);
  }
  while (large.length > 0) {
    const l = large.pop()!;
    aliasProb[l] = 1;
    aliasIdx[l] = l;
  }
  while (small.length > 0) {
    const s = small.pop()!;
    aliasProb[s] = 1;
    aliasIdx[s] = s;
  }
  return { aliasProb, aliasIdx };
}

export function makeBrTierSampler(buyIn: number): BrTierSampler {
  const prof = pickProfile(buyIn);
  const n = prof.values.length;
  const probs = new Float64Array(n);
  let freqSum = 0;
  for (let i = 0; i < n; i++) freqSum += prof.freqs[i];
  for (let i = 0; i < n; i++) probs[i] = prof.freqs[i] / freqSum;

  let rawMean = 0;
  for (let i = 0; i < n; i++) rawMean += probs[i] * prof.values[i];

  const ratios = new Float64Array(n);
  for (let i = 0; i < n; i++) ratios[i] = prof.values[i] / rawMean;

  const { aliasProb, aliasIdx } = buildVoseAlias(probs);
  return { meanValue: rawMean, ratios, probs, aliasProb, aliasIdx };
}
