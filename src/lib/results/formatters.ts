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

const MINUS = "−";

const roundedTo = (n: number, digits: number): number => Number(n.toFixed(digits));

/** Compact USD formatter — `$1.2M` / `$3k` / `$420`. */
export const compactMoney = (v: number): string => {
  const abs = Math.abs(v);
  const inM = abs / 1_000_000;
  const inK = abs / 1_000;
  let body: string;
  let zero = false;
  // The unit is picked from the rounded figure, so 999.6 reads `$1.0k`, not `$1000`.
  if (abs >= 1_000_000 || roundedTo(inK, abs >= 10_000 ? 0 : 1) >= 1000) {
    body = `$${inM.toFixed(inM >= 10 ? 0 : 1)}M`;
  } else if (abs >= 1_000 || roundedTo(abs, 0) >= 1000) {
    body = `$${inK.toFixed(abs >= 10_000 ? 0 : 1)}k`;
  } else {
    body = `$${abs.toFixed(0)}`;
    zero = roundedTo(abs, 0) === 0;
  }
  return v < 0 && !zero ? `${MINUS}${body}` : body;
};

/**
 * Less-compact USD formatter for inline numbers — `$1,234` / `$12.5k` / `$3.50M`.
 * Below $10k the digits are grouped for `locale`, never for the browser's.
 */
export const money = (v: number, locale = "en-US"): string => {
  const abs = Math.abs(v);
  const inK = abs / 1000;
  let body: string;
  let zero = false;
  if (abs >= 1_000_000 || (abs >= 10_000 && roundedTo(inK, 1) >= 1000)) {
    body = `$${(abs / 1_000_000).toFixed(2)}M`;
  } else if (abs >= 10_000) {
    body = `$${inK.toFixed(1)}k`;
  } else {
    body = `$${abs.toLocaleString(locale, { maximumFractionDigits: 0 })}`;
    zero = Math.round(abs) === 0;
  }
  return v < 0 && !zero ? `${MINUS}${body}` : body;
};

/** Percentage from a fraction — `0.184` → `18.4%`. */
export const pct = (v: number): string => {
  const text = (Math.abs(v) * 100).toFixed(1);
  return `${v < 0 && Number(text) !== 0 ? MINUS : ""}${text}%`;
};

/** A count of tournaments, or a dash when the statistic does not exist (NaN). */
export const tourneyCountOrDash = (v: number, unit: string): string =>
  Number.isFinite(v) ? `${Math.round(v)} ${unit}` : "—";

/** Integer with thousands grouping for `locale` (the UI's, not the browser's). */
export const intFmt = (v: number, locale = "en-US"): string =>
  (Math.round(Math.abs(v)) === 0 ? 0 : v).toLocaleString(locale, {
    maximumFractionDigits: 0,
  });

export interface MoneyFmt {
  money: (v: number) => string;
  compactMoney: (v: number) => string;
}

export type UnitMode = "money" | "abi";

/** A quoted minimum must never round below the amount that meets the risk bound. */
export function formatMinimumBankroll(
  value: number,
  unit: UnitMode = "money",
  abi = 1,
  locale = "en-US",
): string {
  if (!Number.isFinite(value)) return "—";
  const amount = Math.max(0, value) / (unit === "abi" && abi > 0 ? abi : 1);
  const wholeCents = Math.floor(amount * 100);
  const conservative = (wholeCents / 100 >= amount ? wholeCents : wholeCents + 1) / 100;
  const text = conservative.toLocaleString(locale, {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  return unit === "abi" ? `${text} ABI` : `$${text}`;
}

/** USD-denominated formatter pair. Default for new result widgets. */
export const defaultMoneyFmt: MoneyFmt = { money, compactMoney };

/** USD pair whose grouped digits follow `locale`. */
export function makeUsdMoney(locale: string): MoneyFmt {
  return { money: (v: number) => money(v, locale), compactMoney };
}

/**
 * Build an ABI-denominated formatter pair anchored to a per-result
 * average buy-in. ABI mode normalizes dollar amounts so cross-stake
 * grinders can read profit / drawdown / VaR in tournaments-of-value
 * instead of raw USD.
 */
export function makeAbiMoney(abi: number): MoneyFmt {
  const safe = abi > 0 ? abi : 1;
  return {
    money: (v: number) => {
      const n = Math.abs(v) / safe;
      const text = n.toFixed(roundedTo(n, 1) >= 100 ? 0 : 1);
      return `${v < 0 && Number(text) !== 0 ? MINUS : ""}${text} ABI`;
    },
    compactMoney: (v: number) => {
      const n = Math.abs(v) / safe;
      if (n >= 999.5) {
        return `${v < 0 ? MINUS : ""}${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k ABI`;
      }
      const text = n.toFixed(roundedTo(n, 1) >= 100 ? 0 : 1);
      if (Number(text) === 0) return "0 ABI";
      return `${v < 0 ? MINUS : ""}${text} ABI`;
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
