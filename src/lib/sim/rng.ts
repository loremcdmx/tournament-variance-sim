/**
 * Mulberry32 — a small seeded source for tests and scripts. The engine does
 * not draw from it: its 32-bit counter walks one cycle of 2^32 outputs that
 * holds only 44% of the possible values, with small ones too frequent
 * (P(u < 2^-12) is 0.39% above nominal over the whole cycle). Mapped onto
 * finishing places that drew first place about 0.3% too often, in every run
 * and at every seed, and all streams were windows of that single cycle.
 * Returns a function yielding floats in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Hash-combine two 32-bit ints so sample seeds stay decorrelated.
 *
 * The seed is finalized on its own BEFORE it meets the sample index. If the
 * two were XOR-ed raw, seeds differing only in low bits would produce the
 * same multiset of per-sample seeds over any aligned block of indices — seed
 * 1 and seed 2 would be the same simulation with samples permuted, giving
 * identical mean/stdDev. Finalizing first makes a one-bit seed change
 * avalanche across the whole per-sample seed.
 */
export function mixSeed(seed: number, sampleIndex: number): number {
  const h = fmix32((Math.imul(seed, 0x9e3779b9) + 0x7f4a7c15) >>> 0);
  return fmix32((h ^ (Math.imul(sampleIndex, 0x85ebca6b) + 0xc2b2ae35)) >>> 0);
}

/**
 * xoshiro128** (Blackman and Vigna): 128 bits of state, period 2^128 - 1,
 * every 32-bit output equally frequent over the period. Returns raw 32-bit
 * draws; the state must not be all zero.
 */
export function xoshiro128ss(
  s0: number,
  s1: number,
  s2: number,
  s3: number,
): () => number {
  return function () {
    const r = Math.imul(s1, 5);
    const out = Math.imul((r << 7) | (r >>> 25), 9) >>> 0;
    const t = s1 << 9;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = (s3 << 11) | (s3 >>> 21);
    return out;
  };
}

/** One stochastic channel of the engine. A new channel takes the next id. */
export const STREAM_FINISH = 0;
export const STREAM_SKILL = 1;
export const STREAM_BOUNTY = 2;
export const STREAM_OCEAN = 3;
export const STREAM_LEADERBOARD = 4;
export const STREAM_CASH = 5;

const STREAM_WORD_SALTS = [0x9e3779b9, 0x7f4a7c15, 0x94d049bb, 0xbf58476d];

function streamWord(
  seed: number,
  sampleIndex: number,
  channel: number,
  salt: number,
): number {
  let h = fmix32((seed ^ salt) >>> 0);
  h = fmix32(((h ^ Math.imul(sampleIndex, 0x85ebca6b)) + 0xc2b2ae35) >>> 0);
  return fmix32((h ^ Math.imul(channel + 1, 0x27d4eb2f)) >>> 0);
}

/**
 * The random stream of one sample on one channel, floats in [0, 1) with 32
 * bits of resolution. Each of the four state words is its own hash of the
 * seed, the GLOBAL sample index and the channel, so streams of different
 * samples, seeds and channels are unrelated points on a 2^128 cycle instead
 * of overlapping windows of a 2^32 one, and for a given seed and channel no
 * two samples share a state word.
 */
export function sampleStream(
  seed: number,
  sampleIndex: number,
  channel: number,
): () => number {
  const s0 = streamWord(seed, sampleIndex, channel, STREAM_WORD_SALTS[0]);
  const s1 = streamWord(seed, sampleIndex, channel, STREAM_WORD_SALTS[1]);
  const s2 = streamWord(seed, sampleIndex, channel, STREAM_WORD_SALTS[2]);
  const s3 = streamWord(seed, sampleIndex, channel, STREAM_WORD_SALTS[3]);
  // All four words zero is the one state the generator cannot leave.
  const next = xoshiro128ss(s0, s1, s2, (s0 | s1 | s2 | s3) === 0 ? 1 : s3);
  return function () {
    return next() / 4294967296;
  };
}
