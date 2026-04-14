import { getPayoutTable } from "./payouts";
import {
  buildAliasTable,
  buildBinaryItmAssets,
  buildCDF,
  buildFinishPMF,
  calibrateAlpha,
  itmProbability,
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
  /**
   * Mystery-bounty log-space variance σ² per KO. When > 0 the realized
   * bounty haul is multiplied by a log-normal draw with mean 1 and log-
   * variance σ²/k (Fenton–Wilkinson aggregate-of-k-lognormals approx),
   * so each KO independently rolls a possibly-huge or possibly-tiny $
   * value. Mean preserved, only variance added. 0 means flat bounties.
   */
  mysteryBountyLogVar: number;
  /** Precomputed `exp(mysteryBountyLogVar) − 1`. Used by the Fenton–Wilkinson
   *  scaling inside the hot loop — hoisted here to save one `Math.exp` call
   *  per KO draw. Zero when `mysteryBountyLogVar` is zero (mystery bounty off).
   */
  mysteryBountyExpMinus1: number;
  /**
   * Expected number of knockouts by finish place. Used by the hot loop to
   * add within-place stochastic noise to the bounty haul: at a fixed place
   * the realized KO count is Poisson-ish around `bountyKmean[place]`, so the
   * realized bounty payout equals `bountyByPlace[place] × K / kmean` with K
   * drawn from a Gaussian approximation around that mean. Mean is preserved
   * exactly, but the per-tournament variance that was previously zero within
   * place is now modelled. Shares null with bountyByPlace.
   */
  bountyKmean: Float64Array | null;
  /**
   * Analytical per-tourney σ from the calibrated pmf — √(E[X²]−E[X]²) on
   * prize + bounty. Cheap, compile-time, and independent of the MC run;
   * used to cross-check MC σ in diagnostics.
   */
  sigmaSingleAnalytic: number;
}

interface CompiledSchedule {
  flat: CompiledEntry[];
  totalBuyIn: number;
  tournamentsPerSample: number;
  /** flat.length / scheduleRepeats — used as session boundary in the hot loop. */
  tournamentsPerPass: number;
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
  const primedopeStyleEV = input.primedopeStyleEV ?? false;
  const variants: { entry: CompiledEntry; share: number }[][] =
    input.schedule.map((row, idx) =>
      compileRowVariants(row, idx, input.finishModel, calibrationMode, primedopeStyleEV),
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

  const reps = Math.max(1, input.scheduleRepeats);
  return {
    flat,
    totalBuyIn,
    tournamentsPerSample: flat.length,
    tournamentsPerPass: Math.max(1, Math.floor(flat.length / reps)),
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
  primedopeStyleEV = false,
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
  if (row.reentryRate != null && !(row.reentryRate >= 0 && row.reentryRate <= 1)) {
    throw new Error(
      `engine: row "${label}" reentryRate must be in [0,1] (got ${row.reentryRate})`,
    );
  }
  if (row.maxEntries != null && !(row.maxEntries >= 1)) {
    throw new Error(`engine: row "${label}" maxEntries must be ≥ 1 (got ${row.maxEntries})`);
  }
  if (row.mysteryBountyVariance != null && !(row.mysteryBountyVariance >= 0)) {
    throw new Error(
      `engine: row "${label}" mysteryBountyVariance must be ≥ 0 (got ${row.mysteryBountyVariance})`,
    );
  }

  // Late-registration: the real field at reg-close is the nominal field
  // scaled by `lateRegMultiplier`. Scales prize pool and paid seats, and
  // widens the finish-position shape. Defaults to 1 (no late reg).
  const lateRegMult = Math.max(1, row.lateRegMultiplier ?? 1);
  const N = Math.max(1, Math.floor(players * lateRegMult));

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
  // PrimeDope's site computes everything (cost, EV, ROI, SD) on the bare
  // buy-in, ignoring rake entirely. When this run is in PrimeDope-display
  // mode, drop rake from the cost basis too — otherwise the displayed mean
  // would diverge from PrimeDope's by exactly the rake. Applies to BOTH
  // the alpha and binary-ITM calibrations so the side-by-side comparison
  // is on the same accounting basis.
  const entryCostSingle = primedopeStyleEV
    ? row.buyIn
    : row.buyIn * (1 + row.rake);
  const costPerEntry = entryCostSingle * (1 + reentryExpected);
  // Field-average extra entries inflate the prize pool too.
  const effectiveSeats = N * (1 + reentryExpected);
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
  // In the PrimeDope comparison run (binary-ITM), substitute PD's actual
  // payout curve (h[8] from tmp_legacy.js) so the side-by-side matches
  // their reported σ within Monte Carlo noise. The primary α-calibrated
  // run still uses whatever curve the user selected.
  const effectivePayoutStructure =
    calibrationMode === "primedope-binary-itm"
      ? "mtt-primedope"
      : row.payoutStructure;
  let payouts = getPayoutTable(
    effectivePayoutStructure,
    N,
    row.customPayouts,
  );

  // ---- ICM final-table reweight ------------------------------------------
  if (row.icmFinalTable) {
    const ftSize = Math.max(2, Math.floor(row.icmFinalTableSize ?? 9));
    payouts = applyICMToPayoutTable(payouts, ftSize, 0.4);
  }

  const paidCount = payouts.reduce((n, p) => (p > 0 ? n + 1 : n), 0);

  // ---- finish distribution -----------------------------------------------
  let pmf: Float64Array;
  let alpha = 0;
  let binaryItmPrizeOverride: Float64Array | null = null;
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
  if (calibrationMode === "primedope-binary-itm") {
    // entryCostSingle has already dropped rake when pdDisplayMode is on, so
    // targetRegular is naturally PrimeDope-style. Otherwise we calibrate
    // against our normal cost-with-rake basis.
    const assets = buildBinaryItmAssets(
      N,
      paidCount,
      payouts,
      prizePool,
      targetRegular,
    );
    pmf = assets.pmf;
    binaryItmPrizeOverride = assets.prizeByPlace;
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
  if (binaryItmPrizeOverride) {
    prizeByPlace.set(binaryItmPrizeOverride);
  } else {
    for (let i = 0; i < Math.min(payouts.length, N); i++) {
      prizeByPlace[i] = payouts[i] * prizePool;
    }
  }

  // ---- "sit through pay jumps" transform --------------------------------
  // Reshape pmf so the player min-cashes less and deep-runs more, with a
  // compensating mass flowing into busts. EV-preserving by construction
  // (the bust/top split is chosen so Σ pmf·prize is unchanged).
  if (
    row.sitThroughPayJumps &&
    paidCount >= 4 &&
    calibrationMode !== "primedope-binary-itm"
  ) {
    const q = Math.max(0, Math.min(1, row.payJumpAggression ?? 0.5));
    if (q > 0) {
      const half = Math.max(1, Math.floor(paidCount / 2));
      // Top-half paid = [0, half); bottom-half paid = [half, paidCount).
      let massBottom = 0;
      let ePrizeBottom = 0; // Σ pmf[i]·prize[i] over bottom
      let massTop = 0;
      let ePrizeTop = 0;
      for (let i = 0; i < half; i++) {
        massTop += pmf[i];
        ePrizeTop += pmf[i] * prizeByPlace[i];
      }
      for (let i = half; i < paidCount; i++) {
        massBottom += pmf[i];
        ePrizeBottom += pmf[i] * prizeByPlace[i];
      }
      const removed = q * massBottom;
      if (removed > 0 && massTop > 0 && ePrizeTop > 0) {
        // Per-$ top-redistribution uses mass weighted by prize: deeper
        // finishes absorb more. Let x = fraction of `removed` that flows
        // into top (rest goes to bust). EV delta vs original:
        //   ΔEV = x · (ePrizeTop / massTop) · removed   ← top bonus
        //       − (ePrizeBottom / massBottom) · removed ← bottom loss
        // Set ΔEV = 0:
        //   x = (ePrizeBottom / massBottom) · (massTop / ePrizeTop)
        const avgBottom = ePrizeBottom / massBottom;
        const avgTop = ePrizeTop / massTop;
        let x = avgBottom / avgTop;
        if (!Number.isFinite(x) || x < 0) x = 0;
        if (x > 1) x = 1;
        const toTop = removed * x;
        const toBust = removed * (1 - x);
        // Shrink bottom bracket.
        const bottomScale = 1 - q;
        for (let i = half; i < paidCount; i++) pmf[i] *= bottomScale;
        // Distribute `toTop` across top paid proportional to pmf[i]·prize[i]
        // (so pricier places pick up more of the absorption).
        for (let i = 0; i < half; i++) {
          pmf[i] += toTop * ((pmf[i] * prizeByPlace[i]) / ePrizeTop);
        }
        // Distribute `toBust` uniformly across unpaid places.
        const bustCount = N - paidCount;
        if (bustCount > 0 && toBust > 0) {
          const perBust = toBust / bustCount;
          for (let i = paidCount; i < N; i++) pmf[i] += perBust;
        } else if (bustCount === 0) {
          // Degenerate: no unpaid places. Fold toBust back into top instead.
          for (let i = 0; i < half; i++) {
            pmf[i] += toBust * ((pmf[i] * prizeByPlace[i]) / ePrizeTop);
          }
        }
        // Floating-point guard: re-normalize to 1.
        let s = 0;
        for (let i = 0; i < N; i++) s += pmf[i];
        if (s > 0 && Math.abs(s - 1) > 1e-12) {
          const k = 1 / s;
          for (let i = 0; i < N; i++) pmf[i] *= k;
        }
      }
    }
  }

  const cdf = buildCDF(pmf);
  const { prob: aliasProb, alias: aliasIdx } = buildAliasTable(pmf);

  // ---- bounty distribution across finish places -------------------------
  // Elimination-order model: the player finishing at 1-indexed place p was
  // alive for the first N−p busts. Expected eliminations over those busts
  // equals H_{N−1} − H_{p−1} (standard KO). For PKO we instead weight each
  // of those KOs by the expected head-size at the moment it happened, using
  // the accumulating-head recurrence below.
  //
  // The final raw weights are normalized against the calibrated pmf so that
  // Σ pmf[i] · bountyByPlace[i] === bountyMean. This preserves ROI
  // calibration while shifting all the bounty variance onto the shape of
  // the finish distribution. bountyKmean[i] holds the expected KO count at
  // place i and is used by the hot loop to add within-place Poisson-style
  // stochastic noise around the mean.
  let bountyByPlace: Float64Array | null = null;
  let bountyKmean: Float64Array | null = null;
  if (bountyMean > 0 && N >= 2) {
    // Prefix harmonic numbers: Hprefix[k] = 1 + 1/2 + ... + 1/k, Hprefix[0] = 0.
    const Hprefix = new Float64Array(N);
    let hAcc = 0;
    for (let k = 1; k < N; k++) {
      hAcc += 1 / k;
      Hprefix[k] = hAcc;
    }
    const totalH = Hprefix[N - 1]; // H_{N−1}

    const raw = new Float64Array(N);
    bountyKmean = new Float64Array(N);
    // Expected KO count by 0-indexed place i = H_{N−1} − H_{p−1} with p=i+1.
    for (let i = 0; i < N; i++) {
      bountyKmean[i] = totalH - Hprefix[i];
    }

    {
      // Progressive PKO: head pool accumulates. At bust m (1..N−1) we have
      // (N−m+1) alive players sharing total head mass T(m−1), starting at
      // T(0)=N×B where B=per-seat bounty. Each KO pays avgHead/2 cash, and
      // the same amount is consumed from the pool:
      //   h(m)   = T(m−1) / (N−m+1)
      //   cash_m = h(m) / 2
      //   T(m)   = T(m−1) − cash_m
      // Expected cash for finisher at 1-indexed place p is
      //   Σ_{m=1..N−p} cash_m / (N−m)
      // (they're 1 of (N−m) potential killers among alive non-victims), and
      // the winner additionally collects T(N−1) as their final head at the
      // end of the tournament.
      //
      // Per-seat B factors out — we're going to normalize away — so we
      // initialise T(0)=N and read cash_m in the same arbitrary unit.
      const cashAtBust = new Float64Array(N - 1); // cash_m for m=1..N−1 at index m−1
      let T = N;
      for (let m = 1; m <= N - 1; m++) {
        const h = T / (N - m + 1);
        const cash = h / 2;
        cashAtBust[m - 1] = cash;
        T -= cash;
      }
      const Tfinal = T; // head mass left with the winner

      // cumulativeCash[j] = Σ_{m=1..j} cash_m / (N−m). Then for 1-indexed
      // place p, bounty weight = cumulativeCash[N−p]. This is monotonically
      // increasing in (N−p), so deep finishers win more — as expected, with
      // the winner also getting the Tfinal top-up.
      const cumulativeCash = new Float64Array(N); // index p-1 → player at place p
      // Build forward sum of cash_m/(N−m) for m=1..N−1
      const prefix = new Float64Array(N); // prefix[k] = sum over m=1..k of term
      let acc = 0;
      for (let m = 1; m <= N - 1; m++) {
        acc += cashAtBust[m - 1] / (N - m);
        prefix[m] = acc;
      }
      for (let i = 0; i < N; i++) {
        const p = i + 1;
        // Sum up to m = N−p:
        const upto = N - p;
        cumulativeCash[i] = upto > 0 ? prefix[upto] : 0;
      }
      // Winner (i=0) gets Tfinal on top of their in-game KO cash.
      cumulativeCash[0] += Tfinal;

      for (let i = 0; i < N; i++) raw[i] = cumulativeCash[i];
    }

    // Normalize so Σ pmf[i]·bountyByPlace[i] = bountyMean (ROI intact).
    let Z = 0;
    for (let i = 0; i < N; i++) Z += pmf[i] * raw[i];
    bountyByPlace = new Float64Array(N);
    if (Z > 1e-12) {
      const scale = bountyMean / Z;
      for (let i = 0; i < N; i++) bountyByPlace[i] = raw[i] * scale;
    } else {
      for (let i = 0; i < N; i++) bountyByPlace[i] = bountyMean;
    }
  }

  // ---- pmf integrity check ------------------------------------------------
  // Downstream hot-loop assumes pmf is a proper distribution. Catch bugs in
  // finishModel / sit-through / ICM / custom-payout code paths before they
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

  // ---- analytical per-tourney σ (self-check / diagnostic) ----------------
  // σ² = E[X²] − E[X]² on (prize + bounty − singleCost). Cheap to compute
  // from pmf and used as a sanity metric next to MC σ in the results view.
  let eX = 0;
  let eX2 = 0;
  for (let i = 0; i < N; i++) {
    const p = pmf[i];
    if (p <= 0) continue;
    const prize = prizeByPlace[i] + (bountyByPlace ? bountyByPlace[i] : 0);
    eX += p * prize;
    eX2 += p * prize * prize;
  }
  const varSingle = Math.max(0, eX2 - eX * eX);
  const sigmaSingleAnalytic = Math.sqrt(varSingle);

  return {
    rowIdx: idx,
    costPerEntry,
    singleCost: entryCostSingle,
    maxEntries,
    reRate,
    paidCount,
    cdf,
    aliasProb,
    aliasIdx,
    prizeByPlace,
    alpha,
    itm: itmProbability(pmf, paidCount),
    reentryExpected,
    bountyByPlace,
    bountyKmean,
    mysteryBountyLogVar: Math.max(0, row.mysteryBountyVariance ?? 0),
    mysteryBountyExpMinus1:
      row.mysteryBountyVariance && row.mysteryBountyVariance > 0
        ? Math.exp(row.mysteryBountyVariance) - 1
        : 0,
    sigmaSingleAnalytic,
  };
}

function compileRowVariants(
  row: TournamentRow,
  idx: number,
  model: SimulationInput["finishModel"],
  calibrationMode: CalibrationMode,
  primedopeStyleEV: boolean,
): { entry: CompiledEntry; share: number }[] {
  const fv = row.fieldVariability;
  if (!fv || fv.kind === "fixed") {
    return [
      {
        entry: compileSingleEntry(row, idx, row.players, model, calibrationMode, primedopeStyleEV),
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
        entry: compileSingleEntry(row, idx, mid, model, calibrationMode, primedopeStyleEV),
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
      entry: compileSingleEntry(row, idx, players, model, calibrationMode, primedopeStyleEV),
      share,
    });
  }
  return variants;
}

type ProgressCb = (done: number, total: number) => void;

/**
 * Polar Box-Muller: maps two uniform draws to a standard normal. We burn
 * at most a couple of extra rng() calls per sample for the rejection —
 * negligible vs. the inner tournament loop. Kept for paths that only need
 * a single draw (e.g. per-sample deltaROI); hot-loop paths use makeGauss
 * below which caches the second value.
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

/**
 * Marsaglia polar gaussian factory. The polar method natively yields two
 * independent N(0,1) draws per accepted (u,v); `boxMuller` above discards
 * the second. This factory caches it, halving `log`/`sqrt` cost on the
 * second call. Bind one closure per RNG stream at the top of the hot loop.
 */
function makeGauss(rng: () => number): () => number {
  let hasCached = false;
  let cached = 0;
  return () => {
    if (hasCached) {
      hasCached = false;
      return cached;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = rng() * 2 - 1;
      v = rng() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    cached = v * m;
    hasCached = true;
    return u * m;
  };
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
        calibrationMode: "primedope-binary-itm",
        compareWithPrimedope: false,
      },
      secondHalf,
    );
    return { ...primary, comparison };
  }

  const compiled = compileSchedule(input, calibrationMode);
  const N = compiled.tournamentsPerSample;
  const S = input.samples;

  if (N === 0 || S === 0) throw new Error("Empty schedule or zero samples");

  const grid = makeCheckpointGrid(N);
  const shard = simulateShard(input, compiled, 0, S, grid, onProgress);
  return buildResult(input, compiled, shard, calibrationMode, grid);
}

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
    longestCashless,
    recoveryLengths,
    rowProfits,
    ruinedCount,
  } = shard;
  let expectedProfitAccum = 0;
  for (let s = 0; s < S; s++) expectedProfitAccum += finalProfits[s];

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
    // Clamp exp arg to avoid Infinity — for strongly negative drift this
    // term blows up but is capped at 1 (a probability).
    const expTerm = expArg > 700 ? 1 : Math.exp(expArg);
    const p = normalCdf(a) + Math.min(1, expTerm) * normalCdf(b);
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
  // of samples go below.
  const worstLosses = Float64Array.from(runningMins)
    .map((v) => -v)
    .sort();
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
  const histogram = histogramOf(finalProfits, 60);
  const drawdownHistogram = histogramOf(maxDrawdowns, 50, true);
  // Streak histograms — distribution of max drawdown / longest cashless /
  // longest breakeven / recovery length across samples. Int32Array → Float64
  // copy is cheap. Recovery uses recovered-only (unrecovered share is
  // reported separately in stats).
  const longestBreakevenF = new Float64Array(S);
  const longestCashlessF = new Float64Array(S);
  for (let s = 0; s < S; s++) {
    longestBreakevenF[s] = longestBreakevens[s];
    longestCashlessF[s] = longestCashless[s];
  }
  const longestBreakevenHistogram = histogramOf(longestBreakevenF, 40, true);
  const longestCashlessHistogram = histogramOf(longestCashlessF, 40, true);

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

  // Envelope percentiles: sorting K1 full columns of a 1M-sample run is
  // ≈80 × O(S log S) ≈ 1.6 B ops — freezes the worker at 99% for tens of
  // seconds. Subsample uniformly for the quantile computation (mean still
  // runs on the full S, which is just an additive loop and cheap).
  // Accuracy at the reported percentiles: p0015 / p9985 need ≥ 1 / (1-p)
  // samples minimum, so we cap at ≥ 20k; 50k keeps all six percentiles
  // within ~0.3 σ of the exact answer and runs in ~200 ms total.
  const ENV_CAP = 50_000;
  const envS = Math.min(S, ENV_CAP);
  const envStride = S / envS;
  const col = new Float64Array(envS);
  for (let j = 0; j < K1; j++) {
    // Mean on the full S (cheap accumulator, no sort needed).
    let acc = 0;
    for (let s = 0; s < S; s++) acc += pathMatrix[s * K1 + j];
    mean_[j] = acc / S;
    // Percentiles on a stratified subsample of size envS.
    for (let s = 0; s < envS; s++) {
      const src = Math.min(S - 1, Math.floor(s * envStride));
      col[s] = pathMatrix[src * K1 + j];
    }
    col.sort();
    p15[j] = col[Math.floor(0.15 * (envS - 1))];
    p85[j] = col[Math.floor(0.85 * (envS - 1))];
    p025[j] = col[Math.floor(0.025 * (envS - 1))];
    p975[j] = col[Math.floor(0.975 * (envS - 1))];
    p0015[j] = col[Math.floor(0.0015 * (envS - 1))];
    p9985[j] = col[Math.floor(0.9985 * (envS - 1))];
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

  // "Best" = sample with the highest final profit (the upswing fairy tale).
  // "Worst" = sample with the deepest peak-to-trough drawdown — NOT lowest
  // final profit. This way the visual peak-to-trough span on the worst line
  // matches the reported max-downswing stat exactly, instead of being some
  // unrelated path that just happened to end at the bottom.
  let bestIdx = 0;
  let worstIdx = 0;
  for (let s = 1; s < S; s++) {
    if (finalProfits[s] > finalProfits[bestIdx]) bestIdx = s;
    if (maxDrawdowns[s] > maxDrawdowns[worstIdx]) worstIdx = s;
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

  // Tail quantiles of max drawdown — a straight answer to
  // "how bad is a typical/5%/1% worst run". PrimeDope only shows a single
  // aggregate estimate; we expose the whole tail shape.
  const ddSorted = Float64Array.from(maxDrawdowns).sort();
  const ddPct = (p: number) =>
    ddSorted[Math.min(S - 1, Math.max(0, Math.floor(p * (S - 1))))];
  const maxDrawdownMedian = ddPct(0.5);
  const maxDrawdownP95 = ddPct(0.95);
  const maxDrawdownP99 = ddPct(0.99);

  let beMean = 0;
  for (let s = 0; s < S; s++) beMean += longestBreakevens[s];
  beMean /= S;

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
      ? histogramOf(recoveredF, 40, true)
      : { binEdges: [0, 1], counts: [0] };

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
    longestBreakevenHistogram,
    longestCashlessHistogram,
    recoveryHistogram,
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
      maxDrawdownMedian,
      maxDrawdownP95,
      maxDrawdownP99,
      recoveryMedian,
      recoveryP90,
      recoveryUnrecoveredShare,
      longestCashlessMean,
      longestCashlessWorst: cashlessWorst,
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

/**
 * Hastings approximation for the standard normal CDF Φ(z). Same algorithm
 * used by PrimeDope's legacy JS (function `q` at line 1192 of tmp_legacy.js)
 * so the Gaussian-RoR readout lines up with theirs bit-for-bit.
 */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const a = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-a * a);
  return 0.5 * (1 + sign * y);
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

// =====================================================================
// Sharded execution
// ---------------------------------------------------------------------
// The hot loop is extracted here so a worker pool can run disjoint
// [sStart, sEnd) slices on different cores and the main thread can
// merge the raw buffers back together before running aggregation.
//
// Determinism note: the serial engine used to carry a *single* shock RNG
// stream across every sample in the run, which made output depend on
// sample-visit order — fine serially, broken under sharding. The sharded
// version seeds a fresh shock RNG per sample (mixSeed(seed ^ 0xbeef, s))
// so splitting samples across workers produces the same aggregate as a
// monolithic run. Individual sample numerics differ from the pre-shard
// engine, but the statistical expectation is unchanged and all tests
// live inside noise bounds rather than asserting exact byte values.
// =====================================================================

export interface RawShard {
  sStart: number;
  sEnd: number;
  finalProfits: Float64Array;
  pathMatrix: Float64Array;
  maxDrawdowns: Float64Array;
  runningMins: Float64Array;
  longestBreakevens: Int32Array;
  longestCashless: Int32Array;
  recoveryLengths: Int32Array;
  rowProfits: Float64Array;
  ruinedCount: number;
}

export interface CheckpointGrid {
  K: number;
  checkpointIdx: Int32Array;
}

export function makeCheckpointGrid(N: number): CheckpointGrid {
  const K = Math.min(200, N);
  const checkpointIdx = new Int32Array(K + 1);
  for (let j = 0; j <= K; j++) checkpointIdx[j] = Math.round((j * N) / K);
  return { K, checkpointIdx };
}

export function simulateShard(
  input: SimulationInput,
  compiled: CompiledSchedule,
  sStart: number,
  sEnd: number,
  grid: CheckpointGrid,
  onProgress?: ProgressCb,
): RawShard {
  const { K, checkpointIdx } = grid;
  const K1 = K + 1;
  const N = compiled.tournamentsPerSample;
  const numRows = input.schedule.length;
  const bankroll = input.bankroll;
  const shardSize = sEnd - sStart;

  const finalProfits = new Float64Array(shardSize);
  const pathMatrix = new Float64Array(shardSize * K1);
  const maxDrawdowns = new Float64Array(shardSize);
  const runningMins = new Float64Array(shardSize);
  const longestBreakevens = new Int32Array(shardSize);
  const longestCashless = new Int32Array(shardSize);
  const recoveryLengths = new Int32Array(shardSize);
  const rowProfits = new Float64Array(shardSize * numRows);
  let ruinedCount = 0;

  const roiStdErr = Math.max(0, input.roiStdErr ?? 0);
  const sigTourney = Math.max(0, input.roiShockPerTourney ?? 0);
  const sigSession = Math.max(0, input.roiShockPerSession ?? 0);
  const sigDrift = Math.max(0, input.roiDriftSigma ?? 0);
  const driftRho = Math.max(0, Math.min(0.999, input.roiDriftRho ?? 0.95));
  const driftInnovScale = sigDrift * Math.sqrt(1 - driftRho * driftRho);

  const tiltFastGain = input.tiltFastGain ?? 0;
  const tiltFastScale = Math.max(1, input.tiltFastScale ?? 0);
  const tiltFastOn = tiltFastGain !== 0 && tiltFastScale > 0;
  const tiltSlowGain = input.tiltSlowGain ?? 0;
  const tiltSlowThreshold = Math.max(0, input.tiltSlowThreshold ?? 0);
  const tiltSlowMinDur = Math.max(
    0,
    Math.floor(input.tiltSlowMinDuration ?? 500),
  );
  const tiltSlowRecFrac = Math.max(
    0,
    Math.min(1, input.tiltSlowRecoveryFrac ?? 0.5),
  );
  const tiltSlowOn =
    tiltSlowGain !== 0 && tiltSlowThreshold > 0 && tiltSlowMinDur > 0;

  const perPass = compiled.tournamentsPerPass;
  const flat = compiled.flat;

  // Fire ~20 progress messages per shard. More than that thrashes the main
  // thread (postMessage + handler O(n_shards) work per fire); fewer makes
  // the bar feel laggy. 20 is the sweet spot for 50k-sample runs on 8 cores.
  const nextProgressStep = Math.max(1, Math.floor(shardSize / 20));
  let nextProgressAt = nextProgressStep;

  for (let s = sStart; s < sEnd; s++) {
    const localS = s - sStart;
    const rng = mulberry32(mixSeed(input.seed, s));
    // Per-sample shock RNG — decoupled from finish draws and
    // independent of shard boundaries.
    const skillRng = mulberry32(mixSeed((input.seed ^ 0xbeef) >>> 0, s));
    // Dedicated RNG for within-place bounty noise — kept separate so adding
    // a bounty flag doesn't perturb the finish-sampling stream (otherwise
    // same-seed comparison tests between bounty and non-bounty runs drift).
    const bRng = mulberry32(mixSeed((input.seed ^ 0xb01dface) >>> 0, s));
    // Cached-pair gaussians bound to each stream — halves log/sqrt cost
    // relative to the discarding boxMuller.
    const gaussSkill = makeGauss(skillRng);
    const gaussB = makeGauss(bRng);

    const deltaROI = roiStdErr > 0 ? gaussSkill() * roiStdErr : 0;
    let drift = 0;
    let sessionShock = 0;
    let tiltState: -1 | 0 | 1 = 0;
    let tiltAnchor = 0;
    let tiltStreakLen = 0;
    let tiltSwingMag = 0;
    let profit = 0;
    let runningMax = 0;
    let runningMin = 0;
    let maxDD = 0;
    let breakevenLen = 0;
    let longestBreakeven = 0;
    let cashlessRun = 0;
    let longestCashlessRun = 0;
    let ddTroughIdx = -1;
    let sampleRecoveryLen = -1;
    let ruined = false;

    let nextCp = 1;
    let nextCpIdx = checkpointIdx[1];
    const pathBase = localS * K1;
    const rowBase = localS * numRows;

    for (let i = 0; i < N; i++) {
      if ((sigSession > 0 || sigDrift > 0) && i % perPass === 0) {
        if (sigSession > 0) sessionShock = gaussSkill() * sigSession;
        if (sigDrift > 0)
          drift = driftRho * drift + gaussSkill() * driftInnovScale;
      }
      const tourneyShock =
        sigTourney > 0 ? gaussSkill() * sigTourney : 0;

      let tiltShift = 0;
      if (tiltFastOn) {
        const dd = runningMax - profit;
        const upSwing = profit - runningMin;
        const net = dd - upSwing;
        tiltShift -= tiltFastGain * Math.tanh(net / tiltFastScale);
      }
      if (tiltSlowOn) {
        if (tiltState === 0) {
          const dd = runningMax - profit;
          const up = profit - runningMin;
          if (dd >= tiltSlowThreshold) {
            tiltStreakLen++;
            if (tiltStreakLen >= tiltSlowMinDur) {
              tiltState = -1;
              tiltAnchor = profit;
              tiltSwingMag = dd;
              tiltStreakLen = 0;
            }
          } else if (up >= tiltSlowThreshold) {
            tiltStreakLen++;
            if (tiltStreakLen >= tiltSlowMinDur) {
              tiltState = 1;
              tiltAnchor = profit;
              tiltSwingMag = up;
              tiltStreakLen = 0;
            }
          } else {
            tiltStreakLen = 0;
          }
        } else if (tiltState === -1) {
          tiltShift -= tiltSlowGain;
          if (profit - tiltAnchor >= tiltSlowRecFrac * tiltSwingMag) {
            tiltState = 0;
            tiltStreakLen = 0;
          }
        } else {
          tiltShift += tiltSlowGain;
          if (tiltAnchor - profit >= tiltSlowRecFrac * tiltSwingMag) {
            tiltState = 0;
            tiltStreakLen = 0;
          }
        }
      }

      const effectiveDelta =
        deltaROI + drift + sessionShock + tourneyShock + tiltShift;

      const parent = flat[i];
      const variants = parent.variants;
      const t = variants
        ? variants[(rng() * variants.length) | 0]
        : parent;
      const bp = t.bountyByPlace;
      const bkm = t.bountyKmean;
      const prizes = t.prizeByPlace;
      const aliasProb = t.aliasProb;
      const aliasIdx = t.aliasIdx;
      const aliasN = aliasProb.length;
      const single = t.singleCost;
      const bulletCost = single - effectiveDelta * single;
      const maxB = t.maxEntries;
      const pc = t.paidCount;
      const mystVar = t.mysteryBountyLogVar;
      const mystExpM1 = t.mysteryBountyExpMinus1;
      let delta = 0;
      let cashedThisSlot = false;
      if (maxB === 1) {
        // Vose alias: one uniform → O(1) finish draw.
        const r0 = rng() * aliasN;
        const i0 = r0 | 0;
        const place = r0 - i0 < aliasProb[i0] ? i0 : aliasIdx[i0];
        let bountyDraw = 0;
        if (bp !== null) {
          const mean = bp[place];
          if (mean > 0 && bkm !== null) {
            const lam = bkm[place];
            if (lam > 0) {
              let k: number;
              if (lam < 20) {
                const L = Math.exp(-lam);
                let p = 1;
                k = 0;
                do {
                  k++;
                  p *= bRng();
                } while (p > L);
                k--;
              } else {
                const g = lam + gaussB() * Math.sqrt(lam);
                k = g < 0 ? 0 : g;
              }
              bountyDraw = (mean * k) / lam;
              // Mystery-bounty multiplier: Fenton–Wilkinson lognormal
              // approximation of a sum of k i.i.d. lognormal(0, σ²) draws.
              // Per-KO variance is σ². Aggregate log-variance scales as
              // σ_sum² = ln(1 + (e^σ²−1)/k). Mean preserved at k·1 = k,
              // so bountyDraw×scale has the same expectation as bountyDraw.
              if (mystVar > 0 && k > 0 && bountyDraw > 0) {
                const sigSum2 = Math.log(1 + mystExpM1 / k);
                const sigSum = Math.sqrt(sigSum2);
                const scale = Math.exp(
                  sigSum * gaussB() - 0.5 * sigSum2,
                );
                bountyDraw *= scale;
              }
            } else {
              bountyDraw = mean;
            }
          } else {
            bountyDraw = mean;
          }
        }
        delta = prizes[place] + bountyDraw - bulletCost;
        if (place < pc) cashedThisSlot = true;
      } else {
        const reRate = t.reRate;
        for (let b = 0; b < maxB; b++) {
          const r1 = rng() * aliasN;
          const i1 = r1 | 0;
          const place = r1 - i1 < aliasProb[i1] ? i1 : aliasIdx[i1];
          let bountyDraw = 0;
          if (bp !== null) {
            const mean = bp[place];
            if (mean > 0 && bkm !== null) {
              const lam = bkm[place];
              if (lam > 0) {
                // Knuth Poisson for small λ (unbiased); Gaussian approximation
                // for large λ where Poisson is too slow and the normal is tight.
                let k: number;
                if (lam < 20) {
                  const L = Math.exp(-lam);
                  let p = 1;
                  k = 0;
                  do {
                    k++;
                    p *= bRng();
                  } while (p > L);
                  k--;
                } else {
                  const g = lam + gaussB() * Math.sqrt(lam);
                  k = g < 0 ? 0 : g;
                }
                bountyDraw = (mean * k) / lam;
                if (mystVar > 0 && k > 0 && bountyDraw > 0) {
                  const sigSum2 = Math.log(1 + mystExpM1 / k);
                  const sigSum = Math.sqrt(sigSum2);
                  const scale = Math.exp(
                    sigSum * gaussB() - 0.5 * sigSum2,
                  );
                  bountyDraw *= scale;
                }
              } else {
                bountyDraw = mean;
              }
            } else {
              bountyDraw = mean;
            }
          }
          delta += prizes[place] + bountyDraw - bulletCost;
          if (place < pc) {
            cashedThisSlot = true;
            break;
          }
          if (b + 1 < maxB && rng() >= reRate) break;
        }
      }
      profit += delta;
      rowProfits[rowBase + t.rowIdx] += delta;

      if (cashedThisSlot) {
        cashlessRun = 0;
      } else {
        cashlessRun++;
        if (cashlessRun > longestCashlessRun) longestCashlessRun = cashlessRun;
      }

      if (profit > runningMax) {
        runningMax = profit;
        breakevenLen = 0;
        if (ddTroughIdx >= 0 && sampleRecoveryLen < 0) {
          sampleRecoveryLen = i - ddTroughIdx;
        }
      } else {
        breakevenLen++;
        if (breakevenLen > longestBreakeven) longestBreakeven = breakevenLen;
      }
      if (profit < runningMin) runningMin = profit;
      const dd = runningMax - profit;
      if (dd > maxDD) {
        maxDD = dd;
        ddTroughIdx = i;
        sampleRecoveryLen = -1;
      }

      if (bankroll > 0 && !ruined && profit <= -bankroll) ruined = true;

      while (nextCp <= K && i + 1 === nextCpIdx) {
        pathMatrix[pathBase + nextCp] = profit;
        nextCp++;
        if (nextCp <= K) nextCpIdx = checkpointIdx[nextCp];
      }
    }

    finalProfits[localS] = profit;
    maxDrawdowns[localS] = maxDD;
    runningMins[localS] = runningMin;
    longestBreakevens[localS] = longestBreakeven;
    longestCashless[localS] = longestCashlessRun;
    recoveryLengths[localS] = sampleRecoveryLen;
    if (ruined) ruinedCount++;

    if (onProgress && localS + 1 >= nextProgressAt) {
      onProgress(localS + 1, shardSize);
      nextProgressAt += nextProgressStep;
    }
  }
  onProgress?.(shardSize, shardSize);

  return {
    sStart,
    sEnd,
    finalProfits,
    pathMatrix,
    maxDrawdowns,
    runningMins,
    longestBreakevens,
    longestCashless,
    recoveryLengths,
    rowProfits,
    ruinedCount,
  };
}

/**
 * Stitch disjoint shards covering [0, S) into a single RawShard with
 * full-sized buffers. Fast-paths a single full-range shard by returning
 * it directly (no copies).
 */
export function mergeShards(
  shards: RawShard[],
  S: number,
  K1: number,
  numRows: number,
): RawShard {
  if (
    shards.length === 1 &&
    shards[0].sStart === 0 &&
    shards[0].sEnd === S
  ) {
    return shards[0];
  }
  const sorted = shards.slice().sort((a, b) => a.sStart - b.sStart);
  const finalProfits = new Float64Array(S);
  const pathMatrix = new Float64Array(S * K1);
  const maxDrawdowns = new Float64Array(S);
  const runningMins = new Float64Array(S);
  const longestBreakevens = new Int32Array(S);
  const longestCashless = new Int32Array(S);
  const recoveryLengths = new Int32Array(S);
  const rowProfits = new Float64Array(S * numRows);
  let ruinedCount = 0;
  for (const sh of sorted) {
    finalProfits.set(sh.finalProfits, sh.sStart);
    maxDrawdowns.set(sh.maxDrawdowns, sh.sStart);
    runningMins.set(sh.runningMins, sh.sStart);
    longestBreakevens.set(sh.longestBreakevens, sh.sStart);
    longestCashless.set(sh.longestCashless, sh.sStart);
    recoveryLengths.set(sh.recoveryLengths, sh.sStart);
    pathMatrix.set(sh.pathMatrix, sh.sStart * K1);
    rowProfits.set(sh.rowProfits, sh.sStart * numRows);
    ruinedCount += sh.ruinedCount;
  }
  return {
    sStart: 0,
    sEnd: S,
    finalProfits,
    pathMatrix,
    maxDrawdowns,
    runningMins,
    longestBreakevens,
    longestCashless,
    recoveryLengths,
    rowProfits,
    ruinedCount,
  };
}
