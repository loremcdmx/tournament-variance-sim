import type { SimulationResult } from "@/lib/sim/types";

export function summarizePdStats(r: SimulationResult | null | undefined) {
  if (!r) return null;
  const s = r.stats;
  const num = (k: keyof SimulationResult["stats"]) =>
    typeof s[k] === "number" ? s[k] as number : undefined;
  const round = (v: number | undefined) =>
    v == null ? undefined : Math.round(v);
  const fix4 = (v: number | undefined) =>
    v == null ? undefined : Number(v.toFixed(4));
  return {
    mean: round(num("mean")),
    stdDev: round(num("stdDev")),
    median: round(num("median")),
    min: round(num("min")),
    max: round(num("max")),
    p01: round(num("p01")),
    p05: round(num("p05")),
    p95: round(num("p95")),
    p99: round(num("p99")),
    maxDrawdownMean: round(num("maxDrawdownMean")),
    maxDrawdownMedian: round(num("maxDrawdownMedian")),
    maxDrawdownP95: round(num("maxDrawdownP95")),
    maxDrawdownP99: round(num("maxDrawdownP99")),
    maxDrawdownWorst: round(num("maxDrawdownWorst")),
    minBankrollRoR1pct: num("minBankrollRoR1pct"),
    minBankrollRoR5pct: num("minBankrollRoR5pct"),
    itmRate: fix4(num("itmRate")),
    probProfit: fix4(num("probProfit")),
    riskOfRuin: fix4(num("riskOfRuin")),
    sigmaPerTourneyEmpirical: (() => {
      const v = num("sigmaPerTournamentEmpirical");
      return v == null ? undefined : Number(v.toFixed(2));
    })(),
    sigmaPerTourneyMath: (() => {
      const v = num("sigmaPerTournamentAnalytic");
      return v == null ? undefined : Number(v.toFixed(2));
    })(),
    spreadMaxMinusMean:
      num("max") != null && num("mean") != null
        ? Math.round((num("max") as number) - (num("mean") as number))
        : undefined,
  };
}

export function relativeDifferencePct(a: number, b: number): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(b) < 1e-9) return a === 0 ? 0 : null;
  return ((a - b) / Math.abs(b)) * 100;
}
