/**
 * Pure presentational formatters extracted from `ResultsView.tsx`. None
 * of these touch React; they're plain functions / interfaces / constants
 * that can be unit-tested in isolation and reused across result-surface
 * components without going through the React context plumbing.
 *
 * The React-coupled parts (MoneyFmtContext, useMoneyFmt, AbiContext,
 * UnitScope) intentionally stay in ResultsView for now — extracting
 * those needs more care since they're consumed by deeply nested cards.
 */

/**
 * Tiny mustache-style template substitution. Not i18n — used for
 * client-side string composition where the keys are known at compile
 * time (e.g. building tooltip labels from constants).
 */
export function fmt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

/** Compact USD formatter — `$1.2M` / `$3k` / `$420`. */
export const compactMoney = (v: number): string => {
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000)
    return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000)
    return `${sign}$${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  if (abs === 0) return "$0";
  return `${sign}$${abs.toFixed(0)}`;
};

/** Less-compact USD formatter for inline numbers — `$1,234` / `$12.5k` / `$3.50M`. */
export const money = (v: number): string => {
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

/** Percentage from a fraction — `0.184` → `18.4%`. */
export const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

/** Integer with locale-default thousands grouping. */
export const intFmt = (v: number): string =>
  v.toLocaleString(undefined, { maximumFractionDigits: 0 });

export interface MoneyFmt {
  money: (v: number) => string;
  compactMoney: (v: number) => string;
}

export type UnitMode = "money" | "abi";

/** USD-denominated formatter pair. Default for new result widgets. */
export const defaultMoneyFmt: MoneyFmt = { money, compactMoney };

/**
 * Build an ABI-denominated formatter pair anchored to a per-result
 * average buy-in. ABI mode normalizes dollar amounts so cross-stake
 * grinders can read profit / drawdown / VaR in tournaments-of-value
 * instead of raw USD.
 */
export function makeAbiMoney(abi: number): MoneyFmt {
  const safe = abi > 0 ? abi : 1;
  const fmt = (v: number, digits: number) => {
    const sign = v < 0 ? "−" : "";
    const n = Math.abs(v) / safe;
    return `${sign}${n.toFixed(digits)} ABI`;
  };
  return {
    money: (v: number) => fmt(v, Math.abs(v) / safe >= 100 ? 0 : 1),
    compactMoney: (v: number) => {
      const sign = v < 0 ? "−" : "";
      const n = Math.abs(v) / safe;
      if (n >= 1000)
        return `${sign}${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k ABI`;
      if (n >= 100) return `${sign}${n.toFixed(0)} ABI`;
      if (n === 0) return "0 ABI";
      return `${sign}${n.toFixed(1)} ABI`;
    },
  };
}

/** localStorage key for the global unit-mode preference. */
export const GLOBAL_UNIT_KEY = "tvs.unit.global.v1";

export function loadUnitMode(key: string): UnitMode {
  if (typeof localStorage === "undefined") return "abi";
  try {
    const v = localStorage.getItem(key);
    return v === "money" || v === "abi" ? v : "abi";
  } catch {
    return "abi";
  }
}

export function saveUnitMode(key: string, v: UnitMode): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
}

/**
 * Delta displayed on the PD-badge row: how much PD's value differs from
 * ours, relative to ours. Positive ⇒ PD is higher (PD row shows ▲X%,
 * matching how a reader naturally parses "freezeouts are 13% more").
 *
 * Returns null when both sides are non-finite or both are essentially
 * zero — neither case admits a meaningful relative delta.
 */
export function pctDelta(cur: number, pd: number): number | null {
  if (!Number.isFinite(cur) || !Number.isFinite(pd)) return null;
  const anchor = Math.abs(cur) > 1e-9 ? Math.abs(cur) : Math.abs(pd);
  if (anchor < 1e-9) return null;
  return (pd - cur) / anchor;
}

/**
 * Merge histogram bin domains so two charts (ours vs PD) share an
 * x-axis. Returns `undefined` when no usable histograms were passed —
 * caller falls back to per-chart auto-domain.
 */
export function mergedHistogramDomain(
  ...histograms: Array<{ binEdges: readonly number[] } | null | undefined>
): [number, number] | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (const hist of histograms) {
    const edges = hist?.binEdges;
    if (!edges || edges.length < 2) continue;
    lo = Math.min(lo, edges[0]);
    hi = Math.max(hi, edges[edges.length - 1]);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return undefined;
  return [lo, hi];
}
