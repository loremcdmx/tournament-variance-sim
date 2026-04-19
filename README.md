# tournament-variance-sim

Monte Carlo симулятор дисперсии для покерных MTT. Аналог [PrimeDope Tournament Variance Calculator](https://www.primedope.com/tournament-variance-calculator/), написан с нуля с упором на честность модели.

**🔗 Live:** https://tournament-variance-sim.vercel.app

*EN version below ↓*

---

## Оглавление

- [Что это](#что-это)
- [Что умеет движок, чего нет у PrimeDope](#что-умеет-движок-чего-нет-у-primedope)
- [Стек](#стек)
- [Запуск](#запуск)
- [Структура проекта](#структура-проекта)
- [Архитектура движка](#архитектура-движка)
- [Как расширять](#как-расширять)
- [Детерминизм](#детерминизм-как-контракт)
- [Известные подводные камни](#известные-подводные-камни)
- [Дополнительная документация](#дополнительная-документация)

## Что это

Ты загоняешь расписание турниров (поле, бай-ин, рейк, ROI, структура выплат), получаешь распределение P&L за N сэмплов:

- mean / median / stdDev / Sharpe / Sortino / CVaR
- гистограмма прибыли, convergence-кривая, траектории банкролла
- risk of ruin + обратная метрика (минимальный банкролл под RoR 1% / 5%)
- топ-10 даунсвингов по глубине, longest breakeven stretch
- row-level декомпозиция вклада каждого турнира в дисперсию
- sensitivity scan по ΔROI

## Что умеет движок, чего нет у PrimeDope

- **Real finish-position sampling** через power-law / stretched-exp / empirical модели, α-калибровка через бинарный поиск под заданный ROI. PrimeDope использует uniform-lift — структурно зажимает ITM rate и занижает глубину даунсвингов.
- **Multi-bullet re-entry** — каждый патрон это независимый драв, а не умножение стоимости. Даёт ~√3× σ на трёх патронах + эффект от раздутого призового.
- **PKO bounties** — распределение bounty по местам через harmonic-number elimination-order модель, а не плоская добавка к EV.
- **ICM на финалке** — Malmuth-Harville аппроксимация сглаживает топ выплат, честно снижает upside-дисперсию.
- **Field variability** — per-sample ресэмплинг размера поля вместо compile-time сглаживания.
- **Empirical finish model** — можно скормить свой гистограмм finish-places вместо параметрической модели.
- **Compare mode** — тумблер «посчитать как PrimeDope» прогоняет обе калибровки на том же сиде, рисует две колонки + диф-строку.
- **Tilt/skill-noise модели** — три канала ROI-шума (per-tourney, per-session, slow AR(1) drift) + fast tanh tilt + slow state-machine tilt с hysteresis.

Всё это без потери детерминированности (seeded `mulberry32 + mixSeed`) — тот же сид всегда даёт тот же результат.

## Стек

- **Next.js 16** + React 19 + TypeScript (App Router)
- **Web Worker** — MC-движок не блокирует UI, пул размером `navigator.hardwareConcurrency / 2`
- **uPlot** — графики (main-thread работа минимизирована через чекпойнт-сетки)
- **Tailwind 4**
- **Vitest** — 196+ тестов на движке: determinism, realized-ROI-in-SE, row decomposition sums, re-entry variance amplification, ICM flattening, empirical histogram reproduction и т.д.

## Запуск

```bash
npm install
npm run dev       # http://localhost:3000
npm test          # vitest
npx tsc --noEmit  # type check
npm run lint      # eslint
npm run build     # prod build
```

Требует Node 20+. Vercel-деплой без конфига (App Router).

## Структура проекта

```
src/
├── app/
│   ├── layout.tsx          # root layout — локаль/тема/advanced-mode провайдеры
│   ├── page.tsx            # главный экран: header + schedule editor + controls + results
│   └── globals.css         # tailwind + кастомные CSS-переменные темы
│
├── components/
│   ├── ScheduleEditor.tsx  # таблица турниров (add/remove/edit row, PKO/mystery поля)
│   ├── ControlsPanel.tsx   # sidebar настроек прогона + кнопка Run
│   ├── ResultsView.tsx     # композитный view результатов (все графики + таблицы)
│   ├── ModelPresetSelector.tsx
│   ├── charts/
│   │   ├── UplotChart.tsx          # тонкий uPlot обёртчик с ResizeObserver
│   │   ├── DistributionChart.tsx   # гистограмма финального P&L
│   │   ├── ConvergenceChart.tsx    # сходимость mean/stdDev
│   │   ├── DecompositionChart.tsx  # row variance contributions
│   │   ├── FinishPMFPreview.tsx    # per-row предпросмотр pmf + "откуда приходит профит"
│   │   └── barsPath.ts             # кастомные uPlot paths для баров
│   └── ui/
│       ├── Section.tsx       # numbered section wrapper (01, 02, 03…)
│       ├── CornerToggles.tsx # локаль / тема / advanced toggle
│       └── Tooltip.tsx       # помощь по hover
│
├── lib/
│   ├── sim/                  # ← MC-движок, чистый TS без React
│   │   ├── types.ts          # SimulationInput / SimulationResult / TournamentRow / …
│   │   ├── engine.ts         # hot loop: compileSchedule + simulateShard + buildResult
│   │   ├── finishModel.ts    # pmf-модели + α-калибровка (binary search)
│   │   ├── payouts.ts        # таблицы выплат по месту для всех структур
│   │   ├── pdCurves.ts       # PrimeDope-style кривые для binary-ITM compare
│   │   ├── icm.ts            # Malmuth-Harville ICM equities (bitmask DP)
│   │   ├── gameType.ts       # freezeout / re-entry / pko / mystery пресеты полей
│   │   ├── modelPresets.ts   # "naive" / "primedope" / "realistic" прессеты
│   │   ├── itmTarget.ts      # глобальный ITM% с per-row override
│   │   ├── validation.ts     # проверка schedule перед прогоном
│   │   ├── freezeShape.ts     # freeze-out shape fitting (real-data calibration)
│   │   ├── freezeShapeFit.ts  # least-squares fit for freeze-out payout shapes
│   │   ├── realPayouts.ts     # real-world payout table samples + comparison
│   │   ├── rng.ts            # mulberry32 + mixSeed
│   │   ├── worker.ts         # Web Worker: принимает ShardRequest → возвращает RawShard
│   │   ├── useSimulation.ts  # React-хук: пул воркеров, shard dispatch, progress
│   │   └── *.test.ts         # vitest — 10 файлов, 196+ тестов, запускаются через `npm test`
│   │
│   ├── i18n/
│   │   ├── dict.ts           # плоский словарь en/ru (все UI строки тут)
│   │   └── LocaleProvider.tsx
│   ├── ui/
│   │   ├── AdvancedModeProvider.tsx
│   │   └── useLocalStorageState.ts
│   ├── theme/
│   ├── scenarios.ts          # демо-пресеты (PrimeDope reference, RomeoPro)
│   ├── persistence.ts        # load/save state, share-URL, user presets в localStorage
│   └── lineStyles.ts         # пресеты цветов/толщины линий (HM2, H2N, HM3, PT4, PokerCraft, PokerDope)
│
scripts/                      # оффлайн-утилиты (если есть)
notes/                        # заметки по модели, не код
public/                       # статика (иконки сценариев и т.д.)
docs/
└── ARCHITECTURE.md            # подробная архитектура движка
```

## Архитектура движка

Поток данных одного прогона:

```
SimulationInput (UI)
       │
       ▼
useSimulation.onRun()        ← spawnPool() если нужно
       │
       │  1) BuildRequest → worker 0 → компилирует schedule один раз,
       │     возвращает "плоские" таблицы payout/pmf/alpha per-row
       │     (дорого: buildFinishPMF + calibrateAlpha)
       │
       │  2) ShardRequest × K → K воркеров параллельно крутят
       │     samples [sStart, sEnd), шлют ShardProgress / ShardResult
       │
       │  3) mergeShards() + buildResult() на main thread
       │
       ▼
SimulationResult → ResultsView
```

Ключевые файлы:

- **`engine.ts`** — `compileSchedule()` делает heavy-lifting: калибрует α по каждому ряду, строит alias-таблицы, подготавливает PKO heat-биннинг. `simulateShard()` — hot loop, чистая арифметика на типизированных массивах. `buildResult()` — post-processing (гистограммы, envelope, decomposition, risk-of-ruin).
- **`finishModel.ts`** — `buildFinishPMF(N, model, α)` возвращает Float64Array длины N, сумма = 1. `calibrateAlpha()` делает бинпоиск по α под заданный целевой ROI. `calibrateShelledItm()` — альтернативный калибратор, который пинит ITM rate и решает α/форму под ROI.
- **`payouts.ts`** — возвращает массив фракций призового для 1..paidCount, сумма = 1. Без денежных значений — engine умножает на prize pool сам.
- **`icm.ts`** — `applyICMToPayoutTable()` пересчитывает payout-таблицу через Malmuth-Harville и кэш по маске живых игроков. Применяется только к топ-9 местам.
- **`worker.ts`** — stateless, один воркер = один `self.onmessage`. Весь state живёт в main thread (пул, jobId, shard-счётчик).
- **`useSimulation.ts`** — React-хук владеет пулом воркеров, диспетчит shard-ы, merge-ит результаты, выкидывает statuses в UI.

Детальнее — см. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Как расширять

Наиболее частые задачи — ниже. Во всех случаях делай изменения по одному и прогоняй `npm test` + `npx tsc --noEmit` перед коммитом.

### Добавить payout-структуру
1. Добавить id в `PayoutStructureId` в `src/lib/sim/types.ts`.
2. Добавить case в `getPayoutTable()` в `src/lib/sim/payouts.ts` — вернуть массив фракций, сумма = 1.
3. Добавить label в `src/lib/i18n/dict.ts` (ключ `payout.<id>`).
4. Прогнать `npm test src/lib/sim/payouts.test.ts` — тесты поймают ненормализованный массив.

### Добавить модель финиша
1. Добавить id в `FinishModelId` в `types.ts`.
2. Добавить case в `buildFinishPMF()` в `finishModel.ts` — вернуть Float64Array длины N, сумма = 1. α обычно контролирует остроту распределения.
3. Если модель параметрическая — калибровка (`calibrateAlpha`) уже работает через бинпоиск. Если нет (как `empirical`), бинпоиск надо short-circuit-нуть.
4. Добавить опцию в `ControlsPanel.tsx` (select) и label в dict.ts.

### Добавить демо-сценарий
1. Открыть `src/lib/scenarios.ts`.
2. Добавить объект `DemoScenario` в массив `SCENARIOS` — задать `schedule`, `controls: { ...BASE_CONTROLS, ... }`, `labelKey`.
3. Добавить перевод `demo.<id>` в `dict.ts`.
4. (опц.) положить иконку в `public/scenarios/<id>.png`.

### Добавить язык
1. Добавить локаль в `Locale` и `LOCALES` в `src/lib/i18n/dict.ts`.
2. Пройтись по каждому ключу `DICT` и добавить новое поле. Тайпскрипт поймает всё пропущенное — код не соберётся пока не заполнишь.

### Добавить ROI-шум / tilt-канал
Смотри закомменченные блоки в `SimulationInput` (`types.ts`, строки 282–351). Они описывают каждый канал — математику, размерности, дефолты. Добавление нового канала = новое поле в `SimulationInput` + применение в hot loop `simulateShard()` в `engine.ts`.

### Добавить график
1. Новый файл в `src/components/charts/`. Использовать `UplotChart` как обёртку + `common.ts` для стилей.
2. Импортнуть в `ResultsView.tsx`, обернуть в `<CollapsibleSection>`.

## Детерминизм как контракт

Это **не best-effort**, это **инвариант**. Один и тот же `SimulationInput` с одинаковым `seed` ДОЛЖЕН давать побитово одинаковый `SimulationResult`, независимо от размера пула воркеров, порядка возврата shard-ов, или пересборки UI. В `engine.test.ts` есть тест, который явно сверяет это.

Что это означает на практике:
- **Не использовать `Math.random()`** нигде в движке. Только `mulberry32` с сидом.
- **Seeding per-entry** через `mixSeed(baseSeed, sampleIdx, rowIdx, bulletIdx)`. sampleIdx — глобальный (0..samples), а не per-shard. Это даёт одинаковые дравы независимо от shard-разбиения.
- **Итеративные циклы — фиксированный порядок**. Object.keys(), Set итерация и т.д. могут быть нестабильны в разных движках.
- **Time-зависимые API запрещены**. `Date.now()`, `performance.now()` только для профилирования снаружи воркера.

Если добавляешь новую механику — прогоняй `engine.test.ts` + добавь свой собственный determinism-тест.

## Известные подводные камни

**Next.js версия.** Этот репо на Next 16 + React 19. API может отличаться от того, что помнит большинство туториалов. При затруднениях — читай `node_modules/next/dist/docs/` для текущей версии, а не чьи-то блог-посты. См. `AGENTS.md`.

**Seed dispatch.** `seed = 42` не значит, что row 0 bullet 0 в сэмпле 0 получит 42. Он получит `mixSeed(42, 0, 0, 0)`. Если пишешь тест, который сверяет конкретное число — помни про это.

**`samplePaths.paths.length`** — не равен samples. Хранится только первые ~1000 (см. `wantHiResPaths` в engine.ts), остальные агрегируются в envelopes + best/worst. Слайдер "runs" в ResultsView показывает максимум `paths.length`, не `samples`.

**PKO heat.** Когда `row.pkoHeat > 0`, в compileSchedule заводится `HEAT_BIN_COUNT` альтернативных `bountyByPlace` таблиц. Hot loop выбирает одну по гауссовскому драву. Средний bounty сохраняется per-bin — только σ плывёт. Подробнее — комментарий в `engine.ts` сверху.

**ICM применяется только к топ-9.** Malmuth-Harville это O(P² × 2^P), для P > 12 не работает. Код явно пулит "дно поля" в один бакет. Для финалки 9-max это честно; для финалок с pay jump на 18-15 — приближение.

**Global ITM %.** `controls.itmGlobalPct` + чекбокс `itmGlobalEnabled` применяется каскадом в `applyItmTarget()`: заполняет `row.itmRate` только там, где он не задан. Per-row значение всегда побеждает глобальное. Смотри `src/lib/sim/itmTarget.ts`.

**PrimeDope-style EV.** `primedopeStyleEV: true` игнорирует рейк при подсчёте target winnings в binary-ITM compare-режиме. Это формально неверно (рейк — часть cost basis), но нужно, чтобы наши цифры совпадали с PrimeDope байт-в-байт для side-by-side view.

## Дополнительная документация

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — подробный разбор архитектуры движка, поток данных, формат SimulationResult
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — dev-workflow, тесты, стиль коммитов, PR
- [`AGENTS.md`](AGENTS.md) — предупреждение про версию Next.js, актуально для AI-ассистентов

## Roadmap

- [x] Фаза 1 — математика: ITM как output, реальные payout-таблицы, PrimeDope-compat калибровка
- [x] Фаза 2 — compare-режим в UI
- [x] Фаза 3 — i18n (RU+EN), демо-сценарии, tooltips
- [x] Фаза 4 — Vercel deploy
- [x] Фаза 5 — ROI noise / tilt каналы, global ITM с per-row override
- [ ] Калибровка α на реальных данных (см. `docs/INGEST.md` — пайплайн приёма CSV, валидация покрытия MC 90%-envelope на фактических P&L)

---

# EN

Monte Carlo variance simulator for poker MTTs. A from-scratch alternative to [PrimeDope's Tournament Variance Calculator](https://www.primedope.com/tournament-variance-calculator/) with an honest finish-position model.

You feed it a schedule (field, buy-in, rake, ROI, payout structure) and get the profit distribution over N samples: mean / median / stdDev / Sharpe / Sortino / CVaR, histogram, convergence curve, bankroll paths, risk of ruin, downswing catalog, row-level variance decomposition, ROI sensitivity scan.

## What the engine does that PrimeDope doesn't

- **Real finish-position sampling** (power-law / stretched-exp / empirical), α-calibrated via binary search against the target ROI. PrimeDope uses a uniform lift — structurally compresses ITM rate and understates drawdown depth.
- **Multi-bullet re-entry**: each bullet is an independent finish draw instead of pure cost scaling. Yields ~√3× σ on three bullets plus the inflated-prize-pool effect.
- **PKO bounties** distributed by place via harmonic-number elimination-order model, not a flat EV bump.
- **ICM on the final table** (Malmuth-Harville) flattens top payouts and honestly reduces upside variance.
- **Field variability**: per-sample resampling of field size instead of compile-time smoothing.
- **Empirical finish model**: feed it your own histogram.
- **Compare mode**: toggle runs both calibrations on the same seed and shows side-by-side results.
- **Tilt / ROI-noise channels**: per-tournament, per-session, and slow AR(1) drift, plus fast tanh tilt and slow state-machine tilt with hysteresis.

All deterministic — seeded `mulberry32 + mixSeed`, same seed always reproduces.

## Stack

Next.js 16, React 19, TypeScript, Web Worker engine pool, uPlot, Tailwind 4, Vitest (196+ engine tests).

## Run

```bash
npm install
npm run dev       # http://localhost:3000
npm test          # vitest
npx tsc --noEmit  # type check
npm run lint
npm run build
```

Needs Node 20+.

## Forking / contributing

Fresh contributors: read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first — it walks through the engine's data flow. Then [`CONTRIBUTING.md`](CONTRIBUTING.md) for dev workflow, test conventions, and the determinism contract (non-negotiable).

Short extension recipes (add payout structure, finish model, scenario, locale) live in the [Russian "Как расширять" section above](#как-расширять) — the file layout is language-agnostic.
