/**
 * Scalar result statistics: distribution moments, risk/reward ratios,
 * Monte-Carlo precision readouts and bankroll requirements over the
 * per-sample final profits. Owns the "stats" phase of the build progress.
 * Every accumulation loop here is order-sensitive — the determinism
 * contract is byte-identical output, not "close enough".
 */
import type { BuildProgressCb } from "./engineTypes";
import { countProfits, normalCdf } from "./simNumerics";

export function computeScalarStats(
  finalProfits: Float64Array,
  runningMins: Float64Array,
  S: number,
  N: number,
  bankroll: number,
  totalBuyIn: number,
  onBuildProgress?: BuildProgressCb,
) {
  onBuildProgress?.(0.02, "stats");
  let expectedProfitAccum = 0;
  for (let s = 0; s < S; s++) expectedProfitAccum += finalProfits[s];

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
  for (let s = 0; s < S; s++) {
    const d = finalProfits[s] - mean;
    varAcc += d * d;
    // Sortino downside deviation: shortfall below target 0, over ALL samples.
    if (finalProfits[s] < 0) downVarAcc += finalProfits[s] * finalProfits[s];
  }
  const stdDev = Math.sqrt(varAcc / Math.max(1, S - 1));
  // Textbook downside deviation √(Σ min(x,0)²/S) — upside contributes 0. (The
  // old code measured deviation from the MEAN over only the losing samples and
  // divided by their count, a nonstandard hybrid that inflates when μ>0.)
  const downSigma = Math.sqrt(downVarAcc / S);

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

  // Kelly (dollar P&L X over the schedule pass, mean μ, variance σ²). The
  // Kelly-optimal bankroll — the B for which staking this schedule once is
  // exactly log-optimal (argmax_λ E[ln(1+λX/B)] = 1) — is B* = σ²/μ. The
  // Kelly *fraction* is the share of B* that the stake represents:
  //   f* = totalBuyIn / B* = totalBuyIn·μ / σ²   (dimensionless).
  // (The old code used f* = μ/σ², which has units 1/$, and a bankroll of
  //  totalBuyIn/f* = totalBuyIn·σ²/μ — off by a factor of totalBuyIn.)
  // Only meaningful if +EV.
  const variance = stdDev * stdDev;
  const kellyBankroll =
    mean > 0 && variance > 0 ? variance / mean : Infinity;
  const kellyFraction =
    mean > 0 && variance > 0 ? totalBuyIn / kellyBankroll : 0;

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
  const costPer = totalBuyIn / N;
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
  // probProfit counts end-of-schedule profit even for runs that touched
  // −bankroll on the way (the hot loop flags ruin and keeps playing). This
  // is the stricter "finished up AND never busted" share; null without a
  // bankroll because "busted" is undefined there.
  let upNeverBusted = 0;
  const neverBustedMask = new Uint8Array(bankroll > 0 ? S : 0);
  if (bankroll > 0) {
    for (let s = 0; s < S; s++) {
      const neverBusted = runningMins[s] > -bankroll;
      if (neverBusted) neverBustedMask[s] = 1;
      if (finalProfits[s] > 0 && neverBusted) upNeverBusted++;
    }
  }
  const probUpNeverBusted = bankroll > 0 ? upNeverBusted / S : null;

  return {
    mean,
    median,
    stdDev,
    min,
    max,
    p01,
    p05,
    p95,
    p99,
    skewness,
    kurtosis,
    kellyBankroll,
    kellyFraction,
    logGrowthRate,
    sharpe,
    sortino,
    probProfit,
    var95,
    var99,
    cvar95,
    cvar99,
    sigmaPerTourn,
    tournamentsFor95ROI,
    mcSeMean,
    mcSeStdDev,
    mcCi95HalfWidthMean,
    mcRoiErrorPct,
    mcPrecisionScore,
    mcSamplesFor1Pct,
    minBankrollRoR1pctGaussian,
    minBankrollRoR5pctGaussian,
    riskOfRuinGaussian,
    minBankrollRoR1pct,
    minBankrollRoR5pct,
    minBankrollRoR15pct,
    minBankrollRoR50pct,
    neverBelowZeroFrac,
    probUpNeverBusted,
    neverBustedMask,
  };
}
