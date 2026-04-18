# Backlog — tournament-variance-sim

> Живой беклог. Актуален на **2026-04-18** (v0.7.1, ветка `dev`).
> Закрытые задачи см. в `git log`. История прогресса — в `CHANGELOG.md`.
> Feature scope на 2026-04-13 расширен: re-entry / PKO / ICM / empirical model **IN SCOPE** (см. commit ec88189 и ранее).

---

## 🚦 Legend

| Метка | Значение |
|---|---|
| `P0` | Критично: бага в математике, ломает UX, или блочит релиз |
| `P1` | Важно: заметный косяк, UX или точность страдает |
| `P2` | Nice-to-have: полиш, крупные фичи без дедлайна |
| `HOLD` | Заморожено до внешнего триггера (данные, юзеры, API-ключи) |
| `✅` | Готово / осталось только смёрджить |

---

## 🔴 P0 — Math / engine correctness

Корректность движка — главный приоритет. Любой cleanup или UI-фикс откладывается, если задача из этого блока открыта.

### #121 · BR/Mystery finishModel: top1 at ROI>0 занимается реже равновесия
Калибровка размазывает edge-EV между pmf и bounty, `top1 pmf reg` получается **меньше** freezeout-equivalent. Это искажает распределение мест в форматах с баунти.

**План:**
1. Fake-freezeout `calibrateAlpha` для row без bounty → зафиксировать reg top1 pmf
2. `cashEv = Σ pmf·cashPayout`
3. `residualBountyEv = (1+roi)·buyIn − cashEv − bulletCost`
4. Scale bounty-distribution mean под residual

**Артефакты:** новая функция `calibrateBountyBudget(schedule, targetRoi)`.
**После правки:** recal `SIGMA_ROI_*` — связано с #119.

### #119 · Mystery дисперсия — правый хвост + recal
Юзер воспринимает Mystery как менее дисповый, чем GG в реальности. Stopgap `mysteryBountyVariance=2.0` (log-normal) даёт `P(>100×mean) = 3.7e-5` vs BR empirical `4.5e-5`.

**План:**
1. Probe `scripts/probe_mystery_tail.ts` на текущем движке
2. Сравнить skew/kurt с реальными GG-данными
3. Либо поднять σ² до 2.5–3.0, либо перейти на discrete-tier draw как BR (#92)

**После правки:** `SWEEP=mystery_only scripts/fit_sigma_parallel.ts` (~5 мин) + recal `SIGMA_ROI_MYSTERY`.

### #113 · PKO/Mystery/BR: winner-bounty inflation edge case
Когда финалист выбивает последнего оппонента — получает inflated собственный bounty. Нужно проверить ветки `if (aliveAfter === 1)` / `place === 1` в `engine.ts`:
- **PKO:** half-to-winner half-to-pool
- **Mystery:** mean не инфлируется per-KO
- **BR:** independent draw per KO

**Возможный systematic bias:** winner-EV ~0.5–2%.

### #7 (audit) · PKO within-place bounty variance
Текущая модель сохраняет `Σ pmf[i]·bountyByPlace[i] = bountyMean`, но без **within-place bounty variance**. Это систематическое занижение σ для PKO на 5–15%.

**План:** добавить per-place bounty-noise канал (fresh `mixSeed` slot для детерминизма) + determinism test.

---

## 🟠 P1 — UX-баги, root-cause уже найден

Все root causes установлены 2026-04-17. Нужны точечные фиксы + regression-тесты.

### #127 · Часть ранов «живёт по своим правилам» на hover/trim
Прямой рассинхрон visibility и hover:
- Видимость path-ранов режется по quantile в `ResultsView.tsx:349-378`
- Но nearest-path поиск при hover **не учитывает trim** (`ResultsView.tsx:391-414`) — отсекает только `rank >= visibleRuns`
- Best/worst real lines остаются hoverable через `isHighlightable` (`ResultsView.tsx:406`)

**Фикс:** единый `visibleRunIndicesSet`, который читают и render, и hover. Альтернатива — продублировать visibility-маску в nearest-path lookup.

### #128 · «Размытие» графика при -best/-worst trim
Канвас корректен (`UplotChart.tsx:48` пересоздаёт uPlot, overlay учитывает DPR). Реальные причины:
- Path-style фиксируется заранее как **mid-density compromise** (`ResultsView.tsx:1142-1149`, `:845`)
- Trim прячет серии **без полного rebuild** (`ResultsView.tsx:345`)
- Y-range ведёт себя так, как будто хвостовые bands выбрасываются при trim (`ResultsView.tsx:1571-1591`), но visibility их не прячет

**Фикс (на выбор):**
- (a) ребилд path-style при смене trim — пересчитать density по visible count
- (b) выровнять visibility-слой с Y-range trim-гейтом

### #122 · Progress-bar «зависает посередине» — grainy progress
**Не** настоящий freeze, а грубая дискретизация по завершённым шардам.

**Корни:**
1. Пул шардов слишком мал. `useSimulation.ts:56` режет до ~½ logical cores; `oversub=4` включается только при `samples × scheduleRepeats ≥ 50_000` (`useSimulation.ts:240`). Иначе шардов всего `W`. На `W=2` один тяжёлый хвост паркует бар на ~46%; на `W=4` — 69/46/23%.
2. Прогресс считается как `doneAll / totalAll * 0.92` (`useSimulation.ts:285`) — квантованно по штукам, не по времени.
3. Верхние 8% (0.92→1.0) **синтетические** — тикер в `useSimulation.ts:445`.
4. `useSimulation.ts:339` transfer'ит не все TypedArray — worker-side список шире (`worker.ts:119`). Возможный late-stall.

**План:**
- (a) снизить порог `oversub=4` или включить его всегда
- (b) time-weighted прогресс: `done-fraction × α + elapsed/estimated × (1−α)`
- (c) синхронизировать transferables main ↔ worker
- (d) верхние 8% либо честно driven по build-phase tick, либо убрать искусственный offset

**Измерить через `performance.mark` в worker + main перед правкой.**

### #114 · Progress-bar визуально не доезжает до 100%
Fill не растягивается на всю ширину при `progress===1`. Возможно пересекается с #122. **Перепроверить после #122.**

---

## 🟡 P1 — Bugs, требуется repro/clarification

### #13 · Editable finish % в микроскопе
Слишком vague. `ShapeControls` уже имеет first/top3/ft lock inputs.
**Action:** спросить юзера — что ещё должно редактироваться?

### #125 · Worst/random/best фильтр работает некорректно
Segmented `RunModeSlider` в TrajectoryCard toolbar не даёт ожидаемого эффекта.
**Подозрение:** `rankedRunIndices` сортирует не по тому критерию, либо `visibleRuns` не применяет ranking к `setSeries(show)`.
**Нужно:** конкретный repro — какой пресет, что ожидается.

### #129 · Галка «с RB» не двигает cashless-график в streaks
**By design, но конфликтует с ожиданиями.** Wiring-бага нет:
- Панель переключает `displayResultStreaks` (`ResultsView.tsx:1742-1747`)
- Cashless-часть специально RB-independent (см. comment в `ResultsView.tsx:1029`)
- `shiftResultByRakeback()` пересобирает только drawdown/longestBreakeven/recovery (`ResultsView.tsx:1038-1040`)
- В compare-режиме overlay берётся из сырого `pdChart` **без RB-ветки** (`ResultsView.tsx:2414/2444/2473`)

**Решение (выбор):**
- (a) документировать в тултипе «cashless measures bankroll zero — independent of RB by definition»
- (b) добавить RB shift к cashless тоже (логически спорно, но uniform behaviour)
- (c) compare-overlay: сделать RB-aware ветку в pdChart

**Уточнить у юзера, какое поведение правильное.**

---

## 🟢 P2 — Features / медленный рост

### #106 · Spins как формат
Новый `gameType="spins"`. MVP:
- 3-max фикс лобби, ROI ~3% read-only, AFS=3
- Джекпот-структуры: PokerStars Spin&Go, GG Spin&Gold, Winamax Expresso, Partypoker SPINS, 888 BLAST, iPoker Twister
- Pull тиры + вероятности
- Payout-gating: новый id `spin-jackpot`, dropdown фильтр по `gameType`
- σ_ROI формула другая (jackpot-tail, sqrt(N) не сходится) → отдельный `scripts/fit_spins.ts`

### #109 · Масштабный σ-sweep по всем форматам
Прогнать large-scale fit по freeze/pko/mystery/mystery-royale на полной ROI × AFS матрице. Recal `SIGMA_ROI_*` после недавних правок движка (#71, #92, #94).

**Цели:**
- (a) рефит коэффициентов
- (b) выявить систематические отклонения модели
- (c) сравнить с `data/payout-samples/`

**Ресурсы:** ~4 часа (12 workers × 7950X). Запускать автономно.

### #120 · Mobile layout
Viewport < 640px: ScheduleEditor row table (7 полей), EV breakdown (7-column grid), TrajectoryCard toolbar — overflow'ят.

**Подход:** mobile-only preset-based mode:
- dropdown сценариев → результаты, без ручного редактирования
- Controls → `rbFrac` + `samples`
- Advanced widgets collapsed
- Отдельный `MobileApp` или pure CSS `hidden sm:block`

**Тест:** portrait/landscape, iOS Safari.

### #126 · «Где прячется среднее» тултип — переписать под two-pool структуру
`FinishPMFPreview.tsx`, тултип у EV-баланса. Сейчас текст трактует EV как единый поток. Реально движок калибрует **два канала независимо**:

1. **Cash prize pool** через `targetRegular = entryCost·(1+roi) − bountyMean`, `finish-pmf × payoutByPlace`
2. **Bounty pool** через `bountyLift = (1+rake)(1+roi)`, `Σ pmf·bountyByPlace = bountyMean`

Тултип должен объяснять, что «среднее» = cash (ITM-heavy) + bounty (равномернее по столу в PKO/Mystery), и показывать разбивку `cashEv / bountyEv`.
**Файлы:** `src/lib/i18n/dict.ts`, `FinishPMFPreview.tsx`.

### #6 (audit) · ICM до 12 мест
Текущий лимит `ICM_MAX_PLAYERS = 9` в `icm.ts:25`. Покроет 10-max SNG без изменения алгоритма.
**Риск:** при n=18 таблица ~4.7M состояний (медленно); n=12 — ещё быстро (~20K).

### #10 (audit) · UX tooltip про разницу ROI конвенций
Наши числа ROI ниже, чем на Sharkscope (там ROI считается **от бай-ина без рейка**, у нас — с рейком). Это не баг, а разница конвенций.
**Action:** добавить tooltip про Sharkscope-style vs наш расчёт.

---

## ⏸️ HOLD — ждут внешнего триггера

### #1 · Cloud-синк пресетов через Supabase
Magic-link auth, `user_presets` + RLS. Ждёт:
- >100 активных юзеров
- Юзер создаёт Supabase проект сам (env vars `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`)

**Сейчас:** localStorage + JSON export/import.
**Не начинать** без env vars.

### Real-data calibration pipeline
Юзер управляет покер-фондом на ~1500 игроков и предложил экспорт реальных данных. Данные пока не выгружены.

**Зачем:** сейчас калибровка α — бинарный поиск по декларируемому ROI. Matches ITM frequency, но не shape of tail. Реальные данные делают модель эмпирически валидированной → настоящий flex против PrimeDope.

**Data wishlist (priority order):**

| Tier | Что | Формат | Цель |
|---|---|---|---|
| **T1** | Finish-place samples (50–100k rows) | `player_id, tourney_id, finish_place, field_size, buyin, roi_bucket` | Fit α по реальному tail shape → α-table by ROI bucket |
| **T1** | Per-player P&L series (200+ игроков × 2k+ турниров) | `player_id, tourney_id, date, buyin, prize, bounty, is_reentry` | Validation test: реальные P&L vs MC 90% envelope |
| **T2** | PKO bounty data | `player_id, tourney_id, finish_place, bounty_collected, bounty_paid, field_size, bounty_fraction` | Verify `H_{N-1} − H_{p-1}` analytical formula |
| **T3** | Re-entry stats | `player_id, tourney_id, bullets_fired, cashed_on_bullet_k` | Real reentryRate distributions |
| **T3** | Field-size outcomes | `tourney_series_id, date, actual_field_size` | Real field variability |

**Что построить с данными:**
1. `scripts/calibrate.ts` — ingest T1 CSV, fit α через MLE / KL-divergence, emit α-table by ROI bucket
2. **Empirical-profile preset loader** — upgrade empirical-buckets mode → calibrated α для parametric model
3. **Validation test** (`src/lib/sim/validation.test.ts`) — coverage rate (должен быть ≈ 90%)
4. **Bounty-table override** — empirical lookup `(field_size_bucket, bounty_fraction)` вместо аналитической формулы
5. **PrimeDope narrative upgrade** — реальное число в PDVerdict: «back-tested на N игроках, наша σ в пределах ε%; PrimeDope off by X%»

**Формат:** plain CSV, UTF-8, player IDs хэшированы. Даже 20k well-structured rows из T1 достаточно.

---

## ✅ Дожимать перед prod-merge (лежит на `dev`)

Эти фиксы уже в `dev`, но **откачены** из prod 2026-04-17 после «хватит пушить без спросу». `main` на `6e96c20`.

### #124 · Trim best/worst percentile sliders
Двойной слайдер 0..40% слева от `visibleRuns`. Фильтрует paths по quantile финального профита; `computeYRange` гейтит envelope.
**Файлы:** `ResultsView.tsx` (+ `TrimPctSlider` внутри), dict keys `runs.trim.best/worst`.
**Перед prod-merge:** вынести под advanced-mode toggle — дефолтный UI без этих слайдеров.

### #123 · Convergence widget rename
Табу «точно» / «Exact» → «расписание» / «Schedule». Семантика точнее: вкладка считает σ по конкретному расписанию, не по усреднённой формуле.
**Файлы:** `ConvergenceChart.tsx` (format flag `"exact"` → `"schedule"` либо только UI-label), `dict.ts` keys `chart.convergence.format.{exact,avg}`.

---

## 🧹 Tech debt / cleanup

### Dead code — статус после knip-прохода 2026-04-18
- ✅ Удалено: `SensitivityChart.tsx`, `charts/common.ts` (unused)
- ✅ Удалено: `calibrateFixedItm`, `translate`, `LOCATIVE`, `OVERRIDABLE_LINE_KEYS`, `isOptionalLine`, `loadPdOverlayStyle`/`savePdOverlayStyle`/`DEFAULT_PD_OVERLAY_STYLE`/`PdOverlayStyle`
- ✅ Создан `knip.json` с конфигом для `scripts/` + tailwind/postcss ignore
- ⏭️ Оставшиеся флаги (ревизия по требованию): `rowItmTarget`, `findScenario`, `getStandardPreset` — legitimate API surface
- ⏭️ Unused types: 22 штуки — большинство в публичных модулях движка, решить case-by-case

### Knip false-positive profile
Next.js + worker-pool + dev-only scripts дают систематические false positives в knip:
- Dev-only скрипты в `scripts/` не в entry-графе (решено через `knip.json`)
- Dynamic imports через worker pool — knip не трекает
- i18n keys — trust types, не knip
- Tailwind как CSS @import — `ignoreDependencies`

**Правило:** никогда не удалять файлы/экспорты по одному только knip-фиду. Всегда grep + ручная проверка usages.

---

## 📋 Правила работы

- **Не пушить в `main`** без явного подтверждения юзера (2026-04-17).
- **`dev` держать ≥ `main`** (см. `feedback_dev_ahead_of_main.md`). Перед работой: `git log dev..main`.
- **Parallel sweeps:** cap 12 workers (7950X, оставляет headroom).
- **Cleanup ≠ feature commit.** Разделять коммиты.
- **Определённость — жёсткий контракт.** `SimulationInput + seed → byte-identical SimulationResult`.

---

## 🗂️ Related docs

| Документ | Что внутри |
|---|---|
| `docs/ARCHITECTURE.md` | Data flow, worker pool, determinism contract, perf knobs |
| `docs/FITTING.md` | Как запускать σ-sweep, интерпретировать `{C0, C1, β}` |
| `CONTRIBUTING.md` | Dev setup, branching, commit style, testing rules |
| `AGENTS.md` | Post-compression re-entry point + sharp edges |
| `CHANGELOG.md` | Релиз-история (последний: v0.7.1) |

---

*Обновлять при закрытии задачи или после `git log --oneline -20`. Если пункт здесь и в коде разошлись — **код побеждает**, правь беклог.*
