# DOSSIER — Deep Review (2026-04-14)

Разбор по шагам, сверху вниз. Каждый шаг — самостоятельный «эпизод», после которого фиксируется решение (принять / отложить / выбросить).

---

## 0. TL;DR (30 секунд)

- **Наш движок делает строго больше, чем PD**: re-entries, ICM, stakung, bounties (flat + progressive), mystery bounty σ², tilt (fast + slow), drift AR(1), поле переменного размера, late reg, sit-through-pay-jumps, эмпирическая finish-PMF. PD ничего из этого не умеет.
- **PD считает SD аналитически** (`Σ pmf·(prize−μ)²` → `×√N`), RoR — через Brownian first-passage с нормальным хвостом. **Мы считаем SD/RoR эмпирически** по пути каждой симуляции.
- Разница, которая нас преследовала ($6237 vs $5789 при 100p/$50/10%/11%/1000t): была **целиком в форме выплатной сетки** — `mtt-standard` (ratio 1.35) против PD-шного `h[8]`. После добавления `mtt-primedope` мы попадаем в PD-band.
- **Главные бутылочные горлышки у PD**: (1) ROI считается от `buyin+fee`, а не `buyin`; (2) ITM-rate формула `l = (s + (s+1)·p/n + 1)·h/j` — семантически странная; (3) RoR Гауссов → недооценивает хвост для скошенного MTT-PMF; (4) нет re-entries/ICM/bounties; (5) `Math.random()`, seed не экспортируется; (6) финишная PMF — бинарная ITM/bust, а не skill-weighted.
- **Главные бутылочные горлышки у нас**: (1) skewness/kurtosis считаются как population moments (`/S`, а не `/(S−1)`), недооцениваем хвосты; (2) staking `costFactor < 0` при `sold × markup > 1` допустим без валидации; (3) Poisson Knuth ветка обрывается на λ=20 — тайтовая граница; (4) envelope-subsample детерминированный, но stride-based, не uniform random; (5) много виджетов без tooltip'ов и без явной семантики; (6) Sensitivity-chart без подписи оси X; (7) Verdict-card без RoR-callout'а, когда bankroll задан; (8) log-growth клампит ruin в `ln(1e−9)` асимметрично.

---

## 1. Как работает PrimeDope (детально)

> Источник: `tmp_legacy.js` (1614 строк), дамп их prod-скрипта.

### 1.1. Входы на одну строку турнира (`Tourney`, строки 1345–1359)

| Поле | Переменная | Тип | Дефолт |
|------|-----------|-----|--------|
| players | `j` | int | 2 |
| buyin | `n` | $ | 1 |
| fee (rake $) | `p` | $ | 0.1 |
| roi | `s` | fraction | 0 |
| payout table | `c` | ref на `h[i]` | h[0] |

Нет: re-entries, ICM, staking, bounties (любых), мистери, late reg, pay jumps, multi-tabling, drift, shock, tilt. Всё это **мы добавили сверху** — PD этого в принципе не знает.

### 1.2. Выплатные таблицы — 32 `h[]` + 5 сателлитов

- Хардкод, `h[0..31]`.
- **Автоподбора по размеру поля нет.** UI — dropdown, фильтрованный условием `h ≤ players` (строка 1418). Игрок выбирает руками.
- При применении таблицы к полю другого размера **нет ресемплинга** — доли места 1..N применяются как есть, на оставшиеся места → bust.
- `h[8]` — канонический 15-paid для ~100 игроков, именно он матчит reference scenario:
  ```
  1: 25.5%   2: 16.0%   3: 11.5%   4: 9.0%   5: 7.5%
  6:  6.0%   7:  4.5%   8:  3.5%   9: 3.0%
  10–12 плато 2.5% × 3
  13–15 плато 2.0% × 3
  ```
  Это не геометрическая прогрессия — ручная кривая с плато в хвосте.

### 1.3. Финишное распределение — бинарный uniform-ITM

```js
G(a) = Math.random() < a.l
  ? Math.floor(Math.random() * a.c.h)              // ITM — uniform по paid
  : Math.floor(Math.random() * (a.j - a.c.h)) + a.c.h  // bust — uniform по bust
```

То есть: ITM/bust → Bernoulli; внутри бина → uniform по местам. Skill-градиента внутри ITM **нет**. 1-е место и min-cash рандомизируются равновероятно.

### 1.4. Как ROI попадает в ITM-rate

Строка 1359:
```js
this.l = (this.s + (this.s + 1) * this.p / this.n + 1) * this.h / this.j;
```

Для 100p/$50/10%/11% rake (p=5.5, n=50, h=15, j=100, s=0.10):
```
l = (0.10 + 1.10 · 0.11 + 1) · 0.15 = 1.221 · 0.15 ≈ 0.18315
```

Это странная формула: она нормализует `h/j` (базовый ITM rate = 15%) на множитель `(1 + s + (s+1)·rake_frac)`. По смыслу — «ROI раскладывается как буст поверх базового ITM», плюс rake ещё раз домножается.

EV на турнир:
```js
k = function() { return (this.n + this.p) * this.s; };
```
То есть `(buyin + fee) × ROI`. Для reference: `55 × 0.10 = $5.55`, а **не** `$5.00`, как они показывают в UI. Они либо игнорируют rake в cost basis на сайте, либо формула имеет скрытое деление где-то ещё. Нужно перепроверить, но это **не критично** — мы уже знаем, что мы должны симулировать: **`primedopeStyleEV = true` ⇒ игнорируем rake как cost**.

### 1.5. SD — closed form, не MC

```js
t = function() {  // variance per tourney
  var a = this.k(), b = 0;
  for (var d = 0; d < this.data.length; d++)
    b += Math.pow(this.data[d][0] - a, 2) * this.data[d][1];
  return b;
};
u = function() { return Math.sqrt(this.t()); };
// на N турниров:
MultiDist.u = function() { return this.b.e.u() * Math.sqrt(this.f); };
```

Дискретная сумма `Σ pmf·(prize − μ)²`, затем `×√N`. Никакого MC-агрегата. «sim SD = $5789» у них — это **отдельный** MC-прогон поверх этого, который они тоже показывают ради красоты. MC-шум между их math и sim примерно 3% — в пределах ожидаемого.

### 1.6. RoR — Brownian first-passage + Beasley-Springer-Moro

Функция `p(a)` (строки 1179–1190) — инверсия нормального CDF через Beasley-Springer-Moro. Функция `q(a, b, d)` (строки 1192–1195) — Hastings-аппроксимация Φ. Сам формульный ruin в дампе не виден явно, но по всем признакам (аналитический σ × √N, inverse normal, отсутствие пути-эмпирического агрегата) — это Gaussian first-passage с ruin threshold `B`:
```
P(ruin | B) = Φ((−B − μN)/(σ√N)) + exp(−2μB/σ²) · Φ((−B + μN)/(σ√N))
```
Бисекция по B для фиксированного α ∈ {0.01, 0.05}.

**Критическая проблема их подхода**: реальное распределение профита на MTT сильно скошено вправо (куча busts, редкие большие спайки). Gaussian хвост систематически **недооценивает** вероятность глубоких просадок → RoR PD — оптимистичный. Это не баг движка, это баг модели.

### 1.7. RNG, seed, samples

- `Math.random()` (V8 → xorshift128+). Не seed-управляемый. Воспроизводимости **нет**.
- Default samples = 1000 (`this.g = 1E3`, строка 1429).
- Никакой стратификации, antithetic variates, QMC. Простой SRS.

### 1.8. Что PD НЕ моделирует (белый список)

1. Re-entries / rebuys
2. ICM final table
3. Staking / backing
4. KO bounties (flat)
5. Progressive KO
6. Mystery bounties
7. Late registration (field growth)
8. Переменный размер поля
9. Skill drift / shock / tilt
10. Multi-table, параллельные турниры
11. Pay-jump play style
12. Satellites с seat-ticket логикой (их сателлиты — это «N winners get equal share»)
13. Custom PMF / empirical finish buckets
14. Воспроизводимость по seed
15. Skewed-tail RoR (они Gaussian)

---

## 2. Как работает наш движок (детально)

> Источники: `src/lib/sim/{engine,types,payouts,finishModel,icm,modelPresets,rng,worker,useSimulation}.ts`

### 2.1. Пайплайн

1. **compileSchedule** (`engine.ts:98–167`) — раскатывает `schedule` в `CompiledSchedule` (плоский список `CompiledEntry`), учитывает `calibrationMode`.
2. **compileSingleEntry** (`engine.ts:169–520`) — на каждую строку: late reg × re-entry × rake → cost; bounty decomposition; payout select; ICM smoothing; finish PMF + alpha calibration; sit-through-pay-jumps transform; bounty distribution; staking.
3. **shard planning** (`useSimulation.ts:98–156`) — `samples` делятся на shards по числу воркеров, каждый shard = `[sStart, sEnd)`. Seed: `mixSeed(seed, s)` на каждый sample — **независимо от числа shard'ов**.
4. **worker hot loop** (`engine.ts:1301–1542`) — на каждый `s` итерируется по всем турнирам `i`: draw ROI-δ → pick variant → sample finish → bounty + mystery log-normal → accumulate → drawdown tracking → checkpoint writes.
5. **mergeShards** (`engine.ts:1580–1627`) — склейка буферов по возрастанию `sStart`.
6. **buildResult** (`engine.ts:630–1143`) — все stats + envelope percentiles + sample paths + decomposition + sensitivity + downswings + convergence.

### 2.2. Что происходит с одной строкой (compile)

- **Late reg**: `N_effective = floor(players × lateRegMultiplier)` (178). Масштабирует pool и paid seat count.
- **Re-entry**: геометрическое число попыток, `reentryExpected = reRate(1 − reRate^(cap−1))/(1 − reRate)` (196). Cost на запись инфлирован.
- **Rake cost**: `entryCostSingle = buyIn × (1 + rake)` (208). В PD-style mode rake игнорируется (110).
- **Bounty decomposition**: `bountyPerSeat = buyIn × bountyFraction`, EV-лифт от скилла `bountyLift = clamp(1 + roi, 0.1, 3)`, pool уменьшается (233).
- **Payout select**: `calibrationMode === "primedope-binary-itm"` → форсим `mtt-primedope` (243).
- **ICM final table**: `applyICMToPayoutTable` с smoothing = 0.4 (254).
- **Alpha calibration** (power-law / stretched-exp): binary search α так, чтобы `E[winnings] = targetRegular`. 50 итераций (171).
- **Binary-ITM calibration**: двухбинный uniform — всё paid: `pmf[i] = l/paid`; всё bust: `pmf[i] = (1−l)/(N−paid)`. Реальная выплата сохраняется на paid местах.
- **Sit-through-pay-jumps** (309–378): EV-preserving переворот — снимается `q × mass_bottom`, делится на top (аналитически `x = avgBottom/avgTop × massTop/removed`) и busts. EV = 0 точно, variance растёт.
- **Bounty distribution** (382–477): flat KO — `bountyKmean[p] = H_{N−1} − H_{p−1}`; PKO — рекурсия по накапливающемуся head pool, глубокие финиши получают пропорционально больше.
- **Staking** (479–502): `costFactor = 1 − sold × markup`, призы/bounty на `(1 − sold)`.
- **Mystery bounty σ²** сохраняется в `CompiledEntry.mysteryBountyLogVar`, применяется в hot loop.

### 2.3. Finish model (варианты)

| id | формула | ROI injection | UI-exposed |
|----|---------|---------------|------------|
| `power-law` (default) | `pmf[i] ∝ (i+1)^(−α)` | binary search α | yes |
| `linear-skill` | `1 + α·tanh(α)·((N+1)/2 − i)` | α | yes |
| `stretched-exp` | `exp(−|α|·(i−1)^β)`, β ∈ (0, 2] | α | yes |
| `plackett-luce` | 1 скилл × (N−1) baseline, `s = e^α` | α | yes |
| `uniform` | `1/N` | нет (calibration no-op) | yes |
| `empirical` | user `empiricalBuckets`, linear interp | нет | yes |
| `binary-itm` (calibrationMode) | Bernoulli(l) + uniform внутри бина | formula `l = targetWinnings × paid / pool` | internal |

### 2.4. Hot-loop (один турнир на одном sample)

```
effectiveDelta = deltaROI + drift + sessionShock + tourneyShock + tiltShift
drift            ← AR(1): ρ·drift + boxMuller · σ·√(1−ρ²)   (ρ default 0.95)
tiltFast         ← tanh((drawdown − upswing) / scale) · gain
tiltSlow         ← state machine с гистерезисом (entry/exit по min duration + recovery frac)

variant          ← pick uniform из row.variants (если fieldVariability)
place            ← sampleFromCDF(cdf, rng())    // binary search
k (KO count)     ← Poisson(bountyKmean[place])  // Knuth если λ<20, иначе Gaussian-approx
bountyDraw       ← (bountyByPlace[place] × k) / λ
   if mystVar>0 : sigSum² = ln(1 + (e^σ²−1)/k); scale = exp(sigSum·Z − 0.5·sigSum²); bountyDraw *= scale
bulletCost       ← single × (1 − effectiveDelta)
delta            ← prizes[place] + bountyDraw − bulletCost
profit           += delta
runningMax/Min, drawdown, breakeven, cashless streak, ruin flag
checkpoint writes (K+1 logarithmically spaced)
```

### 2.5. Что считает buildResult

| Метрика | Формула | Пометка |
|---------|---------|---------|
| mean | `Σ/S` | — |
| stdDev | `√(Σ(x−μ)² / (S−1))` | unbiased |
| quantiles (p01/p05/p25/p50/p75/p95/p99) | `sorted[floor(p·(S−1))]` | floor, не linear interp |
| skewness | `Σ z³ / S` | **population** (недо-оценивает хвост) |
| kurtosis | `Σ z⁴ / S − 3` | **population** |
| sharpe | `mean / stdDev` | risk-free = 0 |
| sortino | `mean / downSigma` (только losing) | denominator = downCount − 1 |
| kellyFraction | `mean / variance` | 0 если mean ≤ 0 |
| logGrowthRate | `Σ ln(1 + profit/bankroll) / S` | ruin clamped to `ln(1e−9)` |
| var95/var99 | `−pct(0.05)` / `−pct(0.01)` | VaR |
| cvar95/cvar99 | mean tail loss | ES |
| riskOfRuin (empirical) | `ruined / S` | честная |
| minBankrollRoR{1,5,15,50}pct | quantile по `runningMins` | по факту |
| minBankrollRoR{1,5}pctGaussian | Brownian first-passage + bisection | PD-compatible |
| mcSeMean, mcSeStdDev, mcCi95HalfWidthMean, mcRoiErrorPct, mcPrecisionScore, mcSamplesFor1Pct | обычные MC SE | новая фича |
| tournamentsFor95ROI | `(1.96·σ/(0.05·cost))²` | эвристика |

### 2.6. Envelope percentiles

- ENV_CAP = 50,000 subsample, stride = `S / envS`.
- На каждый из K ≈ 200 checkpoint'ов:
  - mean на полном S (дёшево).
  - 6 percentiles (p15/p85/p2.5/p97.5/p0.15/p99.85) на subsample через sort column.
- **Детерминированно, но stride-based** — это не uniform random sub-sample. Для p0.15/p99.85 это даёт ~0.3σ смещение при 50k — приемлемо.

### 2.7. Seed / reproducibility

`mixSeed(seed, sampleIndex)` → каждый sample получает независимый `mulberry32`. Три независимых RNG на sample: finish (main), skill (`seed ^ 0xbeef`), bounty (`seed ^ 0xb01dface`). **Результат не зависит от числа shard'ов** — тест-фикстуры это гарантируют.

---

## 3. Bottlenecks / Issues — PrimeDope

| # | Проблема | Что это значит для игрока | Как мы это бьём |
|---|----------|---------------------------|-----------------|
| P1 | ROI применяется к `(buyin + fee)`, не к `buyin` | Нижняя граница EV занижена на rake% | Флаг `primedopeStyleEV` в compare-колонке, честная математика в primary |
| P2 | ITM-rate формула `l = (s + (s+1)·p/n + 1)·h/j` | Семантически странная — rake дважды | Мы сохраняем `l` только в binary-ITM mode для PD-compat, primary использует alpha-calibration |
| P3 | Финиш внутри ITM — uniform, не skill-weighted | 1-е место = min-cash по вероятности; skill edge не виден | Power-law / stretched-exp / Plackett-Luce моделируют skill-градиент |
| P4 | RoR — Gaussian first-passage | Недооценивает risk of ruin на скошенном MTT-PMF | Empirical RoR по фактическим просадкам (главный метрик) + Gaussian RoR для compat |
| P5 | Нет re-entries | Cost / variance на всех re-entry турнирах неверны | Полноценное re-entry с `reentryRate` и `maxEntries` |
| P6 | Нет ICM | Final table payouts завышены (они pay-outs, не chip-equities) | ICM smoothing (Malmuth-Harville-like) |
| P7 | Нет bounties (KO / PKO / mystery) | Современные турниры — 30-60% bounty | Все три: flat, PKO (accumulating head), mystery σ² |
| P8 | Нет staking | Игрок с маркапом — не он сам | Sold%/markup на уровне строки |
| P9 | Нет variable field size / late reg | Вечерние турниры растут на 50-100%, PD берёт одно число | `fieldVariability` + `lateRegMultiplier` |
| P10 | `Math.random()`, seed не управляется | Два запуска на одних настройках дают разные числа | `seed` в UI, детерминированность по seed + shard-независимость |
| P11 | Нет tilt / drift / shock | Человеческий фактор не моделируется | Tilt fast/slow, drift AR(1), shock per-tourney / per-session |
| P12 | Нет custom PMF / empirical | Нельзя загрузить свою реальную гистограмму финишей | `finishModel: "empirical"` с bucket paste |
| P13 | SD считается по pmf, не перепроверяется MC | Нет способа увидеть MC-шум поверх аналитики | mcSeMean / mcCi95 / mcPrecisionScore |
| P14 | Нет decomposition / sensitivity / convergence | Игрок не понимает, какая строка тащит variance | Три отдельные chart'а |
| P15 | 32 hardcoded h[i] без документации | Игроку не понятно, какую таблицу ставить | Мы скрываем это под парой preset'ов + кастом |

---

## 4. Bottlenecks / Issues — мы сами

### 4.1. Численные проблемы движка

| # | Где | Что | Приоритет |
|---|-----|-----|-----------|
| E1 | `engine.ts:695` | skewness/kurtosis делят на `S`, не на `S−1` (population moments) | MEDIUM — может занижать хвост для скошенных распределений |
| E2 | `engine.ts:493` | `costFactor = 1 − sold × markup` может быть < 0 (если `sold·markup > 1`) | MEDIUM — непроверенный input, физически невозможное состояние |
| E3 | `engine.ts:1418` | Poisson Knuth обрывается на λ=20; можно λ<30 без штрафа | LOW — корректно, но тайтовая граница |
| E4 | `engine.ts:718` | log-growth clamp = `ln(1e−9) ≈ −20.7` — асимметричный | LOW — обоснован, но порог магический |
| E5 | `engine.ts:870` | ENV subsample — stride-based, не uniform random | LOW — small bias on extreme percentiles |
| E6 | `engine.ts:262` / `finishModel.ts:259` | `cdf[last] = 1` маскирует drift накопления | INFO — защита работает, но скрывает баги PMF |
| E7 | `engine.ts:704` | `kellyFraction = 0` if `variance = 0` — должно быть `Infinity` или undefined | LOW — defensive, но неконвенциональное |
| E8 | `engine.ts:1038–1069` | convergence pre-alloc: если `S < 80` — arrays фиксированные, иначе динамический `idxConv` | INFO — safe, но лучше аудитнуть |
| E9 | `engine.ts:760` | `tournamentsFor95ROI` — эвристика без честного CLT account | MEDIUM — может вводить в заблуждение на маленьком N |
| E10 | нет | Нет validated-input слоя: `rake > 1`, `players < 1`, `markup < 1`, `sold > 1` — всё падает в движок | MEDIUM — добавить guard в compile или zod schema |
| E11 | нет | Нет аналитической per-tourney σ рядом с эмпирической в результатах | LOW — хорошо для self-check и sanity |

### 4.2. Проблемы UI / widget'ов (см. раздел 8 — подробный проход)

### 4.3. Проблемы рабочего процесса / calibration

- **`mtt-primedope` shape-locked на `h[8]`** — работает для N∈[50, 200], на 500+ игроков PD использует h[15]/h[20]/h[25]+ с другими формами. Наш sweep показал −23% при N=500, −46% при N=1000. Нужен **field-bucket → h[i] mapping** чтобы compare-колонка работала честно на больших полях.
- **PD ignore rake в cost** — `primedopeStyleEV = true` в compare это учитывает, но нужно убедиться, что компенсация работает и для bounty-турниров, и для re-entry (сейчас просто compile-time флаг, проверить вручную).
- **RoR gap**: даже после Code A (h[8]) наш эмпирический RoR всё ещё ~12-15% выше PD-шного, потому что хвост реальных просадок тяжелее Gaussian. Gaussian-RoR метрику мы добавили (Code B), но в verdict'е всё ещё показываем только empirical — надо посмотреть, хочет ли игрок видеть обе.

---

## 5. Тесты: проверить, что мы ПРАВИЛЬНО понимаем PrimeDope

Цель: байтово или численно воспроизвести reference-кейс и несколько вариантов.

### 5.1. Reference case (100p / $50 / 11% rake / 10% ROI / 1000 tourneys)

- **T-PD-1** ✅ sigma match: наш `mtt-primedope` + `primedopeStyleEV` + binary-ITM должен дать σ ∈ [$5607, $5789] на 5k+ samples. **Уже проходит** (результат $5674, seed-scatter ±$4).
- **T-PD-2** ⬜ EV match: mean ROI должен быть $5000 (не $5550), подтверждая, что rake игнорируется в cost-basis. Добавить expect в `engine.test.ts` для этого.
- **T-PD-3** ⬜ RoR match: Gaussian RoR от нашего движка должен дать B(5%) ≈ $6301, B(1%) ≈ $9243. Это проверка, что Brownian first-passage реализован bit-for-bit как PD.

### 5.2. Sweep по field sizes

- **T-PD-4** ⬜ `scripts/sd_experiments.ts::sweepFieldSizes` уже есть — проходит на N∈[50, 200], разваливается на N≥500. Решить: (a) пометить как known limitation и документировать, (b) добавить `mtt-primedope-large` с подбором ближайшего h[i], или (c) написать динамический селектор `h[i] = pick_by_field_size(N)`. Рекомендация: **(c)**, см. раздел 7.

### 5.3. Tables dump

- **T-PD-5** ⬜ `scripts/dump_pd_tables.ts` — парсит все 32 h[i] из `tmp_legacy.js`, печатает paid count и кривую. Уже есть. Прогнать, добавить snapshot test, чтобы если мы обновим `tmp_legacy.js` с новой версии PD — старая таблица h[8] не изменилась незаметно.

### 5.4. Поведенческие проверки PD-формул

- **T-PD-6** ⬜ Воспроизвести ITM-rate PD. Hardcode: `l = (0.10 + 1.10·0.11 + 1)·0.15` = 0.18315. Наш движок в `primedopeStyleEV` mode должен печатать тот же `l` в `CompiledEntry.itm`. Если нет — наша calibration в binary-ITM mode рассинхрона с PD.
- **T-PD-7** ⬜ Верифицировать EV формулу на нестандартных кейсах: `(n + p) × s` для n=$100, p=$9, s=0.15 → EV = $16.35 на турнир. Должно совпасть с нашим primary, если `primedopeStyleEV = true`.
- **T-PD-8** ⬜ Воспроизвести `Hastings Φ` (q-функция PD). Сейчас используется в нашем Gaussian RoR через `normalCdf` в `engine.ts`. Добавить unit test: Φ(0) = 0.5, Φ(1.96) ≈ 0.975, Φ(−2.5758) ≈ 0.005 — с точностью ±1e−4. Это bit-level валидация.
- **T-PD-9** ⬜ Воспроизвести Beasley-Springer-Moro Φ⁻¹: Φ⁻¹(0.025) ≈ −1.96, Φ⁻¹(0.005) ≈ −2.5758. PD использует его в RoR inversion; у нас пока бисекция. Если реализуем BSM напрямую — можно проверить bit-for-bit.

### 5.5. Live-site regression (manual)

- **T-PD-10** ⬜ На сайте PD забить 5 разных сценариев (100p/10%, 500p/5%, 2000p/0%, 100p/−10%, 200p + 11% rake) и записать их EV/SD/RoR. Затем прогнать наш движок в `primedope-compat` mode и сверить. Всё, что расходится более чем на 2% (SD) или $50 (RoR) — повод разбираться.

---

## 6. Тесты: проверить, что наш движок работает ПРАВИЛЬНО

Цель: доказать, что движок верно реализует заявленную модель — независимо от PD.

### 6.1. Аналитические sanity-тесты

- **T-US-1** ⬜ Uniform finish, zero rake, zero ROI → mean → 0, σ per tourney → closed-form `√(Σpmf·x² − (Σpmf·x)²)`. Уже есть? Проверить.
- **T-US-2** ⬜ Hand-calc analytical σ на `mtt-primedope` @ 100p → наш движок должен эмпирически сойтись к нему с точностью `σ_analytic / √(2·S)`. Вместе с sim SD это даёт **двухуровневую проверку** (формула + код).
- **T-US-3** ⬜ Single tournament `count=1`, `scheduleRepeats=1` — все stats должны совпасть с аналитической PMF. `mean = E[prize] − cost`, `σ² = E[prize²] − (E[prize])²`, itmRate = exact.
- **T-US-4** ⬜ EV-preservation для sit-through-pay-jumps с разной `q` → mean ROI не должно дрейфовать (уже есть тест, добавить grid: q ∈ {0.1, 0.3, 0.5, 0.7, 0.9}, проверить, что |δmean| < 3·SE везде).
- **T-US-5** ⬜ EV-preservation для mystery bounty σ² ∈ {0.1, 0.5, 1, 2, 3} → mean сохраняется, σ растёт (есть тест, расширить grid).
- **T-US-6** ⬜ Decomposition check: `Σ rows.meanContribution = total.mean` (с точностью 1e−9). Уже должно работать, но явного теста нет.
- **T-US-7** ⬜ Variance share check: `Σ rows.varianceShare = 1.0` (с точностью 1e−9).

### 6.2. Statistical consistency

- **T-US-8** ⬜ Central-limit check на простом uniform-N: mean ± stdDev/√S должен содержать true mean в 68% случаев (run 200 seeds × 1k samples, measure coverage).
- **T-US-9** ⬜ Shard-invariance: run same seed с 1, 2, 4, 8 workers → все статистики bit-identical. Возможно уже есть, но должно быть в `engine.test.ts`.
- **T-US-10** ⬜ Bounty preservation: `bountyFraction = 0.5`, run vs `0` → mean должен быть тот же, σ разная.
- **T-US-11** ⬜ Re-entry cost: `maxEntries = 3`, `reentryRate = 1.0` → cost должен быть `(1 + reentryExpected) × cost_single`. Hand-calc expected × checks empirical cost.
- **T-US-12** ⬜ Staking PnL: `sold = 0.5`, `markup = 1` → mean и stdDev должны быть точно 0.5× от baseline. С `markup = 1.2` → mean должен сдвинуться на `+0.2 × 0.5 × cost` (игрок зарабатывает на маркапе).
- **T-US-13** ⬜ ICM smoothing: Gini coefficient выплат должен уменьшиться после ICM. Easy regression.
- **T-US-14** ⬜ Field variability: при `fieldVariability = {min: 90, max: 110, buckets: 5}` mean по schedule'у должен совпадать с average по всем variant'ам.

### 6.3. Численная стабильность

- **T-US-15** ⬜ High-N stress: N=10000 турниров, S=1000 samples → не должно быть NaN, Infinity, ruin-without-bankroll flag.
- **T-US-16** ⬜ Tiny field: N=2 (heads-up) → PMF сходится (paid=1, winner takes all), σ считается.
- **T-US-17** ⬜ Huge field: N=50000 → `buildFinishPMF` не должен падать по памяти, CDF binary search работает.
- **T-US-18** ⬜ Zero ROI, zero rake → `mean ≈ 0`, `σ > 0` (pure variance), `ruinProb(0.5 × pool)` > 0.
- **T-US-19** ⬜ Extreme skew: `bountyFraction = 0.9, progressiveKO = true` → decomposition per row должна давать >0 variance share на bounty row.

### 6.4. RoR честность

- **T-US-20** ⬜ Известное закрытое решение: **random walk с `μ = 0, σ = 1, B = 10`, N = 100** → empirical ruin prob должен сойтись к аналитическому Brownian first-passage в пределах MC-шума. Это калибровка RoR-кода.
- **T-US-21** ⬜ `μ > 0`: empirical RoR должен быть **выше** Gaussian RoR (потому что реальное pmf тяжелохвостое) ИЛИ сопоставимый (для чисто Gaussian входа). Проверить направление.
- **T-US-22** ⬜ RoR monotonicity: больше bankroll → меньше RoR на тех же settings. Regression.

### 6.5. Convergence / MC precision

- **T-US-23** ⬜ `mcSamplesFor1Pct` должен быть **консервативным**: если мы реально прогоним S = `mcSamplesFor1Pct`, то mcRoiErrorPct ≤ 0.01. Проверить на reference кейсе.
- **T-US-24** ⬜ Convergence chart monotonicity: SE должно падать как `1/√n` на convergence curve. Простая визуальная регрессия.

### 6.6. E2E / smoke

- **T-US-25** ⬜ `scripts/smoke.ts` — перезапускается и не падает ни на одной из presets.
- **T-US-26** ⬜ Playwright smoke UI test: открыть страницу, запустить sim с default settings, дождаться результата, проверить, что все карточки отрендерились без NaN/Infinity/undefined в DOM.

---

## 7. Варианты улучшений — движок

### 7.1. Критические (делаем в этот проход)

- **A1. Fix population skewness/kurtosis → sample moments** (`engine.ts:695`). Divide by `(S−1)`, bias-correct per standard formulas. Expected effect: +5-15% на reported skew для скошенного MTT. Тесты — add 1 regression.
- **A2. Validate TournamentRow inputs at compile time**: `0 ≤ sold ≤ 1`, `markup ≥ 1`, `0 ≤ rake ≤ 1`, `players ≥ 1`, `0 ≤ bountyFraction ≤ 1`, `0 ≤ payJumpAggression ≤ 1`. Throw с понятным сообщением. Preveвращает `costFactor < 0`.
- **A3. Analytical per-tourney σ как отдельная метрика** рядом с empirical. Дёшево — считается в compile-time. Служит self-check и помогает пользователю понять «σ из pmf» vs «σ из MC». Показываем в Settings Dump и Verdict.
- **A4. Field-bucket → h[i] selector для `mtt-primedope-large`**. Parse all 32 h[i] один раз (уже есть в `dump_pd_tables.ts`), построить lookup `N → best_h[i]` по paid-count range. Compare-колонка начнёт честно работать для N ≥ 500.
- **A5. Gaussian RoR в verdict card**: если пользователь задал `bankroll` и `riskOfRuin > 0.05`, показывать красный callout с обеими цифрами (empirical и Gaussian) и объяснением разницы.

### 7.2. Приятные (по времени)

- **B1. ES (expected shortfall) / CVaR в verdict-card** (сейчас в MiniStat, но не озвучен). «В 5% худших сценариев игрок теряет $X за период».
- **B2. Auto-detect shard count**: `navigator.hardwareConcurrency` уже используется, но сделать live UI-отображение «used 4 of 8 cores».
- **B3. Antithetic variates** в hot-loop (опциональный флаг): каждый второй sample — зеркально по главному RNG. Снижает MC variance на ~2× для mean. Риск: усложнение shard-determinism.
- **B4. Stratified sampling по финиш-месту**: вместо uniform inside ITM bin — stratify, чтобы каждое место было sampled чаще. Снижает variance on-σ.
- **B5. Validation of pmf integrity at compile**: `|Σpmf − 1| < 1e−9`, `pmf[i] ≥ 0 ∀ i`. Throw если нарушено.
- **B6. Convergence chart с true-mean reference line** (сейчас есть только SE bands). Нужно tolerance-tight mean, т. е. re-run на 10× samples или брать аналитический targeted mean.
- **B7. Sensitivity chart: multi-parameter scan** вместо одного δROI. Grid over (ROI ± 5pp) × (rake ± 2pp) → heatmap EV.

### 7.3. Дорогие (обсудить, возможно отложить)

- **C1. Skill-weighted finish inside ITM**: вместо uniform внутри paid — explicit per-place PMF, где вероятность 1-го места > min-cash в пропорции к ROI-δ. Это **настоящий** skill-lift, который PD не делает.
- **C2. Quasi-Monte Carlo (Sobol sequences)** вместо pseudo-random. Вариация должна падать как `(log N)^d / N` вместо `1/√N`. Сложность — shard-determinism и mapping sample index → Sobol point.
- **C3. Variance reduction через control variates**: use analytical mean as control, subtract from empirical. Может дать 5-10× снижение MC variance на mean.
- **C4. Multilevel MC** для convergence chart — разные уровни accuracy vs cost.
- **C5. Parameter learning**: загрузить CSV реальных финишей, auto-fit `finishModel` (e.g. power-law alpha). Интересный следующий шаг, но отдельная большая работа — см. план real-data calibration.

---

## 8. Проход по виджетам — каждый нынешний, что добавить

> Формат: **[файл:строка] Виджет** — что не так / что добавить.

### 8.1. Controls Panel (`ControlsPanel.tsx`)

1. **[114–121] Schedule repeats** — rename label на `"Schedule repetitions per sample"`, добавить calculated total `"= {N} турниров на sample"`, hint «больше → глаже RoR, медленнее».
2. **[122–128] Samples input** — **badge «≈ {runtime} ms / run»** с последнего прогона; **live convergence hint**: для текущих settings показать `mcSamplesFor1Pct` из предыдущего run → «нужно ≥ {N} для CI ±1%»; color-code: <1k red, 1k-10k yellow, >10k green.
3. **[145–151] Bankroll input** — **quick-set кнопки** «1 buy-in», «5 buy-ins», «100 buy-ins», «auto (Kelly)»; показывать «RoR будет ниже → запусти».
4. **[166–182] PrimeDope compare checkbox** — ок, оставить как есть. Единственное — добавить badge «uses h[8] for N ≤ 200, h[15]+ for larger» (после A4).
5. **[203–215] Alpha override** — label с `"Power-law shape α"`, показать «auto α = {value}» next to input после run, warn если |α| > 3.
6. **[216–224] ROI std err** — preset buttons `"Confident (1%)"`, `"Some uncertainty (5%)"`, `"High uncertainty (10%)"`, `"Off (0)"`.
7. **[228–253] Shock & drift** — collapse в `"Variance model"` accordion; каждое поле → tooltip `"shock per tourney: мелкие вариации; shock per session: настроение; drift: skill меняется со временем"`; показать маленький preview-chart expected trajectory.
8. **[256–301] Tilt controls** — **разделить на 2 card'а**: «Fast tilt» (gain, scale) и «Slow tilt» (gain, threshold, min duration, recovery); presets `"Off"`, `"Mild"`, `"Severe"`; сводный output `"Estimated EV loss from tilt ≈ ${x} per 1000 tourneys"`.
9. **[304–361] Empirical buckets paste** — после paste **показать histogram preview** (`FinishPMFPreview` reuse); пример файла download button; error message с lineи refs.
10. **seed** — сейчас скрыт; вынести в `"Advanced"` accordion с кнопками `"Lock"` / `"Randomize"`.

### 8.2. Schedule Editor (`ScheduleEditor.tsx`)

11. **[197–470] Row table** — добавить **Expected profit column** (= `buyIn × ROI × count`), **color-coded ROI** (red <0, yellow 0-10, green 10-30, blue >30), **warning icon** если `bountyFraction > 0` но `mysteryBountyVariance = 0`.
12. **[525–593] Field variability** — показать **preview**: «N будет равномерно в [{min}, {max}] с {buckets} корзинами» + мини-histogram.
13. **[597–611] Late reg multiplier** — tooltip «×1.5 = к концу регистрации поле вырастет на 50%».
14. **[614–637] Custom payouts** — после paste показать **stacked bar** отображая кривую + sum check.
15. **[693–723] ICM final table** — warning если `size > 9`; tooltip: «Malmuth-Harville smoothing».
16. **[725–753] Staking** — **показать net cost after staking**: `"You pay {$X}, cash in {$Y}"`; show «effective ROI» после маркапа.
17. **[756–788] Sit-through-pay-jumps** — rename checkbox label с `"on"` на `"Play through bubble"` (или `"Не мин-кэшуем"`), slider label `"Aggression {N}% — 0 = всегда фолд, 100 = ни разу не сдаём"`, tooltip про EV-preservation.
18. **[791–811] Mystery bounty σ²** — rename label на `"Bounty unpredictability (σ²)"` + tooltip; **presets** `"Fixed"` (0), `"Normal MB"` (0.5), `"Wild MB"` (2); show example `"σ²=1 → ±30% разброс одного bounty"`.

### 8.3. Results View (`ResultsView.tsx`)

19. **[661–699] BigStat Cards** — tooltip объясняющий «SE = Standard Error»; **RoR card грязно-серый если bankroll=0** (не «bankroll off», а просто «—» с hint); **ITM rate card** — добавить baseline `"(table pays {X}%)"` рядом с нашим числом.
20. **[701–868] MiniStat grid** — **re-organize**: секции `"Profitability"`, `"Risk"`, `"Advanced"`, последняя collapsed by default; **glossary popup** на каждый stat; rename `tFor95` → `"Turneys to ±5pp CI"`; rename `maxDrawdownBuyIns` → `"Max DD (in buy-ins)"`; fix Sortino negative display logic.
21. **[870–895] Distribution chart** — mean / median / mode lines в chart, tooltip с bin count + pct.
22. **[896–921] Drawdown histogram** — color gradient green→red; **P95/P99 dashed lines**; tooltip `"$X max DD, {Y}% bankroll"`.
23. **[923–935] Convergence chart** — **dashed reference line `"True EV"`** (= aggregate mean); tooltip `"at N={x}, estimated EV = {y} ± ${se}"`; annotation `"At {N} tourneys, CI ±{x}% of ROI"`.
24. **[937–950] Sensitivity chart** — **подписать ось X** («δ ROI in pp», или dynamically) — **КРИТИЧНО**, сейчас непонятно, что там меняется; tooltip; slope output `"каждый +1pp ROI ≈ +${X}"`.
25. **[952–959] Decomposition chart** — tooltip на variance share `"эта строка даёт {X}% общей дисперсии"`; sort rows by EV descending; color error bars (green > 0, red < 0); Kelly section с объяснением.
26. **[961–1006] Downswings table** — header `"Top 10 of {N} downswings"`; rename `"Final profit"` → `"$ at bottom"`; добавить `"Recovery time"` column; inline sparkline per row.
27. **[1049–1193] PrimedopeReportCard** — dense data dump сейчас; **добавить section toggles** (EV | CIs | RoR); **color code rows** (green = advantage, red = disadvantage); hover tooltip per metric; переформулировать `"RoR 50%"` → `"Bankroll for 50% ruin risk"`; Gaussian vs empirical RoR — side-by-side explanation.
28. **[1195–1265] Settings dump card** — добавить **«Copy to clipboard»** кнопку (reproducibility); сгруппировать по подсекциям; скрыть под `"Advanced"` accordion.
29. **[1492–1664] VerdictCard** — **упростить precision line** (3 плайн-язычных bucket без «95% CI = $X, rel {Y}%»); **добавить RoR warning callout** если `ruinProb > 0.05`; **добавить ES/CVaR callout** `"В 5% худших — теряешь ${X}"`; упоминание per-row «самый прибыльный row: {X}, самый рискованный: {Y}» (из decomposition).
30. **[1744–1882] PDVerdict** — добавить **comparison method table**: `"our method: power-law + real drawdown"` vs `"PD: uniform-ITM + Gaussian"`; link к методической заметке.
31. **[1884–2037] PDDiffTable** — add `"↑ we win"` / `"↓ they win"` icons; hide rows with |delta| < 1%; top-row summary `"We're {N}% {better/worse} on average"`.
32. **[112–229] TrajectoryPlot** — **visible legend toggle**; color-code bankroll line (green/yellow/red); on-load tooltip onboarding; ROI reference slopes labeled в chart.

---

## 9. План работ (по шагам)

> Каждый шаг — self-contained, после каждого тесты + typecheck + отметка в review_dossier.

### Шаг 1 — быстрая гигиена движка (≈ 30 мин)

- A1. Sample skewness/kurtosis (`engine.ts:695`).
- A2. Input validation layer (compile-time throws).
- E11/A3. Analytical per-tourney σ → expose in stats.
- Регрессия тестов.

**Exit criteria**: все текущие тесты зелёные, 1-2 новых добавлены (T-US-7, bias correction snapshot).

### Шаг 2 — тестовая полка для PD-понимания (≈ 45 мин)

- T-PD-2 (EV match assert).
- T-PD-3 (Gaussian RoR bit-match).
- T-PD-6 (ITM-rate formula print/assert).
- T-PD-8 (Hastings Φ unit test с известными значениями).

**Exit**: все 5 PD-тестов в `engine.test.ts`, все зелёные.

### Шаг 3 — тестовая полка для наших инвариантов (≈ 45 мин)

- T-US-2 (analytical σ match on mtt-primedope).
- T-US-6 + T-US-7 (decomposition sum invariants).
- T-US-9 (shard invariance).
- T-US-12 (staking linearity).
- T-US-20 (random-walk RoR closed-form check).

**Exit**: +5 тестов, все зелёные.

### Шаг 4 — field-size → h[i] селектор (≈ 60 мин)

- A4. Parse 32 h[i] → build `PRIMEDOPE_TABLES` с `paidCount` полем.
- Selector `pickH(N) = argmin |paid(h[i]) / N − 0.15|` (or user-tunable paid-fraction).
- Update `primedopeTable()` в `payouts.ts` → switch on N.
- Sweep test (T-PD-4) должен пройти на N ∈ {50, 100, 200, 500, 1000, 2000, 5000, 10000}.

**Exit**: sweep показывает ≤5% gap на всех N.

### Шаг 5 — UI widget полировка, приоритет 1 (≈ 90 мин)

Ранжированные по ROI:

- (24) Sensitivity chart X-axis label + tooltip.
- (18) Mystery σ² tooltip + presets.
- (2) Samples convergence badge.
- (29) Verdict precision упрощение + RoR callout.
- (27) PrimedopeReport section toggles.
- (17) Sit-through label rename.

**Exit**: typecheck зелёный, glanceable UI review.

### Шаг 6 — UI widget полировка, приоритет 2 (≈ 90 мин)

- (25) Decomposition sorting + tooltips.
- (26) Downswings clarification + sparklines.
- (23) Convergence true-EV line.
- (20) MiniStat reorganize.
- (3) Bankroll quick-set buttons.

**Exit**: ещё один UI review.

### Шаг 7 — live PD sweep (manual) (≈ 30 мин)

- T-PD-10. 5 сценариев на сайте PD, записать результаты в `notes/primedope_live_checks.md`, прогнать у нас в `primedope-compat` mode, диффы зафиксировать.

### Шаг 8 — cleanup + commit (≈ 20 мин)

- Обновить `notes/primedope_sd_theories.md` секцией "Result 6 — post-dossier pass".
- Единый commit или series of commits.
- Запуск всех тестов + typecheck финальный.

**Total estimate**: ~6 часов сосредоточенной работы. Можно порвать на 2 сессии.

---

## 10. Open questions

- **Q1**. Оставляем ли `mtt-primedope` shape-locked на `h[8]` рядом с новым `mtt-primedope-large` селектором? Или заменяем целиком?
- **Q2**. Population vs sample skewness — fix «тихо» или добавить feature flag `legacyMoments: true` для старых снимков?
- **Q3**. Input validation — throw (жёсткий) или warning (мягкий с silent clamp)? Предпочтительный вариант: throw в compile, чтобы UI мог показывать «поле X невалидно».
- **Q4**. Gaussian RoR в verdict card — показывать **всегда** (даже когда совпадает с empirical) или только при расхождении ≥10%?
- **Q5**. Sensitivity chart — оставить одноpar (δROI) или сделать multi-parameter heatmap? Второе дороже, но мощнее.
- **Q6**. Tilt controls — отдельная accordion или вообще скрыть за «advanced»? Сейчас они выглядят overwhelming.
- **Q7**. RoR callout в verdict: показывать обе цифры (empirical + Gaussian) или только «честную» empirical? Предпочтительный вариант: обе с коротким объяснением — для PD-юзера это знаково.
- **Q8**. Do we want a per-tournament “analytical EV dial” sidebar (see A3)? Полезно для sanity-check, но занимает место.

---

## 11. Что точно НЕ делаем в этот проход

- Cloud sync для presets (в TODO, отложено до v2).
- Real-data calibration из user CSV (пока нет данных, план отдельно).
- Multi-parameter Sensitivity heatmap (C1).
- QMC / Sobol (C2).
- Control variates (C3).
- Multilevel MC (C4).
- UI translation в полный Russian (частично уже сделано; добавим точечно).

---

*Документ собран агентами Explore (тройной проход) + ручная проверка notes/. Готов к walkthrough.*
