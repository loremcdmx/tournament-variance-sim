/**
 * Engine data-contract types, shared across the compile, hot-loop, and
 * result-build stages. Dependency-free leaf (only built-in typed arrays) so
 * every heavier engine module can import it without import cycles.
 */

export interface CompiledEntry {
  rowIdx: number;
  /** Real field size seen by the compiled payout/pmf path after late reg. */
  fieldSize: number;
  /**
   * When this slot corresponds to a row with fieldVariability, variants holds
   * the full bucket set. The hot loop picks one uniformly per sample, so field
   * size actually contributes variance instead of being compile-time smoothed.
   * For rows without variability this is undefined (fast path).
   */
  variants?: CompiledEntry[];
  /** Cost of one entry (buy-in + rake). The hot loop charges this per slot
   *  and it is also what totalBuyIn / per-row accounting sum. */
  singleCost: number;
  /** Deterministic rakeback credit added to profit for the entry.
   *  `input.rakebackFracOfRake × row.rake × row.buyIn`. Zero when rakeback
   *  isn't configured; pure mean shift (adds zero variance, but reshapes
   *  path-dependent stats — drawdown, running max, time-above-zero, bust
   *  probability — since cumulative profit is what those read). */
  rakebackBonusPerBullet: number;
  /** Number of paid places — the boundary for the "did I cash" check. */
  paidCount: number;
  /** Vose's alias method: O(1) finish-place sampling in the hot loop.
   *  `aliasProb[i]` is the acceptance threshold for index i; when the
   *  fractional part of a scaled uniform is above it, we take `aliasIdx[i]`
   *  instead. Built in O(N) once per compiled entry. */
  aliasProb: Float64Array;
  aliasIdx: Int32Array;
  prizeByPlace: Float64Array;
  alpha: number;
  /** Σ pmf[i] over paid places — exact ITM for this entry. */
  itm: number;
  /**
   * Per-place bounty EV. For a row with bountyFraction > 0, bounties are
   * distributed across finish places using the elimination-order model:
   * E[elims | place p] = H_{N−1} − H_{p−1}, where H_k is the k-th harmonic
   * number. Deep finishers collect most bounties; early busts collect zero.
   * The per-entry mean is normalized against the calibrated pmf so overall
   * EV is unchanged — only variance shifts into the tails.
   *
   * null when bountyFraction === 0 (skip the array read entirely).
   */
  bountyByPlace: Float64Array | null;
  /**
   * Mystery-bounty log-space variance σ² per KO. When > 0 the realized
   * bounty haul is multiplied by a log-normal draw with mean 1 and log-
   * variance σ²/k (Fenton–Wilkinson aggregate-of-k-lognormals approx),
   * so each KO independently rolls a possibly-huge or possibly-tiny $
   * value. Mean preserved, only variance added. 0 means flat bounties.
   */
  mysteryBountyLogVar: number;
  mysteryBountyLogSigma: number;
  /** Precomputed `exp(mysteryBountyLogVar) − 1`. Used by the Fenton–Wilkinson
   *  scaling inside the hot loop — hoisted here to save one `Math.exp` call
   *  per KO draw. Zero when `mysteryBountyLogVar` is zero (mystery bounty off).
   */
  mysteryBountyExpMinus1: number;
  /**
   * Expected number of knockouts by finish place. Used by the hot loop to
   * add within-place stochastic noise to the bounty haul: at a fixed place
   * the realized KO count is Poisson around `bountyKmean[place]`, and the
   * realized bounty payout equals `bountyByPlace[place] × K / kmean`. K is
   * drawn via inline Knuth multiplication for λ < 30 and PTRS (Hörmann 1993)
   * for λ ≥ 30 — see `poissonPTRS` in simNumerics and the hot-loop branch.
   * Mean is preserved exactly; the per-tournament within-place variance is
   * real (not zero as in the original scalar-per-place bounty formulation).
   * Shares null with bountyByPlace.
   */
  bountyKmean: Float64Array | null;
  /** Precomputed exp(−bountyKmean[i]) for the Knuth Poisson path. Saves one
   *  `Math.exp` per tourney in bounty rows. Zero where bountyKmean is zero. */
  bountyKmeanExp: Float64Array | null;
  /** Precomputed 1/bountyKmean[i] for the bounty normalization. Replaces the
   *  per-tourney divide with a multiply. Zero where bountyKmean is zero. */
  bountyKmeanInv: Float64Array | null;
  /**
   * Analytical per-tourney σ from the calibrated pmf — √(E[X²]−E[X]²) on
   * prize + bounty. Cheap, compile-time, and independent of the MC run;
   * used to cross-check MC σ in diagnostics.
   */
  sigmaSingleAnalytic: number;
  /**
   * Analytical per-bullet E[prize + bounty] from the calibrated pmf. Should
   * equal `singleCost · (1 + row.roi)` to within float tolerance for any
   * calibrated model; realdata-* models return the reference-shape mean and
   * may diverge. Exposed so regression tests can assert the ROI contract
   * without running Monte Carlo.
   */
  analyticMeanSingle: number;
  /**
   * PKO latent-heat bounty bank. When non-null, length is HEAT_BIN_COUNT
   * and each entry is an alternative `bountyByPlace` curve built by
   * raising the raw PKO weights to `1 + pkoHeat · z_b`, then re-normalized
   * against the (unchanged) calibrated pmf so each bin's mean bounty
   * equals the original `bountyMean`. Null → legacy PKO path.
   */
  heatBountyByPlace: Float64Array[] | null;
  /**
   * GG Mystery Battle Royale discrete envelope tier tables. When non-null,
   * replaces the per-KO log-normal draw with a 10-tier Vose alias sample.
   * Ratios are pre-normalised to E[ratio] = 1 under `brTierAliasProb`, so
   * pool-accounting EV is preserved — only the shape of the KO-bounty
   * variance changes (jackpot tier ≈ 10000× buy-in at freq 4e-7, etc).
   * Null for every row except `payoutStructure === "battle-royale"`.
   */
  brTierRatios: Float64Array | null;
  brTierAliasProb: Float64Array | null;
  brTierAliasIdx: Int32Array | null;
  /** Explicit BR-format flag for runtime policy / side-channels. */
  isBattleRoyale: boolean;
  /** Share of this row's global promo budget routed into BR leaderboard. */
  battleRoyaleLeaderboardShare: number;
}

export interface BattleRoyaleLeaderboardMixRow {
  rowId: string;
  label: string;
  tournaments: number;
  directShare: number;
  leaderboardShare: number;
  directRakebackMean: number;
  leaderboardMeanTarget: number;
}

export interface CompiledSchedule {
  flat: CompiledEntry[];
  totalBuyIn: number;
  /** Deterministic profit target from the schedule ROI plus deterministic RB. */
  expectedProfit: number;
  expectedDirectRakeback: number;
  expectedBattleRoyaleSplitDirectRakeback: number;
  expectedLeaderboardPromo: number;
  tournamentsPerSample: number;
  /** flat.length / scheduleRepeats — used as session boundary in the hot loop. */
  tournamentsPerPass: number;
  rowCounts: number[];
  rowBuyIns: number[];
  rowLabels: string[];
  rowIds: string[];
  /** Weighted mean ITM over every entry in the flat schedule. */
  itmRate: number;
  battleRoyaleLeaderboardMix: BattleRoyaleLeaderboardMixRow[];
}

export interface ScheduleAnalyticRow {
  rowIdx: number;
  count: number;
  countShare: number;
  meanSingle: number;
  totalCost: number;
  costShare: number;
  varianceDollar: number;
  sigmaDollar: number;
  fieldAvg: number;
  fieldMin: number;
  fieldMax: number;
}

export interface ScheduleAnalyticBreakdown {
  perRow: ScheduleAnalyticRow[];
  sigmaRoiPerTourney: number;
  sigmaRoiPerPass: number;
  totalCost: number;
  tournamentsPerPass: number;
}

export interface RawShard {
  sStart: number;
  sEnd: number;
  finalProfits: Float64Array;
  pathMatrix: Float64Array;
  maxDrawdowns: Float64Array;
  /** Per-sample max upswing: max(profit − runningMin). Mirror of maxDrawdowns
   *  used to surface top-N upswings alongside top-N downswings. */
  maxRunUps: Float64Array;
  runningMins: Float64Array;
  longestBreakevens: Float64Array;
  /** Per-sample mean first-forward-return chord length, in tournament units.
   *  For each checkpoint ii, scan forward for the first jj>ii where the
   *  segment [jj-1, jj] crosses Y[ii]; record (jj-ii); average across all
   *  starting points that had a return. Zero for samples with no returns
   *  (monotone paths). This is the "any streak between two equal-Y points"
   *  metric — the dual of longestBreakevens (max chord per sample). */
  breakevenStreakAvgs: Float64Array;
  longestCashless: Int32Array;
  recoveryLengths: Int32Array;
  /** Per-length histograms. `breakevenStreakCounts` counts one entry
   *  per starting point per sample at the grid-unit length of that
   *  point's longest horizontal chord (index in [0, K], scale by N/K
   *  for tournament units). Chord-grid units avoid alias peaks from
   *  uneven round(gridPos * N/K) quantization. `cashlessStreakCounts`
   *  counts EVERY cashless streak across every sample, indexed by
   *  length in tournaments; length N + 1. Merged additively across
   *  shards. */
  breakevenStreakCounts: Int32Array;
  cashlessStreakCounts: Int32Array;
  rowProfits: Float64Array;
  /** Bounty-only contribution per (sample, row), parallel-allocated to
   *  `rowProfits`. Accumulates only the `bountyDraw` part of each delta;
   *  zero entries for rows without bounty configuration. Used by the
   *  decomposition chart to split the mean bar into cash vs. bounty. */
  rowBountyProfits: Float64Array;
  /** Per-sample 0/1 flag: 1 if any single bounty-bearing tournament in
   *  this sample had its summed per-KO envelope ratios reach
   *  JACKPOT_THRESHOLD. Catches both single-tier jackpots (one ratio
   *  ≥ threshold) and compound jackpots (many moderate tiers adding up
   *  within one tournament). Observational side-effect of existing
   *  bounty draws (no extra RNG), so it preserves the seed→result
   *  determinism contract. Empty (length 0) for schedules without
   *  mystery rows — callers must null-check. */
  jackpotMask: Uint8Array;
  /** Optional Battle Royale leaderboard side-channel. Null when the run has
   *  no leaderboard config or no BR rows. */
  leaderboardPoints: Float64Array | null;
  leaderboardPayouts: Float64Array | null;
  leaderboardExpectedPayouts: Float64Array | null;
  leaderboardWindows: Int32Array | null;
  leaderboardPaidWindows: Int32Array | null;
  leaderboardRankSums: Int32Array | null;
  leaderboardKnockouts: Int32Array | null;
  leaderboardFirsts: Int32Array | null;
  leaderboardSeconds: Int32Array | null;
  leaderboardThirds: Int32Array | null;
  ruinedCount: number;
  /** Hi-res capture grid (K'+1 points). Shared across all hi-res buffers
   *  in this shard. */
  hiResCheckpointIdx: Int32Array;
  /** Per-sample hi-res paths for the first `wantHiResPaths` samples of
   *  this shard. */
  hiResPaths: Float64Array[];
  /** Global sample ids parallel to `hiResPaths`, used by UI filters that need
   *  to map visible paths back to per-sample result arrays. */
  hiResSampleIndices: Int32Array;
  /** Snapshot of the shard-local best-final-profit sample path. */
  hiResBestPath: Float64Array;
  hiResWorstPath: Float64Array;
  /** Final profit of the shard's best/worst sample (used to pick globally
   *  across multi-shard merges). ±Infinity for empty shards. */
  hiResBestFinal: number;
  hiResWorstFinal: number;
  /** Pointwise min/max across every sample in this shard, on the hi-res
   *  checkpoint grid. Merged across shards via pointwise min/max. */
  hiResMin: Float64Array;
  hiResMax: Float64Array;
}

export interface CheckpointGrid {
  K: number;
  checkpointIdx: Int32Array;
}
