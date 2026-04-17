"use client";

import type { RowDecomposition } from "@/lib/sim/types";

interface Props {
  rows: RowDecomposition[];
}

const money = (v: number) => {
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

/**
 * Horizontal stacked-style visualization — pure CSS, no uPlot, because
 * per-row decomposition with error bars is much clearer as an HTML table.
 */
export function DecompositionChart({ rows }: Props) {
  const maxAbsMean = Math.max(1, ...rows.map((r) => Math.abs(r.mean) + r.stdDev));
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => {
        const meanPct = (r.mean / maxAbsMean) * 50; // ±50 % about center
        const sdPct = (r.stdDev / maxAbsMean) * 50;
        const isPos = r.mean >= 0;
        return (
          <div key={r.rowId} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between text-xs">
              <div className="flex items-baseline gap-2">
                <span className="font-medium text-[color:var(--color-fg)]">{r.label}</span>
                <span className="text-[color:var(--color-fg-dim)]">
                  {r.tournamentsPerSample} tourn · buy-in {money(r.totalBuyIn)}
                </span>
              </div>
              <div className="flex items-baseline gap-3 tabular-nums">
                <span
                  className={
                    isPos
                      ? "text-[color:var(--color-success)]"
                      : "text-[color:var(--color-danger)]"
                  }
                >
                  {money(r.mean)}
                </span>
                <span
                  className="text-[color:var(--color-fg-dim)]"
                  title="Typical profit swing — one standard deviation on this row's P&L"
                >
                  ± {money(r.stdDev)}
                </span>
                <span className="text-[color:var(--color-fg-dim)]">
                  {(r.varianceShare * 100).toFixed(0)}% var
                </span>
                <span
                  className="text-[color:var(--color-fg-dim)]"
                  title="Per-row Kelly f* = mean/variance"
                >
                  {r.kellyFraction > 0
                    ? `f* ${(r.kellyFraction * 100).toFixed(2)}%`
                    : "f* —"}
                </span>
              </div>
            </div>
            <div className="relative h-4 rounded-full bg-[color:var(--color-bg-elev-2)]">
              {/* Center line */}
              <div className="absolute top-0 bottom-0 left-1/2 w-px bg-[color:var(--color-border-strong)]" />
              {/* Error bar (mean ± σ) */}
              <div
                className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-[color:var(--color-fg)]/20"
                style={{
                  left: `${50 + Math.min(meanPct, 50) - sdPct}%`,
                  width: `${Math.min(sdPct * 2, 100)}%`,
                }}
              />
              {/* Mean bar */}
              <div
                className={`absolute top-1/2 h-2.5 -translate-y-1/2 ${
                  isPos ? "bg-[color:var(--color-success)]" : "bg-[color:var(--color-danger)]"
                }`}
                style={{
                  left: isPos ? "50%" : `${50 + meanPct}%`,
                  width: `${Math.abs(meanPct)}%`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
