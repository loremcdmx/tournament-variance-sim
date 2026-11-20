import { bountyEvCeiling, bountyResidualFits, withinTargetEv } from "./finishModel";
import { applySitThroughPayJumps } from "./sitThroughPayJumps";
import type { TournamentRow } from "./types";

export function isBattleRoyaleRow(
  row: Pick<TournamentRow, "gameType" | "payoutStructure">,
): boolean {
  return row.gameType === "mystery-royale" || row.payoutStructure === "battle-royale";
}

export function clampBountyMean(bountyMean: number, totalWinningsEV: number): number {
  if (!Number.isFinite(bountyMean) || !Number.isFinite(totalWinningsEV)) return 0;
  return Math.max(0, Math.min(Math.max(0, totalWinningsEV), bountyMean));
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
 */
export function settleBountyAgainstPool<S extends { pmf: Float64Array; prizeByPlace: Float64Array }>(opts: {
  N: number;
  paidCount: number;
  buyIn: number;
  bountyFraction: number;
  totalWinningsEV: number;
  cashFloor: number;
  plannedBountyMean: number;
  /** A pinned ITM or a fixed shape: the KO EV is what the cash side leaves. */
  residualCloses: boolean;
  sitThrough: boolean;
  payJumpAggression: number | undefined;
  solve: (targetRegular: number) => S;
}): BountyPoolSettlement<S> {
  const { N, totalWinningsEV, cashFloor, residualCloses, solve } = opts;
  const cashOf = (solved: S): number => {
    let cash = 0;
    for (let i = 0; i < N; i++) cash += solved.pmf[i] * solved.prizeByPlace[i];
    return cash;
  };
  const ceilingOf = (solved: S): number => {
    let played = solved.pmf;
    if (opts.sitThrough) {
      played = Float64Array.from(solved.pmf);
      applySitThroughPayJumps(played, solved.prizeByPlace, opts.paidCount, opts.payJumpAggression);
    }
    return bountyEvCeiling(N, opts.buyIn, opts.bountyFraction, played);
  };
  const settle = (ask: number, solved: S, ceiling: number): BountyPoolSettlement<S> => {
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
  const solved = solve(targetRegular);
  const cashEV = cashOf(solved);
  if (!(opts.bountyFraction > 0)) {
    return { solved, targetRegular, cashEV, bountyMean: plan, poolCut: false };
  }
  const bountyMean = residualCloses ? Math.max(0, totalWinningsEV - cashEV) : plan;
  // A lone player is first and last at once, which the ceiling cannot read.
  if (N < 2) return { solved, targetRegular, cashEV, bountyMean, poolCut: false };
  const ceiling = ceilingOf(solved);
  if (bountyResidualFits(bountyMean, ceiling)) {
    return { solved, targetRegular, cashEV, bountyMean, poolCut: false };
  }
  if (plan <= ceiling) return settle(plan, solved, ceiling);

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
    const candidate = solve(Math.max(cashFloor, totalWinningsEV - ask));
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
    const atZero = solve(Math.max(cashFloor, totalWinningsEV));
    fit = { ask: 0, solved: atZero, ceiling: ceilingOf(atZero) };
  }
  return settle(fit.ask, fit.solved, fit.ceiling);
}
