# Backlog — tournament-variance-sim

> **Single source of truth.** Все активные и закрытые задачи живут здесь.
> Memory-файлы содержат только указатель на этот документ — не дублировать статус.
>
> Актуален на **2026-04-20** (v0.7.2, ветка `main`).
> Закрытые задачи см. в `git log`. История прогресса — в `CHANGELOG.md`.
> Feature scope на 2026-04-13 расширен: re-entry / PKO / empirical model **IN SCOPE** (см. commit ec88189 и ранее).

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

## 🟣 Активный список (не blocked, не hold)

Всё, что сейчас можно брать. Порядок = приоритет (сначала математика, потом полиш).

### #7 (audit) · PKO/Mystery within-place bounty variance — **P0**
Канал within-place bounty variance **уже существует**:
- PKO: `pkoHeadVar` в `applyGameType` (`gameType.ts:95`), default 0.4, разгоняет голову через heat-bin preconcentration.
- Mystery/BR: per-draw envelope lottery в hot loop (`engine.ts:~901`), σ² = `mysteryBountyVariance` либо discrete tiers.

**Audit-задачи:**
1. Verify calibration: не отменяет ли `calibrateAlpha` часть variance? (`scripts/xval_mystery.ts` показал mean |Δ/σ|=17.6% — часть residual возможно из-за этого)
2. Decide target metric: σ_final, или tail-CDF, или moments? Сейчас fit использует σ только.
3. Удалить / исправить stale claims в comments («variance is zero», если где-то осталось).
4. Если audit покажет реальный under-shoot >5% на PKO специфично — тогда новый канал, но с measurement-first.

**Условие:** #121b закрыт (коммиты 9d66e47, 754d0de) — можно стартовать.

### #109 · Масштабный σ-sweep по всем форматам — **IN PROGRESS 2026-04-20**
Прогнать large-scale fit по freeze/pko/mystery/mystery-royale на полной ROI × AFS матрице. Recal `SIGMA_ROI_*`. Ресурсы: ~4ч (12 workers × 7950X), автономный запуск.

**Статус:** часть 1 (script) закрыта коммитами `76640be` + `befaa1c` — `FIELDS` расширен до 200 000 + к каждому JSON добавлен `logPolyPooled` (log-polynomial `log σ = a + b₁·log field + b₂·(log field)²`) поверх single-β формы. Фоновый прогон запущен 2026-04-19.

**Следующая стадия (после окончания sweep-а):**
1. Разобрать output JSON-ы, подставить новые `{C0, C1, β}` + `logPolyPooled` (если материально лучше) в `SIGMA_ROI_*` константы в `ConvergenceChart.tsx`.
2. Поднять `AFS_LOG_MAX` с `log(50_000)` до `log(200_000)`.
3. Обновить `resid` per-format на основании нового cross-validation bench'а.
4. Один атомарный коммит: «coefficient refresh + AFS ceiling raise».

### #132 · Compare-dropdown + recalc-кнопка под KO-share slider — **P2**
Сейчас правый график в compare-mode зашит в `compareWithPrimedope` / cashless twin-pool — булевые тумблеры. Нужно вытащить в dropdown «с чем сравниваем» с опциями:
- PD (Shelled ITM) — existing twin-pass, instant
- MTT без ноков — existing cashless pool, instant
- MTT с текущим KO-share профилем (`row.bountyEvBias`) — **requires recalc**
- MTT низкий / средний / высокий ABI — pre-baked baseline schedules ($3.30 / $22 / $215 reg, PP ITM 15%), off-main воркер + localStorage кэш

**Recalc-кнопка** появляется при изменении KO-share slider'а: жмём → генерируем mutated `SimulationInput` с целевым `bountyEvBias` / KO-share профилем, buy-in и payout сохраняются, затем гоним отдельный pass. Прогресс-бар во втором графике под время recalc'а.

**i18n:** переписать все легенды/тултипы, где сейчас «сравнение с ПД» / «сравнение с расписанием без ноков» под выбранный dropdown-режим.

**Design-вопросы до имплементации:**
1. ABI-baselines: $3.30 / $22 / $215 reg-schedule — ок или есть свой эталон?
2. KO-shift mechanics: хранить сценарий как per-row `bountyEvBias` или добавить глобальное поле в `SimulationInput`?
3. Recalc-кнопка — под KO-share слайдером или глобальная «пересчитать правый график»?

---

### Cash follow-up — **P2** (nice-to-have после MVP 2026-04-18)
Не критично, но полирует готовый модуль:
- Preset-loader популярных румов (GG / Stars / Partypoker / Winamax)
- Per-row color в trajectory chart (сейчас все пути одного цвета)
- Per-row mean EV в stats (сейчас aggregate)
- Intra-shard progress для `nSimulations < W`
- Box-Muller → Polar/Marsaglia (~15-20% winning)
- ETA (elapsedMs / fraction)

---

## ⏳ Blocked — ждут данных / внешнего триггера

Не брать самостоятельно. Триггер прописан в каждом пункте.

### #121c · External validation — **BLOCKED BY DATA DROP**
Сверка `top1/top3/top9/ITM pmf` против реальных MTT-выборок. Ждёт CSV с сэмплом реальных финишей. Без ground-truth правки #121b — регрессия к предположениям. **Триггер:** CSV с реальными данными.

### #119b · Mystery tail apply — **BLOCKED BY DATA**
При поступлении GG Mystery-tier выборки (не BR прокси): переход на discrete-tier draw по образцу BR (#92) — single-line change в `engine.ts:~901` (переиспользовать `brTierRatios`-путь) + новый `mysteryTierRatios` preset. После: `SWEEP=mystery_only scripts/fit_sigma_parallel.ts` (~5 мин) + recal `SIGMA_ROI_MYSTERY`. **Триггер:** CSV с Mystery-tier выборкой.

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

Набор «экзотики», без которой модель остаётся узкой. Каждый пункт — отдельный не-тривиальный формат или экономическая модель. Не брать до закрытия P0, но держать как задел — сюда идут все идеи по расширению покрытия форматов.

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
Пайплайн приёма реальных finish-place данных для эмпирической калибровки (см. `docs/INGEST.md`). Ждёт CSV-дроп.

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

## ✅ Закрыто (архив последней волны)

Раскрывать по требованию — детали в `git log`. Ниже — что закрыто за текущую волну (2026-04-20 / 2026-04-19 / 2026-04-18) + старые pre-MVP.

**Shipped 2026-04-20:**
- ✅ **#136** ICM removed — unused ICM controls, engine path, types, docs, and tests removed from the product surface.
- ✅ **#137** KO-share slider + Battle Royale EV guard — EV-source slider now reports KO share of gross EV; fixed-ITM / shelled Battle Royale rows keep total ROI pinned at KO-share edges, while BR average envelope size remains fixed and only expected KO count moves.
- ✅ **#138** dead bounty-budget helper cleanup — stale `calibrateBountyBudget` export and tests removed after the engine moved to direct residual reconcile; `npx knip` clean.

**Shipped 2026-04-19:**
- ✅ **#75** strip personal/brand mentions — коммит `350e4b9` (LoremCDMX / bitB Staking / «1.5k-player fund» → нейтральные формулировки; преcет `loremcdmx` → `steady-reg`)
- ✅ **#76** MBR-in-mix baseline fix — коммит `ecfb4d7` (`mysteryRoyaleShare > 0` + mixed schedule теперь дефолтится на "exact", 3-way mix-tuple глушил σ MBR)
- ✅ **#77** σ fit uncertainty band — коммит `7d181bd` (k теперь показывает `±X%` suffix + `[k_lo..k_hi]` в tooltip; `resid` пер-формату пропагируется через `sigmaRoiForRow`/`exactBreakdown`)
- ✅ **#78 (part 1)** fit script extended — коммиты `76640be` + `befaa1c` (FIELDS до 200k, log-polynomial pooled fit в каждый JSON, FITTING.md обновлён). Recal коэффициентов — отдельно после окончания фонового sweep-а.
- ✅ **#121b** calibration decomposition — коммиты `9d66e47` (предикат `isAlphaAdjustable` + helper `applyBountyBias`) + `754d0de` (первый residual bounty reconcile после pmf build). Для α-adjustable моделей поведение численно идентично; для fixed-shape (uniform / empirical / realdata-*) bountyMean реанкорится к `total − cashEV`, восстанавливая total-EV ROI контракт на bias=0. SIGMA_ROI recal не нужен.
- ✅ **#133** progress-bar visual lag — коммит `c315c74` (`transition-[width] duration-300 → duration-100` в `ControlsPanel.tsx`). Полоса теперь держится в пределах кадра от числа в кнопке.
- ✅ **#134** status-line под progress bar — коммит `c315c74` (`BuildStage` enum в `engine.ts` → worker postMessage → `ProgressStage` в `useSimulation` → ControlsPanel рендерит `controls.stage.*` i18n-label под баром).
- ✅ **#135** language-switcher лаг — коммит `73362a0` (`setLocale` обёрнут в `startTransition` в `LocaleProvider.tsx`; клик свитчера красится немедленно).

**Shipped 2026-04-18 (предыдущая волна):**
- ✅ **#121a** conservation fixture tests — per-gameType `|realized − target ROI| < 3·SE` regression guard
- ✅ **#127** hover/trim visibility gate unified (коммит `f098b64`)
- ✅ **#128** imperative path-style rebuild on trim — brightens survivors via `plot.series[i].stroke` mutation внутри visibility batch
- ✅ **#126** two-pool EV-bias tooltip — объясняет раздельную калибровку α и bounty scale
- ✅ **#10** Sharkscope ROI convention tooltip — правило конверсии «−rake%»
- ✅ **#113** winner-bounty conservation audit — PKO own-head это конвенция, не баг
- ✅ **#131** BR/mystery-royale split-brain — `normalizeBrMrConsistency` в compileSchedule
- ✅ **#119a** mystery tail probe — log-normal σ²=2.0 совпадает с BR в одном квантиле

**Закрыто как stale / by-design (2026-04-18):**
- **#125** worst/random/best filter — код работает (ranked by final profit → visibility gate по quantile). Нужен repro если всё-таки не так; пока не триггерится.
- **#129** RB-галка на cashless-графике — documented at `ResultsView.tsx:2026` as by-design. Cashless меряет "bankroll hits zero" — специально RB-independent.
- **#122 / #114** progress-bar grainy progress + 100% — снято с беклога (не критично, скорее наблюдение, чем баг).
- **#13** editable finish % — vague; уже есть `ShapeControls` с first/top3/ft lock inputs.

**Pre-MVP prod-ready (проверено 2026-04-18):**
- ✅ **#124** trim best/worst sliders advanced-mode-gated
- ✅ **#123** convergence widget label rename

---

## 🧹 Tech debt / cleanup

### Dead code — статус после knip-прохода 2026-04-20
- ✅ Удалено: `SensitivityChart.tsx`, `charts/common.ts` (unused)
- ✅ Удалено: `calibrateFixedItm`, `translate`, `LOCATIVE`, `OVERRIDABLE_LINE_KEYS`, `isOptionalLine`, `loadPdOverlayStyle`/`savePdOverlayStyle`/`DEFAULT_PD_OVERLAY_STYLE`/`PdOverlayStyle`
- ✅ Удалено: `rowItmTarget`, `findScenario`, `getStandardPreset`, `fmtCoef`, `targetBandsLabel`, `fitRows` (2026-04-18 pre-prod sweep)
- ✅ Удалено: `calibrateBountyBudget` / `BountyBudgetResult` после перехода engine на прямой residual reconcile
- ✅ Создан `knip.json` с конфигом для `scripts/` + tailwind/postcss ignore
- ✅ `npx knip` clean (0 issues на 2026-04-20) — открытый пункт «22 unused types» разрешён предыдущими волнами очистки.

### Knip false-positive profile
Next.js + worker-pool + dev-only scripts дают систематические false positives в knip:
- Dev-only скрипты в `scripts/` не в entry-графе (решено через `knip.json`)
- Dynamic imports через worker pool — knip не трекает
- i18n keys — trust types, не knip
- Tailwind как CSS @import — `ignoreDependencies`

**Правило:** никогда не удалять файлы/экспорты по одному только knip-фиду. Всегда grep + ручная проверка usages.

---

## 📋 Правила работы

- **Не пушить в `main`** без явного подтверждения.
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
| `CHANGELOG.md` | Релиз-история (последний: v0.7.2) |

---

*Обновлять при закрытии задачи или после `git log --oneline -20`. Если пункт здесь и в коде разошлись — **код побеждает**, правь беклог.*
