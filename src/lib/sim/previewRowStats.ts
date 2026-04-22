import {
  applyBountyBias,
  buildFinishPMF,
  calibrateAlpha,
  calibrateShelledItm,
  isAlphaAdjustable,
} from "@/lib/sim/finishModel";
import {
  clampBountyMean,
  isBattleRoyaleRow,
} from "@/lib/sim/bountySplit";
import {
  buildBattleRoyaleCashTargetPmf,
  resolveBattleRoyaleCashTarget,
} from "@/lib/sim/battleRoyaleWinnerFirst";
import { makeBrTierSampler } from "@/lib/sim/brBountyTiers";
import { inferGameType } from "@/lib/sim/gameType";
import { getPayoutTable } from "@/lib/sim/payouts";
import { derivePreviewRowEconomics } from "@/lib/sim/previewRowEconomics";
import type { FinishModelConfig, TournamentRow } from "@/lib/sim/types";

export type TierKey =
  | "winner"
  | "top3"
  | "ft"
  | "ftNonCash"
  | "top27"
  | "restItm"
  | "firstMincash"
  | "bubble"
  | "ootm";

export type TierLabelKey =
  | "preview.tierWinner"
  | "preview.tierTop3"
  | "preview.tierFt"
  | "preview.tierFtNonCash"
  | "preview.tierTop27"
  | "preview.tierRestItm"
  | "preview.probFirstCash"
  | "preview.probBubble"
  | "preview.tierOotm";

export interface TierRow {
  key: TierKey;
  labelKey: TierLabelKey;
  color: string;
  /** Dollar EV contributed by places in this tier (gross, cash + bounty). */
  ev: number;
  /** Cash-pool slice of `ev` — Σ pmf[i]·prizeByPlace[i] for places in tier. */
  cashEv: number;
  /** Bounty-pool slice of `ev` — Σ pmf[i]·bountyByPlace[i] for places in tier.
   *  For freezeouts this is 0; for PKO/Mystery/BR it's the chunk of this
   *  tier's EV that comes from busting opponents rather than seat equity. */
  bountyEv: number;
  /** Expected cash prize GIVEN a finish in this tier (conditional mean). */
  cashGivenFinish: number;
  /** Expected bounty dollars GIVEN a finish in this tier. */
  bountyGivenFinish: number;
  /** Expected number of opponents busted GIVEN a finish in this tier,
   *  under uniform-skill harmonic expectation E[busts | place p] =
   *  H(N-1) − H(p-1). Weighted by pmf across the tier's place range.
   *  For non-bounty formats this is still meaningful but less interesting. */
  bustsGivenFinish: number;
  /** Average size of one bounty collected in this tier (bounty$ / busts).
   *  Captures progressive-PKO head-growth up the ladder: a deep finisher
   *  collects fewer but bigger heads than someone busting early. */
  bountySizePerBust: number;
  /** Skill-calibrated share of finishes in this tier (Σ pmf). */
  field: number;
  /** Equilibrium (uniform 1/N) share — the "zero-skill" baseline. */
  eqShare: number;
  /** Net dollar contribution to ROI per entry: ev − field × entryCost.
   *  Sums across disjoint tiers to evPerEntry − entryCost = net profit. */
  netDollars: number;
  /** Same calc but at zero-skill equilibrium (uniform 1/N PMF). Sum
   *  across all disjoint tiers equals −rake per entry, since at random
   *  play the expected return is exactly the prize pool divided by
   *  players, and entryCost = buyIn × (1 + rake). */
  eqNetDollars: number;
  /** Seat count used in the label suffix. For cumulative-label tiers
   *  (winner, top0.1%, top0.5%, top1%, top5%, top10%, final table) this
   *  is `hi` — the cumulative top cut the label refers to. For disjoint
   *  tiers (rest-ITM, first min-cash, bubble, OOTM) it's the band width. */
  displaySeats: number;
  /** 1-indexed start of position range (inclusive). */
  posLo: number;
  /** 1-indexed end of position range (inclusive). */
  posHi: number;
}


export interface RowStats {
  alpha: number;
  cost: number;
  itm: number;
  evPerEntry: number;
  payoutStd: number;
  cv: number;
  /** Gross cash-pool EV per entry — sum over places of pmf·prizeByPlace.
   *  For freezeouts this equals evPerEntry; for bounty formats it's the
   *  finish-only portion. */
  cashEvPerEntry: number;
  /** Gross bounty EV per entry — sum over places of pmf·bountyByPlace. */
  bountyEvPerEntry: number;
  /** Portion of bountyEvPerEntry coming from per-KO draws with ratio ≥
   *  JACKPOT_THRESHOLD × mean. Zero for PKO/freezeouts and tiny for mystery
   *  with σ²<1. Only meaningful on mystery / mystery-royale where the envelope
   *  distribution has a real jackpot tier. */
  jackpotBountyEvPerEntry: number;
  /** Ratio threshold (multiples of mean bounty) used to classify "jackpot"
   *  draws — same value for all rows so users compare apples to apples. */
  jackpotThreshold: number;
  bountyShare: number;
  progressivePko: boolean;
  topPlaces: number;
  /**
   * Adaptive EV/field breakdown. For small fields (N < 300) stays on the
   * original 5-tier layout; for high-field MTTs fans out to include
   * Top 0.1% / Top 0.5% / Top 5% / Final table so the concentration of EV
   * in the very top finishes is actually visible.
   */
  tiers: TierRow[];
  /** Smallest k such that top-k places cover ≥50% of expected payout. */
  halfMassK: number;
  /** Combined field share of those top-k places (= 1/odds). */
  halfMassField: number;
  /** Field share of the final table (top min(9, paidCount) places). */
  ftField: number;
  /** EV share of the final table. */
  ftEvShare: number;
  /** Fixed-ITM solver feedback — null when that mode is not active. */
  shellMode: boolean;
  shellFeasible: boolean;
  shellTargetEv: number;
  shellCurrentEv: number;
  shellP1: number;
  shellTop3: number;
  shellFt: number;
  /** Equilibrium probability of busting exactly at the bubble (first OOTM place). */
  shellBubble: number;
  /** Equilibrium probability of the last paid place — first mincash after the bubble. */
  shellFirstCash: number;
  /** Number of paid places (= payouts that are > 0). */
  paidCount: number;
}

/** Minimum ratio (× mean bounty) that counts a per-KO draw as a "jackpot"
 *  for the microscope widget split. Chosen so only the deep tail counts —
 *  at 100× buy-in it captures the top 1-3 GG BR tiers (e.g. 10000×/1000×/100×
 *  at the $1 profile) and gives essentially 0 for PKO/thin log-normal. */
const JACKPOT_THRESHOLD = 100;

/** Abramowitz & Stegun 7.1.26 approximation of the standard normal CDF
 *  Φ(x). Max error ≈ 1.5e-7 — more than enough for a UI readout. */
function stdNormalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-a * a);
  const erf = sign * y;
  return 0.5 * (1 + erf);
}

/**
 * Full per-entry EV decomposition for one row: prize + bounty, place by place,
 * then bucketed into tiers. Mirrors the bounty math used in the engine so the
 * preview matches what the simulator will actually sample.
 */
export function computeRowStats(row: TournamentRow, model: FinishModelConfig): RowStats {
  const economics = derivePreviewRowEconomics(row);
  const N = economics.fieldSize;
  const payouts = getPayoutTable(row.payoutStructure, N, row.customPayouts);
  const entryCostSingle = economics.singleCost;
  const entryCost = economics.costPerTournament;
  const expectedBullets = economics.expectedBullets;
  const brSampler =
    row.payoutStructure === "battle-royale"
      ? makeBrTierSampler(row.buyIn)
      : null;

  const bountyFraction = Math.max(0, Math.min(0.9, row.bountyFraction ?? 0));
  const bountyPerSeat = row.buyIn * bountyFraction;
  const bountyLift = Math.max(0.1, Math.min(3, (1 + row.rake) * (1 + row.roi)));
  const defaultBountyMean = bountyPerSeat * bountyLift;
  // Mirror engine.ts compileSingleEntry: user-tunable EV-bias shifts the
  // split between cash and bounty channels while keeping total ROI intact.
  const bias = Math.max(-0.25, Math.min(0.25, row.bountyEvBias ?? 0));
  const totalWinningsEV = entryCostSingle * (1 + row.roi);
  let bountyMean =
    bountyFraction > 0
      ? applyBountyBias(defaultBountyMean, totalWinningsEV, bias)
      : 0;
  const prizePool = economics.prizePoolBeforeBounty * (1 - bountyFraction);
  const paidCount = payouts.reduce((n, p) => (p > 0 ? n + 1 : n), 0);

  const solveCashTarget = (
    regularTarget: number,
  ): { pmf: Float64Array; cashEV: number } => {
    let targetPmf: Float64Array;
    if (row.itmRate != null && row.itmRate > 0) {
      targetPmf = calibrateShelledItm(
        N,
        paidCount,
        payouts,
        prizePool,
        regularTarget,
        row.itmRate,
        row.finishBuckets,
        model,
        row.itmTopHeavyBias ?? 0,
      ).pmf;
    } else {
      const targetEffectiveROI = regularTarget / entryCostSingle - 1;
      const targetAlpha = calibrateAlpha(
        N,
        payouts,
        prizePool,
        entryCostSingle,
        targetEffectiveROI,
        model,
      );
      targetPmf = buildFinishPMF(N, model, targetAlpha);
    }

    let cashEV = 0;
    for (let i = 0; i < Math.min(payouts.length, N); i++) {
      cashEV += targetPmf[i] * payouts[i] * prizePool;
    }
    return { pmf: targetPmf, cashEV };
  };

  let battleRoyaleNeutral: {
    pmf: Float64Array;
    cashEV: number;
  } | null = null;
  let battleRoyaleCenter: {
    pmf: Float64Array;
    cashEV: number;
  } | null = null;

  if (
    bountyFraction > 0 &&
    isBattleRoyaleRow(row) &&
    row.itmRate != null &&
    row.itmRate > 0
  ) {
    // Same BR rule as the engine: bias walks the real feasible cash/KO EV
    // interval around a true 50/50 gross-EV midpoint.
    const neutralBountyMean = entryCostSingle * bountyFraction;
    const neutralTargetRegular = Math.max(0.01, entryCostSingle - neutralBountyMean);
    battleRoyaleNeutral = solveCashTarget(neutralTargetRegular);
    const centerCashTarget = Math.max(0.01, totalWinningsEV * 0.5);
    const resolvedCash = resolveBattleRoyaleCashTarget({
      N,
      payouts,
      prizePool,
      itmRate: row.itmRate ?? 0,
      centerCashTarget,
      bias,
      neutralPmf: battleRoyaleNeutral.pmf,
      neutralWinnings: battleRoyaleNeutral.cashEV,
      finishBuckets: row.finishBuckets,
      preferTopHeavy: row.roi > 0,
      topHeavyBias: row.itmTopHeavyBias ?? 0,
    });
    if (resolvedCash) {
      battleRoyaleCenter = {
        pmf: resolvedCash.centerPmf,
        cashEV: resolvedCash.centerCashEV,
      };
    }
    const desiredCashEV = resolvedCash
      ? resolvedCash.desiredCashEV
      : centerCashTarget;
    bountyMean = clampBountyMean(totalWinningsEV - desiredCashEV, totalWinningsEV);
  }

  const targetRegular = Math.max(
    0.01,
    entryCostSingle * (1 + row.roi) - bountyMean,
  );
  const effectiveROI = targetRegular / entryCostSingle - 1;
  let alpha: number;
  let pmf: Float64Array;
  let feasible = true;
  let currentWinningsFromSolver: number | null = null;
  if (row.itmRate != null && row.itmRate > 0) {
    const winnerFirst = isBattleRoyaleRow(row) && battleRoyaleCenter
      ? buildBattleRoyaleCashTargetPmf({
          N,
          payouts,
          prizePool,
          itmRate: row.itmRate,
          targetWinnings: targetRegular,
          anchorPmf: battleRoyaleCenter.pmf,
          anchorWinnings: battleRoyaleCenter.cashEV,
          finishBuckets: row.finishBuckets,
          preferTopHeavy: row.roi > 0,
          topHeavyBias: row.itmTopHeavyBias ?? 0,
        })
      : null;
    if (winnerFirst) {
      alpha = 0;
      pmf = winnerFirst.pmf;
      feasible = winnerFirst.feasible;
      currentWinningsFromSolver = winnerFirst.currentWinnings;
    } else {
      const fi = calibrateShelledItm(
        N,
        paidCount,
        payouts,
        prizePool,
        targetRegular,
        row.itmRate,
        row.finishBuckets,
        model,
        row.itmTopHeavyBias ?? 0,
      );
      alpha = fi.alpha;
      pmf = fi.pmf;
      feasible = fi.feasible;
      currentWinningsFromSolver = fi.currentWinnings;
    }
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

  const prizeByPlace = new Float64Array(N);
  for (let i = 0; i < Math.min(payouts.length, N); i++) {
    prizeByPlace[i] = payouts[i] * prizePool;
  }

  if (
    bountyFraction > 0 &&
    ((row.itmRate != null && row.itmRate > 0) || !isAlphaAdjustable(model))
  ) {
    let cashEVActual = 0;
    for (let i = 0; i < N; i++) cashEVActual += pmf[i] * prizeByPlace[i];
    bountyMean = Math.max(0, totalWinningsEV - cashEVActual);
  }

  const bountyByPlace = new Float64Array(N);
  // bountyBustsAtPos[i] = expected # of bounty-paying busts by finisher at
  // place i+1. For PKO every bust pays cash, so this equals the full
  // harmonic H(N−1)−H(p−1). For mystery / mystery-royale only busts whose
  // victim finishes inside the bounty window (ITM bubble, or top-9 FT for
  // BR) drop an envelope, so the harmonic is restricted to that window.
  // Tier metrics use this as the denominator of "avg bounty per head".
  const bountyBustsAtPos = new Float64Array(N);
  if (bountyMean > 0 && N >= 2) {
    const raw = new Float64Array(N);
    const isMystery =
      row.gameType === "mystery" ||
      row.gameType === "mystery-royale" ||
      brSampler !== null;

    if (isMystery) {
      const ft =
        row.gameType === "mystery-royale" || brSampler !== null
          ? Math.min(9, N)
          : paidCount;
      const mLo = Math.max(1, N - ft + 1);
      for (let i = 0; i < N; i++) {
        const p = i + 1;
        const mHi = N - p;
        if (mHi < mLo) {
          raw[i] = 0;
          bountyBustsAtPos[i] = 0;
        } else {
          let acc = 0;
          for (let m = mLo; m <= mHi; m++) acc += 1 / (N - m);
          raw[i] = acc;
          bountyBustsAtPos[i] = acc;
        }
      }
    } else {
      const Hprefix = new Float64Array(N);
      let hAcc = 0;
      for (let k = 1; k < N; k++) {
        hAcc += 1 / k;
        Hprefix[k] = hAcc;
      }
      const totalH = Hprefix[N - 1];
      for (let i = 0; i < N; i++) {
        bountyBustsAtPos[i] = totalH - Hprefix[i];
      }

      const cashAtBust = new Float64Array(N - 1);
      let T = N;
      for (let m = 1; m <= N - 1; m++) {
        const h = T / (N - m + 1);
        const cash = h / 2;
        cashAtBust[m - 1] = cash;
        T -= cash;
      }
      const Tfinal = T;
      const prefix = new Float64Array(N);
      let acc = 0;
      for (let m = 1; m <= N - 1; m++) {
        acc += cashAtBust[m - 1] / (N - m);
        prefix[m] = acc;
      }
      for (let i = 0; i < N; i++) {
        const p = i + 1;
        const upto = N - p;
        raw[i] = upto > 0 ? prefix[upto] : 0;
      }
      raw[0] += Tfinal;
    }

    let Z = 0;
    for (let i = 0; i < N; i++) Z += pmf[i] * raw[i];
    if (brSampler !== null && Z > 1e-12 && brSampler.meanValue > 1e-12) {
      const kScale = bountyMean / (brSampler.meanValue * Z);
      for (let i = 0; i < N; i++) {
        bountyBustsAtPos[i] *= kScale;
        bountyByPlace[i] = bountyBustsAtPos[i] * brSampler.meanValue;
      }
    } else if (Z > 1e-12) {
      const scale = bountyMean / Z;
      for (let i = 0; i < N; i++) bountyByPlace[i] = raw[i] * scale;
    }
  }

  const totalByPlace = new Float64Array(N);
  let totalEv = 0;
  let totalEv2 = 0;
  let cashEv = 0;
  let bountyEv = 0;
  for (let i = 0; i < N; i++) {
    totalByPlace[i] = prizeByPlace[i] + bountyByPlace[i];
    totalEv += pmf[i] * totalByPlace[i];
    totalEv2 += pmf[i] * totalByPlace[i] * totalByPlace[i];
    cashEv += pmf[i] * prizeByPlace[i];
    bountyEv += pmf[i] * bountyByPlace[i];
  }
  const totalEvPerBullet = totalEv;
  const payoutVarPerBullet = Math.max(
    0,
    totalEv2 - totalEvPerBullet * totalEvPerBullet,
  );
  totalEv = totalEvPerBullet * expectedBullets;
  cashEv *= expectedBullets;
  bountyEv *= expectedBullets;
  // Jackpot share of bounty EV — fraction of bountyEv that comes from
  // per-KO draws with ratio ≥ JACKPOT_THRESHOLD × mean. Derived from the
  // envelope distribution, independent of place (every KO is an iid draw).
  // BR reads the discrete 10-tier GG table; mystery uses log-normal with
  // E[Y]=1 → E[Y·1{Y>R}] = Φ((σ²/2 − ln R)/σ). PKO/freezeouts: thin tail, 0.
  let jackpotShareFrac = 0;
  if (bountyEv > 0) {
    if (brSampler !== null) {
      for (let i = 0; i < brSampler.ratios.length; i++) {
        if (brSampler.ratios[i] >= JACKPOT_THRESHOLD) {
          jackpotShareFrac += brSampler.probs[i] * brSampler.ratios[i];
        }
      }
    } else if ((row.mysteryBountyVariance ?? 0) > 0) {
      const sigma2 = row.mysteryBountyVariance!;
      const sigma = Math.sqrt(sigma2);
      const d = (sigma2 / 2 - Math.log(JACKPOT_THRESHOLD)) / sigma;
      jackpotShareFrac = stdNormalCdf(d);
    }
  }
  const jackpotBountyEv = bountyEv * jackpotShareFrac;
  const payoutVar = payoutVarPerBullet * expectedBullets;
  const payoutStd = Math.sqrt(payoutVar);
  const cv = totalEv > 1e-9 ? payoutStd / totalEv : 0;

  let itm = 0;
  for (let i = 0; i < paidCount; i++) itm += pmf[i];

  // Per-place arrays used for both tier binning and the half-mass fact.
  const evByPlace = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    evByPlace[i] = pmf[i] * totalByPlace[i] * expectedBullets;
  }

  // Half-mass: smallest k such that top-k places cover ≥50% of total EV.
  // Computed over *paid* places (OOTM adds no EV) and bounded by paidCount.
  let cumEv = 0;
  let halfMassK = 0;
  const halfTarget = totalEv * 0.5;
  for (let i = 0; i < paidCount && halfMassK === 0; i++) {
    cumEv += evByPlace[i];
    if (cumEv >= halfTarget) halfMassK = i + 1;
  }
  if (halfMassK === 0) halfMassK = paidCount;
  let halfMassField = 0;
  for (let i = 0; i < halfMassK; i++) halfMassField += pmf[i];

  // Final-table stats (top 9 by tournament convention, or fewer if paidCount < 9).
  const isBattleRoyale = isBattleRoyaleRow(row);
  const ftEnd = isBattleRoyale ? Math.min(9, N) : Math.min(9, paidCount);
  let ftField = 0;
  let ftEvSum = 0;
  for (let i = 0; i < ftEnd; i++) {
    ftField += pmf[i];
    ftEvSum += evByPlace[i];
  }
  const ftEvShare = totalEv > 1e-9 ? ftEvSum / totalEv : 0;

  // Adaptive tier layout. Each tier is a half-open place range [lo, hi]
  // (1-indexed). We build the cut list first, then slice per tier — this
  // avoids the N≥300 branch having a different accumulator shape from the
  // small-field case. Cuts that collapse (e.g., ceil(500*0.001)==1) get
  // filtered out to avoid zero-width tiers.
  interface TierCut {
    key: TierKey;
    labelKey: TierLabelKey;
    color: string;
    hi: number;
  }
  const cuts: TierCut[] = [];
  cuts.push({ key: "winner", labelKey: "preview.tierWinner", color: "#ffde51", hi: 1 });
  // Fixed tier ladder: 1 / 2–3 / 4–9 / 10–27 (only for 100+ fields) / rest ITM.
  // Zero-width cuts are dropped downstream by the monotonic enforcement.
  cuts.push({
    key: "top3",
    labelKey: "preview.tierTop3",
    color: "#fb923c",
    hi: Math.min(3, paidCount),
  });
  if (isBattleRoyale) {
    if (paidCount < N) {
      cuts.push({
        key: "bubble",
        labelKey: "preview.probBubble",
        color: "#475569",
        hi: Math.min(paidCount + 1, N),
      });
    }
    if (ftEnd > paidCount + 1) {
      cuts.push({
        key: "ftNonCash",
        labelKey: "preview.tierFtNonCash",
        color: "#a855f7",
        hi: ftEnd,
      });
    }
  } else {
    cuts.push({
      key: "ft",
      labelKey: "preview.tierFt",
      color: "#a855f7",
      hi: Math.min(ftEnd, paidCount),
    });
    if (N >= 100) {
      cuts.push({
        key: "top27",
        labelKey: "preview.tierTop27",
        color: "#c026d3",
        hi: Math.min(27, paidCount),
      });
    }
    // 5%–ITM: everything from the last cumulative cut above down to the
    // ITM edge, merged into one bar. Replaces the old top-10% + restItM
    // pair so the user sees one clean range instead of two.
    if (paidCount >= 2) {
      cuts.push({
        key: "restItm",
        labelKey: "preview.tierRestItm",
        color: "#a855f7",
        hi: paidCount - 1,
      });
      cuts.push({
        key: "firstMincash",
        labelKey: "preview.probFirstCash",
        color: "#94a3b8",
        hi: paidCount,
      });
    }
    if (paidCount < N) {
      cuts.push({
        key: "bubble",
        labelKey: "preview.probBubble",
        color: "#475569",
        hi: paidCount + 1,
      });
    }
  }
  cuts.push({
    key: "ootm",
    labelKey: "preview.tierOotm",
    color: "#1f2937",
    hi: N,
  });

  // Enforce monotonic, non-overlapping cuts — each tier starts where the
  // previous one ended, so ceil() rounding collapsing a tier into 0 width
  // just drops it cleanly.

  const tiers: TierRow[] = [];
  let prevHi = 0;
  for (const c of cuts) {
    const hi = Math.min(N, Math.max(prevHi, c.hi));
    if (hi <= prevHi) continue;
    let evTier = 0;
    let cashTier = 0;
    let bountyTier = 0;
    let fTier = 0;
    let totalTierSum = 0;
    let bustsWeighted = 0;
    for (let i = prevHi; i < hi; i++) {
      evTier += evByPlace[i];
      cashTier += pmf[i] * prizeByPlace[i];
      bountyTier += pmf[i] * bountyByPlace[i];
      fTier += pmf[i];
      totalTierSum += totalByPlace[i];
      bustsWeighted += pmf[i] * bountyBustsAtPos[i];
    }
    const width = hi - prevHi;
    const eqShareTier = N > 0 ? width / N : 0;
    const evEqTier = N > 0 ? (totalTierSum / N) * expectedBullets : 0;
    const cashGivenFinish = fTier > 1e-12 ? cashTier / fTier : 0;
    const bountyGivenFinish = fTier > 1e-12 ? bountyTier / fTier : 0;
    const bustsGivenFinish = fTier > 1e-12 ? bustsWeighted / fTier : 0;
    const bountySizePerBust =
      bustsGivenFinish > 1e-9 ? bountyGivenFinish / bustsGivenFinish : 0;
    tiers.push({
      key: c.key,
      labelKey: c.labelKey,
      color: c.color,
      ev: evTier,
      cashEv: cashTier * expectedBullets,
      bountyEv: bountyTier * expectedBullets,
      cashGivenFinish,
      bountyGivenFinish,
      bustsGivenFinish,
      bountySizePerBust,
      field: fTier,
      eqShare: eqShareTier,
      netDollars: evTier - fTier * entryCost,
      eqNetDollars: evEqTier - eqShareTier * entryCost,
      displaySeats: width,
      posLo: prevHi + 1,
      posHi: hi,
    });
    prevHi = hi;
  }

  const bountyShareOfPayout =
    totalEv > 1e-9
      ? (() => {
          let bEv = 0;
          for (let i = 0; i < N; i++) bEv += pmf[i] * bountyByPlace[i];
          return bEv / totalEv;
        })()
      : 0;

  // Shell panel stats — probabilities from the final PMF, directly readable.
  const ftEndShell = Math.min(9, paidCount);
  const shellP1 = pmf[0] ?? 0;
  let shellTop3Sum = 0;
  for (let i = 0; i < Math.min(3, paidCount); i++) shellTop3Sum += pmf[i];
  let shellFtSum = 0;
  for (let i = 0; i < ftEndShell; i++) shellFtSum += pmf[i];
  const shellBubble = paidCount < N ? (pmf[paidCount] ?? 0) : 0;
  const shellFirstCash = paidCount > 0 ? (pmf[paidCount - 1] ?? 0) : 0;

  return {
    alpha,
    cost: entryCost,
    itm,
    evPerEntry: totalEv,
    payoutStd,
    cv,
    cashEvPerEntry: cashEv,
    bountyEvPerEntry: bountyEv,
    jackpotBountyEvPerEntry: jackpotBountyEv,
    jackpotThreshold: JACKPOT_THRESHOLD,
    bountyShare: bountyShareOfPayout,
    progressivePko: inferGameType(row) === "pko",
    topPlaces: Math.max(1, Math.ceil(N * 0.01)),
    tiers,
    halfMassK,
    halfMassField,
    ftField,
    ftEvShare,
    shellMode: row.itmRate != null && row.itmRate > 0,
    shellFeasible: feasible,
    shellTargetEv: targetRegular * expectedBullets,
    shellCurrentEv:
      currentWinningsFromSolver != null
        ? currentWinningsFromSolver * expectedBullets
        : totalEv - bountyShareOfPayout * totalEv,
    shellP1,
    shellTop3: shellTop3Sum,
    shellFt: shellFtSum,
    shellBubble,
    shellFirstCash,
    paidCount,
  };
}
