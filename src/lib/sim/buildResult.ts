/**
 * Result assembly. `buildResult` post-processes a merged `RawShard` into the
 * `SimulationResult` the UI consumes — percentile envelopes, downswing
 * catalog, row decomposition, risk-of-ruin integration, convergence curves.
 * No RNG, no calibration; pure aggregation of the hot-loop output.
 *
 * The per-section work lives in `resultStats.ts`, `resultEnvelopes.ts`,
 * `resultStreaks.ts`, `resultDecomposition.ts`, `resultCurves.ts` and
 * `resultLeaderboard.ts`; this module sequences them and stitches the
 * pieces into the final object.
 */
import { buildBattleRoyalePromoResult } from "./battleRoyaleLeaderboardObserved";
import type {
  BuildProgressCb,
  CheckpointGrid,
  CompiledSchedule,
  RawShard,
} from "./engineTypes";
import { buildRowDecomposition } from "./resultDecomposition";
import { buildConvergence, buildSensitivity } from "./resultCurves";
import { buildEnvelopes } from "./resultEnvelopes";
import { buildLeaderboardResult } from "./resultLeaderboard";
import { computeScalarStats } from "./resultStats";
import { buildSwingCatalog, computeStreakStats } from "./resultStreaks";
import { histogramFromCounts, histogramOf } from "./simNumerics";
import type {
  CalibrationMode,
  SimulationInput,
  SimulationResult,
} from "./types";

export type { BuildStage } from "./engineTypes";

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
    ruinedCount,
  } = shard;

  const stats = computeScalarStats(
    finalProfits,
    runningMins,
    S,
    N,
    bankroll,
    compiled.totalBuyIn,
    onBuildProgress,
  );

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

  // Percentile sorts run on the low-res K grid (cheap). The final envelopes
  // are upsampled to the hi-res grid so they line up with the sample paths
  // on a single uPlot x-axis.
  const hiCheckpointIdx = shard.hiResCheckpointIdx;
  const envelopes = buildEnvelopes(
    pathMatrix,
    S,
    K + 1,
    checkpointIdx,
    hiCheckpointIdx,
    onBuildProgress,
  );

  // Sample paths ------------------------------------------------------------
  // Hi-res capture was populated during simulateShard: each shard stores a
  // capped slice of its local samples, and mergeShards preserves their global
  // sample ids beside the path buffers. This replaces the old low-res
  // pathMatrix slicing which produced smooth diagonals at K=80 checkpoints.
  const xHi: number[] = new Array(hiCheckpointIdx.length);
  for (let j = 0; j < hiCheckpointIdx.length; j++) xHi[j] = hiCheckpointIdx[j];
  const paths = shard.hiResPaths;
  const best = shard.hiResBestPath;
  const worst = shard.hiResWorstPath;
  const chosen: number[] = Array.from(shard.hiResSampleIndices);

  const streaks = computeStreakStats(
    maxDrawdowns,
    longestBreakevens,
    breakevenStreakAvgs,
    longestCashless,
    recoveryLengths,
    S,
    onBuildProgress,
  );

  const decomposition = buildRowDecomposition(
    rowProfits,
    rowBountyProfits,
    S,
    numRows,
    compiled,
  );

  const sensitivity = buildSensitivity(stats.mean, compiled.totalBuyIn);

  const { downswings, upswings } = buildSwingCatalog(
    maxDrawdowns,
    shard.maxRunUps,
    finalProfits,
    longestBreakevens,
    S,
    onBuildProgress,
  );

  const convergence = buildConvergence(finalProfits, S, onBuildProgress);

  const battleRoyaleLeaderboard = buildLeaderboardResult(
    input,
    compiled,
    shard,
    S,
  );
  const battleRoyaleLeaderboardPromo = buildBattleRoyalePromoResult({
    config: input.battleRoyaleLeaderboardPromo,
    schedule: input.schedule,
    rowCounts: compiled.rowCounts,
    rowBuyIns: compiled.rowBuyIns,
    activeDays: input.scheduleRepeats,
  });

  return {
    calibrationWarnings: compiled.calibrationWarnings,
    satelliteSeatsWon: shard.satelliteSeatsWon ?? undefined,
    type: "result",
    samples: S,
    tournamentsPerSample: N,
    totalBuyIn: compiled.totalBuyIn,
    expectedProfit: compiled.expectedProfit,
    calibrationMode,
    finalProfits,
    rowProfits,
    jackpotMask: shard.jackpotMask,
    neverBustedMask: stats.neverBustedMask,
    histogram,
    drawdownHistogram,
    longestBreakevenHistogram,
    longestCashlessHistogram,
    recoveryHistogram: streaks.recoveryHistogram,
    samplePaths: { x: xHi, paths, best, worst, sampleIndices: chosen },
    envelopes: {
      x: xHi,
      mean: envelopes.mean,
      p05: envelopes.p05,
      p95: envelopes.p95,
      p15: envelopes.p15,
      p85: envelopes.p85,
      p025: envelopes.p025,
      p975: envelopes.p975,
      p0015: envelopes.p0015,
      p9985: envelopes.p9985,
      min: shard.hiResMin,
      max: shard.hiResMax,
    },
    decomposition,
    sensitivity,
    battleRoyaleLeaderboard,
    battleRoyaleLeaderboardPromo,
    downswings,
    upswings,
    convergence,
    stats: {
      mean: stats.mean,
      median: stats.median,
      stdDev: stats.stdDev,
      min: stats.min,
      max: stats.max,
      p01: stats.p01,
      p05: stats.p05,
      p95: stats.p95,
      p99: stats.p99,
      probProfit: stats.probProfit,
      riskOfRuin: bankroll > 0 ? ruinedCount / S : 0,
      maxDrawdownMean: streaks.ddMean,
      maxDrawdownWorst: streaks.ddWorst,
      maxDrawdownMedian: streaks.maxDrawdownMedian,
      maxDrawdownP95: streaks.maxDrawdownP95,
      maxDrawdownP99: streaks.maxDrawdownP99,
      recoveryMedian: streaks.recoveryMedian,
      recoveryP90: streaks.recoveryP90,
      recoveryUnrecoveredShare: streaks.recoveryUnrecoveredShare,
      longestCashlessMean: streaks.longestCashlessMean,
      longestCashlessWorst: streaks.cashlessWorst,
      longestBreakevenMean: streaks.beMean,
      breakevenStreakMean: streaks.beStreakMean,
      var95: stats.var95,
      var99: stats.var99,
      cvar95: stats.cvar95,
      cvar99: stats.cvar99,
      sharpe: stats.sharpe,
      sortino: stats.sortino,
      tournamentsFor95ROI: stats.tournamentsFor95ROI,
      minBankrollRoR1pct: stats.minBankrollRoR1pct,
      minBankrollRoR5pct: stats.minBankrollRoR5pct,
      minBankrollRoR15pct: stats.minBankrollRoR15pct,
      minBankrollRoR50pct: stats.minBankrollRoR50pct,
      minBankrollRoR1pctGaussian: stats.minBankrollRoR1pctGaussian,
      minBankrollRoR5pctGaussian: stats.minBankrollRoR5pctGaussian,
      riskOfRuinGaussian: stats.riskOfRuinGaussian,
      mcSeMean: stats.mcSeMean,
      mcSeStdDev: stats.mcSeStdDev,
      mcCi95HalfWidthMean: stats.mcCi95HalfWidthMean,
      mcRoiErrorPct: stats.mcRoiErrorPct,
      mcPrecisionScore: stats.mcPrecisionScore,
      mcSamplesFor1Pct: stats.mcSamplesFor1Pct,
      neverBelowZeroFrac: stats.neverBelowZeroFrac,
      probUpNeverBusted: stats.probUpNeverBusted,
      itmRate: compiled.itmRate,
      skewness: stats.skewness,
      kurtosis: stats.kurtosis,
      kellyFraction: stats.kellyFraction,
      kellyBankroll: stats.kellyBankroll,
      logGrowthRate: stats.logGrowthRate,
      maxDrawdownBuyIns:
        compiled.totalBuyIn > 0
          ? streaks.ddMean / (compiled.totalBuyIn / N)
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
      sigmaPerTournamentEmpirical: stats.sigmaPerTourn,
    },
  };
}
