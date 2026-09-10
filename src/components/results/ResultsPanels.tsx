"use client";

import type { ReactNode } from "react";
import type {
  SimulationResult,
  TournamentRow,
} from "@/lib/sim/types";
import type { ControlsState } from "@/components/ControlsPanel";
import { Card } from "@/components/ui/Section";
import { InfoTooltip } from "@/components/ui/Tooltip";
import { money } from "@/lib/results/formatters";
import { useLocale, useT } from "@/lib/i18n/LocaleProvider";
import { numberLocaleTag } from "@/lib/i18n/numberLocale";

export function PrimeDopeWeaknessCard() {
  const t = useT();
  return (
    <Card className="rounded-none border-0 p-4">
      <div className="flex flex-col gap-4 text-[11px] leading-relaxed text-[color:var(--color-fg)]">
        <p className="text-[color:var(--color-fg-dim)]">{t("weakness.pd.intro")}</p>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#f87171]" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)]">
              {t("weakness.pd.section.text")}
            </span>
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            <WeakBlock
              tag={t("weakness.tag.finishes")}
              tone="#f87171"
              title={t("weakness.pd.tag.finishes.title")}
            >
              {t("weakness.pd.tag.finishes.body")}
            </WeakBlock>

            <WeakBlock
              tag={t("weakness.tag.formats")}
              tone="#f87171"
              title={t("weakness.pd.tag.formats.title")}
            >
              {t("weakness.pd.tag.formats.body")}
            </WeakBlock>

            <WeakBlock
              tag="ROI"
              tone="#f87171"
              title={t("weakness.pd.tag.roi.title")}
            >
              {t("weakness.pd.tag.roi.body")}
            </WeakBlock>

            <WeakBlock
              tag={t("weakness.tag.trap")}
              tone="#f87171"
              title={t("weakness.pd.tag.trap.title")}
            >
              {t("weakness.pd.tag.trap.body")}
            </WeakBlock>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#94a3b8]" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)]">
              {t("weakness.pd.section.math")}
            </span>
          </div>
          <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
            <WeakBlock
              tag={t("weakness.tag.converge")}
              tone="#86efac"
              title={t("weakness.pd.tag.converge.title")}
            >
              <div className="space-y-2">
                <p>{t("weakness.pd.tag.converge.intro")}</p>
                <ul className="list-disc space-y-1 pl-4 text-[color:var(--color-fg-dim)]">
                  <li>
                    <code>usePrimedopeFinishModel</code> —{" "}
                    {t("weakness.pd.tag.converge.bullet.finish")}
                  </li>
                  <li>
                    <code>usePrimedopePayouts</code> —{" "}
                    {t("weakness.pd.tag.converge.bullet.payouts")}
                  </li>
                  <li>
                    <code>usePrimedopeRakeMath</code> —{" "}
                    {t("weakness.pd.tag.converge.bullet.rake")}
                  </li>
                </ul>
                <p>{t("weakness.pd.tag.converge.body")}</p>
                <p>{t("weakness.pd.tag.converge.reading")}</p>
              </div>
            </WeakBlock>

            <WeakBlock
              tag={t("weakness.tag.precision")}
              tone="#93c5fd"
              title={t("weakness.pd.tag.precision.title")}
            >
              <div className="space-y-2">
                <p>{t("weakness.pd.tag.precision.intro")}</p>
                <ul className="list-disc space-y-1 pl-4 text-[color:var(--color-fg-dim)]">
                  <li>{t("weakness.pd.tag.precision.bullet.shell")}</li>
                  <li>{t("weakness.pd.tag.precision.bullet.curves")}</li>
                  <li>{t("weakness.pd.tag.precision.bullet.byteForByte")}</li>
                  <li>{t("weakness.pd.tag.precision.bullet.sigma")}</li>
                </ul>
                <p>{t("weakness.pd.tag.precision.body")}</p>
              </div>
            </WeakBlock>

            <WeakBlock
              tag={t("weakness.tag.boundary")}
              tone="#94a3b8"
              title={t("weakness.pd.tag.boundary.title")}
            >
              <div className="space-y-2">
                <p>{t("weakness.pd.tag.boundary.intro")}</p>
                <ul className="list-disc space-y-1 pl-4 text-[color:var(--color-fg-dim)]">
                  <li>{t("weakness.pd.tag.boundary.bullet.freeze")}</li>
                  <li>{t("weakness.pd.tag.boundary.bullet.pko")}</li>
                  <li>{t("weakness.pd.tag.boundary.bullet.mystery")}</li>
                  <li>{t("weakness.pd.tag.boundary.bullet.schedule")}</li>
                </ul>
                <p>{t("weakness.pd.tag.boundary.body")}</p>
              </div>
            </WeakBlock>
          </div>
        </div>

        <div className="text-[10px] text-[color:var(--color-fg-dim)]">
          {t("weakness.pd.summary")}
        </div>
      </div>
    </Card>
  );
}

export function OurModelWeaknessCard() {
  const t = useT();
  return (
    <Card className="rounded-none border-0 p-4">
      <ul className="space-y-3 text-xs leading-relaxed text-[color:var(--color-fg)]">
        {(["pko", "mystery"] as const).map((format) => (
          <li key={format}>
            <p className="font-semibold">{t(`weakness.ours.${format}.title`)}</p>
            <p className="mt-1 text-[color:var(--color-fg-muted)]">
              {t(`weakness.ours.${format}.body`)}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function WeakBlock({
  tag,
  tone,
  title,
  children,
}: {
  tag: string;
  tone: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-[color:var(--color-border)]/50 bg-[color:var(--color-bg-elev-2)]/30 p-3">
      <div className="flex items-center gap-2">
        <span
          className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-black"
          style={{ background: tone }}
        >
          {tag}
        </span>
        <span className="text-[11px] font-semibold text-[color:var(--color-fg)]">
          {title}
        </span>
      </div>
      <div className="text-[color:var(--color-fg-dim)]">{children}</div>
    </div>
  );
}

/**
 * Distribution-shape and Kelly diagnostics. Every figure here is stated over
 * one full simulated distance (schedule × repeats), not per tournament — the
 * unit caption under each label is the whole point of the card.
 */
export function AdvancedStatsCard({
  result,
  bankroll,
}: {
  result: SimulationResult;
  bankroll: number;
}) {
  const t = useT();
  const s = result.stats;
  const notPlus = t("advStats.na.negEv");
  const kellyDefined = s.kellyFraction > 0 && Number.isFinite(s.kellyBankroll);
  const stats: Array<{
    label: string;
    unit: string;
    value: string;
    tip: string;
  }> = [
    {
      label: t("stat.sharpe"),
      unit: t("advStats.unit.perDistance"),
      value: s.sharpe.toFixed(3),
      tip: t("stat.sharpe.tip"),
    },
    {
      label: t("stat.sortino"),
      unit: t("advStats.unit.perDistance"),
      value: s.sortino.toFixed(3),
      tip: t("stat.sortino.tip"),
    },
    {
      label: t("stat.skew"),
      unit: t("advStats.unit.g1"),
      value: s.skewness.toFixed(3),
      tip: t("stat.skew.tip"),
    },
    {
      label: t("stat.kurt"),
      unit: t("advStats.unit.excess"),
      value: s.kurtosis.toFixed(3),
      tip: t("stat.kurt.tip"),
    },
    {
      label: t("stat.kelly"),
      unit: t("advStats.unit.kellyShare"),
      value: kellyDefined ? s.kellyFraction.toFixed(4) : notPlus,
      tip: t("stat.kelly.tip"),
    },
    {
      label: t("stat.kellyBR"),
      unit: t("advStats.unit.kellyBr"),
      value: kellyDefined ? money(s.kellyBankroll) : notPlus,
      tip: t("stat.kellyBR.tip"),
    },
    {
      label: t("stat.logG"),
      unit: t("advStats.unit.logPerDistance"),
      value: bankroll > 0 ? s.logGrowthRate.toFixed(4) : t("stat.bankrollOff"),
      tip: t("stat.logG.tip"),
    },
  ];

  return (
    <Card className="p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
        {t("advStats.title")}
      </div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-2 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="group flex items-baseline justify-between gap-3"
          >
            <span className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1 text-[color:var(--color-fg-dim)]">
                {stat.label}
                <InfoTooltip content={stat.tip} />
              </span>
              <span className="text-[10px] text-[color:var(--color-fg-muted)]">
                {stat.unit}
              </span>
            </span>
            <span className="shrink-0 font-mono tabular-nums text-[color:var(--color-fg)]">
              {stat.value}
            </span>
          </div>
        ))}
      </div>

      {result.decomposition.length > 1 && (
        <>
          <div className="group mt-4 mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
            {t("advStats.rowKelly")}
            <InfoTooltip content={t("advStats.rowKelly.tip")} />
          </div>
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 font-mono text-[11px] sm:grid-cols-2 lg:grid-cols-3">
            {result.decomposition.map((row) => {
              const live =
                row.kellyFraction > 0 && Number.isFinite(row.kellyBankroll);
              return (
                <div key={row.rowId} className="flex justify-between gap-3">
                  <span className="truncate text-[color:var(--color-fg-dim)]">
                    {row.label}
                  </span>
                  <span className="shrink-0 tabular-nums text-[color:var(--color-fg)]">
                    {live
                      ? `${row.kellyFraction.toFixed(4)} · ${money(row.kellyBankroll)}`
                      : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}

export function SettingsDumpCard({
  settings,
  schedule,
  result,
  elapsedMs,
}: {
  settings?: ControlsState;
  schedule?: TournamentRow[];
  result: SimulationResult;
  elapsedMs?: number | null;
}) {
  const t = useT();
  const { locale } = useLocale();
  const numberLocale = numberLocaleTag(locale);
  if (!settings || !schedule || schedule.length === 0) return null;

  const r = schedule[0];
  // Realized mean ROI from the actual run. When the advanced α-override is
  // pinned, calibration is skipped so the engine ignores each row's ROI
  // target — the "assumed ROI" label can then silently contradict what the
  // run produced. Surface the realized figure (and flag the divergence).
  const realizedRoi =
    result.totalBuyIn > 0 ? result.stats.mean / result.totalBuyIn : 0;
  const alphaPinned = settings.alphaOverride != null;
  const roiDiverges = Math.abs(realizedRoi - r.roi) > 0.005;
  const totalEntries =
    schedule.reduce((acc, row) => acc + row.count, 0) * settings.scheduleRepeats;
  const elapsedStr =
    elapsedMs == null
      ? "—"
      : elapsedMs < 1000
        ? `${elapsedMs.toFixed(0)} ms`
        : elapsedMs < 60_000
          ? `${(elapsedMs / 1000).toFixed(2)} s`
          : `${Math.floor(elapsedMs / 60_000)}m ${((elapsedMs % 60_000) / 1000).toFixed(1)}s`;
  const rows: Array<[string, string]> = [
    ["compute time", elapsedStr],
    ["samples", settings.samples.toLocaleString(numberLocale)],
    ["scheduleRepeats", settings.scheduleRepeats.toLocaleString(numberLocale)],
    ["totalTournaments", totalEntries.toLocaleString(numberLocale)],
    ["totalBuyIn", `$${result.totalBuyIn.toLocaleString(numberLocale)}`],
    ["bankroll", `$${settings.bankroll.toLocaleString(numberLocale)}`],
    ["—", "—"],
    ["players", r.players.toLocaleString(numberLocale)],
    ["buyIn", `$${r.buyIn}`],
    ["rake", `${(r.rake * 100).toFixed(1)}%`],
    ["bountyFraction", `${((r.bountyFraction ?? 0) * 100).toFixed(0)}%`],
    ["payoutStructure", r.payoutStructure],
    ["assumed ROI", `${(r.roi * 100).toFixed(1)}%`],
    [
      "realized ROI",
      `${(realizedRoi * 100).toFixed(1)}%${
        alphaPinned && roiDiverges ? "  ⚠ α-pinned, target ignored" : ""
      }`,
    ],
    ["—", "—"],
    ["finishModel", settings.finishModelId],
    ["α (override)", settings.alphaOverride == null ? "auto" : settings.alphaOverride.toFixed(3)],
    ["modelPreset", settings.modelPresetId],
    ["compareEnabled", settings.compareEnabled ? "true" : "false"],
    ["compareMode", settings.compareEnabled ? settings.compareMode : "off"],
    ["—", "—"],
    ["roiStdErr", `${(settings.roiStdErr * 100).toFixed(2)}%`],
  ];

  return (
    <Card className="p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
        {t("settingsDump.title")}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[11px] sm:grid-cols-3 lg:grid-cols-4">
        {rows.map(([k, v], i) => (
          <div key={`${k}-${i}`} className="flex justify-between gap-3">
            <span className="text-[color:var(--color-fg-dim)]">{k}</span>
            <span className="text-[color:var(--color-fg)]">{v}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
