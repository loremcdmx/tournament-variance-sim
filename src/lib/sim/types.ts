export type PayoutStructureId =
  | "mtt-standard"
  | "mtt-primedope"
  | "mtt-flat"
  | "mtt-top-heavy"
  | "mtt-pokerstars"
  | "mtt-gg"
  | "mtt-sunday-million"
  | "mtt-gg-bounty"
  | "satellite-ticket"
  | "sng-50-30-20"
  | "sng-65-35"
  | "winner-takes-all"
  | "custom";

export type FinishModelId =
  | "power-law"
  | "linear-skill"
  | "stretched-exp"
  | "plackett-luce"
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
  /**
   * Late-registration growth factor. When > 1, the real field at reg-close
   * is `players × lateRegMultiplier` — more entries than were present when
   * you sat down, scaling prize pool and paid seats but keeping your own
   * finish-position distribution shape. Captures the "late-reg nightmare"
   * dynamic: more dead-money, but also a wider field you must navigate.
   * Defaults to 1 (no late reg). PrimeDope cannot model this at all.
   */
  lateRegMultiplier?: number;

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

  /**
   * "Sit through pay jumps" play style — the player refuses to fold their
   * way into mincashes and instead plays for deeper stacks. The transform
   * is EV-preserving: a fraction `payJumpAggression` ∈ (0, 1] of the
   * probability mass on bottom-half paid places is removed; half of it
   * flows into top-half paid finishes (weighted by prize), the rest is
   * dropped into busts. The EV-neutral split ratio is solved analytically
   * from the paid-prize averages so calibrated ROI is preserved exactly.
   * Captures a real trade-off: refusing to min-cash trades a lot of small
   * wins for fewer-but-bigger ones, pushing all the variance outward.
   * Defaults to 0 (disabled).
   */
  sitThroughPayJumps?: boolean;
  payJumpAggression?: number;

  /**
   * Mystery-bounty variance multiplier. When > 0, each collected bounty is
   * scaled by an independent log-normal draw with variance `mysteryBountyVariance`
   * (in log space), so the per-KO $ value is right-skewed with occasional
   * jackpots. The mean is preserved by design (log-normal `μ = −σ²/2`),
   * so row-level EV is unchanged — only variance is reshaped. Use the
   * typical 0.5–1.5 range for GG-style mystery bounties. Defaults to 0.
   */
  mysteryBountyVariance?: number;
}

/**
 * Calibration mode — how ROI is translated into a finish-place distribution.
 *
 * - "alpha" (default): the skilled-aware parametric calibration — binary-search
 *   α so the configured skill model (power-law / linear-skill / stretched-exp)
 *   hits the target ROI. Concentrates skill in deep finishes.
 * - "primedope-binary-itm": reproduces PrimeDope's actual variance model. All
 *   paid places are collapsed into a single Bernoulli "you cashed / you didn't"
 *   outcome, with one fixed average-cash payoff equal to targetWinnings / ITM.
 *   This eliminates payout-shape variance entirely (1st place pays the same as
 *   min-cash) and matches PrimeDope's site nearly exactly. The finish-model id
 *   is ignored in this mode.
 */
export type CalibrationMode = "alpha" | "primedope-binary-itm";

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
  /**
   * "PrimeDope-style EV": ignore rake when computing the binary-ITM target
   * winnings, so the comparison run matches PrimeDope's site numerically
   * (their ROI is profit / sum-buy-ins, not profit / sum-cost). This is
   * formally wrong — rake IS part of your cost basis — but lets the side-
   * by-side comparison line up with their published SDs and bankroll
   * requirements. Default: true. Only affects the binary-ITM comparison.
   */
  primedopeStyleEV?: boolean;
  /**
   * Twin-run mode for the side-by-side trajectory view. "random" (default)
   * runs the same model twice with two different seeds — shows how much two
   * fresh draws diverge. "primedope" runs our α-calibrated model on the left
   * and PrimeDope's uniform-lift on the right with the same seed — shows
   * how the algorithm choice changes the answer on identical randomness.
   */
  compareMode?: "random" | "primedope";
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

  /**
   * Per-tournament ROI shock σ (in ROI fraction units). Each tournament gets
   * an independent Normal(0, σ) draw added to the effective ROI. Models
   * "the field at this specific tournament happened to be soft/tough".
   * Uncorrelated noise — averages out as 1/√n with volume. Defaults to 0.
   */
  roiShockPerTourney?: number;
  /**
   * Per-session ROI shock σ. One Normal(0, σ) draw per *schedule pass* (one
   * pass = one play of the full schedule), added to every tournament in
   * that pass. Models "today the field is fishier than usual" or "today
   * I'm in form / off form". Correlated within a session, independent
   * across sessions. Defaults to 0.
   */
  roiShockPerSession?: number;
  /**
   * Slow ROI drift σ (long-run). An AR(1) process advanced once per
   * schedule pass: drift_t = ρ · drift_{t−1} + Normal(0, σ · √(1−ρ²)),
   * with ρ defaulting to 0.95 (≈20-session memory). Models meta shifts,
   * roster turnover, seasonality. Defaults to 0.
   */
  roiDriftSigma?: number;
  /** AR(1) persistence for roiDriftSigma. Defaults to 0.95 if unset. */
  roiDriftRho?: number;

  // -------- TILT mechanics — two flavors, can be used together ----------

  /**
   * FAST tilt — symmetric, immediate, smooth. ROI is shifted continuously
   * by `−tiltFastGain · tanh(currentDrawdown / tiltFastScale)`. Always-on
   * once gain ≠ 0; reacts within tens of tournaments. Use for nervous
   * grinders whose play degrades the second they go down.
   *
   *  - tiltFastGain  ∈ [−1, 1]: max ROI shift at saturation (tanh=1).
   *      −0.3 = lose 30 pp of ROI at deep drawdown (typical tilter).
   *      +0.2 = play sharper when down (rare, focus types).
   *  - tiltFastScale (in profit $): drawdown depth at which tanh ≈ 0.76.
   *      Smaller = more sensitive. Defaults to 100 buy-ins-equivalent.
   */
  tiltFastGain?: number;
  tiltFastScale?: number;

  /**
   * SLOW tilt — state-machine with hysteresis. Player sits in `normal`
   * until they spend `tiltSlowMinDuration` tournaments straight in a
   * drawdown deeper than `tiltSlowThreshold` (entry → `down`) or in
   * an upswing higher than the same threshold (entry → `up`). While
   * in `down`, ROI is shifted by `−tiltSlowGain`; while in `up`, by
   * `+tiltSlowGain`. State exits ONLY after recovering
   * `tiltSlowRecoveryFrac` of the original swing. Models the "I need
   * to claw back half before I calm down" reality of long streaks.
   *
   * Defaults when unset: gain=0 (off), threshold=50 buy-ins,
   * minDuration=500 tournaments, recoveryFrac=0.5.
   */
  tiltSlowGain?: number;
  tiltSlowThreshold?: number;
  tiltSlowMinDuration?: number;
  tiltSlowRecoveryFrac?: number;
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
  /**
   * Per-row Kelly fraction f* = mean / variance (continuous Kelly limit),
   * evaluated on the row's *slot* profit distribution. Zero or negative
   * means this row is not a Kelly bet. Dimensionless.
   */
  kellyFraction: number;
  /**
   * Per-row Kelly bankroll: minimum roll at which playing *just this row*
   * at its schedule frequency is the Kelly-optimal bet size. `totalBuyIn /
   * kellyFraction` when kellyFraction > 0, else Infinity.
   */
  kellyBankroll: number;
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
   * Streak histograms — sample-level distributions of the streak metrics
   * (longest breakeven run, longest cashless run, recovery length).
   * Recovery histogram uses only recovered samples; unrecovered share lives
   * in stats.recoveryUnrecoveredShare.
   */
  longestBreakevenHistogram: { binEdges: number[]; counts: number[] };
  longestCashlessHistogram: { binEdges: number[]; counts: number[] };
  recoveryHistogram: { binEdges: number[]; counts: number[] };

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
    /**
     * Tail quantiles of the max drawdown across samples. "Typical" (median)
     * vs 5% / 1% worst — direct answer to "how bad can a bad stretch get".
     */
    maxDrawdownMedian: number;
    maxDrawdownP95: number;
    maxDrawdownP99: number;
    /**
     * Recovery length after the deepest drawdown per sample — number of
     * tournaments from the trough of maxDD back to the pre-drawdown peak.
     * `recoveryUnrecoveredShare` is the fraction of samples that never
     * recovered by end-of-schedule (infinite recovery).
     */
    recoveryMedian: number;
    recoveryP90: number;
    recoveryUnrecoveredShare: number;
    /**
     * Longest run of consecutive no-cash tournaments inside a sample.
     * `longestCashlessMean` is the average across samples,
     * `longestCashlessWorst` is the max.
     */
    longestCashlessMean: number;
    longestCashlessWorst: number;
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
    /** Same idea at 15 % and 50 % thresholds — used for PrimeDope-mirror reports. */
    minBankrollRoR15pct: number;
    minBankrollRoR50pct: number;
    /**
     * PrimeDope-compatible analytic RoR readouts. Assumes profit is a
     * Brownian motion with drift μ and volatility σ over N tournaments
     * (per-tourney mean/SD derived from the schedule totals). Inverts the
     * classical first-passage formula
     *   P(ruin by N | B) = Φ((−B−μN)/(σ√N)) + exp(−2μB/σ²)·Φ((−B+μN)/(σ√N))
     * numerically to find the bankroll B for which P(ruin) equals the
     * target α. Gaussian tails systematically understate real risk on
     * skewed prize distributions — these values are reported alongside
     * the empirical ones so users can see PD's answer side-by-side with
     * the honest one.
     */
    minBankrollRoR1pctGaussian: number;
    minBankrollRoR5pctGaussian: number;
    /** Gaussian ruin probability at the user's configured bankroll. */
    riskOfRuinGaussian: number;

    /**
     * Monte Carlo precision readouts — how trustworthy this specific run is.
     * All derived from the sample count S and the empirical SD; they tell
     * the user "bumping samples higher makes the numbers N times tighter".
     *
     * - seMean   = stdDev / √S — 1σ noise on the reported mean.
     * - seStdDev = stdDev / √(2·(S−1)) — 1σ noise on the reported stdDev
     *   (Gaussian approximation; conservative for skewed distributions).
     * - ci95HalfWidthMean = 1.96 × seMean — 95 % CI half-width on mean.
     * - roiMcErrorPct — MC-uncertainty of the reported ROI as a percentage
     *   of it, i.e. |1.96·seMean / mean|. Answers "is this +ROI real or
     *   within MC noise?".
     * - precisionScore ∈ [0, 1] — bucketed quality flag: 1.0 when
     *   ci95 half-width < 1 % of mean, 0.5 when < 5 %, 0 otherwise. Used
     *   by the UI to green/yellow/red the run.
     * - samplesFor1Pct — projected S required to hit ≤ 1 % relative MC
     *   error on mean (from current σ/|μ|). Infinite if mean ≤ 0.
     */
    mcSeMean: number;
    mcSeStdDev: number;
    mcCi95HalfWidthMean: number;
    mcRoiErrorPct: number;
    mcPrecisionScore: number;
    mcSamplesFor1Pct: number;
    /** Fraction of samples whose running min profit stayed ≥ 0 throughout. */
    neverBelowZeroFrac: number;
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
    /**
     * Analytical per-tourney σ from the calibrated pmf (√(E[X²]−E[X]²) on
     * prize+bounty), schedule-weighted. Independent of the MC run and used
     * as a self-check next to the empirical per-tourney σ.
     */
    sigmaPerTournamentAnalytic: number;
    /** Empirical per-tourney σ = stdDev / √N. Reported alongside the analytic
     *  counterpart so the user can eyeball convergence / calibration drift. */
    sigmaPerTournamentEmpirical: number;
  };
}

