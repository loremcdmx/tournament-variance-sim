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
 * Resolve the effective ITM fraction for a single row. When the global
 * toggle is on, it always wins; per-row values only apply when global is
 * off. Returns null when neither is set.
 */
export function rowItmTarget(
  row: TournamentRow,
  cfg: ItmTargetConfig,
): number | null {
  const global = resolveItmTarget(cfg);
  if (global != null) return global;
  if (row.itmRate != null) return row.itmRate;
  return null;
}

/**
 * Stamp `itmRate` on every row when the global toggle is on. The global
 * value overrides any per-row ITM the user may have typed — if the toggle
 * is on, the number it shows is the number every row gets. When the toggle
 * is off, per-row values survive and rows without one use alpha-calibration.
 */
export function applyItmTarget(
  schedule: TournamentRow[],
  cfg: ItmTargetConfig,
): TournamentRow[] {
  const base = resolveItmTarget(cfg);
  if (base == null) return schedule;
  return schedule.map((r) => ({
    ...r,
    itmRate: base,
    finishBuckets: undefined,
  }));
}
