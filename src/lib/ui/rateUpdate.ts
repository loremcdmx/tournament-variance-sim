/**
 * Pure rate-cache update for the run-time estimator.
 *
 * `useSimulation` records `ms-per-work-unit` after every successful run so
 * the next run's bar can show a pre-launch ETA. Naive update logic
 * (`next = 0.4 · prev + 0.6 · current`) is fine in steady state but a
 * single outlier — backgrounded tab throttled to 1 % CPU, OS swap, paused
 * worker — could land a 10× rate spike that pollutes the cache and makes
 * the *next* good run forecast 10× too long.
 *
 * The fix here is conservative: cap the per-update change to a factor `f`
 * (default 2.5×). Any update that would move the cached rate by more than
 * `f` is skipped entirely, on the assumption that one wild observation
 * shouldn't be allowed to overpower a rate built from prior runs. The
 * cache catches up to a sustained shift over a few runs.
 *
 * Pure; React-agnostic.
 */

/** Default cap on per-update rate change. */
export const RATE_OUTLIER_FACTOR = 2.5;

/** EMA weight on the current observation. Older runs decay at `1 − weight`. */
export const RATE_EMA_WEIGHT = 0.6;

export interface RateUpdateInput {
  /** Wall-clock duration of the just-finished run in ms. Must be > 0. */
  elapsedMs: number;
  /** Workload of the run (samples × scheduleRepeats × rowCount). Must be > 0. */
  work: number;
  /** Previously cached `ms-per-work-unit`, or `null` for first-ever run. */
  prevRate: number | null;
  /** Outlier cap factor; an observation that would move the rate by more
   *  than this multiplicative factor is rejected. */
  outlierFactor?: number;
  /** EMA weight on the new observation when blending into the cache. */
  emaWeight?: number;
}

export interface RateUpdateOutcome {
  /** New rate to persist, or null if the observation should be dropped. */
  nextRate: number | null;
  /** Why the observation was dropped (when nextRate === null and prevRate !== null). */
  reason?: "outlier-high" | "outlier-low" | "invalid";
}

export function computeNextRate(input: RateUpdateInput): RateUpdateOutcome {
  const {
    elapsedMs,
    work,
    prevRate,
    outlierFactor = RATE_OUTLIER_FACTOR,
    emaWeight = RATE_EMA_WEIGHT,
  } = input;

  if (
    !Number.isFinite(elapsedMs) ||
    !Number.isFinite(work) ||
    elapsedMs <= 0 ||
    work <= 0
  ) {
    return { nextRate: null, reason: "invalid" };
  }
  const observed = elapsedMs / work;
  if (!Number.isFinite(observed) || observed <= 0) {
    return { nextRate: null, reason: "invalid" };
  }

  if (prevRate == null || prevRate <= 0) {
    return { nextRate: observed };
  }

  const ratio = observed / prevRate;
  if (ratio > outlierFactor) {
    return { nextRate: null, reason: "outlier-high" };
  }
  if (ratio < 1 / outlierFactor) {
    return { nextRate: null, reason: "outlier-low" };
  }

  const blended = emaWeight * observed + (1 - emaWeight) * prevRate;
  return { nextRate: blended };
}
