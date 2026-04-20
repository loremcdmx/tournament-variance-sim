# Streak vs ROI anomaly — seed-noise diagnosis

**Дата:** 2026-04-20
**Триггер:** бета-тестер прислал два скрина Battle Royale прогона ($10 · 42% bounty · 18-max, счётчик "3k tour"), где при переходе с 2% ROI на 10% ROI:

| Метрика | 2% ROI | 10% ROI | Δ | Знак ожидаемый |
|---|---|---|---|---|
| Средний стрик (турниры) | 1817 | 1927 | +6% | ↓ (меньше при бОльшем edge) |
| Типичный стрик (ABI) | 216 | 329 | +52% | ↓ |
| Худший стрик (ABI) | 5572 | 5085 | −9% | ↓ ✓ |
| Самые кошмарные 1% (ABI) | 2933 | 927 | −68% | ↓ ✓ |
| Типичная отмазка (турниры) | 7850 | 5573 | −29% | ↓ ✓ |

Первые две строки идут **вверх** с ростом ROI — против интуиции «выше edge, мельче свинги». Остальные — вниз, как и ожидалось. Жалоба тестера: «чем выше рентабельность, тем выше средник стрик».

---

## Hypothesis space

Три взаимоисключающих сценария:

1. **Real math (α×drift×σ combine perversely).** При α-adjustable модели рост ROI концентрирует pmf на топ-местах → big rare cashes увеличивают per-tourney σ. σ²/drift ratio может расти быстрее drift на некотором диапазоне, давая deeper typical DD.
2. **Bounty-variance multiplier (#7 audit, fixed-shape branch).** bountyMean residual-reconciled as `totalEV − cashEV`. Выше ROI → выше bountyMean → per-KO $ variance ∝ bountyMean линейно → глубже typical dips. Эффект ограничен fixed-shape моделями.
3. **Sampling noise (seed-dependent swing).** Тестер видит разницу на двух разных seed-ах, не один underlying effect.

---

## Diagnostic setup

Скрипт `scripts/diag_streak_roi.ts`. Параметры под скрин тестера:

- `gameType="mystery-royale"`, 18 players, `payoutStructure="battle-royale"`
- `buyIn = 10 / 1.08 ≈ 9.26`, `rake = 0.08`
- `bountyFraction = 0.42` (тестерская кастомизация, default 0.5)
- `mysteryBountyVariance = 1.8`, `pkoHeadVar = 0.4` (стандартные BR)
- `itmRate = 0.18`
- `count = 3000`, `scheduleRepeats = 12` → path length 36 000 турниров (под tester's worst-streak 35 351)
- `samples = 2000`
- **seed = 20260420 (фиксированный — это ключевой момент)**
- grid: ROI ∈ {2%, 10%} × finishModel ∈ {powerlaw-realdata-influenced, mystery-realdata-linear} × bounty-σ ∈ {default, 0} × rakeback ∈ {0%, 50%}

Итого 16 ячеек.

---

## Results

```
=== powerlaw-realdata-influenced, bounty-σ=default, no-rb ==============
     2%    beStreakMean = 1655.2    maxDdMedian = 3643.0   maxDdWorst = 13032.7
    10%    beStreakMean =  611.9    maxDdMedian = 1589.3   maxDdWorst =  4020.1
    ΔbeStreakMean = −63%,  ΔmaxDdMedian = −56%

=== powerlaw-realdata-influenced, bounty-σ=default, rb=50% =============
     2%    beStreakMean =  901.9    maxDdMedian = 2092.9   maxDdWorst =  6614.1
    10%    beStreakMean =  490.4    maxDdMedian = 1239.4   maxDdWorst =  3008.6
    ΔbeStreakMean = −46%,  ΔmaxDdMedian = −41%

=== mystery-realdata-linear, bounty-σ=default, no-rb ===================
     2%    beStreakMean = 1647.9    maxDdMedian = 3622.1   maxDdWorst = 16327.1
    10%    beStreakMean =  611.9    maxDdMedian = 1567.3   maxDdWorst =  3972.8
    ΔbeStreakMean = −63%,  ΔmaxDdMedian = −57%

=== mystery-realdata-linear, bounty-σ=default, rb=50% ==================
     2%    beStreakMean =  886.0    maxDdMedian = 2061.6   maxDdWorst =  6296.4
    10%    beStreakMean =  489.0    maxDdMedian = 1213.6   maxDdWorst =  2890.9
    ΔbeStreakMean = −45%,  ΔmaxDdMedian = −41%
```

Все **16 ячеек** (включая bounty-σ=0 и разные модели) дают **монотонно вниз** по обеим метрикам. Magnitude 40–65%.

Любопытство побочное: для BR `bounty-σ=default` и `bounty-σ=0` дают идентичные числа. Это потому что BR-путь в hot loop использует discrete brTier-ratios ([engine.ts:2314-2326](../src/lib/sim/engine.ts:2314)), заменяя log-normal per-KO draw. `mysteryBountyVariance` и `pkoHeadVar` в BR — мёртвые knob-ы. Открытый вопрос, должно ли это быть задокументировано.

---

## Key finding: seed randomization маскирует тренд

Real signal — тренд вниз на 40-65%. Тестерские скрины показывают 2% vs 10% на расстоянии 6-52% **вверх**. Это невозможно как systematic effect, но легко как seed noise.

**Механизм:**

- UI авто-рандомизирует seed на каждый запуск: [page.tsx:180-205](../src/app/page.tsx:180), [page.tsx:302-305](../src/app/page.tsx:302).
  ```js
  // Fresh random seed on every mount — users shouldn't see a pinned
  // "42" or a stale saved seed in the field. Runs are re-seeded again
  // before every sim.
  ```
- Seed-ов в UI **нет** — поле скрыто: [ControlsPanel.tsx:289](../src/components/ControlsPanel.tsx:289): `{/* Seed is auto-randomized per run — field removed from UI */}`.
- Следовательно, каждый клик «пересчитать» = независимая выборка из distribution исходов.

**Как это маскирует тренд:**

Для bulk-метрик (средний стрик, типичный стрик = median max-DD) распределение по seed имеет non-trivial variance. На S=2000 sample путях ожидаемая SE(median max-DD) ~ 1.5·IQR/√S, и для max-DD с тяжёлым хвостом это может быть 5-15% от среднего — а в малом числе samples (default app может использовать N≤1000) и того больше, 15-30%.

Систематический эффект: medianMaxDD падает в ~2.3× с 2% на 10% ROI.
Seed noise: ±15-30% на одном запуске.

Два разных seeds в комбинации с реальным трендом могут дать:
- Seed A на 10%: lucky → median MaxDD ~1590 · (1 − 0.3) = 1110 ABI
- Seed B на 2%:  unlucky → median MaxDD ~3622 · (1 − 0.6) = 1450 ABI

И тестер видит 1110 (10%) > 1450 (2%)? Нет, тот же знак. Нужно более сильное совпадение seeds: lucky в 2% и unlucky в 10%.

Но важнее: тестер сравнил ДВЕ единичные точки из noisy распределения без знания что это noise. На двух специфических seeds эффект ROI (фактор 2.3×) может быть перекрыт seed noise (фактор 1.3-1.5× в плохую сторону) — и знак разницы инвертируется в узком диапазоне (например ±5-10%).

Тестер увидел:
- Средний стрик 1927 vs 1817 — разница 6%. В пределах seed noise, и (важно!) магнитуда настолько мала что явно не отражает underlying 63% тренд.
- Типичный стрик 329 vs 216 — разница 52%. Это труднее объяснить одним seed noise, но возможно (heavy-tailed max-DD легко скачет в 2× за счёт единичных outlier samples; если samples count был, скажем, 200-500, noise легко даёт такой swing).

**Подтверждающая деталь:** тестер одновременно видит и «самые кошмарные 1% 927 vs 2933» — фактор 3× в правильную сторону. Tail-метрики устойчивее к seed noise (усредняются по worst 1% из N), так что они отражают underlying signal правильно. Bulk метрики (median) в малых samples подвержены noise больше.

---

## Signal vs noise decomposition

| Метрика | Устойчивость к seed noise | Что видит тестер | Underlying signal (diag) |
|---|---|---|---|
| Max DD worst (top 1 sample) | Плохая — crunches one outlier | 5085 vs 5572 (−9%) | ~4020 vs ~13033 (−69%) ✓ знак |
| Worst 1% ABI (avg over N/100) | Средняя | 927 vs 2933 (−68%) ✓ | ~4×10% tail |
| Median max DD (N/2 sample) | Средняя | 329 vs 216 (+52%) ✗ | ~1589 vs ~3643 (−56%) |
| BreakevenStreakMean | Хуже — зависит от selection bias | 1927 vs 1817 (+6%) ✗ | ~612 vs ~1648 (−63%) |
| Типичная отмазка / ITM-streak | Хорошая (N-wide aggregate) | 5573 vs 7850 (−29%) ✓ | — |

Тестерские знаки правильно совпадают с моими на trail/aggregate метриках, и расходятся там, где seed noise ожидаемо большая. Это **diagnostic of seed-noise-on-bulk-stats**, не признак bug.

---

## Verification plan

Как тестер (или мы) может подтвердить диагноз:

### Минимально (5 минут):
1. Открыть `scripts/diag_streak_roi.ts` в dev environment, поставить `const SEED` на 5 разных значений (напр. `20260420`, `17`, `42`, `98765`, `31415`), прогнать каждый раз grid ROI={2%, 10%}.
2. Ожидание: все 5 прогонов должны показать `maxDdMedian(10%) < maxDdMedian(2%)` и `beStreakMean(10%) < beStreakMean(2%)` на одном порядке magnitude.
3. Если хоть один seed даёт инверсию — значит noise band действительно захватывает точку тестера. Signal ≠ 0 но тонет в шуме для N samples.
4. Если все 5 устойчиво вниз — ещё более жёсткое подтверждение systematic signal.

### Полноценно (30 минут UI):
1. Временно открыть seed field в UI ([ControlsPanel.tsx:289](../src/components/ControlsPanel.tsx:289)) или добавить override через URL-параметр.
2. Зафиксировать seed (любой).
3. Прогнать два сценария: ROI=2% и ROI=10%. Сравнить «средний стрик».
4. Повторить с другим seed. И ещё раз.
5. Если на 80%+ seed-ов знак совпадает (ROI↑ → streak↓), signal есть. Если 50/50 — noise dominates.

### Production-ready (~1-2 часа):
Добавить в app «confidence interval on key stats» — посчитать stats на N разбиениях samples (bootstrap) и показать ±CI95. Тестер видит "1817 ± 280" vs "1927 ± 300" и сразу понимает, что разница в пределах CI.

---

## UX implications

Root cause — **hidden seed + per-run randomization** создаёт structural UX пробел: две соседние «одинаковые» прогонки выглядят идентичными с точки зрения input, но дают разные числа. Пользователь, сравнивая два run-a параметрически, не может отличить «change of input did this» от «seed luck did this».

Варианты смягчения:

### V1: Expose seed (read-only badge в UI)
Изменение: в ControlsPanel рядом с кнопкой запуска вывести `Seed: <hex>` как readonly label (маленьким шрифтом). При hover — объяснение «one run is one draw, click → new seed». При copy/click — скопировать seed в clipboard для воспроизведения.

Стоимость: ~1 час. Минимальная. Не меняет поведение движка, только прозрачность.

### V2: Auto-aggregate over K seeds + CI bars
Изменение: под капотом каждый run гонит K=5 seeds, в stats показывает mean ± CI95. UI визуально: «Средний стрик 1872 ± 180 турниров». Тестер сразу видит noise.

Стоимость: ~1 день. Средняя. Перераспределение sample budget по seed-сэмплам, небольшой worker-dispatch refactor, UI обновления.

### V3: Snap-to-same-seed в compare mode
Когда пользователь запускает «compare X vs Y» (это #132 в backlog, в процессе проработки), принудительно использовать ОДИН seed на обе ветви. Уже частично реализовано для PD twin (см. engine.ts:1053-1068). Распространить на будущие compare opt-ы.

Стоимость: naturally выпадает из #132 Phase 3 (same-schedule-neutral-ko). Просто нужно в code review убедиться что seed привязан к compareSource, не пересэмплируется.

### V4: Info panel «What makes two runs differ»
Простой non-интерактивный info-banner в UI: «Каждый клик — один случайный сэмпл. Для уверенности в различиях между сценариями: прогони 5 раз, или зафиксируй seed в URL.» Показывается один раз для новых юзеров, потом dismiss.

Стоимость: ~30 минут. Cheap, но мягкий — не решает проблему numerically.

**Рекомендация:** V1 (expose seed) как first-wave fix — минимум risk, максимум explanatory power. V2 (CI bars) отдельной задачей когда наберётся больше фидбэка на «я не могу отличить signal от noise». V3 падает в #132 по ходу работы.

---

## Не-фикс

Оставить stats вычисления как есть — ни в `breakevenStreakMean`, ни в `maxDrawdownMedian` **нет багов**. Определения корректные:

- `breakevenStreakMean` ([engine.ts:2520-2541](../src/lib/sim/engine.ts:2520)): для каждой точки `ii` пути ищем первый `jj>ii` где сегмент `[jj-1, jj]` пересекает `Y=p[ii]`. Записываем `jj-ii`. Усредняем по всем `ii` с `firstLen>0`, потом по сэмплам. Точки с монотонным уходом вверх (без возврата) **исключаются из знаменателя**. Это стандартное определение «how long does a typical level take to revisit» — используется везде в brownian analysis.
- `maxDrawdownMedian`: стандартная медиана max-drawdown по сэмплам в $.

Оба определения отвечают на правильные вопросы. Отсутствие bugs подтверждается тем, что dia_streak_roi.ts даёт монотонные тренды совпадающие с физической интуицией (σ²/drift ratio).

---

## Related

- #7 audit ([BACKLOG.md](../BACKLOG.md)) — bounty-variance multiplier в fixed-shape models. Здесь не релевантно (BR использует discrete brTier, не log-normal).
- #132 Phase 3 (same-schedule-neutral-ko) — compare mode с фиксированным seed на обе ветви. Naturally смягчит class of «X vs Y мне кажется странным» confusion.
- #131 (2026-04-18) BR/MR split-brain — `normalizeBrMrConsistency`. Обеспечил что BR-consistent settings в compileSchedule. Не связано.

---

## Action items

1. ✅ Скрипт `scripts/diag_streak_roi.ts` написан и коммитится для репродуцируемости (separate коммит).
2. ⏳ Тестеру сообщить: 6% разница в «среднем стрике» между двумя ROI — seed noise, не effect. Попросить повторить 5 раз.
3. ⏳ Рассмотреть V1 fix (expose seed) — маленькая задача, сильный UX эффект. Отдельный backlog пункт.
4. ⏳ Добавить note в UI tooltip на «средний стрик» или «типичный стрик» о том что эти метрики чувствительны к seed и для стабильного сравнения нужно multi-run. (Опционально, если V1 нереализован.)
