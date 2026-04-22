import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Section";
import { useT } from "@/lib/i18n/LocaleProvider";
import type { CashResult } from "@/lib/sim/cashTypes";
import {
  type CashMoneyUnit,
  type HeroStat,
  type StatRow,
  type SummaryStat,
  DetailList,
  HeroGrid,
  MixMetricBar,
  MixTag,
  SummaryStrip,
  formatCashMoney,
  formatCashPct,
  formatRiskThreshold,
  formatRiskThresholdBb,
  formatSignedBb100,
  formatUnsignedBb100,
  formatUsdBbSize,
  formatUsdRate,
  scaleMoneyHistogram,
} from "./CashResultsShared";
import {
  CashOddsChart,
  DiagnosticsDisclosure,
  HistogramChart,
  TrajectoryChart,
  TrajectoryToolbar,
} from "./CashResultsCharts";
import { ChartTitle, MiniChartTitle } from "./CashResultsShared";

export function CashResultsView({ result }: { result: CashResult }) {
  const t = useT();
  const s = result.stats;
  const bb = result.echoInput.bbSize;
  const riskThresholdBb = result.oddsOverDistance.thresholdBb;
  const mixBreakdown = result.mixBreakdown;
  const [moneyUnit, setMoneyUnit] = useState<CashMoneyUnit>("bb");
  const maxVisibleRuns = Math.max(1, Math.min(36, result.samplePaths.paths.length));
  const [visibleRuns, setVisibleRuns] = useState(() =>
    Math.min(12, maxVisibleRuns),
  );
  const clampedVisibleRuns = Math.max(
    0,
    Math.min(visibleRuns, maxVisibleRuns),
  );

  const fmtPct = (v: number) => formatCashPct(v);
  const fmtMoney = (vBb: number) => formatCashMoney(vBb, moneyUnit, bb);
  const fmtHands = (v: number) =>
    Number.isFinite(v)
      ? `${Math.round(v).toLocaleString()} ${t("cash.axis.hands")}`
      : "—";
  const moneyAxisLabel =
    moneyUnit === "usd" ? t("cash.axis.usd") : t("cash.axis.bb");

  const finalHistogram = useMemo(
    () => scaleMoneyHistogram(result.histogram, moneyUnit, bb),
    [result.histogram, moneyUnit, bb],
  );
  const drawdownHistogram = useMemo(
    () => scaleMoneyHistogram(result.drawdownHistogram, moneyUnit, bb),
    [result.drawdownHistogram, moneyUnit, bb],
  );
  const oddsEndIdx = Math.max(0, result.oddsOverDistance.x.length - 1);
  const oddsEndProfit = result.oddsOverDistance.profitShare[oddsEndIdx] ?? 0;
  const oddsEndBelowThresholdNow =
    result.oddsOverDistance.belowThresholdNowShare[oddsEndIdx] ?? 0;
  const riskThresholdLabel = formatRiskThresholdBb(riskThresholdBb);

  const heroStats: HeroStat[] = [
    {
      accent: "diamond",
      label: t("cash.hero.expected"),
      value: fmtMoney(s.expectedEvBb),
      sub:
        s.hourlyEvUsd !== undefined
          ? t("cash.hero.expected.subHourly")
              .replace("{hourly}", formatUsdRate(s.hourlyEvUsd))
              .replace(
                "{hands}",
                result.echoInput.hoursBlock?.handsPerHour.toLocaleString() ?? "—",
              )
          : t("cash.hero.expected.subDistance"),
      tone: "pos",
    },
    {
      accent: "spade",
      label: t("cash.hero.typical"),
      value: fmtMoney(s.finalBbMedian),
      sub: t("cash.hero.typical.subRange")
        .replace("{lo}", fmtMoney(s.finalBbP05))
        .replace("{hi}", fmtMoney(s.finalBbP95)),
    },
    {
      accent: "club",
      label: t("cash.hero.finishUp"),
      value: fmtPct(s.probProfit),
      sub: t("cash.hero.finishUp.subLoss").replace(
        "{pct}",
        fmtPct(s.probLoss),
      ),
      tone: s.probProfit >= 0.5 ? "pos" : "neg",
    },
    {
      accent: "heart",
      label: t("cash.hero.drawdown"),
      value: fmtMoney(s.maxDrawdownP95),
      sub: t("cash.hero.drawdown.subMedian").replace(
        "{value}",
        fmtMoney(s.maxDrawdownMedian),
      ),
      tone: "neg",
    },
    {
      accent: "spade",
      label: t("cash.hero.breakeven"),
      value: fmtHands(s.longestBreakevenMedian),
      sub: t("cash.hero.breakeven.subRecovery")
        .replace("{recovery}", fmtHands(s.recoveryP90))
        .replace("{share}", fmtPct(s.recoveryUnrecoveredShare)),
    },
  ];

  const finalSummary: SummaryStat[] = [
    {
      accent: "diamond",
      label: t("cash.summary.p05"),
      value: fmtMoney(s.finalBbP05),
    },
    {
      accent: "diamond",
      label: t("cash.summary.median"),
      value: fmtMoney(s.finalBbMedian),
    },
    {
      accent: "diamond",
      label: t("cash.summary.p95"),
      value: fmtMoney(s.finalBbP95),
    },
  ];

  const drawdownSummary: SummaryStat[] = [
    {
      accent: "heart",
      label: t("cash.summary.median"),
      value: fmtMoney(s.maxDrawdownMedian),
    },
    {
      accent: "heart",
      label: t("cash.summary.p95"),
      value: fmtMoney(s.maxDrawdownP95),
      tone: "neg",
    },
    {
      accent: "club",
      label: t("cash.summary.probBelowThresholdEver").replace(
        "{threshold}",
        riskThresholdLabel,
      ),
      value: fmtPct(s.probBelowThresholdEver),
      tone: s.probBelowThresholdEver > 0.05 ? "neg" : undefined,
    },
  ];

  const streakSummary: SummaryStat[] = [
    {
      accent: "spade",
      label: t("cash.summary.median"),
      value: fmtHands(s.longestBreakevenMedian),
    },
    {
      accent: "heart",
      label: t("cash.summary.recoveryMedian"),
      value: fmtHands(s.recoveryMedian),
    },
    {
      accent: "heart",
      label: t("cash.summary.unrecovered"),
      value: fmtPct(s.recoveryUnrecoveredShare),
      tone: s.recoveryUnrecoveredShare > 0.05 ? "neg" : undefined,
    },
  ];

  const oddsSummary: SummaryStat[] = [
    {
      accent: "club",
      label: t("cash.summary.oddsUp"),
      value: fmtPct(oddsEndProfit),
      tone: oddsEndProfit >= 0.5 ? "pos" : undefined,
    },
    {
      accent: "heart",
      label: t("cash.summary.oddsBelowThresholdNow").replace(
        "{threshold}",
        riskThresholdLabel,
      ),
      value: fmtPct(oddsEndBelowThresholdNow),
      tone: oddsEndBelowThresholdNow > 0.05 ? "neg" : undefined,
    },
  ];

  const economics: StatRow[] = [
    { label: t("cash.stats.meanRakePaidBb"), value: fmtMoney(s.meanRakePaidBb) },
    { label: t("cash.stats.meanRbEarnedBb"), value: fmtMoney(s.meanRbEarnedBb) },
  ];
  if (s.hourlyEvUsd !== undefined) {
    economics.push({
      label: t("cash.stats.hourlyEvUsd"),
      value: formatUsdRate(s.hourlyEvUsd),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <HeroGrid items={heroStats} />

      <Card className="data-surface-card p-4">
        <ChartTitle
          suit="heart"
          title={t("cash.chart.trajectory.title")}
          note={t("cash.chart.trajectory.note").replace(
            "{threshold}",
            formatRiskThreshold(riskThresholdBb, moneyUnit, bb),
          )}
        />
        <TrajectoryToolbar
          visibleRuns={clampedVisibleRuns}
          maxVisibleRuns={maxVisibleRuns}
          onVisibleRunsChange={setVisibleRuns}
          moneyUnit={moneyUnit}
          onMoneyUnitChange={setMoneyUnit}
          riskThresholdBb={riskThresholdBb}
          bbSize={bb}
        />
        <TrajectoryChart
          result={result}
          bbSize={bb}
          visibleRuns={clampedVisibleRuns}
          moneyUnit={moneyUnit}
          riskThresholdBb={riskThresholdBb}
        />
      </Card>

      {mixBreakdown && mixBreakdown.rows.length > 1 && (
        <MixBreakdownCard
          breakdown={mixBreakdown}
          moneyUnit={moneyUnit}
          bbSize={bb}
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="data-surface-card p-4">
          <ChartTitle suit="diamond" title={t("cash.chart.final.title")} />
          <SummaryStrip items={finalSummary} />
          <HistogramChart
            hist={finalHistogram}
            xLabel={moneyAxisLabel}
            yLabel={t("cash.axis.count")}
            tone="diamond"
          />
        </Card>
        <Card className="data-surface-card p-4">
          <ChartTitle suit="club" title={t("cash.chart.drawdown.title")} />
          <SummaryStrip items={drawdownSummary} />
          <HistogramChart
            hist={drawdownHistogram}
            xLabel={moneyAxisLabel}
            yLabel={t("cash.axis.count")}
            tone="club"
          />
        </Card>
      </div>

      <Card className="data-surface-card p-4">
        <ChartTitle
          suit="spade"
          title={t("cash.section.streaks.title")}
          note={t("cash.section.streaks.note")}
        />
        <SummaryStrip items={streakSummary} />
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="flex flex-col gap-3">
            <MiniChartTitle
              suit="spade"
              title={t("cash.chart.breakeven.title")}
              note={t("cash.chart.breakeven.note")}
            />
            <HistogramChart
              hist={result.longestBreakevenHistogram}
              xLabel={t("cash.axis.hands")}
              yLabel={t("cash.axis.count")}
              tone="spade"
            />
          </div>
          <div className="flex flex-col gap-3">
            <MiniChartTitle
              suit="heart"
              title={t("cash.chart.recovery.title")}
              note={t("cash.chart.recovery.note")}
            />
            <HistogramChart
              hist={result.recoveryHistogram}
              xLabel={t("cash.axis.hands")}
              yLabel={t("cash.axis.count")}
              tone="heart"
            />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Card className="data-surface-card p-4">
          <ChartTitle
            suit="club"
            title={t("cash.chart.odds.title")}
            note={t("cash.chart.odds.note").replace(
              "{threshold}",
              riskThresholdLabel,
            )}
          />
          <SummaryStrip items={oddsSummary} />
          <CashOddsChart result={result} />
        </Card>
        <Card className="data-surface-card p-4">
          <ChartTitle
            suit="diamond"
            title={t("cash.section.economics.title")}
            note={t("cash.section.economics.note")}
          />
          <DetailList rows={economics} accent="diamond" />
        </Card>
      </div>

      <DiagnosticsDisclosure result={result} />
    </div>
  );
}

function MixBreakdownCard({
  breakdown,
  moneyUnit,
  bbSize,
}: {
  breakdown: NonNullable<CashResult["mixBreakdown"]>;
  moneyUnit: CashMoneyUnit;
  bbSize: number;
}) {
  const t = useT();
  return (
    <Card className="data-surface-card p-4">
      <ChartTitle
        suit="diamond"
        title={t("cash.section.mix.title")}
        note={t("cash.section.mix.note")}
      />
      <div className="flex flex-col gap-3">
        {breakdown.rows.map((row, index) => (
          <MixBreakdownRowCard
            key={`${row.label ?? "row"}-${index}`}
            row={row}
            index={index}
            moneyUnit={moneyUnit}
            bbSize={bbSize}
          />
        ))}
      </div>
    </Card>
  );
}

function MixBreakdownRowCard({
  row,
  index,
  moneyUnit,
  bbSize,
}: {
  row: NonNullable<CashResult["mixBreakdown"]>["rows"][number];
  index: number;
  moneyUnit: CashMoneyUnit;
  bbSize: number;
}) {
  const t = useT();
  const rowLabel =
    row.label?.trim() ||
    t("cash.mix.rowFallback").replace("{index}", String(index + 1));
  const evTone =
    row.expectedEvBb < -1e-9
      ? "text-[color:var(--color-heart)]"
      : row.expectedEvBb > 1e-9
        ? "text-[color:var(--color-club)]"
        : "text-[color:var(--color-fg)]";

  return (
    <div className="rounded-sm border border-[color:var(--color-border)]/75 bg-[color:var(--color-bg)]/42 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-[color:var(--color-fg)]">
              {rowLabel}
            </span>
            <MixTag accent="diamond">
              {formatCashPct(row.handShare)}
            </MixTag>
            <MixTag accent="spade">{formatUsdBbSize(row.bbSize)}</MixTag>
          </div>
          <div className="flex flex-wrap gap-2">
            <MixTag accent="diamond">
              {row.hands.toLocaleString()} {t("cash.axis.hands")}
            </MixTag>
            <MixTag accent="club">
              {t("cash.wrBb100.label")}: {formatSignedBb100(row.wrBb100)}
            </MixTag>
            <MixTag accent="heart">
              {t("cash.sdBb100.label")}: {formatUnsignedBb100(row.sdBb100)}
            </MixTag>
          </div>
        </div>
        <div className="flex min-w-[10rem] flex-col gap-1 rounded-sm border border-[color:var(--color-border)]/65 bg-[color:var(--color-bg)]/55 px-3 py-2">
          <span className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fg-muted)]">
            {t("cash.mix.expectedEv")}
          </span>
          <span className={`font-mono text-[18px] font-semibold tabular-nums ${evTone}`}>
            {formatCashMoney(row.expectedEvBb, moneyUnit, bbSize)}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <MixMetricBar
          accent="diamond"
          label={t("cash.mix.metric.hands")}
          share={row.handShare}
          detail={`${formatCashPct(row.handShare)} · ${row.hands.toLocaleString()} ${t("cash.axis.hands")}`}
        />
        <MixMetricBar
          accent="heart"
          label={t("cash.mix.metric.swing")}
          share={row.varianceShare}
          detail={formatCashPct(row.varianceShare)}
        />
        <MixMetricBar
          accent="spade"
          label={t("cash.mix.metric.rake")}
          share={row.rakeShare}
          detail={`${formatCashPct(row.rakeShare)} · ${formatCashMoney(
            row.rakePaidBb,
            moneyUnit,
            bbSize,
          )}`}
        />
        <MixMetricBar
          accent="club"
          label={t("cash.mix.metric.rb")}
          share={row.rbShare}
          detail={`${formatCashPct(row.rbShare)} · ${formatCashMoney(
            row.rbEarnedBb,
            moneyUnit,
            bbSize,
          )}`}
        />
      </div>
    </div>
  );
}
