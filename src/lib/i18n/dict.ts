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
    en: "Real spread of profit and streaks across your schedule. Thousands of Monte Carlo runs.",
    ru: "Реальный разброс профита и стриков по расписанию. Тысячи ранов Монте-Карло.",
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
  "section.schedule.subtitle": {
    en: "Each row plays its count per pass; schedule repeats N times per sample.",
    ru: "Каждая строка играется по count за проход; расписание повторяется N раз на сэмпл.",
  },
  "schedule.betaFormats": {
    en: "PKO, mystery bounty and other non-freezeout formats are still being calibrated — treat their numbers as experimental.",
    ru: "ПКО, мистери баунти и другие неклассические форматы ещё на стадии калибровки — их цифры экспериментальные.",
  },
  "section.controls.title": { en: "Simulation launch", ru: "Запуск симуляции" },
  "section.controls.subtitle": {
    en: "More simulations = tighter numbers. Skill model shapes how ROI distributes across finishes.",
    ru: "Больше симуляций — точнее цифры. Модель скилла задаёт раскладку ROI по местам.",
  },
  "section.results.title": { en: "Results", ru: "Результаты" },
  "section.results.subtitle": {
    en: "{samples} simulated runs, {tourneys} tournaments in each run",
    ru: "{samples} симуляций по {tourneys} турниров в каждой симуляции",
  },

  // Demo scenarios
  "demo.label": { en: "Example schedules", ru: "Примеры расписаний" },
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

  "userPreset.label": { en: "My presets", ru: "Мои пресеты" },
  "userPreset.saveCurrent": { en: "Save current", ru: "Сохранить текущий" },
  "userPreset.empty": {
    en: "Nothing saved yet. Configure a schedule and hit Save current.",
    ru: "Пока пусто. Настрой расписание и жми «Сохранить текущий».",
  },
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
    en: "Entries",
    ru: "Количество входов",
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
  "row.gameType": { en: "Game type", ru: "Тип игры" },
  "row.gameType.freezeout": { en: "Freezeout", ru: "Фризаут" },
  "row.gameType.freezeoutReentry": { en: "Freezeout + re-entry", ru: "Фриз + ре-энтри" },
  "row.gameType.pko": { en: "PKO", ru: "PKO" },
  "row.gameType.mystery": { en: "Mystery", ru: "Мистери" },
  "row.gameType.mysteryRoyale": {
    en: "GG Battle Royal",
    ru: "GG Battle Royal",
  },
  "row.gameTypeHint": {
    en: "Top-level format switch. Toggles which fields apply: re-entry for freezeout+re-entry; bounty% for PKO/mystery; lognormal σ² for mystery variants (mystery ≈ 0.8, royale ≈ 1.8). Existing bounty% is preserved when switching between bounty types.",
    ru: "Основной переключатель формата. Включает нужные поля: ре-энтри для фриза с реентри; баунти% для PKO/мистери; лог-нормальную σ² для мистери (мистери ≈ 0.8, рояль ≈ 1.8). При переключении между баунти-форматами баунти% сохраняется.",
  },
  "row.reentry": { en: "Re-entries", ru: "Ре-энтри" },
  "row.reentryRate": { en: "Re-entry rate", ru: "Доля ре-энтри" },
  "row.bounty": { en: "Bounty %", ru: "Баунти %" },
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
  "shape.blockedGap": { en: "gap", ru: "разрыв" },
  "shape.fixAuto": { en: "Clear locks", ru: "Снять фиксации" },
  "shape.fixPreset": { en: "Grinder preset", ru: "Пресет «гриндер»" },
  "shape.fixAll": { en: "Clear locks on all", ru: "Снять фиксации со всех" },
  "row.fixedItm": { en: "Fixed ITM %", ru: "Фикс. ITM %" },
  "row.fixedItmHint": {
    en: "Pin the in-the-money rate at a constant value regardless of ROI. All skill concentrates WITHIN the cashed band — a grinder doesn't cash more often than a no-skill player, they just run deeper when they do. Empty = auto (classic α-calibration, ITM rate scales with ROI). Typical: 15–18 % for a solid grinder.",
    ru: "Фиксирует частоту попадания в призовые независимо от ROI. Скилл весь уходит ВНУТРЬ призовой зоны — гриндер попадает в деньги не чаще нулевого игрока, но бежит глубже. Пусто = авто (классическая α-калибровка, ITM растёт с ROI). Типично: 15–18 % для крепкого гриндера.",
  },
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
  "row.brRoi.current": {
    en: "incl. RB {reported} · RB {rb}",
    ru: "с RB {reported} · RB {rb}",
  },
  "row.brRoi.title": {
    en: "Battle Royale regs often quote ROI with rakeback included. The row ROI field is pre-rakeback because global rakeback is added separately. With {rbPct} rakeback this adds {rbRoi}; current row {field} becomes {reported} reported ROI.",
    ru: "Реги Battle Royale часто называют ROI уже с рейкбеком. Поле ROI в строке хранит покерный ROI до рейкбека, потому что глобальный рейкбек добавляется отдельно. При RB {rbPct} это даёт {rbRoi}; текущие {field} в строке превращаются в {reported} reported ROI.",
  },
  "row.brRoi.short": {
    en: "incl. RB",
    ru: "с RB",
  },
  "row.brRoi.rbLine": {
    en: "RB {rb}",
    ru: "RB {rb}",
  },
  "row.brRoi.applyPreset": {
    en: "set reported ROI incl. RB",
    ru: "выбрать ROI с RB",
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
  "row.lateReg": { en: "Late-reg ×", ru: "Late-reg ×" },
  "row.lateRegHint": {
    en: "Real field at reg-close ÷ the field size you set. 1.3 = by late-reg close the field is 30% bigger than you thought you were playing. Scales prize pool and paid seats, adds variance. PrimeDope can't model this at all.",
    ru: "Во сколько раз поле на закрытии регистрации больше заявленного. 1.3 = к закрытию поле раздулось на 30% относительно начального значения. Масштабирует призовой и число призовых, добавляет дисперсию. PrimeDope этого не учитывает.",
  },

  // Controls panel
  "controls.scheduleRepeats": {
    en: "Tournaments per sample",
    ru: "Турниров в сэмпле",
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
    en: "Run number (reproducibility)",
    ru: "Номер рана (повторяемость)",
  },
  "controls.seedAuto": {
    en: "new seed on launch",
    ru: "новый сид при запуске",
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
  "controls.section.run": { en: "Run controls", ru: "Параметры рана" },
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
    en: "Models the case where your play degrades during long streaks (or improves during winning streaks). Leave everything at 0 to disable.",
    ru: "Моделирует случай, когда твоя игра проседает на стриках (или наоборот, обостряется на апсвингах). Оставь всё на 0 — выключено.",
  },
  "controls.tiltFastGain": {
    en: "Fast tilt: sensitivity",
    ru: "Быстрый тильт: чувствительность",
  },
  "controls.tiltFastScale": {
    en: "Fast tilt: drawdown depth that hurts you",
    ru: "Быстрый тильт: глубина стрика, на которой ломаешься",
  },
  "controls.tiltSlowGain": {
    en: "Slow tilt: ROI shift while tilted",
    ru: "Медленный тильт: насколько падает ROI",
  },
  "controls.tiltSlowThreshold": {
    en: "Slow tilt: drawdown that triggers it",
    ru: "Медленный тильт: стрик для запуска",
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
    en: "Matches the PrimeDope online calculator: every paid place is equally likely once you cash, so skill only shifts how often you cash — not how deep you run. Top-heavy payouts stay intact, but a skilled player never gets rewarded with extra deep finishes. Here only so you can see how much PrimeDope understates the real swings.",
    ru: "Считает ровно как калькулятор на сайте PrimeDope: внутри призовых все места равновероятны, поэтому скилл влияет только на частоту попаданий в деньги — но не на глубину прохода. Top-heavy выплаты сохраняются, просто скилловому игроку не достаётся больше глубоких финишей. Нужен только чтобы увидеть, насколько PrimeDope занижает реальные колебания.",
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
    en: "Baseline run with your settings — no additional noise channels. Use as a clean reference before adding variance sources.",
    ru: "Базовый ран с вашими настройками — без дополнительных каналов шума. Используйте как чистый референс перед добавлением источников дисперсии.",
  },
  "preset.steadyReg.label": { en: "Steady regular", ru: "Стабильный регуляр" },
  "preset.steadyReg.tagline": {
    en: "Calibrated for a steady, disciplined regular. Baseline run with minimal noise — most sessions play out at your true ROI.",
    ru: "Откалибровано под стабильного дисциплинированного регуляра. Базовый ран с минимальным шумом — большинство сессий проходят на реальном ROI.",
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
  "controls.running": { en: "Simulating…", ru: "Считаем…" },
  "controls.stop": { en: "Stop", ru: "Остановить" },
  "controls.eta": { en: "ETA", ru: "прогноз" },
  "controls.eta.hint": {
    en: "Projected run time based on how long the previous simulation took with similar settings. Updates after each run.",
    ru: "Прогноз времени рана по данным предыдущих симуляций при похожих настройках. Обновляется после каждого рана.",
  },
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
  "controls.done.worstDD": { en: "Max drawdown", ru: "Макс. просадка" },
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

  // Compare slot
  "slot.title": { en: "Compare slot", ru: "Слот сравнения" },
  "slot.saveCurrent": { en: "Save current", ru: "Сохранить" },
  "slot.load": { en: "Load into editor", ru: "Загрузить" },
  "slot.clear": { en: "Clear", ru: "Очистить" },
  "slot.empty": {
    en: "No saved slot. Save the current run to overlay it with new tweaks.",
    ru: "Слот пуст. Сохрани текущий ран — новые изменения лягут сверху.",
  },
  "slot.saved": { en: "Saved", ru: "Сохранено" },
  "slot.rows": { en: "rows", ru: "строк" },
  "slot.mean": { en: "mean", ru: "среднее" },
  "slot.comparing": { en: "Comparing with saved slot", ru: "Сравнение со слотом" },

  // Results — stat labels
  "stat.expectedProfit": { en: "Expected profit", ru: "Ожидаемый профит" },
  "stat.expectedProfit.sub": {
    en: "range: {min} → {max}",
    ru: "разброс: {min} → {max}",
  },
  "stat.expectedProfit.tip": {
    en: "Analytical EV (expected payout − full entry cost × entries). Actual MC mean: {mean} · ROI {roi} · median {median}.",
    ru: "Аналитическое EV (ожидаемая выплата − полная стоимость входов). Фактическое MC-среднее: {mean} · ROI {roi} · медиана {median}.",
  },
  "stat.probProfit.sub": {
    en: "{n} tourneys to reach ±5% ROI",
    ru: "{n} турниров до точного ROI ±5%",
  },
  "stat.riskOfRuin.sub": {
    en: "chance your bankroll streaks to zero",
    ru: "шанс стрикануть весь банкролл",
  },
  "stat.riskOfRuin.tip": {
    en: "For 1% RoR → need bankroll ≥ {br1}. For 5% RoR → need bankroll ≥ {br5}.",
    ru: "Для 1% риска разорения нужен БР ≥ {br1}. Для 5% — БР ≥ {br5}.",
  },
  "stat.ddWorst": { en: "Deepest drawdown", ru: "Максимальная просадка" },
  "stat.ddWorst.tip": {
    en: "Deepest peak-to-trough across all samples. Shown in $, ABIs, and tournaments between equal profit points.",
    ru: "Самая глубокая просадка от пика ко дну по всем сэмплам. Показана в $, ABI и турнирах между равными точками профита.",
  },
  "stat.stdDev": { en: "Profit volatility", ru: "Волатильность профита" },
  "stat.probProfit": { en: "Chance to be up", ru: "Шанс выйти в плюс" },
  "stat.riskOfRuin": { en: "Bankroll bust risk", ru: "Риск слить банкролл" },
  "stat.itmRate": { en: "ITM frequency", ru: "ITM-частота" },
  "stat.itmRate.sub": { en: "exact, analytical", ru: "точно, аналитически" },
  "stat.itmRate.tip": {
    en: "Share of tournaments that cash, averaged across the schedule. Analytical — no sampling noise.",
    ru: "Доля турниров в деньгах, усреднённая по расписанию. Аналитически, без шума выборки.",
  },
  "stat.var": { en: "Lower tail 5% / 1%", ru: "Нижний хвост 5% / 1%" },
  "stat.cvar": { en: "Avg tail loss 5% / 1%", ru: "Средний минус в хвосте" },
  "stat.sharpe": { en: "Profit / volatility", ru: "Профит / волатильность" },
  "stat.sortino": { en: "Profit / downside", ru: "Профит / просадка" },
  "stat.tFor95": { en: "Tournaments to ±5% ROI", ru: "Дистанция до ±5% ROI" },
  "stat.tFor95.sub": { en: "to reach ±5% ROI", ru: "до точного ROI ±5%" },
  "stat.kellyBR.tip": {
    en: "Kelly-optimal bankroll: ABI sits in the growth-maximizing fraction. Less = ruin risk, more = idle capital.",
    ru: "Оптимальный по Келли банкролл: ABI укладывается в долю, максимизирующую лог-рост. Меньше — риск, больше — деньги простаивают.",
  },
  "statGroup.range": { en: "Outcome range", ru: "Итоговый диапазон" },
  "statGroup.drawdowns": { en: "Drawdowns", ru: "Просадки" },
  "statGroup.streaks": { en: "Streaks & recovery", ru: "Серии и отыгрыш" },
  "statGroup.bankroll": { en: "Bankroll", ru: "Банкролл" },
  "stat.avgMaxDD": { en: "Average drawdown", ru: "Средняя просадка" },
  "stat.avgMaxDD.tip": {
    en: "Mean of the deepest per-sample drawdown (peak-to-trough). What a typical 'worst patch' looks like.",
    ru: "Среднее самой глубокой просадки по сэмплам (от пика к низу). Типичный худший отрезок.",
  },
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
  "stat.bestRun": { en: "Best scenario", ru: "Лучший сценарий" },
  "stat.bestRun.tip": {
    en: "Final profit of the luckiest sample — the upper extreme. Not 'expected', just 'possible'.",
    ru: "Итог самого везучего сэмпла — верхний край. Не «ожидаемое», а «возможное».",
  },
  "stat.worstRun": { en: "Worst scenario", ru: "Худший сценарий" },
  "stat.worstRun.tip": {
    en: "Final profit of the unluckiest sample — the lower extreme. Rare, but the simulation got there.",
    ru: "Итог самого невезучего сэмпла — нижний край. Редко, но симуляция туда попадала.",
  },
  "stat.p1p5": { en: "Lower tail 1% / 5%", ru: "Нижний хвост 1% / 5%" },
  "stat.p1p5.tip": {
    en: "1st and 5th percentiles of final profit: 1 in 100 / 1 in 20 runs end at least this badly.",
    ru: "1-й и 5-й перцентили итога: 1 из 100 / 1 из 20 ранов заканчивается минимум настолько плохо.",
  },
  "stat.p95p99": { en: "Upper tail 5% / 1%", ru: "Верхний хвост 5% / 1%" },
  "stat.p95p99.tip": {
    en: "95th and 99th percentiles of final profit: top 1 in 20 / 1 in 100 runs end at least this well.",
    ru: "95-й и 99-й перцентили итога: топ 1 из 20 / 1 из 100 ранов заканчивается минимум настолько хорошо.",
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
  "stat.minBR5": { en: "BR for 95% survival", ru: "Банкролл на 95% выживания" },
  "stat.minBR5.tip": {
    en: "Minimum bankroll that gives you a 95% chance of surviving this distance. Less = ruin risk climbs fast.",
    ru: "Минимальный банкролл с 95% шансом не закататься на этой дистанции. Меньше — шанс слива быстро растёт.",
  },
  "stat.bankrollOff": { en: "bankroll off", ru: "банкролл выкл" },
  "stat.skew": { en: "Profit tilt", ru: "Перекос профита" },
  "stat.kurt": { en: "Tail fatness", ru: "Толщина хвостов" },
  "stat.kelly": { en: "Kelly fraction", ru: "Доля по Келли" },
  "stat.kellyBR": { en: "Kelly BR", ru: "БР по Келли" },
  "stat.logG": { en: "BR growth rate", ru: "Темп роста БР" },

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
  "chart.trajectory.sub": {
    en: "Envelopes at 70 % / 95 % / 99.7 % confidence · 20 random samples · best / worst",
    ru: "Огибающие 70 % / 95 % / 99.7 % · 20 случайных сэмплов · лучший / худший",
  },
  "chart.trajectory.sub.vs": {
    en: "Side-by-side: our model vs the PrimeDope calculator — same seed, same schedule, identical Y-axis",
    ru: "Бок-о-бок: наша модель против калькулятора PrimeDope — одно и то же зерно, то же расписание, одна шкала",
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
    en: "Deep-finish skill — solo grinder baseline.",
    ru: "Глубокие финиши — базовый ран одиночного грайндера.",
  },
  "chart.trajectory.ours.cap.steadyReg": {
    en: "Deep-finish skill — stable regular baseline.",
    ru: "Глубокие финиши — базовый ран стабильного регуляра.",
  },
  "chart.trajectory.ours.cap.custom": {
    en: "Your hand-tuned model.",
    ru: "Твоя ручная настройка модели.",
  },
  "chart.trajectory.theirs.cap": {
    en: "Min-cash as likely as 1st place — swings understated.",
    ru: "Мин-кэш равновероятен с 1-м местом — колебания занижены.",
  },
  "chart.trajectory.pdWarning": {
    en: "Why this is wrong: PrimeDope keeps the real top-heavy payouts but assumes every paid place is equally likely once you cash — a min-cash as probable as a WIN. In reality most cashes barely return the buy-in and deep runs are rare, so the uniform assumption inflates the average cash size. Result: smoother drawdowns, shorter breakeven streaks, and a bankroll recommendation too small for real swings.",
    ru: "Почему это неправильно: PrimeDope сохраняет реальные top-heavy выплаты, но считает все призовые места равновероятными — мин-кэш как ПОБЕДА. На деле большая часть кэшей еле возвращает бай-ин, глубокие заходы редки, и равновероятная модель завышает средний размер кэша. Итог: сглаженные стрики, короткие серии в ноль и заниженный рекомендуемый банкролл.",
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
  "chart.trajectory.noKoWarning": {
    en: "Why not PrimeDope: PrimeDope's calculator has no bounty/KO field at all, so we can't run your PKO schedule through it. Instead we show the same schedule through our own model with bounties stripped — same algo, same seed, PKO component removed. Use it to see how much of the variance comes from the KO side of the prizepool.",
    ru: "Почему не PrimeDope: в калькуляторе PrimeDope нет поля для баунти, PKO-расписание через него не проходит. Вместо этого справа — то же расписание через нашу модель без ноков: тот же алгоритм, тот же сид, PKO-компонент выключен. Позволяет оценить, какая доля дисперсии приходится на ноки.",
  },
  "chart.trajectory.oursFix": {
    en: "How we fix it: finishes sampled from a real top-heavy pmf calibrated on pooled MTT data. A skilled player's 1st/2nd/3rd odds are meaningfully above the paid-pool average; most cashes stay min-cashes. Overall ITM is lower than PrimeDope's (~17% at 20% ROI vs their ~21%), but each cash is weighted correctly. Streak depth, recovery length, and drawdown shape match reality instead of PD's smoothed picture.",
    ru: "Как решаем: места финиша сэмплируются из реальной top-heavy pmf, откалиброванной по реальным пулам MTT-данных. Шанс скиллового игрока на 1-е/2-е/3-е значимо выше среднего по призовой зоне; основная масса кэшей — всё равно мин-кэши. Общий ITM ниже, чем у PrimeDope (~17% при ROI 20% против ~21%), зато каждый кэш взвешен корректно. Глубина стриков, отмазка и форма стриков ложатся в реальность.",
  },
  "chart.hideJackpots": {
    en: "hide jackpots",
    ru: "скрыть джекпоты",
  },
  "chart.hideJackpots.title": {
    en: "Hide mystery / mystery-royale runs that drew an envelope ≥ 100× the mean. A handful of jackpot samples stretch the distribution x-axis and the trajectory y-axis into unreadable territory even though they're statistically rare.",
    ru: "Скрыть mystery / mystery-royale раны, где вытянулся конверт ≥ 100× от среднего. Пара джекпотных сэмплов растягивает ось X гистограммы и ось Y траектории так, что остальной график становится нечитаемым, хотя статистически такие раны редки.",
  },
  "chart.trajectory.withRakeback": {
    en: "with RB",
    ru: "с РБ",
  },
  "chart.recomputing": {
    en: "recomputing…",
    ru: "пересчёт…",
  },
  "chart.trajectory.withRakeback.title": {
    en: "Show the trajectory with rakeback applied (all sampled runs, EV, percentile bands and best/worst shift up by the deterministic RB curve). Uncheck to see the game-only view — exposes drawdowns, bust probability, and time-above-zero as they'd be without the RB cushion.",
    ru: "Показывать траекторию с учётом рейкбэка (все семплированные раны, EV, перцентильные полосы и best/worst сдвигаются вверх на детерминированную кривую РБ). Отключи — увидишь чистый game-only: стрики, вероятность разорения и время под нулём без РБ-подушки.",
  },
  "chart.trajectory.overlay": {
    en: "Overlay PrimeDope on the left",
    ru: "Наложить PrimeDope слева",
  },
  "chart.trajectory.overlayHint": {
    en: "Show PrimeDope's mean + best/worst runs over our chart so the gap is unmistakable",
    ru: "Показать средний, лучший и худший раны PrimeDope поверх нашего графика — разница видна сразу",
  },
  "chart.trajectory.overlayDisabledKo": {
    en: "Unavailable on PKO schedules — the right pane already shows the same schedule with bounties stripped, not PrimeDope",
    ru: "Недоступно для PKO-расписаний — справа уже то же расписание без ноков, а не PrimeDope",
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
    en: "PD payout curves.\n\nSource: lifted from primedope.com's Tournament Variance Calculator — we ran their tool with 1000-player fields across 10-20% ITM presets, recorded the per-place % of pool, and rebuilt the same family locally (src/lib/sim/pdCurves.ts).\n\nShape: top-heavy but not crazy — 1st place ≈18-25% of pool, 2nd ≈13-15%, flat tail down to min-cash ≈1.5× buy-in. Paid spots ≈ round(0.15 × field). Matches PD's numbers to within ~0.2% SD on shared schedules.\n\nUncheck to run PD's math (finish model + rake quirk) on YOUR row's real payout table instead.",
    ru: "Пейауты ПД.\n\nИсточник: сняты с primedope.com Tournament Variance Calculator — прогоняли их калькулятор на полях в 1000 игроков по пресетам 10-20% ITM, записывали % пула на место и восстановили ту же семью у себя (src/lib/sim/pdCurves.ts).\n\nФорма: top-heavy, но не зверь — 1 место ≈18-25% пула, 2 ≈13-15%, плоский хвост до мин-кэша ≈1.5×БИ. Платных мест ≈ round(0.15 × поле). Совпадает с их цифрами с точностью ~0.2% по SD на общих расписаниях.\n\nСнимите галку — прогнать математику ПД (финиш-модель + рейк-квирк) на РЕАЛЬНОЙ таблице выплат вашего турнира.",
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
    en: "PD rake quirk (their §7): variance is driven by the POST-rake prize pool. In this comparison the EV target stays pinned to the same full-cost ROI as the left chart.\n\nExample — $100 + $9 rake, 1000 entrants, player ROI +20%:\n  EV target in both panes = 0.20 × $109 = $21.80\n\nBut SD differs:\n  Our SD scales with the full $109 × 1000 pool (rake is a real cost)\n  PD  SD scales with $100 × 1000 pool only (post-rake)\n  → PD's SD comes out ≈8.3% lower on this row\n\nConsequence: crank rake up to $20 and PD's simulated SD keeps dropping while EV stays pinned. This toggle isolates that coupling alone.\n\nUncheck to use the pre-rake pool in PD's pass.",
    ru: "Квирк рейка ПД (их §7): дисперсия считается от ПОСТ-рейкового призового пула. В этом сравнении EV-таргет закреплён тем же ROI от полной стоимости, что и левый график.\n\nПример — $100 + $9 рейк, 1000 участников, ROI игрока +20%:\n  EV-таргет в обеих панелях = 0.20 × $109 = $21.80\n\nНо SD разная:\n  Наша SD считается от полного пула $109 × 1000 (рейк — реальная стоимость)\n  SD ПД  считается только от $100 × 1000 (пост-рейк)\n  → SD ПД на этой строке выходит ≈8.3% ниже\n\nСледствие: подними рейк до $20 — у ПД симулированная SD будет падать, а EV останется закреплённым. Эта галка изолирует только этот эффект.\n\nСнимите галку — использовать пре-рейковый пул в прогоне ПД.",
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
    en: "Biggest run-good vs EV",
    ru: "Самый большой переап над EV",
  },
  "chart.trajectory.gapDd": {
    en: "Deepest downstreak",
    ru: "Самый глубокий даунстрик",
  },
  "chart.trajectory.gapItm": {
    en: "ITM rate",
    ru: "ITM-частота",
  },
  "chart.trajectory.gapRor": {
    en: "Bankroll for 1% RoR",
    ru: "Банкролл на 1% RoR",
  },
  "chart.trajectory.gapRatio": {
    en: "{pct} vs PrimeDope",
    ru: "{pct} относительно PrimeDope",
  },
  "chart.trajectory.gapRatioDeeper": {
    en: "{pct} vs PrimeDope",
    ru: "{pct} относительно PrimeDope",
  },
  "chart.trajectory.gapExplain": {
    en: "The gap is real, not a rendering bug: our model concentrates cash probability on top finishes (where 80%+ of the prize pool lives), while PrimeDope treats every paid place as equally likely. Same mean profit, radically different tails — and the tails are what eat your bankroll.",
    ru: "Разрыв реальный, а не глюк отрисовки: наша модель концентрирует вероятность призовых мест в верху (там где живёт 80%+ всего призового фонда), а PrimeDope считает, что любое призовое место равновероятно. Среднее одинаковое, но хвосты радикально разные — а банкролл едят именно хвосты.",
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
  "chart.longestBE.tip": {
    en: "Criterion: longest horizontal chord of the profit trajectory — the biggest gap (in tournaments) between two points of the graph sharing the same Y value. A measure of 'playing for nothing': how long the run bounced around a fixed bankroll level before breaking out of it.\n\nX — chord length in tournaments. Y — how many samples have their longest chord fall in this bucket (one entry per sample).",
    ru: "Критерий: самый длинный горизонтальный отрезок графика профита — максимальная дистанция (в турнирах) между двумя точками с одинаковым значением Y. Метрика «игры в ноль»: сколько турниров ран болтался вокруг одного и того же уровня банкролла, прежде чем ушёл с него надолго.\n\nX — длина отрезка в турнирах. Y — сколько сэмплов попало в этот бакет (один замер на сэмпл).",
  },
  "chart.longestCashless": { en: "Cashless streaks", ru: "Серии без ИТМ" },
  "chart.longestCashless.sub": {
    en: "How often and how long you grind without landing a cash",
    ru: "Как часто и как долго длятся серии без захода в призы",
  },
  "chart.longestCashless.rbNote": {
    en: "Independent of rakeback — counts ITM events, not profit.",
    ru: "Не зависит от рейкбэка — считает заходы в ИТМ, не профит.",
  },
  "chart.longestCashless.tip": {
    en: "Критерий: серия — это непрерывная последовательность турниров без попадания в призовую часть (place ≥ paidCount). Заканчивается на первом же ITM.\n\nПо X — длина серии в турнирах, по Y — сколько ТАКИХ серий встретилось во всех сэмплах суммарно (все серии, а не только максимумы по сэмплу).",
    ru: "Критерий: серия — это непрерывная последовательность турниров без попадания в призовую часть (place ≥ paidCount). Заканчивается на первом же ITM.\n\nПо X — длина серии в турнирах, по Y — сколько ТАКИХ серий встретилось во всех сэмплах суммарно (все серии, а не только максимумы по сэмплу).",
  },
  "chart.recovery": { en: "Recovery length", ru: "Отмазка" },
  "chart.recovery.sub": {
    en: "How many tournaments it takes to climb from the bottom back to the pre-streak peak",
    ru: "Сколько турниров уходит на то, чтобы со дна вернуться к прежнему пику",
  },
  "chart.recovery.tip": {
    en: "Критерий: для каждого сэмпла находим самую глубокую просадку (маx peak-to-trough). Отмазка — количество турниров с момента дна этой просадки до первого турнира, на котором профит снова достигает старого максимума.\n\nЕсли сэмпл не успел отмазаться до конца расписания — он считается не восстановившимся и в график не попадает (такие сэмплы показаны отдельной строкой под графиком).",
    ru: "Критерий: для каждого сэмпла находим самую глубокую просадку (маx peak-to-trough). Отмазка — количество турниров с момента дна этой просадки до первого турнира, на котором профит снова достигает старого максимума.\n\nЕсли сэмпл не успел отмазаться до конца расписания — он считается не восстановившимся и в график не попадает (такие сэмплы показаны отдельной строкой под графиком).",
  },
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
    en: "percentile band around the average",
    ru: "полоса процентилей вокруг среднего",
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
  "chart.traj.hoverHint.lead": {
    en: "Hover a run:",
    ru: "Наведи на ран:",
  },
  "chart.traj.hoverHint.peak": {
    en: "peak",
    ru: "пик",
  },
  "chart.traj.hoverHint.maxDd": {
    en: "max drawdown",
    ru: "макс. просадка",
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
    en: "70 / 95 / 99.7% bands",
    ru: "полосы 70 / 95 / 99.7%",
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
  "chart.unit.tourneys": { en: "units: tournaments", ru: "единицы: турниры" },
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
  "chart.convergence.col.target": { en: "ROI range", ru: "Диапазон ROI" },
  "chart.convergence.col.tourneys": { en: "Tournaments", ru: "Турниров" },
  "chart.convergence.col.fields": { en: "AFS played", ru: "Сыграно AFS" },
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
  "chart.convergence.rakeback": { en: "RB", ru: "РБ" },
  "chart.convergence.rakeback.title": {
    en: "Rakeback — % of paid rake credited back after every tournament. Added on top of the game ROI to get the total ROI the player sees: RB → ROI = rakeback × rake (e.g. 30 % RB at 10 % rake → +3 pp of ROI). σ is driven only by the game ROI above (rakeback contributes zero variance), so bumping RB raises total ROI without changing convergence.",
    ru: "Рейкбек — % от уплаченного рейка, возвращаемый после каждого турнира. Прибавляется к игровому ROI — получаем итоговый ROI: вклад в ROI = рейкбек × рейк (например, 30 % РБ при рейке 10 % → +3 пп ROI). σ считается по игровому ROI выше (рейкбек не добавляет дисперсии), так что РБ поднимает итоговый ROI, но не влияет на сходимость.",
  },
  "chart.convergence.totalRoi": { en: "total ROI:", ru: "итоговый рой:" },
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
  "chart.convergence.mode.averaged": { en: "Averaged", ru: "Усреднённо" },
  "chart.convergence.mode.exact": {
    en: "Schedule",
    ru: "Расписание",
  },
  "chart.convergence.mode.hint": {
    en: "Averaged: generic planning mode. Freeze uses a runtime standard-freeze row at the chosen AFS / ROI, while PKO, Mystery, and Battle Royale use promoted format fits. Mix weights are shares of tournaments in the synthetic mix. Schedule: compiles the real rows and aggregates per-row dollar variance, late reg, field variability, payout shape, rake, and bounty structure into one schedule-aware σ_ROI.",
    ru: "Усреднённо: общий planning-режим. Для Фриза берётся runtime standard-freeze строка на выбранных AFS / ROI, а для ПКО, Мистери и Battle Royale используются промоутнутые format-fits. В Миксе веса означают долю турниров в синтетическом миксе. Расписание: компилирует реальные строки и агрегирует долларовую дисперсию по строкам, late reg, field variability, payout-shape, рейк и bounty-структуру в один schedule-aware σ_ROI.",
  },
  "chart.convergence.freeze.runtimeNote": {
    en: "Freeze is runtime-driven here: ROI changes the point estimate through the actual single-row model instead of the old ROI-invariant fit.",
    ru: "Здесь Фриз считается через runtime-модель: ROI меняет точечную оценку через реальную single-row модель, а не через старый ROI-invariant fit.",
  },
  "chart.convergence.exact.breakdown": {
    en: "Variance contribution per row",
    ru: "Вклад рядов в дисперсию",
  },
  "chart.convergence.exact.pointOnly": {
    en: "Schedule mode is point-only: CI still changes the confidence target, and 'AFS played' uses the compiled mean field of the schedule:",
    ru: "Режим Расписание даёт точечную оценку: CI по-прежнему меняет доверительность, а «Сыграно AFS» считается по скомпилированному среднему полю расписания:",
  },
  "chart.convergence.exact.rowCol.row": { en: "Row", ru: "Ряд" },
  "chart.convergence.exact.rowCol.afs": { en: "AFS", ru: "AFS" },
  "chart.convergence.exact.rowCol.roi": { en: "ROI", ru: "ROI" },
  "chart.convergence.exact.rowCol.fmt": { en: "Format", ru: "Формат" },
  "chart.convergence.exact.rowCol.share": { en: "Spend %", ru: "Доля затрат" },
  "chart.convergence.exact.rowCol.varShare": { en: "σ² share", ru: "Доля σ²" },
  "chart.convergence.exact.empty": {
    en: "Load a schedule to see per-row σ breakdown.",
    ru: "Загрузите расписание, чтобы увидеть разбивку σ по рядам.",
  },
  "chart.convergence.mix.note": {
    en: "Mix weights are shares of tournaments in the synthetic mix, not dollar-risk shares.",
    ru: "Веса в Миксе — это доли турниров в синтетическом миксе, а не доли долларового риска.",
  },
  "chart.convergence.bandWarning.containsMystery": {
    en: "Mystery still uses a point estimate here, but its current runtime fit carries too much residual drift for an honest numeric ± band. The point stays as a ballpark; the range is hidden until the Mystery policy is revalidated.",
    ru: "Для Mystery точка пока остаётся ориентиром, но текущий runtime-fit даёт слишком большой residual drift для честной числовой ± полосы. Поэтому точку оставили, а диапазон скрыли до новой валидации политики Mystery.",
  },
  "chart.convergence.bandWarning.outsideFitBox": {
    en: "Current AFS / ROI sits outside the validated training box for this format (freeze & PKO / Mystery field 50–50 000, PKO / Mystery ROI −20..+80 %, MBR field fixed at 18 with ROI ±10 %). The point estimate is still a ballpark, but the ± band is extrapolation territory so it's suppressed.",
    ru: "Текущий AFS / ROI выходит за пределы validated training box для этого формата (фриз и ПКО / Мистери поле 50–50 000, ПКО / Мистери ROI −20..+80 %, MBR поле строго 18 и ROI ±10 %). Точка всё ещё ориентир, но ± полоса была бы экстраполяцией — её скрыли.",
  },
  "chart.convergence.rbHint": {
    en: "RB shifts total ROI upward but doesn't add variance — the k / fields above are driven by game σ only, independent of RB%.",
    ru: "РБ сдвигает итоговый ROI вверх, но не добавляет дисперсии — k / филды выше зависят только от игровой σ и не меняются с РБ.",
  },
  "chart.convergence.assumptions": {
    en: "Read a row as: play this many tournaments and, with the chosen CI confidence, your observed ROI lands inside the target band around the true one. Freeze now reacts to ROI through the runtime single-row model. PKO, Mystery, and Battle Royale also grow with ROI because better runs collect more bounty value. Mix combines Freeze / PKO / Mystery by user-set tournament weights: σ²_mix = Σ w_format·σ²_format. Schedule mode ignores the global AFS / ROI / rake sliders, compiles each row with its own field, late reg, field variability, payout shape, rake, and bounty structure, then aggregates schedule-level dollar variance. Averaged bounty tabs show a numeric residual band only inside their validated training boxes; Freeze and Schedule are point-first runtime estimates, and Mystery keeps only the point estimate until its policy is revalidated.",
    ru: "Строка читается так: сыграй столько турниров, и с выбранной доверительностью наблюдаемый ROI попадёт в указанную полосу вокруг истинного. Фриз теперь реагирует на ROI через runtime single-row модель. В ПКО, Мистери и Battle Royale σ тоже растёт с ROI, потому что более глубокие проходы собирают больше баунти. Микс комбинирует Фриз / ПКО / Мистери по заданным весам турниров: σ²_микс = Σ w_format·σ²_format. Режим Расписание игнорирует глобальные ползунки AFS / ROI / рейка, компилирует каждую строку со своим полем, late reg, field variability, payout-shape, рейком и bounty-структурой, а потом агрегирует schedule-level долларовую дисперсию. В усреднённых bounty-вкладках числовая residual-полоса показывается только внутри validated training box; Фриз и Расписание теперь point-first runtime-оценки, а для Mystery пока сохраняется только точка до новой валидации политики.",
  },
  "chart.decomp": { en: "Per-row EV decomposition", ru: "Декомпозиция EV по строкам" },
  "chart.decomp.sub": {
    en: "How much each row contributes to expected profit and to total variance",
    ru: "Вклад каждой строки в ожидаемую прибыль и общую дисперсию",
  },
  "chart.decomp.bountyLabel": { en: "bty", ru: "ноки" },
  "chart.decomp.bountyTip": {
    en: "Mean bounty winnings per sample — the knockout portion of this row's profit",
    ru: "Средние баунти за прогон — вклад ноков в профит этой строки",
  },
  "chart.decomp.cashTip": {
    en: "Cash portion of this row's mean profit (prize payouts − rake − buy-in + rakeback)",
    ru: "Кэш-часть среднего профита строки (призовые − рейк − бай-ин + рейкбек)",
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
  "section.verdict": { en: "Verdict", ru: "Вердикт" },
  "section.primedopeReport": { en: "PrimeDope report", ru: "PrimeDope отчёт" },
  "section.pdWeakness": { en: "PrimeDope model flaws", ru: "Минусы модели PrimeDope" },
  "section.settingsDump": { en: "Run settings", ru: "Настройки рана" },
  "section.pdVerdict": { en: "PrimeDope verdict", ru: "Вердикт PrimeDope" },
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
  "changelog.v074.title": { en: "v0.7.4 - 2026-04-20", ru: "v0.7.4 - 2026-04-20" },
  "changelog.v074.brWinnerFirst": {
    en: "Battle Royale fixed-ITM profit now strengthens 1st place before extra cash EV starts spilling into the rest of top-3.",
    ru: "В Battle Royale с фиксированным ITM дополнительный профит теперь сначала усиливает 1-е место, и только потом начинает перетекать в остальной топ-3.",
  },
  "changelog.v074.brParity": {
    en: "Battle Royale fixed-ITM math was cleaned up so the engine, validation, and microscope preview all use the same winner-first path.",
    ru: "Математику Battle Royale с фиксированным ITM почистили: движок, валидация и микроскоп теперь используют один и тот же winner-first путь.",
  },
  "changelog.v074.inputPerf": {
    en: "ROI editing is responsive again: number fields stop re-solving on every keystroke, snap to valid step values, and no longer leak .04-style tails into whole-percent ROI boxes.",
    ru: "Редактирование ROI снова отзывчивое: числовые поля перестали пересчитывать всё на каждый символ, снапятся к валидному шагу и больше не протаскивают хвосты вроде .04 в поля с целым процентом ROI.",
  },
  "changelog.v073.title": { en: "v0.7.3 — 2026-04-20", ru: "v0.7.3 — 2026-04-20" },
  "changelog.v073.koAudit": {
    en: "KO-share control is easier to audit: neutral midpoint, bounded numeric EV entry, and cash / regular KO / jackpot percentages in gross EV.",
    ru: "Контрол доли ноков проще проверять: нейтральный центр, ограниченный числовой ввод %EV и проценты кеша / обычных ноков / джекпота в брутто EV.",
  },
  "changelog.v073.evCard": {
    en: "Microscope EV and EV-profit readouts were combined into one cleaner expected-return card.",
    ru: "EV и EV-профит в микроскопе объединены в одну более чистую карточку ожидаемого возврата.",
  },
  "changelog.v073.brRoi": {
    en: "Battle Royale ROI helper now converts reported ROI with rakeback into the pre-rakeback row ROI used by the simulator.",
    ru: "Для Battle Royale добавлен помощник ROI: reported ROI с рейкбеком переводится в ROI строки до рейкбека, который использует симулятор.",
  },
  "changelog.v073.brRoiSplit": {
    en: "Battle Royale ROI presets split added ROI profit 50/50 between cash and KOs at the slider midpoint, then let the KO-share slider move that split.",
    ru: "ROI-пресеты Battle Royale в центре слайдера делят добавленный ROI-профит 50/50 между кешем и ноками, а затем слайдер доли ноков двигает этот сплит.",
  },
  "changelog.v07a.title": { en: "v0.7.1 — 2026-04-18", ru: "v0.7.1 — 2026-04-18" },
  "changelog.v07a.cash": {
    en: "Advanced mode now has a separate cash-game variance simulator with mixed limits and parallel workers.",
    ru: "В advanced mode появился отдельный симулятор дисперсии для кэша с миксом лимитов и параллельными воркерами.",
  },
  "changelog.v07a.mttPerf": {
    en: "MTT became more responsive: less lag on edits, cleaner chart behavior, and a batch of small UI fixes.",
    ru: "MTT стал отзывчивее: меньше лагов при редактировании, аккуратнее поведение графиков и пачка мелких правок интерфейса.",
  },
  "changelog.v07a.progress": {
    en: "Progress bar and ETA now track the real run phases much closer and stop freezing in the middle.",
    ru: "Прогресс-бар и ETA стали заметно ближе к реальным фазам расчёта и меньше залипают посередине.",
  },
  "changelog.v07a.mystery": {
    en: "Mystery / Battle Royale got a bounty-window fix, a jackpot-hide toggle, and refreshed convergence coefficients after the model fix.",
    ru: "Для Mystery / Battle Royale поправили окно баунти, добавили скрытие джекпотов и пересчитали коэффициенты сходимости после фикса модели.",
  },
  "changelog.v07a.stats": {
    en: "Streak and convergence blocks were cleaned up: exact mode uses per-row rake and the stats block now shows an average 'any streak' metric.",
    ru: "Почистили блоки серий и сходимости: exact mode использует рейк по рядам, а в статистике появился средний показатель по любой серии.",
  },
  "changelog.v07a.polish": {
    en: "Minor UI fixes.",
    ru: "Мелкие правки интерфейса.",
  },
  "changelog.v07.title": { en: "v0.7 — 2026-04-17", ru: "v0.7 — 2026-04-17" },
  "changelog.v07.formats": {
    en: "The model moved beyond plain freezeouts: Mystery, Battle Royale and exact schedule mode became first-class parts of the app.",
    ru: "Модель ушла дальше простых фризаутов: Mystery, Battle Royale и exact-режим для точного расписания стали полноценной частью приложения.",
  },
  "changelog.v07.convergence": {
    en: "The convergence block turned into a real planning tool: format tabs, wider CI range, and schedule-aware calculations.",
    ru: "Блок сходимости стал рабочим инструментом: вкладки по форматам, более широкий диапазон CI и расчёты с учётом расписания.",
  },
  "changelog.v07.gameType": {
    en: "Schedule controls became clearer: explicit game types, better trim/filter controls, and fewer compare-mode surprises.",
    ru: "Управление расписанием стало понятнее: явные типы турниров, более внятные trim/filter-контролы и меньше сюрпризов в compare-режимах.",
  },
  "changelog.v07.rakeback": {
    en: "Rakeback became part of the results view instead of a side note: profit, streak and recovery blocks now react to it consistently.",
    ru: "Рейкбек стал частью результата, а не сноской: профит, серии и отыгрыш теперь учитывают его заметно последовательнее.",
  },
  "changelog.v06c.title": { en: "v0.6c", ru: "v0.6c" },
  "changelog.v06c.hoverHighlights": {
    en: "Hovered run: deepest peak-to-trough drawdown highlighted in red with its anchor peak marked.",
    ru: "Ран под курсором: самая глубокая просадка от пика до дна подсвечена красным с точкой-якорем на пике.",
  },
  "changelog.v06b.title": { en: "v0.6b — 2026-04-16", ru: "v0.6b — 2026-04-16" },
  "changelog.v06b.summary": {
    en: "A polish release: line presets, overlay styling, better controls, and smaller fixes around EV and global ITM behavior.",
    ru: "Полировочный релиз: пресеты линий, стиль оверлеев, правки контролов и несколько точечных фиксов вокруг EV и глобального ITM.",
  },
  "changelog.v06b.ev": {
    en: "EV context on profit and run blocks: EV + ROI + median, worst/best runs show delta vs EV.",
    ru: "EV-контекст в профите и ранах: EV + ROI + медиана, худший/лучший раны — отклонение от EV.",
  },
  "changelog.v06.title": { en: "v0.6 — 2026-04-15", ru: "v0.6 — 2026-04-15" },
  "changelog.v06.summary": {
    en: "PKO support, a redesigned first screen, EV breakdowns, and a much more realistic payout model landed together here.",
    ru: "Здесь одновременно приехали PKO, новый первый экран, разложение EV по каналам и намного более реалистичная модель выплат.",
  },
  "changelog.v06.pko": {
    en: "PKO compare mode: side-by-side view for bounty vs non-bounty variance.",
    ru: "PKO сравнение: параллельный вид дисперсии с баунти и без.",
  },
  "changelog.v05.title": { en: "v0.5 — 2026-04-15", ru: "v0.5 — 2026-04-15" },
  "changelog.v05.summary": {
    en: "PrimeDope comparison became a separate feature: overlay, toggles and the first serious convergence block all appeared in this cycle.",
    ru: "Сравнение с PrimeDope стало отдельной фичей: оверлей, переключатели и первый серьёзный блок сходимости появились именно здесь.",
  },
  "changelog.v05.pdWidget": {
    en: "PrimeDope comparison panel with overlay and toggles.",
    ru: "Панель сравнения с PrimeDope с оверлеем и переключателями.",
  },
  "changelog.v04.title": { en: "v0.4 — 2026-04-14", ru: "v0.4 — 2026-04-14" },
  "changelog.v04.summary": {
    en: "The app shifted from 'profit only' to 'what kind of downswings and recoveries can actually happen'.",
    ru: "Приложение сместилось от «просто профита» к вопросу «какие именно просадки и отыгрывания реально бывают».",
  },
  "changelog.v03.title": { en: "v0.3 — 2026-04-13", ru: "v0.3 — 2026-04-13" },
  "changelog.v03.presets": {
    en: "The first usable simulator build: presets, trajectory styling, unit switcher and import/export.",
    ru: "Первая реально рабочая версия симулятора: пресеты, стили траекторий, переключатель единиц и импорт/экспорт.",
  },
  "chart.convergence.help": {
    en: "Fewer tournaments means your observed ROI is mostly noise. The table says how many tournaments you need for each target ROI band at the selected confidence level.\n\nTabs: Freeze, PKO, Mystery, GG Battle Royal, Mix, and Schedule. Freeze is ROI-invariant in the current fit, so the ROI slider is hidden there. Bounty formats are ROI-sensitive. Mix blends Freeze / PKO / Mystery with σ²_mix = Σ w·σ². Schedule mode uses the real rows one by one instead of average sliders.\n\nAFS changes the average field size, CI changes how strict the interval is, rake rescales ROI-unit σ by cost basis. Numeric cells show point estimate · fit-drift range when that range is allowed; warning cells keep only the point estimate.",
    ru: "Чем меньше сыграно турниров, тем сильнее наблюдаемый ROI состоит из шума. Таблица показывает, сколько турниров нужно для каждой полосы ROI при выбранной доверительности.\n\nВкладки: Фриз, ПКО, Мистери, GG Battle Royal, Микс и Расписание. Во Фризе текущий fit не зависит от ROI, поэтому ROI-ползунок скрыт. Баунти-форматы чувствительны к ROI. Микс смешивает Фриз / ПКО / Мистери через σ²_микс = Σ w·σ². Расписание считает реальные строки по одной, а не средние ползунки.\n\nAFS меняет средний размер поля, CI — строгость интервала, рейк пересчитывает σ в ROI-единицах через cost basis. Числа показываются как точка · диапазон drift-а fit-а, когда такой диапазон разрешён; при warning остаётся только точечная оценка.",
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
  "pd.refresh.label": { en: "Refresh", ru: "Обновить" },
  "pd.refresh.hint": {
    en: "Re-run the PrimeDope pane with the current checkbox settings.",
    ru: "Пересчитать правый пейн с текущими галочками PD.",
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
  "pd.row.stdDev": { en: "Profit volatility", ru: "Волатильность профита" },
  "pd.row.dd": { en: "Average drawdown", ru: "Средняя просадка" },
  "pd.row.cvar": { en: "Average loss in worst 5%", ru: "Средний убыток в худших 5%" },
  "pd.row.pprofit": { en: "Chance to be up", ru: "Шанс выйти в плюс" },
  "pd.row.ror": { en: "Bankroll bust risk", ru: "Риск слить банкролл" },
  "pd.row.var95": { en: "Lower tail 5%", ru: "Нижний хвост 5%" },
  "pd.row.cvar99": { en: "Average loss in worst 1%", ru: "Средний убыток в худших 1%" },
  "pd.row.worstRun": { en: "Worst scenario", ru: "Худший сценарий" },
  "pd.row.bestRun": { en: "Best scenario", ru: "Лучший сценарий" },
  "pd.row.longestBE": { en: "Avg worst flatline", ru: "Средний худший откат" },
  "pd.row.sharpe": { en: "Profit / volatility", ru: "Профит / волатильность" },
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

  // Verdict — plain-language summary card
  "verdict.title": {
    en: "What this means in plain English",
    ru: "Что это значит по-человечески",
  },
  "verdict.ev.good": {
    en: "On average you end a schedule pass up {mean} ({roi} ROI). Long-term, if you play this schedule forever, you bank that per pass.",
    ru: "В среднем за один ран расписания результат +{mean} ({roi} ROI). На длинной дистанции это реальный заработок за один ран.",
  },
  "verdict.ev.bad": {
    en: "On average you end a schedule pass down {mean} ({roi} ROI). Long-term, playing this schedule bleeds money.",
    ru: "В среднем за один ран расписания результат {mean} ({roi} ROI). На дистанции это расписание убыточно.",
  },
  "verdict.prob": {
    en: "You finish a schedule pass in profit {prob} of the time — {qual}.",
    ru: "Ран заканчивается в плюсе в {prob} случаев — {qual}.",
  },
  "verdict.prob.q.great": { en: "very reliable", ru: "очень надёжно" },
  "verdict.prob.q.good": { en: "solid", ru: "стабильно" },
  "verdict.prob.q.meh": { en: "coin-flippy", ru: "как монетка" },
  "verdict.prob.q.bad": { en: "basically a lottery", ru: "по сути лотерея" },
  "verdict.swing": {
    en: "Expect a typical downstreak of {dd} along the way. In the worst 1 % of outcomes the loss goes to {cvar99}.",
    ru: "Типичный даунстрик по ходу рана — около {dd}. В худших 1 % случаев убыток доходит до {cvar99}.",
  },
  "verdict.streak.upswing": {
    en: "Good streaks: the top 5 % of runs finish at {p95} or better, with the absolute best landing at {best}.",
    ru: "Хорошие серии: верхние 5 % ранов заканчиваются на {p95} и выше, абсолютный максимум — {best}.",
  },
  "verdict.streak.bad": {
    en: "Bad streaks: a typical drop from peak to bottom is {ddMean} (about {ddBi} buy-ins); 5 % of runs dig at least {ddP95} deep. That's the hole you need to be prepared to sit in.",
    ru: "Плохие серии: типичное падение от пика до дна — {ddMean} (около {ddBi} байинов); 5 % ранов уходят минимум на {ddP95}. Это яма, в которой нужно уметь сидеть.",
  },
  "verdict.streak.dry": {
    en: "Dry stretches: on average the longest streak without progress is {be} {_tournament} and the longest streak without a cash is {cashless}; the worst cashless stretch hits {cashlessWorst}.",
    ru: "Сухие полосы: в среднем самая длинная серия без прогресса — {be} {_tournament}, самая длинная серия без призовых — {cashless}; в худшем случае серия без призовых доходит до {cashlessWorst}.",
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
    en: "You need roughly {n} {_tournament} before your true ROI is measured to ±5 %. Anything less is short-run noise.",
    ru: "Для замера истинного ROI с точностью ±5 % необходимо примерно {n} {_tournament}. Меньший объём — статистический шум.",
  },
  "verdict.precision.good": {
    en: "Run precision: ±{ci} on EV (±{rel} of the reported ROI). {samples} {_samples} is enough — pushing it higher barely tightens anything.",
    ru: "Точность рана: ±{ci} на EV (±{rel} от заявленного ROI). {samples} {_samples} — достаточный объём, увеличение даёт минимальный эффект.",
  },
  "verdict.precision.meh": {
    en: "Run precision: ±{ci} on EV (±{rel} of the reported ROI). To tighten to ±1 % you'd need ≈{need} {_need}.",
    ru: "Точность рана: ±{ci} на EV (±{rel} от заявленного ROI). Чтобы дотянуть до ±1 %, нужно ≈{need} {_need}.",
  },
  "verdict.precision.bad": {
    en: "Run precision: ±{ci} on EV — that's ±{rel} of the reported ROI, so the number is within MC noise. Bump samples to ≈{need} {_need} before trusting the sign.",
    ru: "Точность рана: ±{ci} на EV — это ±{rel} от заявленного ROI, результат в пределах MC-шума. Для надёжности знака необходимо ≈{need} {_need}.",
  },
  "verdict.vsPD": {
    en: "Versus PrimeDope: our ITM is {itmDiff} pp lower and average drawdown is {ddDiff} deeper. PrimeDope assumes skill lifts every paid place equally — we model it concentrating toward deeper finishes, which matches real samples.",
    ru: "По сравнению с PrimeDope: наш ITM на {itmDiff} пп ниже, а средний стрик глубже на {ddDiff}. PrimeDope считает, что скилл одинаково поднимает шансы на все призовые места — мы же моделируем концентрацию скилла в глубоких финишах, что совпадает с реальными выборками.",
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
    en: "Profit volatility per tournament",
    ru: "Волатильность профита на турнир",
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
    ru: "Средний максимум стрика",
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
    ru: "Плоский ITM переоценивает мелкие кеши и недооценивает долгие бесприбыльные полосы. Поэтому у них полосы безубытка короткие, а стрики мелкие — хвоста распределения там просто нет.",
  },
  "pdv.why3": {
    en: "We auto-fit the skill curve to your ROI, then resample every tournament with a skill-weighted distribution (power-law / stretched-exp / linear / empirical). The resulting profit swing is what the math actually says your schedule will do.",
    ru: "Кривая скилла автоматически подгоняется под заданный ROI. Каждый турнир ресэмплируется со скилл-взвешенным распределением (power-law / stretched-exp / линейная / эмпирическая). Получившийся разброс профита — то, что математика показывает для данного расписания.",
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
    en: "Measured on real pooled MTT data, ITM at 20% ROI sits near 17% — while PrimeDope's uniform-lift model predicts ~21%. This is corroboration from outside our codebase:",
    ru: "На реальных пулах MTT-данных ITM при ROI 20% держится около 17%, тогда как модель PrimeDope (uniform lift) предсказывает ~21%. Это подтверждение извне нашей кодовой базы:",
  },
  // Explainer (legacy, still referenced)
  "why.title": { en: "Why our numbers differ", ru: "Почему у нас цифры другие" },
  "why.body": {
    en: "PrimeDope models skill as a uniform lift over paid places: every paid finish gets the same bumped probability k/N. That's mathematically cleanest but wrong — real winners concentrate in deep finishes, not min-cashes. Our α-calibration fits a parametric skill model (power-law / stretched-exp / linear) so that cashes bias toward the top, reproducing the Muchomota 2024 observation that real-sample ITM sits ~3 pp below PrimeDope at 20% ROI. This matters for drawdowns too — flatter-ITM models understate swings.",
    ru: "PrimeDope моделирует скилл как плоский лифт по призовым: каждое призовое место получает одинаковый повышенный шанс k/N. Это математически чистенько, но неверно — настоящие скилл-игроки чаще заходят глубоко, а не на мин-кеше. Наша α-калибровка натягивает параметрическую модель (power-law / stretched-exp / линейная) так, чтобы кеши смещались к верху — это воспроизводит наблюдение Muchomota (2024), что реальный ITM на ~3 пп ниже, чем у PrimeDope при 20% ROI. Это бьёт и по стрикам — плоский ITM занижает свинги.",
  },
  // Preview
  "preview.title": { en: "Single tournament breakdown", ru: "Разбор одного турнира" },
  "preview.eyebrow": { en: "Single tournament", ru: "Один турнир" },
  "preview.youPay": { en: "Buy-in", ru: "Баин" },
  "preview.avgReturn": { en: "EV profit", ru: "EV профит" },
  "preview.evSplit": { en: "Gross EV", ru: "Брутто EV" },
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
  "preview.playersLabel": { en: "players", ru: "соперников" },
  "preview.itmLine": {
    en: "ITM {pct} (1 cash every {n} {_entry})",
    ru: "ITM {pct} (1 кеш в среднем на {n} {_entry})",
  },
  "preview.sigmaLabel": { en: "variance", ru: "диспа" },
  "preview.heroTitle": { en: "Where the average hides", ru: "Где прячется среднее" },
  "preview.heroBodyTop1": {
    en: "{share} of your expected return comes from 1st place — which you take 1\u00A0in\u00A0{odds} entries.",
    ru: "{share} ожидаемого дохода приходится на 1-е место, которое случается 1\u00A0раз\u00A0из\u00A0{odds} входов.",
  },
  "preview.heroBodyTopN": {
    en: "{share} of your expected return comes from top-{n} finishes — which happen 1\u00A0in\u00A0{odds} entries.",
    ru: "{share} всего ожидания приходит с топ-{n} финишей, а они случаются 1\u00A0раз\u00A0из\u00A0{odds}.",
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
  "preview.colEq": { en: "eq %", ru: "равн %" },
  "preview.colRoi": { en: "$ / entry", ru: "$ / вход" },
  "preview.evBreakdownTotal": { en: "ROI per entry", ru: "ROI на вход" },
  "preview.evBreakdownEq": {
    en: "At equilibrium (−rake)",
    ru: "В равновесии (−рейк)",
  },
  "preview.probTop1": { en: "1st place", ru: "1-е место" },
  "preview.probTop3": { en: "Top 3", ru: "Топ3" },
  "preview.probFt": { en: "Final table", ru: "Финалка" },
  "preview.probFirstCash": {
    en: "First min-cash (after bubble)",
    ru: "Первый мин-кеш (после бабла)",
  },
  "preview.probBubble": { en: "Bubble boy", ru: "Бабл-бой" },
  "preview.barEvLabel": { en: "share of EV", ru: "доля EV" },
  "preview.barFieldLabel": { en: "share of finishes", ru: "доля финишей" },
  "preview.tierWinner": { en: "1st place", ru: "1-е место" },
  "preview.tierTop3": { en: "2nd-3rd", ru: "2-3 места" },
  "preview.tierFt": { en: "4th-9th", ru: "4-9 места" },
  "preview.tierFtNonCash": { en: "5th-9th", ru: "5-9 места" },
  "preview.tierTop27": { en: "10th-27th", ru: "10-27 места" },
  "preview.tierRestItm": { en: "Rest of cashes", ru: "Остальные кеши" },
  "preview.tierOotm": { en: "Not ITM", ru: "Не ITM" },
  "preview.halfMass": {
    en: "Half your edge lives in the top {k} finishes of {n} — that's 1\u00A0in\u00A0{odds}.",
    ru: "Половина эджа сконцентрирована в топ-{k} местах из {n} — вероятность 1\u00A0к\u00A0{odds}.",
  },
  "preview.heroBodyFt": {
    en: "{share} of your expected return lives at the final table — which you reach 1\u00A0in\u00A0{odds} entries.",
    ru: "{share} ожидаемого дохода приходится на финальный стол, вероятность попадания — 1\u00A0из\u00A0{odds} входов.",
  },
  "preview.itmLocked": {
    en: "This row inherits the global ITM%. To override just this tournament, set its ITM% inside the schedule row.",
    ru: "Эта строка наследует глобальный ITM%. Чтобы переопределить его только для этого турнира, задай ITM% в самой строке расписания.",
  },
  "controls.itmTarget.label": {
    en: "Global ITM %",
    ru: "Глобальный ITM%",
  },
  "controls.itmTarget.hint": {
    en: "Default ITM% applied to every row that doesn't have its own override. Per-row ITM in the schedule always wins.",
    ru: "ITM% по умолчанию для всех строк без своего значения. Если в строке задан свой ITM%, он имеет приоритет.",
  },
  "controls.itmTarget.body": {
    en: "ROI is fixed by the schedule — ITM% only controls how bursty the profit curve looks. Same long-run EV, different clip. Leave blank in a row to inherit this default.",
    ru: "ROI фиксируется расписанием — ITM меняет только «рваность» графика. Долгосрочное EV то же, меняется лишь частота заносов. Оставь поле пустым в строке, чтобы применить этот дефолт.",
  },
  "controls.rakeback.label": {
    en: "Rakeback %",
    ru: "Рейкбек %",
  },
  "controls.rakeback.title": {
    en: "Global rakeback — % of paid rake credited back after every entry. Added deterministically to each bullet's profit ((rb%/100) × row.rake × row.buyIn), so re-entries also earn rakeback. Pure mean shift: trajectories lift, σ and convergence are untouched.",
    ru: "Глобальный рейкбек — % от уплаченного рейка, возвращаемый после каждого входа. Прибавляется детерминированно к профиту каждого bullet-а ((rb%/100) × рейк × бай-ин), так что ре-энтри тоже даёт рейкбек. Чистый сдвиг среднего: график поднимается, σ и сходимость не меняются.",
  },
  "controls.rakeback.avgBr": {
    en: "40% BR ref",
    ru: "40% BR",
  },
  "controls.rakeback.avgBrTitle": {
    en: "Set the rough Battle Royale regulars reference: 40% of paid rake returned as rakeback.",
    ru: "Поставить примерный ориентир регов Battle Royale: 40% уплаченного рейка возвращается рейкбеком.",
  },
  "preview.footnote": {
    en: "If the top (EV) bar is much wider than the bottom (finishes) bar in the same colour, that slice of finishes carries way more money than its share of the field — and that's exactly where your variance lives.",
    ru: "Если верхний (EV) бар в каком-то цвете сильно шире нижнего (финиши) — этот кусок финишей приносит непропорционально больше денег. Именно там сконцентрирована дисперсия.",
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

  // Sensitivity
  "sens.configured": { en: "configured", ru: "заданный" },
  "sens.note": {
    en: "Linear under the α calibration — shows how brittle EV is to ROI misestimation.",
    ru: "Линейно при α-калибровке — показывает, насколько EV зависит от ошибки в ROI.",
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
  "help.scheduleRepeats": {
    en: "Target distance inside one simulated sample. The app rounds up to full schedule repeats: if the schedule has 47 tournaments and you ask for 1,000, the engine runs 22 repeats = 1,034 tournaments/sample.",
    ru: "Целевая дистанция внутри одного сэмпла. Приложение округляет вверх до целых повторов расписания: если в расписании 47 турниров, а нужно 1 000, движок запустит 22 повтора = 1 034 турнира/сэмпл.",
  },
  "help.samples": {
    en: "How many alternative futures to simulate. More = smoother tails and worst-case numbers, slower to compute. 5k is quick, 50k is overkill-nice.",
    ru: "Сколько альтернативных вариантов прогнать. Больше — точнее хвосты и худшие раны, но дольше. 5k — быстро, 50k — с запасом.",
  },
  "help.compareMode": {
    en: "What to put on the right side of the trajectory chart.\n\n• Two random runs — the same model rolled twice with different seeds. Shows how wildly two honest runs of the same setup can diverge.\n• Ours vs PrimeDope — our calibrated model on the left, PrimeDope's uniform-lift on the right, both on the same seed. Shows how the algorithm choice changes the answer on identical randomness.",
    ru: "Что показать справа от траектории.\n\n• Два рандомных рана — одна и та же модель прокатывается дважды с разными сидами. Видно, насколько могут разойтись два честных рана одного и того же сетапа.\n• Наш vs PrimeDope — наша калиброванная модель слева, PrimeDope'овский uniform-lift справа, оба на одном сиде. Видно, как выбор алгоритма меняет ответ на одинаковом рандоме.",
  },
  "help.bankroll": {
    en: "Current bankroll in $. Enables risk-of-ruin, Kelly BR, and log-growth. 0 = skip ruin math. Adds a −bankroll line on the trajectory; any sample crossing it counts as ruined.",
    ru: "Текущий банкролл в $. Включает риск разорения, Kelly-БР и log-growth. 0 = отключить ruin-математику. На графике появится линия −банкролл; пересёкший её сэмпл считается разорённым.",
  },
  "help.finishModel": {
    en: "How your skill distributes across finish places — does it mostly show up as deep runs, or as lots of small cashes?\n\nOptions:\n• Power-law — skill pays off deep; the closer to 1st, the bigger the lift. (default, best match to real samples)\n• Linear skill — steady lift toward the top, less dramatic\n• Stretched-exp — middle ground between those two\n• Plackett–Luce — classic ranking model, mathematically sound\n• Uniform — every paid place gets the same lift (PrimeDope-style — understates swings)\n• Empirical — built from a CSV of your own real finish history",
    ru: "Как скилл распределяется по местам: глубокие финиши или много мин-кешей?\n\nОпции:\n• Power-law — скилл работает в глубоких финишах; чем ближе к 1-му, тем сильнее лифт (дефолт, лучше всего ложится на реальные выборки)\n• Linear skill — плавный лифт к топу, менее драматичный\n• Stretched-exp — промежуточный вариант\n• Plackett–Luce — классическая модель ранжирования, математически чистая\n• Uniform — все призовые получают одинаковый буст (как у PrimeDope — занижает свинги)\n• Empirical — по CSV реальных финишей",
  },
  "help.alphaOverride": {
    en: "Force skill-curve sharpness by hand instead of fitting to target ROI. Blank = auto. 1.0 neutral, 2.0 = aggressive concentration near 1st. Advanced — fixes curve shape and deliberately misses ROI.",
    ru: "Жёстко задать крутизну кривой скилла вместо автоподгонки под ROI. Пусто = авто. 1.0 — нейтрально, 2.0 — агрессивная концентрация у 1-го. Продвинутое: фиксирует форму кривой и сознательно промахивается по ROI.",
  },
  "help.seed": {
    en: "Starting point for the RNG — same seed = same result. Change it for a different sample on the same schedule; keep it fixed to compare tweaks.",
    ru: "Стартовая точка ГПСЧ — один сид = идентичный результат. Новый сид — новая выборка; фиксированный — для сравнения правок.",
  },
  "help.roiStdErr": {
    en: "How uncertain you are about your real ROI, as a fraction. 0.05 = \"my true ROI is maybe ±5 pp off\". 0 = you know ROI exactly (PrimeDope's assumption). On each run the engine rolls a random skill shift applied to every bullet — the biggest source of bad-tail swings PrimeDope ignores.",
    ru: "Неопределённость в истинном ROI (как доля). 0.05 = «реальный ROI может быть ±5 пп от заданного». 0 = ROI известен точно (допущение PrimeDope). На каждом ране движок генерирует случайный сдвиг скилла на все пули — основной источник хвостовых стриков, который PrimeDope игнорирует.",
  },
  "help.roiShockPerTourney": {
    en: "Per-tournament ROI shock (σ). Every tourney independently rolls softer/tougher than average. 0.30 = each tourney's effective ROI is target ± 30 pp (1σ). Adds variance without moving long-run mean — a chunk PrimeDope misses.",
    ru: "Шок ROI на каждый турнир (σ). Каждый турнир независимо получает поле слабее/сильнее среднего. 0.30 = эффективный ROI турнира = таргет ± 30 пп (1σ). Добавляет дисперсию, не двигая среднее — часть, которую PrimeDope упускает.",
  },
  "help.roiShockPerSession": {
    en: "Per-session ROI shock (σ). One shift applied to ALL tournaments in the same schedule pass — \"today I'm in form / off form\". 0.05 = typical-day effective ROI is target ± 5 pp. Explains daily swings too large for independent tournaments.",
    ru: "Шок ROI на сессию (σ). Один сдвиг применяется ко ВСЕМ турнирам одного прохода — «сегодня я в форме / не в форме». 0.05 = эффективный ROI дня = таргет ± 5 пп. Объясняет дневные свинги, слишком большие для независимых турниров.",
  },
  "help.roiDriftSigma": {
    en: "Long-term ROI drift σ (AR1, ρ ≈ 0.95). Slow random walk with memory, advanced once per session — meta shifts, seasonality, multi-month drift. 0.02 = underlying ROI drifts ~2 pp over many sessions then mean-reverts.",
    ru: "Медленный дрейф ROI (σ, AR1 ρ ≈ 0.95). Медленное блуждание с памятью, раз в сессию — мета-сдвиги, сезонность, многомесячный дрейф. 0.02 = реальный ROI тихо дрейфует на ~2 пп за много сессий и возвращается.",
  },
  "help.tiltFastGain": {
    en: "FAST tilt — smooth, immediate ROI shift from current drawdown: shift = −gain × tanh(dd / scale). gain −0.30 + scale $5k → −23 pp at $5k dd, −30 pp at $15k. Negative = play worse under pressure (typical). 0 = off.",
    ru: "БЫСТРЫЙ тильт — плавный мгновенный сдвиг ROI от текущего dd: сдвиг = −gain × tanh(dd/scale). gain −0.30 + scale $5k → −23 пп при dd $5k, −30 пп при $15k. Отрицательный = играешь хуже под минусом (обычный тильтун). 0 = выкл.",
  },
  "help.tiltFastScale": {
    en: "Drawdown depth at which the fast-tilt shift reaches ≈76% of max. Smaller = more sensitive.",
    ru: "Глубина dd, на которой быстрый тильт достигает ≈76% от максимума. Меньше = чувствительнее.",
  },
  "help.tiltSlowGain": {
    en: "SLOW tilt — state machine with hysteresis. After min-duration tourneys past the threshold you enter DOWN/UP-TILT (ROI shifted by ±gain) and only exit after climbing back recovery-frac of the swing. 0 = off. For stable regs whose play breaks only on long deep stretches.",
    ru: "МЕДЛЕННЫЙ тильт — автомат с гистерезисом. После min-длительности за порогом входишь в DOWN/UP-TILT (ROI сдвинут на ±gain) и выходишь только когда отыграл recovery-frac стрика. 0 = выкл. Для стабильных регов, чья игра проседает лишь на долгих глубоких отрезках.",
  },
  "help.tiltSlowThreshold": {
    en: "Dollar drawdown (or upswing) depth required to start the slow-tilt countdown. Smaller = easier to enter tilt.",
    ru: "Глубина стрика (или апсвинга) в долларах для запуска отсчёта медленного тильта. Меньше = легче войти в тильт.",
  },
  "help.tiltSlowMinDuration": {
    en: "Number of tournaments you must stay past the threshold before slow-tilt actually engages. Defaults to 500. Short streaks (< this) don't matter — only sustained ones do.",
    ru: "Сколько турниров подряд нужно сидеть за порогом, чтобы медленный тильт реально включился. По умолчанию 500. Короткие стрики (< этого) не влияют — только устойчивые.",
  },
  "help.compare": {
    en: "Runs a second simulation on the same seed with PrimeDope's uniform-lift calibration. Two trajectory charts side-by-side + a full diff table. Roughly doubles run time.",
    ru: "Запускает вторую симуляцию на том же сиде с калибровкой PrimeDope (uniform-lift). Два графика бок-о-бок + таблица расхождений. Время рана удваивается.",
  },
  "help.empirical": {
    en: "Paste or upload finishing positions from your real history (one per line or comma-separated, e.g. 47, 132, 8, 501). The simulator builds a histogram and resamples from it — no parametric model, no α calibration.",
    ru: "Вставь или загрузи список финишных мест из реальной истории (по строке или через запятую, напр. 47, 132, 8, 501). Симулятор строит гистограмму и сэмплирует из неё — без параметрической модели и α-калибровки.",
  },

  // Help tooltips — schedule editor columns
  "help.row.label": {
    en: "Free-form name for the row. Cosmetic only — doesn't affect the math.",
    ru: "Произвольное название строки. Чисто косметика — на расчёт не влияет.",
  },
  "help.row.players": {
    en: "Field size — how many entrants register. Sets the places (1..N) the finish-model samples from and scales the prize pool.",
    ru: "Размер поля — сколько игроков заявлено. Задаёт места (1..N) для финиш-модели и масштабирует призовой.",
  },
  "help.row.buyIn": {
    en: "Buy-in in poker format. \"50+5\" = $50 buy-in + $5 rake (before \"+\" goes to pool, after is the room's fee). Just \"50\" keeps the current rake. Real entry cost = buyIn + rake. Note on convention: the rake % we show is fee ÷ net buy-in, not fee ÷ total ticket. Entering \"9.20+0.80\" displays as 8.7% rake ($0.80 ÷ $9.20) even though your room calls the same fee 8% of the $10 ticket — same dollars, different denominator.",
    ru: "Бай-ин в покерном формате. «50+5» = $50 бай-ин + $5 рейк (до «+» идёт в призовой, после — комиссия рума). Просто «50» оставляет текущий рейк. Реальная цена входа = buyIn + rake. О конвенции: рейк в % считается от чистого бай-ина, а не от полного тикета. «9.20+0.80» показывается как 8.7% рейк ($0.80 ÷ $9.20), хотя в руме ту же сумму называют 8% от $10 тикета — сумма та же, знаменатель другой.",
  },
  "help.row.rake": {
    en: "Rake as % of buy-in — the room's cut. 5% majors, 7% high stakes, 10% soft regulars, 12% micros. Pure drag on ROI. Convention: % is of net buy-in (before +), not of total ticket. Room quoting \"8% rake on $10\" means $0.80 fee, which here shows as 8.7% ($0.80 ÷ $9.20 net).",
    ru: "Рейк в % от бай-ина — доля рума. 5% мажоры, 7% хайстейкс, 10% мягкие регуляры, 12% микро. Чистый минус к ROI. Конвенция: % от чистого бай-ина (до «+»), а не от полного тикета. Рум, говорящий «8% рейк на $10», имеет в виду $0.80 фи — у нас это отображается как 8.7% ($0.80 ÷ $9.20 чистыми).",
  },
  "help.row.roi": {
    en: "Target poker ROI before global rakeback, as a % of full ticket cost: profit ÷ (buy-in × (1+rake)). Global rakeback is added separately as a deterministic shift. For Battle Royale rows only, the small RB helper converts a reported ROI with rakeback into this pre-rakeback field.",
    ru: "Целевой покерный ROI до глобального рейкбека, считается от полной стоимости входа: прибыль ÷ (бай-ин × (1+рейк)). Глобальный рейкбек добавляется отдельно детерминированным сдвигом. Только у строк Battle Royale маленький RB-помощник переводит reported ROI с рейкбеком в это поле до рейкбека.",
  },
  "help.row.payouts": {
    en: "Shape of the prize ladder. Standard ~15% ITM, Flat ~20% (shallower top), Top-heavy ~12% (steeper), plus real captured curves (PokerStars / GG / Sunday Million / Bounty Builder). WTA = 100% to 1st. Custom = your own %.",
    ru: "Форма призовой сетки. Standard ~15% ITM, Flat ~20% (плоский топ), Top-heavy ~12% (крутой), плюс реальные кривые (PokerStars / GG / Sunday Million / Bounty Builder). WTA = 100% победителю. Custom = свои %.",
  },
  "help.row.count": {
    en: "Bullets of this tourney per session. NOT re-entries — re-entry rate is a separate advanced field (rebuys inside the same tourney). Fractions allowed, stochastically rounded.",
    ru: "Сколько пуль этого турнира за сессию. Это НЕ ре-энтри — ре-энтри настраивается отдельно (перезаходы внутри того же турнира). Дроби допустимы, округляем стохастически.",
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

  // Cash-game mode (advanced only)
  "mode.tab.mtt": { en: "MTT", ru: "Турниры" },
  "mode.tab.cash": { en: "Cash", ru: "Кэш" },
  "cash.section.inputs.title": { en: "Cash inputs", ru: "Параметры кэша" },
  "cash.section.results.title": { en: "Cash results", ru: "Результаты кэша" },
  "cash.group.session": { en: "Session", ru: "Сессия" },
  "cash.group.rake": { en: "Rakeback", ru: "Рейкбек" },
  "cash.group.hourly": { en: "Hourly lens", ru: "Почасовка" },
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
  "cash.stakes.refBbHint": {
    en: "Top-level BB size is the reference denomination for bankroll. Rows with larger BB scale up proportionally.",
    ru: "Верхний BB — это базовая валюта банкролла. Строки с большим BB скейлятся вверх пропорционально.",
  },
  "cash.group.stats.expected": { en: "Expected", ru: "Ожидание" },
  "cash.group.stats.realized": { en: "Realized", ru: "Реализация" },
  "cash.group.stats.risk": { en: "Risk", ru: "Риски" },
  "cash.group.stats.economics": { en: "Economics", ru: "Экономика" },
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
  "cash.hours.enabled.label": { en: "Hourly lens", ru: "Почасовка" },
  "cash.hours.handsPerHour.label": {
    en: "Hands / hour",
    ru: "Раздач в час",
  },
  "cash.run": { en: "Run simulation", ru: "Запустить симуляцию" },
  "cash.running": { en: "Running…", ru: "Считаем…" },
  "cash.stats.expectedEvBb": { en: "Expected EV (BB)", ru: "Ожидаемый EV (BB)" },
  "cash.stats.meanFinalBb": {
    en: "Mean final (BB)",
    ru: "Средний финал (BB)",
  },
  "cash.stats.sdFinalBb": { en: "SD final (BB)", ru: "SD финала (BB)" },
  "cash.stats.probLoss": { en: "P(loss)", ru: "P(убыток)" },
  "cash.stats.probSub100Bb": {
    en: "P(min ≤ -100 BB)",
    ru: "P(min ≤ -100 BB)",
  },
  "cash.stats.recoveryUnrecoveredShare": {
    en: "Unrecovered share",
    ru: "Не откатились",
  },
  "cash.stats.hourlyEvUsd": { en: "EV / hour", ru: "EV / час" },
  "cash.stats.meanRakePaidBb": {
    en: "Rake paid (BB)",
    ru: "Заплачено рейка (BB)",
  },
  "cash.stats.meanRbEarnedBb": {
    en: "RB earned (BB)",
    ru: "Рейкбек получен (BB)",
  },
  "cash.chart.trajectory.title": {
    en: "Bankroll trajectory",
    ru: "Траектория банкролла",
  },
  "cash.chart.final.title": {
    en: "Final bankroll distribution",
    ru: "Распределение финального BR",
  },
  "cash.chart.drawdown.title": { en: "Max drawdown", ru: "Max просадка" },
  "cash.empty": {
    en: "Press Run to simulate the cash session.",
    ru: "Нажми «Запустить», чтобы посчитать кэш-сессию.",
  },
} as const satisfies Record<string, Entry>;

export type DictKey = keyof typeof DICT;
