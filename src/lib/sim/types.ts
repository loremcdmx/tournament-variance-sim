/**
 * Canonical type definitions for the simulator. Everything downstream of
 * `SimulationInput` / `SimulationResult` lives here. If a type leaks beyond
 * `src/lib/sim/` it should be re-exported explicitly — the boundary is load-
 * bearing for worker-message serialization.
 *
 * Adding a new stochastic channel / payout structure / finish model: add the
 * field here first, then thread it through `engine.ts` and (if user-visible)
 * `dict.ts`.
 */
export type PayoutStructureId =
  | "mtt-standard"
  | "mtt-primedope"
  | "mtt-flat"
  | "mtt-top-heavy"
  | "battle-royale"
  | "mtt-pokerstars"
  | "mtt-gg"
  | "mtt-sunday-million"
  | "mtt-gg-bounty"
  | "mtt-gg-mystery"
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
  | "empirical"
  | "freeze-realdata-step"
  | "freeze-realdata-linear"
  | "freeze-realdata-tilt"
  | "pko-realdata-step"
  | "pko-realdata-linear"
  | "pko-realdata-tilt"
  | "mystery-realdata-step"
  | "mystery-realdata-linear"
  | "mystery-realdata-tilt"
  | "powerlaw-realdata-influenced";

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

/**
 * High-level game format for a tournament row. Drives sensible defaults
 * for re-entry / bounty / mystery fields in the editor and feeds a
 * single badge into the preview. The engine itself reads the underlying
 * fields (`maxEntries`, `bountyFraction`, `mysteryBountyVariance`), so
 * gameType is purely a UX grouping — switching it just rewrites those
 * fields to preset values.
 *
 * - "freezeout":         one entry per player, no bounty.
 * - "freezeout-reentry": re-entry allowed, no bounty.
 * - "pko":               progressive knockout — half the buy-in into bounty.
 * - "mystery":           mystery bounty — log-normal per-KO variance.
 * - "mystery-royale":    mystery bounty with jackpot-tier right tail.
 */
export type GameType =
  | "freezeout"
  | "freezeout-reentry"
  | "pko"
  | "mystery"
  | "mystery-royale";

export type FieldVariability =
  | { kind: "fixed" }
  | { kind: "uniform"; min: number; max: number; buckets?: number };

export interface TournamentRow {
  id: string;
  label?: string;
  tags?: string[];

  /**
   * High-level format (freezeout, re-entry, PKO, mystery, mystery-royale).
   * Undefined is treated as a plain freezeout for backward compat — the
   * legacy rows have `maxEntries`/`bountyFraction` set directly and don't
   * need to know about gameType. See `GameType` for the full taxonomy.
   */
  gameType?: GameType;

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

  /**
   * Fixed in-the-money rate override, as an absolute fraction (e.g. 0.16 = 16 %).
   * When set, calibration switches to the "fixed-ITM" model: ITM rate is held
   * constant regardless of ROI, and all skill concentrates WITHIN the cashed
   * band only (power-law / linear-skill / etc. applied to paid places only,
   * non-paid places get uniform mass). Matches the empirical fact that
   * grinders don't actually cash much more often than no-skill players —
   * their edge shows up in running deeper when they do cash. When the cash
   * target is at least breakeven, the fixed-ITM solver also keeps P(1st)
   * from falling below the no-skill equilibrium 1 / field size; bounty rows
   * reconcile any impossible cash/KO split through residual bounty EV.
   * Undefined = old α-calibration behaviour where ITM rate is a free
   * parameter that scales with ROI. Ignored in primedope-binary-itm mode.
   */
  itmRate?: number;

  /**
   * Manual "shell" locks on the finish-place distribution, used by the
   * fixed-ITM shape panel. Each value is an ABSOLUTE cumulative probability
   * from the top of the band:
   *   - first: P(place 1)
   *   - top3:  P(places 1..3), must be ≥ first
   *   - ft:    P(places 1..min(9, paid)), must be ≥ top3
   *
   * Any locked shells stay pinned; the remaining free paid places are
   * α-calibrated via the configured finish model so the total expected
   * winnings still hit the ROI target. When none are set, fixed-ITM falls
   * back to pure α calibration. Only consulted when `itmRate` is set.
   */
  finishBuckets?: {
    first?: number;
    top3?: number;
    ft?: number;
  };

  payoutStructure: PayoutStructureId;
  /** Used when payoutStructure = "custom". Array of place fractions. */
  customPayouts?: number[];

  /** Guaranteed prize pool; overlay = max(0, guarantee − N × buyIn). */
  guarantee?: number;

  /**
   * How many times this row is played per schedule pass. Fractional values
   * are allowed and rounded stochastically at compile time. Within a pass,
   * rows are interleaved as evenly as possible by their frequencies rather
   * than executed in row-sized batches.
   */
  count: number;

  // -------- re-entry / knockout extensions --------

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

  /**
   * PKO "session heat" σ — latent per-tournament reshape of the bounty
   * payout curve. Each tournament draws one z ~ N(0,1); the raw PKO
   * cumulative-cash weights are raised to exponent `1 + pkoHeat · z` and
   * re-normalized against the (unchanged) calibrated finish pmf so the
   * bin-local mean bounty equals the base mean bounty. Hot sessions
   * (z > 0) sharpen bounty mass onto the very deepest finishes — monster
   * runs collect an oversized KO haul — while cold sessions flatten it.
   * Finish distribution, prize curve and ROI are untouched, so expected
   * value stays exactly on target; only the right tail of the bounty
   * component fattens. Typical 0.4–0.7. Defaults to 0 (disabled →
   * bit-exact legacy PKO path). Requires `bountyFraction > 0`.
   */
  pkoHeat?: number;

  /**
   * PKO head-size log-variance σ² — within-place bounty noise from the
   * natural dispersion of opponent head values. In progressive PKO, the
   * cash you receive per KO depends on the opponent's accumulated head,
   * which ranges from ~starting_bounty/2 to many multiples of it. This
   * parameter models that per-KO payout variance as log-normal noise
   * (same mechanism as mystery bounty). Adds to `mysteryBountyVariance`
   * when both are present. Typical range 0.2–0.6. Defaults to 0.4 for
   * PKO game types (CV ≈ 0.68), 0 for non-bounty formats.
   */
  pkoHeadVar?: number;

  /**
   * Bounty EV bias slider ∈ [−0.25, +0.25], default 0. Shifts the split of
   * the player's expected winnings between cash (finish-place payouts) and
   * bounty (KO collections) without changing total ROI:
   *   s = 0    → default split (bountyMean keeps the structural
   *              `bountyPerSeat × (1+rake)(1+roi)` target).
   *   s > 0    → toward cash: bountyMean scales to `default × (1−s)`;
   *              cash target absorbs the shortfall, α recalibrates upward.
   *   s < 0    → toward bounty: bountyMean grows linearly toward
   *              `totalWinningsEV` (cash target shrinks, player profit
   *              comes more from KOs).
   * In Battle Royale the published envelope table fixes mean $ per KO, so
   * this bias is expressed by changing expected KO count rather than the
   * average envelope size. Battle Royale also treats ROI as incremental
   * profit: at s = 0, positive ROI above the breakeven finish baseline is
   * split 50/50 between cash and KOs; s > 0 moves that incremental profit
   * toward cash, s < 0 toward KOs.
   * Clamped to ±0.25 at the engine — empirically, α calibration begins to
   * bottom out against its search envelope near ±0.3, which would leave
   * realized EV below the ROI contract. ±0.25 keeps the shift inside the
   * feasible cone for every payout / bountyFraction combination we ship.
   * Only meaningful for rows with `bountyFraction > 0` — ignored otherwise.
   */
  bountyEvBias?: number;

  /**
   * Fixed-ITM placement bias inside the paid band, clamped to [-1, +1].
   * Default 0 = keep the model's current placement shape. Positive values
   * make finishes more top-heavy inside ITM; negative values flatten the
   * paid band toward lower cashes. Total EV is still solved exactly:
   *
   * - in standard fixed-ITM rows, the free paid places are multiplicatively
   *   tilted by this bias before α closes the target cash EV;
   * - in Battle Royale, the bias walks the feasible 1st/2nd/3rd line while
   *   keeping the chosen cash EV target fixed.
   *
   * Ignored when fixed-ITM mode is off (`itmRate` unset/zero).
   */
  itmTopHeavyBias?: number;

  /**
   * Battle Royale leaderboard promo toggle. Only read when the product is in
   * advanced mode AND the row is effectively Battle Royale. When enabled,
   * the row's BR promo budget is routed into the separate leaderboard promo
   * channel instead of staying as direct deterministic rakeback.
   */
  battleRoyaleLeaderboardEnabled?: boolean;
  /**
   * Legacy field kept for backward-compatible payloads. The current UI/model
   * contract is binary: enabled BR rows are treated as 100 % leaderboard and
   * disabled rows as 100 % direct RB.
   */
  battleRoyaleLeaderboardShare?: number;
}

export interface BattleRoyaleLeaderboardPayoutTier {
  /** Inclusive 1-based rank bounds for this prize band. */
  rankFrom: number;
  rankTo: number;
  /** Prize paid to EACH finishing rank inside the band. */
  prizeEach: number;
}

export interface BattleRoyaleLeaderboardScoring {
  /** Flat points awarded for registering and completing one BR event. */
  entryPoints?: number;
  /** Linear points per knockout / envelope-dropping elimination. */
  knockoutPoints: number;
  /** Additional place points for 1st / 2nd / 3rd. */
  firstPoints: number;
  secondPoints: number;
  thirdPoints: number;
}

export interface BattleRoyaleLeaderboardOpponentModel {
  kind: "normal";
  /** Mean leaderboard score per leaderboard window for one opponent. */
  meanScore: number;
  /** Standard deviation of opponent score over the same window. */
  stdDevScore: number;
}

/**
 * Optional Battle Royale leaderboard model. Only rows whose effective format
 * is Battle Royale contribute points; the simulator resolves leaderboard
 * payouts in a separate promo channel so the product can present that income
 * explicitly instead of silently pretending it already lives inside bankroll
 * trajectories.
 */
export interface BattleRoyaleLeaderboardConfig {
  /** Total players on the leaderboard INCLUDING hero. */
  participants: number;
  /** Number of BR tournaments that make up one leaderboard period. */
  windowTournaments: number;
  scoring: BattleRoyaleLeaderboardScoring;
  payouts: BattleRoyaleLeaderboardPayoutTier[];
  opponentModel: BattleRoyaleLeaderboardOpponentModel;
  /**
   * Whether the final incomplete leaderboard window inside a sample should be
   * settled. Defaults to true; false means only full windows pay.
   */
  awardPartialWindow?: boolean;
  /**
   * Schedule row ids that actually feed this leaderboard. Lets advanced-mode
   * BR rows opt in individually while every other row stays on plain direct
   * rakeback.
   */
  includedRowIds?: string[];
}

/**
 * Calibration mode — how ROI is translated into a finish-place distribution.
 *
 * - "alpha" (default): the skilled-aware parametric calibration — binary-search
 *   α so the configured skill model (power-law / linear-skill / stretched-exp)
 *   hits the target ROI. Concentrates skill in deep finishes.
 * - "primedope-binary-itm": reproduces PrimeDope's actual variance model.
 *   The probability of cashing is a single Bernoulli "you cashed / you
 *   didn't" — every paid place has the same probability `l / paid`, where
 *   `l` is solved from the ROI target. Crucially, the per-place payouts
 *   are NOT collapsed: each paid place keeps its real top-heavy dollar
 *   amount from the payout schedule (1st still pays way more than min-
 *   cash), so the within-ITM payout variance is preserved. What PD's model
 *   loses is *skill*-driven deeper-running: since every paid place is
 *   equally likely, a +ROI player cashes more often but doesn't run deeper
 *   more often. That's the actual weakness vs our α-calibrated run, not
 *   a flattening of the payout curve. The finish-model id is ignored in
 *   this mode. See `finishModel.ts` → `buildBinaryItmAssets` for the exact
 *   construction; mirrors `tmp_legacy.js` Distribution ctor lines ~1288.
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
   * Twin-run mode for the side-by-side trajectory view. "random" (default)
   * runs the same model twice with two different seeds — shows how much two
   * fresh draws diverge. "primedope" runs our α-calibrated model on the left
   * and PrimeDope's uniform-lift on the right with the same seed — shows
   * how the algorithm choice changes the answer on identical randomness.
   */
  compareMode?: "random" | "primedope";
  /**
   * Active model preset ID from ControlsState. The engine itself only cares
   * about one value: "primedope". In that preset the user's intent is "show
   * me PrimeDope's ITM distribution as the primary result", so useSimulation
   * swaps the twin-run calibrations — left pane runs primedope-binary-itm,
   * right pane runs our honest α algo.
   */
  modelPresetId?: string;
  /** Internal dispatch; callers should set compareWithPrimedope instead. */
  calibrationMode?: CalibrationMode;
  /**
   * When true, the PrimeDope comparison pass (binary-ITM) also forcibly
   * substitutes PD's native payout curve (`mtt-primedope`) for every row
   * in the schedule, regardless of the user's selected payout structure.
   *
   * Default: `false` — both passes honour `row.payoutStructure`, so the
   * only thing that differs between the α pane and the PD pane is the
   * finish model. That's usually what users want: "how much does our
   * algorithm change the answer on an identical setup?" rather than
   * "how much does PD's whole stack (model + payout) differ from ours".
   *
   * Enable this flag when you explicitly want to reproduce PD's σ on
   * their reference scenarios — PD's own math assumes their native
   * curves, and the flag routes the binary-ITM pass onto those same
   * curves so the numbers land where PD reports them.
   */
  usePrimedopePayouts?: boolean;
  /**
   * PrimeDope comparison toggles: when the run is in `primedope-binary-itm`
   * mode, each flag independently controls whether the PD pass keeps PD's
   * native behaviour for that aspect. All three default to `true`, so the
   * PD pane reproduces the live site exactly; flipping any flag off isolates
   * how much that single PD quirk is contributing to the σ gap.
   *
   * - `usePrimedopeFinishModel`: binary-ITM (uniform-over-paid) vs our α-model.
   * - `usePrimedopeRakeMath`: post-rake pool as variance driver (PD's §7 quirk)
   *   vs the consistent pre-rake pool we use outside compare mode.
   */
  usePrimedopeFinishModel?: boolean;
  usePrimedopeRakeMath?: boolean;
  /**
   * PD-style EV: when true, SD calc ignores rake in cost basis so our numbers
   * match PrimeDope byte-for-byte. Only meaningful under
   * `calibrationMode: "primedope-binary-itm"`.
   */
  primedopeStyleEV?: boolean;
  /**
   * Global rakeback budget, as a fraction of rake paid back after every
   * entry. E.g. 0.3 = 30 % of rake returned in promo EV.
   *
   * By default the whole amount is a deterministic direct bonus of
   * `rakebackFracOfRake × row.rake × row.buyIn` added to profit for each
   * bullet fired (re-entries included, since each bullet pays rake).
   *
   * In advanced mode, Battle Royale rows may divert part of that promo budget
   * into `battleRoyaleLeaderboard`; only the remaining direct share is added
   * deterministically to paths.
   */
  rakebackFracOfRake?: number;
  /**
   * Optional Battle Royale leaderboard side-channel. BR rows accumulate
   * points, each leaderboard window resolves against an exogenous opponent-
   * score model, and the result is returned separately as
   * `result.battleRoyaleLeaderboard`.
   */
  battleRoyaleLeaderboard?: BattleRoyaleLeaderboardConfig;
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
  /**
   * Mean bounty winnings per sample for this row (before subtracting
   * buy-in). Zero for non-bounty formats. `mean` already includes this
   * — `bountyMean` is a decomposition slice for charting.
   */
  bountyMean: number;
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

export interface BattleRoyaleLeaderboardResult {
  points: Float64Array;
  payouts: Float64Array;
  windows: Int32Array;
  paidWindows: Int32Array;
  rankSums: Int32Array;
  knockouts: Int32Array;
  firsts: Int32Array;
  seconds: Int32Array;
  thirds: Int32Array;
  stats: {
    meanPoints: number;
    stdDevPoints: number;
    meanPayout: number;
    stdDevPayout: number;
    p95Payout: number;
    p99Payout: number;
    meanWindows: number;
    meanPaidWindows: number;
    paidWindowShare: number;
    meanRank: number;
    meanKnockouts: number;
    meanFirsts: number;
    meanSeconds: number;
    meanThirds: number;
  };
  config: {
    participants: number;
    windowTournaments: number;
    awardPartialWindow: boolean;
    maxPaidRank: number;
  };
  sourceMix: {
    directRakebackMean: number;
    leaderboardMeanTarget: number;
    totalPromoMean: number;
    rows: {
      rowId: string;
      label: string;
      tournaments: number;
      directShare: number;
      leaderboardShare: number;
      directRakebackMean: number;
      leaderboardMeanTarget: number;
    }[];
  };
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
  /**
   * Per-row per-sample profit, row-major: index = sample * numRows + rowIdx.
   * numRows equals `decomposition.length`; rowIdx matches
   * `decomposition[r].rowId` in schedule order. Used by the satellite card
   * in mixed schedules to derive per-sample seats-won from the satellite
   * rows only.
   */
  rowProfits: Float64Array;
  /**
   * Per-sample 0/1 flag — 1 if at least one mystery / mystery-royale
   * envelope draw in that sample hit the jackpot threshold
   * (ratio ≥ 100× mean envelope). Length === samples, regardless of
   * schedule contents; schedules without any mystery row leave it all
   * zeroes. The UI uses this to hide jackpot runs from scale-sensitive
   * charts (histogram, trajectory) when the "hide jackpots" toggle is on.
   */
  jackpotMask: Uint8Array;
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
    p05: Float64Array;
    p95: Float64Array;
    p15: Float64Array;
    p85: Float64Array;
    p025: Float64Array;
    p975: Float64Array;
    p0015: Float64Array;
    p9985: Float64Array;
    /** Pointwise minimum across all samples — "absolute worst run" envelope */
    min: Float64Array;
    /** Pointwise maximum across all samples — "absolute best run" envelope */
    max: Float64Array;
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

  /** Optional Battle Royale leaderboard promo channel. */
  battleRoyaleLeaderboard?: BattleRoyaleLeaderboardResult;

  /**
   * Worst-N drawdown catalog — top-3 samples sorted by peak-to-trough
   * depth, with the final profit and longest breakeven for each so
   * players can read "here's what your worst month looks like".
   */
  downswings: {
    rank: number;
    sampleIndex: number;
    depth: number;
    finalProfit: number;
    longestBreakeven: number;
  }[];
  /**
   * Best-N upswing catalog — mirror of `downswings` sorted by maximum
   * trough-to-peak rise. Surfaces the "heaterest heater" tail so the
   * upside shape sits next to the downside shape in the UI.
   */
  upswings: {
    rank: number;
    sampleIndex: number;
    height: number;
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
    /**
     * Mean "any streak" length: average of per-sample means of
     * first-forward-return chord lengths. For each checkpoint, the distance
     * to the first later point where the path revisits the same Y level;
     * averaged across all such starting points, then across samples.
     * Shorter and more stable than longestBreakevenMean (which is the mean
     * of per-sample MAX chords).
     */
    breakevenStreakMean: number;

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
