# Cut List — Variance Simulator под FF Старт

Решения по фичам в свете аватара (см. [USER.md](USER.md)).

**Принцип:** каждая фича оправдывается через «помогает ли одному из трёх уроков
кандидату ранга 15-16, single-visit». Если нет — `CUT` или `HIDE`.

Три вердикта:
- **CUT** — удалить из кода целиком (или выделить в admin-only ветку).
- **HIDE** — оставить в коде, но за `?admin=1` / dev-флагом. Невидимо
  дефолтному пользователю.
- **KEEP** — оставить в основном UI.
- **SIMPLIFY** — оставить, но сократить ручки/опции до уровня аватара.

---

## CUT — удалить из основного UI

Эти артефакты — для разработчика / опытного аналитика. В тренажёрном контексте
шумят и сбивают аватара. Кандидат не должен их видеть даже случайно.

| Фича | Файл / якорь | Причина |
|---|---|---|
| PrimeDope compare целиком | `ResultsView.tsx:824`, `:843`, `:2190`, `:2250`, `compareMode` | Сверка двух движков — задача разработчика, не урок про вариацию |
| `PrimedopeReportCard` | `ResultsView.tsx:2922` | Diagnostic dump, не для кандидата |
| `PrimedopeDiff` | `ResultsView.tsx:3486` | Diagnostic |
| `PdCompareToggles` | `ResultsView.tsx:3208` | Diagnostic |
| `CopyPdDiagButton` | `ResultsView.tsx:3328` | Уже за `advanced &&`, но advanced для кандидата вообще не нужен |
| `PrimedopeReproduceButton` | `ResultsView.tsx:3282` | Diagnostic |
| Line style customizer | `LineStyleCustomizer` (`ResultsView.tsx:2556`), `LineStylePresetPicker` (`:2497`) | Дизайн фиксирован, не настраивается |
| Ref line customizer | `RefLineCustomizer` (`ResultsView.tsx:2770`) | Пресет ref-линий зашит |
| Color picker | `DebouncedColorInput` (`ResultsView.tsx:3684`) | Дизайн фиксирован |
| User presets gallery | `tvs:user-presets` localStorage, `UserPreset` тип | Single-visit, сохранять некуда |
| Trim slider | `TrimPctSlider` (`ResultsView.tsx:2421`) | Шум для кандидата, технический хак |
| RunModeSlider | `RunModeSlider` (`ResultsView.tsx:2455`) | Технический параметр Monte Carlo |
| Four RB region toggles | `rbTraj/rbStats/rbDist/lbIncluded` (`ResultsView.tsx:253-288`) | Кандидат не управляет регионами RB — либо «с рейкбэком», либо «без», глобально |

---

## HIDE — за `?admin=1` / dev-флагом

Это нужно **тебе** (настройка тренажёра, дебаг конкретного случая, продвинутые
эксперименты), но **не** кандидату. Должно жить, но за флагом.

| Фича | Файл / якорь | Назначение |
|---|---|---|
| Empirical finish model + buckets | `controls.empiricalBuckets`, `finishModel = "empirical"` | Кастомная калибровка финишей |
| Tilt model (fast/slow gain) | `controls.tiltFast*`, `tiltSlow*` (`page.tsx:113-118`) | Исследовательский knob |
| ROI shock per tourney/session | `controls.roiShockPerTourney`, `roiShockPerSession`, `roiDriftSigma` | Исследовательский noise model |
| Compare mode целиком | `controls.compareEnabled`, `compareMode` | Развитие движка, не урок вариации |
| Alpha override | `controls.alphaOverride` | Тонкая настройка finish model |
| Mystery / BR exotic configs | `mysteryBountyVariance`, BR leaderboard advanced, `pkoHeat`, `pkoHeadVar` | Доп. форматы, не PKO mainstream |
| ItmTopHeavyBias / BountyEvBias sliders | `FinishPMFPreview.tsx` | Knob-уровень модели |
| Convergence band customizer | политика бандов | Для исследований |
| All current `advanced` controls | `useAdvancedMode` | По умолчанию OFF для кандидата |

**Механизм:** existing `AdvancedModeProvider` уже есть. Расширить: дефолт = OFF,
включается через `?admin=1` URL-параметр (и в localStorage для разработки).
Кандидат никогда не увидит advanced.

---

## SIMPLIFY — упростить, но оставить

Эти вещи нужны кандидату, но в текущем виде слишком сложны / избыточны.

### Schedule editor
- **Сейчас:** полноценный редактор строк, кол-во, баи, рейк, ITM%, gameType,
  bounty fraction, ...
- **Для аватара:** read-only пресет PKO ранга 15-16 + **две** ручки:
  - «Объём» (кол-во турниров за сессию: 50 / 100 / 250 / 500 / 1000)
  - «Твой ROI %» (-5..+15)
- Расширенный редактор — за admin.

### Rakeback
- **Сейчас:** один процент + четыре регион-тоггла на показ.
- **Для аватара:** один глобальный процент (или один toggle on/off, RB = 30%
  дефолт). Никаких регионов.

### Stat tiles
- **Сейчас:** 12+ тайлов (EV, ROI, ITM, POLE, RB, p95, p99, worst, BR LB, ...).
- **Для аватара:** 4-5 ключевых:
  - Ожидаемый профит / убыток
  - Вероятность остаться в плюсе
  - Типичный даунсвинг (p50 max drawdown)
  - Худший правдоподобный даунсвинг (p95 max drawdown)
  - (опционально) Сходимость: «нужно столько турниров чтоб ROI был достоверен»

### Charts
- **Сейчас:** trajectory + distribution + convergence + finish PMF preview +
  prove edge + downswings + money distribution + (другие)
- **Для аватара:** три ключевых, каждый связан с одним уроком:
  - **Trajectory fan** — урок 1 «вот сколько у тебя может быть просадка»
  - **Distribution** — урок 1 + 3 «вот разброс конечного результата»
  - **Convergence** — урок 2 «вот сколько турниров нужно чтобы ROI отделился от шума»

FinishPMFPreview, ProveEdgeCard, downswings card, money distribution —
переезжают за admin или удаляются если дублируют trio выше.

---

## KEEP — оставить как есть

- **Engine** ([engine.ts](../src/lib/sim/engine.ts)): детерминизм, math, hot loop. Не трогаем.
- **i18n EN/RU** ([dict.ts](../src/lib/i18n/dict.ts)): продолжаем расширять, тип-safe.
- **Базовый layout** ([page.tsx](../src/app/page.tsx)): требует упрощения, но архитектура жива.
- **PKO + Mystery + BR support в движке**: остаётся как код, но UI к BR/Mystery
  скрыт по дефолту (запускается только если пресет ранга это требует).

---

## ADD — для стадии 3 (не сейчас)

Эти не существуют, появятся в стадии «сигнатурная фича — три урока».
Здесь фиксируется намерение, не реализация.

| Фича | Назначение |
|---|---|
| Пресет «Ранг 15-16 PKO mix» | Дефолт по умолчанию, без ввода |
| Три lesson card (или story-flow) | Урок 1, 2, 3 — основа продукта |
| Финальная reflection-карточка | «вот что ты теперь знаешь» |
| Tooltips «что значит p95» простым языком | Каждое числовое значение |
| Mobile-friendly read-only layout | Single-visit на телефоне работает |

---

## Что это даёт

- **ResultsView.tsx** ужмётся с 3 738 строк до ~1 200-1 500 за счёт CUT/HIDE.
- **ControlsPanel.tsx** — с 885 до ~200-300.
- **page.tsx Home** — с 1 598 до ~600-800.
- **dict.ts** прибирается на тех ключах, которые относятся к CUT-фичам.
- **Cognitive load** дефолтного экрана падает с «12+ контролов + 5+ чартов» до
  «2 контрола + 3 чарта + 3 lesson card».

## Что НЕ делается этим списком

- Не удаляется ничего из движка (`src/lib/sim/`). Только UI.
- Не меняется детерминизм / типы / public API ниже UI.
- Не делается миграция данных (некуда мигрировать — saved-state CUT).
- Не делается i18n уборка removed-ключей (это отдельный PR в конце).

## Резолюции (зафиксированы на старте Стадии 1)

- **Пресет «Ранг 15-16 PKO mix»**: $1/$2/$3 PKO, по 100 турниров каждого
  (всего 300 турниров, аби ≈ $2.20). Финализируется в Стадии 3, сейчас
  placeholder.
- **Default rakeback**: 20% — конcервативный для ранга 15-16.
- **Admin-доступ**: `?admin=1` URL-параметр. Без localStorage persistence —
  не «прилипает» после ухода с URL.
- **Кандидат меняет ROI и объём**: числовые поля + Tab/Enter запускает run.
  Без слайдеров (избегаем «крутилок» которые превращают тренажёр в игрушку).
