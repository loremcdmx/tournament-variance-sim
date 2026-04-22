"use client";

import type { ReactNode } from "react";
import type {
  SimulationResult,
  TournamentRow,
} from "@/lib/sim/types";
import type { ControlsState } from "@/components/ControlsPanel";
import { Card } from "@/components/ui/Section";

export function PrimeDopeWeaknessCard() {
  return (
    <Card className="rounded-none border-0 p-4">
      <div className="flex flex-col gap-4 text-[11px] leading-relaxed text-[color:var(--color-fg)]">
        <p className="text-[color:var(--color-fg-dim)]">
          PrimeDope полезен как baseline для одного простого freezeout-спота.
          Но как турнирная модель он слишком тонкий: одна paid-zone
          вероятность, почти никакой отдельной структуры формата и почти
          нулевая модель неопределённости.
        </p>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#f87171]" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)]">
              Понятно текстом
            </span>
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            <WeakBlock
              tag="ФИНИШИ"
              tone="#f87171"
              title="Он моделирует шанс попасть в деньги, а не форму реальных финишей"
            >
              После калибровки ROI у PrimeDope остаётся бинарный paid-shell:
              попал в деньги или нет. Внутри оплачиваемой зоны все места
              получают одинаковую базовую вероятность. Реальные MTT так не
              устроены: мин-кэшей много, финалок и топ-3 мало, поэтому глубина
              просадок и время восстановления уезжают.
            </WeakBlock>

            <WeakBlock
              tag="ФОРМАТЫ"
              tone="#f87171"
              title="Re-entry, PKO и envelope-форматы он сводит к фризаутной задаче"
            >
              Multi-bullet re-entry у нас - это независимые пули с раздутым
              призовым; PKO - отдельный bounty-channel; Mystery и Battle
              Royale - отдельные envelope / jackpot tails. PrimeDope не держит
              эти каналы по отдельности, поэтому не различает, какой кусок
              swing идёт от формата, а какой от finish-PMF.
            </WeakBlock>

            <WeakBlock
              tag="ROI"
              tone="#f87171"
              title="Он считает ROI известным и почти стационарным"
            >
              У него нет field variability, per-tournament / per-session
              ROI-noise, drift/tilt-слоёв и вообще нет модели &quot;сегодня поле
              жёстче / я играю хуже / расписание смешанное&quot;. Для салфеточной
              оценки этого хватает, но для bankroll tails это уже чересчур
              оптимистично.
            </WeakBlock>

            <WeakBlock
              tag="ЛОВУШКА"
              tone="#f87171"
              title="Иногда цифра близка, но это компенсация ошибок, а не попадание в модель"
            >
              Плоская paid-PMF обычно сжимает глубину прохода и recovery tails,
              а top-heavy выплаты иногда случайно раздувают итоговую sigma
              обратно. Поэтому на простом фризауте PrimeDope может оказаться
              &quot;рядом&quot; не потому, что понял турнир, а потому что два перекоса
              временно совпали.
            </WeakBlock>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#94a3b8]" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)]">
              Занудная математика
            </span>
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            <WeakBlock
              tag="PMF"
              tone="#94a3b8"
              title="Какой shell именно мы воспроизводим в PrimeDope-режиме"
            >
              <div className="space-y-2">
                <p>
                  Наш compare-mode воспроизводит не абстрактный PrimeDope &quot;на
                  глаз&quot;, а именно его paid-vs-nonpaid shell: одна вероятность
                  попасть в деньги и одинаковая масса на каждое оплачиваемое
                  место.
                </p>
                <pre className="overflow-x-auto rounded border border-[color:var(--color-border)]/40 bg-[color:var(--color-bg-elev)] px-2 py-1 font-mono text-[10px] text-[color:var(--color-fg-dim)]">
{`pmf[i < paid]  = l / paid
pmf[i >= paid] = (1 - l) / (N - paid)
l = clamp(targetWinnings * paid / prizePool, 0, 1)`}
                </pre>
                <p>
                  Реальные top-heavy выплаты на оплачиваемых местах при этом
                  остаются как есть. Поэтому редкие большие призы у PrimeDope
                  не &quot;хорошо поняты&quot;, а просто домножены на слишком грубую PMF.
                </p>
              </div>
            </WeakBlock>

            <WeakBlock
              tag="СЛОИ"
              tone="#94a3b8"
              title="Где compare-mode ставит честную границу"
            >
              <div className="space-y-2">
                <p>
                  В движке сравнение раскладывается на три независимых куска:
                </p>
                <ul className="list-disc space-y-1 pl-4 text-[color:var(--color-fg-dim)]">
                  <li>
                    <code>usePrimedopeFinishModel</code> — их бинарный ITM против
                    нашей калиброванной PMF финишей
                  </li>
                  <li>
                    <code>usePrimedopePayouts</code> — их payout-кривые против
                    выбранной структуры выплат
                  </li>
                  <li>
                    <code>usePrimedopeRakeMath</code> — их cost/rake-конвенция
                    против нашей
                  </li>
                </ul>
                <p>
                  Всё, что лежит за пределами этого shell — re-entry bullets,
                  PKO bounty-channel, envelope / jackpot tails, field
                  variability и ROI-noise — это уже не &quot;мелкая разница
                  коэффициентов&quot;, а отдельные variance channels, которых у
                  PrimeDope просто нет.
                </p>
              </div>
            </WeakBlock>
          </div>
        </div>

        <div className="text-[10px] text-[color:var(--color-fg-dim)]">
          Нижняя строка: PrimeDope полезен как baseline для одного простого
          freezeout-спота. Как модель современного MTT-гринда с re-entry,
          bounty / envelope EV и uncertainty layers он слишком тонкий.
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
        Snapshot · settings
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
