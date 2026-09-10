/**
 * Flat i18n dictionary for every user-visible string. Keys are dotted
 * (`group.subkey`); each entry must supply every locale in `LOCALES` or the
 * TS build will fail. Adding a language = add one field to every entry.
 *
 * Do NOT concatenate user-facing strings. Use `{n}` placeholders and
 * `str.replace("{n}", String(n))`.
 */
export type Locale = "en" | "ru";

export const LOCALES: Locale[] = ["en", "ru"];

// Flat dict — deep keys are `group.key`. Value per locale.
type Entry = Record<Locale, string>;

export const DICT = {
  "shape.inconsistentFinishLocks": {
    en: "Pinned finish probabilities conflict with each other or the row’s ITM.",
    ru: "Закреплённые вероятности финишей противоречат друг другу или ITM строки.",
  },
  "shape.clearFinishLocks": { en: "Clear finish locks", ru: "Снять фиксацию финишей" },
  "results.inputsChanged": {
    en: "Settings have changed. These results and their share link still describe the completed run. Run again to apply your changes.",
    ru: "Настройки изменены. Эти результаты и ссылка относятся к завершённому прогону. Запустите расчёт снова, чтобы применить изменения.",
  },
  "changelog.v078.summary": {
    en: "Refreshed sliders and number fields: filled tracks, larger touch targets, visible keyboard focus and clearer invalid-value feedback. The familiar layout and input behavior are preserved.",
    ru: "Обновлены ползунки и числовые поля: заполненная дорожка, удобнее захват на телефоне, заметный фокус с клавиатуры и подсветка неверного значения. Сохранены привычная компоновка и поведение ввода.",
  },
  "changelog.v077.summary": {
    en: "Corrected payouts, bankroll recommendations, leaderboard and satellite statistics. Completed runs keep their settings; PrimeDope comparisons, saved schedules and CSV imports stay consistent.",
    ru: "Исправлены выплаты, рекомендации по банкроллу, статистика лидерборда и сателлитов. Результаты сохраняют настройки своего прогона; исправлены сравнения PrimeDope, сохранение расписаний и импорт CSV.",
  },
  "pd.model.primedope": {"en":"PrimeDope","ru":"PrimeDope"},
  "pd.model.alpha": {"en":"Our calibrated model","ru":"Наша калиброванная модель"},
  "pd.report.subtitle": {"en":"The same report layout as PrimeDope, for direct comparison","ru":"Формат отчёта PrimeDope для прямого сравнения"},
  "pd.report.returns": {"en":"Return, EV and volatility","ru":"Доходность, EV и разброс"},
  "pd.report.tournaments": {"en":"Tournaments","ru":"Турниры"},
  "pd.report.samples": {"en":"Samples","ru":"Сэмплы"},
  "pd.report.buyIns": {"en":"Total buy-ins","ru":"Сумма бай-инов"},
  "pd.report.expectedProfit": {"en":"Expected profit","ru":"Ожидаемый профит"},
  "pd.report.mean": {"en":"Simulated mean profit","ru":"Средний профит симуляции"},
  "pd.report.expectedRoi": {"en":"Expected ROI","ru":"Ожидаемый ROI"},
  "pd.report.realizedRoi": {"en":"Simulated ROI","ru":"ROI симуляции"},
  "pd.report.stdDev": {"en":"Simulated standard deviation","ru":"Стандартное отклонение симуляции"},
  "pd.report.intervals": {"en":"Simulated outcome intervals","ru":"Интервалы результатов симуляции"},
  "pd.report.bankroll": {"en":"Bankroll for a given risk of ruin","ru":"Банкролл для заданного риска разорения"},
  "pd.report.ror50": {"en":"50% risk of ruin","ru":"Риск разорения 50%"},
  "pd.report.ror15": {"en":"15% risk of ruin","ru":"Риск разорения 15%"},
  "pd.report.ror5": {"en":"5% risk of ruin","ru":"Риск разорения 5%"},
  "pd.report.ror1": {"en":"1% risk of ruin","ru":"Риск разорения 1%"},
  "pd.report.ror5Gaussian": {"en":"5% risk · Gaussian estimate","ru":"Риск 5% · гауссова оценка"},
  "pd.report.ror1Gaussian": {"en":"1% risk · Gaussian estimate","ru":"Риск 1% · гауссова оценка"},
  "pd.report.neverBelow": {"en":"Runs that never fell below zero profit","ru":"Раны, где профит не опускался ниже нуля"},
  "pd.report.probLoss": {"en":"Chance of loss after {n} tournaments","ru":"Вероятность убытка после {n} турниров"},
  "pd.delta.pp": {"en":"{value} percentage points","ru":"{value} процентных пунктов"},
  "pd.delta.tournaments": {"en":"{value} tournaments","ru":"{value} турниров"},
  "pd.calibrationClamped": {"en":"PrimeDope could not reach the configured payout for {row}: requested {target}, modeled {actual} per tournament. These results use the modeled payout.","ru":"PrimeDope не достиг заданной выплаты для {row}: запрошено {target}, смоделировано {actual} за турнир. Результаты рассчитаны по смоделированной выплате."},
  "chart.traj.profit": {"en":"Profit","ru":"Профит"},
  "chart.itmBadge.tip": {"en":"In-the-money rate: {value}%","ru":"Частота попадания в призы: {value}%"},
  "runs.capturedMax": {"en":"Maximum {n} stored paths","ru":"Сохранено не более {n} траекторий"},
  "stat.probProfit.shiftedSurvival": {"en":"The never-busted estimate is unavailable for this adjusted view.","ru":"Оценка «без банкротства» недоступна для этого скорректированного вида."},
  "controls.brLeaderboard.lookupError.incomplete": {"en":"Some usernames returned no data. Previous totals are unchanged. Check every nickname and try again.","ru":"Для части ников нет данных. Прежние итоги сохранены. Проверь все ники и повтори запрос."},
  "controls.brLeaderboard.lookupError.rate-limited": {"en":"Too many lookup requests. Previous totals are unchanged; try again in {seconds} seconds.","ru":"Слишком много запросов. Прежние итоги сохранены; повтори через {seconds} сек."},
  "weakness.tag.finishes": {"en":"FINISHES","ru":"ФИНИШИ"},
  "weakness.tag.formats": {"en":"FORMATS","ru":"ФОРМАТЫ"},
  "weakness.tag.trap": {"en":"CAVEAT","ru":"ОГОВОРКА"},
  "weakness.tag.converge": {"en":"ALIGNMENT","ru":"СОВПАДЕНИЕ"},
  "weakness.tag.precision": {"en":"PRECISION","ru":"ТОЧНОСТЬ"},
  "weakness.tag.boundary": {"en":"LIMITS","ru":"ГРАНИЦЫ"},
  "weakness.tag.bands": {"en":"BANDS","ru":"ИНТЕРВАЛЫ"},
  "weakness.tag.schedule": {"en":"SCHEDULE","ru":"РАСПИСАНИЕ"},
  "weakness.tag.paths": {"en":"PATHS","ru":"ТРАЕКТОРИИ"},
  "weakness.tag.empirical": {"en":"EMPIRICAL","ru":"ЭМПИРИКА"},
  "weakness.tag.input": {"en":"INPUT","ru":"ВВОД"},
  "weakness.tag.tails": {"en":"TAILS","ru":"ХВОСТЫ"},
  "row.importTooMany": {"en":"The schedule can contain at most {max} rows. No rows were imported. Reduce the import or replace the current schedule.","ru":"В расписании может быть не больше {max} строк. Импорт не выполнен. Уменьши число строк или замени текущее расписание."},
  "controls.alphaUnavailable": {"en":"Manual alpha is available only for the three real-data tilt models. This model uses its calibrated or fixed shape.","ru":"Ручной alpha доступен только в трёх real-data tilt моделях. Здесь используется калибруемая или фиксированная форма."},
  // Header
  "app.samples": { en: "samples", ru: "сэмплов" },

  // Model labels (pills)
  "model.power-law": { en: "Power-law finish model", ru: "Степенная модель" },
  "model.linear-skill": { en: "Linear-skill finish model", ru: "Линейная модель скилла" },
  "model.stretched-exp": { en: "Stretched-exp finish model", ru: "Растянутая экспонента" },
  "model.uniform": { en: "Uniform finish model", ru: "Равномерная модель" },
  "model.empirical": { en: "Empirical finish model", ru: "Эмпирическая модель" },
  "model.plackett-luce": { en: "Plackett–Luce finish model", ru: "Модель Плакетта–Льюса" },
  "model.freeze-realdata-step": {
    en: "Freezeout real-data (step)",
    ru: "Фризаут по реал-дате (шаги)",
  },
  "model.freeze-realdata-linear": {
    en: "Freezeout real-data (linear)",
    ru: "Фризаут по реал-дате (линейная)",
  },
  "model.freeze-realdata-tilt": {
    en: "Freezeout real-data (hybrid tilt)",
    ru: "Фризаут по реал-дате (гибрид tilt)",
  },
  "model.pko-realdata-step": {
    en: "PKO real-data (step)",
    ru: "ПКО по реал-дате (шаги)",
  },
  "model.pko-realdata-linear": {
    en: "PKO real-data (linear)",
    ru: "ПКО по реал-дате (линейная)",
  },
  "model.pko-realdata-tilt": {
    en: "PKO real-data (hybrid tilt)",
    ru: "ПКО по реал-дате (гибрид tilt)",
  },
  "model.mystery-realdata-step": {
    en: "Mystery real-data (step)",
    ru: "Мистери по реал-дате (шаги)",
  },
  "model.mystery-realdata-linear": {
    en: "Mystery real-data (linear)",
    ru: "Мистери по реал-дате (линейная)",
  },
  "model.mystery-realdata-tilt": {
    en: "Mystery real-data (hybrid tilt)",
    ru: "Мистери по реал-дате (гибрид tilt)",
  },
  "model.powerlaw-realdata-influenced": {
    en: "Power-law (real-data influenced α)",
    ru: "Power-law (α под реал-дату)",
  },

  // Sections
  "section.schedule.title": { en: "Schedule", ru: "Расписание" },
  "section.controls.title": { en: "Simulation launch", ru: "Запуск симуляции" },
  "section.results.title": { en: "Results", ru: "Результаты" },
  "section.results.subtitle": {
    en: "{samples} simulated runs, {tourneys} tournaments in each run",
    ru: "{samples} симуляций по {tourneys} турниров в каждой симуляции",
  },

  // Demo scenarios
  "demo.label": { en: "Example schedules", ru: "Примеры расписаний" },
  "demo.choosePlaceholder": {
    en: "Pick a scenario",
    ru: "Выбрать пример",
  },
  "schedule.reset": { en: "Reset schedule", ru: "Сбросить расписание" },
  "schedule.resetHint": {
    en: "Replace the whole schedule with a single default MTT row. Global controls stay as-is.",
    ru: "Заменить всё расписание одной строкой-дефолтом. Общие настройки сверху не трогаются.",
  },
  "schedule.resetConfirm": {
    en: "Replace the current schedule with a single default row?",
    ru: "Заменить текущее расписание одной строкой-дефолтом?",
  },
  "demo.brLeaderboard": {
    en: "BR leaderboard promo",
    ru: "BR leaderboard promo",
  },
  "demo.primedopeReference": {
    en: "$50 standard MTT",
    ru: "$50 обычный турнир",
  },
  "demo.romeoPro": { en: "RomeoPro mode", ru: "Режим Ромеопро" },
  "demo.smallFieldTopReg": {
    en: "Top reg — small fields (100p, ITM 18.7%, AFS ~6.5)",
    ru: "Топ-рег малых полей (100p, ITM 18.7%, AFS ~6.5)",
  },
  "demo.midStakesReg": {
    en: "Mid-stakes reg ($55, 1000p, +8% ROI)",
    ru: "Мидстейкс-рег ($55, 1000p, +8% ROI)",
  },
  "demo.microHighVolume": {
    en: "Microstakes grind ($5, 3000p, 10k/mo)",
    ru: "Микростейкс-гринд ($5, 3000p, 10k/мес)",
  },
  "demo.highRollerSunday": {
    en: "High Roller Sunday ($530, 500p)",
    ru: "HighRoller Sunday ($530, 500p)",
  },
  "demo.mixedFreezePko": {
    en: "Mixed mode (freeze + PKO, $22-$55)",
    ru: "Микс фриз+PKO ($22-$55)",
  },
  "demo.mixedDailyAllFormats": {
    en: "Daily mix (freeze + PKO + Mystery, $11-$55)",
    ru: "Daily mix: фриз+PKO+Mystery ($11-$55)",
  },
  "demo.mixedGgWithBr": {
    en: "GG mix (BR + Mystery + PKO, $3-$25)",
    ru: "GG mix: BR+Mystery+PKO ($3-$25)",
  },
  "demo.mixedSundayMajors": {
    en: "Sunday mix (freeze + PKO + Mystery, $55-$215)",
    ru: "Sunday mix: фриз+PKO+Mystery ($55-$215)",
  },

  "userPreset.label": { en: "My presets", ru: "Мои пресеты" },
  "userPreset.saveCurrent": { en: "Save current", ru: "Сохранить текущий" },
  "userPreset.mine": { en: "Saved", ru: "Сохранено" },
  "userPreset.builtin": { en: "Built-in", ru: "Встроенный" },
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
  "row.label": { en: "Label", ru: "Турнир" },
  "row.players": { en: "AFS", ru: "AFS" },
  "row.buyIn": { en: "Buy-in", ru: "Бай-ин" },
  "row.buyIn.normalizeBr": {
    en: "standard {value}",
    ru: "станд. {value}",
  },
  "row.buyIn.normalizeBrHint": {
    en: "Battle Royale tiers use a room-style total ticket. Click to snap this row back to a regular buy-in + rake structure: {value}.",
    ru: "У Battle Royale хранится румовский total-ticket. Кликни, чтобы вернуть строку к обычной структуре бай-ина + рейка: {value}.",
  },
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
  "row.payouts": { en: "Payouts", ru: "Выплаты" },
  "row.payoutCompat.tooFew": {
    en: "AFS too small",
    ru: "AFS мал",
  },
  "row.payoutCompat.tooMany": {
    en: "AFS too large",
    ru: "AFS велик",
  },
  "row.payoutCompat.min": { en: "min", ru: "мин" },
  "row.payoutCompat.max": { en: "max", ru: "макс" },
  "row.payoutCompat.unavailable": {
    en: "Unavailable",
    ru: "Недоступно",
  },
  "row.payoutCompat.wrongGameType": {
    en: "Not for {gameType}",
    ru: "Не для формата {gameType}",
  },
  "row.payoutGroup.real2026": {
    en: "Real 2026 structures",
    ru: "Реальные структуры 2026",
  },
  "row.payoutGroup.generic": {
    en: "Generic presets",
    ru: "Обобщённые пресеты",
  },
  "row.count": {
    en: "Tournaments",
    ru: "Турниры",
  },
  "row.addRow": { en: "Add row", ru: "Добавить" },
  "row.duplicate": { en: "Duplicate row", ru: "Дублировать ряд" },
  "row.maxRows": {
    en: "Schedule is capped at {n} rows",
    ru: "В расписании не больше {n} рядов",
  },
  "row.delete": { en: "Delete", ru: "Удалить" },
  "row.gameType": { en: "Game type", ru: "Тип игры" },
  "row.gameType.freezeout": { en: "Freezeout", ru: "Фризаут" },
  "row.gameType.pko": { en: "PKO", ru: "PKO" },
  "row.gameType.mystery": { en: "Mystery", ru: "Мистери" },
  "row.gameType.mysteryRoyale": {
    en: "GG Battle Royal",
    ru: "GG Battle Royal",
  },
  "row.bounty": { en: "KO %", ru: "Ноки %" },
  "shape.title": { en: "Finish shape", ru: "Форма распределения" },
  "shape.itmLabel": { en: "ITM rate %", ru: "ITM-ставка %" },
  "shape.rowFirst": { en: "P(1st)", ru: "P(1-е)" },
  "shape.rowTop3": { en: "P(top-3)", ru: "P(топ-3)" },
  "shape.rowFt": { en: "P(FT)", ru: "P(финалка)" },
  "shape.lock": { en: "lock", ru: "фикс" },
  "shape.unlock": { en: "auto", ru: "авто" },
  "shape.autoPlaceholder": { en: "auto", ru: "авто" },
  "shape.target": { en: "Target EW:", ru: "Цель EW:" },
  "shape.current": { en: "Current EW:", ru: "Сейчас EW:" },
  "shape.autoFit": { en: "Auto-fit", ru: "Подогнать" },
  "shape.infeasible": {
    en: "Locked constraints can't hit the ROI target. Either unlock a shell or relax the locked %s.",
    ru: "Зафиксированные корзины не позволяют попасть в целевой ROI. Разблокируй одну из них или ослабь фиксированные %.",
  },
  "shape.infeasibleHint": {
    en: "Gap between target and current expected winnings",
    ru: "Разрыв между целевым и текущим EW",
  },
  "shape.presetAuto": { en: "Auto (no ITM lock)", ru: "Авто (без фикс. ITM)" },
  "shape.presetNoSkill": { en: "No-skill (paid/N)", ru: "Нулевой скилл (paid/N)" },
  "shape.presetGrinder": { en: "Grinder (16% ITM)", ru: "Гриндер (16% ITM)" },
  "shape.presetCrusher": { en: "Crusher (18% ITM)", ru: "Крашер (18% ITM)" },
  "shape.presetCustom": { en: "Custom", ru: "Кастом" },
  "shape.blockedTitle": {
    en: "Can't run — finish shape is infeasible",
    ru: "Нельзя запустить — форма распределения невозможна",
  },
  "shape.blockedHint": {
    en: "One or more rows have locked shell probabilities that don't leave enough room to hit the ROI target. Fix them below, or auto-fix all at once.",
    ru: "В одной или нескольких строках зафиксированные вероятности корзин не позволяют попасть в целевой ROI. Поправь ниже или авто-фикс всех сразу.",
  },
  "shape.blockedRow": { en: "Row", ru: "Строка" },
  "shape.rowBlocked": {
    en: "Pinned shells leave no room for ROI",
    ru: "Зафиксированные вероятности не дают попасть в ROI",
  },
  "shape.blockedGap": { en: "gap", ru: "разрыв" },
  "shape.fixClosest": { en: "Fit closest inputs", ru: "Подогнать вводные" },
  "shape.fixAuto": { en: "Clear locks", ru: "Снять фиксации" },
  "shape.fixPreset": { en: "Grinder preset", ru: "Пресет «гриндер»" },
  "shape.fixAllClosest": {
    en: "Fit closest inputs",
    ru: "Подогнать вводные",
  },
  "run.jumpToReason": {
    en: "↑ to reason",
    ru: "↑ к причине",
  },
  "run.engineCrashed": {
    en: "Simulation engine failed to load — reload the page.",
    ru: "Движок симуляции не загрузился — перезагрузите страницу.",
  },
  "stat.sampleSupport": {
    en: "n ≈ {n} of {total}",
    ru: "n ≈ {n} из {total}",
  },
  "stat.sampleSupport.tip": {
    en: "How many simulated runs actually reached this percentile",
    ru: "Сколько симуляций реально дотянулись до этого процентиля",
  },
  "stat.sampleSupport.tip.thin": {
    en: "The rarest part of the distribution — these numbers are very noisy",
    ru: "Самая редкая часть распределения — числа очень шумные",
  },
  "sanity.title": {
    en: "Check settings",
    ru: "Проверь настройки",
  },
  "sanity.subtitle": {
    en: "The simulation can run, but these settings disable or distort some secondary metrics.",
    ru: "Симуляция запустится, но из-за этих настроек часть дополнительных метрик будет отключена или бесполезна.",
  },
  "sanity.tilt-fast-no-scale": {
    en: "Fast tilt has gain set but scale = 0 — tanh saturates instantly, so any non-zero drawdown jumps straight to the full ROI shift instead of ramping up.",
    ru: "У быстрого тильта задан gain, но scale = 0 — tanh saturates моментально, поэтому любая просадка сразу даёт полный сдвиг ROI без плавного нарастания.",
  },
  "sanity.tilt-slow-no-threshold": {
    en: "Slow tilt has gain set but threshold ≤ 0 — the down/up state triggers on any non-zero drawdown instead of waiting for the configured depth.",
    ru: "У медленного тильта задан gain, но threshold ≤ 0 — состояние «вниз/вверх» срабатывает при любой ненулевой просадке, а не на заданной глубине.",
  },
  "sanity.zero-bankroll": {
    en: "Bankroll is not set. Profit, ROI and variance still calculate normally, but bankroll risk metrics are skipped. Enter bankroll above if you want risk-of-ruin and required-bankroll estimates.",
    ru: "Банкролл не задан. Профит, ROI и дисперсия считаются нормально, но риск банкролла сейчас не считается. Введи банкролл сверху, если хочешь видеть риск разорения и сколько БР нужно.",
  },
  "sanity.empirical-too-few-buckets": {
    en: "Empirical model is active but the histogram has fewer than 50 buckets — resampling will be too coarse to be informative.",
    ru: "Включена эмпирическая модель, но в гистограмме меньше 50 корзин — ресэмплинг будет слишком грубым, чтобы быть полезным.",
  },
  "sanity.row-bounty-format-no-bounty": {
    en: "Row {row}: format is PKO / Mystery / Battle Royale, but bountyFraction = 0 — the bounty channel is silently off.",
    ru: "Ряд {row}: формат PKO / Mystery / Battle Royale, но bountyFraction = 0 — bounty-канал молча выключен.",
  },
  "sanity.row-mystery-no-variance": {
    en: "Row {row}: Mystery with mysteryBountyVariance = 0 — envelope size never varies, so the format collapses to plain PKO.",
    ru: "Ряд {row}: Mystery с mysteryBountyVariance = 0 — конверты не различаются по размеру, формат вырождается в обычный ПКО.",
  },
  "sanity.row-pko-heat-no-bounty": {
    en: "Row {row}: PKO heat is set but bountyFraction = 0 — heat reshapes the bounty distribution, so without a bounty channel it has no effect.",
    ru: "Ряд {row}: задан PKO heat, но bountyFraction = 0 — heat меняет форму распределения bounty, без bounty-канала эффект нулевой.",
  },
  "sanity.row-zero-count": {
    en: "Row {row}: count = 0 — this row is never played, so its inputs don't affect the simulation.",
    ru: "Ряд {row}: count = 0 — этот ряд никогда не разыгрывается, его настройки на симуляцию не влияют.",
  },
  "row.fixedItm": { en: "ITM %", ru: "ITM %" },
  "row.fixedItmHint": {
    en: "Pin the in-the-money rate at a constant value regardless of ROI. All skill concentrates WITHIN the cashed band — a grinder doesn't cash more often than a no-skill player, they just run deeper when they do. Default is the payout table's paid fraction; edit the row if needed.",
    ru: "Фиксирует частоту попадания в призовые независимо от ROI. Скилл весь уходит ВНУТРЬ призовой зоны — гриндер попадает в деньги не чаще нулевого игрока, но бежит глубже. По умолчанию берется paid-фракция структуры выплат; при необходимости отредактируй строку.",
  },
  "row.advanced": { en: "Advanced", ru: "Доп. параметры" },
  "row.fieldSize": { en: "Field size", ru: "Размер поля" },
  "row.fixed": { en: "Fixed", ru: "Фиксированное" },
  "row.uniformRange": { en: "Range", ru: "Диапазон" },
  "row.min": { en: "Min", ru: "Мин" },
  "row.max": { en: "Max", ru: "Макс" },
  "row.buckets": { en: "Variants", ru: "Вариантов" },
  "row.fieldHint": {
    en: "Sometimes the field is 400, sometimes 700. Pick a range and the sim will play a few different sizes so the swings reflect reality.",
    ru: "Иногда поле 400, иногда 700. Задай диапазон — симулятор прогонит несколько размеров, и свинги будут ближе к реальности.",
  },
  "row.bountyHint": {
    en: "KO bounty as % of the buy-in. That chunk of every entry goes into the bounty pool instead of the regular prize pool, paid out as knockouts.",
    ru: "Баунти за вылет как % от бай-ина. Эта доля каждого входа уходит в баунти-пул вместо обычного призового и выдаётся за нокауты.",
  },
  "row.brRoi.title": {
    en: "Battle Royale regs often quote ROI with rakeback included. The row ROI field is pre-rakeback because global rakeback is added separately. With {rbPct} rakeback this adds {rbRoi}; current row {field} becomes {reported} reported ROI.",
    ru: "Реги Battle Royale часто называют ROI уже с рейкбеком. Поле ROI в строке хранит покерный ROI до рейкбека, потому что глобальный рейкбек добавляется отдельно. При RB {rbPct} это даёт {rbRoi}; текущие {field} в строке превращаются в {reported} reported ROI.",
  },
  "row.brRoi.short": {
    en: "incl. RB",
    ru: "с RB",
  },
  "row.brRoi.preset.low": {
    en: "{reported} total -> {field} field",
    ru: "{reported} итого -> {field} в поле",
  },
  "row.brRoi.preset.goodLow": {
    en: "{reported} good reg -> {field} field",
    ru: "{reported} хор. рег -> {field} в поле",
  },
  "row.brRoi.preset.goodHigh": {
    en: "{reported} good reg -> {field} field",
    ru: "{reported} хор. рег -> {field} в поле",
  },
  "row.brRoi.preset.top": {
    en: "{reported} top reg -> {field} field",
    ru: "{reported} топ -> {field} в поле",
  },
  "row.sitThrough": {
    en: "Sit through pay jumps",
    ru: "Играем мимо лесенки",
  },
  "row.sitThroughAgg": { en: "Aggression %", ru: "Агрессия %" },
  "row.sitThroughHint": {
    en: "You refuse to fold your way into mincashes and play for stacks instead. EV-preserving: probability mass on bottom-half paid places is shifted — some into deeper finishes (weighted by prize), the rest into busts. Total ROI is unchanged; variance goes up because mincashes stop absorbing bad runs.",
    ru: "Игрок отказывается паркинговаться в мин-кеш и играет за стек. EV не меняется: часть вероятности из нижней половины призовых уходит наверх (пропорционально призу), остаток — в вылеты до денег. ROI остаётся тем же, но дисперсия растёт — мин-кеши больше не гасят плохие раны.",
  },
  "row.mystery": { en: "Mystery bounty σ²", ru: "Mystery bounty σ²" },
  "row.mysteryHint": {
    en: "Per-KO lognormal variance on the bounty value. 0 = flat bounties. 0.5–1 = moderate mystery skew. 1.5+ = GG-style jackpot distribution (occasional huge, mostly tiny). Mean is preserved, only variance is reshaped.",
    ru: "Дисперсия лог-нормального разброса на ценность одной выбитой головы. 0 = плоские баунти. 0.5–1 = умеренный mystery-скью. 1.5+ = как у GG (редкие крупные, в основном мелкие). Среднее сохраняется — меняется только дисперсия.",
  },
  // Controls panel
  "controls.scheduleRepeats": {
    en: "Tournaments per sample",
    ru: "Турниров в сэмпле",
  },
  "controls.samples": { en: "Simulations", ru: "Симуляций" },
  "controls.memoryHint": {
    en: "Projected memory ≈ {gb} GB while building results — the tab may run out of memory. Lower Simulations to stay safe.",
    ru: "Прогноз памяти ≈ {gb} ГБ на сборке результата — вкладке может не хватить памяти. Уменьшите число симуляций.",
  },
  "controls.bankroll": { en: "Bankroll", ru: "Банкролл" },
  "controls.compareMode": { en: "Twin-run mode", ru: "Режим сравнения" },
  "controls.compareMode.random": {
    en: "Two random runs (same model)",
    ru: "Два рандомных рана (одна модель)",
  },
  "controls.compareMode.primedope": {
    en: "Ours vs PrimeDope (same seed)",
    ru: "Наш vs PrimeDope (один сид)",
  },
  "twin.runA": { en: "Run A", ru: "Ран A" },
  "twin.runB": { en: "Run B", ru: "Ран B" },
  "twin.runA.cap": {
    en: "First random sample of your schedule.",
    ru: "Первая случайная выборка по расписанию.",
  },
  "twin.runB.cap": {
    en: "Second random sample — same model, different seed.",
    ru: "Вторая случайная выборка — та же модель, другой сид.",
  },
  "controls.finishModel": { en: "Skill model", ru: "Модель скилла" },
  "controls.finishModel.referenceShape": {
    en: "Reference shape — ROI not calibrated",
    ru: "Эталонная форма — ROI не калибруется",
  },
  "controls.alphaOverride": {
    en: "Skill sharpness (optional)",
    ru: "Жёсткость кривой скилла (опц.)",
  },
  "controls.alphaPlaceholder": { en: "auto", ru: "авто" },
  "controls.seed": {
    en: "Sample variant",
    ru: "Вариант выборки",
  },
  "controls.newSeed": { en: "🎲 new seed", ru: "🎲 новый сид" },
  "controls.newSeed.hint": {
    en: "Run reuses the current seed so edits are comparable; draw a new one to see a different random sample.",
    ru: "Запуск использует текущий сид, чтобы правки были сравнимы; возьмите новый, чтобы увидеть другую случайную выборку.",
  },
  "controls.roiStdErr": {
    en: "Uncertainty about your true ROI",
    ru: "Неуверенность в своём ROI",
  },
  "controls.roiShockPerTourney": {
    en: "Field strength varies tourney-to-tourney",
    ru: "Сила поля меняется от турнира к турниру",
  },
  "controls.section.skill": { en: "Skill model", ru: "Модель скилла" },
  "controls.expandAdvanced": {
    en: "Show advanced options",
    ru: "Показать продвинутые настройки",
  },
  "controls.collapseAdvanced": {
    en: "Hide advanced options",
    ru: "Скрыть продвинутые настройки",
  },

  // ---- model preset selector ----
  "preset.label": { en: "Model preset", ru: "Пресет модели" },
  "preset.primedope.label": { en: "Like PrimeDope", ru: "Как на PrimeDope" },
  "preset.primedope.tagline": {
    en: "Uses PrimeDope's core distribution assumptions: every paid place is equally likely once you cash, so skill only shifts how often you cash — not how deep you run. The app still keeps ROI on the full buy-in+rake cost basis. Here only so you can see how much PrimeDope-style math understates the real swings.",
    ru: "Использует ключевые допущения PrimeDope: внутри призовых все места равновероятны, поэтому скилл влияет только на частоту попаданий в деньги — но не на глубину прохода. ROI всё равно считается на честной базе полной стоимости buy-in+rake. Нужен только чтобы увидеть, насколько PrimeDope-стиль занижает реальные колебания.",
  },
  "preset.naive.label": { en: "Standard mode", ru: "Стандартный режим" },
  "preset.naive.tagline": {
    en: "Fixes the overall cash-in rate set by your settings, but distributes prize places according to your ROI — most of your edge lands as deeper finishes instead of being spread evenly across the paid pool. No additional noise.",
    ru: "Общий % попаданий в призы фиксирован и соответствует настройкам, но сами места внутри призовых распределены в соответствии с ROI — большая часть скилла реализуется в глубоких финишах, а не размазывается равномерно по всем призовым. Без дополнительного шума.",
  },
  "preset.realisticSolo.label": {
    en: "Solo player, real life",
    ru: "Одиночный игрок, как в жизни",
  },
  "preset.realisticSolo.tagline": {
    en: "Adds player-level uncertainty, tourney/session ROI noise, slow drift, and mild fast tilt. Use as a realistic solo-grinder stress test.",
    ru: "Добавляет неопределённость по ROI, шум на турнир и сессию, медленный дрейф и мягкий быстрый тильт. Подходит как стресс-тест для одиночного грайндера.",
  },
  "preset.steadyReg.label": { en: "Steady regular", ru: "Стабильный регуляр" },
  "preset.steadyReg.tagline": {
    en: "Lower uncertainty than solo mode, but still includes structured ROI noise and a slow tilt that only appears on long deep downswings.",
    ru: "Менее шумный профиль, чем solo mode, но с сохранённым ROI-шумом и медленным тильтом, который включается только на длинных глубоких даунсвингах.",
  },
  "controls.compareLabel": {
    en: "Compare with PrimeDope",
    ru: "Сравнить с PrimeDope",
  },
  "controls.compareHint": {
    en: "Runs a second simulation with the same seed using the PrimeDope-equivalent payout model. Two result columns plus a diff row.",
    ru: "Делает второй ран с тем же зерном, но с моделью выплат как на сайте PrimeDope. Показывает две колонки результатов и строку с разницей.",
  },
  "controls.run": { en: "Run simulation", ru: "Запустить" },
  "controls.stop": { en: "Stop", ru: "Остановить" },
  "controls.remaining": { en: "remaining", ru: "осталось" },
  "controls.starting": { en: "warming up…", ru: "разгоняемся…" },
  "controls.finishing": { en: "wrapping up…", ru: "завершаем…" },
  "controls.stage.simulating": { en: "simulating", ru: "считаем руки" },
  "controls.stage.stats": { en: "crunching stats", ru: "считаем статистику" },
  "controls.stage.envelopes": { en: "sorting envelopes", ru: "сортируем огибающие" },
  "controls.stage.streaks": { en: "ranking streaks", ru: "ранжируем стрики" },
  "controls.stage.convergence": { en: "finishing up", ru: "последние штрихи" },
  "controls.done.label": { en: "Done", ru: "Готово" },
  "controls.done.seeBelow": { en: "See full results", ru: "Смотреть ниже" },
  "controls.done.profit": { en: "Avg profit", ru: "Средний профит" },
  "controls.done.upChance": { en: "Up chance", ru: "Шанс в плюс" },
  "controls.done.ruin": { en: "Ruin risk", ru: "Риск разорения" },
  "controls.done.worstDD": { en: "Drawdown p99", ru: "Просадка p99" },
  "controls.done.dryStreak": { en: "Longest cashless", ru: "Без ИТМ, макс" },
  "controls.totalTourneys": {
    en: "tournaments/sample",
    ru: "турниров в сэмпле",
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
  // Results — stat labels
  "stat.expectedProfit": { en: "Expected profit", ru: "Ожидаемый профит" },
  "stat.expectedProfit.sub": {
    en: "range: {min} → {max}",
    ru: "разброс: {min} → {max}",
  },
  "stat.range.spread": { en: "Range", ru: "Разброс" },
  "stat.range.from": { en: "From", ru: "От" },
  "stat.range.to": { en: "To", ru: "До" },
  "stat.range.pointEv": { en: "Point = EV", ru: "Точка = EV" },
  "stat.range.pointHint": {
    en: "The dot shows where the current expected value sits between the low and high ends of this simulated range.",
    ru: "Точка показывает, где текущий ожидаемый профит находится между нижней и верхней границей этого симулированного диапазона.",
  },
  "stat.expectedProfit.tip": {
    en: "Analytical EV (expected payout − full entry cost × entries). Actual MC mean: {mean} · ROI {roi} · median {median}.",
    ru: "Аналитическое EV (ожидаемая выплата − полная стоимость входов). Фактическое MC-среднее: {mean} · ROI {roi} · медиана {median}.",
  },
  "stat.probProfit.sub": {
    en: "{n} tourneys to reach ±5% ROI",
    ru: "{n} турниров до точного ROI ±5%",
  },
  "stat.probProfit.neverBusted": {
    en: "{p} without ever busting",
    ru: "{p} ни разу не слив банкролл",
  },
  "stat.probProfit.tip": {
    en: "Share of simulated runs that end the schedule in profit. A run that hits −bankroll mid-way still counts if it finishes up: the engine flags the bust and keeps playing, as if you could reload and continue. With a bankroll set, the sub-line shows the stricter share that finished up without ever busting.",
    ru: "Доля симулированных прогонов, закончивших расписание в плюсе. Прогон, который по пути ушёл в −банкролл, всё равно считается, если финиширует в плюсе: движок отмечает разорение и продолжает играть, как будто можно докупить и продолжить. При заданном банкролле подстрока показывает более строгую долю — в плюсе и ни разу не слив банкролл.",
  },
  "stat.probProfit.outcome": {
    en: "Sample finish",
    ru: "Финиш сэмпла",
  },
  "stat.probProfit.outcome.down": {
    en: "Not up",
    ru: "Не в плюсе",
  },
  "stat.probProfit.outcome.up": {
    en: "In profit",
    ru: "В плюсе",
  },
  "stat.riskOfRuin.horizon": {
    en: "within {n} tournaments (one sample)",
    ru: "на горизонте {n} турниров (один сэмпл)",
  },
  "stat.riskOfRuin.sub": {
    en: "chance your bankroll streaks to zero",
    ru: "шанс стрикануть весь банкролл",
  },
  "stat.riskOfRuin.tip": {
    en: "For 1% RoR → need bankroll ≥ {br1}. For 5% RoR → need bankroll ≥ {br5}.",
    ru: "Для 1% риска разорения нужен БР ≥ {br1}. Для 5% — БР ≥ {br5}.",
  },
  "stat.riskOfRuin.scale": {
    en: "Current risk",
    ru: "Текущий риск",
  },
  "stat.riskOfRuin.scale.point": {
    en: "Risk",
    ru: "Риск",
  },
  "stat.riskOfRuin.scale.safe": {
    en: "0% risk",
    ru: "0% риск",
  },
  "stat.riskOfRuin.scale.danger": {
    en: "100% risk",
    ru: "100% риск",
  },
  "stat.riskOfRuin.scale.hint": {
    en: "The dot shows the current risk of ruin on a 0–100% scale. The bankroll thresholds below show how much bankroll is needed to get down to about 5% and 1% risk.",
    ru: "Точка показывает текущий риск разорения на шкале 0–100%. Пороги БР ниже показывают, сколько банкролла нужно, чтобы опуститься примерно до 5% и 1% риска.",
  },
  "stat.riskOfRuin.range.from": {
    en: "5% risk",
    ru: "5% риск",
  },
  "stat.riskOfRuin.range.to": {
    en: "1% risk",
    ru: "1% риск",
  },
  "stat.ddWorst": { en: "Deepest drawdown", ru: "Максимальная просадка" },
  "stat.ddWorst.tip": {
    en: "Deepest peak-to-trough across all samples. Shown in $, ABIs, and the longest flat stretch (tournaments between equal profit points) of that same worst run.",
    ru: "Самая глубокая просадка от пика ко дну по всем сэмплам. Показана в $, ABI и самым длинным откатом (турниры между равными точками профита) того же худшего прогона.",
  },
  "stat.probProfit": { en: "Chance to be up", ru: "Шанс выйти в плюс" },
  "stat.riskOfRuin": { en: "Bankroll bust risk", ru: "Риск слить банкролл" },
  "stat.sharpe": { en: "Profit / volatility", ru: "Профит / волатильность" },
  "stat.sortino": { en: "Profit / downside", ru: "Профит / просадка" },
  "stat.kellyBR.tip": {
    en: "Kelly-optimal bankroll: ABI sits in the growth-maximizing fraction. Less = ruin risk, more = idle capital.",
    ru: "Оптимальный по Келли банкролл: ABI укладывается в долю, максимизирующую лог-рост. Меньше — риск, больше — деньги простаивают.",
  },
  "statGroup.drawdowns": { en: "Drawdowns", ru: "Просадки" },
  "statGroup.streaks": { en: "Streaks & recovery", ru: "Серии и отыгрыш" },
  "stat.ddMedian": { en: "Typical drawdown", ru: "Типичная просадка" },
  "stat.ddMedian.tip": {
    en: "Median deepest drawdown — half the futures swing less, half swing more. Robust to outliers.",
    ru: "Медиана самой глубокой просадки — половина мягче, половина жёстче. Устойчива к выбросам.",
  },
  "stat.ddP95": { en: "Drawdown in worst 5%", ru: "Просадка в худших 5%" },
  "stat.ddP95.tip": {
    en: "95th percentile: 1 in 20 runs drops at least this far from a peak. Not rare — plan for it.",
    ru: "95-й перцентиль: 1 из 20 ранов проваливается минимум настолько. Не редкость — закладывай в план.",
  },
  "stat.ddP99": { en: "Drawdown in worst 1%", ru: "Просадка в худшем 1%" },
  "stat.ddP99.tip": {
    en: "99th percentile — the 1-in-100 nightmare. Rare but real; kills unprepared bankrolls.",
    ru: "99-й перцентиль — кошмар «1 из 100». Редко, но случается; уносит неподготовленные банкроллы.",
  },
  "stat.recoveryMedian": { en: "Typical recovery", ru: "Типичный отыгрыш" },
  "stat.recoveryMedian.tip": {
    en: "Median tournaments needed to climb from the bottom of the deepest drawdown back to the prior peak. Excludes samples that never recover.",
    ru: "Медиана турниров на подъём со дна самой глубокой просадки к прежнему пику. Без невосстановившихся сэмплов.",
  },
  "stat.recoveryP90": { en: "Long recovery", ru: "Долгий отыгрыш" },
  "stat.recoveryP90.tip": {
    en: "90th percentile: 1 in 10 climbs back takes at least this many tourneys. Excludes samples that never recover.",
    ru: "90-й перцентиль: 1 из 10 восстановлений занимает минимум столько турниров. Без невосстановившихся сэмплов.",
  },
  "stat.recoveryUnrecovered": { en: "Never recovered", ru: "Не восстановились" },
  "stat.recoveryUnrecovered.tip": {
    en: "Share of samples that finished the distance below their own peak — never climbed back from the deepest drawdown.",
    ru: "Доля сэмплов, закончивших дистанцию ниже своего пика — со дна так и не поднялись.",
  },
  "stat.cashlessMean": { en: "Avg max no-ITM streak", ru: "Средняя макс. серия без ITM" },
  "stat.cashlessMean.tip": {
    en: "Average of each sample's longest no-ITM stretch. This is the local cold-streak metric to compare with table feel, not the full-sample peak-to-trough drawdown.",
    ru: "Среднее по самым длинным сериям без ITM в каждом сэмпле. Это локальный холодный стрик для сравнения с ощущением поля, а не полная просадка от пика до дна.",
  },
  "stat.cashlessWorst": { en: "Max no-ITM streak", ru: "Макс. серия без ITM" },
  "stat.cashlessWorst.tip": {
    en: "Longest run of tourneys with zero ITM — worst case across samples. The cold streak that tests nerves.",
    ru: "Самая длинная серия турниров без ИТМ — худший случай по сэмплам. Холодный стрик, который проверяет нервы.",
  },
  "stat.longestBE": { en: "Avg worst flatline", ru: "Средний худший откат" },
  "stat.longestBE.tip": {
    en: "Average across runs of the worst break-even streak in each run — the single longest horizontal chord on the profit curve where the path left a level and later returned.",
    ru: "Среднее по ранам от самого длинного стрика в ноль внутри каждого рана — то есть от максимального горизонтального отрезка, где кривая ушла с уровня и потом на него вернулась.",
  },
  "stat.avgBEStreak": { en: "Avg flatline", ru: "Средний откат" },
  "stat.avgBEStreak.tip": {
    en: "Average break-even streak length across every point on the profit curve: from each point, how far ahead does the path first return to the same Y? Averaged across all starting points and runs.",
    ru: "Средняя длина стрика в ноль по всем точкам кривой профита: от каждой точки — через сколько турниров кривая впервые вернётся на тот же уровень по Y? Среднее по всем стартовым точкам и ранам.",
  },
  "stat.bankrollOff": {
    en: "set a bankroll to compute",
    ru: "укажи банкролл, чтобы посчитать",
  },
  "stat.skew": { en: "Profit tilt", ru: "Перекос профита" },
  "stat.kurt": { en: "Tail fatness", ru: "Толщина хвостов" },
  "stat.kelly": { en: "Kelly fraction", ru: "Доля по Келли" },
  "stat.kellyBR": { en: "Kelly BR", ru: "БР по Келли" },
  "stat.logG": { en: "BR growth rate", ru: "Темп роста БР" },

  // Results — advanced diagnostics (shape & Kelly)
  "advStats.title": {
    en: "Snapshot · distribution shape & Kelly",
    ru: "Снимок · форма распределения и Келли",
  },
  "advStats.unit.perDistance": {
    en: "ratio, per full distance",
    ru: "коэффициент, на всю дистанцию",
  },
  "advStats.unit.g1": { en: "G1, dimensionless", ru: "G1, безразмерно" },
  "advStats.unit.excess": {
    en: "excess, 0 = normal",
    ru: "избыточный, 0 = нормальное",
  },
  "advStats.unit.kellyShare": {
    en: "buy-in ÷ Kelly bankroll",
    ru: "бай-ин ÷ банкролл Келли",
  },
  "advStats.unit.kellyBr": { en: "$, from σ²/μ", ru: "$, из σ²/μ" },
  "advStats.unit.logPerDistance": {
    en: "E[ln growth], per full distance",
    ru: "E[ln роста], на всю дистанцию",
  },
  "advStats.na.negEv": { en: "n/a — not +EV", ru: "н/д — не в плюсе" },
  "advStats.rowKelly": {
    en: "Per-row Kelly — fraction · bankroll",
    ru: "Келли по строкам — доля · банкролл",
  },
  "advStats.rowKelly.tip": {
    en: "Kelly for one row, evaluated on that row's own slot distribution: fraction = row buy-in ÷ row Kelly bankroll (σ²/μ of the row). Rows that are not +EV show a dash.",
    ru: "Келли по строке считается на её собственном распределении: доля = бай-ин строки ÷ банкролл Келли строки (σ²/μ строки). Строки не в плюсе показывают прочерк.",
  },
  "stat.sharpe.tip": {
    en: "Mean profit ÷ standard deviation of profit over one full simulated distance (all rows × schedule repeats). Not annualised, not per tournament — it grows with distance, so only compare runs of equal length.",
    ru: "Средний профит ÷ стандартное отклонение профита за одну полную симулированную дистанцию (все строки × повторы расписания). Не годовой и не на турнир — растёт с дистанцией, так что сравнивай только раны одинаковой длины.",
  },
  "stat.sortino.tip": {
    en: "Same as Sharpe, but the denominator counts losses only: √(Σ min(profit, 0)² / samples). Upside never penalises the score. Per full simulated distance.",
    ru: "То же, что Sharpe, но в знаменателе только минусы: √(Σ min(профит, 0)² / сэмплов). Плюсовые исходы не штрафуют оценку. За полную симулированную дистанцию.",
  },
  "stat.skew.tip": {
    en: "Bias-corrected sample skewness (G1) of final profit. 0 = symmetric, positive = a long right tail of big scores, negative = a long left tail.",
    ru: "Несмещённая выборочная асимметрия (G1) итогового профита. 0 — симметрия, плюс — длинный правый хвост больших заносов, минус — длинный левый хвост.",
  },
  "stat.kurt.tip": {
    en: "EXCESS kurtosis (G2) of final profit: 0 = normal-shaped tails, positive = fatter tails than a bell curve, so extreme stretches happen more often than a Gaussian bankroll formula assumes.",
    ru: "ИЗБЫТОЧНЫЙ эксцесс (G2) итогового профита: 0 — хвосты как у нормального распределения, плюс — хвосты толще колокола, экстремальные отрезки случаются чаще, чем предполагает гауссова формула банкролла.",
  },
  "stat.kelly.tip": {
    en: "The schedule's total buy-in as a share of the Kelly-optimal bankroll B* = σ²/μ. Dimensionless: 0.05 means the whole distance stakes 5% of a Kelly roll. Undefined unless the schedule is +EV.",
    ru: "Суммарный бай-ин расписания как доля оптимального по Келли банкролла B* = σ²/μ. Безразмерно: 0.05 — вся дистанция ставит 5% от ролла по Келли. Не определено, если расписание не в плюсе.",
  },
  "stat.logG.tip": {
    en: "Expected ln(1 + profit / bankroll) over the full distance — the quantity Kelly maximises. Positive = the roll compounds, negative = this schedule shrinks it even at positive EV. Ruin samples are floored at ln(0.01).",
    ru: "Ожидаемый ln(1 + профит / банкролл) за всю дистанцию — величина, которую максимизирует Келли. Плюс — банкролл растёт, минус — расписание его съедает даже при плюсовом EV. Сэмплы с разорением ограничены снизу ln(0.01).",
  },

  // Results — charts
  "chart.satellite": {
    en: "Satellite — tickets won per session",
    ru: "Сателлит — билеты за сессию",
  },
  "chart.satellite.sub": {
    en: "Ticket-cliff payouts make bankroll trajectory a step function — show the seat distribution instead",
    ru: "У плоских выплат траектория банкролла — ступенчатая; вместо неё показываем распределение числа билетов",
  },
  "chart.satellite.hist": {
    en: "Seats won per session",
    ru: "Выиграно билетов за сессию",
  },
  "chart.satellite.note": {
    en: "Every cash pays the same ticket — ordering above the cash line is irrelevant. Shots per seat = 1 / cash rate.",
    ru: "Каждый кеш — один и тот же билет, место в деньгах ни на что не влияет. Шансы на билет = 1 / cash rate.",
  },
  "chart.satellite.mixedNote": {
    en: "Hybrid schedule — this card summarises only the satellite row(s); the $ trajectory above mixes it with the rest of the schedule.",
    ru: "Гибридное расписание — эта карточка показывает только сателлитные строки; долларовая траектория выше смешивает их с остальным.",
  },
  "sat.kpi.expectedSeats": { en: "E[seats]", ru: "Ожидаемые билеты" },
  "sat.kpi.cashRate": { en: "Cash rate", ru: "Частота кэша" },
  "sat.kpi.shotsPerSeat": { en: "Shots per seat", ru: "Попыток на билет" },
  "sat.kpi.netPerSession": { en: "Net / session", ru: "Нетто / сессия" },
  "sat.kpi.seatPrice": { en: "Seat price", ru: "Цена билета" },
  "sat.kpi.seats": { en: "Seats", ru: "Мест" },
  "sat.perSession": { en: "tourneys / session", ru: "турниров в сессии" },
  "chart.trajectory": {
    en: "Plausible run spread",
    ru: "График разброса возможных ранов",
  },
  "chart.trajectory.ours.cap": {
    en: "Skill in deep finishes — honest swings.",
    ru: "Скилл в глубоких финишах — честные колебания.",
  },
  "chart.trajectory.ours.cap.naive": {
    en: "Deep-finish skill model, clean baseline.",
    ru: "Модель глубоких финишей, чистый базовый ран.",
  },
  "chart.trajectory.ours.cap.realisticSolo": {
    en: "Deep-finish skill + realistic solo-player noise.",
    ru: "Глубокие финиши + реалистичный шум одиночного игрока.",
  },
  "chart.trajectory.ours.cap.steadyReg": {
    en: "Deep-finish skill + disciplined-reg slow-tilt profile.",
    ru: "Глубокие финиши + slow-tilt профиль дисциплинированного регуляра.",
  },
  "chart.trajectory.ours.cap.custom": {
    en: "Your hand-tuned model.",
    ru: "Твоя ручная настройка модели.",
  },
  "chart.trajectory.theirs.cap": {
    en: "Min-cash as likely as 1st place — swings understated.",
    ru: "Мин-кэш равновероятен с 1-м местом — колебания занижены.",
  },
  "chart.trajectory.noKoLabel": {
    en: "Same schedule · bounties off",
    ru: "То же расписание · без ноков",
  },
  "chart.overlay.freezeouts": {
    en: "Freezeouts",
    ru: "Фризы",
  },
  "stat.pd.badge.freezeouts": {
    en: "FREEZE",
    ru: "ФРИЗЫ",
  },
  "chart.trajectory.noKoCap": {
    en: "Same schedule, bounties stripped — sanity check, not a comparison.",
    ru: "То же расписание без ноков — прикидка, не сравнение.",
  },
  "chart.hideJackpots": {
    en: "hide jackpots",
    ru: "скрыть джекпоты",
  },
  "chart.hideJackpots.title": {
    en: "Hide mystery / mystery-royale runs that drew an envelope ≥ 100× the mean. A handful of jackpot samples stretch the distribution x-axis and the trajectory y-axis into unreadable territory even though they're statistically rare. Note: this only reshapes the charts — the scalar stats panels (mean, max, VaR, skew) still reflect ALL samples including jackpots, and the trajectory envelopes are rebuilt from the ~1000 stored hi-res paths.",
    ru: "Скрыть mystery / mystery-royale раны, где вытянулся конверт ≥ 100× от среднего. Пара джекпотных сэмплов растягивает ось X гистограммы и ось Y траектории так, что остальной график становится нечитаемым, хотя статистически такие раны редки. Важно: это меняет только графики — скалярные статы (среднее, макс, VaR, скос) по-прежнему считаются по ВСЕМ сэмплам, включая джекпоты, а огибающие траектории пересобираются из ~1000 сохранённых hi-res путей.",
  },
  "chart.trajectory.withRakeback": {
    en: "RB in chart",
    ru: "РБ в графике",
  },
  "chart.stats.withRakeback": {
    en: "RB in stats",
    ru: "РБ в статах",
  },
  "chart.dist.withRakeback": {
    en: "RB in histograms",
    ru: "РБ в гистограммах",
  },
  "chart.recomputing": {
    en: "recomputing…",
    ru: "пересчёт…",
  },
  "chart.trajectory.withRakeback.title": {
    en: "Show the trajectory with rakeback applied (all sampled runs, EV, percentile bands and best/worst shift up by the deterministic RB curve). Uncheck to see the game-only view — exposes drawdowns, bust probability, and time-above-zero as they'd be without the RB cushion.",
    ru: "Показывать траекторию с учётом рейкбэка (все семплированные раны, EV, перцентильные полосы и best/worst сдвигаются вверх на детерминированную кривую РБ). Отключи — увидишь чистый game-only: стрики, вероятность разорения и время под нулём без РБ-подушки.",
  },
  "chart.rakeback.profitOnly.title": {
    en: "Shift only the quantities that move exactly under the deterministic rakeback curve. Drawdown, streak, and ruin stats stay on the engine's full-sample output.",
    ru: "Сдвигать только те величины, которые точно меняются от детерминированной кривой рейкбэка. Просадки, стрики и риск разорения остаются по full-sample расчёту движка.",
  },
  "chart.rakeback.fullSampleNote": {
    en: "Drawdown, streak, and ruin stats stay on the full-sample engine output.",
    ru: "Просадки, стрики и риск разорения остаются по full-sample расчёту движка.",
  },
  "chart.trajectory.overlay": {
    en: "Overlay PrimeDope on the left",
    ru: "Наложить PrimeDope слева",
  },
  "chart.trajectory.overlayHint": {
    en: "Show PrimeDope's mean + best/worst runs over our chart so the gap is unmistakable",
    ru: "Показать средний, лучший и худший раны PrimeDope поверх нашего графика — разница видна сразу",
  },
  "chart.trajectory.overlayNoKo": {
    en: "Overlay schedule without bounties",
    ru: "Наложить расписание без ноков",
  },
  "chart.trajectory.overlayNoKoHint": {
    en: "Show how the same schedule would look without bounties — overlay mean + extremes on the left chart",
    ru: "Показать как выглядело бы расписание без ноков — наложить среднее + экстремумы на левый график",
  },
  "chart.trajectory.pdPayouts": {
    en: "PD payout curves",
    ru: "Пейауты ПД",
  },
  "chart.trajectory.pdPayouts.hint": {
    en: "PD payout curves.\n\nSource: lifted from primedope.com's Tournament Variance Calculator — we ran their tool with 1000-player fields across 10-20% ITM presets, recorded the per-place % of pool, and rebuilt the same family locally (src/lib/sim/pdCurves.ts).\n\nShape: top-heavy but not crazy — 1st place ≈18-25% of pool, 2nd ≈13-15%, flat tail down to min-cash ≈1.5× buy-in. Paid spots ≈ round(0.15 × field). The curve family matches PD; this UI comparison still keeps our full-cost ROI basis unless a diagnostic script opts into PD-style EV.\n\nUncheck to run PD's math (finish model + rake quirk) on YOUR row's real payout table instead.",
    ru: "Пейауты ПД.\n\nИсточник: сняты с primedope.com Tournament Variance Calculator — прогоняли их калькулятор на полях в 1000 игроков по пресетам 10-20% ITM, записывали % пула на место и восстановили ту же семью у себя (src/lib/sim/pdCurves.ts).\n\nФорма: top-heavy, но не зверь — 1 место ≈18-25% пула, 2 ≈13-15%, плоский хвост до мин-кэша ≈1.5×БИ. Платных мест ≈ round(0.15 × поле). Семья кривых совпадает с PD; UI-сравнение всё равно держит нашу честную ROI-базу от полной стоимости, если только диагностический скрипт не включает PD-style EV.\n\nСнимите галку — прогнать математику ПД (финиш-модель + рейк-квирк) на РЕАЛЬНОЙ таблице выплат вашего турнира.",
  },
  "chart.trajectory.pdFinishModel": {
    en: "PD finish model",
    ru: "Финиш-модель ПД",
  },
  "chart.trajectory.pdFinishModel.hint": {
    en: "PD finish model: binary-ITM, uniform-over-paid. Every paid place is equally likely; below min-cash everyone busts identically.\n\nComparison (1000 players, 150 paid, +20% ROI target):\n  Place   Our α-model   PD model\n  1st     ~1.8× base    1/150 flat\n  10th    ~1.3× base    1/150 flat\n  75th    ~0.9× base    1/150 flat\n  150th   ~0.6× base    1/150 flat\n  151+    0             0\n\nOur model tilts skill toward deep finishes (α calibrated from real results), so the same EV produces more top-heavy variance. PD's flat model gives ~21% ITM vs our ~17% at the same ROI, but with noticeably narrower tails.\n\nUncheck to substitute our α-model into PD's pass (keeping their payouts + rake quirk) — isolates exactly how much the finish distribution contributes to the gap.",
    ru: "Финиш-модель ПД: бинарная ITM, равномерно по платным местам. Каждое платное место равновероятно; вне мин-кэша — все одинаково вылетают.\n\nСравнение (1000 игроков, 150 в деньгах, целевой ROI +20%):\n  Место   Наша α-модель   Модель ПД\n  1       ~1.8× базы       1/150 равномерно\n  10      ~1.3× базы       1/150 равномерно\n  75      ~0.9× базы       1/150 равномерно\n  150     ~0.6× базы       1/150 равномерно\n  151+    0                0\n\nНаша модель тянет скилл в глубокие финиши (α откалиброван по реальным результатам), поэтому при том же EV разброс более top-heavy. Плоская модель ПД даёт ≈21% ITM против наших ≈17% при том же ROI, но с заметно более узкими хвостами.\n\nСнимите галку — подставить нашу α-модель в прогон ПД (оставив их пейауты и рейк-квирк), чтобы увидеть вклад именно финиш-распределения в разрыв.",
  },
  "chart.trajectory.pdRakeMath": {
    en: "PD rake math",
    ru: "Рейк-арифметика ПД",
  },
  "chart.trajectory.pdRakeMath.hint": {
    en: "PD rake quirk (their §7): variance is driven by the POST-rake prize pool. In this comparison the EV target stays pinned to the same full-cost ROI as the left chart.\n\nExample — $100 + $9 rake, 1000 entrants, player ROI +20%:\n  EV target in both panes = 0.20 × $109 = $21.80\n\nBut SD differs:\n  Our SD scales with the full $109 × 1000 pool (rake is a real cost)\n  PD  SD scales with $100 × 1000 pool only (post-rake)\n  → PD's SD comes out ≈5% lower on this row (≈10% once rake is $20)\n\nConsequence: crank rake up to $20 and PD's simulated SD keeps dropping while EV stays pinned. This toggle isolates that coupling alone.\n\nUncheck to use the pre-rake pool in PD's pass.",
    ru: "Квирк рейка ПД (их §7): дисперсия считается от ПОСТ-рейкового призового пула. В этом сравнении EV-таргет закреплён тем же ROI от полной стоимости, что и левый график.\n\nПример — $100 + $9 рейк, 1000 участников, ROI игрока +20%:\n  EV-таргет в обеих панелях = 0.20 × $109 = $21.80\n\nНо SD разная:\n  Наша SD считается от полного пула $109 × 1000 (рейк — реальная стоимость)\n  SD ПД  считается только от $100 × 1000 (пост-рейк)\n  → SD ПД на этой строке выходит ≈5% ниже (при рейке $20 — уже ≈10%)\n\nСледствие: подними рейк до $20 — у ПД симулированная SD будет падать, а EV останется закреплённым. Эта галка изолирует только этот эффект.\n\nСнимите галку — использовать пре-рейковый пул в прогоне ПД.",
  },
  "chart.dist": { en: "Distribution of final profit", ru: "Распределение итогового профита" },
  "chart.ddDist": { en: "What streaks look like", ru: "Какие стрики бывают" },
  "chart.ddDist.sub": {
    en: "Distribution of the worst downstreak per sample across all runs",
    ru: "Распределение самого глубокого даунстрика по всем сэмплам",
  },
  "chart.longestBE": { en: "Breakeven stretches", ru: "Игра в ноль" },
  "chart.longestBE.sub": {
    en: "Longest horizontal chord of the profit graph — bouncing around without net progress",
    ru: "Самый длинный горизонтальный отрезок между двумя точками графика с одинаковым Y",
  },
  "chart.longestBE.tip": {"en":"For each starting checkpoint in each run, measure the longest horizontal chord of the profit curve: how far apart two points at the same profit level are. X is chord length in tournaments; Y counts these checkpoint observations across all runs. A run contributes multiple observations, not just its longest chord.","ru":"Для каждой начальной контрольной точки каждого рана измеряется самый длинный горизонтальный отрезок графика: расстояние между двумя точками на одном уровне профита. X — длина в турнирах; Y — число таких наблюдений по всем ранам. Один ран даёт несколько наблюдений, а не только свой максимальный отрезок."},
  "chart.longestCashless": { en: "Cashless streaks", ru: "Серии без ИТМ" },
  "chart.longestCashless.sub": {
    en: "How often and how long you grind without landing a cash",
    ru: "Как часто и как долго длятся серии без захода в призы",
  },
  "chart.longestCashless.rbNote": {
    en: "Independent of rakeback — counts ITM events, not profit.",
    ru: "Не зависит от рейкбэка — считает заходы в ИТМ, не профит.",
  },
  "chart.longestCashless.tip": {"en":"A cashless streak is a consecutive sequence of tournaments without a paid finish (place ≥ paidCount). It ends at the next ITM finish. X is streak length in tournaments; Y counts every such streak across all samples, not only each sample’s maximum.","ru":"Критерий: серия — это непрерывная последовательность турниров без попадания в призовую часть (place ≥ paidCount). Заканчивается на первом же ITM.\n\nПо X — длина серии в турнирах, по Y — сколько таких серий встретилось во всех сэмплах суммарно: все серии, а не только максимумы по сэмплу."},
  "chart.recovery": { en: "Recovery length", ru: "Отмазка" },
  "chart.recovery.sub": {
    en: "How many tournaments it takes to climb from the bottom back to the pre-streak peak",
    ru: "Сколько турниров уходит на то, чтобы со дна вернуться к прежнему пику",
  },
  "chart.recovery.tip": {"en":"For each sample, find its deepest peak-to-trough drawdown. Recovery is the number of tournaments from that trough until profit first regains the previous peak. Samples that do not recover before the schedule ends are excluded from this chart and reported separately.","ru":"Для каждого сэмпла находим самую глубокую просадку от пика до дна. Отмазка — количество турниров от её дна до первого возвращения профита на предыдущий максимум. Сэмплы, которые не восстановились к концу расписания, не входят в этот график и показаны отдельно."},
  "chart.recovery.unrecovered": {
    en: "{pct} of runs never recovered by end of schedule (not shown above)",
    ru: "{pct} ранов не восстановились до конца расписания (не показано на графике)",
  },
  "chart.legend.pdOverlay": {
    en: "Dashed: PrimeDope comparison",
    ru: "Пунктир: PrimeDope-сравнение",
  },
  "chart.legend.noKoOverlay": {
    en: "Dashed: same schedule without bounties",
    ru: "Пунктир: то же расписание без нокаутов",
  },
  "chart.legend.genericOverlay": {
    en: "Dashed: second chart overlaid",
    ru: "Пунктир: второй график, наложенный на текущий",
  },
  "chart.traj.runStats": { en: "run stats", ru: "статы рана" },
  "chart.traj.abi": { en: "ABI", ru: "ABI" },
  "chart.traj.finalProfit": { en: "final profit", ru: "итоговый профит" },
  "chart.traj.maxDD": { en: "max drawdown", ru: "макс. просадка" },
  "chart.traj.longestLosing": { en: "longest streak", ru: "макс. серия спада" },
  "chart.traj.longestBE": { en: "longest below-peak run", ru: "ниже пика (макс.)" },
  "chart.traj.tourneys": { en: "t", ru: "т" },
  "chart.traj.ddDuration": {
    en: "lasted {n} tournaments",
    ru: "длилась {n} турниров",
  },
  // Kind labels — shown in the tooltip header to explain what kind of line the user is hovering.
  "chart.traj.kind.mean": {
    en: "average across all simulated runs",
    ru: "среднее по всем симулированным ранам",
  },
  "chart.traj.kind.band": {
    en: "boundary of the percentile interval",
    ru: "граница интервала разброса",
  },
  "chart.traj.band.side.lower": {
    en: "lower edge",
    ru: "нижняя граница",
  },
  "chart.traj.band.side.upper": {
    en: "upper edge",
    ru: "верхняя граница",
  },
  "chart.traj.band.title": {
    en: "{coverage} interval · {side}",
    ru: "{coverage} интервал · {side}",
  },
  "chart.traj.kind.bestReal": {
    en: "the luckiest single simulated run",
    ru: "самый удачливый симулированный ран",
  },
  "chart.traj.kind.bestAgg": {
    en: "highest point any run reached at each moment",
    ru: "максимум среди всех ранов в каждой точке",
  },
  "chart.traj.kind.worstReal": {
    en: "the unluckiest single simulated run",
    ru: "самый неудачливый симулированный ран",
  },
  "chart.traj.kind.worstAgg": {
    en: "lowest point any run reached at each moment",
    ru: "минимум среди всех ранов в каждой точке",
  },
  "chart.traj.kind.path": {
    en: "one individual simulated run",
    ru: "один симулированный ран",
  },
  "chart.traj.kind.ref": {
    en: "reference line for the expected ROI",
    ru: "опорная линия ожидаемого ROI",
  },
  "chart.traj.hoverHint.peak": {
    en: "peak",
    ru: "пик",
  },
  "chart.traj.hoverHint.maxDd": {
    en: "max drawdown",
    ru: "макс. просадка",
  },
  "chart.traj.hoverHint.band": {
    en: "interval edges",
    ru: "границы интервалов",
  },
  "chart.traj.extreme.realBest": {
    en: "real best run",
    ru: "реал лучший ран",
  },
  "chart.traj.extreme.realWorst": {
    en: "real worst run",
    ru: "реал худший ран",
  },
  "chart.traj.extreme.aggBest": {
    en: "aggregated best",
    ru: "агрег. лучший",
  },
  "chart.traj.extreme.aggWorst": {
    en: "aggregated worst",
    ru: "агрег. худший",
  },
  // Likelihood strings — explain the probability context of the hovered line.
  "chart.traj.likelihood.median": {
    en: "half of runs are above this line, half are below",
    ru: "половина ранов выше этой линии, половина ниже",
  },
  "chart.traj.likelihood.below": {
    en: "about {pct}% of runs end up below this line",
    ru: "примерно {pct}% ранов оказываются ниже этой линии",
  },
  "chart.traj.likelihood.above": {
    en: "about {pct}% of runs end up above this line",
    ru: "примерно {pct}% ранов оказываются выше этой линии",
  },
  "chart.traj.likelihood.bestAgg": {
    en: "highest point any run reached at this moment",
    ru: "максимум среди всех ранов в этой точке",
  },
  "chart.traj.likelihood.worstAgg": {
    en: "lowest point any run reached at this moment",
    ru: "минимум среди всех ранов в этой точке",
  },
  "chart.traj.likelihood.bestReal": {
    en: "roughly the luckiest one in every N runs",
    ru: "примерно самый удачный из каждых N ранов",
  },
  "chart.traj.likelihood.worstReal": {
    en: "roughly the unluckiest one in every N runs",
    ru: "примерно самый неудачный из каждых N ранов",
  },
  "chart.traj.zoomHint": {
    en: "drag across X to zoom · double-click resets",
    ru: "протяни по X для зума · двойной клик сбрасывает",
  },
  "chart.traj.legend.ev": {
    en: "EV",
    ru: "EV",
  },
  "chart.traj.legend.runs": {
    en: "{n} runs",
    ru: "{n} ранов",
  },
  "chart.traj.legend.bands": {
    en: "70 / 95 / 99.7% intervals",
    ru: "интервалы 70 / 95 / 99.7%",
  },
  "chart.traj.legend.extremes": {
    en: "best / worst",
    ru: "лучший / худший",
  },
  "chart.traj.legend.overlay": {
    en: "dashed: {label}",
    ru: "пунктир: {label}",
  },
  "chart.traj.resetZoom": {
    en: "reset zoom",
    ru: "сброс зума",
  },
  "hist.tooltip.range": { en: "range", ru: "диапазон" },
  "hist.tooltip.share": { en: "share of runs", ru: "доля ранов" },
  "hist.tooltip.count": { en: "samples", ru: "сэмплов" },
  "hist.legend.ours": { en: "our model", ru: "наша модель" },
  "hist.tooltip.cumulative": { en: "at or below", ru: "до этого уровня" },
  "hist.tooltip.overflow": {
    en: "incl. overflow (heavy-tail clip)",
    ru: "с учётом хвоста (обрезан)",
  },
  "chart.convergence": { en: "ROI convergence", ru: "Сходимость ROI" },
  "chart.convergence.sub": {
    en: "How much volume you need before your observed ROI usually sits near the true ROI",
    ru: "Какой объём нужен, чтобы наблюдаемый ROI обычно держался рядом с истинным",
  },
  "convergence.skewNote": {
    en: "Volumes use a symmetric normal approximation. Real MTT results are right-skewed, so for tight targets or small samples the true band is mildly asymmetric — read these as a ballpark.",
    ru: "Объёмы считаются в симметрично-нормальном приближении. Реальные MTT-результаты скошены вправо, поэтому для тесных таргетов и малых выборок настоящая полоса слегка асимметрична — это ориентир, не точное число.",
  },
  "chart.convergence.noiseCaveat": {
    en: "Skill-uncertainty / shock / tilt channels are on. This σ comes from a clean baseline that excludes them, so real convergence takes more volume than shown — treat these numbers as an optimistic floor.",
    ru: "Включены каналы неопределённости скилла / шоков / тильта. Эта σ взята из чистого базлайна без них, поэтому реальная сходимость требует большего объёма — считай эти числа оптимистичным минимумом.",
  },
  "chart.convergence.col.target": { en: "ROI range", ru: "Диапазон ROI" },
  "chart.convergence.col.tourneys": { en: "Tournaments", ru: "Турниров" },
  "chart.convergence.col.fields": { en: "Full fields", ru: "Полных полей" },
  "chart.convergence.col.fields.title": {
    en: "The same volume counted in whole fields: tournaments ÷ average field size. 10× means you played as many entries as ten complete fields hold.",
    ru: "Тот же объём, но в целых полях: турниры ÷ средний размер поля. 10× значит, что сыграно столько входов, сколько вмещают десять полных полей.",
  },
  "chart.convergence.ci.title": {
    en: "Confidence level for the ± band. At {ci} % the normal quantile is z = {z}.",
    ru: "Уровень доверия для ± полосы. При {ci} % квантиль нормального распределения z = {z}.",
  },
  "chart.convergence.afs.lockedBR": {
    en: "Fixed at 18 for Battle Royale — the lobby is always 18-max, so AFS doesn't change across buy-in tiers",
    ru: "Зафиксирован на 18 для Батл Рояля — лобби всегда 18-max, AFS не меняется между бай-ин тирами",
  },
  "chart.convergence.rake": { en: "rake", ru: "рейк" },
  "chart.convergence.rake.title": {
    en: "Room rake — fraction of buy-in taken per entry. σ fits were measured at rake = 10 %, so shifting this knob rescales σ by (1+0.10)/(1+rake). Higher rake compresses σ in ROI units (same $-variance spread over a bigger cost basis) and also scales the RB→ROI conversion, since RB is expressed as a fraction of rake.",
    ru: "Рейк — доля бай-ина, которую забирает рум с каждого входа. σ измерена при рейке 10 %, так что ползунок пересчитывает σ как (1+0,10)/(1+рейк). Рост рейка сжимает σ в ROI-единицах (та же $-дисперсия, но делится на больший бай-ин+рейк) и одновременно меняет перевод РБ в ROI, ведь РБ задаётся в % от рейка.",
  },
  "chart.convergence.roi.invariant": {
    en: "Hidden here: this fit is ROI-invariant, so moving ROI would not change the table.",
    ru: "Скрыто здесь: этот fit не зависит от ROI, поэтому ползунок не менял бы таблицу.",
  },
  "chart.convergence.format.freeze": { en: "Freeze", ru: "Фриз" },
  "chart.convergence.format.pko": { en: "PKO", ru: "ПКО" },
  "chart.convergence.format.mystery": { en: "Mystery", ru: "Мистери" },
  "chart.convergence.format.mystery-royale": {
    en: "GG Battle Royal",
    ru: "GG Battle Royal",
  },
  "chart.convergence.format.mix": { en: "Mix", ru: "Микс" },
  "chart.convergence.format.exact": {
    en: "Schedule",
    ru: "Расписание",
  },
  "proveEdge.title": {
    en: "Volume needed to verify a chosen ROI",
    ru: "Сколько сыграть, чтобы проверить выбранный ROI",
  },
  "proveEdge.question": {
    en: "«if the player is really +X% long term, how much volume proves it?»",
    ru: "«если игрок реально имеет +X% на дистанции, сколько нужно сыграть, чтобы это было видно?»",
  },
  "proveEdge.intro": {
    en: "This block does not ask whether the player is simply above zero in any possible sense. It tests a concrete assumption: suppose the player's long-term ROI in this format is +X% after fees. How many tournaments are needed before that +X% is hard to confuse with ordinary variance?",
    ru: "Этот блок не спрашивает, плюсовой ли игрок вообще хоть чуть-чуть. Он проверяет конкретную гипотезу: допустим, долгосрочный ROI игрока в этом формате после комиссии равен +X%. Сколько турниров нужно, чтобы такой +X% было трудно спутать с обычной дисперсией?",
  },
  "proveEdge.guide.settings.title": {
    en: "1. Inputs",
    ru: "1. Вводные",
  },
  "proveEdge.guide.settings.body": {
    en: "Choose the tournament type, field size, fee, and the ROI hypothesis you want to test.",
    ru: "Выбери тип турнира, размер поля, комиссию и ROI-гипотезу, которую хочешь проверить.",
  },
  "proveEdge.guide.current.title": {
    en: "2. Tested ROI",
    ru: "2. Проверяемый ROI",
  },
  "proveEdge.guide.current.body": {
    en: "The highlighted row is the chosen long-term ROI, for example +20%.",
    ru: "Желтая строка — выбранный долгосрочный ROI игрока, например +20%.",
  },
  "proveEdge.guide.answer.title": {
    en: "3. Answer",
    ru: "3. Ответ",
  },
  "proveEdge.guide.answer.body": {
    en: "The table says how many tournaments are needed before that ROI reliably clears the confidence bar over 0% — not just half the time.",
    ru: "Таблица показывает, сколько турниров нужно, чтобы этот ROI уверенно (а не в половине случаев) отрывался от 0%.",
  },
  "proveEdge.format.label": { en: "Tournament type", ru: "Тип турнира" },
  "proveEdge.label.fieldSize": { en: "Field size", ru: "Размер поля" },
  "proveEdge.label.rake": { en: "Fee %", ru: "Комиссия %" },
  "proveEdge.label.confidence": { en: "Confidence %", ru: "Уверенность %" },
  "proveEdge.label.yourRoi": { en: "Tested ROI %", ru: "Проверяемый ROI %" },
  "proveEdge.afs.lockedBR": {
    en: "Battle Royale always has 18 players, so field size is locked.",
    ru: "В Battle Royale всегда 18 игроков, поэтому размер поля зафиксирован.",
  },
  "proveEdge.anchor.prefix": {
    en: "Current answer:",
    ru: "Ответ по выбранному ROI:",
  },
  "proveEdge.anchor.body": {
    en: "if the player's long-term ROI is {roi}, you need about {tourneys} tournaments to be {ci}% likely to see it separate from zero. That is roughly {fields} full fields of {afs} players.",
    ru: "если долгосрочный ROI игрока равен {roi}, ориентир по дистанции — {tourneys} турниров, чтобы с вероятностью {ci}% увидеть отрыв от нуля. Это около {fields} полных полей по {afs} игроков.",
  },
  "proveEdge.col.roi": {
    en: "If long-term ROI is",
    ru: "Если долгосрочный ROI",
  },
  "proveEdge.col.tourneys": { en: "Play this many", ru: "Нужно сыграть" },
  "proveEdge.col.fields": { en: "Full fields", ru: "Полных полей" },
  "proveEdge.footnote.banded": {
    en: "Ranges include the model's residual noise buffer. Near 0% ROI the required volume explodes, because a tiny positive result is almost indistinguishable from normal tournament variance.",
    ru: "Диапазоны включают запас на остаточную ошибку модели. Рядом с 0% нужный объем резко растет, потому что маленький плюс почти неотличим от обычной турнирной дисперсии.",
  },
  "proveEdge.footnote.point": {
    en: "Point estimate only: the current field size or ROI is outside the validated model zone, so the range is hidden. Use the number as a rough planning estimate.",
    ru: "Показана только точка: текущий размер поля или ROI выходит за проверенную зону модели, поэтому диапазон скрыт. Используй число как грубый ориентир по дистанции.",
  },
  "proveEdge.outOfBox.single": {
    en: "Current settings are outside the zone where the model has a verified range. The estimate is still useful as a ballpark, but the uncertainty band is hidden.",
    ru: "Текущие настройки вне зоны, где у модели проверен диапазон. Оценка все еще полезна как ориентир, но полоса неопределенности скрыта.",
  },
  "proveEdge.outOfBox.exact": {
    en: "At least one schedule row is outside the verified model zone, so the schedule estimate is shown without a range.",
    ru: "Минимум одна строка расписания вне проверенной зоны модели, поэтому оценка по расписанию показана без диапазона.",
  },
  "proveEdge.noiseCaveat": {
    en: "Skill-uncertainty / shock / tilt channels are on. The σ here comes from a clean baseline that excludes them, so the real volume to prove an edge is higher than shown — treat these numbers as an optimistic floor.",
    ru: "Включены каналы неопределённости скилла / шоков / тильта. σ здесь взята из чистого базлайна без них, поэтому реальный объём для доказательства эджа больше показанного — считай эти числа оптимистичным минимумом.",
  },
  "proveEdge.schedule.empty": {
    en: "Schedule mode needs at least one row above. Add a row or choose a single tournament type.",
    ru: "Режиму Расписание нужна хотя бы одна строка выше. Добавь строку или выбери отдельный тип турнира.",
  },
  "proveEdge.schedule.effective": {
    en: "From schedule",
    ru: "По расписанию",
  },
  "proveEdge.schedule.field": {
    en: "field",
    ru: "поле",
  },
  "proveEdge.schedule.roi": {
    en: "ROI",
    ru: "ROI",
  },
  "proveEdge.schedule.noise": {
    en: "noise",
    ru: "шум",
  },
  "proveEdge.showLosing": {
    en: "Show losing ROI rows too",
    ru: "Показать и минусовые строки",
  },
  "chart.convergence.mode.hint": {
    en: "Averaged: generic planning mode. Freeze, Mystery, and Battle Royale use runtime single-row compiles at the chosen controls, while PKO uses the promoted format fit. Mix weights are shares of tournaments in the synthetic mix. Schedule: compiles the real rows and aggregates per-row dollar variance, field variability, payout shape, rake, and bounty structure into one schedule-aware σ_ROI.",
    ru: "Усреднённо: общий planning-режим. Для Фриза, Мистери и Battle Royale берётся runtime single-row компиляция на выбранных контролах, а для ПКО используется промоутнутый format-fit. В Миксе веса означают долю турниров в синтетическом миксе. Расписание: компилирует реальные строки и агрегирует долларовую дисперсию по строкам, field variability, payout-shape, рейк и bounty-структуру в один schedule-aware σ_ROI.",
  },
  "chart.convergence.exact.breakdown": {
    en: "Variance contribution per row",
    ru: "Вклад рядов в дисперсию",
  },
  "chart.convergence.exact.pointOnly": {
    en: "Schedule mode is point-only: CI still changes the confidence target, and 'AFS played' uses the compiled mean field of the schedule:",
    ru: "Режим Расписание даёт точечную оценку: CI по-прежнему меняет доверительность, а «Сыграно AFS» считается по скомпилированному среднему полю расписания:",
  },
  "chart.convergence.exact.bandedBox": {
    en: "Every row is inside its format's validated fit-box — schedule shows a numeric ±band weighted by per-row variance contribution. AFS played uses the compiled mean field:",
    ru: "Все строки внутри провалидированных fit-boxов своих форматов — расписание показывает численный ±диапазон, взвешенный по вкладам в дисперсию. «Сыграно AFS» считается по скомпилированному среднему полю:",
  },
  "chart.convergence.exact.rowCol.row": { en: "Row", ru: "Ряд" },
  "chart.convergence.exact.rowCol.afs": { en: "AFS", ru: "AFS" },
  "chart.convergence.exact.rowCol.roi": { en: "ROI", ru: "ROI" },
  "chart.convergence.exact.rowCol.fmt": { en: "Format", ru: "Формат" },
  "chart.convergence.exact.rowCol.share": { en: "Spend %", ru: "Доля затрат" },
  "chart.convergence.exact.rowCol.varShare": { en: "σ² share", ru: "Доля σ²" },
  "chart.convergence.synthetic.hint": {
    en: "Synthetic what-if — not your schedule",
    ru: "Синтетический what-if — не ваше расписание",
  },
  "chart.convergence.mix.note": {
    en: "Mix weights are shares of tournaments in the synthetic mix, not dollar-risk shares.",
    ru: "Веса в Миксе — это доли турниров в синтетическом миксе, а не доли долларового риска.",
  },
  "chart.convergence.bandWarning.outsideFitBox": {
    en: "Current AFS / ROI sits outside the validated training box for this format (freeze & PKO / Mystery field 50–50 000, PKO / Mystery ROI −20..+80 %, MBR field fixed at 18 with ROI ±10 %). The point estimate is still a ballpark, but the ± band would be extrapolation territory so it's suppressed.",
    ru: "Текущий AFS / ROI выходит за пределы validated training box для этого формата (фриз и ПКО / Мистери поле 50–50 000, ПКО / Мистери ROI −20..+80 %, MBR поле строго 18 и ROI ±10 %). Точка всё ещё ориентир, но ± полоса здесь уже была бы экстраполяцией, поэтому её скрыли.",
  },
  "chart.convergence.assumptions.summary": {
    en: "How to read a row",
    ru: "Как читать строку",
  },
  "chart.convergence.assumptions": {
    en: "Read a row like this: this is roughly how many tournaments you need before your observed ROI usually stays inside the chosen band around the true ROI at the selected confidence level. Freeze, Mystery, and Battle Royale use runtime format-specific estimates; PKO uses a validated fitted model, and Mix blends the formats by their tournament weights. Schedule mode does not use the global AFS / ROI / rake sliders: it evaluates each row with its own settings and then combines the full schedule variance. Numeric ranges are shown only where they are validated; outside that safe zone the table falls back to a point estimate.",
    ru: "Читай строку так: примерно столько турниров нужно, чтобы при выбранной доверительности наблюдаемый ROI обычно держался внутри указанного диапазона вокруг истинного ROI. Фриз, Мистери и Battle Royale считают это через runtime-модель своего формата; ПКО использует проверенную аппроксимацию, а Микс объединяет форматы по весам турниров. Режим Расписание не использует глобальные ползунки AFS / ROI / рейка: он считает каждую строку отдельно с её собственными настройками, а потом собирает общую дисперсию всего расписания. Числовой диапазон показывается только там, где он провалидирован; вне безопасной зоны таблица оставляет только точечную оценку.",
  },

  "unit.money": { en: "$", ru: "$" },
  "unit.abi": { en: "ABI", ru: "АБИ" },
  "unit.tourneys": { en: "tournaments", ru: "турниров" },

  "lineStyle.label": { en: "Line style", ru: "Стиль линий" },
  "lineStyle.preset.classic.label": { en: "Classic", ru: "Классика" },
  "lineStyle.preset.classic.desc": {
    en: "Amber mean + cool blue EV. Balanced readability on dark.",
    ru: "Янтарная основная + прохладная синяя EV. Универсальная читаемость на тёмном фоне.",
  },
  "lineStyle.preset.duotone.label": { en: "Duotone", ru: "Дуотон" },
  "lineStyle.preset.duotone.desc": {
    en: "Teal + magenta complementary pair. Maximum line separation.",
    ru: "Бирюза и магента — комплементарная пара. Максимальное разделение линий.",
  },
  "lineStyle.preset.mono.label": { en: "Monochrome", ru: "Монохром" },
  "lineStyle.preset.mono.desc": {
    en: "Near-monochrome slate. Minimal palette for clean screenshots.",
    ru: "Почти монохромная сланцевая палитра. Минимум цвета — удобно для скриншотов.",
  },
  "lineStyle.preset.vivid.label": { en: "Vivid", ru: "Яркий" },
  "lineStyle.preset.vivid.desc": {
    en: "Saturated purple + yellow. Loud but harmonic editorial accent.",
    ru: "Насыщенная пурпурная и жёлтая палитра. Громкая, но гармоничная.",
  },
  "lineStyle.preset.highContrast.label": { en: "High Contrast", ru: "Контрастный" },
  "lineStyle.preset.highContrast.desc": {
    en: "Colorblind-friendly: Wong palette + thicker lines + distinct dashes.",
    ru: "Для дальтоников: палитра Вонга, утолщённые линии, различимый пунктир.",
  },
  "lineStyle.preset.neon.label": { en: "Neon", ru: "Неон" },
  "lineStyle.preset.neon.desc": {
    en: "Bright fluorescent colours on dark background — maximum visibility.",
    ru: "Яркие флуоресцентные цвета на тёмном фоне — максимальная видимость.",
  },
  "runs.label": { en: "Runs shown", ru: "Показано ранов" },
  "runs.trim.best": { en: "− best", ru: "− лучш." },
  "runs.trim.worst": { en: "− worst", ru: "− худш." },
  "seedBatch.label": { en: "Seed variant", ru: "Вариант сида" },
  "seedBatch.prev": { en: "Previous cached run", ru: "Предыдущий кэшированный ран" },
  "seedBatch.next": { en: "Next cached run", ru: "Следующий кэшированный ран" },
  "seedBatch.computing": {
    en: "precomputing more in background…",
    ru: "досчитываются ещё в фоне…",
  },
  "seedBatch.full": {
    en: "all sibling runs cached",
    ru: "все соседние раны в кэше",
  },
  "runExport.copyLink": { en: "Copy run link", ru: "Ссылка на прогон" },
  "runExport.copyLink.hint": {
    en: "Copy a link that opens this run's schedule and settings. Opening the link draws a fresh seed, so the numbers will differ.",
    ru: "Скопировать ссылку с расписанием и настройками этого прогона. При открытии ссылки берётся свежий сид, поэтому числа будут другими.",
  },
  "runExport.copyCsv": { en: "Copy stats CSV", ru: "Статистика в CSV" },
  "runExport.copyCsv.hint": {
    en: "Copy the headline numbers as CSV text.",
    ru: "Скопировать ключевые числа как CSV-текст.",
  },
  "runExport.copied": { en: "copied ✓", ru: "скопировано ✓" },
  "runExport.failed": {
    en: "clipboard blocked",
    ru: "буфер обмена недоступен",
  },
  "runs.mode.worst": { en: "worst", ru: "худшие" },
  "runs.mode.random": { en: "random", ru: "случайные" },
  "runs.mode.best": { en: "best", ru: "лучшие" },
  "runs.mode.title": {
    en: "Which runs to show: worst, random, or best by final profit",
    ru: "Какие раны показывать: худшие, случайные или лучшие по итоговому профиту",
  },
  "refLines.label": { en: "Ref ROI", ru: "ROI линии" },
  "refLines.title": { en: "ROI reference lines", ru: "Опорные ROI линии" },
  "refLines.enabled": { en: "Show line", ru: "Показывать линию" },
  "refLines.color": { en: "Line color", ru: "Цвет линии" },
  "refLines.roi": { en: "ROI %", ru: "ROI %" },
  "refLines.remove": { en: "Remove", ru: "Удалить" },
  "refLines.add": { en: "Add line", ru: "Добавить линию" },
  "section.primedopeReport": { en: "PrimeDope report", ru: "PrimeDope отчёт" },
  "section.pdWeakness": { en: "PrimeDope model flaws", ru: "Минусы модели PrimeDope" },
  "section.settingsDump": { en: "Run settings", ru: "Настройки рана" },
  "section.pdDiff": { en: "PrimeDope diff", ru: "Разница с PrimeDope" },
  "section.pdDiff.freezeouts": {
    en: "Freezeouts diff",
    ru: "Разница с фризами",
  },
  "lineStyle.customize": { en: "Customize", ru: "Настроить" },
  "lineStyle.reset": { en: "Reset", ru: "Сброс" },
  "lineStyle.resetAll": { en: "Reset all", ru: "Сбросить всё" },
  "lineStyle.width": { en: "Width", ru: "Толщина" },
  "lineStyle.line.mean": { en: "Mean winnings", ru: "Средний выигрыш" },
  "lineStyle.line.ev": {
    en: "EV line",
    ru: "Линия EV",
  },
  "lineStyle.line.best": { en: "Luckiest run", ru: "Самый удачный ран" },
  "lineStyle.line.worst": { en: "Unluckiest run", ru: "Самый неудачный ран" },
  "lineStyle.line.p05": {
    en: "Worst 95% run",
    ru: "Худший 95% ран",
  },
  "lineStyle.line.p95": {
    en: "Best 95% run",
    ru: "Лучший 95% ран",
  },
  "presets.export": { en: "Export", ru: "Экспорт" },
  "presets.import": { en: "Import", ru: "Импорт" },
  "presets.importError": {
    en: "Could not read that file — expected JSON exported from variance.lab.",
    ru: "Не смог прочитать файл — ожидается JSON, экспортированный из variance.lab.",
  },
  "presets.importDone": {
    en: "Imported {n} {_preset}.",
    ru: "Импортировано {n} {_preset}.",
  },
  "changelog.title": { en: "Changelog", ru: "Чейнджлог" },
  "changelog.v076.title": { en: "v0.7.6 — 2026-04-22", ru: "v0.7.6 — 2026-04-22" },
  "changelog.v076.summary": {
    en: "Result cards and tournament preview became much clearer and easier to scan.",
    ru: "Карточки результатов и превью одного турнира стали заметно понятнее и чище визуально.",
  },
  "changelog.v076.pdWeakness": {
    en: "The PrimeDope weakness section was rewritten around the real MTT math gap: finish shell, modern format channels, and missing uncertainty layers.",
    ru: "Блок про слабости PrimeDope переписан вокруг реального math-gap в MTT: finish-shell, современные форматные каналы и отсутствующие слои неопределённости.",
  },
  "changelog.v075.title": { en: "v0.7.5 — 2026-04-22", ru: "v0.7.5 — 2026-04-22" },
  "changelog.v075.summary": {
    en: "Mystery and Battle Royale now show honest validated convergence ranges instead of vague warnings or stale fits.",
    ru: "Mystery и Battle Royale теперь показывают честные валидированные диапазоны сходимости вместо мутных warning'ов и старых fit-оценок.",
  },
  "changelog.v075.inputs": {
    en: "Numeric drafts are calmer: whole-number boxes stop keeping junk tails, and inputs like 0100 collapse back to 100.",
    ru: "Числовые поля стали спокойнее: цельнопроцентные боксы перестали тащить мусорные хвосты, а ввод вроде 0100 автоматически схлопывается обратно в 100.",
  },
  "changelog.v074v073.title": {
    en: "v0.7.4–0.7.3 — BR and preview cleanup",
    ru: "v0.7.4–0.7.3 — Battle Royale и превью",
  },
  "changelog.v074v073.summary": {
    en: "Battle Royale got saner ROI / winner-first behavior, and the EV split preview became easier to read.",
    ru: "В Battle Royale починили ROI / winner-first логику, а разложение EV в превью стало заметно понятнее.",
  },
  "changelog.v07x.title": {
    en: "v0.7.1–0.7 — major simulator expansion",
    ru: "v0.7.1–0.7 — большое расширение симулятора",
  },
  "changelog.v07x.summary": {
    en: "Cash mode, Mystery, Battle Royale, exact schedule mode, better convergence, and rakeback-aware results all landed here.",
    ru: "Здесь приехали cash mode, Mystery, Battle Royale, exact-режим расписания, сильнее блок сходимости и нормальный учет рейкбека в результатах.",
  },
  "changelog.early.title": {
    en: "Earlier",
    ru: "Раньше",
  },
  "changelog.early.summary": {
    en: "The foundations landed early: PKO support, PrimeDope comparison, EV breakdowns, presets, and import/export.",
    ru: "База появилась здесь: PKO, сравнение с PrimeDope, разложение EV, пресеты и импорт/экспорт.",
  },
  // PrimeDope diff
  "pd.title": {
    en: "Us vs PrimeDope",
    ru: "Мы против PrimeDope",
  },
  "pd.subtitle": {
    en: "Same seed, same schedule — the only difference is the calibration. PrimeDope treats every paid place as equally likely once you cash, so a skilled player's edge shows up only as a higher cash rate, not as deeper finishes. Losing runs and rare outcomes come out structurally softer than reality.",
    ru: "Одно и то же зерно, то же расписание — отличается только калибровка. PrimeDope считает все призовые места равновероятными внутри денег, поэтому эдж скилловика реализуется только через частоту попаданий в деньги, а не через более глубокий проход. Длинные минусы и редкие исходы у него поэтому всегда мягче реальности.",
  },
  "pd.title.freezeouts": {
    en: "Us vs Freezeouts",
    ru: "Мы против фризов",
  },
  "pd.subtitle.freezeouts": {
    en: "Same seed, same schedule — the only difference is bounties. The right column shows the same schedule with all knockout payouts stripped out, so you can see exactly how much variance (and EV) the bounty pool adds on top of a pure freezeout.",
    ru: "Одно и то же зерно, то же расписание — отличаются только баунти. Правая колонка показывает то же расписание с полностью срезанными ноками, чтобы было видно, сколько дисперсии (и EV) баунти-пул добавляет поверх чистого фризаута.",
  },
  "pd.ours": { en: "ours", ru: "наши" },
  "pd.theirs": { en: "primedope", ru: "primedope" },
  "pd.match": { en: "matches PD", ru: "совпадает с PD" },
  "pd.reproduce.label": { en: "Open PrimeDope", ru: "Открыть PrimeDope" },
  "pd.reproduce.copied": { en: "Copied ✓ opening…", ru: "Скопировано ✓ открываем…" },
  "pd.reproduce.hint": {
    en: "PrimeDope has no pre-fill URL — we open their site and copy a cheat-sheet of your values to the clipboard so you can paste them in.",
    ru: "PrimeDope не поддерживает предзаполнение — мы открываем их сайт и копируем параметры в буфер обмена для ручной вставки.",
  },
  "pd.metric": { en: "Metric", ru: "Метрика" },
  "pd.delta": { en: "Δ", ru: "Δ" },
  "pd.row.itm": { en: "Cash-in rate", ru: "Частота призовых" },
  "pd.row.itm.cash": {
    en: "Cash-in rate (excl. bounties)",
    ru: "Частота кэш-призовых (без баунти)",
  },
  "pd.row.itm.cashNote": {
    en: "Bounty formats: only cash-payout finishes count as ITM here. Bounties are paid separately on every knockout and don't move this number, so comparing against a no-bounty run understates how often you actually get paid.",
    ru: "Для баунти-форматов ITM считает только попадания в кэш-призовые; головы платятся отдельно за каждый нокаут и в эту цифру не входят — поэтому сравнение с фризом занижает реальную частоту выплат.",
  },
  "chart.itmBadge.cash": { en: "Cash-ITM", ru: "Кэш-ITM" },
  "chart.itmBadge.cash.tip": {
    en: "Cash-ITM rate: share of tournaments where you hit a cash payout. Bounty winnings (knockouts) are earned on a separate EV channel and aren't counted here.",
    ru: "Доля турниров, где вы попали в кэш-призовые. Заработок с голов — отдельный EV-канал и в эту цифру не входит.",
  },
  "pd.row.dd": { en: "Average drawdown", ru: "Средняя просадка" },
  "pd.row.cvar": { en: "Average loss in worst 5%", ru: "Средний убыток в худших 5%" },
  "pd.row.pprofit": { en: "Chance to be up", ru: "Шанс выйти в плюс" },
  "pd.row.ror": { en: "Bankroll bust risk", ru: "Риск слить банкролл" },
  "pd.row.var95": { en: "Lower tail 5%", ru: "Нижний хвост 5%" },
  "pd.row.cvar99": { en: "Average loss in worst 1%", ru: "Средний убыток в худших 1%" },
  "pd.row.worstRun": { en: "Worst scenario", ru: "Худший сценарий" },
  "pd.row.bestRun": { en: "Best scenario", ru: "Лучший сценарий" },
  "pd.row.longestBE": { en: "Avg worst flatline", ru: "Средний худший откат" },
  "pd.row.ddWorst": { en: "Deepest drawdown seen", ru: "Максимальная просадка" },
  "pd.row.ev": { en: "Expected profit (EV)", ru: "Ожидаемый профит (EV)" },
  "pd.evDelta.title": {
    en: "EV target is pinned in both panes",
    ru: "EV-таргет одинаковый в обеих панелях",
  },
  "pd.evDelta.body": {
    en: "The comparison keeps the same schedule ROI and full-cost EV target on both sides. Differences below are variance / distribution effects, while the actual MC mean can still wander with finite samples.",
    ru: "Сравнение держит один и тот же ROI расписания и EV от полной стоимости на обеих сторонах. Разницы ниже — это эффекты дисперсии и распределения, а фактическое MC-среднее всё ещё может гулять на конечном числе сэмплов.",
  },

  // Payout structure card
  "payouts.title": { en: "Payout ladder", ru: "Выплаты по местам" },
  "payouts.subtitle": {
    en: "{paid} of {total} places paid ({pct}%). Min cash ≈ {min}× buy-in.",
    ru: "Платят {paid} из {total} мест ({pct}%). Мин-кэш ≈ {min}× бай-инов.",
  },
  "payouts.rowPicker": { en: "Pick row", ru: "Выбрать строку" },
  "payouts.palette": { en: "Palette", ru: "Палитра" },
  "payouts.palette.accent": { en: "Accent", ru: "Акцент" },
  "payouts.palette.medal": { en: "Medals", ru: "Медали" },
  "payouts.palette.heat": { en: "Heat", ru: "Жар" },
  "payouts.palette.ocean": { en: "Ocean", ru: "Океан" },
  "payouts.palette.mono": { en: "Mono", ru: "Моно" },
  "payouts.paidTail": { en: "paid tail", ru: "хвост итм" },
  "payouts.nonItm": { en: "no cash", ru: "не итм" },
  "payouts.nonItmShare": {
    en: "{pct}% of field",
    ru: "{pct}% поля",
  },
  "payouts.pool.cash": { en: "Cash pool", ru: "Кеш-пул" },
  "payouts.pool.bounty": { en: "Bounty pool", ru: "Пул ноков" },
  "payouts.pool.note": {
    en: "Bars below show how the cash pool is split across places. Bounties are distributed separately when opponents bust you.",
    ru: "Полосы ниже показывают, как делится кеш-пул по местам. Ноки разыгрываются отдельно — при выбивании соперников.",
  },
  "payouts.pool.noteBr": {
    en: "Bars below show how the cash pool is split across places. The bounty pool is drawn through tiered envelopes opened for the top 9 finishers.",
    ru: "Полосы ниже — распределение кеш-пула по местам. Пул ноков разыгрывается через тиры конвертов, открываемых топ-9 финалистами.",
  },

  // Preview
  "preview.title": { en: "Single-tournament EV", ru: "ЕВ одного турнира" },
  "preview.avgReturn": { en: "EV profit", ru: "EV профит" },
  "preview.evSplit": { en: "EV mix", ru: "Состав EV" },
  "preview.evSplit.cash": { en: "cash", ru: "кеш" },
  "preview.evSplit.bounty": { en: "bounty", ru: "ноки" },
  "preview.evBias.label": {
    en: "KOs as % of gross EV",
    ru: "Какой % EV дают ноки",
  },
  "preview.evBias.tip": {
    en: "Pick what share of gross EV should come from knockouts. Under the hood this is still the same cash-vs-bounty rebalance: total ROI stays fixed, while the engine shifts EV between the regular payout pool and the KO pool. Higher KO share means less cash EV and more knockout EV; lower KO share does the opposite. In Battle Royale, the published envelope table keeps average KO size fixed, so the shift increases expected KO count instead of inflating each envelope.",
    ru: "Выбирает, какая доля брутто-EV должна приходить из ноков. Под капотом это тот же самый ребаланс между кеш-пулом и KO-пулом: общий ROI остаётся фиксированным, а движок перекладывает EV между выплатами за места и ноками. Больше доля ноков — меньше EV от мест и больше EV от KO-канала; меньше доля ноков — наоборот. В Battle Royale средний размер конверта фиксирован таблицей, поэтому сдвиг увеличивает ожидаемое число ноков, а не раздувает каждый отдельный нок.",
  },
  "preview.evBias.cash": { en: "cash", ru: "кэш" },
  "preview.evBias.bounty": { en: "KOs", ru: "ноки" },
  "preview.evBias.reset": { en: "reset", ru: "сброс" },
  "preview.topHeavyBias.label": {
    en: "ITM top-heaviness",
    ru: "% топ-хеви ITM",
  },
  "preview.topHeavyBias.tip": {
    en: "Changes how finishes are distributed inside the paid band without changing total EV. Left flattens the ITM distribution toward lower cashes; right pushes more mass upward. In fixed-ITM freezeouts this multiplicatively tilts the free paid places before α closes EV; in Battle Royale it walks the feasible 1st/2nd/3rd line while keeping the chosen cash EV fixed.",
    ru: "Меняет, как распределяются места внутри призовой зоны, не меняя общий EV. Влево — ITM становится ровнее и ближе к нижним кешам; вправо — больше массы уходит вверх. Во фризах с фиксированным ITM это мультипликативно наклоняет свободные платные места перед тем, как α закрывает EV; в Battle Royale двигает точку по допустимой линии 1/2/3 места, сохраняя выбранный cash EV.",
  },
  "preview.topHeavyBias.flat": { en: "flatter", ru: "ровнее" },
  "preview.topHeavyBias.heavy": { en: "top-heavy", ru: "топ-хеви" },
  "preview.evSplit.bountyRegular": {
    en: "bounty (regular)",
    ru: "ноки (обычные)",
  },
  "preview.evSplit.bountyJackpot": {
    en: "jackpot (≥{x}×)",
    ru: "джекпот (≥{x}×)",
  },
  "preview.evSplit.jackpotTip": {
    en: "Expected $ per entry from per-KO envelope draws that pay ≥{x}× the mean bounty. Battle Royal reads GG's published 10-tier table; plain Mystery approximates via the log-normal tail. PKO and freezeouts effectively zero.",
    ru: "Ожидаемые $ с входа от тех per-KO конвертов, которые платят ≥{x}× средней головы. Battle Royal читает опубликованную GG 10-тировую таблицу; обычный Mystery — через хвост лог-нормали. PKO и фризы фактически 0.",
  },
  "preview.hover.places": { en: "places", ru: "места" },
  "preview.hover.hitRate": { en: "Hit rate", ru: "Как часто" },
  "preview.hover.oddsIn": { en: "in", ru: "из" },
  "preview.hover.givenHit": { en: "When you land here", ru: "Когда попадаешь сюда" },
  "preview.hover.cashPayout": { en: "Cash payout", ru: "Кеш-выплата" },
  "preview.hover.bountyTotal": { en: "Bounty $", ru: "Ноки $" },
  "preview.hover.bountyHeads": { en: "Heads busted (avg)", ru: "Выбитых голов (среднее)" },
  "preview.hover.bountyAvgSize": { en: "Avg head size", ru: "Средний размер нока" },
  "preview.hover.totalTake": { en: "Total take", ru: "Всего на руки" },
  "preview.hover.perEntry": {
    en: "Contribution to EV per entry (× hit rate)",
    ru: "Вклад в EV на вход (× частота)",
  },
  "preview.rowPicker": {
    en: "Row",
    ru: "Строка",
  },
  "preview.statRoi": { en: "ROI", ru: "ROI" },
  "preview.statBountyPko": {
    en: "progressive PKO",
    ru: "прогрессивные PKO",
  },
  "preview.statBountyFlat": {
    en: "flat KO",
    ru: "обычные KO",
  },
  "preview.evBreakdown": {
    en: "Where the profit comes from",
    ru: "Откуда приходит профит",
  },
  "preview.colEv": { en: "% of EV", ru: "% EV" },
  "preview.colField": { en: "top %", ru: "топ %" },
  "preview.colEq": { en: "eq %", ru: "равн %" },
  "preview.colRoi": { en: "$ / entry", ru: "$ / вход" },
  "preview.evBreakdownTotal": { en: "ROI per entry", ru: "ROI на вход" },
  "preview.probFirstCash": {
    en: "First min-cash (after bubble)",
    ru: "Первый мин-кеш (после бабла)",
  },
  "preview.probBubble": { en: "Bubble boy", ru: "Бабл-бой" },
  "preview.tierWinner": { en: "1st place", ru: "1-е место" },
  "preview.tierTop3": { en: "2nd-3rd", ru: "2-3 места" },
  "preview.tierFt": { en: "4th-9th", ru: "4-9 места" },
  "preview.tierFtNonCash": { en: "5th-9th", ru: "5-9 места" },
  "preview.tierTop27": { en: "10th-27th", ru: "10-27 места" },
  "preview.tierRestItm": { en: "Rest of cashes", ru: "Остальные кеши" },
  "preview.tierOotm": { en: "Not ITM", ru: "Не ITM" },
  "preview.itmLocked": {
    en: "This row inherits the global ITM%. To override just this tournament, set its ITM% inside the schedule row.",
    ru: "Эта строка наследует глобальный ITM%. Чтобы переопределить его только для этого турнира, задай ITM% в самой строке расписания.",
  },
  "controls.itmTarget.hint": {
    en: "Global in-the-money rate applied to every row that has no ITM % of its own. Pins how often you cash regardless of ROI — the skill then shows up as running deeper, not cashing more often. Untick to let each row use its payout table's paid fraction.",
    ru: "Глобальная частота попадания в призы для всех строк без своего ITM %. Фиксирует, как часто ты заходишь в деньги независимо от ROI — скилл проявляется как более глубокие заносы, а не более частые. Сними галку, чтобы строки брали paid-фракцию своей структуры выплат.",
  },
  "controls.itmTarget.label": {
    en: "ITM %",
    ru: "ITM%",
  },
  "controls.rakeback.label": {
    en: "Rakeback %",
    ru: "Рейкбек %",
  },
  "controls.rakeback.title": {
    en: "Global promo budget from rake. By default it comes back as direct deterministic RB after every entry. In advanced mode, BR rows can divert part of that same budget into the separate leaderboard channel instead.",
    ru: "Глобальный промо-бюджет из рейка. По умолчанию он возвращается как прямой детерминированный RB после каждого входа. В advanced-режиме BR-строки могут увести часть этого же бюджета в отдельный лидербордный канал.",
  },
  "controls.rakeback.avgBr": {
    en: "40% BR ref",
    ru: "40% BR",
  },
  "controls.rakeback.avgBrTitle": {
    en: "Set the rough Battle Royale regulars reference: 40% of paid rake returned as rakeback.",
    ru: "Поставить примерный ориентир регов Battle Royale: 40% уплаченного рейка возвращается рейкбеком.",
  },
  "controls.brLeaderboard.label": {
    en: "BR leaderboard",
    ru: "Лидерборд BR",
  },
  "controls.brLeaderboard.note": {
    en: "Observed reconstructs leaderboard promo from profile totals; Manual and Lookup let you plan a target limit without played distance there. This stays separate from path-risk metrics.",
    ru: "Observed восстанавливает промо из totals профиля; Manual и Lookup позволяют планировать нужный лимит без своей дистанции на нём. В path-risk метрики это не входит.",
  },
  "controls.brLeaderboard.lockedBasic": {
    en: "This block is editable in advanced mode. Saved or shared leaderboard values still apply to the EV total in basic mode.",
    ru: "Этот блок редактируется в advanced-режиме. Сохранённые или шаренные leaderboard-значения всё равно входят в общий EV в basic-режиме.",
  },
  "controls.brLeaderboard.mode.off": {
    en: "Off",
    ru: "Выкл.",
  },
  "controls.brLeaderboard.mode.observed": {
    en: "Observed",
    ru: "Observed",
  },
  "controls.brLeaderboard.mode.manual": {
    en: "Manual",
    ru: "Manual",
  },
  "controls.brLeaderboard.mode.lookup": {
    en: "Lookup",
    ru: "Lookup",
  },
  "controls.brLeaderboard.prizes": {
    en: "Observed LB prizes",
    ru: "LB-призы из профиля",
  },
  "controls.brLeaderboard.prizesHint": {
    en: "Total leaderboard prizes from the observed profile window.",
    ru: "Сумма лидербордных призов в том наблюдаемом окне, которое ты разбираешь.",
  },
  "controls.brLeaderboard.tournaments": {
    en: "Observed tournaments",
    ru: "Турниров в профиле",
  },
  "controls.brLeaderboard.tournamentsHint": {
    en: "Total Battle Royale tournaments from the same observed profile window.",
    ru: "Общее число Battle Royale турниров в том же окне профиля.",
  },
  "controls.brLeaderboard.lbPerTournament": {
    en: "LB / tournament",
    ru: "LB / турнир",
  },
  "controls.brLeaderboard.lbPerTournamentHint": {
    en: "Observed leaderboard dollars per tournament. This is the direct anchor used for the current projection.",
    ru: "Наблюдаемый лидербордный доллар на турнир. Это прямой якорь, от которого строится текущая проекция.",
  },
  "controls.brLeaderboard.observedAbi": {
    en: "Observed ABI",
    ru: "Observed ABI",
  },
  "controls.brLeaderboard.observedAbiHint": {
    en: "Reconstructed ABI from the points split across stakes. This is used only as a confidence check against the current BR mix.",
    ru: "Восстановленный ABI по долям очков между лимитами. Он нужен только как проверка, насколько текущий BR-микс похож на наблюдаемый.",
  },
  "controls.brLeaderboard.pointsHint": {
    en: "Observed leaderboard points by stake for the same profile window.",
    ru: "Наблюдаемые лидербордные очки по лимитам в том же окне профиля.",
  },
  "controls.brLeaderboard.observedUsernameLabel": {
    en: "GGPoker nicks",
    ru: "Ники на GGPoker",
  },
  "controls.brLeaderboard.observedUsernameHint": {
    en: "Comma-separated. Add prior nicks here too — ResultHub doesn't track GGPoker rename history, so the lookup pulls each one and sums the totals. “Tournaments in profile” stays manual — the API doesn't expose it.",
    ru: "Через запятую. Добавь сюда и прежние ники — ResultHub не знает истории смены ника на GGPoker, поиск пройдёт по каждому и сложит итоги. «Турниров в профиле» остаётся ручным — API его не отдаёт.",
  },
  "controls.brLeaderboard.observedUsernamePlaceholder": {
    en: "e.g. currentNick, oldNick",
    ru: "например, currentNick, oldNick",
  },
  "controls.brLeaderboard.lookupAction": {
    en: "Pull from ResultHub",
    ru: "Подтянуть из ResultHub",
  },
  "controls.brLeaderboard.lookupPending": {
    en: "Loading…",
    ru: "Загрузка…",
  },
  "controls.brLeaderboard.lookupOk": {
    en: "Filled from ResultHub for {from} → {to}.",
    ru: "Заполнено из ResultHub за {from} → {to}.",
  },
  "controls.brLeaderboard.lookupError.network": {
    en: "Could not reach our ResultHub proxy. Check your connection and try again.",
    ru: "Не удалось достучаться до нашего ResultHub-прокси. Проверь сеть и попробуй ещё раз.",
  },
  "controls.brLeaderboard.lookupError.timeout": {
    en: "ResultHub timed out. Try again in a moment.",
    ru: "ResultHub не ответил вовремя. Попробуй ещё раз через секунду.",
  },
  "controls.brLeaderboard.lookupError.bad-status": {
    en: "ResultHub returned an unexpected response. Their API may be down or rate-limited.",
    ru: "ResultHub вернул неожиданный ответ. Возможно, их API лежит или сработал rate-limit.",
  },
  "controls.brLeaderboard.lookupError.bad-json": {
    en: "ResultHub returned malformed data — they may have changed the API. Please report this.",
    ru: "ResultHub вернул битый JSON — возможно, у них поменялся API. Сообщи об этом.",
  },
  "controls.brLeaderboard.lookupError.no-data": {"en":"ResultHub has no recorded Battle Royale data for this username. Check the spelling and the profile history.","ru":"У ResultHub нет сохранённых данных Battle Royale по этому нику. Проверь написание и историю профиля."},
  "controls.brLeaderboard.lookupError.empty-username": {
    en: "Type a ResultHub username first.",
    ru: "Сначала введи ник в ResultHub.",
  },
  "controls.brLeaderboard.manualStake": {
    en: "Target stake",
    ru: "Целевой лимит",
  },
  "controls.brLeaderboard.manualStakeHint": {
    en: "Auto uses the current BR schedule ABI; fixed stake forces a specific leaderboard dataset.",
    ru: "Auto берёт ABI текущего BR-расписания; фиксированный лимит принудительно выбирает нужный датасет лидерборда.",
  },
  "controls.brLeaderboard.manualStakeAuto": {
    en: "Auto ({stake})",
    ru: "Auto ({stake})",
  },
  "controls.brLeaderboard.manualPerTournament": {
    en: "Expected LB / tournament",
    ru: "Ожидаемый LB / турнир",
  },
  "controls.brLeaderboard.manualPerTournamentHint": {
    en: "Built from target daily points matched against the built-in leaderboard snapshots for the selected stake.",
    ru: "Считается из целевых дневных очков, сматченных к встроенным snapshot-ам лидерборда выбранного лимита.",
  },
  "controls.brLeaderboard.manualSource": {
    en: "{stake}: built-in finished leaderboard days {from} to {to}.",
    ru: "{stake}: встроенные завершённые дни лидерборда с {from} по {to}.",
  },
  "controls.brLeaderboard.manualNoBuiltInData": {
    en: "{stake}: no built-in snapshots yet. Use Lookup for this stake or keep a legacy direct $/tournament value.",
    ru: "{stake}: встроенных snapshot-ов пока нет. Для этого лимита используй Lookup или старый прямой $/турнир.",
  },
  "controls.brLeaderboard.manualProjected": {
    en: "Projected promo",
    ru: "Проекция промо",
  },
  "controls.brLeaderboard.manualProjectedHint": {
    en: "Expected leaderboard dollars added to the current BR sample: LB/tournament × BR tournaments.",
    ru: "Ожидаемые лидербордные доллары в текущем BR-сэмпле: LB/турнир × BR-турниры.",
  },
  "controls.brLeaderboard.manualVolume": {
    en: "BR tournaments",
    ru: "BR-турниры",
  },
  "controls.brLeaderboard.manualVolumeHint": {
    en: "Current BR tournament volume after schedule repeats.",
    ru: "Текущий объём BR-турниров после повторов расписания.",
  },
  "controls.brLeaderboard.manualPct": {
    en: "Of current buy-ins",
    ru: "От текущих бай-инов",
  },
  "controls.brLeaderboard.manualPctHint": {
    en: "Manual promo as a percentage of the current BR buy-ins.",
    ru: "Ручное промо как процент от текущих BR-бай-инов.",
  },
  "controls.brLeaderboard.lookupTournamentsPerDay": {
    en: "Tournaments / day",
    ru: "Турниров / день",
  },
  "controls.brLeaderboard.lookupTournamentsPerDayHint": {
    en: "Daily BR volume used to convert average points into a leaderboard score.",
    ru: "Дневной BR-объём, через который средние очки переводятся в очки лидерборда.",
  },
  "controls.brLeaderboard.lookupPointsPerTournament": {
    en: "Points / tournament",
    ru: "Очков / турнир",
  },
  "controls.brLeaderboard.lookupPointsPerTournamentHint": {
    en: "Average leaderboard points from one BR tournament.",
    ru: "Средние лидербордные очки с одного BR-турнира.",
  },
  "controls.brLeaderboard.lookupTargetPoints": {
    en: "Target points / day",
    ru: "Целевые очки / день",
  },
  "controls.brLeaderboard.lookupTargetPointsHint": {
    en: "Tournaments/day × points/tournament. This score is looked up in each pasted leaderboard day.",
    ru: "Турниров/день × очков/турнир. По этим очкам ищется место в каждом импортированном дне.",
  },
  "controls.brLeaderboard.lookupPerTournament": {
    en: "Lookup LB / tournament",
    ru: "Lookup LB / турнир",
  },
  "controls.brLeaderboard.lookupPerTournamentHint": {
    en: "Average daily leaderboard prize divided by tournaments/day.",
    ru: "Средний дневной лидербордный приз, делённый на турниров/день.",
  },
  "controls.brLeaderboard.lookupAvgPrize": {
    en: "Avg daily prize",
    ru: "Средний приз / день",
  },
  "controls.brLeaderboard.lookupAvgPrizeHint": {
    en: "Average prize at the target score across imported leaderboard days.",
    ru: "Средний приз на целевых очках по импортированным дням лидерборда.",
  },
  "controls.brLeaderboard.lookupParsedDays": {
    en: "Parsed days",
    ru: "Дней распознано",
  },
  "controls.brLeaderboard.lookupParsedDaysHint": {
    en: "Imported leaderboard snapshots that contain rank, points and prize rows.",
    ru: "Импортированные срезы лидерборда, где найдены строки rank, points и prize.",
  },
  "controls.brLeaderboard.lookupImportLabel": {
    en: "Paste leaderboard page code",
    ru: "Код страницы лидерборда",
  },
  "controls.brLeaderboard.lookupImportHint": {
    en: "Paste one leaderboard day, add it, then repeat for the next day. Only compact rank/points/prize rows are saved.",
    ru: "Вставь один день лидерборда, добавь его, потом повтори для следующего дня. Сохраняются только компактные rank/points/prize строки.",
  },
  "controls.brLeaderboard.lookupImportPlaceholder": {
    en: "<tr><td>42</td><td>Nick</td><td>6400</td><td>$8</td></tr>",
    ru: "<tr><td>42</td><td>Nick</td><td>6400</td><td>$8</td></tr>",
  },
  "controls.brLeaderboard.lookupAddSnapshot": {
    en: "Add day",
    ru: "Добавить день",
  },
  "controls.brLeaderboard.lookupClearSnapshots": {
    en: "Clear days",
    ru: "Очистить дни",
  },
  "controls.brLeaderboard.lookupParseError": {
    en: "Could not find leaderboard rows with rank, points and prize.",
    ru: "Не нашёл строки лидерборда с местом, очками и призом.",
  },
  "controls.brLeaderboard.lookupEmpty": {
    en: "No leaderboard days imported yet.",
    ru: "Пока нет импортированных дней лидерборда.",
  },
  "controls.brLeaderboard.lookupSnapshotLine": {
    en: "{label}: {entries} rows · {rank} at {points} pts · {prize}",
    ru: "{label}: {entries} строк · {rank} на {points} pts · {prize}",
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

  // Streak catalog
  "dd.title": { en: "Toughest streaks", ru: "Самые жёсткие стрики" },
  "dd.sub": {
    en: "Top-3 deepest streaks and top-3 biggest upswings across samples",
    ru: "Топ-3 самых глубоких стрика и топ-3 самых больших апсвинга по сэмплам",
  },
  "dd.rank": { en: "#", ru: "#" },
  "dd.depth": { en: "Drawdown depth", ru: "Глубина просадки" },
  "dd.height": { en: "Upswing height", ru: "Высота апстрика" },
  "dd.final": { en: "Final profit", ru: "Итог сэмпла" },
  "dd.breakeven": { en: "Longest zero-streak", ru: "Самая долгая игра в ноль" },
  "dd.worstDown": { en: "Worst streaks", ru: "Худшие стрики" },
  "dd.bestUp": { en: "Best upswings", ru: "Лучшие апсвинги" },

  // Help tooltips — controls panel
  "help.trigger": { en: "Help", ru: "Справка" },
  "help.scheduleRepeats": {"en":"Target number of tournaments in each simulated run. Changing it redistributes the row counts in proportion to the current schedule and uses one schedule pass. Each row keeps at least one tournament; the target cannot be smaller than the number of rows.","ru":"Число турниров в каждом прогоне. При изменении дистанции количества в строках перераспределяются пропорционально текущему расписанию, которое затем проходит один раз. В каждой строке остаётся хотя бы один турнир, поэтому дистанция не может быть меньше числа строк."},
  "help.samples": {
    en: "How many alternative futures to simulate. More = smoother tails and worst-case numbers, slower to compute. 5k is quick, 50k is overkill-nice.",
    ru: "Сколько альтернативных вариантов прогнать. Больше — точнее хвосты и худшие раны, но дольше. 5k — быстро, 50k — с запасом.",
  },
  "help.finishModel": {
    en: "How your skill distributes across finish places — does it mostly show up as deep runs, or as lots of small cashes?\n\nOptions:\n• Power-law — skill pays off deep; the closer to 1st, the bigger the lift. (default, best match to real samples)\n• Linear skill — steady lift toward the top, less dramatic\n• Stretched-exp — middle ground between those two\n• Plackett–Luce — classic ranking model, mathematically sound\n• Uniform — every paid place gets the same lift (PrimeDope-style — understates swings)\n• Empirical — built from a CSV of your own real finish history",
    ru: "Как скилл распределяется по местам: глубокие финиши или много мин-кешей?\n\nОпции:\n• Power-law — скилл работает в глубоких финишах; чем ближе к 1-му, тем сильнее лифт (дефолт, лучше всего ложится на реальные выборки)\n• Linear skill — плавный лифт к топу, менее драматичный\n• Stretched-exp — промежуточный вариант\n• Plackett–Luce — классическая модель ранжирования, математически чистая\n• Uniform — все призовые получают одинаковый буст (как у PrimeDope — занижает свинги)\n• Empirical — по CSV реальных финишей",
  },
  "help.alphaOverride": {"en":"Adjust the three real-data tilt models from −0.5 to 0.5; blank or 0 keeps the neutral reference shape. Other models use the fixed-ITM calibration or their fixed shape, so manual alpha is unavailable. Switching models clears the override.","ru":"Настройка трёх real-data tilt моделей от −0,5 до 0,5; пустое поле или 0 сохраняет нейтральную форму референса. В других моделях действует калибровка под заданный ITM или фиксированная форма, поэтому ручной alpha недоступен. При смене модели значение сбрасывается."},
  "help.roiStdErr": {
    en: "How uncertain you are about your real ROI, as a fraction. 0.05 = \"my true ROI is maybe ±5 pp off\". 0 = you know ROI exactly (PrimeDope's assumption). On each run the engine rolls one random skill shift applied across every tournament in that run — the biggest source of bad-tail swings PrimeDope ignores.",
    ru: "Неопределённость в истинном ROI (как доля). 0.05 = «реальный ROI может быть ±5 пп от заданного». 0 = ROI известен точно (допущение PrimeDope). На каждом ране движок генерирует один случайный сдвиг скилла на все турниры этого рана — основной источник хвостовых стриков, который PrimeDope игнорирует.",
  },
  "help.compare": {
    en: "Runs a second simulation on the same seed with PrimeDope's uniform-lift calibration. Two trajectory charts side-by-side + a full diff table. Roughly doubles run time.",
    ru: "Запускает вторую симуляцию на том же сиде с калибровкой PrimeDope (uniform-lift). Два графика бок-о-бок + таблица расхождений. Время рана удваивается.",
  },

  // Help tooltips — schedule editor columns
  "help.row.label": {
    en: "Free-form name for the row. Cosmetic only — doesn't affect the math.",
    ru: "Произвольное название строки. Чисто косметика — на расчёт не влияет.",
  },
  "help.row.players": {
    en: "AFS — average field size: how many entrants register. Sets the places (1..N) the finish-model samples from and scales the prize pool.",
    ru: "AFS — среднее поле (average field size): сколько игроков заявлено. Задаёт места (1..N) для финиш-модели и масштабирует призовой.",
  },
  "help.row.buyIn": {
    en: "Buy-in in poker format. \"50+5\" = $50 buy-in + $5 rake (before \"+\" goes to pool, after is the room's fee). Just \"50\" keeps the current rake. Real entry cost = buyIn + rake. Note on convention: the rake % we show is fee ÷ net buy-in, not fee ÷ total ticket. Entering \"9.20+0.80\" displays as 8.7% rake ($0.80 ÷ $9.20) even though your room calls the same fee 8% of the $10 ticket — same dollars, different denominator.",
    ru: "Бай-ин в покерном формате. «50+5» = $50 бай-ин + $5 рейк (до «+» идёт в призовой, после — комиссия рума). Просто «50» оставляет текущий рейк. Реальная цена входа = buyIn + rake. О конвенции: рейк в % считается от чистого бай-ина, а не от полного тикета. «9.20+0.80» показывается как 8.7% рейк ($0.80 ÷ $9.20), хотя в руме ту же сумму называют 8% от $10 тикета — сумма та же, знаменатель другой.",
  },
  "help.row.roi": {
    en: "Target poker ROI before global rakeback, as a % of full ticket cost: profit ÷ (buy-in × (1+rake)). Global rakeback is added separately as a deterministic shift. For Battle Royale rows only, the small RB helper converts a reported ROI with rakeback into this pre-rakeback field.",
    ru: "Целевой покерный ROI до глобального рейкбека, считается от полной стоимости входа: прибыль ÷ (бай-ин × (1+рейк)). Глобальный рейкбек добавляется отдельно детерминированным сдвигом. Только у строк Battle Royale маленький RB-помощник переводит reported ROI с рейкбеком в это поле до рейкбека.",
  },
  "help.row.payouts": {
    en: "Shape of the prize ladder. Standard ~15% ITM, Flat ~20% (shallower top), Top-heavy ~12% (steeper), plus real captured curves (PokerStars / GG / Sunday Million / Bounty Builder). WTA = 100% to 1st. Custom = your own %.",
    ru: "Форма призовой сетки. Standard ~15% ITM, Flat ~20% (плоский топ), Top-heavy ~12% (крутой), плюс реальные кривые (PokerStars / GG / Sunday Million / Bounty Builder). WTA = 100% победителю. Custom = свои %.",
  },
  "help.row.count": {"en":"Number of tournaments from this row in one schedule pass. Use whole numbers; the total-distance control redistributes these counts proportionally.","ru":"Число турниров из этой строки за один проход расписания. Используются целые числа; поле общей дистанции перераспределяет эти количества пропорционально."},

  "emp.title": { en: "Empirical PMF source", ru: "Источник эмпирической PMF" },
  "emp.paste": {
    en: "Paste finish positions, one per line",
    ru: "Вставь финишные места, по одному в строку",
  },
  "emp.clear": { en: "Clear", ru: "Очистить" },
  "emp.loaded": { en: "Loaded", ru: "Загружено" },
  "emp.entries": { en: "entries", ru: "записей" },
  "emp.none": { en: "No data — model falls back to power-law.", ru: "Нет данных — откат на power-law." },

  // Cash-game mode (advanced only)
  "mode.tab.mtt": { en: "MTT", ru: "Турниры" },
  "mode.tab.cash": { en: "Cash", ru: "Кэш" },
  "cash.section.inputs.title": { en: "Cash inputs", ru: "Параметры кэша" },
  "cash.section.results.title": { en: "Cash results", ru: "Результаты кэша" },
  "cash.group.session": { en: "Session", ru: "Сессия" },
  "cash.group.rake": { en: "Rakeback", ru: "Рейкбек" },
  "cash.group.hourly": { en: "Volume lens", ru: "Темп / $ в час" },
  "cash.group.stakes": { en: "Stake mix", ru: "Микс лимитов" },
  "cash.stakes.toggle.hint": {
    en: "Mix several stakes or rooms. Each row has its own winrate, SD, bbSize, rake.",
    ru: "Миксуй несколько лимитов или румов. У каждой строки свой WR, SD, bbSize, рейк.",
  },
  "cash.stakes.row.label": { en: "Label", ru: "Метка" },
  "cash.stakes.row.handShare": { en: "Share of hands", ru: "Доля раздач" },
  "cash.stakes.row.bbSize": { en: "BB ($)", ru: "BB ($)" },
  "cash.stakes.row.rake": { en: "Rake (bb/100)", ru: "Рейк (bb/100)" },
  "cash.stakes.row.rbPct": { en: "RB %", ru: "RB %" },
  "cash.stakes.row.pvi": { en: "PVI", ru: "PVI" },
  "cash.stakes.add": { en: "+ Add row", ru: "+ Добавить строку" },
  "cash.stakes.remove": { en: "Remove", ru: "Удалить" },
  "cash.stakes.share.ok": {
    en: "Current row-share sum: {sum}.",
    ru: "Текущая сумма долей: {sum}.",
  },
  "cash.stakes.share.renorm": {
    en: "Current row-share sum: {sum}. The engine renormalizes it to 1.00 before the run.",
    ru: "Текущая сумма долей: {sum}. Перед запуском движок перенормирует её к 1.00.",
  },
  "cash.stakes.refBbHint": {
    en: "Top-level BB size is the reference denomination for bankroll. Rows with larger BB scale up proportionally.",
    ru: "Верхний BB — это базовая валюта банкролла. Строки с большим BB скейлятся вверх пропорционально.",
  },
  "cash.wrBb100.label": { en: "Winrate (bb/100)", ru: "Винрейт (bb/100)" },
  "cash.sdBb100.label": { en: "Std dev (bb/100)", ru: "SD (bb/100)" },
  "cash.hands.label": { en: "Hands", ru: "Раздач" },
  "cash.nSimulations.label": { en: "Simulations", ru: "Симуляций" },
  "cash.bbSize.label": { en: "BB size ($)", ru: "Размер BB ($)" },
  "cash.baseSeed.label": { en: "Seed", ru: "Сид" },
  "cash.rake.enabled.label": { en: "Rakeback", ru: "Рейкбек" },
  "cash.rake.contrib.label": {
    en: "Rake contributed (bb/100)",
    ru: "Платишь рейка (bb/100)",
  },
  "cash.rake.rbPct.label": { en: "Advertised RB %", ru: "Заявленный RB %" },
  "cash.rake.pvi.label": { en: "PVI", ru: "PVI" },
  "cash.rake.pvi.hint": {
    en: "PVI ≤ 1 discounts advertised RB (regs lose a share to segmentation).",
    ru: "PVI ≤ 1 режет заявленный RB (рег теряет долю на сегментации).",
  },
  "cash.hours.handsPerHour.label": {
    en: "Hands / hour",
    ru: "Раздач в час",
  },
  "cash.hours.hint": {
    en: "Only translates EV into $/hour. It does not change swings, drawdowns, or the trajectory shape.",
    ru: "Только переводит EV в $/час. На свинги, просадки и форму траектории это не влияет.",
  },
  "cash.group.riskLine": { en: "Risk line", ru: "Линия риска" },
  "cash.risk.threshold.label": {
    en: "Threshold (BB)",
    ru: "Порог (BB)",
  },
  "cash.risk.hint": {
    en: "Used by the odds card and the touch-risk pill. It marks the bankroll depth that counts as properly underwater for this plan.",
    ru: "Используется в карточке шансов и в risk-плашке. Это глубина банкролла, с которой для этого плана начинается уже настоящая подводная зона.",
  },
  "cash.run": { en: "Run simulation", ru: "Запустить симуляцию" },
  "cash.running": { en: "Running…", ru: "Считаем…" },
  "cash.hero.expected": { en: "Expected EV", ru: "Ожидаемый EV" },
  "cash.hero.expected.subHourly": {
    en: "{hourly} at {hands} hands/hour",
    ru: "{hourly} при темпе {hands} раздач/час",
  },
  "cash.hero.expected.subDistance": {
    en: "Pure expectation over the chosen distance.",
    ru: "Чистое ожидание на выбранной дистанции.",
  },
  "cash.hero.typical": { en: "Typical finish", ru: "Типичный финал" },
  "cash.hero.typical.subRange": {
    en: "Middle 90%: {lo} to {hi}",
    ru: "Средние 90%: от {lo} до {hi}",
  },
  "cash.hero.finishUp": { en: "Finish up", ru: "Финиш в плюс" },
  "cash.hero.finishUp.subLoss": {
    en: "Finish below zero: {pct}",
    ru: "Финиш ниже нуля: {pct}",
  },
  "cash.hero.drawdown": { en: "P95 drawdown", ru: "P95 просадки" },
  "cash.hero.drawdown.subMedian": {
    en: "Median drawdown: {value}",
    ru: "Медианная просадка: {value}",
  },
  "cash.hero.breakeven": {
    en: "Median breakeven stretch",
    ru: "Медианная полоса в ноль",
  },
  "cash.hero.breakeven.subRecovery": {
    en: "Recovery p90: {recovery} · unrecovered: {share}",
    ru: "Восстановление p90: {recovery} · не отмазались: {share}",
  },
  "cash.stats.hourlyEvUsd": { en: "EV / hour", ru: "EV / час" },
  "cash.stats.meanRakePaidBb": {
    en: "Rake paid ({unit})",
    ru: "Заплачено рейка ({unit})",
  },
  "cash.stats.meanRbEarnedBb": {
    en: "RB earned ({unit})",
    ru: "Рейкбек получен ({unit})",
  },
  "cash.axis.bb": { en: "BB", ru: "BB" },
  "cash.axis.usd": { en: "$", ru: "$" },
  "cash.axis.hands": { en: "hands", ru: "раздачи" },
  "cash.axis.count": { en: "count", ru: "частота" },
  "cash.axis.share": { en: "% of paths", ru: "% траекторий" },
  "cash.axis.samples": { en: "samples", ru: "сэмплы" },
  "cash.axis.winrate": { en: "bb/100", ru: "bb/100" },
  "cash.unit.bb": { en: "BB", ru: "BB" },
  "cash.unit.usd": { en: "$", ru: "$" },
  "cash.toolbar.runs": { en: "Runs", ru: "Раны" },
  "cash.toolbar.units": { en: "Units", ru: "Единицы" },
  "cash.chart.trajectory.title": {
    en: "Bankroll trajectory",
    ru: "Траектория банкролла",
  },
  "cash.chart.trajectory.note": {
    en: "Thin lines are individual runs. Colored rails show where the bulk of honest sessions usually lives. The dashed line marks {threshold}.",
    ru: "Тонкие линии — отдельные раны. Цветные рельсы показывают, где обычно живёт основная масса честных сессий. Пунктиром отмечен порог {threshold}.",
  },
  "cash.chart.trajectory.bankrollBb": {
    en: "Bankroll (BB)",
    ru: "Банкролл (BB)",
  },
  "cash.chart.trajectory.bankrollUsd": {
    en: "Bankroll ($)",
    ru: "Банкролл ($)",
  },
  "cash.chart.trajectory.finalBankroll": {
    en: "Final bankroll",
    ru: "Финальный банкролл",
  },
  "cash.chart.trajectory.legend.bands": {
    en: "70 / 90 / 95% intervals",
    ru: "интервалы 70 / 90 / 95%",
  },
  "cash.chart.trajectory.kind.ev": {
    en: "reference line for the expected winrate (EV slope)",
    ru: "опорная линия ожидаемого винрейта (наклон EV)",
  },
  "cash.chart.trajectory.kind.risk": {
    en: "your risk line: the bankroll threshold from the inputs",
    ru: "твоя линия риска: порог банкролла из параметров",
  },
  "cash.chart.final.title": {
    en: "Final bankroll distribution",
    ru: "Распределение финального BR",
  },
  "cash.chart.drawdown.title": { en: "Max drawdown", ru: "Max просадка" },
  "cash.chart.odds.title": {
    en: "Odds over distance",
    ru: "Шансы по дистанции",
  },
  "cash.chart.odds.note": {
    en: "The pills show the odds at the end of the chosen distance. The lines show how often you are above zero or already below {threshold} earlier along the way.",
    ru: "Плашки показывают шансы к концу выбранной дистанции. Линии показывают, как часто ты уже выше нуля или уже ниже {threshold} по дороге.",
  },
  "cash.chart.breakeven.title": {
    en: "Longest breakeven stretch",
    ru: "Самая длинная безоткатная полоса",
  },
  "cash.chart.breakeven.note": {
    en: "Longest stretch spent below the previous bankroll peak. X-axis is hands, not BB.",
    ru: "Самая длинная серия ниже предыдущего пика банкролла. По оси X здесь раздачи, а не BB.",
  },
  "cash.chart.recovery.title": {
    en: "Recovery time after deepest drawdown",
    ru: "Время восстановления после самой глубокой просадки",
  },
  "cash.chart.recovery.note": {
    en: "How long it takes to climb back from the deepest drawdown to breakeven. Only recovered paths are shown; unrecovered share stays in the risk panel.",
    ru: "Сколько раздач нужно, чтобы вернуться из самой глубокой просадки к breakeven. Здесь только восстановившиеся траектории; доля невосстановившихся остаётся в блоке рисков.",
  },
  "cash.chart.convergence.title": {
    en: "Monte Carlo convergence",
    ru: "Сходимость Monte Carlo",
  },
  "cash.chart.convergence.note": {
    en: "Running mean winrate as simulations accumulate. Thin rails show the current 95% confidence band of the estimate.",
    ru: "Бегущее среднее winrate по мере накопления симуляций. Тонкие границы показывают текущий 95% доверительный коридор оценки.",
  },
  "cash.section.streaks.title": {
    en: "How the pain usually looks",
    ru: "Как обычно выглядит боль",
  },
  "cash.section.streaks.note": {
    en: "Cash is rarely about one brutal point. It is more often long stretches spent below the previous peak and the time needed to climb back.",
    ru: "В кэше боль чаще не в одной точке, а в длинных кусках ниже прошлого пика и во времени, нужном чтобы отмазаться.",
  },
  "cash.section.mix.title": {
    en: "Where the mix comes from",
    ru: "Из чего собирается микс",
  },
  "cash.section.mix.note": {
    en: "Built from the same exact row hand budget the engine used. Helps you see which rows bring the hands, the swing, the rake, and the rakeback.",
    ru: "Собрано из того же точного бюджета раздач по строкам, который использовал движок. Видно, какие строки приносят объём, swing, рейк и рейкбек.",
  },
  "cash.mix.metric.hands": {
    en: "Hands",
    ru: "Доля раздач",
  },
  "cash.mix.metric.swing": {
    en: "Swing share",
    ru: "Доля свинга",
  },
  "cash.mix.metric.rake": {
    en: "Rake paid",
    ru: "Уплаченный рейк",
  },
  "cash.mix.metric.rb": {
    en: "RB earned",
    ru: "RB получен",
  },
  "cash.mix.expectedEv": {
    en: "Expected EV",
    ru: "Ожидаемый EV",
  },
  "cash.mix.rowFallback": {
    en: "Row {index}",
    ru: "Строка {index}",
  },
  "cash.section.economics.title": {
    en: "Economics",
    ru: "Экономика",
  },
  "cash.section.economics.note": {
    en: "Useful for rake and RB sanity-checks. These numbers shift expectation more than they change the feel of the graph.",
    ru: "Полезно для sanity-check по рейку и рейкбеку. Эти цифры сильнее двигают ожидание, чем ощущение самого графика.",
  },
  "cash.section.diagnostics.title": {
    en: "Simulation diagnostics",
    ru: "Диагностика симуляции",
  },
  "cash.section.diagnostics.note": {
    en: "This block is about Monte Carlo noise, not about your real cash-game risk. Keep it below the main story.",
    ru: "Этот блок про шум Монте-Карло, а не про твой реальный кэш-риск. Держим его ниже главной истории.",
  },
  "cash.summary.p05": { en: "P05", ru: "P05" },
  "cash.summary.median": { en: "Median", ru: "Медиана" },
  "cash.summary.p95": { en: "P95", ru: "P95" },
  "cash.summary.recoveryMedian": {
    en: "Median recovery",
    ru: "Медиана восстановления",
  },
  "cash.summary.unrecovered": { en: "Unrecovered", ru: "Не отмазались" },
  "cash.summary.oddsUp": {
    en: "Above 0 BB",
    ru: "Выше 0 BB",
  },
  "cash.summary.oddsBelowThresholdNow": {
    en: "Now ≤ {threshold}",
    ru: "Сейчас ≤ {threshold}",
  },
  "cash.summary.probBelowThresholdEver": {
    en: "Ever ≤ {threshold}",
    ru: "Хотя бы раз ≤ {threshold}",
  },
  "cash.summary.probBelowThresholdEver.tip": {
    en: "Finite-horizon risk: the share of paths that touched the threshold WITHIN this sample's hand count. It underestimates long-run risk on short samples — for the forever-play figure see RoR (∞ horizon).",
    ru: "Риск на конечной дистанции: доля путей, коснувшихся порога В ПРЕДЕЛАХ числа рук этого сэмпла. На коротких выборках занижает долгосрочный риск — для «играем вечно» смотри RoR (∞ горизонт).",
  },
  "cash.summary.riskOfRuinAsymptotic": {
    en: "RoR (∞ horizon)",
    ru: "RoR (∞ горизонт)",
  },
  "cash.summary.riskOfRuinAsymptotic.tip": {
    en: "Closed-form infinite-horizon risk of ruin for this edge and variance (Galfond's exp(−2·BR·wr/sd²)). It is the asymptote if the same winrate/variance played forever; the 'Ever ≤' number is just what this finite sample happened to show.",
    ru: "Аналитический риск разорения на бесконечной дистанции для данного эджа и дисперсии (формула Гэлфонда exp(−2·БР·wr/sd²)). Это асимптота, если тот же винрейт/дисперсия играют вечно; число «Хотя бы раз ≤» — лишь то, что показала конечная выборка.",
  },
  "cash.summary.riskOfRuinAsymptotic.tip.mix": {
    en: "Closed-form infinite-horizon risk of ruin exp(−2·BR·μ/σ²) where μ and σ² are the hand-share-weighted per-hand drift and variance of the whole mix in reference BB — an aggregate, not any single row's Galfond figure. It is the asymptote if this exact mix played forever; the 'Ever ≤' number is just what this finite sample happened to show.",
    ru: "Аналитический риск разорения на бесконечной дистанции exp(−2·БР·μ/σ²), где μ и σ² — взвешенные по доле раздач дрейф и дисперсия на раздачу всего микса в референсных BB — агрегат, а не формула Гэлфонда для одной строки. Это асимптота, если ровно этот микс играет вечно; число «Хотя бы раз ≤» — лишь то, что показала конечная выборка.",
  },
  "cash.section.assumptions.title": {
    en: "Model assumptions",
    ru: "Допущения модели",
  },
  "cash.section.assumptions.note": {
    en: "What this engine does and does not model. Read before trusting a tail number.",
    ru: "Что этот движок моделирует, а что нет. Прочти, прежде чем верить хвостовой цифре.",
  },
  "cash.assumptions.model": {
    en: "Per-hand Normal random walk: BR[i+1] = BR[i] + wr/100 + rb/100 + (sd/10)·N(0,1). Winrate and SD are taken in bb/100 and scaled to one hand (SD by √100).",
    ru: "Нормальное случайное блуждание по раздачам: BR[i+1] = BR[i] + wr/100 + rb/100 + (sd/10)·N(0,1). Винрейт и SD берутся в bb/100 и масштабируются на одну раздачу (SD через √100).",
  },
  "cash.assumptions.independence": {
    en: "Hands are independent and identically distributed: no tilt, no table or session correlation, no stake changes in response to the bankroll, no tails heavier than the Normal.",
    ru: "Раздачи независимы и одинаково распределены: нет тильта, корреляции между столами и сессиями, смены лимита в ответ на банкролл и хвостов тяжелее нормальных.",
  },
  "cash.assumptions.rakeback": {
    en: "Rakeback is a deterministic add accrued smoothly per hand (contributed rake × advertised RB % × PVI). The horizon total matches 100-hand payouts exactly; only the trajectory shape is smoother.",
    ru: "Рейкбек — детерминированная добавка, начисляемая равномерно каждую раздачу (внесённый рейк × заявленный RB % × PVI). Итог за дистанцию совпадает с выплатами по 100 раздач; ровнее только форма траектории.",
  },
  "cash.assumptions.mix": {
    en: "Stake mix: rows interleave in fixed {block}-hand blocks on a deterministic schedule, each row owning round(share × hands) hands; every rate is rescaled to the reference {bb}.",
    ru: "Микс лимитов: строки чередуются фиксированными блоками по {block} раздач по детерминированному расписанию, каждая строка получает round(доля × раздачи) раздач; все ставки пересчитаны в референсный {bb}.",
  },
  "cash.error.run": {
    en: "Cash simulation failed: {detail}. Fix the inputs or run again — the worker pool has been reset.",
    ru: "Симуляция кэша не удалась: {detail}. Проверь параметры или запусти снова — пул воркеров сброшен.",
  },
  "chart.brLeaderboardObserved.title": {
    en: "BR leaderboard promo",
    ru: "Промо-лидерборд BR",
  },
  "chart.brLeaderboardObserved.sub": {
    en: "{tourneysPerDay} BR/day across {days} active days",
    ru: "{tourneysPerDay} BR в день на {days} активных дней",
  },
  "chart.brLeaderboardObserved.tip": {
    en: "Observed mode reconstructs effective leaderboard promo from profile totals and ResultHub-style points. This is not a daily rank simulation.",
    ru: "Observed-режим восстанавливает эффективное лидербордное промо по totals из профиля и ResultHub-поинтам. Это не симуляция дневного ранга.",
  },
  "chart.brLeaderboardObserved.note": {
    en: "This layer stays outside trajectory, drawdown, and ruin cards. It is an empirical promo estimate for the current BR volume, not a cashflow path model yet.",
    ru: "Этот слой не входит в траектории, просадки и риск разорения. Пока это эмпирическая оценка промо для текущего BR-объёма, а не cashflow-модель по дням.",
  },
  "chart.brLeaderboardManual.tip": {
    en: "Manual mode applies the expected leaderboard dollars per tournament directly to the current BR volume. Use it for target-limit planning before you have observed distance there.",
    ru: "Manual-режим напрямую применяет ожидаемые лидербордные доллары за турнир к текущему BR-объёму. Это режим планирования нужного лимита до появления своей дистанции на нём.",
  },
  "chart.brLeaderboardManual.note": {
    en: "This layer is a deterministic EV projection, not a daily rank simulation. It is intentionally outside trajectories, drawdown, and ruin cards.",
    ru: "Это детерминированная EV-проекция, а не симуляция дневного ранга. Слой намеренно не входит в траектории, просадки и риск разорения.",
  },
  "chart.brLeaderboardLookup.tip": {
    en: "Lookup mode converts pasted leaderboard days into an expected $/tournament by matching your target daily score against rank/prize rows.",
    ru: "Lookup-режим превращает импортированные дни лидерборда в ожидаемые $/турнир: целевые дневные очки матчятся к строкам место/приз.",
  },
  "chart.brLeaderboardLookup.note": {
    en: "This is still a deterministic EV layer outside trajectories. It automates the rank/prize lookup, not opponent-volume uncertainty.",
    ru: "Это всё ещё детерминированный EV-слой вне траекторий. Он автоматизирует поиск места/приза, но не моделирует неопределённость объёма поля.",
  },
  "chart.brLeaderboardObserved.groupCurrent": {
    en: "Current BR sample",
    ru: "Текущий BR-сэмпл",
  },
  "chart.brLeaderboardObserved.groupObserved": {
    en: "Observed anchor",
    ru: "Наблюдаемый якорь",
  },
  "chart.brLeaderboardObserved.expectedPayout": {
    en: "Projected promo",
    ru: "Проекция промо",
  },
  "chart.brLeaderboardObserved.perTournament": {
    en: "Promo / tournament",
    ru: "Промо / турнир",
  },
  "chart.brLeaderboardObserved.perDay": {
    en: "Promo / day",
    ru: "Промо / день",
  },
  "chart.brLeaderboardObserved.currentPct": {
    en: "Of current buy-ins",
    ru: "От текущих бай-инов",
  },
  "chart.brLeaderboardObserved.currentAbi": {
    en: "Current ABI",
    ru: "Текущий ABI",
  },
  "chart.brLeaderboardObserved.currentVolume": {
    en: "BR tournaments",
    ru: "BR-турниры",
  },
  "chart.brLeaderboardObserved.currentVolumeDetail": {
    en: "{perDay}/day",
    ru: "{perDay}/день",
  },
  "chart.brLeaderboardObserved.observedPrizes": {
    en: "Observed LB prizes",
    ru: "Наблюдаемые LB-призы",
  },
  "chart.brLeaderboardObserved.observedTournaments": {
    en: "Observed tournaments",
    ru: "Наблюдаемые турниры",
  },
  "chart.brLeaderboardObserved.observedAbi": {
    en: "Reconstructed ABI",
    ru: "Восстановленный ABI",
  },
  "chart.brLeaderboardObserved.observedPct": {
    en: "Of observed buy-ins",
    ru: "От наблюдаемых бай-инов",
  },
  "chart.brLeaderboardObserved.observedPoints": {
    en: "Observed points",
    ru: "Наблюдаемые очки",
  },
  "chart.brLeaderboardObserved.rows": {
    en: "Current row allocation",
    ru: "Аллокация по текущим рядам",
  },
  "chart.brLeaderboardObserved.rowsSub": {
    en: "Projected promo distributed by current BR tournament counts.",
    ru: "Проекция промо, распределённая по текущим BR-строкам пропорционально числу турниров.",
  },
  "chart.brLeaderboardObserved.rowLine": {
    en: "{count} tournaments · buy-ins {buyIn} · promo {payout}",
    ru: "{count} турниров · бай-ины {buyIn} · промо {payout}",
  },
  "chart.brLeaderboardObserved.observedMix": {
    en: "Observed stake mix",
    ru: "Наблюдаемый микс лимитов",
  },
  "chart.brLeaderboardObserved.observedMixLine": {
    en: "{points} pts · {share} share · ~{tournaments} tournaments · buy-ins {buyIn}",
    ru: "{points} очков · {share} доля · ~{tournaments} турниров · бай-ины {buyIn}",
  },
  "chart.brLeaderboardManual.groupAnchor": {
    en: "Manual planning anchor",
    ru: "Ручной плановый якорь",
  },
  "chart.brLeaderboardManual.perTournament": {
    en: "Manual LB / tournament",
    ru: "Manual LB / турнир",
  },
  "chart.brLeaderboardManual.avgPrize": {
    en: "Avg daily prize",
    ru: "Средний приз / день",
  },
  "chart.brLeaderboardManual.targetPoints": {
    en: "Target score",
    ru: "Целевые очки",
  },
  "chart.brLeaderboardManual.days": {
    en: "Built-in days",
    ru: "Встроенные дни",
  },
  "chart.brLeaderboardManual.formula": {
    en: "Formula",
    ru: "Формула",
  },
  "chart.brLeaderboardManual.formulaValue": {
    en: "{perTournament} × {tournaments}",
    ru: "{perTournament} × {tournaments}",
  },
  "chart.brLeaderboardManual.anchorNote": {
    en: "Manual mode used {perTournament} per BR tournament over {tournaments} tournaments, adding {payout} of separate leaderboard EV.",
    ru: "Manual-режим взял {perTournament} за BR-турнир на {tournaments} турниров и добавил {payout} отдельного leaderboard EV.",
  },
  "chart.brLeaderboardLookup.groupAnchor": {
    en: "Leaderboard lookup anchor",
    ru: "Якорь по таблицам лидерборда",
  },
  "chart.brLeaderboardLookup.perTournament": {
    en: "Lookup LB / tournament",
    ru: "Lookup LB / турнир",
  },
  "chart.brLeaderboardLookup.avgPrize": {
    en: "Avg daily prize",
    ru: "Средний приз / день",
  },
  "chart.brLeaderboardLookup.targetPoints": {
    en: "Target score",
    ru: "Целевые очки",
  },
  "chart.brLeaderboardLookup.targetDetail": {
    en: "{tournaments}/day × {points} pts",
    ru: "{tournaments}/день × {points} pts",
  },
  "chart.brLeaderboardLookup.days": {
    en: "Imported days",
    ru: "Импортированные дни",
  },
  "chart.brLeaderboardLookup.daysDetail": {
    en: "{paid} paid at target score",
    ru: "{paid} с призом на целевых очках",
  },
  "chart.brLeaderboardLookup.anchorNote": {
    en: "Lookup mode averaged {dailyPrize} per imported day across {days} days, converted it to {perTournament} per BR tournament, and added {payout} of separate leaderboard EV.",
    ru: "Lookup-режим усреднил {dailyPrize} в день по {days} импортированным дням, перевёл это в {perTournament} за BR-турнир и добавил {payout} отдельного leaderboard EV.",
  },
  "chart.brLeaderboard.directRb": {
    en: "Direct RB",
    ru: "Прямой RB",
  },
  "chart.brLeaderboard.meanPayout": {
    en: "LB promo",
    ru: "LB-промо",
  },
  "chart.brLeaderboardObserved.confidence.aligned": {
    en: "Confidence: aligned",
    ru: "Уверенность: профиль похож",
  },
  "chart.brLeaderboardObserved.confidence.approximate": {
    en: "Confidence: approximate",
    ru: "Уверенность: приблизительно",
  },
  "chart.brLeaderboardObserved.confidence.mismatch": {
    en: "Confidence: mismatch",
    ru: "Уверенность: профиль расходится",
  },
  "chart.brLeaderboardObserved.confidence.unknown": {
    en: "Confidence: unknown",
    ru: "Уверенность: неизвестно",
  },
  "chart.brLeaderboardObserved.confidence.abiDrift": {
    en: "ABI drift versus the observed anchor: {value}.",
    ru: "Сдвиг ABI относительно наблюдаемого якоря: {value}.",
  },
  "chart.brLeaderboardObserved.confidence.noAbiDrift": {
    en: "Not enough observed point mix to compare ABI.",
    ru: "Недостаточно наблюдаемого point-mix, чтобы сравнить ABI.",
  },
  "chart.brLeaderboardObserved.confidence.mismatchHint": {
    en: "The schedule's stake mix differs heavily from the observed nick. Either edit the rows to match the limits you actually grind, or switch the leaderboard mode to Manual / Lookup so the EV doesn't lean on the wrong anchor.",
    ru: "Микс лимитов в расписании заметно отличается от наблюдаемого ника. Либо подправь строки под лимиты, на которых реально играешь, либо переключи режим лидерборда на Manual / Lookup — иначе EV считается от неподходящего якоря.",
  },
  "chart.lbCashflow": {
    en: "with LB cashflow",
    ru: "с LB-промо в графиках",
  },
  "chart.lbCashflow.title": {
    en: "Fold the BR leaderboard EV into the trajectory + scalar mean / probProfit / VaR. Drawdown / streaks / risk-of-ruin stay game-only — a positive monotone shift doesn't change drawdown, and recomputing RoR needs the full N-sample raw which isn't kept post-engine.",
    ru: "Включить EV лидерборда BR в траекторию + скаляры (среднее / шанс плюса / VaR). Просадки / стрики / RoR остаются game-only: монотонная положительная добавка не меняет просадки, а пересчёт RoR требует полного N-сэмплового исходника, который после движка не хранится.",
  },
  "cash.empty": {
    en: "Press Run to simulate the cash session.",
    ru: "Нажми «Запустить», чтобы посчитать кэш-сессию.",
  },

  "weakness.pd.intro": {
    en: "PrimeDope is useful as a baseline for one simple freezeout spot. As a tournament model it's too thin: a single paid-zone probability, almost no separate format structure, and almost no uncertainty model.",
    ru: "PrimeDope полезен как baseline для одного простого freezeout-спота. Но как турнирная модель он слишком тонкий: одна paid-zone вероятность, почти никакой отдельной структуры формата и почти нулевая модель неопределённости.",
  },
  "weakness.pd.section.text": {
    en: "Plain-text walk-through",
    ru: "Понятно текстом",
  },
  "weakness.pd.tag.finishes.title": {
    en: "It models the chance of cashing, not the shape of real finishes",
    ru: "Он моделирует шанс попасть в деньги, а не форму реальных финишей",
  },
  "weakness.pd.tag.finishes.body": {
    en: "After ROI calibration PrimeDope leaves a binary paid-shell: cashed or not. Inside the paid zone every place gets the same baseline probability. Real MTTs aren't shaped that way — min-cashes are common, final tables and top-3 finishes are rare, so drawdown depth and recovery time drift away from reality.",
    ru: "После калибровки ROI у PrimeDope остаётся бинарный paid-shell: попал в деньги или нет. Внутри оплачиваемой зоны все места получают одинаковую базовую вероятность. Реальные MTT так не устроены: мин-кэшей много, финалок и топ-3 мало, поэтому глубина просадок и время восстановления уезжают.",
  },
  "weakness.pd.tag.formats.title": {
    en: "It folds PKO and envelope formats into a freezeout problem",
    ru: "PKO и envelope-форматы он сводит к фризаутной задаче",
  },
  "weakness.pd.tag.formats.body": {
    en: "For us PKO is a separate bounty channel; Mystery and Battle Royale are separate envelope / jackpot tails. PrimeDope doesn't keep these channels separate, so it can't tell what part of swing comes from format and what from finish-PMF.",
    ru: "PKO у нас — отдельный bounty-channel; Mystery и Battle Royale — отдельные envelope / jackpot tails. PrimeDope не держит эти каналы по отдельности, поэтому не различает, какой кусок swing идёт от формата, а какой от finish-PMF.",
  },
  "weakness.pd.tag.roi.title": {
    en: "It treats ROI as known and almost stationary",
    ru: "Он считает ROI известным и почти стационарным",
  },
  "weakness.pd.tag.roi.body": {
    en: "It has no field variability, no per-tournament / per-session ROI noise, no drift / tilt layers, and no \"today the field is harder / I'm playing worse / mixed schedule\" model at all. Fine for a back-of-the-envelope estimate; for bankroll tails it's already too optimistic.",
    ru: "У него нет field variability, per-tournament / per-session ROI-noise, drift/tilt-слоёв и вообще нет модели «сегодня поле жёстче / я играю хуже / расписание смешанное». Для салфеточной оценки этого хватает, но для bankroll tails это уже чересчур оптимистично.",
  },
  "weakness.pd.tag.trap.title": {
    en: "Sometimes the number is close, but it's offsetting errors, not a model fit",
    ru: "Иногда цифра близка, но это компенсация ошибок, а не попадание в модель",
  },
  "weakness.pd.tag.trap.body": {
    en: "A flat paid-PMF usually shrinks deep-run depth and recovery tails, while top-heavy payouts can accidentally re-inflate the resulting sigma. So on a simple freezeout PrimeDope can land \"close\" not because it understood the tournament, but because two skews briefly cancelled.",
    ru: "Плоская paid-PMF обычно сжимает глубину прохода и recovery tails, а top-heavy выплаты иногда случайно раздувают итоговую sigma обратно. Поэтому на простом фризауте PrimeDope может оказаться «рядом» не потому, что понял турнир, а потому что два перекоса временно совпали.",
  },
  "weakness.pd.section.math": {
    en: "Boring math",
    ru: "Занудная математика",
  },
  "weakness.pd.tag.converge.title": {
    en: "When our model actually converges to PrimeDope",
    ru: "Когда наша модель действительно приближается к PrimeDope",
  },
  "weakness.pd.tag.converge.intro": {
    en: "Compare-mode here doesn't just \"draw a similar picture\" — it can fit PrimeDope's three layers separately:",
    ru: "Compare-mode у нас не «рисует похожую картинку», а умеет по отдельности подогнать три слоя PrimeDope:",
  },
  "weakness.pd.tag.converge.bullet.finish": {
    en: "their paid-vs-non-paid shell instead of our finish PMF",
    ru: "их paid-vs-nonpaid shell вместо нашей PMF финишей",
  },
  "weakness.pd.tag.converge.bullet.payouts": {
    en: "their payout structure",
    ru: "их структура выплат",
  },
  "weakness.pd.tag.converge.bullet.rake": {
    en: "their rake-to-SD quirk without changing the UI's ROI basis",
    ru: "их rake-to-SD quirk без смены ROI-базы UI",
  },
  "weakness.pd.tag.converge.body": {
    en: "So on one simple freezeout spot the two models really can converge. Example: an ordinary MTT with no bounty, an even field, and a standard payout curve. Once finish-shell, payouts and the rake convention are pinned to PD's regime, EV / probability of profit / and the central trajectory band usually sit pretty close.",
    ru: "Поэтому на одном простом freezeout-споте модели реально могут сблизиться. Пример: один обычный MTT без bounty, с ровным полем и стандартными выплатами. Если привести finish-shell, payouts и rake-конвенцию к режиму PD, то EV, шанс выйти в плюс и центральная часть траекторий обычно уже стоят довольно близко.",
  },
  "weakness.pd.tag.converge.reading": {
    en: "What this mode usefully shows: not just where we diverge from PD, but how fast that divergence disappears as you peel modern MTT layers off and end up with a \"napkin freezeout.\"",
    ru: "Полезное чтение этого режима такое: он показывает не только где мы расходимся с PD, но и как быстро разница исчезает, если шаг за шагом убрать современные MTT-слои и оставить «салфеточный freezeout».",
  },
  "weakness.pd.tag.precision.title": {
    en: "How accurately we reproduce PrimeDope itself",
    ru: "Насколько точно мы воспроизводим сам сайт PrimeDope",
  },
  "weakness.pd.tag.precision.intro": {
    en: "Compare-mode here doesn't reproduce an abstract \"PrimeDope-style\" — it reproduces the layers PD actually ships on the live site: binary paid-shell, their live payout curves, and their rake-to-SD math. The UI's ROI stays on our full buy-in+rake basis so the comparison shows the model difference, not a different edge.",
    ru: "В compare-mode мы воспроизводим не абстрактный «PrimeDope-стиль», а именно те слои, которые у них реально живут на сайте: binary paid-shell, их live payout-curves и их rake-to-SD механику. ROI в UI остаётся на нашей полной базе buy-in+rake, чтобы сравнение показывало модельную разницу, а не другой edge.",
  },
  "weakness.pd.tag.precision.bullet.shell": {
    en: "Our finish-shell mirrors their two-zone paid / non-paid logic against the verified legacy source.",
    ru: "Finish-shell у нас повторяет их двухзонную логику paid / non-paid по проверенному legacy-source.",
  },
  "weakness.pd.tag.precision.bullet.curves": {
    en: "Payouts come from live curves scraped from their payout_info endpoint, not a \"similar\" home-baked table.",
    ru: "Выплаты берутся из live curves, снятых с их payout_info endpoint, а не из «похожей» домашней таблицы.",
  },
  "weakness.pd.tag.precision.bullet.byteForByte": {
    en: "For 100 players / 15 paid our mtt-primedope payout curve matches their current live curve byte-for-byte.",
    ru: "Для 100 игроков и 15 paid наша mtt-primedope кривая выплат совпадает с их текущей live-кривой byte-for-byte.",
  },
  "weakness.pd.tag.precision.bullet.sigma": {
    en: "On the 100p / $50 / 10 % ROI / 1000-tournament reference PrimeDope's own site shows σ₁₀₀₀ ≈ $5,607 (math) / ≈ $5,789 (sim). Our PD-mode pane on the same row lands at ≈ $5.85–5.9k with 10k samples — within ~2 %. The gap is Monte-Carlo noise plus our full-cost ROI basis (EV $5,550 vs their rake-ignored $5,000); with PD's EV basis the pane gives ≈ $5,620.",
    ru: "На референсе 100p / $50 / 10% ROI / 1000 турниров сайт PrimeDope показывает σ₁₀₀₀ ≈ $5607 (math) / ≈ $5789 (sim). Наша панель в PD-режиме на той же строке даёт ≈ $5,85–5,9k при 10k сэмплов — расхождение в пределах ~2%. Разница — MC-шум плюс наша база ROI от полной стоимости (EV $5550 против их $5000 без рейка); с их базой EV панель даёт ≈ $5620.",
  },
  "weakness.pd.tag.precision.body": {
    en: "So for a simple freezeout spot our PD mode is pretty close to what the user would see on PrimeDope. But that accuracy honestly stops where the site itself stops being a model of the problem: PKO, Mystery, Battle Royale, and schedule-level uncertainty all need separate layers PD doesn't have.",
    ru: "То есть для простого freezeout-спота наш PD-режим довольно близок к тому, что пользователь увидит на PrimeDope. Но эта точность честно заканчивается там, где сам сайт перестаёт быть моделью задачи: PKO, Mystery, Battle Royale и schedule-level uncertainty уже требуют отдельных слоёв, которых у PD нет.",
  },
  "weakness.pd.tag.boundary.title": {
    en: "Where the similarity ends and why",
    ru: "Где сходство заканчивается и почему",
  },
  "weakness.pd.tag.boundary.intro": {
    en: "As soon as a separate variance channel shows up in the problem, the resemblance to PrimeDope stops being \"a question of coefficients.\" It becomes a difference in the model itself.",
    ru: "Как только в задаче появляется отдельный variance-channel, сходство с PrimeDope перестаёт быть «вопросом коэффициентов». Это уже разница в самой модели.",
  },
  "weakness.pd.tag.boundary.bullet.freeze": {
    en: "On a plain freezeout the difference usually shows up in the tails: PrimeDope can be close on the mean but still under-call drawdown depth and recovery time.",
    ru: "На простом freezeout различие чаще всего уходит в tails: PrimeDope может быть близок по среднему, но всё ещё недооценивать глубину просадок и время восстановления.",
  },
  "weakness.pd.tag.boundary.bullet.pko": {
    en: "In PKO the difference isn't only in the finish-PMF: we have a separate bounty channel that PrimeDope doesn't.",
    ru: "В PKO различие уже не только в finish-PMF: у нас есть отдельный bounty-channel, которого у PrimeDope нет.",
  },
  "weakness.pd.tag.boundary.bullet.mystery": {
    en: "In Mystery and Battle Royale we add envelope / jackpot tails that can't be honestly squeezed into one paid-shell.",
    ru: "В Mystery и Battle Royale добавляются envelope / jackpot tails, которые нельзя честно свернуть в один paid-shell.",
  },
  "weakness.pd.tag.boundary.bullet.schedule": {
    en: "In schedule / mixed-grind mode we still layer field variability and ROI noise on top of all that, and PrimeDope has no such layer at all.",
    ru: "В schedule / mixed-grind режиме у нас ещё поверх этого живут field variability и ROI-noise, а у PrimeDope такого слоя вообще нет.",
  },
  "weakness.pd.tag.boundary.body": {
    en: "Boundary example: take the same baseline freezeout — top-line numbers can sit close. Add PKO bounty EV or a Mystery tail, and the difference no longer comes from fine PMF tuning, it comes from PrimeDope simply not carrying those channels inside the model.",
    ru: "Пример границы: если взять тот же базовый freezeout, модели могут быть близки по top-line. Но стоит добавить PKO bounty EV или Mystery-хвост, и разница уже идёт не из тонкой подстройки PMF, а из того, что PrimeDope просто не держит эти каналы внутри модели.",
  },
  "weakness.pd.summary": {
    en: "Short version: PrimeDope is useful as a baseline where the tournament is already almost reduced to a single simple freezeout-shell. The more format-specific EV and uncertainty layers there are in the problem, the faster our model stops just \"differing\" and starts describing a different class of risk.",
    ru: "Коротко: PrimeDope полезен как baseline там, где турнир уже почти сведён к одному простому freezeout-shell. Чем больше в задаче format-specific EV и uncertainty layers, тем быстрее наша модель перестаёт «просто отличаться» и начинает описывать другой класс риска.",
  },

  "settingsDump.title": {
    en: "Snapshot · settings",
    ru: "Снимок · настройки",
  },

  "finishModel.power-law": { en: "Power-law", ru: "Степенной" },
  "finishModel.linear-skill": { en: "Linear skill", ru: "Линейный скилл" },
  "finishModel.stretched-exp": { en: "Stretched-exp", ru: "Растянутая экспонента" },
  "finishModel.plackett-luce": { en: "Plackett-Luce", ru: "Плакетт–Льюс" },
  "finishModel.uniform": { en: "Uniform", ru: "Равномерно" },
  "finishModel.empirical": { en: "Empirical (CSV)", ru: "Эмпирический (CSV)" },
  "finishModel.freeze-realdata-step": { en: "Freeze / real-data — step", ru: "Фриз / real-data — ступень" },
  "finishModel.freeze-realdata-linear": { en: "Freeze / real-data — linear", ru: "Фриз / real-data — линейно" },
  "finishModel.freeze-realdata-tilt": { en: "Freeze / real-data — tilt (α)", ru: "Фриз / real-data — наклон (α)" },
  "finishModel.pko-realdata-step": { en: "PKO / real-data — step", ru: "PKO / real-data — ступень" },
  "finishModel.pko-realdata-linear": { en: "PKO / real-data — linear", ru: "PKO / real-data — линейно" },
  "finishModel.pko-realdata-tilt": { en: "PKO / real-data — tilt (α)", ru: "PKO / real-data — наклон (α)" },
  "finishModel.mystery-realdata-step": { en: "Mystery / real-data — step", ru: "Mystery / real-data — ступень" },
  "finishModel.mystery-realdata-linear": { en: "Mystery / real-data — linear", ru: "Mystery / real-data — линейно" },
  "finishModel.mystery-realdata-tilt": { en: "Mystery / real-data — tilt (α)", ru: "Mystery / real-data — наклон (α)" },
  "finishModel.powerlaw-realdata-influenced": { en: "Power-law — real-data α", ru: "Степенной — real-data α" },

  // Error boundaries (app/error.tsx, app/global-error.tsx)
  "errorPage.title": { en: "Something went wrong", ru: "Что-то пошло не так" },
  "errorPage.body": {
    en: "The simulator hit an unexpected error. Reload the page — the schedule and settings saved in this browser are kept.",
    ru: "Симулятор столкнулся с непредвиденной ошибкой. Перезагрузите страницу — расписание и настройки, сохранённые в этом браузере, останутся.",
  },
  "errorPage.reload": { en: "Reload page", ru: "Перезагрузить страницу" },
  "errorPage.digest": { en: "Error id: {n}", ru: "Код ошибки: {n}" },
} as const satisfies Record<string, Entry>;

export type DictKey = keyof typeof DICT;
