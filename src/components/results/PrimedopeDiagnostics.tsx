"use client";

import { useState } from "react";
import type {
  SimulationResult,
  TournamentRow,
} from "@/lib/sim/types";
import { useT, useLocale } from "@/lib/i18n/LocaleProvider";
import type { DictKey } from "@/lib/i18n/dict";
import { formatMinimumBankroll, money as usdMoney, pct } from "@/lib/results/formatters";
import { numberLocaleTag } from "@/lib/i18n/numberLocale";
import { relativeDifferencePct, summarizePdStats } from "@/lib/results/primedopeDiagnostics";
import type { ControlsState } from "../ControlsPanel";
import { useMoneyFmt } from "./UnitContext";
import { Card } from "../ui/Section";
import { InfoTooltip } from "../ui/Tooltip";

export function CalibrationNotices({ result, schedule }: {
  result: SimulationResult;
  schedule?: TournamentRow[];
}) {
  const t = useT();
  const warnings = [result, result.comparison].flatMap((run) => run?.calibrationWarnings ?? []);
  if (warnings.length === 0) return null;
  return (
    <ul role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-200">
      {warnings.map((warning, index) => (
        <li key={`${warning.rowId}-${index}`}>
          {t("pd.calibrationClamped")
            .replace("{row}", schedule?.find((row) => row.id === warning.rowId)?.label || warning.rowId)
            .replace("{target}", usdMoney(warning.targetWinnings))
            .replace("{actual}", usdMoney(warning.actualWinnings))}
        </li>
      ))}
    </ul>
  );
}

export function PrimedopeReportCard({ result }: { result: SimulationResult }) {
  const t = useT();
  const { locale } = useLocale();
  const minimumBankroll = (value: number) => formatMinimumBankroll(value, "money", 1, numberLocaleTag(locale));
  const modelLabel = (r: SimulationResult) => t(r.calibrationMode === "primedope-binary-itm" ? "pd.model.primedope" : "pd.model.alpha");
  // PrimeDope-style numeric dump — mirrors the layout of their site so users
  // can put the two side by side and watch deltas as they tweak settings.
  // When the run has a comparison twin (binary-ITM), shows both columns.
  const cols: { label: string; res: SimulationResult; tone: string }[] = [
    { label: modelLabel(result), res: result, tone: "#34d399" },
  ];
  if (result.comparison) {
    cols.push({
      label: modelLabel(result.comparison),
      res: result.comparison,
      tone: "#60a5fa",
    });
  }

  const fmt$ = (v: number) =>
    `${v < 0 ? "-" : ""}$${Math.abs(Math.round(v)).toLocaleString()}`;
  const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;

  const buildRows = (r: SimulationResult) => {
    const N = r.tournamentsPerSample;
    const cost = r.totalBuyIn;
    const meanSim = r.stats.mean;
    const sdSim = r.stats.stdDev;
    const evMath = r.expectedProfit;
    const ci = (k: number) => ({
      lo: meanSim - k * sdSim,
      hi: meanSim + k * sdSim,
    });
    const ci70 = ci(1.036);
    const ci95 = ci(1.96);
    const ci997 = ci(3);
    const probLoss = 1 - r.stats.probProfit;
    return {
      N,
      cost,
      evMath,
      meanSim,
      sdSim,
      roiMath: cost > 0 ? evMath / cost : 0,
      roiSim: cost > 0 ? meanSim / cost : 0,
      ci70,
      ci95,
      ci997,
      ror50: r.stats.minBankrollRoR50pct,
      ror15: r.stats.minBankrollRoR15pct,
      ror5: r.stats.minBankrollRoR5pct,
      ror1: r.stats.minBankrollRoR1pct,
      ror5Gauss: r.stats.minBankrollRoR5pctGaussian,
      ror1Gauss: r.stats.minBankrollRoR1pctGaussian,
      probLoss,
      neverBelow: r.stats.neverBelowZeroFrac,
    };
  };

  const rows = cols.map((c) => ({ ...c, data: buildRows(c.res) }));

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
        {title}
      </div>
      <div className="grid grid-cols-1 gap-1 font-mono text-[11px]">{children}</div>
    </div>
  );
  const Line = ({ k, v }: { k: string; v: string }) => (
    <div className="flex justify-between gap-3">
      <span className="text-[color:var(--color-fg-dim)]">{k}</span>
      <span className="tabular-nums text-[color:var(--color-fg)]">{v}</span>
    </div>
  );

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
          {t("section.primedopeReport")}
        </div>
        <div className="text-[10px] text-[color:var(--color-fg-dim)]">
          {t("pd.report.subtitle")}
        </div>
      </div>
      <div className={`grid gap-5 ${rows.length === 2 ? "lg:grid-cols-2" : "grid-cols-1"}`}>
        {rows.map((col) => (
          <div key={col.label} className="flex flex-col gap-3 rounded-lg border border-[color:var(--color-border)]/50 bg-[color:var(--color-bg-elev-2)]/30 p-3">
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: col.tone }}
              />
              <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--color-fg)]">
                {col.label}
              </span>
            </div>
            <Section title={t("pd.report.returns")}>
              <Line k={t("pd.report.tournaments")} v={col.data.N.toLocaleString()} />
              <Line k={t("pd.report.samples")} v={col.res.samples.toLocaleString()} />
              <Line k={t("pd.report.buyIns")} v={fmt$(col.data.cost)} />
              <Line k={t("pd.report.expectedProfit")} v={fmt$(col.data.evMath)} />
              <Line k={t("pd.report.mean")} v={fmt$(col.data.meanSim)} />
              <Line k={t("pd.report.expectedRoi")} v={fmtPct(col.data.roiMath)} />
              <Line k={t("pd.report.realizedRoi")} v={fmtPct(col.data.roiSim)} />
              <Line k={t("pd.report.stdDev")} v={fmt$(col.data.sdSim)} />
            </Section>
            <Section title={t("pd.report.intervals")}>
              <Line
                k="70%"
                v={`${fmt$(col.data.ci70.lo)} – ${fmt$(col.data.ci70.hi)}`}
              />
              <Line
                k="95%"
                v={`${fmt$(col.data.ci95.lo)} – ${fmt$(col.data.ci95.hi)}`}
              />
              <Line
                k="99.7%"
                v={`${fmt$(col.data.ci997.lo)} – ${fmt$(col.data.ci997.hi)}`}
              />
            </Section>
            <Section title={t("pd.report.bankroll")}>
              <Line k={t("pd.report.ror50")} v={minimumBankroll(col.data.ror50)} />
              <Line k={t("pd.report.ror15")} v={minimumBankroll(col.data.ror15)} />
              <Line k={t("pd.report.ror5")} v={minimumBankroll(col.data.ror5)} />
              <Line k={t("pd.report.ror1")} v={minimumBankroll(col.data.ror1)} />
              <Line k={t("pd.report.ror5Gaussian")} v={minimumBankroll(col.data.ror5Gauss)} />
              <Line k={t("pd.report.ror1Gaussian")} v={minimumBankroll(col.data.ror1Gauss)} />
              <Line
                k={t("pd.report.neverBelow")}
                v={`${Math.round(col.data.neverBelow * col.res.samples)} / ${col.res.samples.toLocaleString()}`}
              />
              <Line
                k={t("pd.report.probLoss").replace("{n}", col.data.N.toLocaleString())}
                v={fmtPct(col.data.probLoss)}
              />
            </Section>
          </div>
        ))}
      </div>
    </Card>
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
      : r.payoutStructure === "battle-royale"
      ? (3 / 18) * 100
      : r.payoutStructure === "mtt-top-heavy"
      ? 12
      : r.payoutStructure === "mtt-gg"
      ? 18
      : r.payoutStructure === "mtt-gg-bounty"
      ? 11.5
      : r.payoutStructure === "mtt-gg-mystery"
      ? 13
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

export function PdCompareToggles({
  usePdPayouts,
  onUsePdPayoutsChange,
  usePdFinishModel,
  onUsePdFinishModelChange,
  usePdRakeMath,
  onUsePdRakeMathChange,
  pdOverrideStatus,
  pdOverrideProgress,
}: {
  usePdPayouts: boolean;
  onUsePdPayoutsChange?: (v: boolean) => void;
  usePdFinishModel: boolean;
  onUsePdFinishModelChange?: (v: boolean) => void;
  usePdRakeMath: boolean;
  onUsePdRakeMathChange?: (v: boolean) => void;
  pdOverrideStatus?: "idle" | "running" | "done" | "error";
  pdOverrideProgress?: number;
}) {
  const t = useT();
  const row = (
    checked: boolean,
    onChange: ((v: boolean) => void) | undefined,
    labelKey: DictKey,
    hintKey: DictKey,
  ) =>
    onChange ? (
      <div className="flex items-center gap-1">
        <label className="flex cursor-pointer items-center gap-1 text-[10px] text-[color:var(--color-fg-muted)]">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            className="h-3 w-3 accent-[color:var(--color-accent)]"
          />
          <span>{t(labelKey)}</span>
        </label>
        <InfoTooltip content={t(hintKey)} />
      </div>
    ) : null;
  return (
    <div className="flex items-center gap-2">
      {row(
        usePdPayouts,
        onUsePdPayoutsChange,
        "chart.trajectory.pdPayouts",
        "chart.trajectory.pdPayouts.hint",
      )}
      {row(
        usePdFinishModel,
        onUsePdFinishModelChange,
        "chart.trajectory.pdFinishModel",
        "chart.trajectory.pdFinishModel.hint",
      )}
      {row(
        usePdRakeMath,
        onUsePdRakeMathChange,
        "chart.trajectory.pdRakeMath",
        "chart.trajectory.pdRakeMath.hint",
      )}
      {pdOverrideStatus === "running" && (
        <div className="h-1 w-16 overflow-hidden rounded-sm bg-[color:var(--color-bg-elev-2)]">
          <div
            className="h-full bg-[color:var(--color-accent)] transition-[width] duration-100"
            style={{
              width: `${Math.max(2, Math.min(100, (pdOverrideProgress ?? 0) * 100))}%`,
            }}
          />
        </div>
      )}
    </div>
  );
}

export function PrimedopeReproduceButton({
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
      className="inline-flex items-center gap-1 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-[color:var(--color-fg-dim)] hover:border-[color:var(--color-border-strong)] hover:text-[color:var(--color-fg)]"
    >
      <svg width="8" height="8" viewBox="0 0 24 24" fill="none">
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

export function CopyPdDiagButton({
  settings,
  schedule,
  scheduleRepeats,
  bankroll,
  result,
  pdChart,
  pdOverrideStatus,
  usePdPayouts,
  usePdFinishModel,
  usePdRakeMath,
}: {
  settings?: ControlsState;
  schedule: TournamentRow[];
  scheduleRepeats: number;
  bankroll: number;
  result: SimulationResult;
  pdChart: SimulationResult | null | undefined;
  pdOverrideStatus: "idle" | "running" | "done" | "error";
  usePdPayouts: boolean;
  usePdFinishModel: boolean;
  usePdRakeMath: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const handleClick = async () => {
    const statSummary = summarizePdStats;
    const dump = {
      timestamp: new Date().toISOString(),
      scheduleRepeats,
      bankroll,
      schedule: schedule.map((r) => ({
        players: r.players,
        buyIn: r.buyIn,
        rake: r.rake,
        roi: r.roi,
        payoutStructure: r.payoutStructure,
        count: r.count,
        bountyFraction: r.bountyFraction,
      })),
      pdFlagsFromProps: {
        usePdPayouts,
        usePdFinishModel,
        usePdRakeMath,
      },
      settingsPdFlags: settings
        ? {
            usePrimedopePayouts: settings.usePrimedopePayouts,
            usePrimedopeFinishModel: settings.usePrimedopeFinishModel,
            usePrimedopeRakeMath: settings.usePrimedopeRakeMath,
            compareEnabled: settings.compareEnabled,
            compareMode: settings.compareMode,
            modelPresetId: settings.modelPresetId,
            samples: settings.samples,
            seed: settings.seed,
          }
        : null,
      pdOverrideStatus,
      primary: statSummary(result),
      pdPane: statSummary(pdChart ?? null),
      comparisonPresent: !!result.comparison,
      pdOverrideVsComparison:
        pdChart && result.comparison
          ? pdChart === result.comparison
            ? "same-as-result.comparison"
            : "pdOverrideResult-different-from-result.comparison"
          : null,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(dump, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* noop */
    }
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      title="Copy PD diagnostic logs to clipboard"
      className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-[color:var(--color-fg-muted)] hover:border-[color:var(--color-border-strong)] hover:text-[color:var(--color-fg)]"
    >
      {copied ? "copied ✓" : "copy PD logs"}
    </button>
  );
}

export function PrimedopeDiff({
  primary,
  other,
  theirsLabel,
  title,
  subtitle,
  hasBounty,
  bankroll = 0,
}: {
  primary: SimulationResult;
  other: SimulationResult;
  theirsLabel?: string;
  title?: string;
  subtitle?: string;
  hasBounty?: boolean;
  bankroll?: number;
}) {
  const t = useT();
  const { money } = useMoneyFmt();
  const ours = primary.stats;
  const theirs = other.stats;
  const primaryLabel = t(primary.calibrationMode === "primedope-binary-itm" ? "pd.model.primedope" : "pd.model.alpha");
  const secondaryLabel = theirsLabel ?? t(other.calibrationMode === "primedope-binary-itm" ? "pd.model.primedope" : "pd.model.alpha");
  const pctPp = (a: number, b: number) =>
    t("pd.delta.pp").replace("{value}", ((a - b) * 100).toFixed(2));
  const ratioPct = (a: number, b: number) => {
    const value = relativeDifferencePct(a, b);
    return value == null ? "—" : `${value.toFixed(1)} %`;
  };
  const diffMoney = (a: number, b: number) =>
    `${a - b >= 0 ? "+" : "−"}${money(Math.abs(a - b))}`;
  const rows: {
    label: string;
    ours: string;
    theirs: string;
    delta: string;
    highlight?: boolean;
  }[] = [
    {
      label: t("pd.row.ev"),
      ours: money(primary.expectedProfit),
      theirs: money(other.expectedProfit),
      delta: diffMoney(primary.expectedProfit, other.expectedProfit),
      highlight: true,
    },
    {
      label: hasBounty ? t("pd.row.itm.cash") : t("pd.row.itm"),
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
      ours: t("pd.delta.tournaments").replace("{value}", String(Math.round(ours.longestBreakevenMean))),
      theirs: t("pd.delta.tournaments").replace("{value}", String(Math.round(theirs.longestBreakevenMean))),
      delta: t("pd.delta.tournaments").replace("{value}", String(Math.round(ours.longestBreakevenMean - theirs.longestBreakevenMean))),
    },
    {
      label: t("pd.row.var95"),
      ours: money(ours.p05),
      theirs: money(theirs.p05),
      delta: diffMoney(ours.p05, theirs.p05),
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
      ours: bankroll > 0 ? pct(ours.riskOfRuin) : "—",
      theirs: bankroll > 0 ? pct(theirs.riskOfRuin) : "—",
      delta: bankroll > 0 ? pctPp(ours.riskOfRuin, theirs.riskOfRuin) : t("stat.bankrollOff"),
    },
  ];
  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-[color:var(--color-fg)]">
            {title ?? t("pd.title")}
          </div>
          <div className="text-xs text-[color:var(--color-fg-dim)]">
            {subtitle ?? t("pd.subtitle")}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider">
          <span className="flex items-center gap-1 text-[color:var(--color-fg-muted)]">
            <span className="inline-block h-1.5 w-3 rounded-sm bg-[#34d399]" />{" "}
            {primaryLabel}
          </span>
          <span className="flex items-center gap-1 text-[color:var(--color-fg-muted)]">
            <span className="inline-block h-1.5 w-3 rounded-sm bg-[#60a5fa]" />{" "}
            {secondaryLabel}
          </span>
        </div>
      </div>
      <div className="mb-3 rounded border border-[color:var(--color-accent)]/30 bg-[color:var(--color-accent)]/6 px-3 py-2 text-[11px] leading-relaxed">
        <div className="font-semibold text-[color:var(--color-accent)]">
          {t("pd.evDelta.title")}
        </div>
        <div className="mt-0.5 text-[color:var(--color-fg-muted)]">
          {t("pd.evDelta.body")}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-[color:var(--color-border)] text-[10px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
              <th className="py-2 text-left font-medium">{t("pd.metric")}</th>
              <th className="py-2 text-right font-medium">{primaryLabel}</th>
              <th className="py-2 text-right font-medium">{secondaryLabel}</th>
              <th className="py-2 text-right font-medium">{t("pd.delta")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.label}
                className={
                  r.highlight
                    ? "border-b border-[color:var(--color-border)] bg-[color:var(--color-accent)]/8"
                    : "border-b border-[color:var(--color-border)]/60 last:border-b-0"
                }
              >
                <td
                  className={
                    r.highlight
                      ? "py-2.5 font-semibold text-[color:var(--color-fg)]"
                      : "py-2 text-[color:var(--color-fg-muted)]"
                  }
                >
                  {r.label}
                </td>
                <td className="py-2 text-right font-semibold tabular-nums text-[color:var(--color-fg)]">
                  {r.ours}
                </td>
                <td className="py-2 text-right tabular-nums text-[#60a5fa]">
                  {r.theirs}
                </td>
                <td
                  className={
                    r.highlight
                      ? "py-2 text-right font-semibold tabular-nums text-[color:var(--color-accent)]"
                      : "py-2 text-right tabular-nums text-[color:var(--color-fg-muted)]"
                  }
                >
                  {r.delta}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasBounty && (
        <div className="mt-3 rounded border border-[color:var(--color-border)]/60 bg-[color:var(--color-bg-elev)]/40 px-3 py-2 text-[11px] leading-relaxed text-[color:var(--color-fg-muted)]">
          {t("pd.row.itm.cashNote")}
        </div>
      )}
    </Card>
  );
}
