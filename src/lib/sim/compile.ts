/**
 * Schedule compilation. `compileSchedule` turns a `SimulationInput` into a
 * flat, shard-independent `CompiledSchedule` (per-entry alias tables, payout
 * curves, α-calibrated finish PMFs, bounty banks). `buildScheduleAnalyticBreakdown`
 * derives the closed-form per-tournament σ used by the convergence widgets.
 * This is the one-time-per-run cost paid before the hot loop fans out.
 *
 * The per-row work lives in `compileEntry.ts`, the closed-form moments in
 * `scheduleMoments.ts`, the row interleaving in `schedulePassOrder.ts`; this
 * module is the orchestrator over the three.
 */
import { compileRowVariants } from "./compileEntry";
import { compiledEntryMoments } from "./scheduleMoments";
import { buildSchedulePassOrder } from "./schedulePassOrder";
import { normalizeGameTypeConsistency } from "./gameType";
import type {
  BattleRoyaleLeaderboardMixRow,
  CompiledEntry,
  CompiledSchedule,
  ScheduleAnalyticBreakdown,
} from "./engineTypes";
import type {
  CalibrationMode,
  SimulationInput,
  TournamentRow,
} from "./types";

export { buildSchedulePassOrder };

// =====================================================================
// Compile phase
// ---------------------------------------------------------------------
// `compileSchedule` walks the user's TournamentRow[], picks effective
// field sizes (handling field variability), runs α-calibration or the
// fixed-ITM solver to produce a finish PMF that hits the per-row ROI
// target, builds alias tables for fast sampling, and assembles the
// flat CompiledEntry[] consumed by the hot loop.
//
// Per-format calibration paths:
//   - α-adjustable (free finish PMF) → calibrateAlpha
//   - fixed-ITM rows → calibrateShelledItm
//   - PrimeDope compare → calibrateShelledItm with PD shell + curves
//   - Battle Royale fixed-ITM → battleRoyaleWinnerFirst
//
// `buildScheduleAnalyticBreakdown` (further down) reuses this same
// compile path to produce per-row dollar variance for the convergence
// widget without running the simulator.
// =====================================================================

export function compileSchedule(
  input: SimulationInput,
  calibrationMode: CalibrationMode = "alpha",
): CompiledSchedule {
  // Normalize BR ↔ mystery-royale pairing at the compile boundary: legacy
  // rows with drifted flags silently get fixed up so both gameType-gated and
  // payoutStructure-gated hot-loop branches see consistent state (#131).
  const normalizedSchedule = input.schedule.map(normalizeGameTypeConsistency);
  input = normalizedSchedule === input.schedule ? input : { ...input, schedule: normalizedSchedule };
  const rowCounts = new Array<number>(input.schedule.length).fill(0);
  const rowBuyIns = new Array<number>(input.schedule.length).fill(0);
  const rowLabels = input.schedule.map((r, i) => r.label || `Row ${i + 1}`);
  const rowIds = input.schedule.map((r) => r.id);

  // For each row, compile one or more variants depending on fieldVariability.
  // variants[r] is an array of { entry, weight } — weight is # of plays per
  // unit `count` consumed from this row.
  const primedopeCompare = calibrationMode === "primedope-binary-itm";
  // Compare mode normally isolates PrimeDope's distribution assumptions while
  // keeping the app's full-ticket ROI basis. The explicit opt-in exists for
  // live-site parity scripts that need to reproduce PD's rake-ignored EV.
  const primedopeStyleEV = primedopeCompare && input.primedopeStyleEV === true;
  // Three independent PD-flavour toggles, all default ON when compare mode
  // is active. Flipping any of them off isolates that single PD quirk's
  // contribution to σ while keeping the schedule EV fixed.
  const forcePrimedopePayouts =
    primedopeCompare && input.usePrimedopePayouts !== false;
  const usePdFinishModel =
    primedopeCompare && input.usePrimedopeFinishModel !== false;
  const usePdRakeMath =
    primedopeCompare && input.usePrimedopeRakeMath !== false;
  const pdFlags = { usePdFinishModel, usePdRakeMath };
  const variants: { entry: CompiledEntry; share: number }[][] =
    input.schedule.map((row, idx) =>
      compileRowVariants(row, idx, input.finishModel, calibrationMode, primedopeStyleEV, forcePrimedopePayouts, pdFlags),
    );

  // Stamp rakeback onto each variant. Bonus is row-specific (scales with
  // row.rake × row.buyIn) but the rakeback program % itself is global —
  // sits on SimulationInput, not on the row. Mutating the compiled entries
  // in-place here keeps compileRowVariants / compileSingleEntry signatures
  // unchanged and means the hot loop just reads `entry.rakebackBonusPerBullet`.
  const rbFrac = Math.max(0, input.rakebackFracOfRake ?? 0);
  for (let r = 0; r < input.schedule.length; r++) {
    const row = input.schedule[r];
    const bonus = rbFrac * row.rake * row.buyIn;
    for (const v of variants[r]) {
      v.entry.rakebackBonusPerBullet = bonus;
      v.entry.battleRoyaleLeaderboardShare = 0;
    }
  }

  const flat: CompiledEntry[] = [];
  let totalBuyIn = 0;
  let expectedProfit = 0;
  let expectedDirectRakeback = 0;
  const expectedBattleRoyaleSplitDirectRakeback = 0;
  const expectedLeaderboardPromo = 0;
  let itmAcc = 0;
  const leaderboardMix = new Array<BattleRoyaleLeaderboardMixRow>(
    input.schedule.length,
  );
  // Build one "slot entry" per row. For rows with a single bucket this is
  // the compiled entry itself. For rows with fieldVariability it's a copy
  // of the first variant with .variants populated — the hot loop rolls a
  // variant per sample, so field size genuinely drives variance.
  const slotEntries: CompiledEntry[] = input.schedule.map((_, r) => {
    const rv = variants[r];
    if (rv.length === 1) return rv[0].entry;
    const first = rv[0].entry;
    const variantList = rv.map((v) => v.entry);
    // Parent's bookkeeping fields (singleCost equal across variants; itm
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

  const passCounts = input.schedule.map((row) =>
    Math.max(1, Math.floor(row.count)),
  );
  const passOrder = buildSchedulePassOrder(passCounts);
  const rowDirectRakebackMeans = slotEntries.map(
    (entry) => entry.rakebackBonusPerBullet,
  );

  for (let rep = 0; rep < input.scheduleRepeats; rep++) {
    for (const rowIdx of passOrder) {
      const entry = slotEntries[rowIdx];
      const directRbMean = rowDirectRakebackMeans[rowIdx];
      flat.push(entry);
      totalBuyIn += entry.singleCost;
      expectedProfit += entry.singleCost * input.schedule[rowIdx].roi + directRbMean;
      expectedDirectRakeback += directRbMean;
      itmAcc += entry.itm;
      rowCounts[rowIdx] += 1;
      rowBuyIns[rowIdx] += entry.singleCost;
    }
  }

  const reps = Math.max(1, input.scheduleRepeats);
  return {
    flat,
    totalBuyIn,
    expectedProfit,
    expectedDirectRakeback,
    expectedBattleRoyaleSplitDirectRakeback,
    expectedLeaderboardPromo,
    tournamentsPerSample: flat.length,
    tournamentsPerPass: Math.max(1, Math.floor(flat.length / reps)),
    rowCounts,
    rowBuyIns,
    rowLabels,
    rowIds,
    itmRate: flat.length > 0 ? itmAcc / flat.length : 0,
    battleRoyaleLeaderboardMix: leaderboardMix.filter(
      (row): row is BattleRoyaleLeaderboardMixRow => row != null,
    ),
  };
}

export function buildScheduleAnalyticBreakdown(input: {
  schedule: TournamentRow[];
  finishModel: SimulationInput["finishModel"];
  rakebackFracOfRake?: number;
  calibrationMode?: CalibrationMode;
}): ScheduleAnalyticBreakdown | null {
  if (input.schedule.length === 0) return null;
  const compiled = compileSchedule(
    {
      schedule: input.schedule,
      scheduleRepeats: 1,
      samples: 1,
      bankroll: 1,
      seed: 1,
      finishModel: input.finishModel,
      rakebackFracOfRake: input.rakebackFracOfRake,
    },
    input.calibrationMode ?? "alpha",
  );
  if (compiled.flat.length === 0 || !(compiled.totalBuyIn > 0)) return null;

  const reps = new Array<CompiledEntry | null>(input.schedule.length).fill(null);
  for (const entry of compiled.flat) {
    if (reps[entry.rowIdx] === null) reps[entry.rowIdx] = entry;
  }

  const perRow = compiled.rowCounts.map((count, rowIdx) => {
    const entry = reps[rowIdx];
    if (!entry || count <= 0) {
      return {
        rowIdx,
        count: 0,
        countShare: 0,
        meanSingle: 0,
        totalCost: 0,
        costShare: 0,
        varianceDollar: 0,
        sigmaDollar: 0,
        fieldAvg: 0,
        fieldMin: 0,
        fieldMax: 0,
      };
    }
    const m = compiledEntryMoments(entry);
    const varianceSingle = Math.max(
      0,
      m.secondDollar - m.meanDollar * m.meanDollar,
    );
    return {
      rowIdx,
      count,
      countShare: count / compiled.tournamentsPerPass,
      meanSingle: m.meanDollar,
      totalCost: compiled.rowBuyIns[rowIdx],
      costShare: compiled.rowBuyIns[rowIdx] / compiled.totalBuyIn,
      varianceDollar: varianceSingle * count,
      sigmaDollar: Math.sqrt(varianceSingle),
      fieldAvg: m.fieldAvg,
      fieldMin: m.fieldMin,
      fieldMax: m.fieldMax,
    };
  });

  const totalVar = perRow.reduce((acc, row) => acc + row.varianceDollar, 0);
  const sigmaPassDollar = Math.sqrt(Math.max(0, totalVar));
  const sigmaRoiPerPass = sigmaPassDollar / compiled.totalBuyIn;
  const sigmaRoiPerTourney = sigmaRoiPerPass * Math.sqrt(compiled.tournamentsPerPass);

  return {
    perRow: perRow.map((row) => ({
      ...row,
      costShare: row.costShare,
      varianceDollar: row.varianceDollar,
    })),
    sigmaRoiPerTourney,
    sigmaRoiPerPass,
    totalCost: compiled.totalBuyIn,
    tournamentsPerPass: compiled.tournamentsPerPass,
  };
}
