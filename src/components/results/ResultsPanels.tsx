"use client";

import type { ReactNode } from "react";
import type {
  SimulationResult,
  TournamentRow,
} from "@/lib/sim/types";
import type { ControlsState } from "@/components/ControlsPanel";
import { Card } from "@/components/ui/Section";
import { useT } from "@/lib/i18n/LocaleProvider";

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
              tag="ФИНИШИ"
              tone="#f87171"
              title={t("weakness.pd.tag.finishes.title")}
            >
              {t("weakness.pd.tag.finishes.body")}
            </WeakBlock>

            <WeakBlock
              tag="ФОРМАТЫ"
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
              tag="ЛОВУШКА"
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
              tag="СХОДИТСЯ"
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
              tag="ТОЧНОСТЬ"
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
              tag="ГРАНИЦА"
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
      <div className="flex flex-col gap-4 text-[11px] leading-relaxed text-[color:var(--color-fg)]">
        <p className="text-[color:var(--color-fg-dim)]">{t("weakness.ours.intro")}</p>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#f59e0b]" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)]">
              {t("weakness.ours.section.ui")}
            </span>
          </div>
          <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
            <WeakBlock
              tag="BANDS"
              tone="#f59e0b"
              title={t("weakness.ours.tag.bands.title")}
            >
              {t("weakness.ours.tag.bands.body")}
            </WeakBlock>

            <WeakBlock
              tag="SCHEDULE"
              tone="#f59e0b"
              title={t("weakness.ours.tag.schedule.title")}
            >
              <div className="space-y-2">
                <p>{t("weakness.ours.tag.schedule.p1")}</p>
                <p>{t("weakness.ours.tag.schedule.p2")}</p>
              </div>
            </WeakBlock>

            <WeakBlock
              tag="PATHS"
              tone="#f59e0b"
              title={t("weakness.ours.tag.paths.title")}
            >
              <div className="space-y-2">
                <p>{t("weakness.ours.tag.paths.p1")}</p>
                <p>{t("weakness.ours.tag.paths.p2")}</p>
              </div>
            </WeakBlock>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#94a3b8]" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)]">
              {t("weakness.ours.section.model")}
            </span>
          </div>
          <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
            <WeakBlock
              tag="ROI"
              tone="#94a3b8"
              title={t("weakness.ours.tag.roi.title")}
            >
              <div className="space-y-2">
                <p>{t("weakness.ours.tag.roi.p1")}</p>
                <p>{t("weakness.ours.tag.roi.p2")}</p>
              </div>
            </WeakBlock>

            <WeakBlock
              tag="FORMATS"
              tone="#94a3b8"
              title={t("weakness.ours.tag.formats.title")}
            >
              <div className="space-y-2">
                <p>{t("weakness.ours.tag.formats.p1")}</p>
                <p>{t("weakness.ours.tag.formats.p2")}</p>
              </div>
            </WeakBlock>

            <WeakBlock
              tag="EMPIRICAL"
              tone="#94a3b8"
              title={t("weakness.ours.tag.empirical.title")}
            >
              <div className="space-y-2">
                <p>{t("weakness.ours.tag.empirical.p1")}</p>
                <p>{t("weakness.ours.tag.empirical.p2")}</p>
              </div>
            </WeakBlock>

            <WeakBlock
              tag="INPUT"
              tone="#94a3b8"
              title={t("weakness.ours.tag.input.title")}
            >
              <div className="space-y-2">
                <p>{t("weakness.ours.tag.input.p1")}</p>
                <p>{t("weakness.ours.tag.input.p2")}</p>
              </div>
            </WeakBlock>

            <WeakBlock
              tag="TAILS"
              tone="#94a3b8"
              title={t("weakness.ours.tag.tails.title")}
            >
              <div className="space-y-2">
                <p>{t("weakness.ours.tag.tails.p1")}</p>
                <p>{t("weakness.ours.tag.tails.p2")}</p>
              </div>
            </WeakBlock>
          </div>
        </div>

        <div className="text-[10px] text-[color:var(--color-fg-dim)]">
          {t("weakness.ours.summary")}
        </div>
      </div>
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
  if (!settings || !schedule || schedule.length === 0) return null;

  const r = schedule[0];
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
    ["samples", settings.samples.toLocaleString()],
    ["scheduleRepeats", settings.scheduleRepeats.toLocaleString()],
    ["totalTournaments", totalEntries.toLocaleString()],
    ["totalBuyIn", `$${result.totalBuyIn.toLocaleString()}`],
    ["bankroll", `$${settings.bankroll.toLocaleString()}`],
    ["—", "—"],
    ["players", r.players.toLocaleString()],
    ["buyIn", `$${r.buyIn}`],
    ["rake", `${(r.rake * 100).toFixed(1)}%`],
    ["bountyFraction", `${((r.bountyFraction ?? 0) * 100).toFixed(0)}%`],
    ["payoutStructure", r.payoutStructure],
    ["assumed ROI", `${(r.roi * 100).toFixed(1)}%`],
    ["—", "—"],
    ["finishModel", settings.finishModelId],
    ["α (override)", settings.alphaOverride == null ? "auto" : settings.alphaOverride.toFixed(3)],
    ["modelPreset", settings.modelPresetId],
    ["compareMode", settings.compareMode],
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
