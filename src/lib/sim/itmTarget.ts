import type { FinishModelConfig, TournamentRow } from "./types";
import { isFieldRangeActive } from "./fieldVariants";
import { knockoutFloorFits } from "./bountySplit";
import {
  bountyResidualFits,
  isAlphaAdjustable,
  withinTargetEv,
} from "./finishModel";
import { normalizeGameTypeConsistency } from "./gameType";
import { getPayoutTable } from "./payouts";

/**
 * Row ITM% defaults: every row gets an effective fixed-ITM value. Explicit
 * row edits win; otherwise the global value fills in; otherwise we use the
 * payout table's equilibrium paid fraction. A table with one prize level
 * takes the ITM its ROI implies over either default (`oneLevelItmForRow`).
 */
export interface ItmTargetConfig {
  enabled: boolean;
  /** Whole-number percent in [0.5, 99], only consulted when enabled. */
  pct: number;
}

/**
 * Resolve the global ITM target as a fraction in [0,1], or null when the
 * feature is off. Clamped to a sliver of OOTM headroom so the shell
 * solver always has room to reconcile with the ROI target.
 */
export function resolveItmTarget(cfg: ItmTargetConfig): number | null {
  if (!cfg.enabled) return null;
  if (!Number.isFinite(cfg.pct)) return null;
  const frac = cfg.pct / 100;
  if (frac <= 0) return null;
  return Math.min(0.99, Math.max(0.005, frac));
}

export function isItmTargetActive(cfg: ItmTargetConfig): boolean {
  return resolveItmTarget(cfg) != null;
}

// Building a payout table is O(players), and every schedule edit asks for the
// rate of every row. The table is a pure function of (structure, field) unless a
// custom list is attached, so only what the rate needs is kept, keyed by that.
const PAID_PLACES_CACHE_MAX = 2048;

interface PaidPlaces {
  count: number;
  /** The share every paid place gets when all of them get the same, else null. */
  equalShare: number | null;
}

const paidPlacesCache = new Map<string, PaidPlaces>();

function paidPlacesOf(table: number[]): PaidPlaces {
  const paid = table.filter((p) => p > 0);
  const first = paid[0] ?? 0;
  const equal = paid.length > 0 && paid.every((p) => Math.abs(p - first) <= 1e-12 * first);
  return { count: paid.length, equalShare: equal ? first : null };
}

function paidPlaces(
  structure: TournamentRow["payoutStructure"],
  players: number,
  customPayouts: TournamentRow["customPayouts"],
): PaidPlaces {
  if (customPayouts != null) {
    return paidPlacesOf(getPayoutTable(structure, players, customPayouts));
  }
  const key = `${structure}|${players}`;
  const hit = paidPlacesCache.get(key);
  if (hit !== undefined) return hit;
  const paid = paidPlacesOf(getPayoutTable(structure, players));
  if (paidPlacesCache.size >= PAID_PLACES_CACHE_MAX) paidPlacesCache.clear();
  paidPlacesCache.set(key, paid);
  return paid;
}

function rowField(row: TournamentRow): number {
  const lateRegMult = Math.max(1, row.lateRegMultiplier ?? 1);
  return Math.max(2, Math.floor(row.players * lateRegMult));
}

export function equilibriumItmRateForRow(row: TournamentRow): number {
  const normalized = normalizeGameTypeConsistency(row);
  const players = rowField(normalized);
  const paidCount = paidPlaces(
    normalized.payoutStructure,
    players,
    normalized.customPayouts,
  ).count;
  return paidCount >= players ? 1 : Math.min(0.99, Math.max(1 / players, paidCount / players));
}

/**
 * On a table whose paid places all pay the same (winner-takes-all, a ticket
 * satellite) the cash EV is ITM x prize whatever the finish shape, so the ROI
 * and the ITM are one number and the zero-skill default leaves exactly one
 * reachable ROI, -rake/(1+rake). Such a row gets the ITM its ROI implies
 * instead; a default that already reaches the target is kept as is, and an
 * implied ITM outside (0, 0.99] keeps the default so validation still blocks
 * the row. A ranged row is left alone: one ITM cannot fit every size.
 *
 * Bounties enter only heads-up, where they are exact too: the winner makes the
 * one knockout and takes the whole bounty pool, so EV = ITM x (prize + pool).
 * With more seats the bounty share depends on the finish shape.
 *
 * A model that does not aim at the ROI (uniform, empirical, a hand-set α)
 * plays the table's own ITM, so its no-skill reference stays one.
 */
function oneLevelItmForRow(
  row: TournamentRow,
  fallback: number,
  model: FinishModelConfig | undefined,
): number {
  if (isFieldRangeActive(row) || (model !== undefined && !isAlphaAdjustable(model))) {
    return fallback;
  }
  const players = rowField(row);
  const { count, equalShare } = paidPlaces(row.payoutStructure, players, row.customPayouts);
  if (equalShare === null) return fallback;
  const bountyFraction = Math.max(0, Math.min(0.9, row.bountyFraction ?? 0));
  if (bountyFraction > 0 && !(players === 2 && count === 1)) return fallback;
  const basePool = players * row.buyIn;
  // Same pool split as compileEntry: bounties come out of the entries, a
  // guarantee top-up stays cash.
  const prize = (basePool * (1 - bountyFraction) + Math.max(0, (row.guarantee ?? 0) - basePool)) *
    equalShare;
  const bountyPool = basePool * bountyFraction;
  const target = row.buyIn * (1 + row.rake) * (1 + row.roi);
  if (!(prize > 0)) return fallback;
  const cash = fallback * prize;
  // A heads-up KO EV is the pool's share of a win to the last bit: the
  // ceiling and the floor meet there.
  const reached = bountyPool > 0
    ? bountyResidualFits(target - cash, fallback * bountyPool) &&
      knockoutFloorFits(target - cash, fallback * bountyPool)
    : withinTargetEv(cash, target);
  if (reached) return fallback;
  const implied = target / (prize + bountyPool);
  return implied > 0 && implied <= 0.99 ? implied : fallback;
}

/**
 * Build the effective schedule used by previews, validation and the engine.
 * Source rows are not mutated: a blank row ITM remains blank in saved state,
 * but the app still runs with the visible default.
 */
export function applyItmTarget(
  schedule: TournamentRow[],
  cfg: ItmTargetConfig,
  model?: FinishModelConfig,
): TournamentRow[] {
  const base = resolveItmTarget(cfg);
  let changed = false;
  const next = schedule.map((raw) => {
    const row = normalizeGameTypeConsistency(raw);
    if (row !== raw) changed = true;
    const equilibrium = equilibriumItmRateForRow(row);
    if (equilibrium === 1) {
      if (row.itmRate === 1) return row;
      changed = true;
      return { ...row, itmRate: 1 };
    }
    if (row.itmRate != null && row.itmRate > 0) return row;
    const itmRate = oneLevelItmForRow(row, base ?? equilibrium, model);
    changed = true;
    return {
      ...row,
      itmRate,
      finishBuckets: undefined,
    };
  });
  return changed ? next : schedule;
}
