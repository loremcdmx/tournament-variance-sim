import type { TournamentRow } from "./types";

/**
 * Global player ITM%: a single literal fraction that fills every schedule
 * row that doesn't already carry its own per-row `itmRate` override. No
 * preset modes, no paid-fraction scaling — the number the user types is
 * the number the engine uses. Row-level edits always win over the global.
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

/**
 * Resolve the effective ITM fraction for a single row. If the row already
 * has an explicit `itmRate`, the row wins; otherwise the global applies.
 * Returns null when neither is set.
 */
export function rowItmTarget(
  row: TournamentRow,
  cfg: ItmTargetConfig,
): number | null {
  if (row.itmRate != null) return row.itmRate;
  return resolveItmTarget(cfg);
}

/**
 * Fill `itmRate` on every row that doesn't already carry one. Per-row
 * values survive unchanged — the global is strictly a default.
 */
export function applyItmTarget(
  schedule: TournamentRow[],
  cfg: ItmTargetConfig,
): TournamentRow[] {
  const base = resolveItmTarget(cfg);
  if (base == null) return schedule;
  return schedule.map((r) => {
    if (r.itmRate != null) return r;
    return { ...r, itmRate: base, finishBuckets: undefined };
  });
}
