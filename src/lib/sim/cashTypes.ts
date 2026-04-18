/**
 * Canonical types for the cash-game variance simulator.
 *
 * Intentionally decoupled from MTT `SimulationInput` / `SimulationResult`.
 * The two engines share RNG primitives (`mulberry32`, `mixSeed`) and chart
 * components, but speak different algebra: MTT lives in buy-in / place / payout,
 * cash lives in bb/100 / hands / bankroll random walk.
 *
 * Input primary units: `bb/100` and `hands`. The hot loop never sees $.
 * Money conversions happen at the boundary (`CashResult.$USD` fields) so the
 * display layer can swap `$ / BB / bb/100` without re-running the MC.
 */

/**
 * One stake / room row in a mix. All bb-denominated fields are native to the
 * row's own bbSize — the engine rescales to the reference bb (`CashInput.bbSize`)
 * when running the hot loop.
 */
export interface CashStakeRow {
  /** UI label only — not used by the engine. */
  label?: string;
  wrBb100: number;
  sdBb100: number;
  /** This row's big-blind in USD. */
  bbSize: number;
  /** Share of total hands, 0..1. Normalized across rows if the sum diverges. */
  handShare: number;
  rake: {
    enabled: boolean;
    contributedRakeBb100: number;
    advertisedRbPct: number;
    pvi: number;
  };
}

/** Inputs the user actually fills in. */
export interface CashInput {
  type: "cash";

  /**
   * Expected winrate in big blinds per 100 hands. Ignored when `stakes` has
   * length ≥ 1 (each row provides its own).
   */
  wrBb100: number;
  /**
   * Per-100-hand standard deviation of winrate in big blinds. Ignored in mix
   * mode.
   */
  sdBb100: number;
  /** Total hands to simulate per path. */
  hands: number;
  /** Number of MC paths. */
  nSimulations: number;

  /**
   * Reference big-blind size in USD. When `stakes` is set, this is the
   * denomination bankroll is reported in — rows with a different bbSize
   * scale their contribution by `row.bbSize / bbSize`.
   */
  bbSize: number;

  /**
   * Legacy single-stake rake block. Used when `stakes` is absent.
   * In mix mode each row carries its own rake block.
   */
  rake: {
    enabled: boolean;
    /** Rake the user contributes, bb/100. User reads this from tracker (PT4/HM2). */
    contributedRakeBb100: number;
    /** Advertised RB percent, 0..100. */
    advertisedRbPct: number;
    /** PVI coefficient ∈ (0, 1]. Default 1.0 = site pays full advertised RB. */
    pvi: number;
  };

  /** Optional time lens for `$/hour` derived output. */
  hoursBlock?: {
    handsPerHour: number;
  };

  /** PRNG base seed. */
  baseSeed: number;

  /**
 * Optional mix of stakes / rooms. When length ≥ 1, the engine runs
   * a deterministic interleaved schedule of fixed-size blocks. Each row owns
   * `round(share_r × hands)` hands of every path, but path-dependent metrics
   * (drawdown / recovery) no longer see a fake “all NL100 first, all NL200
   * later” regime split. Rates are rescaled to the reference bb (`bbSize`).
   * When absent or empty, behavior is byte-identical to the legacy
   * single-stake path.
   */
  stakes?: CashStakeRow[];
}

/**
 * Bankroll trajectory expressed in BB (not $). The display layer multiplies
 * by `bbSize` at render time so toggling `$ / BB` doesn't re-run the MC.
 */
export interface CashSamplePaths {
  /** x-axis in hands (not 100-hand blocks). */
  x: Int32Array;
  /** Up to first ~200 paths (memory cap), each `x.length` long. */
  paths: Float64Array[];
  /** Path indices in the [0, nSimulations) space. */
  sampleIndices: number[];
  /** Pointwise best / worst across all paths. */
  best: Float64Array;
  worst: Float64Array;
}

export interface CashEnvelopes {
  x: Int32Array;
  mean: Float64Array;
  p05: Float64Array;
  p95: Float64Array;
  p15: Float64Array;
  p85: Float64Array;
  p025: Float64Array;
  p975: Float64Array;
  min: Float64Array;
  max: Float64Array;
}

/**
 * Engine output. All bankroll-valued fields are in BB; the UI multiplies by
 * `bbSize` to render $. `rakePaidBb` and `rbEarnedBb` are totals over the
 * full `hands` horizon — helpful for sanity-check panels.
 */
export interface CashResult {
  type: "cash-result";
  echoInput: CashInput;

  /** Count of paths actually run. */
  samples: number;

  /** BB at the end of each path (length = samples). */
  finalBb: Float64Array;
  /** Histogram of final BB. */
  histogram: { binEdges: number[]; counts: number[] };

  samplePaths: CashSamplePaths;
  envelopes: CashEnvelopes;

  /** Max drawdown (BB, positive magnitude) per sample. */
  drawdownHistogram: { binEdges: number[]; counts: number[] };
  /** Longest breakeven stretch (hands below current peak) per sample. */
  longestBreakevenHistogram: { binEdges: number[]; counts: number[] };
  /** Time from deepest drawdown back to recovery (hands); unrecovered tracked separately. */
  recoveryHistogram: { binEdges: number[]; counts: number[] };
  /** Convergence of sample-mean winrate as the MC progresses. */
  convergence: {
    x: Int32Array;
    mean: Float64Array;
    seLo: Float64Array;
    seHi: Float64Array;
  };

  stats: {
    /** Theoretical (from input). */
    expectedEvBb: number;
    expectedEvUsd: number;
    /** Realized from sample. */
    meanFinalBb: number;
    meanFinalUsd: number;
    /** Realized SD of final BR. */
    sdFinalBb: number;
    /** P(final < 0). */
    probLoss: number;
    /** Share of paths whose running minimum touched `<= -100 BB`. */
    probSub100Bb: number;
    /** Fraction of samples that never recovered after their deepest drawdown. */
    recoveryUnrecoveredShare: number;

    /** Rake paid over the full horizon (per-path mean, BB). */
    meanRakePaidBb: number;
    /** RB earned over the full horizon (per-path mean, BB). Includes PVI. */
    meanRbEarnedBb: number;
    /** Hourly EV in $ if hoursBlock supplied; undefined otherwise. */
    hourlyEvUsd?: number;
  };
}
