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
          <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
            <WeakBlock
              tag="СХОДИТСЯ"
              tone="#86efac"
              title="Когда наша модель действительно приближается к PrimeDope"
            >
              <div className="space-y-2">
                <p>
                  Compare-mode у нас не &quot;рисует похожую картинку&quot;, а умеет
                  по отдельности подогнать три слоя PrimeDope:
                </p>
                <ul className="list-disc space-y-1 pl-4 text-[color:var(--color-fg-dim)]">
                  <li>
                    <code>usePrimedopeFinishModel</code> — их paid-vs-nonpaid
                    shell вместо нашей PMF финишей
                  </li>
                  <li>
                    <code>usePrimedopePayouts</code> — их структура выплат
                  </li>
                  <li>
                    <code>usePrimedopeRakeMath</code> — их rake-to-SD quirk без
                    смены ROI-базы UI
                  </li>
                </ul>
                <p>
                  Поэтому на одном простом freezeout-споте модели реально могут
                  сблизиться. Пример: один обычный MTT без re-entry и bounty,
                  с ровным полем и стандартными выплатами. Если привести
                  finish-shell, payouts и rake-конвенцию к режиму PD, то EV,
                  шанс выйти в плюс и центральная часть траекторий обычно уже
                  стоят довольно близко.
                </p>
                <p>
                  Полезное чтение этого режима такое: он показывает не только
                  где мы расходимся с PD, но и как быстро разница исчезает,
                  если шаг за шагом убрать современные MTT-слои и оставить
                  &quot;салфеточный freezeout&quot;.
                </p>
              </div>
            </WeakBlock>

            <WeakBlock
              tag="ТОЧНОСТЬ"
              tone="#93c5fd"
              title="Насколько точно мы воспроизводим сам сайт PrimeDope"
            >
              <div className="space-y-2">
                <p>
                  В compare-mode мы воспроизводим не абстрактный
                  &quot;PrimeDope-стиль&quot;, а именно те слои, которые у них реально
                  живут на сайте: binary paid-shell, их live payout-curves и
                  их rake-to-SD механику. ROI в UI остаётся на нашей полной
                  базе buy-in+rake, чтобы сравнение показывало модельную
                  разницу, а не другой edge.
                </p>
                <ul className="list-disc space-y-1 pl-4 text-[color:var(--color-fg-dim)]">
                  <li>
                    Finish-shell у нас повторяет их двухзонную логику
                    <code> paid / non-paid </code> по проверенному legacy-source.
                  </li>
                  <li>
                    Выплаты берутся из live curves, снятых с их
                    <code> payout_info </code>
                    endpoint, а не из &quot;похожей&quot; домашней таблицы.
                  </li>
                  <li>
                    Для 100 игроков и 15 paid наша
                    <code> mtt-primedope </code>
                    кривая выплат совпадает с их текущей live-кривой
                    byte-for-byte.
                  </li>
                  <li>
                    На референсе 100p / $50 / 10% ROI наша
                    <code> σ₁₀₀₀ </code>
                    под PrimeDope-shell попадает в тот же коридор, который
                    показывает их сайт: math около $5607 и sim около $5789.
                  </li>
                </ul>
                <p>
                  То есть для простого freezeout-спота наш PD-режим довольно
                  близок к тому, что пользователь увидит на PrimeDope. Но эта
                  точность честно заканчивается там, где сам сайт перестаёт
                  быть моделью задачи: PKO, Mystery, Battle Royale,
                  multi-bullet re-entry и schedule-level uncertainty уже
                  требуют отдельных слоёв, которых у PD нет.
                </p>
              </div>
            </WeakBlock>

            <WeakBlock
              tag="ГРАНИЦА"
              tone="#94a3b8"
              title="Где сходство заканчивается и почему"
            >
              <div className="space-y-2">
                <p>
                  Как только в задаче появляется отдельный variance-channel,
                  сходство с PrimeDope перестаёт быть &quot;вопросом коэффициентов&quot;.
                  Это уже разница в самой модели.
                </p>
                <ul className="list-disc space-y-1 pl-4 text-[color:var(--color-fg-dim)]">
                  <li>
                    На простом freezeout различие чаще всего уходит в tails:
                    PrimeDope может быть близок по среднему, но всё ещё
                    недооценивать глубину просадок и время восстановления.
                  </li>
                  <li>
                    В PKO различие уже не только в finish-PMF: у нас есть
                    отдельный bounty-channel, которого у PrimeDope нет.
                  </li>
                  <li>
                    В Mystery и Battle Royale добавляются envelope / jackpot
                    tails, которые нельзя честно свернуть в один paid-shell.
                  </li>
                  <li>
                    В schedule / mixed-grind режиме у нас ещё поверх этого
                    живут field variability и ROI-noise, а у PrimeDope такого
                    слоя вообще нет.
                  </li>
                </ul>
                <p>
                  Пример границы: если взять тот же базовый freezeout, модели
                  могут быть близки по top-line. Но стоит добавить re-entry,
                  PKO bounty EV или Mystery-хвост, и разница уже идёт не из
                  тонкой подстройки PMF, а из того, что PrimeDope просто не
                  держит эти каналы внутри модели.
                </p>
              </div>
            </WeakBlock>
          </div>
        </div>

        <div className="text-[10px] text-[color:var(--color-fg-dim)]">
          Коротко: PrimeDope полезен как baseline там, где турнир уже почти
          сведён к одному простому freezeout-shell. Чем больше в задаче
          format-specific EV и uncertainty layers, тем быстрее наша модель
          перестаёт &quot;просто отличаться&quot; и начинает описывать другой класс
          риска.
        </div>
      </div>
    </Card>
  );
}

export function OurModelWeaknessCard() {
  return (
    <Card className="rounded-none border-0 p-4">
      <div className="flex flex-col gap-4 text-[11px] leading-relaxed text-[color:var(--color-fg)]">
        <p className="text-[color:var(--color-fg-dim)]">
          Наша модель шире PrimeDope и честнее в современных форматах, но это
          всё ещё модель, а не оракул. Она хорошо раскладывает турнир на
          finish-shape, payouts, rake, bounty-каналы и uncertainty-слои, но
          часть этих слоёв остаётся параметрической, а часть специально
          ограничена policy, чтобы не притворяться точнее, чем она есть.
        </p>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#f59e0b]" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)]">
              Где граница уже встроена в UI
            </span>
          </div>
          <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
            <WeakBlock
              tag="BANDS"
              tone="#f59e0b"
              title="Числовые диапазоны показываются не везде — и это осознанное ограничение"
            >
              У convergence-виджета numeric ±band разрешён только внутри
              провалидированных fit-boxов. За пределами этого box-а остаётся
              точка, а полоса
              скрывается. Это честная защита от экстраполяции, но побочный
              эффект такой: пользователь не всегда получает полноценный диапазон
              именно там, где вопрос ему интереснее всего — на краях ROI / AFS.
            </WeakBlock>

            <WeakBlock
              tag="SCHEDULE"
              tone="#f59e0b"
              title="Schedule-band есть, но он жёстко привязан к format-level fit-box"
            >
              <div className="space-y-2">
                <p>
                  Для schedule-mode мы теперь показываем числовой residual-band,
                  но только когда каждая строка расписания сидит внутри своего
                  format fit-box. Стоит хотя бы одной строке выйти за box —
                  чужой AFS, экстремальный ROI — и полоса для всего расписания
                  скрывается, режим возвращается к point-only. Это тот же gate,
                  что и в single-format, и он намеренно строгий.
                </p>
                <p>
                  Сама полоса — variance-share-weighted среднее format-level
                  residual коэффициентов, а не отдельно подогнанный под ваше
                  конкретное расписание остаток. Это честно отражает
                  неопределённость σ-фитов, но не учитывает, насколько ваш
                  конкретный mix мог бы отклоняться от этих фитов в ансамбле.
                </p>
              </div>
            </WeakBlock>

            <WeakBlock
              tag="PATHS"
              tone="#f59e0b"
              title="EV BR leaderboard уже в trajectory, но drawdown и risk-of-ruin — пока нет"
            >
              <div className="space-y-2">
                <p>
                  BR leaderboard cashflow теперь честно проложен через
                  trajectory и скалярную статистику — mean, median, probProfit,
                  VaR, CVaR, гистограмма. Игроку больше не нужно складывать в
                  голове &quot;+$200 LB-промо&quot; из BR-виджета и
                  &quot;+$300 EV&quot; с траектории.
                </p>
                <p>
                  Но drawdown, серии минусов и risk-of-ruin остаются game-only.
                  Причина прозрачная: LB EV в модели — детерминированная
                  monotone-non-decreasing надбавка к выплатам (она не уходит в
                  минус), drawdowns под такой надбавкой инвариантны, а RoR
                  потребовал бы пересчёта по полному N-sample raw, которого мы
                  после stat-pass не держим.
                </p>
              </div>
            </WeakBlock>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#94a3b8]" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)]">
              Что всё ещё упрощено в самой модели
            </span>
          </div>
          <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
            <WeakBlock
              tag="ROI"
              tone="#94a3b8"
              title="Uncertainty-слои — это хорошие ручки, но не learned truth"
            >
              <div className="space-y-2">
                <p>
                  ROI std err, per-tournament shock, per-session shock, drift и
                  tilt у нас уже есть, но они задаются как параметры модели, а
                  не автоматически извлекаются из вашей истории.
                </p>
                <p>
                  Поэтому они отлично отвечают на вопрос &quot;что будет, если моя
                  реальность шумнее/жёстче, чем кажется&quot;, но пока не отвечают на
                  вопрос &quot;какой именно шум у меня реально был в прошлом году&quot;
                  без отдельной подгонки по данным.
                </p>
              </div>
            </WeakBlock>

            <WeakBlock
              tag="FORMATS"
              tone="#94a3b8"
              title="Format-specific каналы смоделированы, но не исчерпывают реальный рум целиком"
            >
              <div className="space-y-2">
                <p>
                  PKO, Mystery и Battle Royale у нас уже не сведены к фризауту:
                  есть отдельные bounty / envelope / leaderboard-каналы. Но эти
                  каналы всё ещё держатся на house-модели, buy-in-профилях,
                  runtime-оценках и fit-policy, а не на полном знании экосистемы
                  конкретного рума, временного слота и поля в конкретный день.
                </p>
                <p>
                  Это сильно лучше &quot;вообще без формата&quot;, но всё ещё не
                  означает, что модель знает все реальные промо-правила,
                  рег-пулы и мета-сдвиги автоматически.
                </p>
              </div>
            </WeakBlock>

            <WeakBlock
              tag="EMPIRICAL"
              tone="#94a3b8"
              title="Эмпирический режим переигрывает финиши, а не всю вашу покерную реальность"
            >
              <div className="space-y-2">
                <p>
                  Empirical mode честно ресэмплит историю финишей без α-fit, но
                  он всё равно работает только с тем, что есть в самих финишах.
                </p>
                <p>
                  Он не восстанавливает скрытые причины этих мест: пересевки по
                  лимитам, изменение качества поля по времени, решение
                  late-reg, смену стиля игры, ICM-отклонения, table-draw и
                  прочие скрытые состояния. То есть это очень полезный режим,
                  но не полная causal-реконструкция вашего грина.
                </p>
              </div>
            </WeakBlock>

            <WeakBlock
              tag="INPUT"
              tone="#94a3b8"
              title="Качество ответа по-прежнему сильно зависит от качества входа"
            >
              <div className="space-y-2">
                <p>
                  Модель умеет быть честнее PrimeDope именно потому, что просит
                  больше входных допущений: поле, ROI, рейк, структуру выплат,
                  mix, uncertainty, tilt, promo-режимы.
                </p>
                <p>
                  Но это значит и обратную сторону: если пользователь даёт
                  оптимистичный ROI, неверный field-size или включает красивые
                  шумовые ручки без связи с реальностью, движок честно посчитает
                  уже неверную постановку задачи. Здесь предел не только в коде,
                  а в информационном качестве самого ввода.
                </p>
              </div>
            </WeakBlock>

            <WeakBlock
              tag="TAILS"
              tone="#94a3b8"
              title="Хвосты читаются лучше среднего, но всё равно не становятся истиной автоматически"
            >
              <div className="space-y-2">
                <p>
                  Наше главное улучшение — хвосты, просадки, recovery и ruin
                  больше не притворяются гладкими. Но как только речь идёт о
                  самых редких событиях, качество ответа по-прежнему зависит от
                  того, насколько верно выбраны finish-shape и uncertainty-слои.
                </p>
                <p>
                  Иначе говоря: модель стала гораздо честнее про bad tails, но
                  tails всё ещё самые хрупкие числа во всём приложении и именно
                  их надо читать как диапазон сценариев, а не как обещание.
                </p>
              </div>
            </WeakBlock>
          </div>
        </div>

        <div className="text-[10px] text-[color:var(--color-fg-dim)]">
          Коротко: сейчас наша модель уже достаточно сильная, чтобы честно
          показывать, где PrimeDope слишком тонкий. Но её собственные слабые
          места — это не &quot;одна неверная формула&quot;, а границы валидации,
          параметрические uncertainty-слои, частично отдельные side-channels и
          зависимость от качества входных допущений.
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
