# tournament-variance-sim

Monte Carlo симулятор дисперсии для покерных MTT. Аналог [PrimeDope Tournament Variance Calculator](https://www.primedope.com/tournament-variance-calculator/), написан с нуля с упором на честность модели.

*EN version below ↓*

---

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
- **Field variability** — per-sample ресэмплинг размера поля вместо compile-time сглаживания (реальная дисперсия от неизвестного поля).
- **Empirical finish model** — можно скормить свой гистограмм finish-places вместо параметрической модели.
- **Compare mode** — тумблер «посчитать как PrimeDope» прогоняет обе калибровки на том же сиде, рисует две колонки результатов + диф-строку.

Movie: всё это без потери детерминированности (seeded `mulberry32 + mixSeed`) — тот же seed всегда даёт тот же результат.

## Стек

- Next.js 16 + React 19 + TypeScript
- Web Worker — MC-движок не блокирует UI
- uPlot — графики
- Tailwind 4
- Vitest — 69 тестов на движке (determinism, realized-ROI-in-SE, row decomposition sums, re-entry variance amplification, ICM flattening, empirical histogram reproduction и т.д.)

## Запуск

```bash
npm install
npm run dev
```

http://localhost:3000

```bash
npm test          # vitest
npx tsc --noEmit  # type check
npm run lint      # eslint
```

## Roadmap

- [x] Фаза 1 — математика: ITM как output, реальные payout-таблицы, PrimeDope-compat калибровка
- [x] Фаза 2 — compare-режим в UI
- [x] Фаза 3 — i18n (RU+EN), демо-сценарии, tooltips
- [ ] Фаза 4 — Vercel deploy
- [ ] Калибровка α на реальных данных (фонд на 1.5k игроков, валидация покрытия MC 90%-envelope на фактических P&L)

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

All deterministic — seeded `mulberry32 + mixSeed`, same seed always reproduces.

## Stack

Next.js 16, React 19, TypeScript, Web Worker engine, uPlot, Tailwind 4, Vitest (69 engine tests).

## Run

```bash
npm install
npm run dev
# http://localhost:3000
```
