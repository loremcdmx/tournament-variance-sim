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

### #109b · AFS ceiling raise до 200k — **P2 follow-up**
Сам 2D log-poly refit закрыт (см. #109a ниже в «Shipped 2026-04-20»). Остаётся только поднять `AFS_LOG_MAX` с `log(50_000)` до `log(200_000)` в `ConvergenceChart.tsx`.

**Условие:** проверить, что 2D-формула `log σ = a0 + a1·L + a2·L² + b1·R + b2·R² + c·R·L` не расходится на extrapolation 50k→200k. `a2·L²` term может ускориться за training range'ом. Безопасный путь — мини-свип 4–6 новых полей (75k, 100k, 150k, 200k) × 5 ROIs на каждом формате (PKO, Mystery, Freeze), замерить σ, сравнить с предиктом. Если max |Δ/σ| < текущего LOO p95 — raise проходит без доработки коэффициентов. Если нет — перефитить на объединённом 50k+200k гриде.

**Риск при старте:** низкий. Формула не меняется, только слайдер-диапазон расширяется. Ошибка в extrapolation ударяет только по юзерам с полями > 50k (редкий случай).

**Не стартовать:** если в ближайшую итерацию фич (Mystery 2D ещё уточняется после #119b data drop, или ABI baselines в #132 Phase 4) — раньше сделать это, потом раз rebuild'ом коэффициенты и ceiling прыгают вместе.

### #132 · Compare-dropdown + recalc-кнопка — **P2** (design frozen 2026-04-19, revised после code audit)

**Актуальное состояние кода (важно для планирования):**
- `compareMode: "random" | "primedope"` — **уже dropdown** в [ControlsPanel.tsx:290-301](src/components/ControlsPanel.tsx:290), два value. Не boolean, как ошибочно говорила прежняя версия задачи.
- `compareWithPrimedope: boolean` — **UI toggle отсутствует**. Захардкожено `true` во всех presets ([page.tsx:84](src/app/page.tsx:84), `src/lib/scenarios.ts`, `src/lib/sim/modelPresets.ts`). De facto мёртвое поле — просто всегда-on переключатель twin-pass'а.
- Реальные 3 режима, которые dispatch рендерит в [useSimulation.ts:580-653](src/lib/sim/useSimulation.ts:580):
  1. `compareMode="random"` → second pass = тот же α, другой seed (seed-sensitivity). В существующем design'е #132 **пропущен** — нужно явно решить.
  2. `compareMode="primedope"` без PKO → second pass = PD binary-ITM (= «PrimeDope shell»).
  3. `compareMode="primedope"` с PKO → second pass = α на schedule с stripped bounties (`pdPkoFallback`). Сейчас implicit, не выбор пользователя.

**Целевая таксономия `compareSource` (UI-facing labels):**

| `compareSource` (internal)       | UI label              | Pass                                                                           |
|----------------------------------|-----------------------|--------------------------------------------------------------------------------|
| `random-seed`                    | Random seed sensitivity | same model, different seed — existing `compareMode="random"`, instant        |
| `pd-shell`                       | PrimeDope shell       | PD binary-ITM — existing `compareMode="primedope"` без PKO, instant           |
| `no-knockouts`                   | No knockouts          | same schedule, bounties stripped — existing `pdPkoFallback`, instant          |
| `same-schedule-neutral-ko`       | Neutral KO share      | same schedule, `bountyEvBias=0` на всех KO/Mystery rows — **requires recalc** |
| `abi-baseline-330` / `-22` / `-215` | $3.30 / $22 / $215 baseline | pre-baked reg-schedules (PP ITM 15%, `bountyEvBias=0`) — **requires recalc** |

7 режимов всего (3 существующих + 4 новых). «No knockouts» сейчас автоматический fallback — в новом API становится explicit выбор (auto-switch `pd-shell`→`no-knockouts` при PKO schedule можно сохранить как UX affordance, но пользователь должен видеть реально активный режим).

**Семантика Neutral KO share:** primary = текущее расписание как есть, включая user-выставленный KO-tilt; compare = тот же schedule с `bountyEvBias=0`. Показывает эффект KO-tilt'а относительно нейтрального baseline.

**Design decisions (frozen):**
- **ABI-baselines:** `$3.30 / $22 / $215` reg-schedules, PP ITM 15%, `bountyEvBias=0`.
- **KO-shift mechanics:** per-row `bountyEvBias` остаётся (глобальное поле загрубит mixed schedule).
- **Recalc-кнопка:** рядом с dropdown в правой панели, не под KO-slider. Dirty-state появляется при изменении inputs, влияющих на current compare-pass. Опции `random-seed` / `pd-shell` / `no-knockouts` — инстантные, кнопка для них не активна.
- **Variant A для `same-schedule-neutral-ko`:** primary держит user's current KO-tilt, compare — обнулённый bias.
- **`compareWithPrimedope` boolean:** удалить как мёртвое поле в рамках Phase 1 (твердо `true` при наличии twin-pass'а, gate переезжает в `compareSource != null`).

**i18n:** все compare-related легенды / tooltip'ы / captions чарта — source-aware copy. Ключи `controls.compareMode`, `controls.compareMode.random`, `controls.compareMode.primedope`, `twin.runA.cap`, `twin.runB.cap`, `chart.overlay.freezeouts` — либо переименовываем под `compareSource`, либо заводим новый namespace и постепенно срезаем старые. Решение — в Phase 5.

**Phased rollout (каждая фаза — отдельный коммит / PR):**

1. **Phase 1 — types + dispatch, без нового поведения.** Ввести `compareSource` union с тремя existing-маппированными values (`random-seed`, `pd-shell`, `no-knockouts`). Dispatch в `useSimulation.buildPasses` переезжает на `compareSource`. `compareMode` помечается deprecated (compat-shim: `"random"` → `random-seed`, `"primedope"` + hasPko → `no-knockouts`, `"primedope"` без PKO → `pd-shell`). Удалить `compareWithPrimedope` или оставить только как internal twin-gate. UI ещё старый. `tsc` + `vitest` + `eslint` зелёные.
2. **Phase 2 — dropdown расширяется до 3 explicit значений.** `ControlsPanel.tsx` dropdown получает 3 option'а напрямую по `compareSource`. `pdPkoFallback` auto-switch сохранить как visual hint («при PKO в schedule `pd-shell` автоматически рендерится как `no-knockouts`») — или убрать, решить в фазе. Deprecated `compareMode` убираем из `SimulationInput`. Маленький ревьюабельный PR.
3. **Phase 3 — `same-schedule-neutral-ko` + recalc.** 4-й dropdown option. Mutation pass (`bountyEvBias=0` на всех rows), dirty-state, recalc-кнопка рядом с dropdown. **Cache key:** `(compareSource, schedule-hash, seed, samples, scheduleRepeats, finishModelId, modelPresetId)`. Stale без этого — лёгкий баг.
4. **Phase 4 — ABI baselines + cache.** `src/lib/compareBaselines.ts` с тремя расписаниями — сначала без localStorage; вторым коммитом внутри фазы добавить localStorage (если код не распухает).
5. **Phase 5 — copy/i18n + browser smoke.** Пройти все подписи compare-related, заменить на source-aware. Browser smoke-test: все 7 опций dropdown'а / dirty-state / recalc / смена KO-slider / reload с localStorage.

**Не стартовать рефактор сразу по всем 7 режимам** — Phase 1+2 доказывают, что новая модель состояния легла, и только после этого recalc-pass.

**Ownership note:** Phase 1–2 ведёт user. Claude не трогает `useSimulation.ts`, `ResultsView.tsx`, `dict.ts`, `ControlsPanel.tsx` и compare-related код без явного вызова. `BACKLOG.md` правит кто-то один за раз.

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
- ✅ **#109a** PKO/Mystery 2D log-poly refit — заменили single-β `σ = (C0+C1·ROI)·field^β` на 2D log-poly `log σ = a0 + a1·L + a2·L² + b1·R + b2·R² + c·R·L` (L=log field, R=roi) для PKO и Mystery. Freeze и MBR остаются на single-β (их фит был корректен в пределах fit-box'а). Данные — canonical `scripts/fit_beta_{pko,mystery}.json` (11 ROIs × 18 fields × 120k samples, без нового свипа). Refit tool: `scripts/refit_2d_logpoly.ts`. Результаты LOO xval (production grid):
  - **PKO:** mean |Δ/σ| 12.7 % → **4.0 %**, p95 25.6 % → **11.7 %**, max 31.1 % → 15.1 %. R² 0.91 → 0.998.
  - **Mystery:** mean |Δ/σ| 10.7 % → **4.25 %**, p95 24.0 % → **17.0 %**, max 39.0 % → 30.6 %. R² 0.79 → 0.98.

  **convergencePolicy:** PKO убран из warning-списка, для PKO / freeze / MBR теперь рендерится numeric ±band **внутри validated training box** (freeze & PKO / Mystery field 50–50 000, PKO / Mystery ROI −0.20..+0.80, MBR field строго 18 и ROI ±0.10). За training box'ом — warning `outside-fit-box` (точка показывается как ориентир, полоса скрыта). Mystery остался в warning всегда — p95 17 % всё ещё великоват для честной полосы даже внутри box'а; приоритет reason'ов `contains-mystery > outside-fit-box` закреплён тестом. Новый pure helper `isInsideFitBox` в `convergencePolicy.ts`, `inferRowFormat` переехал туда же с корректным порядком precedence (gameType → payoutStructure → variance; `m >= 1.4 → MBR` эвристика удалена, поскольку `applyGameType("mystery")` теперь выставляет variance=2.0 и эвристика мисклассифицировала plain Mystery как MBR).

  **200k sweep findings (предтеча):** `scripts/fit_sigma_parallel.ts` (probe mode) c `logPolyPooled` на 200k fields показал, что проблема — в ФОРМЕ, а не в range'е. `logPolyPooled` как pooled-через-центрирование фит не evaluable at arbitrary (field, roi); настоящий runtime-usable 2D poly добавляет ROI-квадратичный и cross-interaction term, закрывая gap при тех же 18 training fields. Full 200k sweep не требовался для текущего промоушна (зарезервирован на #109b AFS ceiling raise).

  **Scope held:** Freeze / MBR коэффициенты не трогали (fit уже tight: freeze resid 6 %, MBR resid 2 %, LOO max < 1 %). AFS slider diapason (`AFS_LOG_MAX`) остался 50k — его расширение отдельная follow-up задача #109b с валидацией extrapolation.

- ✅ **#7** PKO/Mystery within-place bounty variance audit — закрыт как audit-only, кода не трогали. Findings:
  1. **Нет прямой cancellation:** `calibrateAlpha` двигает только E[W], канальные σ² (`pkoHeadVar`, `mysteryBountyVariance`) в hot loop ([engine.ts:2332](src/lib/sim/engine.ts:2332)) работают отдельно.
  2. **Косвенный multiplier-эффект есть, но это by-design:** для fixed-shape / itmRate-locked / bountyEvBias≠0 residual reconcile на [engine.ts:589-596](src/lib/sim/engine.ts:589) делает `bountyMean = max(0, totalEV − cashEV)`. σ_dollar ∝ bountyMean, так что при высоком cashEV bounty variance сжимается вместе с bountyMean. Бюджет замкнут, total-ROI контракт соблюдён. Означает, что `mysteryBountyVariance` в этих режимах ведёт себя как коэффициент на `bountyMean²`, а не автономная ручка на абс. σ — это корректно, но стоит держать в голове при чтении fit residuals.
  3. **xval residual 17.6% — не cancellation, а predictor form.** σ-ROI в fixed-shape mystery имеет форму `[(1+ROI) − cashEV/entryCost]·√(exp(var)−1)·f(field)`, где f(field) — не чистый степенной закон (paidCount/N, head-concentration, Poisson kill-count дают разные скейлинги). Линейный-в-ROI × power-в-field предиктор `(C0+C1·ROI)·field^β` оставляет ~10-20% systematic residual. Решается улучшением формы предиктора (log-poly, в процессе через #109), не новым variance каналом.
  4. **Stale "variance is zero" claims** — проверено 6 хитов в repo, все корректные (rakeback, pure mean shifts). Нечего чистить.
  5. **Target metric:** сейчас fit использует σ only. Рекомендация — расширить `scripts/fit_sigma_parallel.ts` репортом skew/kurt как diagnostic columns (дёшево, один лишний pass). Полный tail-CDF fit — только когда появится user-facing метрика типа "P(downswing > X BB)"; сейчас не требуется.
  6. **Новый канал не открывать** — под-условие "real under-shoot >5% specifically on PKO" не выполнено (предиктор-форм эффект объясняет residual на всех форматах, не PKO-специфично). Measurement-first контракт выдержан.

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
