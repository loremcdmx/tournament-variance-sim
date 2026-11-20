/**
 * Per-row compilation: one TournamentRow (at one effective field size) becomes
 * one CompiledEntry — payout curve, ROI-calibrated finish pmf, alias table,
 * bounty bank, PKO heat bank. `compileRowVariants` sits on top and expands a
 * row with field variability into one entry per field-size bucket. This is the
 * calibration-heavy bulk of the compile stage; `compile.ts` only assembles the
 * entries these functions return into a flat schedule.
 */
import { getPayoutTable } from "./payouts";
import { fieldVariantSizes } from "./fieldVariants";
import { applySitThroughPayJumps } from "./sitThroughPayJumps";
import {
  applyBountyBias,
  buildAliasTable,
  buildBinaryItmAssets,
  buildFinishPMF,
  calibrateAlpha,
  calibrateShelledItm,
  cashTargetFloor,
  isAlphaAdjustable,
  itmProbability,
  withinTargetEv,
} from "./finishModel";
import { clampBountyMean, isBattleRoyaleRow, settleBountyAgainstPool } from "./bountySplit";
import {
  buildBattleRoyaleCashTargetPmf,
  resolveBattleRoyaleCashTarget,
} from "./battleRoyaleWinnerFirst";
import { makeBrTierSampler } from "./brBountyTiers";
import { inferGameType } from "./gameType";
import { buildOceanKoModel, type OceanKoModel } from "./oceanKo";
import { HEAT_BIN_COUNT, HEAT_Z_RANGE } from "./engineConstants";
import type { CompiledEntry } from "./engineTypes";
import type {
  CalibrationMode,
  SimulationInput,
  TournamentRow,
} from "./types";

// Variance of a player's bounty take at each place in the uniform-killer
// progressive tree (unit starting head, the unit of the PKO raw weights).
// Conditioned on the player still being alive, each bust removes a uniform
// other player x and hands half of x's head to a uniform survivor; the
// player's cash C, own head H, the others' head sum S and sum of squares Q
// stay closed under ten first and second moments, so the per-place variance
// costs O(N). The winner takes C + H, where H grows with the same half-heads
// as C; a place below takes C.
function pkoTreeVarianceByPlace(N: number): Float64Array {
  const variance = new Float64Array(N);
  let C = 0, H = 1, S = N - 1;
  let C2 = 0, H2 = 1, CH = 0, CS = 0, HS = N - 1, S2 = (N - 1) * (N - 1), Q = N - 1;
  for (let busts = 1; busts <= N - 1; busts++) {
    const m = N - busts;
    const a = 1 / m;
    const keep = 1 - a * (a + (1 - a) / 2);
    const ex = S / m;
    const ex2 = Q / m;
    const exy = m > 1 ? (S2 - Q) / (m * (m - 1)) : 0;
    const pairGain = a * (S2 - Q) / (2 * m);
    const nC2 = C2 + a * (CS / m + ex2 / 4);
    const nH2 = H2 + a * (HS / m + ex2 / 4);
    const nCH = CH + a * ((CS + HS) / (2 * m) + ex2 / 4);
    const nCS = CS * keep + pairGain;
    const nHS = HS * keep + pairGain;
    const nS2 = a * (S2 - 2 * S2 / m + Q / m) + (1 - a) * (S2 - S2 / m + Q / (4 * m));
    const nQ = a * (Q - Q / m) + (1 - a) * (Q - 0.75 * Q / m + exy);
    C += a * ex / 2;
    H += a * ex / 2;
    S *= keep;
    C2 = nC2; H2 = nH2; CH = nCH; CS = nCS; HS = nHS; S2 = nS2; Q = nQ;
    const place = N - 1 - busts;
    variance[place] = place === 0
      ? Math.max(0, C2 + 2 * CH + H2 - (C + H) * (C + H))
      : Math.max(0, C2 - C * C);
  }
  return variance;
}

function compileSingleEntry(
  row: TournamentRow,
  idx: number,
  players: number,
  model: SimulationInput["finishModel"],
  calibrationMode: CalibrationMode,
  primedopeStyleEV = false,
  forcePrimedopePayouts = false,
  pdFlags: PdCompareFlags = { usePdFinishModel: false, usePdRakeMath: false },
): CompiledEntry {
  // ---- input validation --------------------------------------------------
  // Guard impossible values at compile time so the hot loop is never fed
  // a broken row. Done once per row — negligible cost.
  const label = row.label || row.id || `row ${idx}`;
  if (!(row.players >= 1)) {
    throw new Error(`engine: row "${label}" players must be ≥ 1 (got ${row.players})`);
  }
  if (!(row.buyIn >= 0)) {
    throw new Error(`engine: row "${label}" buyIn must be ≥ 0 (got ${row.buyIn})`);
  }
  if (!(row.rake >= 0 && row.rake <= 1)) {
    throw new Error(`engine: row "${label}" rake must be in [0,1] (got ${row.rake})`);
  }
  if (!Number.isFinite(row.roi)) {
    throw new Error(`engine: row "${label}" roi must be finite (got ${row.roi})`);
  }
  if (row.bountyFraction != null && !(row.bountyFraction >= 0 && row.bountyFraction <= 0.9)) {
    throw new Error(
      `engine: row "${label}" bountyFraction must be in [0,0.9] (got ${row.bountyFraction})`,
    );
  }
  if (row.payJumpAggression != null && !(row.payJumpAggression >= 0 && row.payJumpAggression <= 1)) {
    throw new Error(
      `engine: row "${label}" payJumpAggression must be in [0,1] (got ${row.payJumpAggression})`,
    );
  }
  if (row.mysteryBountyVariance != null && !(row.mysteryBountyVariance >= 0)) {
    throw new Error(
      `engine: row "${label}" mysteryBountyVariance must be ≥ 0 (got ${row.mysteryBountyVariance})`,
    );
  }
  if (row.pkoHeat != null && !(row.pkoHeat >= 0 && row.pkoHeat <= 3)) {
    throw new Error(
      `engine: row "${label}" pkoHeat must be in [0,3] (got ${row.pkoHeat})`,
    );
  }

  // Late-registration: the real field at reg-close is the nominal field
  // scaled by `lateRegMultiplier`. Scales prize pool and paid seats, and
  // widens the finish-position shape. Defaults to 1 (no late reg).
  const lateRegMult = Math.max(1, row.lateRegMultiplier ?? 1);
  const N = Math.max(1, Math.floor(players * lateRegMult));
  // ROI in this app is always net of rake: profit / (buy-in + rake). Keep
  // that cost basis in the PrimeDope comparison too so both panes compare the
  // same edge. Only diagnostic live-site parity scripts opt into PD's
  // rake-ignored EV basis through `primedopeStyleEV`.
  const entryCostSingle = primedopeStyleEV
    ? row.buyIn
    : row.buyIn * (1 + row.rake);
  const effectiveSeats = N;
  // Rake-SD coupling: in PD-binary-itm mode, we model PD's internal quirk
  // of using the POST-RAKE pool as the variance driver while keeping the
  // app's full-cost ROI target fixed.
  // (See notes/pokerdope_weaknesses.md §7.) The binary-ITM calibrator
  // will inflate l so the mean outcome still hits `targetRegular`, but
  // the tighter per-prize spread drops σ in proportion to rake.
  const poolBuyInBasis =
    calibrationMode === "primedope-binary-itm" &&
    pdFlags.usePdRakeMath
      ? // PD's rake-math quirk shrinks the pool by the full rake fraction.
        // At very high rake (e.g. $50+$50 satellite-style, rake=100%) that
        // would literally zero the pool, collapsing PD's sim to a single
        // deterministic loss per tournament with no variance — blank charts.
        // Floor at 20 % of the buy-in so PD still produces a signal while
        // preserving the rake→σ shrinkage the quirk is meant to model.
        Math.max(row.buyIn * 0.2, row.buyIn * (1 - row.rake))
      : row.buyIn;
  const basePool = effectiveSeats * poolBuyInBasis;
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
  // EV-bias: user-tunable shift of the expected-winnings split between
  // the cash and bounty channels. The requested bountyMean drives the finish
  // shape; constrained models then close the actual KO budget as the residual
  // after cash EV so total ROI stays pinned even when α hits a boundary.
  // Clamped to ±0.25 — past that, α-adjustable models also start bottoming
  // out against their search envelope and the slider stops adding useful
  // behavioral range.
  const bias = Math.max(-0.25, Math.min(0.25, row.bountyEvBias ?? 0));
  const totalWinningsEV = entryCostSingle * (1 + row.roi);
  const isBattleRoyale = isBattleRoyaleRow(row);
  let battleRoyaleCenter: {
    pmf: Float64Array;
    cashEV: number;
  } | null = null;
  let defaultBountyMean = 0;
  if (bountyFraction > 0) {
    const bountyPerSeat = row.buyIn * bountyFraction;
    // Skill lift on bounty collection — equilibrium haul is bountyPerSeat
    // (no rake on bounty pool). Total edge = entryCost · roi distributes
    // proportionally over cash + bounty, so lift = (1+rake)(1+roi). Capped
    // at 3× for sanity. This is a *heuristic* anchor used to drive the pmf
    // build; for constrained models we replace it with the actual residual
    // after the pmf is known.
    const bountyLift = Math.max(0.1, Math.min(3, (1 + row.rake) * (1 + row.roi)));
    defaultBountyMean = bountyPerSeat * bountyLift;
    bountyMean = applyBountyBias(defaultBountyMean, totalWinningsEV, bias);

    // Shrink the *entry-funded* pool by the bounty share, but keep guarantee
    // overlay entirely in the cash pool: real rooms fix per-head bounties at
    // buyIn·f and top the cash pool up to the guarantee, so the field pool is
    // basePool·(1−f) [cash from entries] + overlay [room top-up] + basePool·f
    // [bounty pool] = basePool + overlay = guarantee. The old
    // `(basePool+overlay)·(1−f)` silently dropped overlay·f of the guaranteed
    // pool (e.g. 18.75% of a 40k guarantee at f=0.5). No-overlay rows are
    // unchanged: basePool·(1−f)+0 == (basePool+0)·(1−f).
    prizePool = basePool * (1 - bountyFraction) + overlay;
  }

  // ---- raw payout curve --------------------------------------------------
  // The PD comparison defaults to PD's native payout curve. Turning
  // `usePrimedopePayouts` off makes the binary-ITM pass honour the user's
  // selected payout table so the toolbar can isolate the finish-model effect.
  const effectivePayoutStructure = forcePrimedopePayouts
    ? "mtt-primedope"
    : row.payoutStructure;
  const payouts = getPayoutTable(
    effectivePayoutStructure,
    N,
    row.customPayouts,
  );

  const paidCount = payouts.reduce((n, p) => (p > 0 ? n + 1 : n), 0);

  const buildPrizeByPlace = (
    binaryItmPrizeOverride: Float64Array | null,
  ): Float64Array => {
    const out = new Float64Array(N);
    if (binaryItmPrizeOverride) {
      out.set(binaryItmPrizeOverride);
    } else {
      for (let i = 0; i < Math.min(payouts.length, N); i++) {
        out[i] = payouts[i] * prizePool;
      }
    }
    return out;
  };

  const cashEVFor = (
    candidatePmf: Float64Array,
    candidatePrizeByPlace: Float64Array,
  ): number => {
    let cashEV = 0;
    for (let i = 0; i < N; i++) cashEV += candidatePmf[i] * candidatePrizeByPlace[i];
    return cashEV;
  };

  const solveFinish = (
    regularTarget: number,
  ): {
    alpha: number;
    pmf: Float64Array;
    prizeByPlace: Float64Array;
  } => {
    let solvedPmf: Float64Array;
    let solvedAlpha = 0;
    let binaryItmPrizeOverride: Float64Array | null = null;
    const solvedEffectiveROI = regularTarget / entryCostSingle - 1;

    if (calibrationMode === "primedope-binary-itm" && pdFlags.usePdFinishModel) {
      const assets = buildBinaryItmAssets(
        N,
        paidCount,
        payouts,
        prizePool,
        regularTarget,
      );
      solvedPmf = assets.pmf;
      binaryItmPrizeOverride = assets.prizeByPlace;
    } else if (row.itmRate != null && row.itmRate > 0) {
      const fi = calibrateShelledItm(
        N,
        paidCount,
        payouts,
        prizePool,
        regularTarget,
        row.itmRate,
        row.finishBuckets,
        model,
        row.itmTopHeavyBias ?? 0,
      );
      solvedAlpha = fi.alpha;
      solvedPmf = fi.pmf;
    } else {
      solvedAlpha = calibrateAlpha(
        N,
        payouts,
        prizePool,
        entryCostSingle,
        solvedEffectiveROI,
        model,
      );
      solvedPmf = buildFinishPMF(N, model, solvedAlpha);
    }

    return {
      alpha: solvedAlpha,
      pmf: solvedPmf,
      prizeByPlace: buildPrizeByPlace(binaryItmPrizeOverride),
    };
  };

  if (bountyFraction > 0 && isBattleRoyale && row.itmRate != null && row.itmRate > 0) {
    // BR fixed-ITM exposes the full feasible cash/KO EV interval around the
    // configured KO-pool baseline. With the common 45% Battle Royale bounty
    // pool, the neutral slider center must read as 45% KO EV, not 50%.
    const neutralBountyMean = entryCostSingle * bountyFraction;
    const cashFloor = cashTargetFloor(entryCostSingle);
    const neutralTargetRegular = Math.max(cashFloor, entryCostSingle - neutralBountyMean);
    const neutral = solveFinish(neutralTargetRegular);
    const neutralCashEV = cashEVFor(neutral.pmf, neutral.prizeByPlace);
    const centerBountyMean = clampBountyMean(defaultBountyMean, totalWinningsEV);
    const centerCashTarget = Math.max(cashFloor, totalWinningsEV - centerBountyMean);
    const resolvedCash = resolveBattleRoyaleCashTarget({
      N,
      payouts,
      prizePool,
      itmRate: row.itmRate ?? 0,
      centerCashTarget,
      bias,
      neutralPmf: neutral.pmf,
      neutralWinnings: neutralCashEV,
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

  // ---- finish distribution -----------------------------------------------
  // The player's expected total winnings target is `cost × (1+ROI)`. A
  // bounty lump contributes bountyEV directly; the regular prize pool must
  // therefore hit `targetTotal − bountyEV` on its own. We translate that
  // back into an "effective ROI" target to feed the existing calibrator.
  // One entry per slot, costing `entryCostSingle`, sampling once from this pmf:
  //   E[profit per slot] = E[prize] + E[bounty] − singleCost
  // For overall ROI = row.roi on money spent (= singleCost):
  //   E[prize] + E[bounty] − singleCost = singleCost × ROI
  //   → E[prize] = singleCost × (1 + ROI) − bountyMean
  const settled = settleBountyAgainstPool({
    N,
    paidCount,
    buyIn: row.buyIn,
    bountyFraction,
    totalWinningsEV,
    cashFloor: cashTargetFloor(entryCostSingle),
    plannedBountyMean: bountyMean,
    // With fixed ITM/shells or reference-shape models the finish solver can
    // hit an α boundary before its cash target is reached. The slider still
    // changes the requested split and therefore the solved finish shape, but
    // the actual KO budget must be the residual after that shape's cash EV,
    // as far as the bounty pool can pay it. Otherwise total ROI drifts at the
    // slider edges.
    residualCloses: (row.itmRate != null && row.itmRate > 0) || !isAlphaAdjustable(model),
    sitThrough: row.sitThroughPayJumps === true && calibrationMode !== "primedope-binary-itm",
    payJumpAggression: row.payJumpAggression,
    solve: (targetRegular) => {
      // entryCostSingle has already dropped rake when pdDisplayMode is on, so
      // the binary-ITM target is naturally PrimeDope-style.
      if (
        row.itmRate == null ||
        !(row.itmRate > 0) ||
        (calibrationMode === "primedope-binary-itm" && pdFlags.usePdFinishModel)
      ) {
        return solveFinish(targetRegular);
      }
      // Fixed-ITM (shelled) calibration: user pins the ITM rate and optionally
      // pins top-shell masses (P(1st), P(top-3), P(FT)). Skill concentrates
      // only within the cashed band; locked shells stay fixed, free band
      // α-calibrates so total E[W] still hits target.
      const winnerFirst = isBattleRoyale && battleRoyaleCenter
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
        return { alpha: 0, pmf: winnerFirst.pmf, prizeByPlace: buildPrizeByPlace(null) };
      }
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
        bountyFraction > 0 ? totalWinningsEV : targetRegular,
      );
      return { alpha: fi.alpha, pmf: fi.pmf, prizeByPlace: buildPrizeByPlace(null) };
    },
  });
  const { alpha, pmf, prizeByPlace } = settled.solved;
  bountyMean = settled.bountyMean;

  if (row.sitThroughPayJumps && calibrationMode !== "primedope-binary-itm") {
    applySitThroughPayJumps(pmf, prizeByPlace, paidCount, row.payJumpAggression);
  }

  const { prob: aliasProb, alias: aliasIdx } = buildAliasTable(pmf);
  const brSampler =
    row.payoutStructure === "battle-royale" ? makeBrTierSampler(row.buyIn) : null;

  // A row saved before the gameType column existed has none; the editor,
  // feasibility and convergence policy all read it as the type inferGameType
  // gives, so the bounty shape and the per-KO noise must too.
  const gameType = inferGameType(row);

  // ---- bounty distribution across finish places -------------------------
  // Elimination-order model: the player finishing at 1-indexed place p was
  // alive for the first N−p busts and killed 1/(N−m) of each bust m in
  // that window (one of (N−m) alive non-victims).
  //
  // Shape depends on gameType:
  //
  // - PKO ("pko"): each bust pays half the current head; heads accumulate
  //   (cash_m = h_m/2, T(m) = T(m−1) − cash_m). Deep finishers win more and
  //   the winner gets T(N−1) on top. Per-KO value grows across the run.
  //
  // - Mystery / Mystery-Royale: each bust inside the bounty window is an
  //   iid draw from the mystery pool. Per-KO variance comes from the
  //   envelope distribution (log-normal for plain mystery, 10-tier GG
  //   table for BR). raw[i] is therefore just the expected count of
  //   envelope-dropping busts — harmonic, restricted to the window
  //   (victims finishing inside the bounty-paying tier). For Battle
  //   Royale the published envelope table fixes the mean $ per KO, so
  //   changing the bounty budget rescales KO counts, not envelope size.
  //
  // The final raw weights are normalized against the calibrated pmf so that
  // Σ pmf[i] · bountyByPlace[i] === bountyMean. This preserves ROI
  // calibration while shifting all the bounty variance onto the shape of
  // the finish distribution. bountyKmean[i] holds the expected window KO
  // count at place i; Mystery and Battle Royale draw it as a Poisson count,
  // PKO plays its knockouts one by one from pkoKoCash (see engineTypes).
  let bountyByPlace: Float64Array | null = null;
  let bountyKmean: Float64Array | null = null;
  let pkoKoCash: Float64Array | null = null;
  let pkoRawInv: Float64Array | null = null;
  let pkoKoLogSigma: Float64Array | null = null;
  let pkoHaulVariance: Float64Array | null = null;
  let pkoHaulShrink: Float64Array | null = null;
  let pkoHaulShift: Float64Array | null = null;
  let pkoWinnerHead = 0;
  // Raw (unnormalized) bounty weights. Captured so the latent-heat bank
  // below can re-normalize the same shape against its per-bin shifted pmf
  // without redoing the per-gametype math.
  let bountyRaw: Float64Array | null = null;
  let oceanKo: OceanKoModel | null = null;
  if (gameType === "ocean-ko" && bountyMean > 0) {
    oceanKo = buildOceanKoModel(
      N,
      row.buyIn * bountyFraction,
      row.buyIn * (1 + row.rake),
      pmf,
      bountyMean,
    );
    bountyByPlace = oceanKo.bountyMeanByPlace;
  } else if (bountyMean > 0 && N >= 2) {
    const raw = new Float64Array(N);
    bountyKmean = new Float64Array(N);

    const isMystery = gameType === "mystery" || gameType === "mystery-royale";

    if (isMystery) {
      // Envelope-dropping window: for `mystery-royale` it's the final
      // table (top-9, GG 18-max BR); for plain `mystery` it's the ITM
      // bubble. Only busts whose victim finishes inside this window drop
      // an envelope. For N=18, BR top-9 ⇒ 8 envelope-dropping busts
      // (places 9..2 get eliminated; winner keeps their own envelope
      // unopened), so mean envelope = bountyPool / 8.
      const ft = gameType === "mystery-royale" ? Math.min(9, N) : paidCount;
      // Window busts are m = N−ft+1 .. N−1 (victim finishes at place
      // N−m+1, which lies in [2..ft]). Expected envelope-drops by
      // finisher at 1-indexed place p is
      //   Σ_{m=max(1, N−ft+1)..N−p} 1 / (N−m)
      // since they're one of (N−m) non-victim candidates per bust.
      const mLo = Math.max(1, N - ft + 1);
      for (let i = 0; i < N; i++) {
        const p = i + 1;
        const mHi = N - p;
        if (mHi < mLo) {
          raw[i] = 0;
          bountyKmean[i] = 0;
        } else {
          let acc = 0;
          for (let m = mLo; m <= mHi; m++) acc += 1 / (N - m);
          raw[i] = acc;
          bountyKmean[i] = acc;
        }
      }
    } else {
      // PKO / freezeout-with-bounty path. Keep the accumulating-head
      // progression and the full-range harmonic bustsAtPos.
      const Hprefix = new Float64Array(N);
      let hAcc = 0;
      for (let k = 1; k < N; k++) {
        hAcc += 1 / k;
        Hprefix[k] = hAcc;
      }
      const totalH = Hprefix[N - 1];
      for (let i = 0; i < N; i++) {
        bountyKmean[i] = totalH - Hprefix[i];
      }

      // Progressive PKO: at bust m (1..N−1) we have (N−m+1) alive players
      // sharing total head mass T(m−1), starting at T(0)=N×B. Each KO
      // pays avgHead/2 cash, the same amount is consumed from the pool:
      //   h(m)   = T(m−1) / (N−m+1)
      //   cash_m = h(m) / 2
      //   T(m)   = T(m−1) − cash_m
      // Expected cash for finisher at 1-indexed place p is
      //   Σ_{m=1..N−p} cash_m / (N−m)
      // plus T(N−1) for the winner as their final own-head.
      // Per-seat B factors out — normalized away — so we initialise
      // T(0)=N and read cash_m in the same arbitrary unit.
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
      raw[0] += Tfinal; // winner's own final head
      if (brSampler === null) {
        pkoKoCash = new Float64Array(N);
        for (let m = 1; m <= N - 1; m++) pkoKoCash[N - m] = cashAtBust[m - 1];
        pkoWinnerHead = Tfinal;
      }
    }

    // Normalize so Σ pmf[i]·bountyByPlace[i] = bountyMean (ROI intact).
    // BR is special: the GG tier table fixes mean $/envelope, so we scale
    // expected KO counts (`bountyKmean`) to hit the budget and keep
    // `bountyByPlace / bountyKmean` constant at the profile mean.
    let Z = 0;
    for (let i = 0; i < N; i++) Z += pmf[i] * raw[i];
    bountyByPlace = new Float64Array(N);
    if (brSampler !== null && Z > 1e-12 && brSampler.meanValue > 1e-12) {
      const kScale = bountyMean / (brSampler.meanValue * Z);
      for (let i = 0; i < N; i++) {
        const lam = raw[i] * kScale;
        bountyKmean[i] = lam;
        bountyByPlace[i] = lam * brSampler.meanValue;
      }
    } else if (Z > 1e-12) {
      const scale = bountyMean / Z;
      for (let i = 0; i < N; i++) bountyByPlace[i] = raw[i] * scale;
      if (pkoKoCash !== null) {
        pkoRawInv = new Float64Array(N);
        for (let i = 0; i < N; i++) if (raw[i] > 0) pkoRawInv[i] = 1 / raw[i];
        // Knockouts at their stage's mean cash already carry the Bernoulli
        // count, which is the tree's own; a mean-one log-normal factor per
        // knockout, sized per place, adds the rest of the tree's spread
        // (victim head sizes and the winner's head growing with the own
        // knockouts). A Mystery log-variance set on the row stacks on top as
        // its own channel. Where the count alone already spreads more than the
        // tree (2nd place in fields of 4 to 44, 3rd in fields of 5 to 10: a
        // player who knocks out more meets smaller heads) no factor can narrow
        // it, so the hauls that hold a knockout are pulled toward their own
        // mean instead. The place keeps its mean and the tree's chance of no
        // knockout, i / (N − 1); the variance that chance alone carries,
        // m² i / (N − 1 − i), is the floor of the shrink, and the tree's sits
        // above it because the tree has the same chance and mean. The 1e-9 on
        // both sides keeps rounding off the factor and the shrink.
        const treeVariance = pkoTreeVarianceByPlace(N);
        const extraLogVar = Math.max(0, row.mysteryBountyVariance ?? 0);
        pkoKoLogSigma = new Float64Array(N);
        pkoHaulVariance = new Float64Array(N);
        pkoHaulShrink = new Float64Array(N).fill(1);
        pkoHaulShift = new Float64Array(N);
        let countMoment = 0;
        let meanSquare = 0;
        for (let i = N - 2; i >= 0; i--) {
          const j = i + 1;
          const c2 = pkoKoCash[j] * pkoKoCash[j];
          countMoment += c2 / j;
          meanSquare += c2 / (j * j);
          const spread = (treeVariance[i] + meanSquare) / countMoment;
          const logVar = (spread > 1 + 1e-9 ? Math.log(spread) : 0) + extraLogVar;
          pkoKoLogSigma[i] = Math.sqrt(logVar);
          pkoHaulVariance[i] = countMoment * Math.exp(logVar) - meanSquare;
          if (spread < 1 - 1e-9) {
            const noKnockout = i / (N - 1);
            const knockoutMean = raw[i] / (1 - noKnockout);
            const floor = noKnockout * knockoutMean * raw[i];
            const target = (treeVariance[i] + meanSquare) * Math.exp(extraLogVar) - meanSquare;
            const shrink = Math.sqrt((target - floor) / (pkoHaulVariance[i] - floor));
            pkoHaulShrink[i] = shrink;
            pkoHaulShift[i] = (1 - shrink) * knockoutMean;
            pkoHaulVariance[i] = target;
          }
        }
      }
    } else if (pmf[0] > 1e-12) {
      // An empty KO window (a Mystery table that pays one place, heads-up
      // included) still has a last knockout, and the winner makes it. A lump
      // on every place paid the loser a bounty and halved the heads-up σ.
      // One deterministic envelope keeps the bounty RNG of later rows intact.
      bountyByPlace[0] = bountyMean / pmf[0];
    } else {
      for (let i = 0; i < N; i++) bountyByPlace[i] = bountyMean;
    }
    bountyRaw = raw;
  }

  // Derived bountyKmean transforms. Hoisting these out of the hot loop saves
  // one exp and one divide per tournament in bounty rows.
  let bountyKmeanExp: Float64Array | null = null;
  let bountyKmeanInv: Float64Array | null = null;
  if (bountyKmean !== null) {
    bountyKmeanExp = new Float64Array(N);
    bountyKmeanInv = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const lam = bountyKmean[i];
      if (lam > 0) {
        bountyKmeanExp[i] = Math.exp(-lam);
        bountyKmeanInv[i] = 1 / lam;
      }
    }
  }

  // ---- PKO latent-heat bank (variant D) ---------------------------------
  // Precompute HEAT_BIN_COUNT alternative `bountyByPlace` curves, each
  // reshaping the raw cumulative-cash weights by raising to exponent
  // `1 + pkoHeat · z_b`, then re-normalized against the (unchanged)
  // calibrated pmf so every bin has the same mean bounty. Hot bins
  // (exp > 1) push bounty mass onto the very deepest finishes; cold bins
  // (exp < 1) flatten it. The player's finish pmf and prize curve are
  // untouched, so ROI stays exactly on target while the right tail of
  // the bounty haul distribution fattens.
  const pkoHeat = gameType === "ocean-ko" ? 0 : Math.max(0, row.pkoHeat ?? 0);
  let heatBountyByPlace: Float64Array[] | null = null;
  if (pkoHeat > 0 && bountyMean > 0 && bountyRaw !== null) {
    heatBountyByPlace = new Array(HEAT_BIN_COUNT);
    const rawRef = bountyRaw;
    for (let b = 0; b < HEAT_BIN_COUNT; b++) {
      const z =
        -HEAT_Z_RANGE + (2 * HEAT_Z_RANGE * b) / (HEAT_BIN_COUNT - 1);
      // Clamp exponent below at 0.05 so a strongly-cold bin doesn't
      // collapse tiny raw values to ~constant (which would flatten bbp
      // to near-uniform and erase the "deep runs pay more" signal).
      const exp = Math.max(0.05, 1 + pkoHeat * z);
      const reshaped = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        const v = rawRef[i];
        reshaped[i] = v > 0 ? Math.pow(v, exp) : 0;
      }
      let Zb = 0;
      for (let i = 0; i < N; i++) Zb += pmf[i] * reshaped[i];
      const bbpBin = new Float64Array(N);
      if (Zb > 1e-12) {
        const scale = bountyMean / Zb;
        for (let i = 0; i < N; i++) bbpBin[i] = reshaped[i] * scale;
      } else {
        bbpBin.fill(bountyMean);
      }
      heatBountyByPlace[b] = bbpBin;
    }
  }

  // ---- pmf integrity check ------------------------------------------------
  // Downstream hot-loop assumes pmf is a proper distribution. Catch bugs in
  // finishModel / sit-through / custom-payout code paths before they
  // leak into sampling.
  if (process.env.NODE_ENV !== "production") {
    let pmfSum = 0;
    for (let i = 0; i < N; i++) {
      const p = pmf[i];
      if (!Number.isFinite(p) || p < 0) {
        throw new Error(
          `engine: pmf[${i}] invalid (${p}) for row "${row.label || row.id}"`,
        );
      }
      pmfSum += p;
    }
    if (Math.abs(pmfSum - 1) > 1e-9) {
      throw new Error(
        `engine: pmf Σ=${pmfSum} off from 1 for row "${row.label || row.id}"`,
      );
    }
  }

  // ---- analytical per-bullet mean ----------------------------------------
  // E[prize + bounty] over the calibrated pmf. The matching σ lives in
  // `compiledEntryMoments`, which also carries the per-KO bounty noise, the
  // heat bank and the field-size mixture.
  let eX = 0;
  for (let i = 0; i < N; i++) {
    const p = pmf[i];
    if (p <= 0) continue;
    eX += p * (prizeByPlace[i] + (bountyByPlace ? bountyByPlace[i] : 0));
  }

  // Per-KO log-variance of the Poisson-count bounty draw. A PKO row that plays
  // the elimination tree takes its head spread from the tree (`pkoKoLogSigma`).
  const perKoLogVar = gameType === "ocean-ko" ? 0 :
    Math.max(0, row.mysteryBountyVariance ?? 0);

  // With PD's finish model off the pass plays the row's ITM, stamped from the
  // row's own payout table, on PD's table and pool, where it may not pay the
  // ROI at any α. Such a row is solved again with a free ITM and plays that
  // solution when it lands closer to the ROI, so the pane plays the ROI it
  // prints; a row that hits keeps its ITM and its bytes. Fixed-shape models
  // never aim at the ROI, so a gap there is not a missed target
  // (`rowIgnoresRoi`), unless the bounty pool cut the KO EV that closes it.
  const aimsAtRoi = isAlphaAdjustable(model) || settled.poolCut;
  if (
    calibrationMode === "primedope-binary-itm" &&
    !pdFlags.usePdFinishModel &&
    row.itmRate != null &&
    row.itmRate > 0 &&
    aimsAtRoi &&
    !withinTargetEv(eX, totalWinningsEV)
  ) {
    const freeItm = compileSingleEntry(
      { ...row, itmRate: undefined },
      idx,
      players,
      model,
      calibrationMode,
      primedopeStyleEV,
      forcePrimedopePayouts,
      pdFlags,
    );
    if (
      Math.abs(freeItm.analyticMeanSingle - totalWinningsEV) <
      Math.abs(eX - totalWinningsEV)
    ) {
      return freeItm;
    }
  }
  const primedopeTargetMissed =
    calibrationMode === "primedope-binary-itm" &&
    pdFlags.usePdFinishModel &&
    Math.abs(eX - totalWinningsEV) > 1e-3;
  // Neither the row's ITM nor a free one reaches the ROI in this pass.
  const primedopeFreeItmMissed =
    calibrationMode === "primedope-binary-itm" &&
    !pdFlags.usePdFinishModel &&
    aimsAtRoi &&
    !withinTargetEv(eX, totalWinningsEV);
  // `validateSchedule` blocks this in the app. The warning makes `compile` take
  // the expected profit from the pmf for a caller that skips it (scripts,
  // fits); cost x ROI would sit the whole gap away from the samples.
  const targetUnreachable =
    calibrationMode !== "primedope-binary-itm" &&
    aimsAtRoi &&
    !withinTargetEv(eX, totalWinningsEV);

  // Attach discrete envelope tiers only for GG Mystery Battle Royale.
  // The sampler replaces the log-normal per-KO draw inside the hot loop,
  // restoring the heavy-tailed jackpot shape that ~1.8 log-variance can't
  // reach. Non-BR rows keep the log-normal path (fields smoothly varying
  // around `bountyMean` with the configured σ²).

  return {
    oceanKo,
    isSatellite: row.payoutStructure === "satellite-ticket",
    calibrationWarning: primedopeTargetMissed
      ? { rowId: row.id, kind: "primedope-target-clamped", targetWinnings: totalWinningsEV, actualWinnings: eX }
      : primedopeFreeItmMissed
        ? { rowId: row.id, kind: "primedope-free-itm-unreachable", targetWinnings: totalWinningsEV, actualWinnings: eX }
        : targetUnreachable
          ? { rowId: row.id, kind: "target-unreachable", targetWinnings: totalWinningsEV, actualWinnings: eX }
          : undefined,
    bountyPoolCut: settled.poolCut,
    rowIdx: idx,
    fieldSize: N,
    singleCost: entryCostSingle,
    rakebackBonusPerBullet: 0,
    paidCount,
    aliasProb,
    aliasIdx,
    prizeByPlace,
    alpha,
    itm: itmProbability(pmf, paidCount),
    bountyByPlace,
    bountyKmean,
    bountyKmeanExp,
    bountyKmeanInv,
    pkoKoCash: pkoRawInv !== null ? pkoKoCash : null,
    pkoRawInv,
    pkoKoLogSigma,
    pkoHaulVariance,
    pkoHaulShrink,
    pkoHaulShift,
    pkoWinnerHead: pkoRawInv !== null ? pkoWinnerHead : 0,
    mysteryBountyLogVar: perKoLogVar,
    mysteryBountyLogSigma: perKoLogVar > 0 ? Math.sqrt(perKoLogVar) : 0,
    mysteryBountyExpMinus1: perKoLogVar > 0 ? Math.exp(perKoLogVar) - 1 : 0,
    analyticMeanSingle: eX,
    heatBountyByPlace,
    brTierRatios: bountyByPlace !== null ? brSampler?.ratios ?? null : null,
    brTierAliasProb: bountyByPlace !== null ? brSampler?.aliasProb ?? null : null,
    brTierAliasIdx: bountyByPlace !== null ? brSampler?.aliasIdx ?? null : null,
    isBattleRoyale:
      row.payoutStructure === "battle-royale" || gameType === "mystery-royale",
    battleRoyaleLeaderboardShare: 0,
  };
}

interface PdCompareFlags {
  usePdFinishModel: boolean;
  usePdRakeMath: boolean;
}

export function compileRowVariants(
  row: TournamentRow,
  idx: number,
  model: SimulationInput["finishModel"],
  calibrationMode: CalibrationMode,
  primedopeStyleEV: boolean,
  forcePrimedopePayouts: boolean,
  pdFlags: PdCompareFlags = { usePdFinishModel: false, usePdRakeMath: false },
): { entry: CompiledEntry; share: number }[] {
  const sizes = fieldVariantSizes(row);
  const share = 1 / sizes.length;
  return sizes.map((players) => ({
    entry: compileSingleEntry(row, idx, players, model, calibrationMode, primedopeStyleEV, forcePrimedopePayouts, pdFlags),
    share,
  }));
}
