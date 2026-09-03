/**
 * Mulberry32 — small, fast, decent-quality PRNG.
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
