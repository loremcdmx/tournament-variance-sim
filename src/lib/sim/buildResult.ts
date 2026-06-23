/**
 * Result assembly. `buildResult` post-processes a merged `RawShard` into the
 * `SimulationResult` the UI consumes — percentile envelopes, downswing
 * catalog, row decomposition, risk-of-ruin integration, convergence curves.
 * No RNG, no calibration; pure aggregation of the hot-loop output.
 */
import { normalizeBattleRoyaleLeaderboardConfig } from "./battleRoyaleLeaderboard";
import { buildBattleRoyalePromoResult } from "./battleRoyaleLeaderboardObserved";
import type {
  CheckpointGrid,
  CompiledSchedule,
  RawShard,
} from "./engineTypes";
import { upsampleToGrid } from "./grids";
import {
  countProfits,
  histogramFromCounts,
  histogramOf,
  normalCdf,
} from "./simNumerics";
import type {
  CalibrationMode,
  RowDecomposition,
  SimulationInput,
  SimulationResult,
} from "./types";

/**
 * Coarse phase label for the current emit. The four stages together cover
 * every emit site inside `buildResult` so the UI can tell a user which
 * phase is taking the wall-clock — envelope sorts and streak rankings
 * dominate on large S, stats/convergence are cheap.
 */
export type BuildStage = "stats" | "envelopes" | "streaks" | "convergence";
type BuildProgressCb = (frac: number, stage: BuildStage) => void;

/**
 * Aggregate a merged shard into a final SimulationResult. Separated from
 * runSimulation so the parallel orchestrator can run shards in workers
 * and call this on the merged result from the main thread.
 */
export function buildResult(
  input: SimulationInput,
  compiled: CompiledSchedule,
  shard: RawShard,
  calibrationMode: CalibrationMode,
  grid: CheckpointGrid,
  onBuildProgress?: BuildProgressCb,
): SimulationResult {
  const N = compiled.tournamentsPerSample;
  const S = input.samples;
  const bankroll = input.bankroll;
  const numRows = input.schedule.length;
  const { K, checkpointIdx } = grid;
  const {
    finalProfits,
    pathMatrix,
    maxDrawdowns,
    runningMins,
    longestBreakevens,
    breakevenStreakAvgs,
    longestCashless,
    recoveryLengths,
    rowProfits,
    rowBountyProfits,
    leaderboardPoints,
    leaderboardPayouts,
    leaderboardExpectedPayouts,
    leaderboardWindows,
    leaderboardPaidWindows,
    leaderboardRankSums,
    leaderboardKnockouts,
    leaderboardFirsts,
    leaderboardSeconds,
    leaderboardThirds,
    ruinedCount,
  } = shard;
  onBuildProgress?.(0.02, "stats");
  let expectedProfitAccum = 0;
  for (let s = 0; s < S; s++) expectedProfitAccum += finalProfits[s];

  // Stats -------------------------------------------------------------------
  const mean = expectedProfitAccum / S;
  // Direct typed-array memcpy: .slice() on a Float64Array is a single
  // memcpy, .from() iterates and boxes. Same for other sorted copies below.
  const sorted = finalProfits.slice().sort();
  onBuildProgress?.(0.10, "stats");
  const pct = (p: number) =>
    sorted[Math.min(S - 1, Math.max(0, Math.floor(p * (S - 1))))];
  const median = pct(0.5);
  const min = sorted[0];
  const max = sorted[S - 1];
  const p01 = pct(0.01);
  const p05 = pct(0.05);
  const p95 = pct(0.95);
  const p99 = pct(0.99);

  let varAcc = 0;
  let downVarAcc = 0;
  let downCount = 0;
  for (let s = 0; s < S; s++) {
    const d = finalProfits[s] - mean;
    varAcc += d * d;
    if (finalProfits[s] < 0) {
      downVarAcc += d * d;
      downCount++;
    }
  }
  const stdDev = Math.sqrt(varAcc / Math.max(1, S - 1));
  const downSigma = Math.sqrt(downVarAcc / Math.max(1, downCount - 1));

  // Higher moments: bias-corrected sample skewness (G1) and excess kurtosis
  // (G2) per standard formulas. Population moments under-estimate both for
  // the skewed MTT distribution; these are the same estimators Excel,
  // numpy.scipy.stats and R use by default.
  //   G1 = [S/((S−1)(S−2))] · Σ z_i³
  //   G2 = [S(S+1)/((S−1)(S−2)(S−3))] · Σ z_i⁴ − 3(S−1)²/((S−2)(S−3))
  // where z_i = (x_i − mean)/stdDev and stdDev is the sample SD (already
  // computed above with the S−1 divisor).
  let sumZ3 = 0;
  let sumZ4 = 0;
  if (stdDev > 0) {
    for (let s = 0; s < S; s++) {
      const z = (finalProfits[s] - mean) / stdDev;
      const z2 = z * z;
      sumZ3 += z2 * z;
      sumZ4 += z2 * z2;
    }
  }
  let skewness = 0;
  let kurtosis = 0;
  if (stdDev > 0 && S >= 3) {
    skewness = (S / ((S - 1) * (S - 2))) * sumZ3;
  }
  if (stdDev > 0 && S >= 4) {
    const a = (S * (S + 1)) / ((S - 1) * (S - 2) * (S - 3));
    const b = (3 * (S - 1) * (S - 1)) / ((S - 2) * (S - 3));
    kurtosis = a * sumZ4 - b;
  }

  // Kelly: f* ≈ μ / σ² for continuous outcomes. Only meaningful if +EV.
  // We report the fraction and the implied bankroll = totalBuyIn / f*.
  const variance = stdDev * stdDev;
  const kellyFraction =
    mean > 0 && variance > 0 ? mean / variance : 0;
  const kellyBankroll =
    kellyFraction > 0 ? compiled.totalBuyIn / kellyFraction : Infinity;

  // Expected log-growth — the thing Kelly actually maximises. Only valid
  // when the user has a bankroll. Winsorize ruin samples at ln(0.01) ≈ −4.6
  // instead of ln(1e-9) ≈ −20.7: the old floor collapsed the entire ruin
  // tail to a single value, killing variance structure where it matters most
  // for bankroll sizing. A 99% loss still strongly penalises over-betting.
  const LOG_RUIN_FLOOR = Math.log(0.01);
  let logGrowthRate = 0;
  if (bankroll > 0) {
    let acc = 0;
    for (let s = 0; s < S; s++) {
      const ratio = 1 + finalProfits[s] / bankroll;
      acc += ratio > 0.01 ? Math.log(ratio) : LOG_RUIN_FLOOR;
    }
    logGrowthRate = acc / S;
  }

  const sharpe = stdDev > 0 ? mean / stdDev : 0;
  const sortino = downSigma > 0 ? mean / downSigma : 0;

  const profitCount = countProfits(finalProfits);
  const probProfit = profitCount / S;

  // VaR/CVaR at 95 / 99 — positive numbers (losses)
  const var95 = -pct(0.05);
  const var99 = -pct(0.01);
  let cvar95Acc = 0;
  let cvar95N = 0;
  let cvar99Acc = 0;
  let cvar99N = 0;
  const q95 = pct(0.05);
  const q99 = pct(0.01);
  for (let s = 0; s < S; s++) {
    const v = finalProfits[s];
    if (v <= q95) {
      cvar95Acc += v;
      cvar95N++;
    }
    if (v <= q99) {
      cvar99Acc += v;
      cvar99N++;
    }
  }
  const cvar95 = cvar95N > 0 ? -cvar95Acc / cvar95N : 0;
  const cvar99 = cvar99N > 0 ? -cvar99Acc / cvar99N : 0;

  // Rough time-to-significance: how many tournaments before 1.96 × σ_single
  // is under 5 % of cost_per_tournament.
  const costPer = compiled.totalBuyIn / N;
  const sigmaPerTourn = stdDev / Math.sqrt(Math.max(1, N));
  const tournamentsFor95ROI =
    costPer > 0 && sigmaPerTourn > 0
      ? Math.ceil(Math.pow((1.96 * sigmaPerTourn) / (0.05 * costPer), 2))
      : 0;

  // Monte Carlo precision readouts -----------------------------------------
  const mcSeMean = S > 0 ? stdDev / Math.sqrt(S) : 0;
  const mcSeStdDev = S > 1 ? stdDev / Math.sqrt(2 * (S - 1)) : 0;
  const mcCi95HalfWidthMean = 1.96 * mcSeMean;
  const mcRoiErrorPct =
    Math.abs(mean) > 1e-6
      ? Math.abs(mcCi95HalfWidthMean / mean)
      : Number.POSITIVE_INFINITY;
  const mcPrecisionScore =
    mcRoiErrorPct < 0.01 ? 1 : mcRoiErrorPct < 0.05 ? 0.5 : 0;
  // Projected S for ≤1 % relative MC error on mean: solve (1.96·σ/√S)/μ = 0.01
  //   → S = (1.96·σ / (0.01·μ))²
  const mcSamplesFor1Pct =
    mean > 1e-6 && stdDev > 0
      ? Math.ceil(Math.pow((1.96 * stdDev) / (0.01 * mean), 2))
      : Number.POSITIVE_INFINITY;

  // Gaussian analytic RoR — PrimeDope-compatible readout ------------------
  // Per-tourney mean/σ from total-horizon stats. First-passage of Brownian
  // motion with drift: P(ruin by N | B) = Φ((−B−μ·N)/(σ·√N)) +
  // exp(−2μ·B/σ²) · Φ((−B+μ·N)/(σ·√N)). Invert numerically by bisection.
  const muPerTourn = N > 0 ? mean / N : 0;
  const sigmaPerTournRuin = N > 0 ? stdDev / Math.sqrt(N) : 0;
  const gaussianRuinProb = (B: number): number => {
    if (B <= 0) return 1;
    if (sigmaPerTournRuin <= 0 || N <= 0) return muPerTourn >= 0 ? 0 : 1;
    const sqrtN = Math.sqrt(N);
    const denom = sigmaPerTournRuin * sqrtN;
    const a = (-B - muPerTourn * N) / denom;
    const b = (-B + muPerTourn * N) / denom;
    const var1 = sigmaPerTournRuin * sigmaPerTournRuin;
    const expArg = (-2 * muPerTourn * B) / var1;
    // expArg blows up only under strongly unfavorable drift (μ≪0), where the
    // infinite-horizon ruin probability equals 1; short-circuit to avoid
    // Infinity·Φ(b) → NaN.
    if (expArg > 700) return 1;
    const p = normalCdf(a) + Math.exp(expArg) * normalCdf(b);
    return Math.min(1, Math.max(0, p));
  };
  const solveGaussianBankroll = (alpha: number): number => {
    if (sigmaPerTournRuin <= 0) return 0;
    // Bracket: 0 → ruin prob = 1. Upper bound: scale with σ√N × 10.
    let lo = 0;
    let hi = Math.max(100, stdDev * 10);
    // Expand hi until ruin prob drops below alpha.
    for (let k = 0; k < 20 && gaussianRuinProb(hi) > alpha; k++) hi *= 2;
    for (let k = 0; k < 64; k++) {
      const mid = 0.5 * (lo + hi);
      if (gaussianRuinProb(mid) > alpha) lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  };
  const minBankrollRoR1pctGaussian = solveGaussianBankroll(0.01);
  const minBankrollRoR5pctGaussian = solveGaussianBankroll(0.05);
  const riskOfRuinGaussian =
    bankroll > 0 ? gaussianRuinProb(bankroll) : 0;

  // Minimum bankroll for historical RoR ≤ threshold.
  // For each sample, "ruin" at bankroll B <=> runningMin <= -B.
  // Sort −runningMin ascending → the 1 − ε quantile gives B such that ε
  // of samples go below. Inline negate into a single allocation (was
  // .from().map().sort() — three passes, two intermediate buffers).
  const worstLosses = new Float64Array(S);
  for (let s = 0; s < S; s++) worstLosses[s] = -runningMins[s];
  worstLosses.sort();
  const minBankrollRoR1pct = worstLosses[Math.floor(0.99 * (S - 1))];
  const minBankrollRoR5pct = worstLosses[Math.floor(0.95 * (S - 1))];
  const minBankrollRoR15pct = worstLosses[Math.floor(0.85 * (S - 1))];
  const minBankrollRoR50pct = worstLosses[Math.floor(0.5 * (S - 1))];
  // "Runs that never dipped below 0" — fraction of samples whose running
  // minimum profit stayed non-negative over the entire schedule.
  let neverBelowZero = 0;
  for (let s = 0; s < S; s++) if (runningMins[s] >= 0) neverBelowZero++;
  const neverBelowZeroFrac = neverBelowZero / S;

  // Histograms --------------------------------------------------------------
  // longTailClip folds jackpot outliers into the last bin so the Mystery/BR
  // bulk stays readable — without it, a single $10k BI bounty stretches the
  // 60-bin range across 2+ orders of magnitude and crushes the core mass
  // into the first 2 bins. Raw extremes still available via stats.p99 etc.
  const histogram = histogramOf(finalProfits, 60, false, true);
  // Drawdowns are non-negative by construction, so lo auto-ranges from the
  // real observed minimum instead of being pinned to 0 (which wasted leading
  // bins when every sample had dd ≥ some floor like 50 BI).
  const drawdownHistogram = histogramOf(maxDrawdowns, 50, false, true);
  // Streak histograms — distribution of max drawdown / longest cashless /
  // longest breakeven / recovery length across samples. Int32Array → Float64
  // copy is cheap. Recovery uses recovered-only (unrecovered share is
  // reported separately in stats).
  // Cashless histogram counts EVERY cashless streak across every sample —
  // answers "how often do streaks of a given length occur". The breakeven
  // histogram answers the same question for "playing for nothing" chords:
  // for every time point in every run we measure the longest horizontal
  // chord starting there and bucket it by length. That gives a
  // decay-right shape (short chords outnumber long ones) rather than the
  // extreme-value distribution of per-sample max chords. Breakeven counts
  // are indexed by chord-grid position (0..K), not by tournament count —
  // integer bin widths kill alias peaks. We scale binEdges back to
  // tournament units on the way out.
  const longestBreakevenHistogram = histogramFromCounts(
    shard.breakevenStreakCounts,
    60,
    N / K,
  );
  const longestCashlessHistogram = histogramFromCounts(
    shard.cashlessStreakCounts,
    60,
  );
  onBuildProgress?.(0.18, "stats");

  // Envelopes ---------------------------------------------------------------
  // Percentile sorts run on the low-res K=80 grid (cheap). The final
  // envelopes are upsampled to the hi-res grid below so they line up with
  // the sample paths on a single uPlot x-axis.
  const K1 = K + 1;

  const mean_ = new Float64Array(K1);
  const envP05 = new Float64Array(K1);
  const envP95 = new Float64Array(K1);
  const p15 = new Float64Array(K1);
  const p85 = new Float64Array(K1);
  const p025 = new Float64Array(K1);
  const p975 = new Float64Array(K1);
  const p0015 = new Float64Array(K1);
  const p9985 = new Float64Array(K1);

  // Envelope percentiles: sorting K1 full columns of a 1M-sample run is
  // ≈80 × O(S log S) ≈ 1.6 B ops — freezes the worker at 99% for tens of
  // seconds. Subsample uniformly for the quantile computation (mean still
  // runs on the full S, which is just an additive loop and cheap).
  // Accuracy at the reported percentiles: p0015 / p9985 need ≥ 1 / (1-p)
  // samples minimum, so we cap at ≥ 20k; 50k keeps all six percentiles
  // within ~0.3 σ of the exact answer and runs in ~200 ms total.
  const ENV_CAP = 200_000;
  const envS = Math.min(S, ENV_CAP);
  const envStride = S / envS;
  const col = new Float64Array(envS);
  // Emit build-progress every ~8 columns so the main thread sees steady
  // motion through the dominant build phase (envelope sorts are ~65 % of
  // buildResult wall time for large S).
  const envEmitStride = Math.max(1, Math.floor(K1 / 10));
  for (let j = 0; j < K1; j++) {
    // Mean on the full S (cheap accumulator, no sort needed).
    let acc = 0;
    for (let s = 0; s < S; s++) acc += pathMatrix[s * K1 + j];
    mean_[j] = acc / S;
    // Percentiles on a stratified subsample of size envS.
    for (let s = 0; s < envS; s++) {
      const src = Math.min(S - 1, (s * envStride) | 0);
      col[s] = pathMatrix[src * K1 + j];
    }
    col.sort();
    envP05[j] = col[Math.floor(0.05 * (envS - 1))];
    envP95[j] = col[Math.floor(0.95 * (envS - 1))];
    p15[j] = col[Math.floor(0.15 * (envS - 1))];
    p85[j] = col[Math.floor(0.85 * (envS - 1))];
    p025[j] = col[Math.floor(0.025 * (envS - 1))];
    p975[j] = col[Math.floor(0.975 * (envS - 1))];
    p0015[j] = col[Math.floor(0.0015 * (envS - 1))];
    p9985[j] = col[Math.floor(0.9985 * (envS - 1))];
    if (onBuildProgress && j > 0 && j % envEmitStride === 0) {
      onBuildProgress(0.10 + 0.70 * ((j + 1) / K1), "envelopes");
    }
  }
  onBuildProgress?.(0.82, "envelopes");

  // Sample paths ------------------------------------------------------------
  // Hi-res capture was populated during simulateShard: each shard stores a
  // capped slice of its local samples, and mergeShards preserves their global
  // sample ids beside the path buffers. This replaces the old low-res
  // pathMatrix slicing which produced smooth diagonals at K=80 checkpoints.
  const hiCheckpointIdx = shard.hiResCheckpointIdx;
  const xHi: number[] = new Array(hiCheckpointIdx.length);
  for (let j = 0; j < hiCheckpointIdx.length; j++) xHi[j] = hiCheckpointIdx[j];
  const paths = shard.hiResPaths;
  const best = shard.hiResBestPath;
  const worst = shard.hiResWorstPath;
  const chosen: number[] = Array.from(shard.hiResSampleIndices);

  // Drawdown + breakeven
  let ddMean = 0;
  let ddWorst = 0;
  for (let s = 0; s < S; s++) {
    ddMean += maxDrawdowns[s];
    if (maxDrawdowns[s] > ddWorst) ddWorst = maxDrawdowns[s];
  }
  ddMean /= S;

  // Tail quantiles of max drawdown — a straight answer to
  // "how bad is a typical/5%/1% worst run". PrimeDope only shows a single
  // aggregate estimate; we expose the whole tail shape.
  onBuildProgress?.(0.83, "streaks");
  const ddSorted = maxDrawdowns.slice().sort();
  onBuildProgress?.(0.85, "streaks");
  const ddPct = (p: number) =>
    ddSorted[Math.min(S - 1, Math.max(0, Math.floor(p * (S - 1))))];
  const maxDrawdownMedian = ddPct(0.5);
  const maxDrawdownP95 = ddPct(0.95);
  const maxDrawdownP99 = ddPct(0.99);

  let beMean = 0;
  for (let s = 0; s < S; s++) beMean += longestBreakevens[s];
  beMean /= S;

  // Mean "any streak" length per sample: average of breakevenStreakAvgs
  // over samples that had at least one forward return. Samples with no
  // returns (monotone paths) contribute 0; we still divide by S so the
  // aggregate has the same semantics as beMean.
  let beStreakMean = 0;
  for (let s = 0; s < S; s++) beStreakMean += breakevenStreakAvgs[s];
  beStreakMean /= S;

  // Cashless streak stats
  let cashlessAcc = 0;
  let cashlessWorst = 0;
  for (let s = 0; s < S; s++) {
    const v = longestCashless[s];
    cashlessAcc += v;
    if (v > cashlessWorst) cashlessWorst = v;
  }
  const longestCashlessMean = cashlessAcc / S;

  // Recovery from deepest drawdown: -1 entries are "unrecovered" — we
  // compute median / p90 over the recovered-only slice, and report the
  // unrecovered share separately.
  let unrecoveredCount = 0;
  const recoveredOnly: number[] = [];
  for (let s = 0; s < S; s++) {
    const v = recoveryLengths[s];
    if (v < 0) unrecoveredCount++;
    else recoveredOnly.push(v);
  }
  recoveredOnly.sort((a, b) => a - b);
  const recoveredCount = recoveredOnly.length;
  const recoveryPct = (p: number) =>
    recoveredCount === 0
      ? 0
      : recoveredOnly[
          Math.min(
            recoveredCount - 1,
            Math.max(0, Math.floor(p * (recoveredCount - 1))),
          )
        ];
  const recoveryMedian = recoveryPct(0.5);
  const recoveryP90 = recoveryPct(0.9);
  const recoveryUnrecoveredShare = unrecoveredCount / S;
  const recoveredF = new Float64Array(recoveredOnly.length);
  for (let i = 0; i < recoveredOnly.length; i++) recoveredF[i] = recoveredOnly[i];
  const recoveryHistogram =
    recoveredF.length > 0
      ? histogramOf(recoveredF, 40, true, true)
      : { binEdges: [0, 1], counts: [0] };

  // Decomposition -----------------------------------------------------------
  // Single sequential pass over rowProfits (row-major by sample): accumulate
  // ΣX and ΣX² per row, then compute mean/variance via E[X²]−E[X]². Replaces
  // two stride-numRows column scans, better cache behavior for numRows>2.
  const decomposition: RowDecomposition[] = new Array(numRows);
  const rowMeans = new Float64Array(numRows);
  const rowVariances = new Float64Array(numRows);
  const rowSumSq = new Float64Array(numRows);
  const rowBountySums = new Float64Array(numRows);
  for (let s = 0; s < S; s++) {
    const base = s * numRows;
    for (let r = 0; r < numRows; r++) {
      const v = rowProfits[base + r];
      rowMeans[r] += v;
      rowSumSq[r] += v * v;
      rowBountySums[r] += rowBountyProfits[base + r];
    }
  }
  for (let r = 0; r < numRows; r++) {
    const m = rowMeans[r] / S;
    rowMeans[r] = m;
    // Sample variance: (ΣX² − S·m²) / (S−1). Clamp at 0 for the all-equal
    // degenerate case where floating-point cancellation can dip negative.
    rowVariances[r] =
      S > 1 ? Math.max(0, (rowSumSq[r] - S * m * m) / (S - 1)) : 0;
  }
  const totalRowVarSum = rowVariances.reduce((a, b) => a + b, 0) || 1;
  for (let r = 0; r < numRows; r++) {
    // Per-row Kelly: f* = mean / variance on the row's slot distribution.
    // Only meaningful when the row has positive EV and non-zero variance;
    // otherwise Kelly is undefined (we emit 0 / Infinity respectively).
    const rv = rowVariances[r];
    const rm = rowMeans[r];
    const rowKellyFraction = rm > 0 && rv > 1e-9 ? rm / rv : 0;
    const rowKellyBankroll =
      rowKellyFraction > 0
        ? compiled.rowBuyIns[r] / rowKellyFraction
        : Number.POSITIVE_INFINITY;
    decomposition[r] = {
      rowId: compiled.rowIds[r],
      label: compiled.rowLabels[r],
      mean: rm,
      stdDev: Math.sqrt(rv),
      varianceShare: rv / totalRowVarSum,
      bountyMean: rowBountySums[r] / S,
      tournamentsPerSample: compiled.rowCounts[r],
      totalBuyIn: compiled.rowBuyIns[r],
      kellyFraction: rowKellyFraction,
      kellyBankroll: rowKellyBankroll,
    };
  }

  // Sensitivity analysis ----------------------------------------------------
  // ΔROI linear scan: realized profit ≈ mean + ΔROI × totalBuyIn
  // (under α-calibration the expectation is truly linear in ROI because
  // the PMF shape is held constant — we just rescale expected winnings).
  // At extreme Δ we clamp against the absolute pool floor so the line
  // stays interpretable.
  const sensDeltas = [-0.2, -0.1, -0.05, -0.025, 0, 0.025, 0.05, 0.1, 0.2];
  const sensProfits = sensDeltas.map(
    (d) => mean + d * compiled.totalBuyIn,
  );

  // Downswing / upswing catalog --------------------------------------------
  // Top-3 samples by max drawdown depth (downswings) and by max run-up height
  // (upswings). Previously we showed the top-10 downswings, but the tail
  // samples clustered very tightly — rank 8-10 differ by a few bucks and add
  // noise without new information. Top-3 keeps the spread meaningful and
  // leaves room for a symmetric upswings table next to it.
  const maxRunUps = shard.maxRunUps;
  const ddIdx: number[] = new Array(S);
  const upIdx: number[] = new Array(S);
  for (let i = 0; i < S; i++) {
    ddIdx[i] = i;
    upIdx[i] = i;
  }
  onBuildProgress?.(0.88, "streaks");
  ddIdx.sort((a, b) => maxDrawdowns[b] - maxDrawdowns[a]);
  onBuildProgress?.(0.93, "streaks");
  upIdx.sort((a, b) => maxRunUps[b] - maxRunUps[a]);
  onBuildProgress?.(0.97, "streaks");
  const downswings = ddIdx.slice(0, Math.min(3, S)).map((sampleIndex, i) => ({
    rank: i + 1,
    sampleIndex,
    depth: maxDrawdowns[sampleIndex],
    finalProfit: finalProfits[sampleIndex],
    longestBreakeven: longestBreakevens[sampleIndex],
  }));
  const upswings = upIdx.slice(0, Math.min(3, S)).map((sampleIndex, i) => ({
    rank: i + 1,
    sampleIndex,
    height: maxRunUps[sampleIndex],
    finalProfit: finalProfits[sampleIndex],
    longestBreakeven: longestBreakevens[sampleIndex],
  }));

  // Convergence curve -------------------------------------------------------
  // Compute running mean and 1.96 SE vs sample count in log-spaced buckets.
  const convPoints = Math.min(80, S);
  const convX: number[] = new Array(convPoints);
  for (let j = 0; j < convPoints; j++) {
    const frac = (j + 1) / convPoints;
    convX[j] = Math.max(1, Math.floor(S * frac));
  }
  const convMean = new Float64Array(convPoints);
  const convSeLo = new Float64Array(convPoints);
  const convSeHi = new Float64Array(convPoints);
  let cumSum = 0;
  let cumSqSum = 0;
  let idxConv = 0;
  for (let s = 0; s < S; s++) {
    const v = finalProfits[s];
    cumSum += v;
    cumSqSum += v * v;
    if (idxConv < convPoints && s + 1 === convX[idxConv]) {
      const n = s + 1;
      const m = cumSum / n;
      // Population-moment estimator scaled to sample variance:
      //   s² = (Σx² − n·m²) / (n − 1)
      // SE of the running mean = s / √n. Using /n instead of /(n−1) shrinks
      // the band by √(n/(n−1)) — off by 15 % at n=4, <0.5 % at n=100.
      const sampleVar =
        n > 1 ? Math.max(0, cumSqSum - n * m * m) / (n - 1) : 0;
      const se = Math.sqrt(sampleVar / n);
      convMean[idxConv] = m;
      convSeLo[idxConv] = m - 1.96 * se;
      convSeHi[idxConv] = m + 1.96 * se;
      idxConv++;
    }
  }
  onBuildProgress?.(0.99, "convergence");

  const battleRoyaleLeaderboard =
    leaderboardPoints !== null &&
    leaderboardPayouts !== null &&
    leaderboardExpectedPayouts !== null &&
    leaderboardWindows !== null &&
    leaderboardPaidWindows !== null &&
    leaderboardRankSums !== null &&
    leaderboardKnockouts !== null &&
    leaderboardFirsts !== null &&
    leaderboardSeconds !== null &&
    leaderboardThirds !== null
      ? (() => {
          let pointsMeanAcc = 0;
          let windowsAcc = 0;
          let paidWindowsAcc = 0;
          let rankAcc = 0;
          let koAcc = 0;
          let firstAcc = 0;
          let secondAcc = 0;
          let thirdAcc = 0;
          for (let i = 0; i < S; i++) {
            pointsMeanAcc += leaderboardPoints[i];
            windowsAcc += leaderboardWindows[i];
            paidWindowsAcc += leaderboardPaidWindows[i];
            rankAcc += leaderboardRankSums[i];
            koAcc += leaderboardKnockouts[i];
            firstAcc += leaderboardFirsts[i];
            secondAcc += leaderboardSeconds[i];
            thirdAcc += leaderboardThirds[i];
          }
          const meanPoints = pointsMeanAcc / S;
          let rawMeanPayout = 0;
          for (let i = 0; i < S; i++) {
            rawMeanPayout += leaderboardExpectedPayouts[i];
          }
          rawMeanPayout /= S;
          const splitMode =
            !!input.battleRoyaleLeaderboard?.includedRowIds &&
            input.battleRoyaleLeaderboard.includedRowIds.length > 0;
          const targetMeanPayout = splitMode
            ? Math.max(0, compiled.expectedLeaderboardPromo)
            : rawMeanPayout;
          const payoutScale =
            rawMeanPayout > 0 ? targetMeanPayout / rawMeanPayout : 1;
          if (payoutScale !== 1) {
            for (let i = 0; i < S; i++) leaderboardPayouts[i] *= payoutScale;
          }
          let pointsVarAcc = 0;
          let payoutVarAcc = 0;
          for (let i = 0; i < S; i++) {
            const dp = leaderboardPoints[i] - meanPoints;
            pointsVarAcc += dp * dp;
          }
          const meanPayout = targetMeanPayout;
          for (let i = 0; i < S; i++) {
            const dy = leaderboardPayouts[i] - meanPayout;
            payoutVarAcc += dy * dy;
          }
          const payoutSorted = leaderboardPayouts.slice().sort();
          const payoutPct = (p: number) =>
            payoutSorted[Math.min(S - 1, Math.max(0, Math.floor(p * (S - 1))))];
          const leaderboardConfig = normalizeBattleRoyaleLeaderboardConfig(
            input.battleRoyaleLeaderboard,
          )!;
          return {
            points: leaderboardPoints,
            payouts: leaderboardPayouts,
            windows: leaderboardWindows,
            paidWindows: leaderboardPaidWindows,
            rankSums: leaderboardRankSums,
            knockouts: leaderboardKnockouts,
            firsts: leaderboardFirsts,
            seconds: leaderboardSeconds,
            thirds: leaderboardThirds,
            stats: {
              meanPoints,
              stdDevPoints: Math.sqrt(pointsVarAcc / Math.max(1, S - 1)),
              meanPayout,
              stdDevPayout: Math.sqrt(payoutVarAcc / Math.max(1, S - 1)),
              p95Payout: payoutPct(0.95),
              p99Payout: payoutPct(0.99),
              meanWindows: windowsAcc / S,
              meanPaidWindows: paidWindowsAcc / S,
              paidWindowShare:
                windowsAcc > 0 ? paidWindowsAcc / windowsAcc : 0,
              meanRank: windowsAcc > 0 ? rankAcc / windowsAcc : 0,
              meanKnockouts: koAcc / S,
              meanFirsts: firstAcc / S,
              meanSeconds: secondAcc / S,
              meanThirds: thirdAcc / S,
            },
            config: {
              participants: leaderboardConfig.participants,
              windowTournaments: leaderboardConfig.windowTournaments,
              awardPartialWindow: leaderboardConfig.awardPartialWindow,
              maxPaidRank: leaderboardConfig.maxPaidRank,
            },
            sourceMix: {
              directRakebackMean:
                compiled.expectedBattleRoyaleSplitDirectRakeback,
              leaderboardMeanTarget: targetMeanPayout,
              totalPromoMean:
                compiled.expectedBattleRoyaleSplitDirectRakeback +
                targetMeanPayout,
              rows: compiled.battleRoyaleLeaderboardMix,
            },
          };
        })()
      : undefined;
  const battleRoyaleLeaderboardPromo = buildBattleRoyalePromoResult({
    config: input.battleRoyaleLeaderboardPromo,
    schedule: input.schedule,
    rowCounts: compiled.rowCounts,
    rowBuyIns: compiled.rowBuyIns,
    activeDays: input.scheduleRepeats,
  });

  return {
    type: "result",
    samples: S,
    tournamentsPerSample: N,
    totalBuyIn: compiled.totalBuyIn,
    expectedProfit: compiled.expectedProfit,
    calibrationMode,
    finalProfits,
    rowProfits,
    jackpotMask: shard.jackpotMask,
    histogram,
    drawdownHistogram,
    longestBreakevenHistogram,
    longestCashlessHistogram,
    recoveryHistogram,
    samplePaths: { x: xHi, paths, best, worst, sampleIndices: chosen },
    envelopes: {
      x: xHi,
      mean: upsampleToGrid(mean_, checkpointIdx, hiCheckpointIdx),
      p05: upsampleToGrid(envP05, checkpointIdx, hiCheckpointIdx),
      p95: upsampleToGrid(envP95, checkpointIdx, hiCheckpointIdx),
      p15: upsampleToGrid(p15, checkpointIdx, hiCheckpointIdx),
      p85: upsampleToGrid(p85, checkpointIdx, hiCheckpointIdx),
      p025: upsampleToGrid(p025, checkpointIdx, hiCheckpointIdx),
      p975: upsampleToGrid(p975, checkpointIdx, hiCheckpointIdx),
      p0015: upsampleToGrid(p0015, checkpointIdx, hiCheckpointIdx),
      p9985: upsampleToGrid(p9985, checkpointIdx, hiCheckpointIdx),
      min: shard.hiResMin,
      max: shard.hiResMax,
    },
    decomposition,
    sensitivity: { deltas: sensDeltas, expectedProfits: sensProfits },
    battleRoyaleLeaderboard,
    battleRoyaleLeaderboardPromo,
    downswings,
    upswings,
    convergence: { x: convX, mean: convMean, seLo: convSeLo, seHi: convSeHi },
    stats: {
      mean,
      median,
      stdDev,
      min,
      max,
      p01,
      p05,
      p95,
      p99,
      probProfit,
      riskOfRuin: bankroll > 0 ? ruinedCount / S : 0,
      maxDrawdownMean: ddMean,
      maxDrawdownWorst: ddWorst,
      maxDrawdownMedian,
      maxDrawdownP95,
      maxDrawdownP99,
      recoveryMedian,
      recoveryP90,
      recoveryUnrecoveredShare,
      longestCashlessMean,
      longestCashlessWorst: cashlessWorst,
      longestBreakevenMean: beMean,
      breakevenStreakMean: beStreakMean,
      var95,
      var99,
      cvar95,
      cvar99,
      sharpe,
      sortino,
      tournamentsFor95ROI,
      minBankrollRoR1pct,
      minBankrollRoR5pct,
      minBankrollRoR15pct,
      minBankrollRoR50pct,
      minBankrollRoR1pctGaussian,
      minBankrollRoR5pctGaussian,
      riskOfRuinGaussian,
      mcSeMean,
      mcSeStdDev,
      mcCi95HalfWidthMean,
      mcRoiErrorPct,
      mcPrecisionScore,
      mcSamplesFor1Pct,
      neverBelowZeroFrac,
      itmRate: compiled.itmRate,
      skewness,
      kurtosis,
      kellyFraction,
      kellyBankroll,
      logGrowthRate,
      maxDrawdownBuyIns:
        compiled.totalBuyIn > 0
          ? ddMean / (compiled.totalBuyIn / N)
          : 0,
      sigmaPerTournamentAnalytic: (() => {
        // √( Σ σᵢ² / N ) — per-tourney σ assuming independent rows. Matches
        // how stdDev/√N is interpreted on the MC side.
        if (compiled.flat.length === 0) return 0;
        let acc = 0;
        for (const e of compiled.flat) {
          const s = e.sigmaSingleAnalytic;
          acc += s * s;
        }
        return Math.sqrt(acc / compiled.flat.length);
      })(),
      sigmaPerTournamentEmpirical: sigmaPerTourn,
    },
  };
}
