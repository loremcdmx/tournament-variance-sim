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

export function equilibriumItmRateForRow(row: TournamentRow): number {
  const normalized = normalizeGameTypeConsistency(row);
  const lateRegMult = Math.max(1, normalized.lateRegMultiplier ?? 1);
  const players = Math.max(2, Math.floor(normalized.players * lateRegMult));
  const payouts = getPayoutTable(
    normalized.payoutStructure,
    players,
    normalized.customPayouts,
  );
  const paidCount = payouts.reduce((n, p) => (p > 0 ? n + 1 : n), 0);
  return Math.min(0.99, Math.max(1 / players, paidCount / players));
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
    if (row.itmRate != null && row.itmRate > 0) return row;
    const itmRate = base ?? equilibriumItmRateForRow(row);
    changed = true;
    return {
      ...row,
      itmRate,
      finishBuckets: undefined,
    };
  });
  return changed ? next : schedule;
}
