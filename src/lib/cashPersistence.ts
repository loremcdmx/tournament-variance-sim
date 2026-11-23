"use client";

/**
 * Cash-mode persistence: compressed `#c=` share URLs, user-saved presets in
 * localStorage, and RFC-4180 CSV export of simulation results.
 * Mirrors `src/lib/persistence.ts` and `src/lib/results/runExport.ts`.
 */
import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";
import {
  type CashInputDraft,
  normalizeCashInputForUi,
  serializeCashInput,
} from "@/lib/sim/cashInput";
import type { CashInput, CashResult } from "@/lib/sim/cashTypes";

export const CASH_USER_PRESETS_KEY = "tvs:cash-user-presets";
const CASH_HASH_PREFIX = "#c=";
const MAX_CASH_PRESETS = 30;
const MAX_PRESET_NAME_LEN = 80;

export interface CashUserPreset {
  id: string;
  name: string;
  createdAt: number;
  input: CashInput;
}

export function encodeCashState(input: CashInput): string {
  return compressToEncodedURIComponent(
    JSON.stringify(serializeCashInput(input)),
  );
}

export function decodeCashState(encoded: string): CashInput | null {
  if (!encoded) return null;
  try {
    const json = decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const rec = parsed as Record<string, unknown>;
    if (rec.type !== "cash") return null;
    return normalizeCashInputForUi(rec as CashInputDraft);
  } catch {
    return null;
  }
}

export function buildCashShareUrl(input: CashInput): string {
  const hash = CASH_HASH_PREFIX + encodeCashState(input);
  if (typeof window === "undefined") return hash;
  // Clear sender's query string (e.g. ?admin=1), matching MTT `buildShareUrl`.
  return `${window.location.origin}${window.location.pathname}${hash}`;
}

export type CashShareHashResult =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "state"; state: CashInput };

export function readCashShareHash(hash: string): CashShareHashResult {
  if (!hash.startsWith(CASH_HASH_PREFIX)) return { kind: "none" };
  const decoded = decodeCashState(hash.slice(CASH_HASH_PREFIX.length));
  return decoded ? { kind: "state", state: decoded } : { kind: "invalid" };
}

export function loadCashFromUrlHash(): CashShareHashResult {
  if (typeof window === "undefined") return { kind: "none" };
  return readCashShareHash(window.location.hash);
}

function isValidCashPreset(v: unknown): v is CashUserPreset {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    r.id.length > 0 &&
    typeof r.name === "string" &&
    r.name.trim().length > 0 &&
    typeof r.createdAt === "number" &&
    Number.isFinite(r.createdAt) &&
    !!r.input &&
    typeof r.input === "object" &&
    (r.input as Record<string, unknown>).type === "cash"
  );
}

export function loadCashUserPresets(): CashUserPreset[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(CASH_USER_PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: CashUserPreset[] = [];
    for (const item of parsed) {
      if (!isValidCashPreset(item)) continue;
      out.push({
        id: item.id,
        name: item.name.trim().slice(0, MAX_PRESET_NAME_LEN),
        createdAt: item.createdAt,
        input: normalizeCashInputForUi(item.input),
      });
      if (out.length >= MAX_CASH_PRESETS) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function saveCashUserPresets(presets: CashUserPreset[]): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    const payload = presets.slice(0, MAX_CASH_PRESETS).map((p) => ({
      id: p.id,
      name: p.name.trim().slice(0, MAX_PRESET_NAME_LEN),
      createdAt: p.createdAt,
      input: serializeCashInput(p.input),
    }));
    localStorage.setItem(CASH_USER_PRESETS_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function addCashUserPreset(
  existing: CashUserPreset[],
  name: string,
  input: CashInput,
): CashUserPreset[] {
  const trimmed = name.trim().slice(0, MAX_PRESET_NAME_LEN);
  if (!trimmed) return existing;
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `cash-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const entry: CashUserPreset = {
    id,
    name: trimmed,
    createdAt: Date.now(),
    input: normalizeCashInputForUi(input),
  };
  return [entry, ...existing].slice(0, MAX_CASH_PRESETS);
}

export function removeCashUserPreset(
  existing: CashUserPreset[],
  id: string,
): CashUserPreset[] {
  return existing.filter((p) => p.id !== id);
}

function csvCell(value: string | number): string {
  const raw = String(value);
  // Neutralize spreadsheet formula prefixes (=, +, -, @) when exporting text.
  const safe =
    typeof value === "string" && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function num(v: number, digits = 2): string {
  return Number.isFinite(v) ? v.toFixed(digits) : "";
}

export function buildCashStatsCsv(result: CashResult): string {
  const s = result.stats;
  const inp = result.echoInput;
  const bb = inp.bbSize;
  const rows: Array<[string, string | number]> = [
    ["metric", "value"],
    ["hands", inp.hands],
    ["simulations", result.samples],
    ["ref_bb_usd", bb],
    ["seed", inp.baseSeed],
    ["effective_wr_bb100", num(s.effectiveWrBb100, 2)],
    ["effective_sd_bb100", num(s.effectiveSdBb100, 2)],
    ["wr_std_err_bb100", num(inp.wrStdErr ?? 0, 2)],
    ["expected_ev_bb", num(s.expectedEvBb, 2)],
    ["expected_ev_usd", num(s.expectedEvUsd, 2)],
    ["mean_final_bb", num(s.meanFinalBb, 2)],
    ["mean_final_usd", num(s.meanFinalUsd, 2)],
    ["median_final_bb", num(s.finalBbMedian, 2)],
    ["p05_final_bb", num(s.finalBbP05, 2)],
    ["p95_final_bb", num(s.finalBbP95, 2)],
    ["sd_final_bb", num(s.sdFinalBb, 2)],
    ["prob_profit_pct", num(s.probProfit * 100, 2)],
    ["prob_loss_pct", num(s.probLoss * 100, 2)],
    ["risk_threshold_bb", result.oddsOverDistance.thresholdBb],
    ["prob_below_threshold_ever_pct", num(s.probBelowThresholdEver * 100, 2)],
    ["ror_asymptotic_pct", num(s.riskOfRuinAsymptotic * 100, 2)],
    ["min_bankroll_ror_1pct_bb", num(s.minBankrollRoR1pctBb, 1)],
    ["min_bankroll_ror_5pct_bb", num(s.minBankrollRoR5pctBb, 1)],
    ["min_bankroll_ror_10pct_bb", num(s.minBankrollRoR10pctBb, 1)],
    ["min_bankroll_empirical_1pct_bb", num(s.minBankrollEmpirical1pctBb, 1)],
    ["min_bankroll_empirical_5pct_bb", num(s.minBankrollEmpirical5pctBb, 1)],
    ["kelly_bankroll_bb", num(s.kellyBankrollBb, 1)],
    ["max_drawdown_median_bb", num(s.maxDrawdownMedian, 2)],
    ["max_drawdown_p95_bb", num(s.maxDrawdownP95, 2)],
    ["max_drawdown_p99_bb", num(s.maxDrawdownP99, 2)],
    ["max_drawdown_worst_bb", num(s.maxDrawdownWorst, 2)],
    ["longest_breakeven_median_hands", Math.round(s.longestBreakevenMedian)],
    ["recovery_median_hands", Number.isFinite(s.recoveryMedian) ? Math.round(s.recoveryMedian) : ""],
    ["recovery_p90_hands", Number.isFinite(s.recoveryP90) ? Math.round(s.recoveryP90) : ""],
    ["recovery_unrecovered_pct", num(s.recoveryUnrecoveredShare * 100, 2)],
    ["sharpe", num(s.sharpe, 3)],
    ["sortino", num(s.sortino, 3)],
    ["skewness", num(s.skewness, 3)],
    ["excess_kurtosis", num(s.kurtosis, 3)],
    ["var_95_bb", num(s.var95Bb, 2)],
    ["cvar_95_bb", num(s.cvar95Bb, 2)],
    ["mean_rake_paid_bb", num(s.meanRakePaidBb, 2)],
    ["mean_rb_earned_bb", num(s.meanRbEarnedBb, 2)],
  ];
  if (s.hourlyEvUsd !== undefined) {
    rows.push(["hourly_ev_usd", num(s.hourlyEvUsd, 2)]);
  }
  return rows.map(([k, v]) => `${csvCell(k)},${csvCell(v)}`).join("\n");
}
