export type PayoutStructureId =
  | "mtt-standard"
  | "mtt-flat"
  | "mtt-top-heavy"
  | "mtt-pokerstars"
  | "mtt-gg"
  | "mtt-sunday-million"
  | "mtt-gg-bounty"
  | "sng-50-30-20"
  | "sng-65-35"
  | "winner-takes-all"
  | "custom";

export type FinishModelId =
  | "power-law"
  | "linear-skill"
  | "stretched-exp"
  | "uniform"
  | "empirical";

export interface FinishModelConfig {
  id: FinishModelId;
  /** Manual override; when set, no ROI calibration is performed. */
  alpha?: number;
  /** Stretched-exponential only: second shape parameter β ∈ (0, 2]. */
  beta?: number;
  /**
   * Empirical-model data. When `id = "empirical"`, we resample finish
   * positions from a user-provided histogram normalized over [1, N]. The
   * shape is fixed and ROI-calibration is a no-op; α does not apply.
   */
  empiricalBuckets?: number[];
}

export type FieldVariability =
  | { kind: "fixed" }
  | { kind: "uniform"; min: number; max: number; buckets?: number };

export interface TournamentRow {
  id: string;
  label?: string;
  tags?: string[];

  /** Nominal field size; used as midpoint when variability = uniform. */
  players: number;
  fieldVariability?: FieldVariability;

  /** Base entry fee paid into the prize pool. */
  buyIn: number;
  /** Rake as a fraction of the buy-in (e.g. 0.1 = 10 %). */
  rake: number;

  /** Target player ROI as a fraction (e.g. 0.2 = +20 %). */
  roi: number;

  payoutStructure: PayoutStructureId;
  /** Used when payoutStructure = "custom". Array of place fractions. */
  customPayouts?: number[];

  /** Guaranteed prize pool; overlay = max(0, guarantee − N × buyIn). */
  guarantee?: number;

  /**
   * How many times this row is played per schedule pass. Fractional values
   * are allowed and rounded stochastically at compile time.
   */
  count: number;

  // -------- re-entry / knockout / ICM extensions --------

  /**
   * Maximum total entries per player in this MTT. `1` = freezeout (default).
   * `> 1` = re-entry / re-buy. We model re-entry as geometric: after busting,
   * the player re-enters with probability `reentryRate` until either the
   * max is reached or the draw fails. Every extra entry costs another
   * `buyIn × (1+rake)` and adds to the prize pool.
   */
  maxEntries?: number;
  /**
   * Probability of re-entering after a non-cashing bust. Defaults to 1 if
   * `maxEntries > 1` is set without an explicit rate. Ignored for
   * freezeouts. Bounded to [0, 1].
   */
  reentryRate?: number;

  /**
   * Knockout / bounty tournaments. `bountyFraction` is the share of the
   * buy-in (minus rake) that is siphoned off into the bounty pool, e.g.
   * `0.5` = 50 % bounty. The engine subtracts bounty from the regular
   * prize pool and pays back a bounty-EV lump sum at calibration time.
   */
  bountyFraction?: number;

  /**
   * ICM final table flag. When true, the top `icmFinalTableSize` places
   * (default 9) have their raw $-payouts re-weighted through a
   * Malmuth-Harville ICM approximation before the finish sampler uses
   * them. This pulls EV out of 1st and into the bottom-of-FT places to
   * reflect real-world deals, matching observed payout reality on high-
   * stakes streams.
   */
  icmFinalTable?: boolean;
  icmFinalTableSize?: number;
}

/**
 * Calibration mode — how ROI is translated into a finish-place distribution.
 *
 * - "alpha" (default): the skilled-aware parametric calibration — binary-search
 *   α so the configured skill model (power-law / linear-skill / stretched-exp)
 *   hits the target ROI. Concentrates skill in deep finishes.
 * - "primedope-uniform-lift": reproduces PrimeDope's model. Paid places all get
 *   the same lifted probability k/N, unpaid places share the remaining mass.
 *   Finish-model id is ignored in this mode.
 */
export type CalibrationMode = "alpha" | "primedope-uniform-lift";

export interface SimulationInput {
  schedule: TournamentRow[];
  scheduleRepeats: number;
  samples: number;
  bankroll: number;
  seed: number;
  finishModel: FinishModelConfig;
  /**
   * When true, the engine runs the simulation twice on the same seed — once
   * with α calibration (primary) and once with PrimeDope's uniform-lift
   * calibration (returned as `result.comparison`). Used for the side-by-side
   * "we vs them" mode.
   */
  compareWithPrimedope?: boolean;
  /** Internal dispatch; callers should set compareWithPrimedope instead. */
  calibrationMode?: CalibrationMode;
  /**
   * One-sigma uncertainty on the player's true ROI, expressed as a fraction
   * (e.g. 0.05 = ±5 pp on the configured target). Defaults to 0 — the
   * classical "you know your ROI exactly" PrimeDope assumption. When > 0,
   * the engine draws a per-sample skill delta from Normal(0, roiStdErr)
   * and applies it linearly to each entry's running profit. This captures
   * the dominant source of real-world uncertainty: maybe you are a worse
   * player than you think.
   */
  roiStdErr?: number;
}

export interface RowDecomposition {
  rowId: string;
  label: string;
  /** Mean per-sample profit contributed by this row */
  mean: number;
  stdDev: number;
  /** Share of total variance (Var_row / Var_total) */
  varianceShare: number;
  tournamentsPerSample: number;
  totalBuyIn: number;
}

export interface SimulationProgress {
  type: "progress";
  done: number;
  total: number;
}

export interface SimulationResult {
  type: "result";
  samples: number;
  tournamentsPerSample: number;
  totalBuyIn: number;
  expectedProfit: number;

  /** Which calibration produced this result. */
  calibrationMode: CalibrationMode;
  /**
   * Twin run with PrimeDope's uniform-lift calibration, on the same seed and
   * the same schedule. Only present when SimulationInput.compareWithPrimedope
   * is true on the top-level request. Nested comparison is never populated.
   */
  comparison?: SimulationResult;

  finalProfits: Float64Array;
  histogram: { binEdges: number[]; counts: number[] };

  samplePaths: {
    x: number[];
    paths: Float64Array[];
    best: Float64Array;
    worst: Float64Array;
    /** Indices (into the 0..samples−1 space) of the picked random paths */
    sampleIndices: number[];
  };

  envelopes: {
    x: number[];
    mean: Float64Array;
    p15: Float64Array;
    p85: Float64Array;
    p025: Float64Array;
    p975: Float64Array;
    p0015: Float64Array;
    p9985: Float64Array;
  };

  /** Per-row per-sample profit breakdown (variance decomposition) */
  decomposition: RowDecomposition[];

  /** Convergence of estimated mean profit as sample count grows */
  convergence: {
    x: number[];
    mean: Float64Array;
    seLo: Float64Array;
    seHi: Float64Array;
  };

  /** Histogram of max drawdowns over all samples */
  drawdownHistogram: { binEdges: number[]; counts: number[] };

  /**
   * ROI sensitivity scan. For a grid of hypothetical ROI deltas around
   * the configured target, reports the total expected profit assuming
   * realised ROI differs from the planned value. Linear under the α
   * calibration (cost_per × Δ × total_tournaments) — noise-free.
   */
  sensitivity: {
    deltas: number[];
    expectedProfits: number[];
  };

  /**
   * Worst-N drawdown catalog — up to 10 samples sorted by depth, with
   * the final profit and longest breakeven for each so players can read
   * "here's what your worst month looks like".
   */
  downswings: {
    rank: number;
    sampleIndex: number;
    depth: number;
    finalProfit: number;
    longestBreakeven: number;
  }[];

  stats: {
    mean: number;
    median: number;
    stdDev: number;
    min: number;
    max: number;
    p01: number;
    p05: number;
    p95: number;
    p99: number;
    probProfit: number;
    riskOfRuin: number;
    maxDrawdownMean: number;
    maxDrawdownWorst: number;
    longestBreakevenMean: number;

    /** Value at Risk (loss) at 95 % and 99 % — positive numbers */
    var95: number;
    var99: number;
    /** Conditional VaR — expected loss given we're in the tail */
    cvar95: number;
    cvar99: number;
    /** E / σ (dimensionless) */
    sharpe: number;
    /** Sortino: E / (downside σ) */
    sortino: number;
    /**
     * Number of tournaments needed before the 95 % CI for ROI is within
     * ±5 % (rough heuristic: (1.96 σ_per / (0.05 cost_per))²).
     */
    tournamentsFor95ROI: number;
    /** Minimum bankroll for which historical RoR ≤ 1 % in the samples */
    minBankrollRoR1pct: number;
    minBankrollRoR5pct: number;
    /**
     * Compile-time expected in-the-money rate across the whole schedule —
     * weighted mean of per-tournament ITM probability from the finish-place
     * PMF, not a sampled statistic. Precise and noise-free.
     */
    itmRate: number;

    /**
     * Third standardized moment E[((X−μ)/σ)^3]. Negative = fatter left tail
     * (more bad months than good). PrimeDope reports none of this.
     */
    skewness: number;
    /**
     * Excess kurtosis E[((X−μ)/σ)^4] − 3. Zero = gaussian; positive = fat
     * tails (more extreme outcomes than a normal distribution predicts).
     */
    kurtosis: number;
    /**
     * Fraction of bankroll to risk per unit of EV under the Kelly criterion:
     * f* ≈ μ / σ² (continuous approximation). Dimensionless; valid only
     * when mean > 0.
     */
    kellyFraction: number;
    /**
     * Kelly-optimal bankroll: totalBuyIn / kellyFraction. Interpreted as
     * the minimum roll at which playing the full schedule is the Kelly-
     * optimal bet size. Infinity when mean ≤ 0.
     */
    kellyBankroll: number;
    /**
     * Expected log-growth rate E[ln(1 + profit/bankroll)] — the quantity
     * Kelly maximises. Only meaningful when `bankroll > 0`; 0 otherwise.
     * Ruin samples (profit ≤ -bankroll) are clamped to ln(1e-9) to avoid
     * −∞ contamination.
     */
    logGrowthRate: number;
    /**
     * Mean max drawdown expressed in buy-ins (schedule-average buy-in).
     * Much more intuitive than "$47,300" for cross-stake comparison.
     */
    maxDrawdownBuyIns: number;
  };
}

export type WorkerMessage = SimulationProgress | SimulationResult;
