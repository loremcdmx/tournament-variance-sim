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
    en: "See the real spread of profit and downswings across your schedule. Thousands of Monte Carlo runs.",
    ru: "Реальный разброс профита и даунсвингов по твоему расписанию. Тысячи прогонов Монте-Карло.",
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
  "model.plackett-luce": { en: "Plackett–Luce finish model", ru: "Модель Плакетта–Льюса" },

  // Sections
  "section.schedule.title": { en: "Schedule", ru: "Расписание" },
  "section.schedule.subtitle": {
    en: "Rows are played by their count each schedule pass; schedule is repeated N times per sample.",
    ru: "Каждая строка играется согласно count за один проход; расписание повторяется N раз на сэмпл.",
  },
  "section.controls.title": { en: "Simulation controls", ru: "Параметры симуляции" },
  "section.controls.subtitle": {
    en: "More simulations = more accurate numbers. The skill model decides how your ROI shows up across finish places.",
    ru: "Больше симуляций = точнее цифры. Модель скилла решает, как твой ROI раскладывается по финишным местам.",
  },
  "section.results.title": { en: "Results", ru: "Результаты" },
  "section.results.subtitle": {
    en: "simulated runs · tournaments each",
    ru: "симуляций · турниров в каждой",
  },

  // Demo scenarios
  "demo.label": { en: "Demo scenarios", ru: "Пресеты" },
  "demo.primedopeReference": {
    en: "PrimeDope sanity check",
    ru: "Сверка с PrimeDope",
  },
  "demo.romeoPro": { en: "RomeoPro mode", ru: "Режим Ромеопро" },

  "userPreset.label": { en: "My presets", ru: "Мои пресеты" },
  "userPreset.saveCurrent": { en: "Save current", ru: "Сохранить текущий" },
  "userPreset.empty": {
    en: "Nothing saved yet. Configure a schedule and hit Save current.",
    ru: "Пока пусто. Настрой расписание и жми «Сохранить текущий».",
  },
  "userPreset.mine": { en: "Saved", ru: "Сохранено" },
  "userPreset.delete": { en: "Delete", ru: "Удалить" },
  "userPreset.share": {
    en: "Copy share link",
    ru: "Скопировать ссылку",
  },
  "userPreset.shareCopied": { en: "Link copied", ru: "Ссылка скопирована" },
  "userPreset.shareFallback": {
    en: "Copy this link manually:",
    ru: "Скопируй ссылку вручную:",
  },
  "userPreset.promptName": {
    en: "Name this preset:",
    ru: "Название пресета:",
  },
  "userPreset.confirmDelete": {
    en: "Delete this preset?",
    ru: "Удалить пресет?",
  },

  // Schedule editor
  "row.label": { en: "Label", ru: "Название" },
  "row.players": { en: "Field", ru: "Поле" },
  "row.buyIn": { en: "Buy-in", ru: "Бай-ин" },
  "row.rake": { en: "Rake %", ru: "Рейк %" },
  "row.import": { en: "Import…", ru: "Импорт…" },
  "row.importTitle": {
    en: "Import schedule — one tourney per line: label, players, buyIn (50+5), roi%, count, payout",
    ru: "Импорт расписания — один турнир в строку: название, поле, бай-ин (50+5), roi%, count, payout",
  },
  "row.importFile": { en: "upload file", ru: "файл" },
  "row.importAppend": { en: "Append", ru: "Добавить" },
  "row.importReplace": { en: "Replace all", ru: "Заменить всё" },
  "row.importCancel": { en: "cancel", ru: "отмена" },
  "row.roi": { en: "ROI %", ru: "ROI %" },
  "row.payouts": { en: "Prize ladder", ru: "Призовая сетка" },
  "row.count": {
    en: "Tourneys per session",
    ru: "Турниров за сессию",
  },
  "help.count": {
    en: "How many bullets you play in one session. This is NOT re-entries — re-entry rate is configured separately in advanced row options.",
    ru: "Сколько пуль играешь за одну сессию. Это НЕ ре-энтри — процент перезаходов настраивается отдельно в дополнительных полях строки.",
  },
  "row.guarantee": { en: "Guarantee $", ru: "Гарантия $" },
  "row.addRow": { en: "+ Add row", ru: "+ Добавить" },
  "row.cloneAsReentry": {
    en: "Clone as re-entry (ROI −5pp)",
    ru: "Клон как ре-ентри (ROI −5pp)",
  },
  "row.delete": { en: "Delete", ru: "Удалить" },
  "row.reentry": { en: "Re-entries", ru: "Ре-энтри" },
  "row.reentryRate": { en: "Re-entry rate", ru: "Доля ре-энтри" },
  "row.bounty": { en: "Bounty %", ru: "Баунти %" },
  "row.icmFT": { en: "ICM FT", ru: "ICM ФТ" },
  "row.unnamed": { en: "unnamed", ru: "без названия" },
  "row.noGuarantee": { en: "no guarantee", ru: "без гарантии" },
  "row.advanced": { en: "Advanced", ru: "Доп. параметры" },
  "row.fieldSize": { en: "Field size", ru: "Размер поля" },
  "row.fixed": { en: "Fixed", ru: "Фиксированное" },
  "row.uniformRange": { en: "Range", ru: "Диапазон" },
  "row.min": { en: "Min", ru: "Мин" },
  "row.max": { en: "Max", ru: "Макс" },
  "row.buckets": { en: "Variants", ru: "Вариантов" },
  "row.customPct": { en: "Custom payouts (%)", ru: "Свои выплаты (%)" },
  "row.ftSize": { en: "FT size", ru: "Размер ФТ" },
  "row.guaranteeHint": {
    en: "Overlay = max(0, guarantee − field × buy-in). Adds money to the prize pool without inflating entry cost.",
    ru: "Оверлей = max(0, гарантия − поле × бай-ин). Добавляет деньги в призовой, не увеличивая цену входа.",
  },
  "row.fieldHint": {
    en: "Sometimes the field is 400, sometimes 700. Pick a range and the sim will play a few different sizes so the swings reflect reality.",
    ru: "Иногда поле 400, иногда 700. Задай диапазон — симулятор прогонит несколько размеров, и свинги будут ближе к реальности.",
  },
  "row.customHint": {
    en: "Comma, space or newline separated percentages — will be normalized to sum to 100 %. Paid places = length of list.",
    ru: "Проценты через запятую, пробел или перевод строки — нормализуются до 100 %. Призовых мест = длина списка.",
  },
  "row.reentryHint": {
    en: "Max bullets per player. 1 = freezeout. After busting, a player reenters with the given probability until the cap — each reentry pays buy-in + rake and grows the prize pool.",
    ru: "Сколько пуль максимум на одного игрока. 1 = фризаут. После вылета игрок реэнтрится с заданной вероятностью до кэпа — каждая пуля платит бай-ин и рейк и раздувает призовой.",
  },
  "row.bountyHint": {
    en: "KO bounty as % of the buy-in. That chunk of every entry goes into the bounty pool instead of the regular prize pool, paid out as knockouts.",
    ru: "Баунти за вылет как % от бай-ина. Эта доля каждого входа уходит в баунти-пул вместо обычного призового и выдаётся за нокауты.",
  },
  "row.icmHint": {
    en: "Flattens the top of the prize ladder the way real final-table deals do — 1st gets less, min-FT gets more. Total money unchanged.",
    ru: "Сглаживает верх призовой сетки так, как это делают реальные дилы на ФТ — первому меньше, мин-ФТ больше. Сумма выплат не меняется.",
  },
  "row.sitThrough": {
    en: "Sit through pay jumps",
    ru: "Играем мимо лесенки",
  },
  "row.sitThroughAgg": { en: "Aggression %", ru: "Агрессия %" },
  "row.sitThroughHint": {
    en: "You refuse to fold your way into mincashes and play for stacks instead. EV-preserving: probability mass on bottom-half paid places is shifted — some into deeper finishes (weighted by prize), the rest into busts. Total ROI is unchanged; variance goes up because mincashes stop absorbing bad runs.",
    ru: "Ты отказываешься запаркинговаться в мин-кеш и играешь за стек. EV не меняется: часть вероятности из нижней половины призовых уходит наверх (пропорционально призу), остаток — в вылеты до денег. ROI остаётся тем же, но дисперсия растёт — мин-кеши больше не гасят плохие прогоны.",
  },
  "row.mystery": { en: "Mystery bounty σ²", ru: "Mystery bounty σ²" },
  "row.mysteryHint": {
    en: "Per-KO lognormal variance on the bounty value. 0 = flat bounties. 0.5–1 = moderate mystery skew. 1.5+ = GG-style jackpot distribution (occasional huge, mostly tiny). Mean is preserved, only variance is reshaped.",
    ru: "Дисперсия лог-нормального разброса на ценность одной выбитой головы. 0 = плоские баунти. 0.5–1 = умеренный mystery-скью. 1.5+ = как у GG (редкие крупные, в основном мелкие). Среднее сохраняется — меняется только дисперсия.",
  },
  "row.lateReg": { en: "Late-reg ×", ru: "Late-reg ×" },
  "row.lateRegHint": {
    en: "Real field at reg-close ÷ the field size you set. 1.3 = by late-reg close the field is 30% bigger than you thought you were playing. Scales prize pool and paid seats, adds variance. PrimeDope can't model this at all.",
    ru: "Во сколько раз поле на закрытии регистрации больше заявленного. 1.3 = к закрытию поле раздулось на 30% относительно того, что ты видел на старте. Масштабирует призовой и число призовых, добавляет дисперсию. PrimeDope так вообще не умеет.",
  },

  // Controls panel
  "controls.scheduleRepeats": {
    en: "Sessions to play",
    ru: "Сколько сессий сыграем",
  },
  "controls.samples": { en: "Simulations", ru: "Симуляций" },
  "controls.bankroll": { en: "Bankroll", ru: "Банкролл" },
  "controls.pdStyleEV.label": {
    en: "Count EV the PrimeDope way",
    ru: "Считать EV как PrimeDope",
  },
  "controls.pdStyleEV.body": {
    en: "Drop rake from the cost and ROI on the right-hand comparison pane so the numbers line up with their site.",
    ru: "Игнорировать рейк в стоимости и ROI на правой панели сравнения, чтобы цифры сошлись с их сайтом.",
  },
  "controls.pdStyleEV.caveat": {
    en: "Formally wrong — rake is part of your cost. Without this, ROI is computed against the full buy-in+rake basis, which is the correct definition.",
    ru: "Формально это неправильно: рейк — часть твоего расхода. Без галки ROI считается от полной стоимости (buy-in + rake), как и должно быть.",
  },
  "controls.compareMode": { en: "Twin-run mode", ru: "Режим сравнения" },
  "controls.compareMode.random": {
    en: "Two random runs (same model)",
    ru: "Два рандомных прогона (одна модель)",
  },
  "controls.compareMode.primedope": {
    en: "Ours vs PrimeDope (same seed)",
    ru: "Наш vs PrimeDope (один сид)",
  },
  "twin.runA": { en: "Run A", ru: "Прогон A" },
  "twin.runB": { en: "Run B", ru: "Прогон B" },
  "twin.runA.cap": {
    en: "First random sample of your schedule.",
    ru: "Первая случайная выборка по твоему расписанию.",
  },
  "twin.runB.cap": {
    en: "Second random sample — same model, different seed. Shows how much two fresh draws diverge.",
    ru: "Вторая случайная выборка — та же модель, другой сид. Показывает, насколько расходятся два свежих рана.",
  },
  "controls.finishModel": { en: "Skill model", ru: "Модель скилла" },
  "controls.alphaOverride": {
    en: "Skill sharpness (optional)",
    ru: "Жёсткость кривой скилла (опц.)",
  },
  "controls.alphaPlaceholder": { en: "auto", ru: "авто" },
  "controls.seed": {
    en: "Run number (reproducibility)",
    ru: "Номер прогона (повторяемость)",
  },
  "controls.seedReroll": { en: "Re-roll", ru: "Перебросить" },
  "controls.roiStdErr": {
    en: "Uncertainty about your true ROI",
    ru: "Неуверенность в своём ROI",
  },
  "controls.roiShockPerTourney": {
    en: "Field strength varies tourney-to-tourney",
    ru: "Сила поля меняется от турнира к турниру",
  },
  "controls.roiShockPerSession": {
    en: "Some days the field is fishier",
    ru: "В разные дни поле бывает рыбнее",
  },
  "controls.roiDriftSigma": {
    en: "Slow ROI drift over many sessions",
    ru: "Медленный дрейф формы за много сессий",
  },
  "controls.section.run": { en: "Run controls", ru: "Параметры прогона" },
  "controls.section.skill": { en: "Skill model", ru: "Модель скилла" },
  "controls.section.shocks": {
    en: "Extra variance sources (optional)",
    ru: "Доп. источники дисперсии (опционально)",
  },
  "controls.section.tilt": { en: "Tilt (optional)", ru: "Тильт (опционально)" },
  "controls.section.advanced": {
    en: "Advanced (optional)",
    ru: "Дополнительно (опционально)",
  },
  "controls.expandAdvanced": {
    en: "Show advanced options",
    ru: "Показать продвинутые настройки",
  },
  "controls.collapseAdvanced": {
    en: "Hide advanced options",
    ru: "Скрыть продвинутые настройки",
  },
  "controls.tiltHint": {
    en: "Models the case where your play degrades during long downswings (or improves during winning streaks). Leave everything at 0 to disable.",
    ru: "Моделирует случай, когда твоя игра проседает на даунсвингах (или наоборот, обостряется на апсвингах). Оставь всё на 0 — выключено.",
  },
  "controls.tiltFastGain": {
    en: "Fast tilt: sensitivity",
    ru: "Быстрый тильт: чувствительность",
  },
  "controls.tiltFastScale": {
    en: "Fast tilt: drawdown depth that hurts you",
    ru: "Быстрый тильт: глубина даунсвинга, на которой ломаешься",
  },
  "controls.tiltSlowGain": {
    en: "Slow tilt: ROI shift while tilted",
    ru: "Медленный тильт: насколько падает ROI",
  },
  "controls.tiltSlowThreshold": {
    en: "Slow tilt: drawdown that triggers it",
    ru: "Медленный тильт: даунсвинг для запуска",
  },
  "controls.tiltSlowMinDuration": {
    en: "Slow tilt: how long the streak must last",
    ru: "Медленный тильт: длительность серии",
  },

  // ---- model preset selector ----
  "preset.label": { en: "Model preset", ru: "Пресет модели" },
  "preset.standard": { en: "Standard presets", ru: "Стандартные" },
  "preset.userList": { en: "My presets", ru: "Мои пресеты" },
  "preset.userEmpty": {
    en: "No saved presets yet. Tune the knobs below and hit \"Save current\".",
    ru: "Пока нет сохранённых пресетов. Покрути ручки ниже и нажми «Сохранить текущее».",
  },
  "preset.saveCurrent": { en: "Save current…", ru: "Сохранить…" },
  "preset.export": { en: "Export", ru: "Экспорт" },
  "preset.import": { en: "Import", ru: "Импорт" },
  "preset.savePrompt": {
    en: "Name this preset:",
    ru: "Название пресета:",
  },
  "preset.importInvalid": {
    en: "This file doesn't look like a valid TVS preset.",
    ru: "Это не похоже на валидный пресет TVS.",
  },
  "preset.deleteConfirm": {
    en: "Delete preset \"{name}\"?",
    ru: "Удалить пресет «{name}»?",
  },
  "preset.custom.label": { en: "Custom", ru: "Свой" },
  "preset.custom.tagline": {
    en: "Hand-tuned values — not matching any standard preset.",
    ru: "Накручено руками — ни один стандартный пресет не подходит.",
  },
  "preset.user.tagline": {
    en: "Loaded from your saved presets.",
    ru: "Загружено из твоих сохранённых пресетов.",
  },
  "preset.primedope.label": { en: "Like PrimeDope", ru: "Как на PrimeDope" },
  "preset.primedope.tagline": {
    en: "Matches the PrimeDope online calculator: every paid place is treated as equally likely once you cash, so 1st pays the same on average as a min-cash. Here only so you can see how much PrimeDope understates the real swings.",
    ru: "Считает ровно как калькулятор на сайте PrimeDope: внутри призовых все места равновероятны, поэтому 1-е место в среднем приносит ровно столько же, сколько минимальный призовой. Нужен только чтобы увидеть, насколько PrimeDope занижает реальные колебания.",
  },
  "preset.naive.label": { en: "Honest baseline", ru: "Честный базовый прогон" },
  "preset.naive.tagline": {
    en: "Fixes the overall cash-in rate set by your settings, but distributes prize places according to your ROI — most of your edge lands as deeper finishes instead of being spread evenly across the paid pool. No random noise on top, no tilt.",
    ru: "Общий % попаданий в призы фиксирован и соответствует твоим настройкам, но сами места внутри призовых распределены в соответствии с ROI — большая часть скилла реализуется в глубоких финишах, а не размазывается равномерно по всем призовым. Без дополнительного шума, без тильта.",
  },
  "preset.realisticSolo.label": {
    en: "Solo player, real life",
    ru: "Одиночный игрок, как в жизни",
  },
  "preset.realisticSolo.tagline": {
    en: "Baseline plus real life: your win rate drifts a bit from tournament to tournament and day to day, and mild tilt kicks in after deep losing runs. Use it to estimate realistic losing streaks for someone playing without a team.",
    ru: "Базовый прогон плюс жизнь: твой винрейт немного плавает от турнира к турниру и от дня ко дню, а после глубоких минусов включается лёгкий тильт. Подойдёт, чтобы прикинуть реальные серии минусов у человека, играющего без команды.",
  },
  "preset.loremcdmx.label": { en: "LoremCDMX", ru: "LoremCDMX" },
  "preset.loremcdmx.tagline": {
    en: "Tuned for a steady, disciplined regular: light random noise and a slow, rare tilt that only switches on after long, deep losing runs. Most of the sessions you play at your baseline.",
    ru: "Настроено под стабильного дисциплинированного регуляра: слабый случайный шум и медленный редкий тильт, который включается только после длинных и глубоких минусов. Большую часть времени играешь ровно.",
  },
  "controls.compareLabel": {
    en: "Compare with PrimeDope",
    ru: "Сравнить с PrimeDope",
  },
  "controls.compareHint": {
    en: "Runs a second simulation with the same seed using the PrimeDope-equivalent payout model. Two result columns plus a diff row.",
    ru: "Делает второй прогон с тем же зерном, но с моделью выплат как на сайте PrimeDope. Показывает две колонки результатов и строку с разницей.",
  },
  "controls.run": { en: "Run simulation", ru: "Запустить" },
  "controls.running": { en: "Simulating…", ru: "Считаем…" },
  "controls.stop": { en: "Stop", ru: "Остановить" },
  "controls.eta": { en: "ETA", ru: "прогноз" },
  "controls.eta.hint": {
    en: "Projected run time based on how long the previous simulation took with similar settings. Updates after each run.",
    ru: "Прогноз времени прогона по данным предыдущих симуляций при похожих настройках. Обновляется после каждого прогона.",
  },
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
  "stat.expectedProfit": { en: "Average profit", ru: "Средний профит" },
  "stat.stdDev": { en: "Profit swing", ru: "Разброс профита" },
  "stat.probProfit": { en: "Chance to be up", ru: "Шанс выйти в плюс" },
  "stat.riskOfRuin": { en: "Risk of ruin", ru: "Риск разорения" },
  "stat.itmRate": { en: "Cash-in rate", ru: "Частота призовых" },
  "stat.itmRate.sub": { en: "exact, analytical", ru: "точно, аналитически" },
  "stat.itmRate.tip": {
    en: "Share of your tournaments that cash, averaged across the whole schedule. Computed directly from the finish-place math — no sampling noise.",
    ru: "Доля твоих турниров в деньгах, усреднённая по всему расписанию. Считается напрямую из распределения мест — без шума выборки.",
  },
  "stat.var": { en: "Worst 5% / 1% runs", ru: "Худшие 5% / 1% прогонов" },
  "stat.cvar": { en: "Avg loss in worst 5% / 1%", ru: "Ср. убыток в худших 5% / 1%" },
  "stat.sharpe": { en: "Profit / swing", ru: "Профит к разбросу" },
  "stat.sortino": { en: "Profit / downside", ru: "Профит к минусу" },
  "stat.tFor95": { en: "Turneys to ±5% ROI", ru: "Турниров до точного ROI" },
  "stat.avgMaxDD": { en: "Average downswing", ru: "Средний даунсвинг" },
  "stat.ddMedian": { en: "Typical downswing", ru: "Типичный даунсвинг" },
  "stat.ddP95": { en: "1-in-20 bad run", ru: "1 из 20 плохих прогонов" },
  "stat.ddP99": { en: "1-in-100 nightmare", ru: "1 из 100 кошмарных" },
  "stat.recoveryMedian": { en: "Typical recovery", ru: "Типичное отыгрывание" },
  "stat.recoveryP90": { en: "Long recovery (1-in-10)", ru: "Долгое отыгрывание (1 из 10)" },
  "stat.recoveryUnrecovered": { en: "Never recovered", ru: "Не отыгрались" },
  "stat.cashlessMean": { en: "No-cash streak (avg)", ru: "Серия без кешей (ср.)" },
  "stat.cashlessWorst": { en: "No-cash streak (max)", ru: "Серия без кешей (макс.)" },
  "stat.bestRun": { en: "Best run", ru: "Лучший прогон" },
  "stat.worstRun": { en: "Worst run", ru: "Худший прогон" },
  "stat.p1p5": { en: "Worst 1% / 5%", ru: "Худшие 1% / 5%" },
  "stat.p95p99": { en: "Top 5% / 1%", ru: "Топ 5% / 1%" },
  "stat.longestBE": { en: "Longest break-even streak", ru: "Долгая серия без прогресса" },
  "stat.minBR5": { en: "BR for 5% ruin", ru: "БР для 5% разорения" },
  "stat.bankrollOff": { en: "bankroll off", ru: "банкролл выкл" },
  "stat.ddBI": { en: "Downswing (BI)", ru: "Даунсвинг (бай-ины)" },
  "stat.skew": { en: "Profit tilt", ru: "Перекос профита" },
  "stat.kurt": { en: "Tail fatness", ru: "Толщина хвостов" },
  "stat.kelly": { en: "Kelly fraction", ru: "Доля по Келли" },
  "stat.kellyBR": { en: "Kelly BR", ru: "БР по Келли" },
  "stat.logG": { en: "BR growth rate", ru: "Темп роста БР" },

  // Results — charts
  "chart.trajectory": { en: "Bankroll trajectory", ru: "Траектория банкролла" },
  "chart.trajectory.sub": {
    en: "Envelopes at 70 % / 95 % / 99.7 % confidence · 20 random samples · best / worst",
    ru: "Огибающие 70 % / 95 % / 99.7 % · 20 случайных сэмплов · лучший / худший",
  },
  "chart.trajectory.sub.vs": {
    en: "Side-by-side: our model vs the PrimeDope calculator — same seed, same schedule, identical Y-axis",
    ru: "Бок-о-бок: наша модель против калькулятора PrimeDope — одно и то же зерно, то же расписание, одна шкала",
  },
  "chart.trajectory.ours.cap": {
    en: "Skill lands you in deep finishes — big prizes up top drive realistic swings",
    ru: "Скилл работает в глубоких финишах — большие выплаты сверху дают настоящие колебания",
  },
  "chart.trajectory.theirs.cap": {
    en: "Every paid place weighted equally — 1st place pays the same average as a min-cash, drastically understating the real swings",
    ru: "Все призовые места равновероятны — 1-е место в среднем платит столько же, сколько минимальный призовой, и настоящие колебания резко занижены",
  },
  "chart.trajectory.pdWarning": {
    en: "Why this is wrong: PrimeDope's site assumes that once you cash, every paid place is equally likely — a min-cash is as probable as winning the whole thing. That erases every bit of the big-prize variance at the top, makes losing streaks look roughly 30% shallower than reality, and guarantees the bankroll it suggests will be way too small.",
    ru: "Почему это неправильно: PrimeDope считает, что если ты попал в призы, то все места внутри призовых равновероятны — минимальный кэш случается так же часто, как победа в турнире. Это стирает всю дисперсию от больших выплат сверху, занижает длинные минусы примерно на 30% и гарантирует, что банкролл по такой модели будет сильно меньше нужного.",
  },
  "chart.trajectory.oursFix": {
    en: "How we fix it: our overall cash-in rate matches PrimeDope's — the difference is where inside the paid pool you end up. We distribute prize places according to your ROI: a skilled player's chance of landing 1st, 2nd or 3rd is meaningfully above the paid-pool average, not spread evenly across every cashing spot. The big prizes up top get their proper weight back, and long losing runs get their true depth.",
    ru: "Как мы это решаем: общий % попаданий в призы у нас такой же, как у PrimeDope, — разница в том, куда именно внутри призовых ты финишируешь. Мы распределяем призовые места в соответствии с твоим ROI: шанс скиллового игрока занять 1-е, 2-е или 3-е место значимо выше среднего по призовым, а не размазан равномерно по всем кэшам. Большие выплаты сверху получают свой настоящий вес, а длинные минусы — свою настоящую глубину.",
  },
  "chart.trajectory.overlay": {
    en: "Overlay PrimeDope on the left",
    ru: "Наложить PrimeDope слева",
  },
  "chart.trajectory.overlayHint": {
    en: "Show PrimeDope's narrower envelope (mean / p2.5 / p97.5) over our chart so the gap is unmistakable",
    ru: "Показать узкие огибающие PrimeDope (среднее / p2.5 / p97.5) поверх нашего графика, чтобы разница была видна сразу",
  },
  "chart.trajectory.sharedY": {
    en: "Both charts share the same Y-axis range so the visual difference in envelope width is directly comparable.",
    ru: "У обоих графиков общий диапазон по оси Y — ширина огибающих видна на глаз и напрямую сравнима.",
  },
  "chart.trajectory.gapTitle": {
    en: "How big is the gap",
    ru: "Насколько велик разрыв",
  },
  "chart.trajectory.gapSpread": {
    en: "95% final-profit spread",
    ru: "95%-й разброс итогового профита",
  },
  "chart.trajectory.gapDd": {
    en: "Worst-case drawdown (p97.5)",
    ru: "Худший даунсвинг (p97.5)",
  },
  "chart.trajectory.gapRatio": {
    en: "{ratio}× wider than PrimeDope",
    ru: "в {ratio}× шире, чем PrimeDope",
  },
  "chart.trajectory.gapRatioDeeper": {
    en: "{ratio}× deeper than PrimeDope",
    ru: "в {ratio}× глубже, чем PrimeDope",
  },
  "chart.trajectory.gapExplain": {
    en: "The gap is real, not a rendering bug: our model concentrates cash probability on top finishes (where 80%+ of the prize pool lives), while PrimeDope treats every paid place as equally likely. Same mean profit, radically different tails — and the tails are what eat your bankroll.",
    ru: "Разрыв реальный, а не глюк отрисовки: наша модель концентрирует вероятность призовых мест в верху (там где живёт 80%+ всего призового фонда), а PrimeDope считает, что любое призовое место равновероятно. Среднее одинаковое, но хвосты радикально разные — а банкролл едят именно хвосты.",
  },
  "chart.dist": { en: "Distribution of final profit", ru: "Распределение итогового профита" },
  "chart.ddDist": { en: "Max drawdown distribution", ru: "Распределение макс. даунсвинга" },
  "chart.ddDist.sub": {
    en: "Per-sample worst peak-to-trough dip during the run",
    ru: "Худший пик-то-дно каждого сэмпла за прогон",
  },
  "chart.longestBE": { en: "Longest breakeven streak", ru: "Самая длинная серия без прогресса" },
  "chart.longestBE.sub": {
    en: "How many tournaments in a row you spend going nowhere",
    ru: "Сколько турниров подряд ты топчешься на месте",
  },
  "chart.longestCashless": { en: "Longest streak without a cash", ru: "Самая длинная серия без призовых" },
  "chart.longestCashless.sub": {
    en: "How many tournaments in a row you play without landing a cash",
    ru: "Сколько турниров подряд ты играешь без попадания в призы",
  },
  "chart.recovery": { en: "Recovery length", ru: "Длина восстановления" },
  "chart.recovery.sub": {
    en: "Tournaments from the trough of the deepest downswing back to the pre-downswing peak",
    ru: "Сколько турниров с дна самого глубокого даунсвинга до возврата на прежний пик",
  },
  "chart.recovery.unrecovered": {
    en: "{pct} of runs never recovered by end of schedule (not shown above)",
    ru: "{pct} прогонов не восстановились до конца расписания (не показано на графике)",
  },
  "chart.unit.tourneys": { en: "units: tournaments", ru: "единицы: турниры" },
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

  "unit.money": { en: "$", ru: "$" },
  "unit.abi": { en: "ABI", ru: "АБИ" },
  "unit.tourneys": { en: "tournaments", ru: "турниров" },
  "unit.displayLabel": { en: "Display in", ru: "Показывать в" },

  "lineStyle.label": { en: "Line style", ru: "Стиль линий" },
  "runs.label": { en: "Runs shown", ru: "Показано ранов" },
  "refLines.label": { en: "Ref ROI", ru: "ROI линии" },
  "refLines.title": { en: "ROI reference lines", ru: "Опорные ROI линии" },
  "refLines.enabled": { en: "Show line", ru: "Показывать линию" },
  "refLines.color": { en: "Line color", ru: "Цвет линии" },
  "refLines.roi": { en: "ROI %", ru: "ROI %" },
  "refLines.remove": { en: "Remove", ru: "Удалить" },
  "refLines.add": { en: "Add line", ru: "Добавить линию" },
  "section.verdict": { en: "Verdict", ru: "Вердикт" },
  "section.primedopeReport": { en: "PrimeDope report", ru: "PrimeDope отчёт" },
  "section.pdWeakness": { en: "PokerDope model flaws", ru: "Минусы модели PokerDope" },
  "section.settingsDump": { en: "Run settings", ru: "Настройки прогона" },
  "section.pdVerdict": { en: "PrimeDope verdict", ru: "Вердикт PrimeDope" },
  "section.pdDiff": { en: "PrimeDope diff", ru: "Разница с PrimeDope" },
  "lineStyle.customize": { en: "Customize", ru: "Настроить" },
  "lineStyle.reset": { en: "Reset", ru: "Сброс" },
  "lineStyle.resetAll": { en: "Reset all", ru: "Сбросить всё" },
  "lineStyle.width": { en: "Width", ru: "Толщина" },
  "lineStyle.line.mean": { en: "Mean winnings", ru: "Средний выигрыш" },
  "lineStyle.line.ev": { en: "EV", ru: "EV" },
  "lineStyle.line.best": { en: "Luckiest run", ru: "Лучший прогон" },
  "lineStyle.line.worst": { en: "Unluckiest run", ru: "Худший прогон" },
  "presets.export": { en: "Export", ru: "Экспорт" },
  "presets.import": { en: "Import", ru: "Импорт" },
  "presets.importError": {
    en: "Could not read that file — expected JSON exported from variance.lab.",
    ru: "Не смог прочитать файл — ожидается JSON, экспортированный из variance.lab.",
  },
  "presets.importDone": {
    en: "Imported {n} preset(s).",
    ru: "Импортировано пресетов: {n}.",
  },
  "changelog.title": { en: "Changelog", ru: "Чейнджлог" },
  "changelog.v03.title": { en: "v0.3 — current", ru: "v0.3 — текущая" },
  "changelog.v03.preview": {
    en: "Redesigned right-side tournament preview (narrative layout, top-heaviness callout).",
    ru: "Переделан правый виджет турнира — новый нарратив, акцент на top-heavy структуру.",
  },
  "changelog.v03.unit": {
    en: "$/ABI unit toggle on trajectory, distribution and drawdown charts.",
    ru: "Переключатель $/АБИ на графиках траектории, распределения и даунсвингов.",
  },
  "changelog.v03.presets": {
    en: "Line style presets (Hand2Note, PT4, HM3, PokerDope) with live preview and per-line color/width overrides.",
    ru: "Пресеты стилей линий (Hand2Note, PT4, HM3, PokerDope) с живым превью и индивидуальной настройкой цвета/толщины.",
  },
  "changelog.v03.exportImport": {
    en: "Export/import your presets as a JSON file, or copy a share link from any saved preset — move them between devices without an account.",
    ru: "Экспорт/импорт пользовательских пресетов в JSON или копирование share-ссылки прямо с карточки — переносите между устройствами без регистрации.",
  },
  "changelog.v03.ru": {
    en: "Plain-Russian pass across stats and tooltips.",
    ru: "Прошёлся по русской локализации — убрал корявости в статах и подсказках.",
  },
  "changelog.v03.layout": {
    en: "Controls panel alignment + fixed empty space under the Run button.",
    ru: "Выровнял панель настроек и убрал пустоту под кнопкой запуска.",
  },
  "changelog.next": {
    en: "Coming next: per-line color/width overrides on top of presets.",
    ru: "Дальше: индивидуальная настройка цвета и толщины линий поверх пресетов.",
  },
  "footer.madeBy": { en: "made by", ru: "сделал" },

  "chart.convergence.help": {
    en: "Y = running mean estimate of profit per simulation. The shaded band is the 95% confidence interval, which should narrow as samples accumulate. Look for: (a) the line stops drifting and stays flat — the run has enough samples to trust the mean; (b) the band is much narrower than the value of the mean — the estimate is precise. Bad signs: line still walking, band still wide.",
    ru: "Y — текущая оценка среднего профита по симуляциям. Закрашенная полоса — 95% доверительный интервал, должен сужаться по мере накопления сэмплов. На что смотреть: (а) линия перестала дрейфовать и держится ровно — сэмплов достаточно, среднему можно верить; (б) ширина полосы сильно меньше значения среднего — оценка точная. Плохо: линия гуляет, полоса широкая.",
  },
  "chart.sensitivity.help": {
    en: "X = how wrong your ROI input is in percentage points (e.g. −2pp means real ROI is 2pp lower than configured). Y = expected profit at that real ROI. Use this to ask: 'if my edge is actually 1–2pp worse than I think, am I still profitable?' Slope shows how much each pp of ROI is worth in $. A steep curve means your bottom line is very sensitive to whether your ROI estimate is right.",
    ru: "X — насколько ваш ROI ошибочен (в процентных пунктах: −2пп = реальный ROI на 2пп ниже заданного). Y — ожидаемая прибыль при таком реальном ROI. Смысл: 'если мой эдж реально на 1–2пп хуже, чем я думаю, я ещё в плюсе?'. Наклон показывает, сколько $ стоит каждый пп ROI. Крутая кривая — итог сильно зависит от точности оценки ROI.",
  },
  "chart.decomp.help": {
    en: "Each row of your schedule contributes some chunk of the total expected profit AND some chunk of the total variance. The bars compare these two contributions side-by-side. Rows where variance share >> EV share are the ones swinging your bankroll without proportionally rewarding you — they're high-variance, low-edge slots. Rows where EV share >> variance share are your stable money-makers.",
    ru: "Каждая строка расписания вносит вклад и в общую ожидаемую прибыль, И в общую дисперсию. Столбики сравнивают эти два вклада бок-о-бок. Строки, где доля дисперсии >> доли EV — это турниры, которые шатают банкролл без пропорционального вознаграждения (высокая дисперсия, низкий эдж). Строки, где доля EV >> доли дисперсии — ваши стабильные кормильцы.",
  },

  // PrimeDope diff
  "pd.title": {
    en: "Us vs PrimeDope",
    ru: "Мы против PrimeDope",
  },
  "pd.subtitle": {
    en: "Same seed, same schedule — the only difference is the payout model. PrimeDope collapses every paid place into one average payout, so its losing runs and rare outcomes are structurally softer than reality.",
    ru: "Одно и то же зерно, то же расписание — отличается только модель выплат. PrimeDope сводит все призовые места к одной средней сумме, из-за чего длинные минусы и редкие исходы у него всегда мягче реальности.",
  },
  "pd.ours": { en: "ours", ru: "наши" },
  "pd.theirs": { en: "primedope", ru: "primedope" },
  "pd.reproduce.label": { en: "Open in PrimeDope", ru: "Открыть в PrimeDope" },
  "pd.reproduce.copied": { en: "Copied ✓ opening…", ru: "Скопировано ✓ открываем…" },
  "pd.reproduce.hint": {
    en: "PrimeDope has no pre-fill URL — we open their site and copy a cheat-sheet of your values to the clipboard so you can paste them in.",
    ru: "PrimeDope не поддерживает предзаполнение — мы открываем их сайт и кладём шпаргалку с твоими параметрами в буфер обмена, чтобы ты вставил их вручную.",
  },
  "pd.metric": { en: "Metric", ru: "Метрика" },
  "pd.delta": { en: "Δ", ru: "Δ" },
  "pd.row.itm": { en: "Cash-in rate", ru: "Частота призовых" },
  "pd.row.stdDev": { en: "Profit swing", ru: "Разброс профита" },
  "pd.row.dd": { en: "Average downswing", ru: "Средний даунсвинг" },
  "pd.row.cvar": { en: "Avg loss in worst 5%", ru: "Ср. убыток в худших 5%" },
  "pd.row.pprofit": { en: "Chance to be up", ru: "Шанс выйти в плюс" },
  "pd.row.ror": { en: "Risk of ruin", ru: "Риск разорения" },
  "pd.row.var95": { en: "Worst 5% runs", ru: "Худшие 5% прогонов" },
  "pd.row.cvar99": { en: "Avg loss in worst 1%", ru: "Ср. убыток в худших 1%" },
  "pd.row.worstRun": { en: "Worst run", ru: "Худший прогон" },
  "pd.row.bestRun": { en: "Best run", ru: "Лучший прогон" },
  "pd.row.longestBE": { en: "Longest breakeven streak", ru: "Долгая серия без прогресса" },
  "pd.row.sharpe": { en: "Profit / swing", ru: "Профит к разбросу" },
  "pd.row.ddWorst": { en: "Worst downswing ever seen", ru: "Худший даунсвинг за прогон" },

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
  "verdict.streak.upswing": {
    en: "Good streaks: the top 5 % of runs finish at {p95} or better, with the absolute best landing at {best}.",
    ru: "Хорошие серии: верхние 5 % прогонов заканчиваются на {p95} и выше, абсолютный максимум — {best}.",
  },
  "verdict.streak.downswing": {
    en: "Bad streaks: a typical drop from peak to bottom is {ddMean} (about {ddBi} buy-ins); 5 % of runs dig at least {ddP95} deep. That's the hole you need to be prepared to sit in.",
    ru: "Плохие серии: типичное падение от пика до дна — {ddMean} (около {ddBi} байинов); 5 % прогонов уходят минимум на {ddP95}. Это яма, в которой нужно уметь сидеть.",
  },
  "verdict.streak.dry": {
    en: "Dry stretches: on average the longest streak without progress is {be} tournaments and the longest streak without a cash is {cashless}; the worst cashless stretch hits {cashlessWorst}.",
    ru: "Сухие полосы: в среднем самая длинная серия без прогресса — {be} турниров, самая длинная серия без призовых — {cashless}; в худшем случае серия без призовых доходит до {cashlessWorst}.",
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
  "verdict.precision.good": {
    en: "Run precision: ±{ci} on EV (±{rel} of the reported ROI). {samples} samples is enough — pushing it higher barely tightens anything.",
    ru: "Точность прогона: ±{ci} на EV (±{rel} от заявленного ROI). {samples} сэмплов — уже достаточно, дальше жать бесполезно.",
  },
  "verdict.precision.meh": {
    en: "Run precision: ±{ci} on EV (±{rel} of the reported ROI). To tighten to ±1 % you'd need ≈{need} samples.",
    ru: "Точность прогона: ±{ci} на EV (±{rel} от заявленного ROI). Чтобы дотянуть до ±1 %, нужно ≈{need} сэмплов.",
  },
  "verdict.precision.bad": {
    en: "Run precision: ±{ci} on EV — that's ±{rel} of the reported ROI, so the number is within MC noise. Bump samples to ≈{need} before trusting the sign.",
    ru: "Точность прогона: ±{ci} на EV — это ±{rel} от заявленного ROI, то есть цифра в пределах MC-шума. Подними сэмплы до ≈{need}, прежде чем верить знаку.",
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
    en: "Profit swing per tournament",
    ru: "Разброс профита на турнир",
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
    en: "We auto-fit the skill curve to your ROI, then resample every tournament with a skill-weighted distribution (power-law / stretched-exp / linear / empirical). The resulting profit swing is what the math actually says your schedule will do.",
    ru: "Мы автоматически подгоняем кривую скилла под твой ROI и пересэмплируем каждый турнир со скилл-взвешенным распределением (power-law / stretched-exp / линейная / эмпирическая). Получающийся разброс профита — это то, что математика реально говорит про твоё расписание.",
  },
  "pdv.takeaway": {
    en: "Translation: if you budget your bankroll off PrimeDope numbers, your 1-in-20 bad run will be {mult}× worse than the website warned you about.",
    ru: "Перевод: если считаешь банкролл по цифрам PrimeDope, то реальный худший сценарий 1-из-20 будет в {mult}× хуже, чем предсказывает сайт.",
  },
  "pdv.takeawayNeg": {
    en: "Translation: PrimeDope overstates your variance here. Your schedule is genuinely tighter than their model assumes.",
    ru: "Перевод: PrimeDope здесь переоценивает дисперсию. Твоё расписание реально стабильнее их модели.",
  },
  "pdv.externalTitle": {
    en: "Independent cross-check.",
    ru: "Независимая проверка.",
  },
  "pdv.externalBody": {
    en: "Measured on real fund data (bitB Staking), ITM at 20% ROI sits near 17% — while PrimeDope's uniform-lift model predicts ~21%. This is corroboration from outside our codebase:",
    ru: "На реальных данных фонда (bitB Staking) ITM при ROI 20% держится около 17%, тогда как модель PrimeDope (uniform lift) предсказывает ~21%. Это подтверждение извне нашей кодовой базы:",
  },
  // Explainer (legacy, still referenced)
  "why.title": { en: "Why our numbers differ", ru: "Почему у нас цифры другие" },
  "why.body": {
    en: "PrimeDope models skill as a uniform lift over paid places: every paid finish gets the same bumped probability k/N. That's mathematically cleanest but wrong — real winners concentrate in deep finishes, not min-cashes. Our α-calibration fits a parametric skill model (power-law / stretched-exp / linear) so that cashes bias toward the top, reproducing the Muchomota 2024 observation that real-sample ITM sits ~3 pp below PrimeDope at 20% ROI. This matters for drawdowns too — flatter-ITM models understate swings.",
    ru: "PrimeDope моделирует скилл как плоский лифт по призовым: каждое призовое место получает одинаковый повышенный шанс k/N. Это математически чистенько, но неверно — настоящие скилл-игроки чаще заходят глубоко, а не на мин-кеше. Наша α-калибровка натягивает параметрическую модель (power-law / stretched-exp / линейная) так, чтобы кеши смещались к верху — это воспроизводит наблюдение Muchomota (2024), что реальный ITM на ~3 пп ниже, чем у PrimeDope при 20% ROI. Это бьёт и по даунсвингам — плоский ITM занижает свинги.",
  },
  // Preview
  "preview.title": { en: "One tournament under the microscope", ru: "Один турнир под микроскопом" },
  "preview.sub": {
    en: "For a single entry to this tournament: what the buy-in is, what your expected profit per entry looks like, and where that expectation actually comes from.",
    ru: "Что происходит, когда ты заносишь в этот турнир один раз: какой баин, какой средний профит с одного входа и откуда это среднее реально набирается.",
  },
  "preview.eyebrow": { en: "One tournament", ru: "Один турнир" },
  "preview.youPay": { en: "Buy-in", ru: "Баин" },
  "preview.avgReturn": { en: "EV profit", ru: "EV профит" },
  "preview.playersLabel": { en: "players", ru: "соперников" },
  "preview.itmLine": {
    en: "ITM {pct} (1 cash every {n} entries)",
    ru: "ITM {pct} (1 кеш в среднем на {n} входов)",
  },
  "preview.sigmaLabel": { en: "variance", ru: "диспа" },
  "preview.heroTitle": { en: "Where the average hides", ru: "Где прячется твоё среднее" },
  "preview.heroBodyTop1": {
    en: "{share} of your expected return comes from 1st place — which you take 1 in {odds} entries.",
    ru: "{share} всего ожидания приходит с 1-го места, а его ты берёшь 1 раз из {odds}.",
  },
  "preview.heroBodyTopN": {
    en: "{share} of your expected return comes from top-{n} finishes — which happen 1 in {odds} entries.",
    ru: "{share} всего ожидания приходит с топ-{n} финишей, а они случаются 1 раз из {odds}.",
  },
  "preview.heroTagline": {
    en: "That's why tournament swings are brutal: most of the money is locked inside rare finishes.",
    ru: "Поэтому колебания в турнирах такие злые: большая часть денег заперта в редких финишах.",
  },
  "preview.rowPicker": {
    en: "Row",
    ru: "Строка",
  },
  "preview.statItm": { en: "ITM", ru: "ITM" },
  "preview.statTop1": { en: "EV from top 1%", ru: "EV из топ-1%" },
  "preview.statTop1Hint": {
    en: "share of mean payout that comes from the best 1% of finishes",
    ru: "доля среднего выигрыша, которая приходит с лучшего 1% финишей",
  },
  "preview.statCv": { en: "Payout CV", ru: "CV выплаты" },
  "preview.statCvHint": {
    en: "std ÷ mean of single-tourney payout — tail thickness",
    ru: "σ ÷ среднее одного турнира — толщина хвоста",
  },
  "preview.statBounty": { en: "Bounty share", ru: "Доля ноков" },
  "preview.statBountyPko": {
    en: "progressive PKO",
    ru: "прогрессивные PKO",
  },
  "preview.statBountyFlat": {
    en: "flat KO",
    ru: "обычные KO",
  },
  "preview.statBountyNone": {
    en: "freezeout",
    ru: "фризаут",
  },
  "preview.evBreakdown": {
    en: "Where the profit comes from",
    ru: "Откуда приходит профит",
  },
  "preview.colEv": { en: "% of EV", ru: "% EV" },
  "preview.colField": { en: "top %", ru: "топ %" },
  "preview.barEvLabel": { en: "share of EV", ru: "доля EV" },
  "preview.barFieldLabel": { en: "share of finishes", ru: "доля финишей" },
  "preview.tierWinner": { en: "1st place", ru: "1-е место" },
  "preview.tierTop1": { en: "Top 1%", ru: "Топ 1%" },
  "preview.tierTop10": { en: "Top 10%", ru: "Топ 10%" },
  "preview.tierRestItm": { en: "Rest of cashes", ru: "Остальные кеши" },
  "preview.tierOotm": { en: "OOTM bust", ru: "Без денег" },
  "preview.footnote": {
    en: "If the top (EV) bar is much wider than the bottom (finishes) bar in the same colour, that slice of finishes carries way more money than its share of the field — and that's exactly where your variance lives.",
    ru: "Если верхний (EV) бар в каком-то цвете сильно шире нижнего (финиши) — этот кусок финишей приносит сильно больше денег, чем его доля в поле. Именно там и живёт твоя дисперсия.",
  },

  // Footer
  "footer.line": {
    en: "Tournament variance simulator · Next.js 16 + React 19 + uPlot · seeded determinism ·",
    ru: "Симулятор дисперсии в MTT · Next.js 16 + React 19 + uPlot · детерминизм через зерно ·",
  },
  "footer.state": {
    en: "state autosaved and shareable via URL",
    ru: "состояние автосохраняется и шарится по URL",
  },
  "footer.github": {
    en: "source on GitHub",
    ru: "исходники на GitHub",
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
    en: "How many alternative futures to simulate — each one is one full replay of your schedule.\n\nExample: 10,000 = you get to see 10,000 different ways your schedule could unfold.\n\nEffect: more simulations ⇒ smoother numbers for swings, worst runs, and tail scenarios; slower to compute. 5k is quick, 50k is overkill-nice.",
    ru: "Сколько альтернативных вариантов будущего прогнать — каждый это один полный проход твоего расписания.\n\nПример: 10 000 = посмотришь 10 000 вариантов, как могло бы сложиться.\n\nЭффект: больше симуляций ⇒ точнее цифры по свингам, худшим прогонам и хвостам; дольше считается. 5k — быстро, 50k — с запасом.",
  },
  "help.compareMode": {
    en: "What to put on the right side of the trajectory chart.\n\n• Two random runs — the same model rolled twice with different seeds. Shows how wildly two honest runs of the same setup can diverge.\n• Ours vs PrimeDope — our calibrated model on the left, PrimeDope's uniform-lift on the right, both on the same seed. Shows how the algorithm choice changes the answer on identical randomness.",
    ru: "Что показать справа от траектории.\n\n• Два рандомных прогона — одна и та же модель прокатывается дважды с разными сидами. Видно, насколько могут разойтись два честных прогона одного и того же сетапа.\n• Наш vs PrimeDope — наша калиброванная модель слева, PrimeDope'овский uniform-lift справа, оба на одном сиде. Видно, как выбор алгоритма меняет ответ на одинаковом рандоме.",
  },
  "help.bankroll": {
    en: "Current bankroll in $. Enables risk-of-ruin, Kelly bankroll, and log-growth metrics.\n\nExample: 5000 = a $5k roll. 0 = ignore bankroll, skip ruin math.\n\nEffect: adds a −bankroll line on the trajectory chart; any sample that crosses it counts as ruined.",
    ru: "Текущий банкролл в $. Включает риск разорения, Kelly-банкролл и log-growth.\n\nПример: 5000 = банкролл $5k. 0 = банкролл игнорируется, ruin-математика отключается.\n\nЭффект: на графике появится линия −банкролл; сэмпл, который её пересёк, считается разорением.",
  },
  "help.finishModel": {
    en: "How your skill distributes across finish places — does it mostly show up as deep runs, or as lots of small cashes?\n\nOptions:\n• Power-law — skill pays off deep; the closer to 1st, the bigger the lift. (default, best match to real samples)\n• Linear skill — steady lift toward the top, less dramatic\n• Stretched-exp — middle ground between those two\n• Plackett–Luce — classic ranking model, mathematically sound\n• Uniform — every paid place gets the same lift (PrimeDope-style — understates swings)\n• Empirical — built from a CSV of your own real finish history",
    ru: "Как твой скилл распределяется по местам — ты чаще заходишь глубоко, или просто набиваешь мин-кеши?\n\nОпции:\n• Power-law — скилл работает в глубоких финишах; чем ближе к 1-му, тем сильнее лифт. (дефолт, лучше всего ложится на реальные выборки)\n• Linear skill — плавный лифт к топу, менее драматичный\n• Stretched-exp — что-то среднее между этими двумя\n• Plackett–Luce — классическая модель ранжирования, математически чистая\n• Uniform — все призовые получают одинаковый буст (как у PrimeDope — занижает свинги)\n• Empirical — по CSV твоих реальных финишей",
  },
  "help.alphaOverride": {
    en: "Force the skill-curve sharpness by hand instead of fitting to your target ROI.\n\nExample: leave blank to let the engine auto-fit. 1.0 = neutral, 2.0 = very aggressive concentration near 1st place.\n\nEffect: advanced — ignore unless you want to freeze the shape of the skill curve and deliberately miss your ROI target.",
    ru: "Жёстко задать крутизну кривой скилла вместо автоподгонки под твой ROI.\n\nПример: оставь пустым — подгоним автоматически. 1.0 — нейтрально, 2.0 — агрессивная концентрация у 1-го места.\n\nЭффект: продвинутое — трогай только если хочешь зафиксировать форму кривой скилла и сознательно промахнуться по ROI.",
  },
  "help.seed": {
    en: "Starting point for the random number generator — same seed gives identical results.\n\nExample: 42, 1337, 2025. Any integer.\n\nEffect: change it to draw a different set of outcomes on the same schedule; keep it fixed to reproduce a run exactly (useful for comparing tweaks).",
    ru: "Стартовая точка генератора случайных чисел — одно и то же зерно = один и тот же результат.\n\nПример: 42, 1337, 2025. Любое целое.\n\nЭффект: меняй, чтобы перегнать другую выборку на том же расписании; оставь фиксированным, чтобы воспроизвести прогон точно (удобно для сравнения правок).",
  },
  "help.roiStdErr": {
    en: "How uncertain you are about your real ROI, as a fraction.\n\nExample: 0.05 = \"maybe my true ROI is ±5 pp off what I think\". 0 = you know your ROI exactly (PrimeDope's assumption).\n\nEffect: on every simulated run, the engine rolls a random skill shift and applies it to every bullet. Captures the real-world risk that you're a worse player than you think — the biggest source of bad-tail swings that PrimeDope completely ignores.",
    ru: "Насколько ты не уверен в своём реальном ROI (как доля).\n\nПример: 0.05 = «может, мой настоящий ROI на ±5 пп не такой, как я думаю». 0 = ты знаешь свой ROI идеально (допущение PrimeDope).\n\nЭффект: на каждом прогоне движок бросает случайный сдвиг скилла и применяет его к каждой пуле. Моделирует реальный риск «я хуже, чем думаю» — главный источник хвостовых даунсвингов, который PrimeDope полностью игнорирует.",
  },
  "help.roiShockPerTourney": {
    en: "Per-tournament ROI shock (σ, in ROI fraction).\n\nWhat it means: every tournament randomly gets a softer or tougher field than your average. Independent draw per tournament — uncorrelated noise that averages out as 1/√n with volume.\n\nExample: 0.30 = each tourney's effective ROI is your target ± 30 pp (1σ).\n\nUse for: \"the field at this specific tournament happened to be soft/tough\". Doesn't change long-run mean — only adds variance. Models the chunk of variance PrimeDope completely misses.",
    ru: "Шок ROI на каждый турнир (σ, в долях ROI).\n\nЧто это: каждый турнир случайно получает поле слабее или сильнее среднего. Независимый розыгрыш на каждый турнир — некоррелированный шум, который сглаживается как 1/√n с объёмом.\n\nПример: 0.30 = эффективный ROI каждого турнира = твой таргет ± 30 пп (1σ).\n\nЗачем: «именно в этом турнире поле случайно мягкое/жёсткое». Среднее в долгую не двигает — только разброс. Моделирует ту часть дисперсии, которую PrimeDope полностью упускает.",
  },
  "help.roiShockPerSession": {
    en: "Per-session ROI shock (σ, in ROI fraction).\n\nWhat it means: one random shift applied to ALL tournaments in the same schedule pass. Captures the \"today the field is fishy\" or \"today I'm in form / off form\" effect — correlated within a session, independent between sessions.\n\nExample: 0.05 = on a typical day your effective ROI is your target ± 5 pp.\n\nUse for: explains why daily P&L swings are larger than the sum of independent tournaments would predict. Real grinders see this constantly; PrimeDope's independence assumption misses it entirely.",
    ru: "Шок ROI на сессию (σ, в долях ROI).\n\nЧто это: один случайный сдвиг применяется ко ВСЕМ турнирам одного прохода расписания. Ловит «сегодня поле жирное» или «сегодня я в форме / не в форме» — коррелированно внутри сессии, независимо между сессиями.\n\nПример: 0.05 = в типичный день эффективный ROI = твой таргет ± 5 пп.\n\nЗачем: объясняет, почему дневной разброс PnL больше, чем дала бы сумма независимых турниров. Грайндер это видит постоянно; PrimeDope с допущением независимости полностью это упускает.",
  },
  "help.roiDriftSigma": {
    en: "Long-term ROI drift σ (AR1, ρ ≈ 0.95).\n\nWhat it means: a slow random-walk-with-memory process advanced once per session. Models meta shifts, roster turnover, seasonality — the kind of multi-month drift you can't see at the day-to-day level.\n\nExample: 0.02 = your underlying ROI quietly drifts by ~2 pp over many sessions, then mean-reverts.\n\nUse for: makes the long-run mean non-stationary. Without this, all variance has to be packed into short-term noise, which underestimates real-life multi-month bad runs.",
    ru: "Медленный дрейф ROI (σ, AR1 ρ ≈ 0.95).\n\nЧто это: медленный «случайное-блуждание-с-памятью» процесс, продвигаемый раз в сессию. Моделирует мета-сдвиги, ротацию состава, сезонность — тот многомесячный дрейф, который не видно на дневном горизонте.\n\nПример: 0.02 = твой настоящий ROI тихо дрейфует на ~2 пп за много сессий, потом возвращается.\n\nЗачем: делает среднее в долгую нестационарным. Без него всю дисперсию приходится паковать в короткий шум, и тогда реальные многомесячные стрики недооценены.",
  },
  "help.tiltFastGain": {
    en: "FAST tilt — symmetric ROI shift driven by current drawdown depth (smooth, immediate).\n\nFormula: ROI shift = −gain × tanh(currentDrawdown / scale).\n\nExample: gain = −0.30 + scale = $5000 → at $5k drawdown your effective ROI drops by ≈ 23 pp; at $15k drawdown by ≈ 30 pp (saturates).\n\nPositive gain = play SHARPER when down (rare). Negative gain = play WORSE when down (typical tilter). 0 = off.\n\nUse for: nervous grinders whose play degrades the second they're stuck.",
    ru: "БЫСТРЫЙ тильт — симметричный сдвиг ROI от текущей глубины даунсвинга (плавный, мгновенный).\n\nФормула: сдвиг ROI = −gain × tanh(текущий_dd / scale).\n\nПример: gain = −0.30 и scale = $5000 → при даунсвинге $5k эффективный ROI падает на ≈ 23 пп; при $15k — на ≈ 30 пп (выходит на плато).\n\nПоложительный gain = играешь ОСТРЕЕ под минусом (редкий тип). Отрицательный gain = играешь ХУЖЕ под минусом (обычный тильтун). 0 = выключено.\n\nЗачем: для нервных грайндеров, чья игра рушится сразу как застрял.",
  },
  "help.tiltFastScale": {
    en: "Dollar scale for the fast tilt's tanh — drawdown depth at which the shift reaches ≈ 76% of its max.\n\nExample: 5000 means \"a $5k drawdown is what really starts to hurt me\". Smaller = more sensitive.",
    ru: "Долларовый масштаб для tanh быстрого тильта — глубина даунсвинга, на которой сдвиг достигает ≈ 76% от максимума.\n\nПример: 5000 = «$5k даун — это то, что меня реально начинает выбивать». Меньше = чувствительнее.",
  },
  "help.tiltSlowGain": {
    en: "SLOW tilt — state machine with hysteresis. Player sits in NORMAL state until they spend min duration past threshold, then enters DOWN-TILT (or UP-TILT). While tilted, ROI is shifted by ±gain. State exits ONLY after recovering recovery-frac of the original swing.\n\nExample: gain = 0.05, threshold = $5000, duration = 500, recovery = 0.5. After grinding 500+ tournaments straight in a $5k+ drawdown, you flip into DOWN-TILT and lose 5 pp of ROI. You stay tilted until you've climbed back $2.5k.\n\n0 = off. Use for: stable regs whose play only degrades on long, deep stretches.",
    ru: "МЕДЛЕННЫЙ тильт — конечный автомат с гистерезисом. Игрок сидит в NORMAL, пока не проведёт мин. длительность за порогом, потом входит в DOWN-TILT (или UP-TILT). Пока в тильте, ROI сдвинут на ±gain. Выход из состояния ТОЛЬКО после возврата на recovery-frac от исходного стрика.\n\nПример: gain = 0.05, порог = $5000, длительность = 500, recovery = 0.5. После 500+ турниров подряд в даунсвинге $5k+ переключаешься в DOWN-TILT и теряешь 5 пп ROI. Сидишь в тильте, пока не отыграешь $2.5k.\n\n0 = выключено. Зачем: для стабильных регов, чья игра проседает только на долгих глубоких стриках.",
  },
  "help.tiltSlowThreshold": {
    en: "Dollar drawdown (or upswing) depth required to start the slow-tilt countdown. Smaller = easier to enter tilt.",
    ru: "Глубина даунсвинга (или апсвинга) в долларах для запуска отсчёта медленного тильта. Меньше = легче войти в тильт.",
  },
  "help.tiltSlowMinDuration": {
    en: "Number of tournaments you must stay past the threshold before slow-tilt actually engages. Defaults to 500. Short streaks (< this) don't matter — only sustained ones do.",
    ru: "Сколько турниров подряд нужно сидеть за порогом, чтобы медленный тильт реально включился. По умолчанию 500. Короткие стрики (< этого) не влияют — только устойчивые.",
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
    en: "Buy-in in poker format. Type \"50+5\" for a $50 buy-in with $5 rake, or just \"50\" to keep the current rake. The number before \"+\" goes to the prize pool; the number after is the room's fee.\n\nExamples: 50+5 (10% rake), 200+15 (7.5% rake), 10+1 (10%).\n\nEffect: your real per-entry cost is buyIn + rake. Prize pool = players × buyIn (+ overlay if guarantee is set).",
    ru: "Бай-ин в покерном формате. Введи «50+5» для $50 бай-ина и $5 рейка, или просто «50», чтобы оставить текущий рейк. Число до «+» идёт в призовой, число после — это комиссия рума.\n\nПримеры: 50+5 (рейк 10%), 200+15 (7.5%), 10+1 (10%).\n\nЭффект: реальная цена входа = buyIn + rake. Призовой = players × buyIn (+ оверлей при гарантии).",
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
    en: "How many bullets of this tourney you play in one session. This is NOT re-entries — re-entry rate is a separate field in the advanced row options (it's about rebuying inside the same tourney when you bust).\n\nFractions allowed — stochastically rounded.\n\nExample: 3 = fire this tourney 3 times per session. 0.5 = on average every other session.",
    ru: "Сколько пуль этого турнира играешь за одну сессию. Это НЕ ре-энтри — процент перезаходов настраивается отдельно в дополнительных полях строки (он про то, как часто ты перезаходишь внутри того же турнира после вылета).\n\nДроби допустимы — округляем стохастически.\n\nПример: 3 = заряжаем этот турнир 3 раза за сессию. 0.5 = в среднем каждая вторая сессия.",
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
