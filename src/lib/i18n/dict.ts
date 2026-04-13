export type Locale = "en" | "ru";

export const LOCALES: Locale[] = ["en", "ru"];

// Flat dict — deep keys are `group.key`. Value per locale.
type Entry = Record<Locale, string>;

export const DICT = {
  // Header
  "app.kicker": {
    en: "Monte Carlo · Tournament Poker",
    ru: "Монте-Карло · Турнирный Покер",
  },
  "app.title": {
    en: "Variance Simulator",
    ru: "Симулятор Дисперсии",
  },
  "app.subtitle": {
    en: "Simulate your MTT / SNG schedule across thousands of parallel futures. Pluggable finish-place model, per-row variance decomposition, drawdown analytics, and compare slots — all running off-main-thread in a Web Worker.",
    ru: "Прогоняй своё расписание МТТ / СНГ через тысячи параллельных реальностей. Подключаемая модель мест, декомпозиция дисперсии по строкам, аналитика даунсвингов и слоты сравнения — всё в Web Worker-е, без блокировки UI.",
  },
  "app.shareLink": { en: "Share link", ru: "Поделиться" },
  "app.copied": { en: "copied ✓", ru: "скопировано ✓" },
  "app.linkReady": { en: "link ready", ru: "ссылка готова" },
  "app.exportCSV": { en: "Export CSV", ru: "Экспорт CSV" },
  "app.runHint": { en: "Cmd / Ctrl + Enter to run", ru: "Cmd / Ctrl + Enter для старта" },
  "app.tournaments": { en: "tournaments / sample", ru: "турниров / сэмпл" },
  "app.samples": { en: "samples", ru: "сэмплов" },
  "app.theme.dark": { en: "Dark", ru: "Тёмная" },
  "app.theme.light": { en: "Light", ru: "Светлая" },
  "app.lang.en": { en: "EN", ru: "EN" },
  "app.lang.ru": { en: "RU", ru: "RU" },

  // Model labels (pills)
  "model.power-law": { en: "Power-law finish model", ru: "Степенная модель" },
  "model.linear-skill": { en: "Linear-skill finish model", ru: "Линейная модель скилла" },
  "model.stretched-exp": { en: "Stretched-exp finish model", ru: "Растянутая экспонента" },
  "model.uniform": { en: "Uniform finish model", ru: "Равномерная модель" },
  "model.empirical": { en: "Empirical finish model", ru: "Эмпирическая модель" },

  // Sections
  "section.schedule.title": { en: "Schedule", ru: "Расписание" },
  "section.schedule.subtitle": {
    en: "Rows are played by their count each schedule pass; schedule is repeated N times per sample.",
    ru: "Каждая строка играется согласно count за один проход; расписание повторяется N раз на сэмпл.",
  },
  "section.controls.title": { en: "Simulation controls", ru: "Параметры симуляции" },
  "section.controls.subtitle": {
    en: "Samples drive accuracy; the finish model maps ROI onto finish-place probabilities.",
    ru: "Число сэмплов задаёт точность; модель мест превращает ROI в распределение финишей.",
  },
  "section.results.title": { en: "Results", ru: "Результаты" },
  "section.results.subtitle": {
    en: "Monte Carlo samples · tournaments each",
    ru: "Сэмплов Монте-Карло · турниров в каждом",
  },

  // Demo scenarios
  "demo.label": { en: "Demo scenarios", ru: "Пресеты" },
  "demo.nanoGrinder": { en: "Nano grinder", ru: "Нано-гриндер" },
  "demo.microGrinder": { en: "Micro grinder", ru: "Микро-гриндер" },
  "demo.midGrinder": { en: "Mid-stakes grinder", ru: "Средние лимиты" },
  "demo.hyperNight": { en: "Hyper night", ru: "Вечер гиперов" },
  "demo.sundayMajors": { en: "Sunday majors", ru: "Воскресные мейджоры" },
  "demo.spinHunter": { en: "Spin hunter", ru: "Спин-хантер" },
  "demo.bigFieldReg": { en: "Big-field reg", ru: "Гриндер большого поля" },
  "demo.satelliteFeeder": { en: "Satellite feeder", ru: "Сателлит-фидер" },

  // Schedule editor
  "row.label": { en: "Label", ru: "Название" },
  "row.players": { en: "Players", ru: "Игроки" },
  "row.buyIn": { en: "Buy-in $", ru: "Бай-ин $" },
  "row.rake": { en: "Rake %", ru: "Рейк %" },
  "row.roi": { en: "ROI %", ru: "ROI %" },
  "row.payouts": { en: "Payouts", ru: "Структура" },
  "row.count": { en: "Count", ru: "Количество" },
  "row.guarantee": { en: "Guarantee $", ru: "Гарантия $" },
  "row.addRow": { en: "+ Add row", ru: "+ Добавить" },
  "row.delete": { en: "Delete", ru: "Удалить" },
  "row.reentry": { en: "Re-entries", ru: "Ре-энтри" },
  "row.reentryRate": { en: "Re-entry rate", ru: "Доля ре-энтри" },
  "row.bounty": { en: "Bounty %", ru: "Баунти %" },
  "row.icmFT": { en: "ICM FT", ru: "ICM FT" },
  "row.unnamed": { en: "unnamed", ru: "без названия" },
  "row.noGuarantee": { en: "no guarantee", ru: "без гарантии" },
  "row.advanced": { en: "Advanced", ru: "Доп. параметры" },
  "row.fieldSize": { en: "Field size", ru: "Размер поля" },
  "row.fixed": { en: "Fixed", ru: "Фиксированное" },
  "row.uniformRange": { en: "Uniform range", ru: "Равномерный диапазон" },
  "row.min": { en: "Min", ru: "Мин" },
  "row.max": { en: "Max", ru: "Макс" },
  "row.buckets": { en: "Buckets", ru: "Бакетов" },
  "row.customPct": { en: "Custom payouts (%)", ru: "Свои выплаты (%)" },
  "row.ftSize": { en: "FT size", ru: "Размер ФТ" },
  "row.guaranteeHint": {
    en: "Overlay = max(0, guarantee − field × buy-in). Adds money to the prize pool without inflating entry cost.",
    ru: "Оверлей = max(0, гарантия − поле × бай-ин). Добавляет деньги в призовой, не увеличивая цену входа.",
  },
  "row.fieldHint": {
    en: "Splits this row into N field-size variants so runs reflect volatility in turnout.",
    ru: "Дробит строку на N вариантов размера поля, чтобы моделировать разброс турнаута.",
  },
  "row.customHint": {
    en: "Comma, space or newline separated percentages — will be normalized to sum to 100 %. Paid places = length of list.",
    ru: "Проценты через запятую, пробел или перевод строки — нормализуются до 100 %. Призовых мест = длина списка.",
  },
  "row.reentryHint": {
    en: "1 = freezeout. Expected extra entries: geometric retry capped at max.",
    ru: "1 = фризаут. Ожидаемое число ре-энтри: геометрическая модель с кэпом.",
  },
  "row.bountyHint": {
    en: "Share of each buy-in diverted to the KO pool. EV is paid as a fixed per-entry lump at calibration time.",
    ru: "Доля бай-ина, идущая в KO-пул. EV выдаётся фиксированным лампом на запись при калибровке.",
  },
  "row.icmHint": {
    en: "Flattens the top payouts via ICM blend — reflects real-world deal making on final tables. Total $ preserved.",
    ru: "Сглаживает топ-выплаты через ICM-блендинг — отражает реальные дилы на ФТ. Сумма выплат сохраняется.",
  },

  // Controls panel
  "controls.scheduleRepeats": { en: "Schedule ×", ru: "Прогонов" },
  "controls.samples": { en: "Samples", ru: "Сэмплов" },
  "controls.bankroll": { en: "Bankroll $", ru: "Банкролл $" },
  "controls.finishModel": { en: "Finish model", ru: "Модель мест" },
  "controls.alphaOverride": { en: "α override", ru: "α вручную" },
  "controls.alphaPlaceholder": { en: "auto", ru: "авто" },
  "controls.seed": { en: "Seed", ru: "Зерно" },
  "controls.compareLabel": {
    en: "Compare with PrimeDope (uniform-lift)",
    ru: "Сравнить с PrimeDope (uniform-lift)",
  },
  "controls.compareHint": {
    en: "Runs a second simulation on the same seed using PrimeDope's flat-ITM calibration. Two result columns + diff row.",
    ru: "Второй прогон на том же зерне с калибровкой как у PrimeDope (плоский ITM). Две колонки результатов + строка расхождений.",
  },
  "controls.run": { en: "Run simulation", ru: "Запустить" },
  "controls.running": { en: "Simulating…", ru: "Считаем…" },
  "controls.uploadCSV": { en: "Upload CSV…", ru: "Загрузить CSV…" },
  "controls.empHint": {
    en: "Paste or upload finishing positions, one per line. We build a histogram and resample from it.",
    ru: "Вставь или загрузи финишные места, по одному в строку. Из них собирается гистограмма и идёт ресэмплинг.",
  },
  "controls.empFileError": {
    en: "Failed to read file",
    ru: "Не удалось прочитать файл",
  },

  // Compare slot
  "slot.title": { en: "Compare slot", ru: "Слот сравнения" },
  "slot.saveCurrent": { en: "Save current", ru: "Сохранить" },
  "slot.load": { en: "Load into editor", ru: "Загрузить" },
  "slot.clear": { en: "Clear", ru: "Очистить" },
  "slot.empty": {
    en: "No saved slot. Save the current run to overlay it with new tweaks.",
    ru: "Слот пуст. Сохрани текущий прогон — новые изменения лягут сверху.",
  },
  "slot.saved": { en: "Saved", ru: "Сохранено" },
  "slot.rows": { en: "rows", ru: "строк" },
  "slot.mean": { en: "mean", ru: "среднее" },
  "slot.comparing": { en: "Comparing with saved slot", ru: "Сравнение со слотом" },

  // Results — stat labels
  "stat.expectedProfit": { en: "Expected profit", ru: "Ожидаемая прибыль" },
  "stat.stdDev": { en: "Std-dev", ru: "Ст. откл." },
  "stat.probProfit": { en: "P(profit)", ru: "P(плюс)" },
  "stat.riskOfRuin": { en: "Risk of ruin", ru: "Risk of ruin" },
  "stat.itmRate": { en: "ITM rate", ru: "ITM rate" },
  "stat.itmRate.sub": { en: "compile-time exact", ru: "точно, аналитически" },
  "stat.itmRate.tip": {
    en: "Expected share of tournaments that cash, weighted across the whole schedule. Computed analytically from the finish-place PMF — precise and noise-free.",
    ru: "Ожидаемая доля турниров с призовыми, взвешенная по всему расписанию. Считается аналитически из PMF — точно, без шума.",
  },
  "stat.var": { en: "VaR 95 / 99", ru: "VaR 95 / 99" },
  "stat.cvar": { en: "CVaR 95 / 99", ru: "CVaR 95 / 99" },
  "stat.sharpe": { en: "Sharpe", ru: "Sharpe" },
  "stat.sortino": { en: "Sortino", ru: "Sortino" },
  "stat.tFor95": { en: "T→95% CI ±5%", ru: "T→95% CI ±5%" },
  "stat.avgMaxDD": { en: "Avg max DD", ru: "Среднее макс. DD" },
  "stat.bestRun": { en: "Best run", ru: "Лучший прогон" },
  "stat.worstRun": { en: "Worst run", ru: "Худший прогон" },
  "stat.p1p5": { en: "P1 / P5", ru: "P1 / P5" },
  "stat.p95p99": { en: "P95 / P99", ru: "P95 / P99" },
  "stat.longestBE": { en: "Longest breakeven", ru: "Самый долгий бэ" },
  "stat.minBR5": { en: "Min BR @ 5% RoR", ru: "Мин. БР @ 5% RoR" },
  "stat.bankrollOff": { en: "bankroll off", ru: "банкролл выкл" },
  "stat.ddBI": { en: "Avg max DD (BI)", ru: "Макс. DD (в бай-инах)" },
  "stat.skew": { en: "Skewness", ru: "Асимметрия" },
  "stat.kurt": { en: "Excess kurt.", ru: "Эксц. куртозис" },
  "stat.kelly": { en: "Kelly f*", ru: "Доля Келли" },
  "stat.kellyBR": { en: "Kelly bankroll", ru: "Банкролл Келли" },
  "stat.logG": { en: "E[log growth]", ru: "E[лог-рост]" },

  // Results — charts
  "chart.trajectory": { en: "Bankroll trajectory", ru: "Траектория банкролла" },
  "chart.trajectory.sub": {
    en: "Envelopes at 70 % / 95 % / 99.7 % confidence · 20 random samples · best / worst",
    ru: "Огибающие 70 % / 95 % / 99.7 % · 20 случайных сэмплов · лучший / худший",
  },
  "chart.trajectory.sub.vs": {
    en: "Side-by-side: our α-calibration vs PrimeDope's uniform-lift — same seed, same schedule, identical Y-axis",
    ru: "Бок-о-бок: наша α-калибровка против uniform-lift у PrimeDope — то же зерно, то же расписание, общая ось Y",
  },
  "chart.trajectory.ours.cap": {
    en: "Skill concentrated in deep finishes — realistic swings",
    ru: "Скилл сконцентрирован в глубоких финишах — реалистичные свинги",
  },
  "chart.trajectory.theirs.cap": {
    en: "Flat skill lift across every paid place — understates variance",
    ru: "Плоский лифт скилла по всем призовым — занижает дисперсию",
  },
  "chart.trajectory.sharedY": {
    en: "Both charts share the same Y-axis range so the visual difference in envelope width is directly comparable.",
    ru: "У обоих графиков общий диапазон по оси Y — ширина огибающих видна на глаз и напрямую сравнима.",
  },
  "chart.dist": { en: "Distribution of final profit", ru: "Распределение итогового профита" },
  "chart.ddDist": { en: "Max drawdown distribution", ru: "Распределение макс. даунсвинга" },
  "chart.ddDist.sub": {
    en: "Per-sample worst peak-to-trough dip during the run",
    ru: "Худший пик-то-дно каждого сэмпла за прогон",
  },
  "chart.convergence": { en: "Mean convergence", ru: "Сходимость среднего" },
  "chart.convergence.sub": {
    en: "Running estimate of E[profit] as samples accumulate · 95 % CI band",
    ru: "Текущая оценка E[profit] по мере накопления сэмплов · 95 % ДИ",
  },
  "chart.decomp": { en: "Per-row EV decomposition", ru: "Декомпозиция EV по строкам" },
  "chart.decomp.sub": {
    en: "How much each row contributes to expected profit and to total variance",
    ru: "Вклад каждой строки в ожидаемую прибыль и общую дисперсию",
  },
  "chart.sensitivity": { en: "ROI sensitivity", ru: "Чувствительность к ROI" },
  "chart.sensitivity.sub": {
    en: "Expected profit if true ROI differs from configured value",
    ru: "Ожидаемая прибыль, если настоящий ROI отличается от заданного",
  },

  // PrimeDope diff
  "pd.title": {
    en: "Ours (α-calibration) vs PrimeDope (uniform-lift)",
    ru: "Мы (α-калибровка) против PrimeDope (uniform-lift)",
  },
  "pd.subtitle": {
    en: "Same seed, same schedule — only the finish-place distribution differs. PrimeDope flattens skill across paid places, so its ITM and drawdowns are structurally biased.",
    ru: "Одно зерно, одно расписание — разница только в распределении мест. PrimeDope распределяет скилл плоско по призовым, из-за чего ITM и даунсвинги системно искажены.",
  },
  "pd.ours": { en: "ours", ru: "наши" },
  "pd.theirs": { en: "primedope", ru: "primedope" },
  "pd.metric": { en: "Metric", ru: "Метрика" },
  "pd.delta": { en: "Δ", ru: "Δ" },
  "pd.row.itm": { en: "ITM rate", ru: "ITM" },
  "pd.row.stdDev": { en: "Std-dev of profit", ru: "Ст. откл. профита" },
  "pd.row.dd": { en: "Avg max drawdown", ru: "Средний макс. DD" },
  "pd.row.cvar": { en: "CVaR 95", ru: "CVaR 95" },
  "pd.row.pprofit": { en: "P(profit)", ru: "P(плюс)" },
  "pd.row.ror": { en: "Risk of ruin", ru: "Risk of ruin" },
  "pd.row.var95": { en: "VaR 95", ru: "VaR 95" },
  "pd.row.cvar99": { en: "CVaR 99", ru: "CVaR 99" },
  "pd.row.worstRun": { en: "Worst run", ru: "Худший прогон" },
  "pd.row.bestRun": { en: "Best run", ru: "Лучший прогон" },
  "pd.row.longestBE": { en: "Longest breakeven", ru: "Самый долгий бэ" },
  "pd.row.sharpe": { en: "Sharpe", ru: "Sharpe" },
  "pd.row.ddWorst": { en: "Worst drawdown ever seen", ru: "Худший даунсвинг за прогон" },

  // Verdict — plain-language summary card
  "verdict.title": {
    en: "What this means in plain English",
    ru: "Что это значит по-человечески",
  },
  "verdict.ev.good": {
    en: "On average you end a schedule pass up {mean} ({roi} ROI). Long-term, if you play this schedule forever, you bank that per pass.",
    ru: "В среднем за один прогон расписания ты в плюсе на {mean} ({roi} ROI). На длинной дистанции — это твой реальный заработок за один прогон.",
  },
  "verdict.ev.bad": {
    en: "On average you end a schedule pass down {mean} ({roi} ROI). Long-term, playing this schedule bleeds money.",
    ru: "В среднем за один прогон ты в минусе на {mean} ({roi} ROI). На дистанции это расписание сливает деньги.",
  },
  "verdict.prob": {
    en: "You finish a schedule pass in profit {prob} of the time — {qual}.",
    ru: "Ты заканчиваешь прогон в плюсе {prob} случаев — {qual}.",
  },
  "verdict.prob.q.great": { en: "very reliable", ru: "очень надёжно" },
  "verdict.prob.q.good": { en: "solid", ru: "стабильно" },
  "verdict.prob.q.meh": { en: "coin-flippy", ru: "как монетка" },
  "verdict.prob.q.bad": { en: "basically a lottery", ru: "по сути лотерея" },
  "verdict.swing": {
    en: "Expect a typical peak-to-trough drop of {dd} along the way. In the worst 1 % of outcomes the loss goes to {cvar99}.",
    ru: "Жди типичного отката от пика до дна около {dd} по ходу прогона. В худших 1 % случаев убыток доходит до {cvar99}.",
  },
  "verdict.bankroll.with": {
    en: "With a {br} bankroll, risk of ruin is {ror}.",
    ru: "С банкроллом {br} риск разорения — {ror}.",
  },
  "verdict.bankroll.need": {
    en: "To keep risk of ruin under 1 %, you need at least {minBR} behind you.",
    ru: "Чтобы риск разорения был ниже 1 %, нужен банкролл не меньше {minBR}.",
  },
  "verdict.trust": {
    en: "You need roughly {n} tournaments before your true ROI is measured to ±5 %. Anything less is short-run noise.",
    ru: "Нужно примерно {n} турниров, чтобы твой настоящий ROI замерился с точностью ±5 %. Всё короче — это шум.",
  },
  "verdict.vsPD": {
    en: "Versus PrimeDope: our ITM is {itmDiff} pp lower and average drawdown is {ddDiff} deeper. PrimeDope assumes skill lifts every paid place equally — we model it concentrating toward deeper finishes, which matches real samples.",
    ru: "По сравнению с PrimeDope: наш ITM на {itmDiff} пп ниже, а средний даунсвинг глубже на {ddDiff}. PrimeDope считает, что скилл одинаково поднимает шансы на все призовые места — мы же моделируем концентрацию скилла в глубоких финишах, что совпадает с реальными выборками.",
  },

  // PD narrative verdict (dynamic, templated)
  "pdv.eyebrow": {
    en: "PrimeDope vs reality — the pitch",
    ru: "PrimeDope против реальности — разбор",
  },
  "pdv.title": {
    en: "They told you the swings would look like this…",
    ru: "Они сказали, что свинги будут такими…",
  },
  "pdv.titleReality": {
    en: "…but under an honest model your swings actually look like this.",
    ru: "…но по честной модели свинги выглядят вот так.",
  },
  "pdv.sigma": {
    en: "Per-tournament std-dev",
    ru: "σ на турнир",
  },
  "pdv.sigmaDelta": {
    en: "{mult}× what PrimeDope shows",
    ru: "в {mult}× больше, чем рисует PrimeDope",
  },
  "pdv.sigmaDeltaNeg": {
    en: "{mult}× lower than PrimeDope (your schedule is tighter than they think)",
    ru: "в {mult}× меньше, чем у PrimeDope (твоё расписание стабильнее их оценки)",
  },
  "pdv.worst": {
    en: "Deepest drawdown (mean)",
    ru: "Средний максимум даунсвинга",
  },
  "pdv.worstDelta": {
    en: "{mult}× deeper than PrimeDope",
    ru: "в {mult}× глубже, чем у PrimeDope",
  },
  "pdv.worstDeltaNeg": {
    en: "{mult}× shallower than PrimeDope",
    ru: "в {mult}× меньше, чем у PrimeDope",
  },
  "pdv.breakeven": {
    en: "Longest break-even streak",
    ru: "Самая длинная полоса безубытка",
  },
  "pdv.breakevenDelta": {
    en: "+{delta}t vs PrimeDope",
    ru: "+{delta}т. против PrimeDope",
  },
  "pdv.breakevenDeltaNeg": {
    en: "{delta}t vs PrimeDope",
    ru: "{delta}т. против PrimeDope",
  },
  "pdv.itm": {
    en: "In-the-money rate",
    ru: "Частота ITM",
  },
  "pdv.itmDelta": {
    en: "{delta} pp below PrimeDope",
    ru: "на {delta} пп ниже PrimeDope",
  },
  "pdv.itmDeltaNeg": {
    en: "{delta} pp above PrimeDope",
    ru: "на {delta} пп выше PrimeDope",
  },
  "pdv.whyTitle": {
    en: "Why the two pictures disagree",
    ru: "Почему картинки не совпадают",
  },
  "pdv.why1": {
    en: "PrimeDope lifts every paid spot by the same factor — a min-cash gets the same skill bump as a WIN. Real winners concentrate at the top, so flat-lifted cashes leak probability from deep finishes and hide the true spikes.",
    ru: "PrimeDope поднимает шансы всех призовых мест на один и тот же коэффициент — мин-кеш получает такой же бонус скилла, как и ПОБЕДА. Реальные победители концентрируются наверху, поэтому плоский лифт «размазывает» вероятность и скрывает настоящие спайки.",
  },
  "pdv.why2": {
    en: "A flat-lifted ITM over-counts small cashes and under-counts long cash-less streaks. That's why their breakeven stretches look short and their drawdowns shallow — the tail is literally missing.",
    ru: "Плоский ITM переоценивает мелкие кеши и недооценивает долгие бесприбыльные полосы. Поэтому у них полосы безубытка короткие, а даунсвинги мелкие — хвоста распределения там просто нет.",
  },
  "pdv.why3": {
    en: "We fit α by binary search against your ROI, then resample every tournament with a parametric skill-weighted PMF (power-law / stretched-exp / linear / empirical). The resulting std-dev is what the math actually says your schedule will do.",
    ru: "Мы подгоняем α бинарным поиском под твой ROI и пересэмплируем каждый турнир с параметрической моделью скилла (power-law / stretched-exp / линейная / эмпирическая). Получающийся σ — это то, что математика реально говорит про твоё расписание.",
  },
  "pdv.takeaway": {
    en: "Translation: if you budget your bankroll off PrimeDope numbers, your 1-in-20 bad run will be {mult}× worse than the website warned you about.",
    ru: "Перевод: если считаешь банкролл по цифрам PrimeDope, то реальный худший сценарий 1-из-20 будет в {mult}× хуже, чем предсказывает сайт.",
  },
  "pdv.takeawayNeg": {
    en: "Translation: PrimeDope overstates your variance here. Your schedule is genuinely tighter than their model assumes.",
    ru: "Перевод: PrimeDope здесь переоценивает дисперсию. Твоё расписание реально стабильнее их модели.",
  },
  // Explainer (legacy, still referenced)
  "why.title": { en: "Why our numbers differ", ru: "Почему у нас цифры другие" },
  "why.body": {
    en: "PrimeDope models skill as a uniform lift over paid places: every paid finish gets the same bumped probability k/N. That's mathematically cleanest but wrong — real winners concentrate in deep finishes, not min-cashes. Our α-calibration fits a parametric skill model (power-law / stretched-exp / linear) so that cashes bias toward the top, reproducing the Muchomota 2024 observation that real-sample ITM sits ~3 pp below PrimeDope at 20% ROI. This matters for drawdowns too — flatter-ITM models understate swings.",
    ru: "PrimeDope моделирует скилл как плоский лифт по призовым: каждое призовое место получает одинаковый повышенный шанс k/N. Это математически чистенько, но неверно — настоящие скилл-игроки чаще заходят глубоко, а не на мин-кеше. Наша α-калибровка натягивает параметрическую модель (power-law / stretched-exp / линейная) так, чтобы кеши смещались к верху — это воспроизводит наблюдение Muchomota (2024), что реальный ITM на ~3 пп ниже, чем у PrimeDope при 20% ROI. Это бьёт и по даунсвингам — плоский ITM занижает свинги.",
  },
  // Preview
  "preview.title": { en: "Finish-model preview", ru: "Превью модели мест" },
  "preview.sub": {
    en: "Live PMF for row 1 under the current model and ROI",
    ru: "PMF первой строки при текущей модели и ROI",
  },
  "preview.pmfLabel": {
    en: "Finish-place probability · payout curve",
    ru: "Вероятность места · кривая выплат",
  },

  // Footer
  "footer.line": {
    en: "Local clone of PrimeDope / PokerDope tournament variance simulator · Next.js 16 + React 19 + uPlot · seeded determinism ·",
    ru: "Локальный клон PrimeDope / PokerDope · Next.js 16 + React 19 + uPlot · детерминизм через зерно ·",
  },
  "footer.state": {
    en: "state autosaved and shareable via URL",
    ru: "состояние автосохраняется и шарится по URL",
  },

  // Sensitivity
  "sens.configured": { en: "configured", ru: "заданный" },
  "sens.note": {
    en: "Linear under the α calibration — shows how brittle EV is to ROI misestimation.",
    ru: "Линейно при α-калибровке — показывает, насколько EV зависит от ошибки в ROI.",
  },

  // Downswing catalog
  "dd.title": { en: "Worst downswings", ru: "Худшие даунсвинги" },
  "dd.sub": {
    en: "Top-10 samples by peak-to-trough loss — depth, duration, and break-even length",
    ru: "Топ-10 сэмплов по максимальному откату — глубина, длительность и время на восстановление",
  },
  "dd.rank": { en: "#", ru: "#" },
  "dd.depth": { en: "Depth", ru: "Глубина" },
  "dd.final": { en: "Final profit", ru: "Итог" },
  "dd.breakeven": { en: "Longest BE", ru: "Макс. бэ" },

  // Help tooltips — controls panel
  "help.scheduleRepeats": {
    en: "How many times your schedule replays inside a single sample.\n\nExample: 200 repeats × 10 tournaments/pass = 2,000 tournaments per sample.\n\nEffect: bigger number ⇒ longer simulated distance, variance averages out, a single upswing matters less.",
    ru: "Сколько раз расписание проигрывается внутри одного сэмпла.\n\nПример: 200 прогонов × 10 турниров = 2 000 турниров на сэмпл.\n\nЭффект: больше значение ⇒ длиннее дистанция, дисперсия усредняется, разовый апстрик перестаёт решать.",
  },
  "help.samples": {
    en: "Number of parallel Monte Carlo universes — each is one full replay of the schedule.\n\nExample: 10,000 samples = 10,000 possible outcomes you could live through.\n\nEffect: more samples ⇒ tighter estimates of ROI / std-dev / tail percentiles; slower run. 5k is quick, 50k is publication-grade.",
    ru: "Сколько параллельных «вселенных» Монте-Карло — каждая это один полный прогон расписания.\n\nПример: 10 000 сэмплов = 10 000 возможных исходов, через которые ты мог бы пройти.\n\nЭффект: больше сэмплов ⇒ точнее оценка ROI / ст. откл. / хвостовых перцентилей; дольше считается. 5k — быстро, 50k — уровень «для статьи».",
  },
  "help.bankroll": {
    en: "Current bankroll in $. Unlocks risk-of-ruin, Kelly bankroll, and log-growth metrics.\n\nExample: 5000 = a $5k roll. 0 = ignore bankroll, skip ruin math.\n\nEffect: adds a −bankroll line on the trajectory chart; any sample that crosses it counts as ruined.",
    ru: "Текущий банкролл в $. Включает расчёт риска разорения, Kelly-банкролла и log-growth.\n\nПример: 5000 = банкролл $5k. 0 = банкролл игнорируется, ruin-математика отключается.\n\nЭффект: на графике траектории появится линия −банкролл; каждый сэмпл, который её пересёк, считается разорением.",
  },
  "help.finishModel": {
    en: "Shape of the skill distribution over finish places.\n\nOptions:\n• Power-law — skill concentrates in deep finishes (default, best match to real samples)\n• Linear skill — linear lift toward the top\n• Stretched-exp — in between the two\n• Uniform — flat lift on every paid place (PrimeDope-style, understates variance)\n• Empirical — PMF built from your own CSV of real finishes",
    ru: "Форма распределения скилла по финишным местам.\n\nОпции:\n• Power-law — скилл концентрируется в глубоких финишах (дефолт, лучше всего ложится на реальные выборки)\n• Linear skill — линейный лифт к топу\n• Stretched-exp — промежуточный вариант\n• Uniform — плоский лифт по всем призовым (как у PrimeDope, занижает дисперсию)\n• Empirical — PMF из твоего CSV реальных финишей",
  },
  "help.alphaOverride": {
    en: "Manual α exponent, bypassing auto-calibration to target ROI.\n\nExample: leave blank to let the engine binary-search α. Enter 1.0 for neutral, 2.0 for aggressive top-concentration.\n\nEffect: advanced — use only if you want to freeze the shape of the skill curve and ignore your ROI target.",
    ru: "Ручное α вместо автокалибровки под целевой ROI.\n\nПример: оставь пустым — мы сами подберём α бинарным поиском. 1.0 — нейтрально, 2.0 — агрессивная концентрация в топе.\n\nЭффект: продвинутое — используй только если хочешь зафиксировать форму кривой скилла и забить на ROI-таргет.",
  },
  "help.seed": {
    en: "PRNG seed — same seed gives identical results.\n\nExample: 42, 1337, 2025. Any integer.\n\nEffect: change it to draw a different set of outcomes on the same schedule; keep it to reproduce a run exactly (useful for comparing tweaks).",
    ru: "Зерно генератора случайных чисел — одно и то же зерно = один и тот же результат.\n\nПример: 42, 1337, 2025. Любое целое.\n\nЭффект: меняй, чтобы перепрогнать другую выборку на том же расписании; оставь, чтобы воспроизвести прогон точно (удобно для сравнения правок).",
  },
  "help.compare": {
    en: "Runs a second simulation on the same seed using PrimeDope's uniform-lift calibration.\n\nEffect: shows two trajectory charts side-by-side (ours vs theirs) + a diff table of every metric. Roughly doubles run time.",
    ru: "Запускает вторую симуляцию на том же зерне с калибровкой PrimeDope (uniform-lift).\n\nЭффект: два графика траектории бок-о-бок (наш vs их) + таблица расхождений по всем метрикам. Время прогона удваивается.",
  },
  "help.empirical": {
    en: "Paste or upload a list of finishing positions from your real history (one per line or comma-separated).\n\nExample: 47, 132, 8, 501, 23 …\n\nEffect: the simulator builds a histogram from this data and resamples positions from it directly, no parametric model, no α calibration.",
    ru: "Вставь или загрузи список финишных мест из твоей реальной истории (по одному на строку или через запятую).\n\nПример: 47, 132, 8, 501, 23 …\n\nЭффект: симулятор собирает гистограмму из этих данных и сэмплирует места прямо из неё — без параметрической модели, без α-калибровки.",
  },

  // Help tooltips — schedule editor columns
  "help.row.label": {
    en: "Free-form name for the tournament row. Cosmetic only — doesn't affect the math.\n\nExample: \"Bread & butter\", \"Sunday Major\", \"$5 hyper\".",
    ru: "Произвольное название строки турнира. Чисто косметика — не влияет на расчёт.\n\nПример: «Хлеб насущный», «Воскресный мажор», «$5 гипер».",
  },
  "help.row.players": {
    en: "Field size — how many entrants register.\n\nExample: 200 = soft local regular, 1500 = evening PokerStars regular, 10000 = Sunday Million.\n\nEffect: determines total places (1..N) the finish-model samples from; also scales the prize pool.",
    ru: "Размер поля — сколько игроков заявлено.\n\nПример: 200 = мягкий локальный регуляр, 1500 = вечерний регуляр PokerStars, 10000 = Sunday Million.\n\nЭффект: задаёт общее число мест (1..N), по которым сэмплируется финиш-модель; также масштабирует призовой.",
  },
  "help.row.buyIn": {
    en: "Entry fee in $, before rake. This is the amount that goes into the prize pool per seat.\n\nExample: 10, 55, 215, 1050.\n\nEffect: your real per-entry cost is buyIn × (1 + rake). Prize pool = players × buyIn (+ overlay if guarantee is set).",
    ru: "Цена входа в $, до рейка. Именно эта сумма идёт в призовой за каждое место.\n\nПример: 10, 55, 215, 1050.\n\nЭффект: реальная стоимость входа = buyIn × (1 + rake). Призовой = players × buyIn (+ оверлей, если задана гарантия).",
  },
  "help.row.rake": {
    en: "Rake as a % of the buy-in — the room's cut.\n\nExample: 10 = 10% (soft regular), 7 = 7% (high stakes), 5 = 5% (major series), 12 = 12% (low micro).\n\nEffect: inflates your real per-entry cost and is pure drag on ROI.",
    ru: "Рейк в процентах от бай-ина — доля рума.\n\nПример: 10 = 10% (мягкий регуляр), 7 = 7% (хайстейкс), 5 = 5% (мажор-серия), 12 = 12% (мелкие микро).\n\nЭффект: раздувает реальную цену входа, чистый минус к ROI.",
  },
  "help.row.roi": {
    en: "Your target ROI as a %. +20 = you expect +20% return on every $1 spent on entries.\n\nExample: +10% solid winner, +30% high-end crusher, −5% losing player, 0% break-even.\n\nEffect: the engine binary-searches α so your selected finish model produces exactly this expected return. Drives everything downstream.",
    ru: "Твой целевой ROI в процентах. +20 = ожидаешь +20% возврата на каждый $1, потраченный на вход.\n\nПример: +10% — уверенный плюсовик, +30% — топ-крашер, −5% — лузовый, 0% — безубыток.\n\nЭффект: движок подбирает α бинарным поиском так, чтобы выбранная модель финишей давала ровно такой ожидаемый возврат. От этого пляшет всё остальное.",
  },
  "help.row.payouts": {
    en: "Shape of the prize ladder: what % goes to 1st, 2nd, 3rd, etc.\n\nOptions: Standard (~15% ITM), Flat (~20%, shallower top), Top-heavy (~12%, steeper top), plus real captured curves from PokerStars / GG / Sunday Million / Bounty Builder. Winner-takes-all = 100% to 1st. Custom = paste your own %.\n\nEffect: changes where the EV sits. Flat = more cashes, less big scores. Top-heavy = bigger variance.",
    ru: "Форма призовой сетки: сколько % получают 1-е, 2-е, 3-е и т.д.\n\nОпции: Standard (~15% ITM), Flat (~20%, более плоский топ), Top-heavy (~12%, крутой топ), плюс реальные кривые PokerStars / GG / Sunday Million / Bounty Builder. Winner-takes-all = 100% победителю. Custom = свои %.\n\nЭффект: смещает EV. Flat = больше кешей и меньше крупных заходов. Top-heavy = больше дисперсии.",
  },
  "help.row.count": {
    en: "How many times this row is played in one schedule pass. Fractions allowed — stochastically rounded.\n\nExample: 3 = play this tournament 3 times per pass. 0.5 = on average every other pass.\n\nEffect: scales this row's contribution to total EV and variance.",
    ru: "Сколько раз эта строка играется за один проход расписания. Дроби допустимы — округляем стохастически.\n\nПример: 3 = играем этот турнир 3 раза за проход. 0.5 = в среднем каждый второй проход.\n\nЭффект: масштабирует вклад строки в общее EV и дисперсию.",
  },

  "emp.title": { en: "Empirical PMF source", ru: "Источник эмпирической PMF" },
  "emp.paste": {
    en: "Paste finish positions, one per line",
    ru: "Вставь финишные места, по одному в строку",
  },
  "emp.clear": { en: "Clear", ru: "Очистить" },
  "emp.loaded": { en: "Loaded", ru: "Загружено" },
  "emp.entries": { en: "entries", ru: "записей" },
  "emp.none": { en: "No data — model falls back to power-law.", ru: "Нет данных — откат на power-law." },
} as const satisfies Record<string, Entry>;

export type DictKey = keyof typeof DICT;

export function translate(locale: Locale, key: DictKey): string {
  return DICT[key][locale];
}
