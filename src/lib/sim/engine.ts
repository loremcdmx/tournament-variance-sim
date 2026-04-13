import { getPayoutTable } from "./payouts";
import {
  buildCDF,
  buildFinishPMF,
  buildUniformLiftPMF,
  calibrateAlpha,
  itmProbability,
  sampleFromCDF,
} from "./finishModel";
import { applyICMToPayoutTable } from "./icm";
import { mulberry32, mixSeed } from "./rng";
import type {
  CalibrationMode,
  RowDecomposition,
  SimulationInput,
  SimulationResult,
  TournamentRow,
} from "./types";

interface CompiledEntry {
  rowIdx: number;
  /**
   * When this slot corresponds to a row with fieldVariability, variants holds
   * the full bucket set. The hot loop picks one uniformly per sample, so field
   * size actually contributes variance instead of being compile-time smoothed.
   * For rows without variability this is undefined (fast path).
   */
  variants?: CompiledEntry[];
  /** Amortized cost per slot: singleCost × (1 + reentryExpected). Used only
   *  for totalBuyIn reporting / per-row accounting. */
  costPerEntry: number;
  /** Cost of a single bullet (buy-in + rake, no re-entry scaling). The hot
   *  loop charges this per fired bullet. */
  singleCost: number;
  /** Cap on bullets fired per slot. 1 for freezeouts. */
  maxEntries: number;
  /** Probability of firing the next bullet after a non-cash bust. */
  reRate: number;
  /** Number of paid places — the boundary for "did I cash" checks during
   *  re-entry rolls. */
  paidCount: number;
  cdf: Float64Array;
  prizeByPlace: Float64Array;
  alpha: number;
  /** Σ pmf[i] over paid places — exact ITM for this entry. */
  itm: number;
  /**
   * Expected extra re-entries per seat. For a geometric re-entry process
   * with cap `maxEntries` and retry rate `p`, the expected number of
   * *additional* entries is Σ_{k=1..cap-1} p^k = p(1−p^(cap−1))/(1−p)
   * for p<1, else cap−1. Used for amortized cost reporting only.
   */
  reentryExpected: number;
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
}

interface CompiledSchedule {
  flat: CompiledEntry[];
  totalBuyIn: number;
  tournamentsPerSample: number;
  rowCounts: number[];
  rowBuyIns: number[];
  rowLabels: string[];
  rowIds: string[];
  /** Weighted mean ITM over every entry in the flat schedule. */
  itmRate: number;
}

export function compileSchedule(
  input: SimulationInput,
  calibrationMode: CalibrationMode = "alpha",
): CompiledSchedule {
  const rowCounts = new Array<number>(input.schedule.length).fill(0);
  const rowBuyIns = new Array<number>(input.schedule.length).fill(0);
  const rowLabels = input.schedule.map((r, i) => r.label || `Row ${i + 1}`);
  const rowIds = input.schedule.map((r) => r.id);

  // For each row, compile one or more variants depending on fieldVariability.
  // variants[r] is an array of { entry, weight } — weight is # of plays per
  // unit `count` consumed from this row.
  const variants: { entry: CompiledEntry; share: number }[][] =
    input.schedule.map((row, idx) =>
      compileRowVariants(row, idx, input.finishModel, calibrationMode),
    );

  const flat: CompiledEntry[] = [];
  let totalBuyIn = 0;
  let itmAcc = 0;
  // Build one "slot entry" per row. For rows with a single bucket this is
  // the compiled entry itself. For rows with fieldVariability it's a copy
  // of the first variant with .variants populated — the hot loop rolls a
  // variant per sample, so field size genuinely drives variance.
  const slotEntries: CompiledEntry[] = input.schedule.map((_, r) => {
    const rv = variants[r];
    if (rv.length === 1) return rv[0].entry;
    const first = rv[0].entry;
    const variantList = rv.map((v) => v.entry);
    // Parent's bookkeeping fields (costPerEntry equal across variants; itm
    // is the mean over variants so totalBuyIn/itmRate reporting is correct
    // in expectation).
    const meanItm =
      variantList.reduce((a, v) => a + v.itm, 0) / variantList.length;
    return {
      ...first,
      itm: meanItm,
      variants: variantList,
    };
  });

  for (let rep = 0; rep < input.scheduleRepeats; rep++) {
    for (let r = 0; r < input.schedule.length; r++) {
      const row = input.schedule[r];
      const entry = slotEntries[r];
      const n = Math.max(1, Math.floor(row.count));
      for (let k = 0; k < n; k++) {
        flat.push(entry);
        totalBuyIn += entry.costPerEntry;
        itmAcc += entry.itm;
        rowCounts[r] += 1;
        rowBuyIns[r] += entry.costPerEntry;
      }
    }
  }

  return {
    flat,
    totalBuyIn,
    tournamentsPerSample: flat.length,
    rowCounts,
    rowBuyIns,
    rowLabels,
    rowIds,
    itmRate: flat.length > 0 ? itmAcc / flat.length : 0,
  };
}

function compileSingleEntry(
  row: TournamentRow,
  idx: number,
  players: number,
  model: SimulationInput["finishModel"],
  calibrationMode: CalibrationMode,
): CompiledEntry {
  const N = Math.max(1, Math.floor(players));

  // ---- re-entry accounting ------------------------------------------------
  // Expected number of *extra* entries per seat (beyond the first) under
  // geometric re-entry with cap (maxEntries-1). Contributes to cost and to
  // prize pool (every re-entry pays rake and buy-in too).
  const maxEntries = Math.max(1, Math.floor(row.maxEntries ?? 1));
  const reRate = Math.max(0, Math.min(1, row.reentryRate ?? (maxEntries > 1 ? 1 : 0)));
  let reentryExpected = 0;
  if (maxEntries > 1 && reRate > 0) {
    if (reRate === 1) {
      reentryExpected = maxEntries - 1;
    } else {
      // Σ_{k=1}^{M-1} p^k = p(1 − p^(M−1)) / (1 − p)
      const M = maxEntries - 1;
      reentryExpected = (reRate * (1 - Math.pow(reRate, M))) / (1 - reRate);
    }
  }
  const entryCostSingle = row.buyIn * (1 + row.rake);
  const costPerEntry = entryCostSingle * (1 + reentryExpected);
  // Field-average extra entries inflate the prize pool too.
  const effectiveSeats = players * (1 + reentryExpected);
  const basePool = effectiveSeats * row.buyIn;
  const overlay = Math.max(0, (row.guarantee ?? 0) - basePool);
  let prizePool = basePool + overlay;

  // ---- bounty split -------------------------------------------------------
  // Knockouts: `bountyFraction` of the buy-in (not rake) is carried as
  // bounty. The regular prize pool shrinks by the same fraction. Each
  // entry's expected bounty haul is roughly the per-seat bounty (every
  // player starts with ~1 bounty on their head and collects ~1 in expectation
  // over the whole field by symmetry, but the sim-relevant quantity is the
  // skill-adjusted collected bounties). We fold a *lifted* expected bounty
  // into bountyEV so skilled players collect more than 1 bounty on average.
  const bountyFraction = Math.max(0, Math.min(0.9, row.bountyFraction ?? 0));
  let bountyMean = 0;
  if (bountyFraction > 0) {
    const bountyPerSeat = row.buyIn * bountyFraction;
    // Skill lift on bounty collection — proportional to row.roi. A +20 %
    // ROI player grabs +20 % bounties too. Capped at 3× for sanity.
    const bountyLift = Math.max(0.1, Math.min(3, 1 + row.roi));
    bountyMean = bountyPerSeat * bountyLift;
    // Shrink the regular pool by the bounty share.
    prizePool = prizePool * (1 - bountyFraction);
  }

  // ---- raw payout curve --------------------------------------------------
  let payouts = getPayoutTable(row.payoutStructure, N, row.customPayouts);

  // ---- ICM final-table reweight ------------------------------------------
  if (row.icmFinalTable) {
    const ftSize = Math.max(2, Math.floor(row.icmFinalTableSize ?? 9));
    payouts = applyICMToPayoutTable(payouts, ftSize, 0.4);
  }

  const paidCount = payouts.reduce((n, p) => (p > 0 ? n + 1 : n), 0);

  // ---- finish distribution -----------------------------------------------
  let pmf: Float64Array;
  let alpha = 0;
  // The player's expected total winnings target is `cost × (1+ROI)`. A
  // bounty lump contributes bountyEV directly; the regular prize pool must
  // therefore hit `targetTotal − bountyEV` on its own. We translate that
  // back into an "effective ROI" target to feed the existing calibrator.
  // Target is defined PER BULLET: the pmf shapes one bullet's prize
  // distribution. A player fires K bullets stochastically, each costs
  // `entryCostSingle`, each samples independently from this pmf.
  //   E[profit per slot] = E[K] × (E[prize per bullet] + E[bounty per bullet] − singleCost)
  // For overall ROI = row.roi on TOTAL money spent (= E[K] × singleCost):
  //   E[prize per bullet] + E[bounty per bullet] − singleCost = singleCost × ROI
  //   → E[prize per bullet] = singleCost × (1 + ROI) − bountyMean
  const targetRegular = Math.max(0.01, entryCostSingle * (1 + row.roi) - bountyMean);
  const effectiveROI = targetRegular / entryCostSingle - 1;
  if (calibrationMode === "primedope-uniform-lift") {
    pmf = buildUniformLiftPMF(N, paidCount, targetRegular, prizePool);
  } else {
    alpha = calibrateAlpha(
      N,
      payouts,
      prizePool,
      entryCostSingle,
      effectiveROI,
      model,
    );
    pmf = buildFinishPMF(N, model, alpha);
  }
  const cdf = buildCDF(pmf);

  const prizeByPlace = new Float64Array(N);
  for (let i = 0; i < Math.min(payouts.length, N); i++) {
    prizeByPlace[i] = payouts[i] * prizePool;
  }

  // ---- bounty distribution across finish places -------------------------
  // Elimination-order model: the player finishing at 1-indexed place p was
  // alive for the first N−p busts. Expected eliminations over those busts
  // equals H_{N−1} − H_{p−1}, using the "each alive non-buster is equally
  // likely" assumption. The winner (p=1) collects H_{N−1} elims; the first
  // to bust (p=N) collects 0. Total sums to N−1, which matches the number
  // of eliminations per tournament.
  //
  // We then normalize the raw weights against the calibrated pmf so that
  // Σ pmf[i] · bountyByPlace[i] === bountyMean. This preserves the ROI
  // calibration (mean bounty per entry is unchanged) while shifting all
  // the bounty variance onto the shape of the finish distribution.
  let bountyByPlace: Float64Array | null = null;
  if (bountyMean > 0 && N >= 2) {
    // Prefix harmonic numbers: Hprefix[k] = 1 + 1/2 + ... + 1/k, Hprefix[0] = 0.
    const Hprefix = new Float64Array(N);
    let hAcc = 0;
    for (let k = 1; k < N; k++) {
      hAcc += 1 / k;
      Hprefix[k] = hAcc;
    }
    const totalH = Hprefix[N - 1]; // H_{N−1}
    // Raw weights w[i] (0-indexed place): totalH − Hprefix[i].
    const raw = new Float64Array(N);
    let Z = 0;
    for (let i = 0; i < N; i++) {
      const w = totalH - Hprefix[i];
      raw[i] = w;
      Z += pmf[i] * w;
    }
    bountyByPlace = new Float64Array(N);
    if (Z > 1e-12) {
      const scale = bountyMean / Z;
      for (let i = 0; i < N; i++) {
        bountyByPlace[i] = raw[i] * scale;
      }
    } else {
      // Degenerate: fall back to flat lump so we don't break mean EV.
      for (let i = 0; i < N; i++) bountyByPlace[i] = bountyMean;
    }
  }

  return {
    rowIdx: idx,
    costPerEntry,
    singleCost: entryCostSingle,
    maxEntries,
    reRate,
    paidCount,
    cdf,
    prizeByPlace,
    alpha,
    itm: itmProbability(pmf, paidCount),
    reentryExpected,
    bountyByPlace,
  };
}

function compileRowVariants(
  row: TournamentRow,
  idx: number,
  model: SimulationInput["finishModel"],
  calibrationMode: CalibrationMode,
): { entry: CompiledEntry; share: number }[] {
  const fv = row.fieldVariability;
  if (!fv || fv.kind === "fixed") {
    return [
      {
        entry: compileSingleEntry(row, idx, row.players, model, calibrationMode),
        share: 1,
      },
    ];
  }
  const buckets = Math.max(1, Math.floor(fv.buckets ?? 5));
  const lo = Math.max(2, Math.floor(Math.min(fv.min, fv.max)));
  const hi = Math.max(lo, Math.floor(Math.max(fv.min, fv.max)));
  if (buckets === 1 || lo === hi) {
    const mid = Math.round((lo + hi) / 2);
    return [
      {
        entry: compileSingleEntry(row, idx, mid, model, calibrationMode),
        share: 1,
      },
    ];
  }
  const variants: { entry: CompiledEntry; share: number }[] = [];
  const share = 1 / buckets;
  for (let b = 0; b < buckets; b++) {
    // Midpoints of evenly-spaced sub-intervals over [lo, hi].
    const t = (b + 0.5) / buckets;
    const players = Math.round(lo + t * (hi - lo));
    variants.push({
      entry: compileSingleEntry(row, idx, players, model, calibrationMode),
      share,
    });
  }
  return variants;
}

type ProgressCb = (done: number, total: number) => void;

/**
 * Polar Box-Muller: maps two uniform draws to a standard normal. We burn
 * at most a couple of extra rng() calls per sample for the rejection —
 * negligible vs. the inner tournament loop.
 */
function boxMuller(rng: () => number): number {
  let u = 0;
  let v = 0;
  let s = 0;
  do {
    u = rng() * 2 - 1;
    v = rng() * 2 - 1;
    s = u * u + v * v;
  } while (s === 0 || s >= 1);
  return u * Math.sqrt((-2 * Math.log(s)) / s);
}

export function runSimulation(
  input: SimulationInput,
  onProgress?: ProgressCb,
): SimulationResult {
  const calibrationMode: CalibrationMode =
    input.calibrationMode ?? "alpha";

  // Twin run for side-by-side: same seed, same schedule, only the finish
  // distribution differs. Primary = α-calibration, comparison = uniform lift.
  if (input.compareWithPrimedope && !input.calibrationMode) {
    const half: ProgressCb | undefined = onProgress
      ? (done, total) => onProgress(done, total * 2)
      : undefined;
    const primary = runSimulation(
      { ...input, calibrationMode: "alpha", compareWithPrimedope: false },
      half,
    );
    const secondHalf: ProgressCb | undefined = onProgress
      ? (done, total) => onProgress(total + done, total * 2)
      : undefined;
    const comparison = runSimulation(
      {
        ...input,
        calibrationMode: "primedope-uniform-lift",
        compareWithPrimedope: false,
      },
      secondHalf,
    );
    return { ...primary, comparison };
  }

  const compiled = compileSchedule(input, calibrationMode);
  const N = compiled.tournamentsPerSample;
  const S = input.samples;
  const bankroll = input.bankroll;
  const numRows = input.schedule.length;

  if (N === 0 || S === 0) throw new Error("Empty schedule or zero samples");

  const K = Math.min(200, N);
  const checkpointIdx = new Int32Array(K + 1);
  for (let j = 0; j <= K; j++) checkpointIdx[j] = Math.round((j * N) / K);

  // Storage -----------------------------------------------------------------
  const finalProfits = new Float64Array(S);
  const pathMatrix = new Float64Array(S * (K + 1));
  const maxDrawdowns = new Float64Array(S);
  const runningMins = new Float64Array(S); // for min-BR inverse
  const longestBreakevens = new Int32Array(S);
  // Per-row × per-sample profit matrix (row-major: sample * numRows + row)
  const rowProfits = new Float64Array(S * numRows);

  let ruinedCount = 0;
  let expectedProfitAccum = 0;

  const nextProgressStep = Math.max(1, Math.floor(S / 50));
  let nextProgressAt = nextProgressStep;

  // Skill uncertainty: per-sample ROI shift, applied linearly to the
  // running cumulative cost. Decoupled RNG stream so changing the
  // σ does not reshuffle the finish-place samples.
  const roiStdErr = Math.max(0, input.roiStdErr ?? 0);
  const skillRng = mulberry32(mixSeed(input.seed, 0xbeef));
  const flat = compiled.flat;

  for (let s = 0; s < S; s++) {
    const rng = mulberry32(mixSeed(input.seed, s));
    const deltaROI = roiStdErr > 0 ? boxMuller(skillRng) * roiStdErr : 0;
    let profit = 0;
    let runningMax = 0;
    let runningMin = 0;
    let maxDD = 0;
    let breakevenLen = 0;
    let longestBreakeven = 0;
    let ruined = false;

    let nextCp = 1;
    let nextCpIdx = checkpointIdx[1];
    const pathBase = s * (K + 1);
    const rowBase = s * numRows;

    for (let i = 0; i < N; i++) {
      const parent = flat[i];
      const variants = parent.variants;
      const t = variants
        ? variants[(rng() * variants.length) | 0]
        : parent;
      const bp = t.bountyByPlace;
      const prizes = t.prizeByPlace;
      const cdf = t.cdf;
      const single = t.singleCost;
      const bulletCost = single - deltaROI * single;
      const maxB = t.maxEntries;
      let delta = 0;
      if (maxB === 1) {
        const place = sampleFromCDF(cdf, rng());
        delta = prizes[place] + (bp !== null ? bp[place] : 0) - bulletCost;
      } else {
        const pc = t.paidCount;
        const reRate = t.reRate;
        for (let b = 0; b < maxB; b++) {
          const place = sampleFromCDF(cdf, rng());
          delta += prizes[place] + (bp !== null ? bp[place] : 0) - bulletCost;
          if (place < pc) break;
          if (b + 1 < maxB && rng() >= reRate) break;
        }
      }
      profit += delta;
      rowProfits[rowBase + t.rowIdx] += delta;

      if (profit > runningMax) {
        runningMax = profit;
        breakevenLen = 0;
      } else {
        breakevenLen++;
        if (breakevenLen > longestBreakeven) longestBreakeven = breakevenLen;
      }
      if (profit < runningMin) runningMin = profit;
      const dd = runningMax - profit;
      if (dd > maxDD) maxDD = dd;

      if (bankroll > 0 && !ruined && profit <= -bankroll) ruined = true;

      while (nextCp <= K && i + 1 === nextCpIdx) {
        pathMatrix[pathBase + nextCp] = profit;
        nextCp++;
        if (nextCp <= K) nextCpIdx = checkpointIdx[nextCp];
      }
    }

    finalProfits[s] = profit;
    maxDrawdowns[s] = maxDD;
    runningMins[s] = runningMin;
    longestBreakevens[s] = longestBreakeven;
    if (ruined) ruinedCount++;
    expectedProfitAccum += profit;

    if (onProgress && s + 1 >= nextProgressAt) {
      onProgress(s + 1, S);
      nextProgressAt += nextProgressStep;
    }
  }
  onProgress?.(S, S);

  // Stats -------------------------------------------------------------------
  const mean = expectedProfitAccum / S;
  const sorted = Float64Array.from(finalProfits).sort();
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

  // Higher moments: skewness (m3/σ³) and excess kurtosis (m4/σ⁴ − 3).
  // Use population divisor S — we want descriptive moments of the sample,
  // not an unbiased estimator of the underlying distribution.
  let m3 = 0;
  let m4 = 0;
  if (stdDev > 0) {
    for (let s = 0; s < S; s++) {
      const z = (finalProfits[s] - mean) / stdDev;
      const z2 = z * z;
      m3 += z2 * z;
      m4 += z2 * z2;
    }
    m3 /= S;
    m4 /= S;
  }
  const skewness = m3;
  const kurtosis = m4 > 0 ? m4 - 3 : 0;

  // Kelly: f* ≈ μ / σ² for continuous outcomes. Only meaningful if +EV.
  // We report the fraction and the implied bankroll = totalBuyIn / f*.
  const variance = stdDev * stdDev;
  const kellyFraction =
    mean > 0 && variance > 0 ? mean / variance : 0;
  const kellyBankroll =
    kellyFraction > 0 ? compiled.totalBuyIn / kellyFraction : Infinity;

  // Expected log-growth — the thing Kelly actually maximises. Only valid
  // when the user has a bankroll. Ruin samples clamp to ln(1e-9) ≈ −20.7
  // so they dominate only enough to punish over-betting, not annihilate
  // the mean.
  let logGrowthRate = 0;
  if (bankroll > 0) {
    let acc = 0;
    for (let s = 0; s < S; s++) {
      const ratio = 1 + finalProfits[s] / bankroll;
      acc += ratio > 1e-9 ? Math.log(ratio) : Math.log(1e-9);
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

  // Minimum bankroll for historical RoR ≤ threshold.
  // For each sample, "ruin" at bankroll B <=> runningMin <= -B.
  // Sort −runningMin ascending → the 1 − ε quantile gives B such that ε
  // of samples go below.
  const worstLosses = Float64Array.from(runningMins)
    .map((v) => -v)
    .sort();
  const minBankrollRoR1pct = worstLosses[Math.floor(0.99 * (S - 1))];
  const minBankrollRoR5pct = worstLosses[Math.floor(0.95 * (S - 1))];

  // Histograms --------------------------------------------------------------
  const histogram = histogramOf(finalProfits, 60);
  const drawdownHistogram = histogramOf(maxDrawdowns, 50, true);

  // Envelopes ---------------------------------------------------------------
  const K1 = K + 1;
  const x: number[] = new Array(K1);
  for (let j = 0; j < K1; j++) x[j] = checkpointIdx[j];

  const mean_ = new Float64Array(K1);
  const p15 = new Float64Array(K1);
  const p85 = new Float64Array(K1);
  const p025 = new Float64Array(K1);
  const p975 = new Float64Array(K1);
  const p0015 = new Float64Array(K1);
  const p9985 = new Float64Array(K1);

  const col = new Float64Array(S);
  for (let j = 0; j < K1; j++) {
    let acc = 0;
    for (let s = 0; s < S; s++) {
      const v = pathMatrix[s * K1 + j];
      col[s] = v;
      acc += v;
    }
    mean_[j] = acc / S;
    col.sort();
    p15[j] = col[Math.floor(0.15 * (S - 1))];
    p85[j] = col[Math.floor(0.85 * (S - 1))];
    p025[j] = col[Math.floor(0.025 * (S - 1))];
    p975[j] = col[Math.floor(0.975 * (S - 1))];
    p0015[j] = col[Math.floor(0.0015 * (S - 1))];
    p9985[j] = col[Math.floor(0.9985 * (S - 1))];
  }

  // Sample paths ------------------------------------------------------------
  const wantPaths = Math.min(20, S);
  const chosen: number[] = [];
  const rngPick = mulberry32(mixSeed(input.seed, 0xabcdef));
  const picked = new Set<number>();
  while (chosen.length < wantPaths) {
    const idx = Math.floor(rngPick() * S);
    if (!picked.has(idx)) {
      picked.add(idx);
      chosen.push(idx);
    }
  }
  const paths = chosen.map((idx) =>
    pathMatrix.slice(idx * K1, idx * K1 + K1),
  );

  let bestIdx = 0;
  let worstIdx = 0;
  for (let s = 1; s < S; s++) {
    if (finalProfits[s] > finalProfits[bestIdx]) bestIdx = s;
    if (finalProfits[s] < finalProfits[worstIdx]) worstIdx = s;
  }
  const best = pathMatrix.slice(bestIdx * K1, bestIdx * K1 + K1);
  const worst = pathMatrix.slice(worstIdx * K1, worstIdx * K1 + K1);

  // Drawdown + breakeven
  let ddMean = 0;
  let ddWorst = 0;
  for (let s = 0; s < S; s++) {
    ddMean += maxDrawdowns[s];
    if (maxDrawdowns[s] > ddWorst) ddWorst = maxDrawdowns[s];
  }
  ddMean /= S;

  let beMean = 0;
  for (let s = 0; s < S; s++) beMean += longestBreakevens[s];
  beMean /= S;

  // Decomposition -----------------------------------------------------------
  const decomposition: RowDecomposition[] = new Array(numRows);
  const rowMeans = new Float64Array(numRows);
  for (let r = 0; r < numRows; r++) {
    let acc = 0;
    for (let s = 0; s < S; s++) acc += rowProfits[s * numRows + r];
    rowMeans[r] = acc / S;
  }
  const rowVariances = new Float64Array(numRows);
  for (let r = 0; r < numRows; r++) {
    let va = 0;
    for (let s = 0; s < S; s++) {
      const d = rowProfits[s * numRows + r] - rowMeans[r];
      va += d * d;
    }
    rowVariances[r] = va / Math.max(1, S - 1);
  }
  const totalRowVarSum = rowVariances.reduce((a, b) => a + b, 0) || 1;
  for (let r = 0; r < numRows; r++) {
    decomposition[r] = {
      rowId: compiled.rowIds[r],
      label: compiled.rowLabels[r],
      mean: rowMeans[r],
      stdDev: Math.sqrt(rowVariances[r]),
      varianceShare: rowVariances[r] / totalRowVarSum,
      tournamentsPerSample: compiled.rowCounts[r],
      totalBuyIn: compiled.rowBuyIns[r],
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

  // Downswing catalog -------------------------------------------------------
  // Top-10 samples by max drawdown depth.
  const ddIdx: number[] = new Array(S);
  for (let i = 0; i < S; i++) ddIdx[i] = i;
  ddIdx.sort((a, b) => maxDrawdowns[b] - maxDrawdowns[a]);
  const downswings = ddIdx.slice(0, Math.min(10, S)).map((sampleIndex, i) => ({
    rank: i + 1,
    sampleIndex,
    depth: maxDrawdowns[sampleIndex],
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
      const varr = Math.max(0, cumSqSum / n - m * m);
      const se = Math.sqrt(varr / n);
      convMean[idxConv] = m;
      convSeLo[idxConv] = m - 1.96 * se;
      convSeHi[idxConv] = m + 1.96 * se;
      idxConv++;
    }
  }

  return {
    type: "result",
    samples: S,
    tournamentsPerSample: N,
    totalBuyIn: compiled.totalBuyIn,
    expectedProfit: mean,
    calibrationMode,
    finalProfits,
    histogram,
    drawdownHistogram,
    samplePaths: { x, paths, best, worst, sampleIndices: chosen },
    envelopes: { x, mean: mean_, p15, p85, p025, p975, p0015, p9985 },
    decomposition,
    sensitivity: { deltas: sensDeltas, expectedProfits: sensProfits },
    downswings,
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
      longestBreakevenMean: beMean,
      var95,
      var99,
      cvar95,
      cvar99,
      sharpe,
      sortino,
      tournamentsFor95ROI,
      minBankrollRoR1pct,
      minBankrollRoR5pct,
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
    },
  };
}

function countProfits(arr: Float64Array): number {
  let n = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] > 0) n++;
  return n;
}

function histogramOf(
  arr: Float64Array,
  bins: number,
  nonNegative = false,
): { binEdges: number[]; counts: number[] } {
  const n = arr.length;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (nonNegative) lo = 0;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi === lo) {
    hi = lo + 1;
  }
  const span = hi - lo;
  const binEdges: number[] = new Array(bins + 1);
  for (let i = 0; i <= bins; i++) binEdges[i] = lo + (span * i) / bins;
  const counts: number[] = new Array(bins).fill(0);
  for (let i = 0; i < n; i++) {
    let b = Math.floor(((arr[i] - lo) / span) * bins);
    if (b < 0) b = 0;
    else if (b >= bins) b = bins - 1;
    counts[b]++;
  }
  return { binEdges, counts };
}
