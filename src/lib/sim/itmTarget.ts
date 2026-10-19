import type { TournamentRow } from "./types";
import { normalizeGameTypeConsistency } from "./gameType";
import { getPayoutTable } from "./payouts";

/**
 * Row ITM% defaults: every row gets an effective fixed-ITM value. Explicit
 * row edits win; otherwise the global value fills in; otherwise we use the
 * payout table's equilibrium paid fraction.
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
// custom list is attached, so only the paid-place count is kept, keyed by that.
const PAID_PLACES_CACHE_MAX = 2048;
const paidPlacesCache = new Map<string, number>();

function paidPlaces(
  structure: TournamentRow["payoutStructure"],
  players: number,
  customPayouts: TournamentRow["customPayouts"],
): number {
  const count = (table: number[]) => table.reduce((n, p) => (p > 0 ? n + 1 : n), 0);
  if (customPayouts != null) {
    return count(getPayoutTable(structure, players, customPayouts));
  }
  const key = `${structure}|${players}`;
  const hit = paidPlacesCache.get(key);
  if (hit !== undefined) return hit;
  const paid = count(getPayoutTable(structure, players));
  if (paidPlacesCache.size >= PAID_PLACES_CACHE_MAX) paidPlacesCache.clear();
  paidPlacesCache.set(key, paid);
  return paid;
}

export function equilibriumItmRateForRow(row: TournamentRow): number {
  const normalized = normalizeGameTypeConsistency(row);
  const lateRegMult = Math.max(1, normalized.lateRegMultiplier ?? 1);
  const players = Math.max(2, Math.floor(normalized.players * lateRegMult));
  const paidCount = paidPlaces(
    normalized.payoutStructure,
    players,
    normalized.customPayouts,
  );
  return paidCount >= players ? 1 : Math.min(0.99, Math.max(1 / players, paidCount / players));
}

/**
 * Build the effective schedule used by previews, validation and the engine.
 * Source rows are not mutated: a blank row ITM remains blank in saved state,
 * but the app still runs with the visible default.
 */
export function applyItmTarget(
  schedule: TournamentRow[],
  cfg: ItmTargetConfig,
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
    const itmRate = base ?? equilibrium;
    changed = true;
    return {
      ...row,
      itmRate,
      finishBuckets: undefined,
    };
  });
  return changed ? next : schedule;
}
