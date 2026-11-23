import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Section";
import { useLocale, useT } from "@/lib/i18n/LocaleProvider";
import { numberLocaleTag } from "@/lib/i18n/numberLocale";
import { countOrDash } from "@/lib/results/formatters";
import { shiftCashResultByRakeback } from "@/lib/results/cashTransforms";
import {
  buildCashShareUrl,
  buildCashStatsCsv,
} from "@/lib/cashPersistence";
import {
  DEFAULT_LINE_STYLE_PRESET,
  loadLineStylePreset,
  saveLineStylePreset,
} from "@/lib/lineStyles";
import { useLocalStorageState } from "@/lib/ui/useLocalStorageState";
import { MIX_BLOCK_HANDS } from "@/lib/sim/cashEngine";
import { cashRakeModelled } from "@/lib/sim/cashInput";
import type { CashResult, CashSwingEntry } from "@/lib/sim/cashTypes";
import type { RunMode } from "@/lib/trajectorySelection";
import {
  type CashMoneyUnit,
  type HeroStat,
  type StatRow,
  type SummaryStat,
  ChartTitle,
  DetailList,
  HeroGrid,
  MiniChartTitle,
  MixMetricBar,
  MixTag,
  SummaryStrip,
  UnitToggle,
  CashChartEmpty,
  isEmptyHistogram,
  scaleMoneyHistogram,
  signTone,
} from "./CashResultsShared";
import { useCashFormat } from "./cashFormat";
import {
  CASH_TRAJECTORY_RUN_CAP,
  CashOddsChart,
  DiagnosticsDisclosure,
  HistogramChart,
  TrajectoryChart,
  TrajectoryToolbar,
} from "./CashResultsCharts";

const CASH_UNIT_KEY = "tvs:cash-unit";

function loadCashUnit(): CashMoneyUnit {
  try {
    return localStorage.getItem(CASH_UNIT_KEY) === "usd" ? "usd" : "bb";
  } catch {
    return "bb";
  }
}

function saveCashUnit(unit: CashMoneyUnit): void {
  try {
    localStorage.setItem(CASH_UNIT_KEY, unit);
  } catch {}
}

export function CashResultsView({
  result: rawResult,
  stale = false,
}: {
  result: CashResult;
  stale?: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const numberLocale = numberLocaleTag(locale);
  const fmt = useCashFormat();

  const [moneyUnit, setMoneyUnit] = useLocalStorageState<CashMoneyUnit>(
    CASH_UNIT_KEY,
    loadCashUnit,
    saveCashUnit,
    "bb",
  );
  const [linePresetId, setLinePresetId] = useLocalStorageState(
    "tvs.lineStylePreset.v1",
    loadLineStylePreset,
    saveLineStylePreset,
    DEFAULT_LINE_STYLE_PRESET,
  );
  const [includeRakeback, setIncludeRakeback] = useState(true);
  const [showRiskLine, setShowRiskLine] = useState(true);
  const [showExtremes, setShowExtremes] = useState(false);
  const [copiedAction, setCopiedAction] = useState<"link" | "csv" | null>(null);

  const hasRakeback = rawResult.stats.meanRbEarnedBb > 0;
  const result = useMemo(
    () => shiftCashResultByRakeback(rawResult, includeRakeback),
    [rawResult, includeRakeback],
  );

  const s = result.stats;
  const bb = result.echoInput.bbSize;
  const riskThresholdBb = result.oddsOverDistance.thresholdBb;
  const mixBreakdown = result.mixBreakdown;
  const maxVisibleRuns = Math.max(
    1,
    Math.min(CASH_TRAJECTORY_RUN_CAP, result.samplePaths.paths.length),
  );
  const [visibleRuns, setVisibleRuns] = useState(() =>
    Math.min(80, maxVisibleRuns),
  );
  const [runMode, setRunMode] = useState<RunMode>("random");
  const clampedVisibleRuns = Math.max(
    0,
    Math.min(visibleRuns, maxVisibleRuns),
  );

  const fmtPct = fmt.pct;
  const fmtMoney = (vBb: number) => fmt.money(vBb, moneyUnit, bb);
  const fmtMoneyOrInf = (vBb: number) =>
    Number.isFinite(vBb) ? fmtMoney(vBb) : "∞";
  const fmtHands = (v: number) =>
    countOrDash(v, t("cash.handCount"), locale, "hand", numberLocale);
  const moneyAxisLabel =
    moneyUnit === "usd" ? t("cash.axis.usd") : t("cash.axis.bb");
  const moneyUnitLabel =
    moneyUnit === "usd" ? t("cash.unit.usd") : t("cash.unit.bb");

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
  const riskThresholdLabel = fmt.riskThresholdBb(riskThresholdBb);
  const rakeModelled = cashRakeModelled(result.echoInput);

  const copyText = async (text: string, which: "link" | "csv") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAction(which);
      window.setTimeout(
        () => setCopiedAction((c) => (c === which ? null : c)),
        1800,
      );
    } catch {}
  };

  const heroStats: HeroStat[] = [
    {
      accent: "diamond",
      label: t("cash.hero.expected"),
      value: fmtMoney(s.expectedEvBb),
      sub:
        s.hourlyEvUsd !== undefined
          ? t("cash.hero.expected.subHourly")
              .replace("{hourly}", fmt.usdRate(s.hourlyEvUsd))
              .replace(
                "{hands}",
                result.echoInput.hoursBlock?.handsPerHour.toLocaleString(
                  numberLocale,
                ) ?? "—",
              )
          : t("cash.hero.expected.subDistance"),
      tone: signTone(s.expectedEvBb),
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
      tip: t("cash.summary.probBelowThresholdEver.tip"),
    },
    {
      accent: "club",
      label: t("cash.summary.riskOfRuinAsymptotic"),
      value: fmtPct(s.riskOfRuinAsymptotic),
      tone: s.riskOfRuinAsymptotic > 0.05 ? "neg" : undefined,
      tip: mixBreakdown
        ? t("cash.summary.riskOfRuinAsymptotic.tip.mix")
        : t("cash.summary.riskOfRuinAsymptotic.tip"),
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
      tip: t("cash.summary.recoveryMedian.tip"),
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

  const economics: StatRow[] = [];
  if (rakeModelled) {
    economics.push(
      {
        label: t("cash.stats.meanRakePaidBb").replace("{unit}", moneyUnitLabel),
        value: fmtMoney(s.meanRakePaidBb),
      },
      {
        label: t("cash.stats.meanRbEarnedBb").replace("{unit}", moneyUnitLabel),
        value: fmtMoney(s.meanRbEarnedBb),
      },
    );
  }
  if (s.hourlyEvUsd !== undefined) {
    economics.push({
      label: t("cash.stats.hourlyEvUsd"),
      value: fmt.usdRate(s.hourlyEvUsd),
    });
  }

  const bankrollRows: StatRow[] = [
    {
      label: t("cash.results.br.ror1"),
      value: fmtMoneyOrInf(s.minBankrollRoR1pctBb),
    },
    {
      label: t("cash.results.br.ror5"),
      value: fmtMoneyOrInf(s.minBankrollRoR5pctBb),
    },
    {
      label: t("cash.results.br.ror10"),
      value: fmtMoneyOrInf(s.minBankrollRoR10pctBb),
    },
    {
      label: t("cash.results.br.emp1"),
      value: fmtMoney(s.minBankrollEmpirical1pctBb),
    },
    {
      label: t("cash.results.br.emp5"),
      value: fmtMoney(s.minBankrollEmpirical5pctBb),
    },
    {
      label: t("cash.results.br.kelly"),
      value: fmtMoneyOrInf(s.kellyBankrollBb),
    },
    {
      label: t("cash.results.br.halfKelly"),
      value: fmtMoneyOrInf(
        Number.isFinite(s.kellyBankrollBb) ? s.kellyBankrollBb * 2 : Infinity,
      ),
    },
    {
      label: t("cash.results.br.neverBelowZero"),
      value: fmtPct(s.neverBelowZeroFrac),
    },
    {
      label: t("cash.results.br.upNeverRisk"),
      value: fmtPct(s.probUpNeverBelowThreshold),
    },
  ];

  const fmtRatio = (v: number, digits = 2) =>
    Number.isFinite(v)
      ? v.toLocaleString(numberLocale, {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        })
      : "—";

  const advancedRows: StatRow[] = [
    {
      label: t("cash.results.stat.effWr"),
      value: `${fmt.signedBb100(s.effectiveWrBb100)} bb/100`,
    },
    {
      label: t("cash.results.stat.effSd"),
      value: `${fmt.unsignedBb100(s.effectiveSdBb100)} bb/100`,
    },
    {
      label: t("cash.results.stat.mcSe"),
      value: `±${fmtRatio(s.mcSeMeanBb100, 2)} bb/100`,
    },
    { label: t("cash.results.stat.sharpe"), value: fmtRatio(s.sharpe, 2) },
    { label: t("cash.results.stat.sortino"), value: fmtRatio(s.sortino, 2) },
    { label: t("cash.results.stat.skew"), value: fmtRatio(s.skewness, 2) },
    { label: t("cash.results.stat.kurt"), value: fmtRatio(s.kurtosis, 2) },
    { label: t("cash.results.stat.var95"), value: fmtMoney(s.var95Bb) },
    { label: t("cash.results.stat.cvar95"), value: fmtMoney(s.cvar95Bb) },
    { label: t("cash.results.stat.ddP99"), value: fmtMoney(s.maxDrawdownP99) },
    {
      label: t("cash.results.stat.ddWorst"),
      value: fmtMoney(s.maxDrawdownWorst),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {stale && (
        <div className="rounded-sm border border-amber-500/35 bg-amber-500/10 px-3.5 py-2 text-xs text-[color:var(--c-warn-fg)]">
          {t("cash.staleNotice")}
        </div>
      )}

      {/* Results action bar: global unit switch, post-run RB toggle, Share Link & CSV export */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-[color:var(--color-border)]/75 bg-[color:var(--color-bg-elev)]/65 px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="eyebrow text-[10px] tracking-[0.14em] text-[color:var(--color-fg-muted)]">
              {t("cash.toolbar.units")}
            </span>
            <UnitToggle
              value={moneyUnit}
              onChange={setMoneyUnit}
              options={[
                { value: "bb", label: t("cash.unit.bb") },
                { value: "usd", label: t("cash.unit.usd") },
              ]}
            />
          </div>
          {hasRakeback && (
            <label
              title={t("cash.results.includeRbNote")}
              className="inline-flex cursor-pointer items-center gap-2 rounded-sm border border-[color:var(--color-border)]/70 bg-[color:var(--color-bg)]/55 px-2.5 py-1.5 text-[11px] font-medium text-[color:var(--color-fg)]"
            >
              <input
                type="checkbox"
                checked={includeRakeback}
                onChange={(e) => setIncludeRakeback(e.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer accent-[color:var(--color-accent)]"
              />
              <span>{t("cash.results.includeRb")}</span>
            </label>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              copyText(buildCashShareUrl(rawResult.echoInput), "link")
            }
            className="rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
          >
            {copiedAction === "link"
              ? t("cash.share.copied")
              : t("cash.share.copy")}
          </button>
          <button
            type="button"
            onClick={() => copyText(buildCashStatsCsv(result), "csv")}
            className="rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
          >
            {copiedAction === "csv"
              ? t("cash.export.csvCopied")
              : t("cash.export.csv")}
          </button>
        </div>
      </div>

      <HeroGrid items={heroStats} />

      <Card className="data-surface-card p-4">
        <ChartTitle
          suit="heart"
          title={t("cash.chart.trajectory.title")}
          note={t("cash.chart.trajectory.note").replace(
            "{threshold}",
            fmt.riskThreshold(riskThresholdBb, moneyUnit, bb),
          )}
        />
        <TrajectoryToolbar
          visibleRuns={clampedVisibleRuns}
          maxVisibleRuns={maxVisibleRuns}
          onVisibleRunsChange={setVisibleRuns}
          runMode={runMode}
          onRunModeChange={setRunMode}
          moneyUnit={moneyUnit}
          onMoneyUnitChange={setMoneyUnit}
          riskThresholdBb={riskThresholdBb}
          bbSize={bb}
          showRiskLine={showRiskLine}
          onShowRiskLineChange={setShowRiskLine}
          showExtremes={showExtremes}
          onShowExtremesChange={setShowExtremes}
          linePresetId={linePresetId}
          onLinePresetChange={setLinePresetId}
        />
        <TrajectoryChart
          result={result}
          bbSize={bb}
          visibleRuns={clampedVisibleRuns}
          runMode={runMode}
          moneyUnit={moneyUnit}
          riskThresholdBb={riskThresholdBb}
          showRiskLine={showRiskLine}
          showExtremes={showExtremes}
          linePresetId={linePresetId}
        />
      </Card>

      {mixBreakdown && mixBreakdown.rows.length > 1 && (
        <MixBreakdownCard
          breakdown={mixBreakdown}
          moneyUnit={moneyUnit}
          bbSize={bb}
          rakeModelled={rakeModelled}
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

      {/* Bankroll & Risk Sizing + Distribution & Risk Ratios (MTT parity) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="data-surface-card p-4">
          <ChartTitle
            suit="club"
            title={t("cash.results.bankrollTitle")}
            note={t("cash.results.bankrollNote")}
          />
          <DetailList rows={bankrollRows} accent="club" />
        </Card>
        <Card className="data-surface-card p-4">
          <ChartTitle
            suit="spade"
            title={t("cash.results.advancedTitle")}
            note={t("cash.results.advancedNote")}
          />
          <DetailList rows={advancedRows} accent="spade" />
        </Card>
      </div>

      {/* Extreme Swings Catalog (Top 3 Downswings & Top 3 Upswings) */}
      {(result.downswings.length > 0 || result.upswings.length > 0) && (
        <CashSwingsCard
          downswings={result.downswings}
          upswings={result.upswings}
          moneyUnit={moneyUnit}
          bbSize={bb}
        />
      )}

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
            {isEmptyHistogram(result.longestBreakevenHistogram) ? (
              <CashChartEmpty message={t("cash.chart.breakeven.empty")} />
            ) : (
              <HistogramChart
                hist={result.longestBreakevenHistogram}
                xLabel={t("cash.axis.hands")}
                yLabel={t("cash.axis.count")}
                tone="spade"
              />
            )}
          </div>
          <div className="flex flex-col gap-3">
            <MiniChartTitle
              suit="heart"
              title={t("cash.chart.recovery.title")}
              note={t("cash.chart.recovery.note")}
            />
            {isEmptyHistogram(result.recoveryHistogram) ? (
              <CashChartEmpty
                message={t(
                  isEmptyHistogram(result.longestBreakevenHistogram)
                    ? "cash.chart.recovery.noDrawdown"
                    : "cash.chart.recovery.empty",
                )}
              />
            ) : (
              <HistogramChart
                hist={result.recoveryHistogram}
                xLabel={t("cash.axis.hands")}
                yLabel={t("cash.axis.count")}
                tone="heart"
              />
            )}
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
        <Card className="data-surface-card p-4 xl:self-start">
          <ChartTitle
            suit="diamond"
            title={t("cash.section.economics.title")}
            note={t("cash.section.economics.note")}
          />
          {economics.length > 0 && (
            <DetailList rows={economics} accent="diamond" />
          )}
          {!rakeModelled && (
            <p className="mt-3 text-[11px] leading-relaxed text-[color:var(--color-fg-muted)]">
              {t("cash.stats.rakeNotModelled")}
            </p>
          )}
        </Card>
      </div>

      <CashAssumptionsCard result={result} />

      <DiagnosticsDisclosure result={result} />
    </div>
  );
}

function CashSwingsCard({
  downswings,
  upswings,
  moneyUnit,
  bbSize,
}: {
  downswings: CashSwingEntry[];
  upswings: CashSwingEntry[];
  moneyUnit: CashMoneyUnit;
  bbSize: number;
}) {
  const t = useT();
  const { locale } = useLocale();
  const numberLocale = numberLocaleTag(locale);
  const fmt = useCashFormat();
  const fmtMoney = (vBb: number) => fmt.money(vBb, moneyUnit, bbSize);
  const fmtHands = (v: number) =>
    countOrDash(v, t("cash.handCount"), locale, "hand", numberLocale);

  return (
    <Card className="data-surface-card p-4">
      <ChartTitle
        suit="heart"
        title={t("cash.results.swingsTitle")}
        note={t("cash.results.swingsNote")}
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="flex flex-col gap-2">
          <MiniChartTitle suit="heart" title={t("cash.results.swings.down")} />
          <div className="overflow-x-auto rounded-sm border border-[color:var(--color-border)]/70">
            <table className="w-full border-collapse text-left font-mono text-[11px] tabular-nums">
              <thead>
                <tr className="border-b border-[color:var(--color-border)] bg-[color:var(--color-bg)]/55 text-[10px] uppercase tracking-wider text-[color:var(--color-fg-muted)]">
                  <th className="px-2.5 py-2">#</th>
                  <th className="px-2.5 py-2">{t("cash.results.swings.run")}</th>
                  <th className="px-2.5 py-2 text-right">{t("cash.results.swings.depth")}</th>
                  <th className="px-2.5 py-2 text-right">{t("cash.results.swings.final")}</th>
                  <th className="px-2.5 py-2 text-right">{t("cash.results.swings.rec")}</th>
                </tr>
              </thead>
              <tbody>
                {downswings.map((row) => (
                  <tr
                    key={`dd-${row.rank}-${row.sampleIndex}`}
                    className="border-b border-[color:var(--color-border)]/40 last:border-b-0"
                  >
                    <td className="px-2.5 py-1.5 text-[color:var(--color-fg-dim)]">
                      {row.rank}
                    </td>
                    <td className="px-2.5 py-1.5 text-[color:var(--color-fg-muted)]">
                      #{(row.sampleIndex + 1).toLocaleString(numberLocale)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right font-semibold text-[color:var(--color-heart)]">
                      −{fmtMoney(row.magnitudeBb)}
                    </td>
                    <td
                      className={`px-2.5 py-1.5 text-right ${
                        row.finalBb >= 0
                          ? "text-[color:var(--color-club)]"
                          : "text-[color:var(--color-heart)]"
                      }`}
                    >
                      {fmtMoney(row.finalBb)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right text-[color:var(--color-fg-muted)]">
                      {row.recoveryHands === -1
                        ? t("cash.results.swings.unrec")
                        : row.recoveryHands < 0
                          ? "—"
                          : fmtHands(row.recoveryHands)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <MiniChartTitle suit="club" title={t("cash.results.swings.up")} />
          <div className="overflow-x-auto rounded-sm border border-[color:var(--color-border)]/70">
            <table className="w-full border-collapse text-left font-mono text-[11px] tabular-nums">
              <thead>
                <tr className="border-b border-[color:var(--color-border)] bg-[color:var(--color-bg)]/55 text-[10px] uppercase tracking-wider text-[color:var(--color-fg-muted)]">
                  <th className="px-2.5 py-2">#</th>
                  <th className="px-2.5 py-2">{t("cash.results.swings.run")}</th>
                  <th className="px-2.5 py-2 text-right">{t("cash.results.swings.height")}</th>
                  <th className="px-2.5 py-2 text-right">{t("cash.results.swings.final")}</th>
                  <th className="px-2.5 py-2 text-right">{t("cash.results.swings.be")}</th>
                </tr>
              </thead>
              <tbody>
                {upswings.map((row) => (
                  <tr
                    key={`up-${row.rank}-${row.sampleIndex}`}
                    className="border-b border-[color:var(--color-border)]/40 last:border-b-0"
                  >
                    <td className="px-2.5 py-1.5 text-[color:var(--color-fg-dim)]">
                      {row.rank}
                    </td>
                    <td className="px-2.5 py-1.5 text-[color:var(--color-fg-muted)]">
                      #{(row.sampleIndex + 1).toLocaleString(numberLocale)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right font-semibold text-[color:var(--color-club)]">
                      +{fmtMoney(row.magnitudeBb)}
                    </td>
                    <td
                      className={`px-2.5 py-1.5 text-right ${
                        row.finalBb >= 0
                          ? "text-[color:var(--color-club)]"
                          : "text-[color:var(--color-heart)]"
                      }`}
                    >
                      {fmtMoney(row.finalBb)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right text-[color:var(--color-fg-muted)]">
                      {fmtHands(row.longestBreakevenHands)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Card>
  );
}

function CashAssumptionsCard({ result }: { result: CashResult }) {
  const t = useT();
  const { locale } = useLocale();
  const numberLocale = numberLocaleTag(locale);
  const fmt = useCashFormat();
  const lines = [
    t("cash.assumptions.model"),
    t("cash.assumptions.independence"),
    t("cash.assumptions.rakeback"),
  ];
  if ((result.echoInput.wrStdErr ?? 0) > 0) {
    lines.push(
      t("cash.assumptions.wrUncertainty").replace(
        "{sigma}",
        fmt.unsignedBb100(result.echoInput.wrStdErr!),
      ),
    );
  }
  if (result.mixBreakdown) {
    lines.push(
      t("cash.assumptions.mix")
        .replace("{block}", MIX_BLOCK_HANDS.toLocaleString(numberLocale))
        .replace("{bb}", fmt.usdBbSize(result.echoInput.bbSize)),
    );
  }
  return (
    <Card className="data-surface-card p-4">
      <ChartTitle
        suit="spade"
        title={t("cash.section.assumptions.title")}
        note={t("cash.section.assumptions.note")}
      />
      <ul className="flex flex-col gap-2 text-[11px] leading-relaxed text-[color:var(--color-fg-muted)]">
        {lines.map((line) => (
          <li key={line} className="flex gap-2">
            <span aria-hidden className="text-[color:var(--color-fg-dim)]">
              ·
            </span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function MixBreakdownCard({
  breakdown,
  moneyUnit,
  bbSize,
  rakeModelled,
}: {
  breakdown: NonNullable<CashResult["mixBreakdown"]>;
  moneyUnit: CashMoneyUnit;
  bbSize: number;
  rakeModelled: boolean;
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
            rakeModelled={rakeModelled}
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
  rakeModelled,
}: {
  row: NonNullable<CashResult["mixBreakdown"]>["rows"][number];
  index: number;
  moneyUnit: CashMoneyUnit;
  bbSize: number;
  rakeModelled: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const numberLocale = numberLocaleTag(locale);
  const fmt = useCashFormat();
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
            <MixTag accent="diamond">{fmt.pct(row.handShare)}</MixTag>
            <MixTag accent="spade">{fmt.usdBbSize(row.bbSize)}</MixTag>
          </div>
          <div className="flex flex-wrap gap-2">
            <MixTag accent="diamond">
              {countOrDash(
                row.hands,
                t("cash.handCount"),
                locale,
                "hand",
                numberLocale,
              )}
            </MixTag>
            <MixTag accent="club">
              {t("cash.wrBb100.label")}: {fmt.signedBb100(row.wrBb100)}
            </MixTag>
            <MixTag accent="heart">
              {t("cash.sdBb100.label")}: {fmt.unsignedBb100(row.sdBb100)}
            </MixTag>
          </div>
        </div>
        <div className="flex min-w-[10rem] flex-col gap-1 rounded-sm border border-[color:var(--color-border)]/65 bg-[color:var(--color-bg)]/55 px-3 py-2">
          <span className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fg-muted)]">
            {t("cash.mix.expectedEv")}
          </span>
          <span
            className={`font-mono text-[18px] font-semibold tabular-nums ${evTone}`}
          >
            {fmt.money(row.expectedEvBb, moneyUnit, bbSize)}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <MixMetricBar
          accent="diamond"
          label={t("cash.mix.metric.hands")}
          share={row.handShare}
          detail={`${fmt.pct(row.handShare)} · ${countOrDash(row.hands, t("cash.handCount"), locale, "hand", numberLocale)}`}
        />
        <MixMetricBar
          accent="heart"
          label={t("cash.mix.metric.swing")}
          share={row.varianceShare}
          detail={fmt.pct(row.varianceShare)}
        />
        {rakeModelled && (
          <>
            <MixMetricBar
              accent="spade"
              label={t("cash.mix.metric.rake")}
              share={row.rakeShare}
              detail={`${fmt.pct(row.rakeShare)} · ${fmt.money(
                row.rakePaidBb,
                moneyUnit,
                bbSize,
              )}`}
            />
            <MixMetricBar
              accent="club"
              label={t("cash.mix.metric.rb")}
              share={row.rbShare}
              detail={`${fmt.pct(row.rbShare)} · ${fmt.money(
                row.rbEarnedBb,
                moneyUnit,
                bbSize,
              )}`}
            />
          </>
        )}
      </div>
    </div>
  );
}
