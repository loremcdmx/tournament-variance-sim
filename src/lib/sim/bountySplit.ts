import { makeBrTierSampler } from "./brBountyTiers";
import { bountyEvCeiling, bountyResidualFits, withinTargetEv } from "./finishModel";
import { applySitThroughPayJumps } from "./sitThroughPayJumps";
import type { GameType, TournamentRow } from "./types";

export function isBattleRoyaleRow(
  row: Pick<TournamentRow, "gameType" | "payoutStructure">,
): boolean {
  return row.gameType === "mystery-royale" || row.payoutStructure === "battle-royale";
}

export function clampBountyMean(bountyMean: number, totalWinningsEV: number): number {
  if (!Number.isFinite(bountyMean) || !Number.isFinite(totalWinningsEV)) return 0;
  return Math.max(0, Math.min(Math.max(0, totalWinningsEV), bountyMean));
}

/**
 * The place shape the engine spreads a row's KO EV over, and what winning
 * guarantees in it. The engine pays each finishing place a fixed weight (the
 * elimination tree's expected haul there, the envelope window's expected
 * knockout count, Ocean's expected collected heads) times one factor, the
 * row's knockout edge. Winning always takes the last knockout: in a PKO or an
 * Ocean KO that is the runner-up's head, never less than a starting head, on
 * top of the winner's own starting head, returned at the end; in a Mystery it
 * is one envelope of the row's pool, or the whole pool where no bust drops
 * one; in a Battle Royale one envelope of the published table, the mean the
 * engine draws whatever the ticket (no more than the pool). No other place is
 * sure of a knockout.
 */
export interface KnockoutFloorShape {
  weights: Float64Array;
  winnerTake: number;
}

export function knockoutFloorShape(
  N: number,
  paidCount: number,
  buyIn: number,
  bountyFraction: number,
  gameType: GameType,
): KnockoutFloorShape {
  const head = buyIn * bountyFraction;
  const weights = new Float64Array(N);
  if (gameType === "mystery" || gameType === "mystery-royale") {
    const window = gameType === "mystery-royale" ? Math.min(9, N) : Math.min(paidCount, N);
    if (window < 2) {
      weights[0] = 1;
      return { weights, winnerTake: N * head };
    }
    // A window bust that leaves k players standing pays one of them, so place
    // i + 1 collects 1/k of every such bust with k > i.
    let acc = 0;
    for (let k = window - 1; k >= 1; k--) {
      acc += 1 / k;
      weights[k - 1] = acc;
    }
    const winnerTake = gameType === "mystery-royale"
      ? Math.min(makeBrTierSampler(buyIn).meanValue, N * head)
      : (N * head) / (window - 1);
    return { weights, winnerTake };
  }
  if (gameType === "ocean-ko") {
    let survivorHead = 1;
    for (let alive = N; alive >= 2; alive--) {
      weights[alive - 1] = survivorHead - 1;
      survivorHead *= 1 + 1 / (2 * (alive - 1));
    }
    weights[0] = 2 * survivorHead - 1;
    return { weights, winnerTake: 2 * head };
  }
  const cashAtBust = new Float64Array(N);
  let heads = N;
  for (let m = 1; m <= N - 1; m++) {
    const cash = heads / (N - m + 1) / 2;
    cashAtBust[m] = cash;
    heads -= cash;
  }
  let acc = 0;
  for (let m = 1; m <= N - 1; m++) {
    acc += cashAtBust[m] / (N - m);
    weights[N - 1 - m] = acc;
  }
  weights[0] += heads;
  return { weights, winnerTake: 2 * head };
}

/**
 * The least KO EV a row can play on `pmf`: the knockout edge cannot fall
 * below the one that pays the winner what winning guarantees, so the KO EV
 * is at least winnerTake x Σ pmf·w / w[0]. The weights fall with the place,
 * last place's is 0 and the take is at most the pool, so the floor never
 * passes the pool's `bountyEvCeiling`.
 */
export function knockoutFloor(shape: KnockoutFloorShape, pmf: Float64Array): number {
  const { weights } = shape;
  let reach = 0;
  for (let i = 0; i < weights.length; i++) reach += pmf[i] * weights[i];
  return weights[0] > 0 ? (shape.winnerTake * reach) / weights[0] : 0;
}

/** Rounding only, as `bountyResidualFits`: a heads-up row's floor is its ceiling. */
export function knockoutFloorFits(bountyMean: number, floor: number): boolean {
  return bountyMean >= floor * (1 - 1e-9);
}

export interface BountyPoolSettlement<S> {
  /** The cash solve the row plays. */
  solved: S;
  /** The cash winnings that solve was asked for. */
  targetRegular: number;
  /** Σ pmf × prize of that solve. */
  cashEV: number;
  /** The KO EV the row plays. */
  bountyMean: number;
  /**
   * The pool held the KO EV below what the plan or the cash side's residual
   * asked for. Such a row aims at its ROI whatever the model: a fixed shape
   * would otherwise close its total with that KO EV.
   */
  poolCut: boolean;
  /**
   * A pinned ITM or a fixed shape plays more KO EV than the cash side leaves of
   * the total: the cash side could not come down to the total less the KO EV
   * its finishing places guarantee, or it overpays the total alone. Such a row
   * aims at its ROI whatever the model, as a pool-cut one does: the KO EV is
   * what closes a fixed shape's total, so a row it cannot close misses its ROI.
   */
  floorLift: boolean;
}

/**
 * Search that settles a plan past the ceiling: at most this many solves,
 * stopped at this relative precision, far below any money the results print.
 */
const SETTLE_STEPS = 60;
const SETTLE_REL_WIDTH = 1e-9;

/**
 * Splits a bounty row's winnings between the cash side and the KO EV so that
 * the KO EV never passes what the bounty pool can pay one entry: the
 * `bountyEvCeiling` of the pmf the row plays, read after the sit-through
 * transform, which moves mass onto last place.
 *
 * The planned KO EV is solved first. A pinned ITM or a fixed shape plays what
 * the cash side leaves of the total, a free α plays the plan; a row whose KO
 * EV fits under that solve's ceiling keeps that solve and nothing more is
 * solved. Clamping the plan before the first solve would re-solve rows whose
 * cash side overshoots and leaves a KO EV inside the ceiling. A plan that fits
 * while a short cash side leaves more than the pool holds keeps its solve and
 * is capped at the ceiling.
 *
 * A plan past the ceiling is cut to the largest KO EV the pmf solved for it
 * can still pay, and the cash side is asked for the rest. The ceiling reads
 * P(last), which that solve moves wherever it reaches last place (a free ITM,
 * a table that pays every place, PrimeDope's binary ITM, the sit-through
 * transform): asking for less KO EV asks the cash side for more, which lowers
 * P(last) and lifts the ceiling (on every model and pass measured; the
 * search only keeps asks the ceiling covers, so it does not rely on it).
 * That KO EV is therefore the fixed point
 * b = ceiling(solve(total - b)), searched for between the first ceiling and
 * the plan, and the same for every plan past it. Where the pin fixes
 * P(last) (a pinned ITM with unpaid places and no sit-through) and the solve
 * lands on its target, the first ceiling is the fixed point and one solve
 * settles it. A pinned ITM or a fixed shape plays what the cash side leaves,
 * which is less than the ask where the solve overshoots its target (near
 * break-even the first-place floor lifts a pinned cash side up to the total):
 * the search then holds that residual, not the ask, to the ceiling, or it
 * settles on KO EV the pool could pay and the share falls toward the KO end
 * of the bias. The KO EV is held to
 * the ceiling of the pmf it settles on in any case, so a cash side that cannot
 * deliver the rest leaves the row short of its total, which validation blocks
 * and the engine flags. A fixed shape cannot deliver any of it, so `poolCut`
 * holds it to the ROI it would otherwise have closed with the KO EV.
 *
 * The KO EV never falls below `knockoutFloor` of the pmf played either. A
 * cash side that leaves less (a first-place floor that lifted it toward the
 * total, an α at the end of its range, a fixed shape) or a plan under the
 * floor gives way: the cash side is capped at the total less the KO EV asked
 * for, and below the plan its target falls with it. The floor falls as the
 * cash side does, so the ask settles on the fixed point where the KO EV the
 * row plays meets the floor of its own solve, the least KO EV it can play,
 * searched for like the ceiling's. A row whose cash side cannot come down
 * that far even at the cash target floor plays its least cash with the KO EV
 * at the floor, over its total. `floorLift` marks it, and a pinned ITM or a
 * fixed shape whose cash side alone overpays the total, so that validation
 * blocks such a row and the engine flags it whatever the model, as it does a
 * pool-cut one: a fixed shape closes its total only with a KO EV between the
 * floor and the ceiling.
 */
export function settleBountyAgainstPool<S extends { pmf: Float64Array; prizeByPlace: Float64Array }>(opts: {
  N: number;
  paidCount: number;
  buyIn: number;
  bountyFraction: number;
  gameType: GameType;
  totalWinningsEV: number;
  cashFloor: number;
  plannedBountyMean: number;
  /** A pinned ITM or a fixed shape: the KO EV is what the cash side leaves. */
  residualCloses: boolean;
  sitThrough: boolean;
  payJumpAggression: number | undefined;
  /** A cash side the first-place floor may lift up to `maxCashWinnings`. */
  solve: (targetRegular: number, maxCashWinnings: number) => S;
}): BountyPoolSettlement<S> {
  const { N, totalWinningsEV, cashFloor, residualCloses, solve } = opts;
  const cashOf = (solved: S): number => {
    let cash = 0;
    for (let i = 0; i < N; i++) cash += solved.pmf[i] * solved.prizeByPlace[i];
    return cash;
  };
  const playedOf = (solved: S): Float64Array => {
    if (!opts.sitThrough) return solved.pmf;
    const played = Float64Array.from(solved.pmf);
    applySitThroughPayJumps(played, solved.prizeByPlace, opts.paidCount, opts.payJumpAggression);
    return played;
  };
  const ceilingOf = (solved: S): number =>
    bountyEvCeiling(N, opts.buyIn, opts.bountyFraction, playedOf(solved));
  let shape: KnockoutFloorShape | null = null;
  const floorOf = (solved: S): number => {
    shape ??= knockoutFloorShape(N, opts.paidCount, opts.buyIn, opts.bountyFraction, opts.gameType);
    return knockoutFloor(shape, playedOf(solved));
  };

  type Settled = Omit<BountyPoolSettlement<S>, "floorLift">;
  const done = (s: Settled): BountyPoolSettlement<S> => ({
    ...s,
    floorLift: residualCloses && s.bountyMean > totalWinningsEV - s.cashEV,
  });

  // `base` is the ask `kept` was solved at, and an ask of 0 repeats that
  // solve. The room the floor leaves, KO EV - floor, grows with the ask.
  const holdToFloor = (base: number, kept: Settled): Settled => {
    const floor = floorOf(kept.solved);
    if (knockoutFloorFits(kept.bountyMean, floor)) return kept;
    const probe = (ask: number) => {
      const target = Math.max(cashFloor, totalWinningsEV - Math.max(ask, base));
      const solved = solve(target, totalWinningsEV - ask);
      const cashEV = cashOf(solved);
      const bountyMean = residualCloses
        ? Math.max(0, totalWinningsEV - cashEV)
        : Math.max(ask, base);
      const probeFloor = floorOf(solved);
      return { solved, targetRegular: target, cashEV, bountyMean, room: bountyMean - probeFloor, floor: probeFloor };
    };
    const far = Math.max(0, totalWinningsEV - cashFloor);
    let lo = 0;
    let roomLo = kept.bountyMean - floor;
    let hi = Math.min(floor, far);
    let fit = probe(hi);
    if (fit.room < 0 && hi < far) {
      lo = hi;
      roomLo = fit.room;
      hi = far;
      fit = probe(hi);
    }
    if (fit.room < 0) {
      return {
        solved: fit.solved,
        targetRegular: fit.targetRegular,
        cashEV: fit.cashEV,
        bountyMean: fit.floor,
        poolCut: false,
      };
    }
    let roomHi = fit.room;
    let keptSide = 1;
    for (let step = 0; step < SETTLE_STEPS; step++) {
      if (fit.room <= SETTLE_REL_WIDTH * fit.bountyMean || hi - lo <= SETTLE_REL_WIDTH * hi) break;
      const secant = lo + (hi - lo) * roomLo / (roomLo - roomHi);
      const ask = secant > lo && secant < hi ? secant : (lo + hi) / 2;
      const candidate = probe(ask);
      if (candidate.room >= 0) {
        fit = candidate;
        if (keptSide > 0) roomLo /= 2;
        hi = ask;
        roomHi = candidate.room;
        keptSide = 1;
      } else {
        if (keptSide < 0) roomHi /= 2;
        lo = ask;
        roomLo = candidate.room;
        keptSide = -1;
      }
    }
    const ceiling = ceilingOf(fit.solved);
    return {
      solved: fit.solved,
      targetRegular: fit.targetRegular,
      cashEV: fit.cashEV,
      bountyMean: Math.min(fit.bountyMean, ceiling),
      poolCut: !bountyResidualFits(fit.bountyMean, ceiling),
    };
  };
  const settle = (ask: number, solved: S, ceiling: number): Settled => {
    const cashEV = cashOf(solved);
    const played = residualCloses ? Math.max(0, totalWinningsEV - cashEV) : ask;
    return {
      solved,
      targetRegular: Math.max(cashFloor, totalWinningsEV - ask),
      cashEV,
      bountyMean: Math.min(played, ceiling),
      poolCut: true,
    };
  };

  const plan = opts.plannedBountyMean;
  const targetRegular = Math.max(cashFloor, totalWinningsEV - plan);
  const solved = solve(targetRegular, totalWinningsEV);
  const cashEV = cashOf(solved);
  if (!(opts.bountyFraction > 0)) {
    return { solved, targetRegular, cashEV, bountyMean: plan, poolCut: false, floorLift: false };
  }
  const bountyMean = residualCloses ? Math.max(0, totalWinningsEV - cashEV) : plan;
  // A lone player is first and last at once, which the ceiling cannot read.
  if (N < 2) return { solved, targetRegular, cashEV, bountyMean, poolCut: false, floorLift: false };
  const ceiling = ceilingOf(solved);
  if (bountyResidualFits(bountyMean, ceiling)) {
    return done(holdToFloor(plan, { solved, targetRegular, cashEV, bountyMean, poolCut: false }));
  }
  if (plan <= ceiling) return done(settle(plan, solved, ceiling));

  // The search runs on the room the pool leaves over the KO EV played at an
  // ask, ceiling(solve(total - ask)) - played: it falls as the ask grows and
  // is negative at the plan. Each step costs a whole solve, so it takes the
  // regula falsi point with the Illinois halving: the midpoint needs about 30
  // solves to reach 1e-9 on rows whose P(last) moves. Only an overshoot past
  // the on-target tolerance reads the residual: a solve that lands on its
  // target is searched on its ask, and a cash side short of its target is
  // held to the ask while the cap below holds what it leaves to the ceiling.
  const playedAt = (ask: number, solved: S): number => {
    if (!residualCloses) return ask;
    const target = Math.max(cashFloor, totalWinningsEV - ask);
    const cash = cashOf(solved);
    return cash > target && !withinTargetEv(cash, target) ? Math.max(0, totalWinningsEV - cash) : ask;
  };
  let lo = 0;
  let roomLo = Number.NaN;
  let hi = plan;
  let roomHi = ceiling - playedAt(plan, solved);
  let keptSide = 0;
  let ask = ceiling;
  let fit: { ask: number; solved: S; ceiling: number } | null = null;
  for (let step = 0; step < SETTLE_STEPS; step++) {
    const candidate = solve(Math.max(cashFloor, totalWinningsEV - ask), totalWinningsEV);
    const candidateCeiling = ceilingOf(candidate);
    const room = candidateCeiling - playedAt(ask, candidate);
    if (room >= 0) {
      fit = { ask, solved: candidate, ceiling: candidateCeiling };
      // The KO EV played here is the ceiling to the search's precision.
      if (room <= SETTLE_REL_WIDTH * ask) break;
      if (keptSide > 0) roomHi /= 2;
      lo = ask;
      roomLo = room;
      keptSide = 1;
    } else {
      if (keptSide < 0) roomLo /= 2;
      hi = ask;
      roomHi = room;
      keptSide = -1;
    }
    if (hi - lo <= SETTLE_REL_WIDTH * hi) break;
    const secant = lo + (hi - lo) * roomLo / (roomLo - roomHi);
    ask = secant > lo && secant < hi ? secant : (lo + hi) / 2;
  }
  if (fit === null) {
    const atZero = solve(Math.max(cashFloor, totalWinningsEV), totalWinningsEV);
    fit = { ask: 0, solved: atZero, ceiling: ceilingOf(atZero) };
  }
  return done(holdToFloor(fit.ask, settle(fit.ask, fit.solved, fit.ceiling)));
}
