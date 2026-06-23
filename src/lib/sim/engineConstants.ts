/**
 * Engine numeric constants shared by the compile stage (PKO heat-bank build)
 * and the hot loop (bin selection + jackpot flagging). Dependency-free leaf.
 */

// ---- Variant D: PKO latent heat ----------------------------------------
// When `row.pkoHeat > 0`, compileSingleEntry precomputes HEAT_BIN_COUNT
// alternative `bountyByPlace` banks: each bin raises the raw PKO weight
// curve to an exponent `1 + pkoHeat · z_b` (z_b evenly spaced in
// [-HEAT_Z_RANGE, +HEAT_Z_RANGE]) and re-normalizes against the base pmf
// back to the same mean bounty. The hot loop draws one Gaussian per
// tournament, snaps it to the nearest bin, and uses that bin's bbp. Mean
// bounty is preserved exactly per bin (normalization); hot bins
// concentrate bounty mass on the deepest finishes so the right tail
// fattens while σ only drifts marginally. Finish-place pmf is unchanged
// across bins, so prize EV stays on the α-calibrated target.
export const HEAT_BIN_COUNT = 33;
export const HEAT_Z_RANGE = 3;
// Precomputed scalar for z → bin index: (HEAT_BIN_COUNT - 1) / (2 · RANGE).
export const HEAT_BIN_SCALE = (HEAT_BIN_COUNT - 1) / (2 * HEAT_Z_RANGE);

// Threshold (in units of per-KO mean) used to tag a sample as having
// hit a "jackpot" in `jackpotMask`. We flag at the tournament level:
// if the sum of per-KO ratios in a single bounty-bearing tournament
// crosses this threshold, the sample is marked. Matches the scale of
// FinishPMFPreview's `jackpotShareFrac` so the preview stats and the
// UI toggle share a definition — but the per-tournament aggregation
// also catches compound jackpots (many moderate-ratio KOs in one
// tournament summing past the threshold) that a per-KO cutoff misses.
export const JACKPOT_THRESHOLD = 100;
