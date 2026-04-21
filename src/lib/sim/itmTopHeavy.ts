export const MIN_ITM_TOP_HEAVY_BIAS = -1;
export const MAX_ITM_TOP_HEAVY_BIAS = 1;
export const ITM_TOP_HEAVY_BIAS_STEP = 0.05;

export function clampItmTopHeavyBias(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(MIN_ITM_TOP_HEAVY_BIAS, Math.min(MAX_ITM_TOP_HEAVY_BIAS, v));
}

export function applyItmTopHeavyToFreeBand(
  band: Float64Array,
  freeIndices: readonly number[],
  bias: number,
): { adjusted: Float64Array; freeSum: number } {
  const clamped = clampItmTopHeavyBias(bias);
  const adjusted = new Float64Array(band);

  if (freeIndices.length === 0) {
    return { adjusted, freeSum: 0 };
  }

  if (Math.abs(clamped) < 1e-9 || freeIndices.length === 1) {
    let freeSum = 0;
    for (const idx of freeIndices) freeSum += adjusted[idx];
    return { adjusted, freeSum };
  }

  // Positive bias pushes mass upward inside the free paid band; negative
  // bias flattens / bottom-heavies it. The transform is multiplicative and
  // order-only, so α can still close total EV by re-scaling the same band.
  const last = freeIndices.length - 1;
  const strength = -clamped * 2.2;
  let freeSum = 0;
  for (let order = 0; order < freeIndices.length; order++) {
    const idx = freeIndices[order];
    const t = last > 0 ? order / last : 0.5;
    const rank = 1 - 2 * t;
    adjusted[idx] *= Math.exp(strength * rank);
    freeSum += adjusted[idx];
  }

  return { adjusted, freeSum };
}
