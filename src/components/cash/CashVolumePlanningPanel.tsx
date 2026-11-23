"use client";

import { useMemo, useState } from "react";
import { LazyDisclosure } from "@/components/ui/LazyDisclosure";
import { useLocale, useT } from "@/lib/i18n/LocaleProvider";
import { numberLocaleTag } from "@/lib/i18n/numberLocale";
import {
  cashEffectiveSummary,
  computeCashConvergenceRows,
  computeCashProveEdgeRows,
  CASH_PROVE_EDGE_WRS,
} from "@/lib/sim/cashPlanning";
import type { CashInput } from "@/lib/sim/cashTypes";
import { useCashFormat } from "./cashFormat";

const CI_OPTIONS = [80, 90, 95, 99] as const;

export function CashVolumePlanningPanel({ input }: { input: CashInput }) {
  const t = useT();
  const { locale } = useLocale();
  const numberLocale = numberLocaleTag(locale);
  const fmt = useCashFormat();
  const [ciPct, setCiPct] = useState<number>(95);

  const summary = useMemo(() => cashEffectiveSummary(input), [input]);
  const convRows = useMemo(
    () =>
      computeCashConvergenceRows(
        summary.effectiveWrBb100,
        summary.effectiveSdBb100,
        ciPct,
      ),
    [summary.effectiveWrBb100, summary.effectiveSdBb100, ciPct],
  );
  const proveWrs = useMemo(() => {
    const base: number[] = [...CASH_PROVE_EDGE_WRS];
    const eff = Math.round(summary.effectiveWrBb100 * 10) / 10;
    if (eff > 0.25 && !base.some((w) => Math.abs(w - eff) < 0.05)) {
      base.push(eff);
      base.sort((a, b) => a - b);
    }
    return base;
  }, [summary.effectiveWrBb100]);

  const proveRows = useMemo(
    () =>
      computeCashProveEdgeRows(
        summary.effectiveSdBb100,
        ciPct,
        input.hoursBlock?.handsPerHour,
        proveWrs,
      ),
    [summary.effectiveSdBb100, ciPct, input.hoursBlock?.handsPerHour, proveWrs],
  );

  const fmtCompactHands = (h: number) =>
    !Number.isFinite(h)
      ? "∞"
      : h >= 1_000_000
        ? `${(h / 1_000_000).toLocaleString(numberLocale, { maximumFractionDigits: 1 })}M`
        : h >= 1_000
          ? `${Math.round(h / 1_000).toLocaleString(numberLocale)}k`
          : h.toLocaleString(numberLocale);

  const fmtBankrollBi = (bb: number) => {
    if (!Number.isFinite(bb)) return "∞";
    const bi = bb / 100;
    return `${Math.round(bb).toLocaleString(numberLocale)} BB (${bi.toLocaleString(numberLocale, { maximumFractionDigits: 0 })} BI)`;
  };

  const effWrRounded = Math.round(summary.effectiveWrBb100 * 10) / 10;

  return (
    <LazyDisclosure
      title={t("cash.planning.title")}
      description={t("cash.planning.desc")}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow text-[10px] tracking-[0.14em] text-[color:var(--color-fg-muted)]">
            {t("cash.planning.ciLabel")}
          </span>
          <div
            role="group"
            aria-label={t("cash.planning.ciLabel")}
            className="inline-flex overflow-hidden rounded-sm border border-[color:var(--color-border)]"
          >
            {CI_OPTIONS.map((opt, idx) => {
              const active = ciPct === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setCiPct(opt)}
                  className={
                    "px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors " +
                    (active
                      ? "bg-[color:var(--color-accent)] text-[color:var(--c-on-accent)]"
                      : "bg-[color:var(--color-bg)] text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)]") +
                    (idx > 0
                      ? " border-l border-[color:var(--color-border)]"
                      : "")
                  }
                >
                  {opt}%
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-2">
          <section className="min-w-0">
            <h3 className="mb-1 text-sm font-semibold text-[color:var(--color-fg)]">
              {t("cash.planning.convTitle")}
            </h3>
            <p className="mb-3 text-[11px] text-[color:var(--color-fg-muted)]">
              {t("cash.planning.convSub")
                .replace("{wr}", fmt.signedBb100(summary.effectiveWrBb100))
                .replace("{sd}", fmt.unsignedBb100(summary.effectiveSdBb100))
                .replace("{ci}", String(ciPct))}
            </p>
            <div className="overflow-x-auto rounded-sm border border-[color:var(--color-border)]/75">
              <table className="w-full border-collapse text-left font-mono text-[11px] tabular-nums">
                <thead>
                  <tr className="border-b border-[color:var(--color-border)] bg-[color:var(--color-bg)]/60 text-[10px] uppercase tracking-wider text-[color:var(--color-fg-muted)]">
                    <th className="px-2.5 py-2">{t("cash.planning.col.hands")}</th>
                    <th className="px-2.5 py-2 text-right">{t("cash.planning.col.ev")}</th>
                    <th className="px-2.5 py-2 text-right">{t("cash.planning.col.band")}</th>
                    <th className="px-2.5 py-2 text-right">{t("cash.planning.col.interval")}</th>
                    <th className="px-2.5 py-2 text-right">{t("cash.planning.col.probUp")}</th>
                  </tr>
                </thead>
                <tbody>
                  {convRows.map((row) => {
                    const isCurrent = row.hands === input.hands;
                    return (
                      <tr
                        key={row.hands}
                        className={
                          "border-b border-[color:var(--color-border)]/45 last:border-b-0 " +
                          (isCurrent ? "bg-[color:var(--color-accent)]/10 font-semibold" : "")
                        }
                      >
                        <td className="px-2.5 py-1.5 text-[color:var(--color-fg)]">
                          {fmtCompactHands(row.hands)}
                        </td>
                        <td className="px-2.5 py-1.5 text-right text-[color:var(--color-fg)]">
                          {fmt.bb(row.expectedEvBb)}
                        </td>
                        <td className="px-2.5 py-1.5 text-right text-[color:var(--color-fg-muted)]">
                          ±{row.halfWidthBb100.toLocaleString(numberLocale, { maximumFractionDigits: 1 })}
                        </td>
                        <td className="px-2.5 py-1.5 text-right text-[color:var(--color-fg-muted)]">
                          {fmt.signedBb100(row.loBb100)} .. {fmt.signedBb100(row.hiBb100)}
                        </td>
                        <td className="px-2.5 py-1.5 text-right text-[color:var(--color-fg)]">
                          {fmt.pct(row.probProfit)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="min-w-0">
            <h3 className="mb-1 text-sm font-semibold text-[color:var(--color-fg)]">
              {t("cash.planning.proveTitle")}
            </h3>
            <p className="mb-3 text-[11px] text-[color:var(--color-fg-muted)]">
              {t("cash.planning.proveSub")
                .replaceAll("{ci}", String(ciPct))
                .replace("{sd}", fmt.unsignedBb100(summary.effectiveSdBb100))}
            </p>
            <div className="overflow-x-auto rounded-sm border border-[color:var(--color-border)]/75">
              <table className="w-full border-collapse text-left font-mono text-[11px] tabular-nums">
                <thead>
                  <tr className="border-b border-[color:var(--color-border)] bg-[color:var(--color-bg)]/60 text-[10px] uppercase tracking-wider text-[color:var(--color-fg-muted)]">
                    <th className="px-2.5 py-2">{t("cash.planning.col.wr")}</th>
                    <th className="px-2.5 py-2 text-right">{t("cash.planning.col.hands")}</th>
                    {input.hoursBlock && (
                      <th className="px-2.5 py-2 text-right">{t("cash.planning.col.hours")}</th>
                    )}
                    <th className="px-2.5 py-2 text-right">{t("cash.planning.col.br5")}</th>
                    <th className="px-2.5 py-2 text-right">{t("cash.planning.col.br1")}</th>
                  </tr>
                </thead>
                <tbody>
                  {proveRows.map((row) => {
                    const isMine = Math.abs(row.wrBb100 - effWrRounded) < 0.05;
                    return (
                      <tr
                        key={row.wrBb100}
                        className={
                          "border-b border-[color:var(--color-border)]/45 last:border-b-0 " +
                          (isMine ? "bg-[color:var(--color-accent)]/10 font-semibold" : "")
                        }
                      >
                        <td className="px-2.5 py-1.5 text-[color:var(--color-fg)]">
                          {fmt.signedBb100(row.wrBb100)} bb/100
                        </td>
                        <td className="px-2.5 py-1.5 text-right text-[color:var(--color-fg)]">
                          {fmtCompactHands(row.handsRequired)}
                        </td>
                        {input.hoursBlock && (
                          <td className="px-2.5 py-1.5 text-right text-[color:var(--color-fg-muted)]">
                            {row.hoursRequired != null
                              ? Math.round(row.hoursRequired).toLocaleString(numberLocale)
                              : "—"}
                          </td>
                        )}
                        <td className="px-2.5 py-1.5 text-right text-[color:var(--color-fg-muted)]">
                          {fmtBankrollBi(row.bankroll5pctBb)}
                        </td>
                        <td className="px-2.5 py-1.5 text-right text-[color:var(--color-fg-muted)]">
                          {fmtBankrollBi(row.bankroll1pctBb)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </LazyDisclosure>
  );
}
