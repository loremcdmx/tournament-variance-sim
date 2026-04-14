"use client";

import { useMemo } from "react";
import { useState } from "react";
import type { SimulationResult, TournamentRow } from "@/lib/sim/types";
import { useT, useLocale } from "@/lib/i18n/LocaleProvider";
import { UplotChart } from "./charts/UplotChart";
import { DistributionChart } from "./charts/DistributionChart";
import { ConvergenceChart } from "./charts/ConvergenceChart";
import { DecompositionChart } from "./charts/DecompositionChart";
import { SensitivityChart } from "./charts/SensitivityChart";
import { Card } from "./ui/Section";
import { InfoTooltip } from "./ui/Tooltip";
import type { AlignedData, Options } from "uplot";

interface Props {
  result: SimulationResult;
  compareResult?: SimulationResult | null;
  bankroll?: number;
  schedule?: TournamentRow[];
  scheduleRepeats?: number;
}

function fmt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

const money = (v: number) => {
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const intFmt = (v: number) =>
  v.toLocaleString(undefined, { maximumFractionDigits: 0 });

type AccentHue = "felt" | "magenta";

const HUES: Record<AccentHue, {
  mean: string;
  p0015: string;
  p025: string;
  p15: string;
  paths: string;
}> = {
  felt: {
    mean: "#34d399",
    p0015: "rgba(16,185,129,0.10)",
    p025: "rgba(16,185,129,0.20)",
    p15: "rgba(16,185,129,0.38)",
    paths: "rgba(148,163,184,0.25)",
  },
  magenta: {
    mean: "#f472b6",
    p0015: "rgba(236,72,153,0.08)",
    p025: "rgba(236,72,153,0.18)",
    p15: "rgba(236,72,153,0.34)",
    paths: "rgba(236,72,153,0.24)",
  },
};


function buildTrajectoryAssets(
  r: SimulationResult,
  bankroll: number,
  hue: AccentHue,
  yRange?: { min: number; max: number },
): { data: AlignedData; opts: Omit<Options, "width" | "height"> } {
  const x = r.samplePaths.x;
  const series: (Float64Array | number[])[] = [x];
  series.push(r.envelopes.mean);
  series.push(r.envelopes.p0015);
  series.push(r.envelopes.p9985);
  series.push(r.envelopes.p025);
  series.push(r.envelopes.p975);
  series.push(r.envelopes.p15);
  series.push(r.envelopes.p85);
  for (const p of r.samplePaths.paths) series.push(p);
  series.push(r.samplePaths.best);
  series.push(r.samplePaths.worst);
  if (bankroll > 0) {
    series.push(new Array<number>(x.length).fill(-bankroll));
  }

  const c = HUES[hue];
  const n = r.samplePaths.paths.length;
  const uplotSeries: Options["series"] = [
    {},
    { stroke: c.mean, width: 2 },
    { stroke: c.p0015, width: 1 },
    { stroke: c.p0015, width: 1 },
    { stroke: c.p025, width: 1 },
    { stroke: c.p025, width: 1 },
    { stroke: c.p15, width: 1 },
    { stroke: c.p15, width: 1 },
  ];
  for (let i = 0; i < n; i++) {
    uplotSeries.push({ stroke: c.paths, width: 1 });
  }
  uplotSeries.push({ stroke: "#34d399", width: 1.5 });
  uplotSeries.push({ stroke: "#f87171", width: 1.5 });
  if (bankroll > 0) {
    uplotSeries.push({ stroke: "#ef4444", width: 1.5, dash: [4, 4] });
  }

  return {
    data: series as AlignedData,
    opts: {
      scales: {
        x: { time: false },
        y: yRange
          ? { auto: false, range: () => [yRange.min, yRange.max] }
          : { auto: true },
      },
      axes: [
        {
          stroke: "#8a8a95",
          grid: { stroke: "rgba(128,128,128,0.15)" },
          ticks: { stroke: "rgba(128,128,128,0.2)" },
        },
        {
          stroke: "#8a8a95",
          grid: { stroke: "rgba(128,128,128,0.15)" },
          ticks: { stroke: "rgba(128,128,128,0.2)" },
        },
      ],
      series: uplotSeries,
      legend: { show: false },
      cursor: { drag: { x: true, y: false } },
    },
  };
}

function unionYRange(
  a: SimulationResult,
  b: SimulationResult,
  bankroll: number,
): { min: number; max: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of [a, b]) {
    for (const v of r.envelopes.p0015) {
      if (v < lo) lo = v;
    }
    for (const v of r.envelopes.p9985) {
      if (v > hi) hi = v;
    }
    for (const v of r.samplePaths.worst) {
      if (v < lo) lo = v;
    }
    for (const v of r.samplePaths.best) {
      if (v > hi) hi = v;
    }
  }
  if (bankroll > 0 && -bankroll < lo) lo = -bankroll;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) {
    return { min: -1, max: 1 };
  }
  const pad = (hi - lo) * 0.05;
  return { min: lo - pad, max: hi + pad };
}

export function ResultsView({
  result,
  compareResult,
  bankroll = 0,
  schedule,
  scheduleRepeats,
}: Props) {
  const t = useT();

  const pdChart = result.comparison;

  const yRange = useMemo(
    () =>
      pdChart ? unionYRange(result, pdChart, bankroll) : undefined,
    [result, pdChart, bankroll],
  );

  const primary = useMemo(
    () => buildTrajectoryAssets(result, bankroll, "felt", yRange),
    [result, bankroll, yRange],
  );
  const secondary = useMemo(
    () =>
      pdChart
        ? buildTrajectoryAssets(pdChart, bankroll, "magenta", yRange)
        : null,
    [pdChart, bankroll, yRange],
  );
  const slotOverlay = useMemo(
    () =>
      compareResult
        ? buildTrajectoryAssets(compareResult, bankroll, "magenta")
        : null,
    [compareResult, bankroll],
  );

  const s = result.stats;
  const roi = s.mean / result.totalBuyIn;

  return (
    <div className="flex flex-col gap-5">
      {secondary ? (
        <Card className="p-5">
          <ChartHeader
            title={t("chart.trajectory")}
            subtitle={
              bankroll > 0
                ? `${t("chart.trajectory.sub.vs")} · bankroll ${money(bankroll)}`
                : t("chart.trajectory.sub.vs")
            }
          />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartPane
              label={t("pd.ours")}
              hueDot="#34d399"
              caption={t("chart.trajectory.ours.cap")}
            >
              <UplotChart data={primary.data} options={primary.opts} height={420} />
            </ChartPane>
            <ChartPane
              label={t("pd.theirs")}
              hueDot="#f472b6"
              caption={t("chart.trajectory.theirs.cap")}
              action={
                schedule && scheduleRepeats ? (
                  <PrimedopeReproduceButton
                    schedule={schedule}
                    scheduleRepeats={scheduleRepeats}
                  />
                ) : null
              }
            >
              <UplotChart
                data={secondary.data}
                options={secondary.opts}
                height={420}
              />
            </ChartPane>
          </div>
          <div className="mt-3 text-[11px] text-[color:var(--color-fg-dim)]">
            {t("chart.trajectory.sharedY")}
          </div>
        </Card>
      ) : (
        <Card className="p-5">
          <ChartHeader
            title={t("chart.trajectory")}
            subtitle={
              bankroll > 0
                ? `${t("chart.trajectory.sub")} · bankroll ${money(bankroll)}`
                : t("chart.trajectory.sub")
            }
          />
          <UplotChart data={primary.data} options={primary.opts} height={440} />
          {slotOverlay && (
            <div className="mt-4">
              <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
                <span className="inline-block h-1.5 w-3 rounded-sm bg-[#f472b6]" />
                {t("slot.saved")}
              </div>
              <UplotChart
                data={slotOverlay.data}
                options={slotOverlay.opts}
                height={240}
              />
            </div>
          )}
        </Card>
      )}

      <VerdictCard result={result} bankroll={bankroll} />

      {result.comparison && (
        <>
          <PDVerdict primary={result} other={result.comparison} />
          <PrimedopeDiff primary={result} other={result.comparison} />
        </>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <BigStat
          suit="club"
          label={t("stat.expectedProfit")}
          value={money(s.mean)}
          sub={`ROI ${(roi * 100).toFixed(1)}%`}
          tone={s.mean >= 0 ? "pos" : "neg"}
        />
        <BigStat
          suit="diamond"
          label={t("stat.stdDev")}
          value={money(s.stdDev)}
          sub={`SE ${money(s.stdDev / Math.sqrt(result.samples))}`}
        />
        <BigStat
          suit="spade"
          label={t("stat.probProfit")}
          value={pct(s.probProfit)}
          sub={`median ${money(s.median)}`}
        />
        <BigStat
          suit="heart"
          label={t("stat.riskOfRuin")}
          value={pct(s.riskOfRuin)}
          sub={
            s.riskOfRuin === 0 && result.stats.minBankrollRoR1pct === 0
              ? t("stat.bankrollOff")
              : `min BR 1% = ${money(s.minBankrollRoR1pct)}`
          }
          tone={s.riskOfRuin > 0.05 ? "neg" : undefined}
        />
        <BigStat
          suit="spade"
          label={t("stat.itmRate")}
          value={pct(s.itmRate)}
          sub={t("stat.itmRate.sub")}
          tip={t("stat.itmRate.tip")}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <MiniStat
          suit="heart"
          label={t("stat.var")}
          value={`${money(s.var95)} / ${money(s.var99)}`}
          tone="neg"
        />
        <MiniStat
          suit="heart"
          label={t("stat.cvar")}
          value={`${money(s.cvar95)} / ${money(s.cvar99)}`}
          tone="neg"
        />
        <MiniStat
          suit="diamond"
          label={t("stat.sharpe")}
          value={s.sharpe.toFixed(3)}
          tone={s.sharpe >= 0 ? "pos" : "neg"}
        />
        <MiniStat
          suit="diamond"
          label={t("stat.sortino")}
          value={s.sortino.toFixed(3)}
          tone={s.sortino >= 0 ? "pos" : "neg"}
        />
        <MiniStat
          suit="diamond"
          label={t("stat.tFor95")}
          value={intFmt(s.tournamentsFor95ROI) + "t"}
        />
        <MiniStat
          suit="heart"
          label={t("stat.avgMaxDD")}
          value={money(s.maxDrawdownMean)}
        />
        <MiniStat
          suit="heart"
          label={t("stat.ddMedian")}
          value={money(s.maxDrawdownMedian)}
        />
        <MiniStat
          suit="heart"
          label={t("stat.ddP95")}
          value={money(s.maxDrawdownP95)}
          tone="neg"
        />
        <MiniStat
          suit="heart"
          label={t("stat.ddP99")}
          value={money(s.maxDrawdownP99)}
          tone="neg"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <MiniStat
          suit="club"
          label={t("stat.bestRun")}
          value={money(s.max)}
          tone="pos"
        />
        <MiniStat
          suit="heart"
          label={t("stat.worstRun")}
          value={money(s.min)}
          tone="neg"
        />
        <MiniStat
          suit="heart"
          label={t("stat.p1p5")}
          value={`${money(s.p01)} / ${money(s.p05)}`}
        />
        <MiniStat
          suit="club"
          label={t("stat.p95p99")}
          value={`${money(s.p95)} / ${money(s.p99)}`}
        />
        <MiniStat
          suit="diamond"
          label={t("stat.longestBE")}
          value={`${Math.round(s.longestBreakevenMean)}t`}
        />
        <MiniStat
          suit="heart"
          label={t("stat.minBR5")}
          value={money(s.minBankrollRoR5pct)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MiniStat
          suit="heart"
          label={t("stat.ddBI")}
          value={`${s.maxDrawdownBuyIns.toFixed(1)} BI`}
          tone="neg"
        />
        <MiniStat
          suit="spade"
          label={t("stat.skew")}
          value={s.skewness.toFixed(2)}
          tone={s.skewness >= 0 ? "pos" : "neg"}
        />
        <MiniStat
          suit="spade"
          label={t("stat.kurt")}
          value={s.kurtosis.toFixed(2)}
        />
        <MiniStat
          suit="diamond"
          label={t("stat.kelly")}
          value={s.kellyFraction > 0 ? pct(s.kellyFraction) : "—"}
          tone={s.kellyFraction > 0 ? "pos" : undefined}
        />
        <MiniStat
          suit="diamond"
          label={t("stat.kellyBR")}
          value={
            Number.isFinite(s.kellyBankroll) ? money(s.kellyBankroll) : "—"
          }
        />
        <MiniStat
          suit="club"
          label={t("stat.logG")}
          value={
            bankroll > 0 ? (s.logGrowthRate * 100).toFixed(3) + "%" : "—"
          }
          tone={s.logGrowthRate > 0 ? "pos" : s.logGrowthRate < 0 ? "neg" : undefined}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MiniStat
          suit="diamond"
          label={t("stat.recoveryMedian")}
          value={
            Number.isFinite(s.recoveryMedian)
              ? `${Math.round(s.recoveryMedian)}t`
              : "—"
          }
        />
        <MiniStat
          suit="heart"
          label={t("stat.recoveryP90")}
          value={
            Number.isFinite(s.recoveryP90)
              ? `${Math.round(s.recoveryP90)}t`
              : "—"
          }
          tone="neg"
        />
        <MiniStat
          suit="heart"
          label={t("stat.recoveryUnrecovered")}
          value={pct(s.recoveryUnrecoveredShare)}
          tone={s.recoveryUnrecoveredShare > 0.05 ? "neg" : undefined}
        />
        <MiniStat
          suit="diamond"
          label={t("stat.cashlessMean")}
          value={`${s.longestCashlessMean.toFixed(1)}t`}
        />
        <MiniStat
          suit="heart"
          label={t("stat.cashlessWorst")}
          value={`${s.longestCashlessWorst}t`}
          tone="neg"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <ChartHeader
            title={t("chart.dist")}
            subtitle={`${result.samples.toLocaleString()} ${t("app.samples")} · 60 bins`}
          />
          <DistributionChart
            binEdges={result.histogram.binEdges}
            counts={result.histogram.counts}
            color="#34d399"
          />
        </Card>
        <Card className="p-5">
          <ChartHeader
            title={t("chart.ddDist")}
            subtitle={t("chart.ddDist.sub")}
          />
          <DistributionChart
            binEdges={result.drawdownHistogram.binEdges}
            counts={result.drawdownHistogram.counts}
            color="#f87171"
          />
        </Card>
      </div>

      <Card className="p-5">
        <ChartHeader
          title={t("chart.convergence")}
          subtitle={t("chart.convergence.sub")}
        />
        <ConvergenceChart
          x={result.convergence.x}
          mean={result.convergence.mean}
          seLo={result.convergence.seLo}
          seHi={result.convergence.seHi}
        />
      </Card>

      <Card className="p-5">
        <ChartHeader
          title={t("chart.sensitivity")}
          subtitle={t("chart.sensitivity.sub")}
        />
        <SensitivityChart
          deltas={result.sensitivity.deltas}
          profits={result.sensitivity.expectedProfits}
        />
        <div className="mt-2 text-[11px] text-[color:var(--color-fg-dim)]">
          {t("sens.note")}
        </div>
      </Card>

      <Card className="p-5">
        <ChartHeader
          title={t("chart.decomp")}
          subtitle={t("chart.decomp.sub")}
        />
        <DecompositionChart rows={result.decomposition} />
      </Card>

      {result.downswings.length > 0 && (
        <Card className="p-5">
          <ChartHeader title={t("dd.title")} subtitle={t("dd.sub")} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="border-b border-[color:var(--color-border)] text-[10px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
                  <th className="py-2 text-left font-medium">{t("dd.rank")}</th>
                  <th className="py-2 text-right font-medium">
                    {t("dd.depth")}
                  </th>
                  <th className="py-2 text-right font-medium">
                    {t("dd.final")}
                  </th>
                  <th className="py-2 text-right font-medium">
                    {t("dd.breakeven")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.downswings.map((d) => (
                  <tr
                    key={d.rank}
                    className="border-b border-[color:var(--color-border)]/60 last:border-b-0"
                  >
                    <td className="py-2 text-[color:var(--color-fg-muted)]">
                      #{d.rank}
                    </td>
                    <td className="py-2 text-right tabular-nums text-[color:var(--color-danger)]">
                      {money(-d.depth)}
                    </td>
                    <td
                      className={`py-2 text-right tabular-nums ${d.finalProfit >= 0 ? "text-[color:var(--color-success)]" : "text-[color:var(--color-fg)]"}`}
                    >
                      {money(d.finalProfit)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-[color:var(--color-fg-muted)]">
                      {Math.round(d.longestBreakeven)}t
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function ChartPane({
  label,
  hueDot,
  caption,
  children,
  action,
}: {
  label: string;
  hueDot: string;
  caption: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[color:var(--color-border)]/60 bg-[color:var(--color-bg-elev-2)]/30 p-3">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: hueDot }}
        />
        <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--color-fg)]">
          {label}
        </span>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
      <div className="text-[11px] leading-snug text-[color:var(--color-fg-dim)]">
        {caption}
      </div>
    </div>
  );
}

function buildPrimedopeCheatSheet(
  schedule: TournamentRow[],
  scheduleRepeats: number,
  locale: "en" | "ru",
): string {
  const r = schedule[0];
  const totalTourneys = Math.round(
    schedule.reduce((acc, row) => acc + row.count, 0) * scheduleRepeats,
  );
  const paidPct =
    r.payoutStructure === "satellite-ticket"
      ? 10
      : r.payoutStructure === "mtt-flat"
      ? 20
      : r.payoutStructure === "mtt-top-heavy"
      ? 12
      : r.payoutStructure === "mtt-gg"
      ? 18
      : r.payoutStructure === "mtt-sunday-million"
      ? 13.8
      : 15;
  const lines =
    locale === "ru"
      ? [
          `# Введи в PrimeDope вручную:`,
          `Number of tournaments: ${totalTourneys}`,
          `Buy-in: $${r.buyIn}`,
          `Rake: ${(r.rake * 100).toFixed(1)}%`,
          `Field size: ${r.players}`,
          `ROI: ${(r.roi * 100).toFixed(1)}%`,
          `Places paid: ~${paidPct}% поля`,
          ``,
          schedule.length > 1
            ? `⚠ В расписании ${schedule.length} строк — PrimeDope умеет только одну. Скопированы параметры первой строки (${r.label ?? r.id}).`
            : ``,
        ]
      : [
          `# Paste into PrimeDope manually:`,
          `Number of tournaments: ${totalTourneys}`,
          `Buy-in: $${r.buyIn}`,
          `Rake: ${(r.rake * 100).toFixed(1)}%`,
          `Field size: ${r.players}`,
          `ROI: ${(r.roi * 100).toFixed(1)}%`,
          `Places paid: ~${paidPct}% of field`,
          ``,
          schedule.length > 1
            ? `⚠ Your schedule has ${schedule.length} rows — PrimeDope only handles one. The first row's values were copied (${r.label ?? r.id}).`
            : ``,
        ];
  return lines.filter(Boolean).join("\n");
}

function PrimedopeReproduceButton({
  schedule,
  scheduleRepeats,
}: {
  schedule: TournamentRow[];
  scheduleRepeats: number;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [copied, setCopied] = useState(false);
  const handleClick = async () => {
    const cheat = buildPrimedopeCheatSheet(schedule, scheduleRepeats, locale);
    try {
      await navigator.clipboard.writeText(cheat);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // ignore — still open the tab
    }
    window.open(
      "https://www.primedope.com/tournament-variance-calculator/",
      "_blank",
      "noopener,noreferrer",
    );
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      title={t("pd.reproduce.hint")}
      className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-[color:var(--color-fg-muted)] hover:border-[color:var(--color-border-strong)] hover:text-[color:var(--color-fg)]"
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
        <path
          d="M14 3h7v7M10 14L21 3M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {copied ? t("pd.reproduce.copied") : t("pd.reproduce.label")}
    </button>
  );
}

function ChartHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-3">
      <div className="text-sm font-semibold text-[color:var(--color-fg)]">
        {title}
      </div>
      <div className="text-xs text-[color:var(--color-fg-dim)]">{subtitle}</div>
    </div>
  );
}

type StatSuit = "club" | "heart" | "spade" | "diamond";

const SUIT_COLOR: Record<StatSuit, string> = {
  club: "var(--color-club)",
  heart: "var(--color-heart)",
  spade: "var(--color-spade)",
  diamond: "var(--color-diamond)",
};
const SUIT_GLYPH: Record<StatSuit, string> = {
  club: "♣",
  heart: "♥",
  spade: "♠",
  diamond: "♦",
};

function BigStat({
  label,
  value,
  sub,
  tone,
  tip,
  suit = "club",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "pos" | "neg";
  tip?: string;
  suit?: StatSuit;
}) {
  const toneColor =
    tone === "pos"
      ? "var(--color-success)"
      : tone === "neg"
        ? "var(--color-danger)"
        : SUIT_COLOR[suit];
  return (
    <div className="relative flex flex-col gap-1 border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)]/80 px-4 py-4">
      <span
        className="absolute left-0 top-0 h-full w-[3px]"
        style={{ background: SUIT_COLOR[suit] }}
      />
      <span
        className="absolute right-2 top-2 font-mono text-xs opacity-40"
        style={{ color: SUIT_COLOR[suit] }}
      >
        {SUIT_GLYPH[suit]}
      </span>
      <div
        className="eyebrow flex items-center gap-1.5"
        style={{ color: SUIT_COLOR[suit] }}
      >
        {label}
        {tip && <InfoTooltip content={tip} />}
      </div>
      <div
        className="font-mono text-[26px] font-bold leading-none tabular-nums"
        style={{ color: toneColor }}
      >
        {value}
      </div>
      {sub && (
        <div className="text-[11px] text-[color:var(--color-fg-dim)]">
          {sub}
        </div>
      )}
    </div>
  );
}

function VerdictCard({
  result,
  bankroll,
}: {
  result: SimulationResult;
  bankroll: number;
}) {
  const t = useT();
  const s = result.stats;
  const roi = s.mean / result.totalBuyIn;
  const roiStr = `${(roi * 100).toFixed(1)}%`;

  const lines: { key: string; text: string; tone: "pos" | "neg" | "neutral" }[] =
    [];

  // Expected profit
  lines.push({
    key: "ev",
    text: fmt(t(s.mean >= 0 ? "verdict.ev.good" : "verdict.ev.bad"), {
      mean: money(Math.abs(s.mean)),
      roi: roiStr,
    }),
    tone: s.mean >= 0 ? "pos" : "neg",
  });

  // Probability of profit
  let qKey: "verdict.prob.q.great" | "verdict.prob.q.good" | "verdict.prob.q.meh" | "verdict.prob.q.bad";
  if (s.probProfit >= 0.8) qKey = "verdict.prob.q.great";
  else if (s.probProfit >= 0.6) qKey = "verdict.prob.q.good";
  else if (s.probProfit >= 0.45) qKey = "verdict.prob.q.meh";
  else qKey = "verdict.prob.q.bad";
  lines.push({
    key: "prob",
    text: fmt(t("verdict.prob"), {
      prob: pct(s.probProfit),
      qual: t(qKey),
    }),
    tone: s.probProfit >= 0.6 ? "pos" : s.probProfit >= 0.45 ? "neutral" : "neg",
  });

  // Swing / worst 1% case
  lines.push({
    key: "swing",
    text: fmt(t("verdict.swing"), {
      dd: money(s.maxDrawdownMean),
      cvar99: money(s.cvar99),
    }),
    tone: "neutral",
  });

  // Bankroll advice
  if (bankroll > 0) {
    lines.push({
      key: "br-with",
      text: fmt(t("verdict.bankroll.with"), {
        br: money(bankroll),
        ror: pct(s.riskOfRuin),
      }),
      tone: s.riskOfRuin > 0.05 ? "neg" : s.riskOfRuin > 0.01 ? "neutral" : "pos",
    });
  }
  if (s.minBankrollRoR1pct > 0) {
    lines.push({
      key: "br-need",
      text: fmt(t("verdict.bankroll.need"), {
        minBR: money(s.minBankrollRoR1pct),
      }),
      tone: "neutral",
    });
  }

  // Trust in ROI estimate
  lines.push({
    key: "trust",
    text: fmt(t("verdict.trust"), {
      n: intFmt(s.tournamentsFor95ROI),
    }),
    tone: "neutral",
  });

  // vs PrimeDope
  if (result.comparison) {
    const itmDiff = ((s.itmRate - result.comparison.stats.itmRate) * 100).toFixed(2);
    const ddDiff = `${((s.maxDrawdownMean / Math.max(1, result.comparison.stats.maxDrawdownMean) - 1) * 100).toFixed(0)}%`;
    lines.push({
      key: "vspd",
      text: fmt(t("verdict.vsPD"), { itmDiff, ddDiff }),
      tone: "neutral",
    });
  }

  return (
    <div className="bracketed bracketed-heart relative border border-[color:var(--color-heart)]/60 bg-[color:var(--color-heart)]/[0.04] p-6">
      <div className="mb-4 flex items-center justify-between border-b border-[color:var(--color-heart)]/30 pb-3">
        <div className="flex items-center gap-3">
          <span className="section-num text-2xl text-[color:var(--color-heart)]">
            ♥
          </span>
          <div>
            <div className="eyebrow text-[color:var(--color-heart)]">
              / verdict
            </div>
            <div className="text-base font-bold uppercase tracking-tight text-[color:var(--color-fg)]">
              {t("verdict.title")}
            </div>
          </div>
        </div>
      </div>
      <ul className="flex flex-col gap-3">
        {lines.map((l) => {
          const dot =
            l.tone === "pos"
              ? "bg-[color:var(--color-success)]"
              : l.tone === "neg"
                ? "bg-[color:var(--color-danger)]"
                : "bg-[color:var(--color-fg-dim)]";
          return (
            <li key={l.key} className="flex items-start gap-3">
              <span
                className={`mt-1 inline-block h-4 w-[3px] flex-shrink-0 ${dot}`}
              />
              <span className="text-[14px] leading-relaxed text-[color:var(--color-fg-muted)]">
                {l.text}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const PDV_SUIT_COLOR: Record<"heart" | "diamond" | "spade", string> = {
  heart: "var(--color-heart)",
  diamond: "var(--color-diamond)",
  spade: "var(--color-spade)",
};

function PDVerdictRow({
  label,
  ours,
  theirs,
  delta,
  worse,
  suit,
}: {
  label: string;
  ours: string;
  theirs: string;
  delta: string;
  worse: boolean;
  suit: "heart" | "diamond" | "spade";
}) {
  const color = PDV_SUIT_COLOR[suit];
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-3">
      <div
        className="text-[10px] font-semibold uppercase tracking-[0.15em]"
        style={{ color }}
      >
        {label}
      </div>
      <div className="flex items-baseline gap-3">
        <div className="flex flex-col">
          <span className="text-[9px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
            PrimeDope
          </span>
          <span className="font-mono text-sm tabular-nums text-[color:var(--color-fg-muted)] line-through decoration-[color:var(--color-rival)]/60">
            {theirs}
          </span>
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          className="text-[color:var(--color-fg-dim)]"
        >
          <path
            d="M5 12h14M13 6l6 6-6 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className="flex flex-col">
          <span className="text-[9px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
            reality
          </span>
          <span
            className="font-mono text-lg font-semibold tabular-nums"
            style={{ color }}
          >
            {ours}
          </span>
        </div>
      </div>
      <div
        className="text-[10px] font-medium"
        style={{
          color: worse ? "var(--color-heart)" : "var(--color-club)",
        }}
      >
        {delta}
      </div>
    </div>
  );
}

function PDVerdict({
  primary,
  other,
}: {
  primary: SimulationResult;
  other: SimulationResult;
}) {
  const t = useT();
  const ours = primary.stats;
  const theirs = other.stats;

  const sigmaRatio = ours.stdDev / Math.max(1e-9, theirs.stdDev);
  const ddRatio =
    ours.maxDrawdownMean / Math.max(1e-9, theirs.maxDrawdownMean);
  const beDelta = Math.round(
    ours.longestBreakevenMean - theirs.longestBreakevenMean,
  );
  const itmPp = (ours.itmRate - theirs.itmRate) * 100;

  const sigmaWorse = sigmaRatio >= 1;
  const ddWorse = ddRatio >= 1;
  const itmWorse = itmPp <= 0;

  const fmtMult = (r: number) => {
    const v = r >= 1 ? r : 1 / r;
    return v.toFixed(v >= 10 ? 0 : v >= 2 ? 1 : 2);
  };
  const fmtDelta = (v: number) => (v >= 0 ? `+${v}` : `${v}`);
  const fmtPp = (v: number) => Math.abs(v).toFixed(1);

  const headlineRatio = Math.max(
    sigmaWorse ? sigmaRatio : 1 / Math.max(1e-9, sigmaRatio),
    ddWorse ? ddRatio : 1 / Math.max(1e-9, ddRatio),
  );

  return (
    <Card className="bracketed-heart overflow-hidden border-[color:var(--color-heart)]/40 p-6">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[color:var(--color-heart)]">♥</span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--color-heart)]">
          {t("pdv.eyebrow")}
        </span>
      </div>
      <h3 className="mb-1 text-[18px] font-black uppercase leading-tight text-[color:var(--color-fg)]">
        {t("pdv.title")}
      </h3>
      <p className="mb-4 text-[13px] leading-relaxed text-[color:var(--color-fg-muted)]">
        {t("pdv.titleReality")}
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <PDVerdictRow
          label={t("pdv.sigma")}
          ours={money(ours.stdDev)}
          theirs={money(theirs.stdDev)}
          delta={fmt(
            sigmaWorse ? t("pdv.sigmaDelta") : t("pdv.sigmaDeltaNeg"),
            { mult: fmtMult(sigmaRatio) },
          )}
          worse={sigmaWorse}
          suit="diamond"
        />
        <PDVerdictRow
          label={t("pdv.worst")}
          ours={money(ours.maxDrawdownMean)}
          theirs={money(theirs.maxDrawdownMean)}
          delta={fmt(
            ddWorse ? t("pdv.worstDelta") : t("pdv.worstDeltaNeg"),
            { mult: fmtMult(ddRatio) },
          )}
          worse={ddWorse}
          suit="heart"
        />
        <PDVerdictRow
          label={t("pdv.breakeven")}
          ours={`${Math.round(ours.longestBreakevenMean)}t`}
          theirs={`${Math.round(theirs.longestBreakevenMean)}t`}
          delta={fmt(
            beDelta >= 0 ? t("pdv.breakevenDelta") : t("pdv.breakevenDeltaNeg"),
            { delta: fmtDelta(beDelta) },
          )}
          worse={beDelta > 0}
          suit="heart"
        />
        <PDVerdictRow
          label={t("pdv.itm")}
          ours={pct(ours.itmRate)}
          theirs={pct(theirs.itmRate)}
          delta={fmt(
            itmWorse ? t("pdv.itmDelta") : t("pdv.itmDeltaNeg"),
            { delta: fmtPp(itmPp) },
          )}
          worse={itmWorse}
          suit="spade"
        />
      </div>

      <div className="mt-5 rounded-lg border border-[color:var(--color-heart)]/30 bg-[color:var(--color-heart)]/5 p-4">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[color:var(--color-heart)]">
          {t("pdv.whyTitle")}
        </div>
        <ul className="flex flex-col gap-2 text-[12.5px] leading-relaxed text-[color:var(--color-fg-muted)]">
          <li className="flex gap-2">
            <span className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full bg-[color:var(--color-heart)]" />
            <span>{t("pdv.why1")}</span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full bg-[color:var(--color-heart)]" />
            <span>{t("pdv.why2")}</span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full bg-[color:var(--color-club)]" />
            <span>{t("pdv.why3")}</span>
          </li>
        </ul>
        <div className="mt-3 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/60 p-3 text-[11.5px] leading-relaxed text-[color:var(--color-fg-muted)]">
          <span className="mr-1 font-semibold text-[color:var(--color-fg)]">
            {t("pdv.externalTitle")}
          </span>
          {t("pdv.externalBody")}{" "}
          <a
            href="https://muchomota.substack.com/p/flaws-in-monte-carlo-simulations"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-dotted underline-offset-2 hover:text-[color:var(--color-fg)]"
          >
            muchomota, Substack 2024
          </a>
        </div>
        <div className="mt-3 border-t border-[color:var(--color-heart)]/20 pt-3 text-[12px] font-medium text-[color:var(--color-fg)]">
          {fmt(
            sigmaWorse || ddWorse ? t("pdv.takeaway") : t("pdv.takeawayNeg"),
            { mult: fmtMult(headlineRatio) },
          )}
        </div>
      </div>
    </Card>
  );
}

function PrimedopeDiff({
  primary,
  other,
}: {
  primary: SimulationResult;
  other: SimulationResult;
}) {
  const t = useT();
  const ours = primary.stats;
  const theirs = other.stats;
  const pctPp = (a: number, b: number) =>
    `${((a - b) * 100).toFixed(2)} pp`;
  const ratioPct = (a: number, b: number) =>
    `${((a / Math.max(1e-9, b) - 1) * 100).toFixed(1)} %`;
  const diffMoney = (a: number, b: number) =>
    `${a - b >= 0 ? "+" : "−"}${money(Math.abs(a - b))}`;
  const rows: { label: string; ours: string; theirs: string; delta: string }[] = [
    {
      label: t("pd.row.itm"),
      ours: pct(ours.itmRate),
      theirs: pct(theirs.itmRate),
      delta: pctPp(ours.itmRate, theirs.itmRate),
    },
    {
      label: t("pd.row.pprofit"),
      ours: pct(ours.probProfit),
      theirs: pct(theirs.probProfit),
      delta: pctPp(ours.probProfit, theirs.probProfit),
    },
    {
      label: t("pd.row.stdDev"),
      ours: money(ours.stdDev),
      theirs: money(theirs.stdDev),
      delta: ratioPct(ours.stdDev, theirs.stdDev),
    },
    {
      label: t("pd.row.sharpe"),
      ours: ours.sharpe.toFixed(3),
      theirs: theirs.sharpe.toFixed(3),
      delta: (ours.sharpe - theirs.sharpe).toFixed(3),
    },
    {
      label: t("pd.row.dd"),
      ours: money(ours.maxDrawdownMean),
      theirs: money(theirs.maxDrawdownMean),
      delta: ratioPct(ours.maxDrawdownMean, theirs.maxDrawdownMean),
    },
    {
      label: t("pd.row.ddWorst"),
      ours: money(ours.maxDrawdownWorst),
      theirs: money(theirs.maxDrawdownWorst),
      delta: diffMoney(ours.maxDrawdownWorst, theirs.maxDrawdownWorst),
    },
    {
      label: t("pd.row.longestBE"),
      ours: `${Math.round(ours.longestBreakevenMean)}t`,
      theirs: `${Math.round(theirs.longestBreakevenMean)}t`,
      delta: `${Math.round(ours.longestBreakevenMean - theirs.longestBreakevenMean)}t`,
    },
    {
      label: t("pd.row.var95"),
      ours: money(ours.var95),
      theirs: money(theirs.var95),
      delta: diffMoney(ours.var95, theirs.var95),
    },
    {
      label: t("pd.row.cvar"),
      ours: money(ours.cvar95),
      theirs: money(theirs.cvar95),
      delta: ratioPct(ours.cvar95, theirs.cvar95),
    },
    {
      label: t("pd.row.cvar99"),
      ours: money(ours.cvar99),
      theirs: money(theirs.cvar99),
      delta: ratioPct(ours.cvar99, theirs.cvar99),
    },
    {
      label: t("pd.row.worstRun"),
      ours: money(ours.min),
      theirs: money(theirs.min),
      delta: diffMoney(ours.min, theirs.min),
    },
    {
      label: t("pd.row.bestRun"),
      ours: money(ours.max),
      theirs: money(theirs.max),
      delta: diffMoney(ours.max, theirs.max),
    },
    {
      label: t("pd.row.ror"),
      ours: pct(ours.riskOfRuin),
      theirs: pct(theirs.riskOfRuin),
      delta: pctPp(ours.riskOfRuin, theirs.riskOfRuin),
    },
  ];
  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-[color:var(--color-fg)]">
            {t("pd.title")}
          </div>
          <div className="text-xs text-[color:var(--color-fg-dim)]">
            {t("pd.subtitle")}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider">
          <span className="flex items-center gap-1 text-[color:var(--color-fg-muted)]">
            <span className="inline-block h-1.5 w-3 rounded-sm bg-[#34d399]" />{" "}
            {t("pd.ours")}
          </span>
          <span className="flex items-center gap-1 text-[color:var(--color-fg-muted)]">
            <span className="inline-block h-1.5 w-3 rounded-sm bg-[#f472b6]" />{" "}
            {t("pd.theirs")}
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-[color:var(--color-border)] text-[10px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
              <th className="py-2 text-left font-medium">{t("pd.metric")}</th>
              <th className="py-2 text-right font-medium">{t("pd.ours")}</th>
              <th className="py-2 text-right font-medium">{t("pd.theirs")}</th>
              <th className="py-2 text-right font-medium">{t("pd.delta")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.label}
                className="border-b border-[color:var(--color-border)]/60 last:border-b-0"
              >
                <td className="py-2 text-[color:var(--color-fg-muted)]">
                  {r.label}
                </td>
                <td className="py-2 text-right font-semibold tabular-nums text-[color:var(--color-fg)]">
                  {r.ours}
                </td>
                <td className="py-2 text-right tabular-nums text-[#f472b6]">
                  {r.theirs}
                </td>
                <td className="py-2 text-right tabular-nums text-[color:var(--color-fg-muted)]">
                  {r.delta}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function MiniStat({
  label,
  value,
  tone,
  suit = "club",
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg";
  suit?: StatSuit;
}) {
  const toneColor =
    tone === "pos"
      ? "var(--color-success)"
      : tone === "neg"
        ? "var(--color-danger)"
        : "var(--color-fg)";
  return (
    <div
      className="flex flex-col gap-0.5 border-l-2 border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)]/50 px-3 py-2.5"
      style={{ borderLeftColor: SUIT_COLOR[suit] }}
    >
      <div className="eyebrow" style={{ color: SUIT_COLOR[suit] }}>
        {label}
      </div>
      <div
        className="font-mono text-[13px] font-semibold tabular-nums"
        style={{ color: toneColor }}
      >
        {value}
      </div>
    </div>
  );
}
