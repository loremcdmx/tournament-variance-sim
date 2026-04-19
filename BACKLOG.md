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

**Review 2026-04-18 (после meta-critique):** `#113` закрыт как audit-done (винс-конвенция — не баг, зафиксирована тестами). `#131` закрыт (normalize в `compileSchedule` + warn в persistence). `#119` probe-этап сделан. `#121` расщеплён на три честных подпункта. `#7` переписан: претензия «variance = 0» была неточной — канал within-place существует в виде `pkoHeadVar/mysteryBountyVariance`, нужен аудит, не новый канал.

Любой crypto-тяжёлый `σ`-sweep (#109) запрещён до закрытия `#121a/#121b/#7` — иначе рефит коэффициентов на промежуточной математике = выкинутое CPU-время.

### ✅ #113 · Winner-bounty conservation audit — ЗАКРЫТО 2026-04-18
Audit PKO / Mystery / Battle Royale на «winner получает inflated собственный bounty» выполнен:
- **PKO:** `engine.ts:~774` — `raw[0] += Tfinal` (winner собирает собственную голову). Это стандартная PokerStars PKO-конвенция, НЕ баг. Half-to-winner / half-to-pool это **progressive rule на каждом KO** (половина идёт в голову победителя, половина в его личную bounty-награду за будущие ноки) — уже реализовано в `bountyByPlace`. Финальный нок по PKO-правилу → winner имеет право на собственную голову, как и на все предыдущие.
- **Mystery / Battle Royale:** envelope draws независимы per KO; финальный envelope rolled из тех же 8 тиров. Никакой per-winner inflation.
- **Тесты:** `engine.test.ts` → `"bounty conventions and conservation"` — три инварианта (MR winner 8 envelopes, PKO winner own-head paid, bounty budget conservation Σ bountyByPlace > 0).

**Почему раньше числилось как P0:** формулировка «may have systematic bias 0.5–2%» была гипотезой, не measurement. Actual audit показал конвенцию корректной для PKO и структурно невозможной inflation для Mystery/BR.

### #121a · Conservation invariants как permanent check (бывш. #121 accounting)
Fixture-based regression: для каждого gameType в `testing-scenarios` проверять `E[prize+bounty per run] ≈ singleCost × (1+roi) ± 0.1%` (N=10k). Сейчас calibration пишется per-run, но без reject-on-drift — случайная регрессия в `calibrateAlpha` заметна только по визуальному σ-сдвигу.

**План:** `engine.test.ts` → "conservation fixtures" describe, seed стабилен, tolerance fixed.
**Размер:** ~30 строк test-кода, 0 engine changes.

### #121b · Calibration decomposition: pmf-shape vs bounty-budget (бывш. #121 semantics)
Текущий `calibrateAlpha` (`finishModel.ts:199-250`) — одностадийный binary search: один α тащит и pmf-шейп, и bounty-lift. Для reg у ROI>0 top1 pmf размазывается (edge-EV частично уезжает в bounty). EV-bias slider (`engine.ts:473-488`, clamp ±0.25) это НЕ решает — он shift'ит между каналами **post-calibration**, не чинит smear **во время** поиска α.

**План двухстадийной калибровки:**
1. Fake-freezeout `calibrateAlpha` для row без bounty → зафиксировать top1 pmf
2. `cashEv = Σ pmf·cashPayout`
3. `residualBountyEv = (1+roi)·buyIn − cashEv − bulletCost`
4. Scale bounty-distribution mean под residual

**Артефакты:** новая функция `calibrateBountyBudget(schedule, targetRoi)`. Tests покрывают «pmf shape монотонна по ROI».

### #121c · External validation — **BLOCKED BY DATA DROP**
Сверка `top1/top3/top9/ITM pmf` против реальных MTT-выборок. Ждёт CSV-дроп от юзерского фонда (1.5k игроков) — см. `tournament_variance_sim_data_plan.md`. Без внешнего ground-truth любые правки #121b — это регрессия к предположениям. Триггер: CSV от юзера.

### ✅ #119a · Mystery tail probe — ЗАКРЫТО 2026-04-18
`scripts/probe_mystery_tail.ts` прогнан на `mysteryBountyVariance=2.0`: `P(X > 100×mean) = 3.7e-5` vs BR empirical `4.5e-5`. Совпадение в одном квантиле, skew/kurt в приемлемых границах log-normal. Stopgap σ²=2.0 сохранён до поступления реальных GG-tier данных.

### #119b · Mystery tail apply — **BLOCKED BY DATA**
При поступлении GG Mystery-tier выборки (не BR прокси): переход на discrete-tier draw по образцу BR (#92) — single-line change в `engine.ts:~901` (переиспользовать `brTierRatios`-путь) + новый `mysteryTierRatios` preset. После: `SWEEP=mystery_only scripts/fit_sigma_parallel.ts` (~5 мин) + recal `SIGMA_ROI_MYSTERY`. Триггер: CSV от юзера (см. `tournament_variance_sim_data_plan.md`).

### ✅ #131 · BR/mystery-royale split-brain — ЗАКРЫТО 2026-04-18
Fixed: `compileSchedule` вызывает `normalizeBrMrConsistency` из `gameType.ts` (force mirror между `gameType` и `payoutStructure`). `persistence.ts` warn'ит в dev при drift из `decodeState`/`loadLocal`/`loadUserPresets`. Regression tests: `engine.test.ts` → `"compileSchedule normalizes BR ↔ mystery-royale split-brain"` (два теста: BR-payout-no-gameType, MR-gameType-mtt-standard-payout).

### #7 (audit) · PKO/Mystery within-place bounty variance — **rewrite 2026-04-18**
**Старая формулировка была неточной.** Канал within-place bounty variance **уже существует**:
- PKO: `pkoHeadVar` в `applyGameType` (`gameType.ts:95`), default 0.4, разгоняет голову через heat-bin preconcentration.
- Mystery/BR: per-draw envelope lottery в hot loop (`engine.ts:~901`), σ² = `mysteryBountyVariance` либо discrete tiers.

**Актуальная задача — audit, не feature:**
1. Verify calibration: не отменяет ли `calibrateAlpha` часть variance? (`scripts/xval_mystery.ts` показал mean |Δ/σ|=17.6% — часть residual возможно из-за этого)
2. Decide target metric: σ_final, или tail-CDF, или moments? Сейчас fit использует σ только.
3. Удалить или исправить stale claims в comments («variance is zero», если где-то осталось).
4. Если audit покажет реальный under-shoot >5% на PKO специфично — тогда новый канал, но с measurement-first.

**Условие:** делать после `#121b` (иначе calibration-shift замаскирует результат).

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

### #114 · Progress-bar визуально не доезжает до 100% — **ДОЧЕРНИЙ К #122**
Fill не растягивается на всю ширину при `progress===1`. Почти наверняка симптом grainy progress из #122.
**Правило:** не трогать отдельно — перепроверить после закрытия #122. Если останется — отдельный фикс на уровне CSS/rendering.

---

## 🎰 Cash UI — следующий виток после MVP

Cash-мод вышел 2026-04-18 как MVP. Этот блок шипнут 2026-04-18 вторым коммитом: worker pool + design polish + progress bar + mix лимитов.

### ✅ Cash: progress bar + worker pool + оптимизация — SHIPPED 2026-04-18
`cashWorker.ts` + pool на `Math.min(12, hardwareConcurrency/2)` worker'ов. Shards фан-аутятся (targetShards = 2×W), прогресс обновляется per-shard, кнопка `×` отменяет job bump'ом `jobIdRef` (late messages ignore). Определённость сохранена: shard-разметка не меняет результат.

**Ещё можно (не критично):**
- Intra-shard progress для больших одиночных shard'ов (важно только если `nSimulations < W`)
- Профилинг Box-Muller → Polar/Marsaglia (ожидаемый выигрыш ~15-20%)
- ETA (elapsedMs / fraction)

### ✅ Cash: белые точки на графике — SHIPPED 2026-04-18
`series[..].points = { show: false }` на envelope + hi-res + histogram. `cursor.points = { show: false }`. Визуальный шум пропал; mean-линия как акцент остаётся читаемой.

### ✅ Cash tab: design polish — SHIPPED 2026-04-18
Inputs сгруппированы в `InputGroup` (session / rake / hourly / mix) с toggle'ами слева. Stats сгруппированы в 4 карточки (Expected / Realized / Risk / Economics) с масть-акцентами. `ToggleSwitch` заменил checkbox'ы для rake/hourly.

### ✅ Cash: mix лимитов / румов — SHIPPED 2026-04-18
`CashStakeRow[]` опциональное поле в `CashInput`. Каждая строка: wrBb100, sdBb100, bbSize, handShare, rake-block. Шкалирование к референсному bb (`input.bbSize`) — строки с большим BB вносят пропорционально больше. Single-stake остался byte-identical без `stakes`.

UI: `StakeRowEditor` с label + per-row inputs + rake-toggle. Кнопка `+ Add row`. Удаление только если рядов > 1.

**Ещё можно (не критично):**
- Preset-loader для популярных румов (GG / Stars / Partypoker / Winamax defaults)
- Per-row color in trajectory chart (сейчас все пути одного цвета)
- Per-row mean EV в stats (сейчас aggregate only)

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

### #109 · Масштабный σ-sweep по всем форматам — **BLOCKED BY P0 (#121a, #121b, #7)**
Прогнать large-scale fit по freeze/pko/mystery/mystery-royale на полной ROI × AFS матрице. Recal `SIGMA_ROI_*` после правок движка.

**⚠️ Запрет:** не запускать до закрытия всех четырёх P0 задач. Иначе рефит коэффициентов на промежуточной математике = выкинутые 4 часа CPU.

**Цели:**
- (a) рефит коэффициентов
- (b) выявить систематические отклонения модели
- (c) сравнить с `data/payout-samples/`

**Ресурсы:** ~4 часа (12 workers × 7950X). Запускать автономно.

### #126 · «Где прячется среднее» тултип — переписать под two-pool структуру
`FinishPMFPreview.tsx`, тултип у EV-баланса. Сейчас текст трактует EV как единый поток. Реально движок калибрует **два канала независимо**:

1. **Cash prize pool** через `targetRegular = entryCost·(1+roi) − bountyMean`, `finish-pmf × payoutByPlace`
2. **Bounty pool** через `bountyLift = (1+rake)(1+roi)`, `Σ pmf·bountyByPlace = bountyMean`

Тултип должен объяснять, что «среднее» = cash (ITM-heavy) + bounty (равномернее по столу в PKO/Mystery), и показывать разбивку `cashEv / bountyEv`.
**Файлы:** `src/lib/i18n/dict.ts`, `FinishPMFPreview.tsx`.

### #10 (audit) · UX tooltip про разницу ROI конвенций
Наши числа ROI ниже, чем на Sharkscope (там ROI считается **от бай-ина без рейка**, у нас — с рейком). Это не баг, а разница конвенций.
**Action:** добавить tooltip про Sharkscope-style vs наш расчёт.

---

## ❄️ Заморожено до закрытия P0 (review 2026-04-18)

Откладываем до стабилизации математики движка (#121a/#121b/#7). Код здесь не трогать.

### #106 · Spins как формат
Новый `gameType="spins"` со всей jackpot-tail σ-математикой. Это новый большой формат с отдельным engine-путём — распыление пока есть открытые P0 по существующим форматам.

**Плановые компоненты (не стартовать):**
- 3-max фикс лобби, джекпот-структуры с 6 румов
- Новый `scripts/fit_spins.ts` (σ_ROI не сходится по sqrt(N))
- Payout-gating: новый id `spin-jackpot`, dropdown фильтр

### #120 · Mobile layout
Нужен, но не раньше чем перестанут спорить математика и базовые desktop-баги. Mobile-layout правки на фоне открытых P0 — риск переделывать после.

### #6 (audit) · ICM 9 → 12 мест
Текущий лимит `ICM_MAX_PLAYERS = 9` в `icm.ts:25`. Не горит — в прошлых сессиях юзер сам сказал «про ICM забей». Не тратить фокус пока P0 открыты.

---

## 🚀 Perf / R&D epic (после математики)

Отдельный трек **после** закрытия P0 и recal'а через #109. Цель — не «микрополиш», а 2–5× speedups и архитектурные подвижки hot-loop'а.

**Потенциальные направления:**
1. **Alias / precomputed categorical sampling** для выбора мест и bounty-tier draws.
   Сейчас: linear scan по CDF за каждый sample.
   Потенциал: O(1) draw через Vose alias method (setup O(n), draw O(1)).

2. **Dual-path accumulation в одном прогоне для `with RB` / `no RB`.**
   Сейчас: `shiftResultByRakeback` пересобирает drawdown/breakeven histograms пост-фактум от финальной P&L.
   Потенциал: параллельный accumulator в hot-loop → честный RB-aware drawdown без post-process дубля.

3. **WASM / SIMD для inner loop.**
   Сейчас: JS + typed arrays.
   Потенциал: AssemblyScript/Rust хот-луп с SIMD (`f64x2` add/mul). Оценка — 2–3× speedup на bounty-heavy формате.

4. **Пересмотр структуры shard-ов и transferables.**
   Сейчас: `oversub=4` включается только при `samples × scheduleRepeats ≥ 50_000` (`useSimulation.ts:240`). Transferables list main↔worker рассинхронизован (см. #122).
   Потенциал: единый contract на transferables + более гранулярные shard'ы → smoother progress + меньше idle workers.

**Предусловие:** математика движка стабилизирована (все P0 закрыты), `SIGMA_ROI_*` отфитованы через #109.
**Риск при раннем старте:** любая перф-оптимизация до recal означает оптимизацию кривой модели. Работу придётся частично переделать.

---

## 🎰 Формат-зоопарк + модели рейка/RB (долгосрочная R&D-епопея)

Набор «экзотики», без которой модель остаётся узкой. Каждый пункт — отдельный не-тривиальный формат или экономическая модель. Не брать до закрытия P0, но держать как задел — сюда идут все идеи от юзеров и коммьюнити.

### Экзотические live/онлайн форматы
Что хочется поддержать (каждый — отдельная задача):

- **Squid Game (GG):** 8k+ игроков, 6 элим-раундов, вынос топ-X → разовая мультипликаторная выплата. Дисперсия совершенно иная vs обычного MTT — quantized ко-раундовой структурой.
- **Bomb Pot (cash):** принудительный ante+straddle в начале раздачи, прыжок дисперсии per-hand (SD/100 растёт нелинейно с bomb-frequency). Cash-движок, параметры: частота bomb-раздач, размер bomb.
- **Stand-Up Game / Double Board / Run-it-twice/thrice:** множественные boards → variance reduction (до -30% SD) при том же EV. Нужна отдельная модель «multi-board adjustment» на SD.
- **Short Deck / 6+ / Siege:** другие equity распределения, hand frequencies; вариация effect на σ_ROI для MTT или SD/100 для cash.
- **Heads-Up / SnG 2-max, 6-max / Hyper-turbo / Spin-SnG уровни:** матчапы с очень узким field size, variance по skew distr.
- **Mixed games (8-game, HORSE, SHE):** per-game rotation с разным EV/SD. Моделировать как weighted mixture распределений.
- **Exotic tourney formats:** bounty builder (GG), knockout (Stars), shoot-out, progressive rebuy, flipout, double chance, cashout lottery.

**Как подходить:** каждый формат — research brief (реальная pooled-data если есть + параметры rooma) → препарирует один из существующих движков (MTT или cash) с доп. параметрами, либо новый `gameType`. Не гнаться за всеми сразу.

### Модели рейка
Сейчас: фикс `rake` per row (MTT, на уровне buy-in), в cash — `contributedRakeBb100` (flat). Реальность богаче:

- **Capped weighted-contributed (real cash):** rake = min(cap, %pot × contribution_weight). Моделировать per-hand, зависит от equity/position.
- **Dealt rake (старые сайты):** рейк делится поровну по всем в раздаче. Худший для tight-aggressive регов.
- **Time-collection (live):** fixed $/полчаса, не связан с действиями. Нужен `hoursBlock` + rate. EV хит для микробанкролла.
- **Progressive jackpot / Bad Beat / High Hand drop:** $1–2 per pot идёт в jackpot pool; реальная потеря EV с долей возврата через джек-пот (почти всегда -EV expected).
- **Dynamic rake (GG-style promo weeks):** временные окна с -X% rake → дисперсия нестационарна. Модель: rake step function по времени.
- **MTT layered fee:** некоторые rooms (Partypoker, 888) — ступенчатая схема `buyin+fee+bountyFee`. Сейчас сворачивается в один `rake` number; настоящее разделение даст корректный cashEV vs bountyEV.

**Как подходить:** новая абстракция `RakeModel` с дискриминированным union:
```ts
type RakeModel =
  | { kind: "mtt-flat"; pct: number }
  | { kind: "cash-flat-bb100"; bb100: number }
  | { kind: "cash-capped-weighted"; pctPot: number; capBb: number }
  | { kind: "cash-dealt"; perHandBb: number }
  | { kind: "cash-time"; usdPerHour: number }
  | { kind: "cash-jackpot"; pctPot: number; capBb: number; expectedReturnShare: number };
```

### Модели рейкбека
Сейчас: `advertisedRbPct × pvi`. Расширения:

- **Tiered VIP (Stars/GG SuperCharger):** ступенчатый RB по volume tier. Параметры: thresholds по VPPs, RB% на каждом уровне. За горизонт игры игрок может пересечь границу — меняется RB mid-simulation.
- **Rakerace / Leaderboard:** top-N из лобби по rake делят prize pool. Сильно right-skew RB: большинство регов получает ноль, топ — 10×adv_rb. Моделируется как дополнительный стохастический доход с распределением зависящим от field position.
- **Deal-based / CoP (chase-of-players):** специальные кэшбек-акции на run (напр. стрики 5 cashes подряд). Epsilon-доход, но хороший example of path-dependent RB.
- **Affiliate / rakechasing fund:** внешний партнёр возвращает X% от rake поверх. Линейно, но поверх PVI — эффективный RB% растёт.
- **Skins-сплит (старые networks):** операторский rakeback × сеть-RB. Двухслойная модель.

**Как подходить:** новая абстракция `RakebackModel`:
```ts
type RakebackModel =
  | { kind: "flat"; pct: number; pvi: number }
  | { kind: "tiered"; tiers: Array<{ volumeVpps: number; pct: number }>; pvi: number }
  | { kind: "rakerace"; poolUsd: number; distribution: "top-n" | "exp-decay"; participantsEstimate: number }
  | { kind: "streak-bonus"; triggers: Array<{ cashesInRow: number; bonusUsd: number }> }
  | { kind: "layered"; layers: RakebackModel[] };
```

### Приоритизация внутри секции
Не брать ничего пока не закрыта P0 + cash-мод не оттестирован против внешних симуляторов (#11). Затем — в порядке покрытия коммьюнити:
1. Bomb Pot (MVP — частый вопрос cash-регов)
2. Capped weighted-contributed rake (real-world MTT/cash)
3. Tiered VIP RB (сейчас модель мажет все тиры одним числом)
4. Run-it-three-times (variance reducer, часто включают)
5. Остальное по запросу/данным

---

## ⏸️ HOLD — ждут внешнего триггера

### #1 · Cloud-синк пресетов через Supabase
Magic-link auth, `user_presets` + RLS. Ждёт:
- >100 активных юзеров
- Юзер создаёт Supabase проект сам (env vars `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`)

**Сейчас:** localStorage + JSON export/import.
**Не начинать** без env vars.

### Cash-mode: cross-check vs сравнимые сервисы — **IN PROGRESS 2026-04-18**

Первая половина сделана: UI в prod-ready, есть скрипт `scripts/cash_crosscheck.ts` с 5 фиксированными сценариями (baseline / breakeven / high-volume / high-volatility / losing). Скрипт печатает stats в формате, совместимом с внешними калькуляторами.

**Shortlist сервисов с идентичным input contract (wr bb/100 + sd bb/100 + hands):**
1. **PrimeDope** — https://www.primedope.com/poker-variance-calculator/ — web-форма, JS in-browser, результаты как график + `downswing table`.
2. **GamblingCalc** — https://gamblingcalc.com/poker/variance-calculator-cash-games/ — web-форма, выдаёт EV, 95% CI, probLoss, downswings.
3. **Limp Lab** — https://www.limplab.com/calculators/variance — визуализирует 95% CI.
4. **PokerLog** — https://pokerlog.app/poker-tools/variance-calculator — MC на 1000 trajectories, близко к нашей логике.

Все четыре — web-UI, публичных API нет. Автоматический side-by-side потребует headless-browser скрипт (Playwright / Puppeteer) — это overkill для single-pass валидации. Правильный план: ручной прогон, одноразово.

**Что ещё сделать:**
1. Прогнать 5 сценариев из `cash_crosscheck.ts` в каждом из 4 сервисов. Записать `meanFinalBb`, `sdFinalBb`, `probLoss` (где есть).
2. Завести `data/cash-comparisons/{primedope,gamblingcalc,limplab,pokerlog}.json` с ручными записями.
3. Отчёт `docs/CASH_COMPARE.md` — таблица расхождений, объяснение каждого > 2 SE gap.
4. Analytic cross-check (независимый от сервисов): `E[final] = wr × hands / 100`, `σ[final] = sd × √(hands / 100)`. Наш симулятор должен попадать в ±1% на 20k paths — это внутренняя sanity-check.

**Не блокирует:** остальные фичи. Это валидация существующей модели, а не разработка новой.

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

## ✅ Закрыто (ранее «дожимать перед prod-merge»)

Проверено по коду 2026-04-18 — оба пункта уже в prod-ready состоянии.

### #124 · Trim best/worst percentile sliders — **DONE**
Загейтено под advanced-mode: `{advanced && <TrimPctSlider />}` в `ResultsView.tsx:2037`; `effectiveTrimTopPct/BotPct = advanced ? v : 0` (`:1921-1922`). В дефолтном UI слайдеры не рендерятся и не влияют на расчёт.

### #123 · Convergence widget rename — **DONE**
`chart.convergence.format.exact` → UI-label `"Your schedule" / "ТВОЁ РАСПИСАНИЕ"` в `dict.ts:1066`. Внутренний format ID остался `"exact"` (BACKLOG разрешал этот вариант).

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
