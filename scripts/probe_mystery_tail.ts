/**
 * Diagnostic: compare log-normal bounty tail (plain Mystery path) against
 * the #92 empirical BR tier distribution and against the user's stated
 * concern — "top bucket ≥ 100×ABI with probability ~0.001".
 *
 * Plain Mystery currently uses log-normal σ² = 0.8 (gameType.ts default).
 * #92 replaced BR's log-normal σ² = 1.8 with scraped 10-tier data that
 * proves the envelope distribution is dramatically heavier-tailed than
 * any log-normal. This script prints P(X > k·mean) across {10, 25, 100,
 * 1000} for a range of σ² and for the BR tiers so we can pick a
 * defensible default for plain Mystery.
 */

import { makeBrTierSampler } from "../src/lib/sim/brBountyTiers";

// P(X > k) under log-normal with E[X] = 1 (mean-preserving form),
// where ln X ~ N(-σ²/2, σ²). Uses Φ(z) ≈ 0.5·erfc(z/√2).
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
function probGT(k: number, sigma2: number): number {
  // P(X > k) = P(ln X > ln k) = P(Z > (ln k + σ²/2)/σ) = 0.5·erfc(z/√2)
  const sigma = Math.sqrt(sigma2);
  const z = (Math.log(k) + sigma2 / 2) / sigma;
  return 0.5 * (1 - erf(z / Math.SQRT2));
}

function brTailProb(k: number, buyIn: number): number {
  const s = makeBrTierSampler(buyIn);
  let p = 0;
  for (let i = 0; i < s.ratios.length; i++) {
    if (s.ratios[i] >= k) p += s.probs[i];
  }
  return p;
}

const KS = [10, 25, 100, 1000, 10000];
const SIGMA2S = [0.8, 1.5, 2.0, 2.5, 3.0, 4.0, 6.0];

console.log("\nLog-normal P(X > k·mean) for mean-preserving X with σ²:");
console.log("  σ²    " + KS.map((k) => `P(>${k}x)`.padStart(9)).join(" "));
for (const s2 of SIGMA2S) {
  const row = KS.map((k) => {
    const p = probGT(k, s2);
    return p < 1e-20 ? "     <1e-20" : p.toExponential(2).padStart(9);
  }).join(" ");
  console.log(`  ${s2.toFixed(1).padStart(4)}  ${row}`);
}

console.log("\nBR empirical tier P(X ≥ k·mean) at $1 buy-in (scraped GG data, #92):");
const s = makeBrTierSampler(1);
console.log(
  "  ratios: " + Array.from(s.ratios).map((r) => r.toFixed(2)).join(", "),
);
console.log(
  "  probs:  " + Array.from(s.probs).map((p) => p.toExponential(1)).join(", "),
);
const row = KS.map((k) => brTailProb(k, 1).toExponential(2).padStart(9)).join(" ");
console.log("  P tail" + row);

console.log("\nUser intuition (#71): P(X ≥ 100×mean) ≈ 1e-3 on GG Mystery.");
console.log("  → closest log-normal match: see the P(>100x) column above.");
