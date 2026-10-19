import type { Locale } from "./dict";

const PR_RU = new Intl.PluralRules("ru");
const PR_EN = new Intl.PluralRules("en");
const PR_EN_ORDINAL = new Intl.PluralRules("en", { type: "ordinal" });
const EN_ORDINAL_SUFFIX = { one: "st", two: "nd", few: "rd", other: "th" } as const;

export interface PluralForms {
  en: { one: string; other: string };
  ru: { one: string; few: string; many: string };
}

export function plural(
  locale: Locale,
  n: number,
  forms: PluralForms,
): string {
  const abs = Math.abs(Math.trunc(n));
  if (locale === "ru") {
    const cat = PR_RU.select(abs);
    if (cat === "one") return forms.ru.one;
    if (cat === "few") return forms.ru.few;
    return forms.ru.many;
  }
  const cat = PR_EN.select(abs);
  return cat === "one" ? forms.en.one : forms.en.other;
}

// Shared plural tables for nouns that appear in dict templates. Keys line
// up with the {_noun} placeholders used in dict strings; `withPlural` fills
// one in from the count printed beside it. The Russian forms are the
// nominative ones, so a template puts the number where the noun can stand in
// the nominative ("{n} {_run}", "длилась {n} {_tournament}") or words the
// sentence so no case is needed ("горизонт: {n} {_tournament}").
export const WORDS = {
  tournament: {
    en: { one: "tournament", other: "tournaments" },
    ru: { one: "турнир", few: "турнира", many: "турниров" },
  },
  entry: {
    en: { one: "entry", other: "entries" },
    ru: { one: "вход", few: "входа", many: "входов" },
  },
  seat: {
    en: { one: "seat", other: "seats" },
    ru: { one: "место", few: "места", many: "мест" },
  },
  place: {
    en: { one: "place", other: "places" },
    ru: { one: "место", few: "места", many: "мест" },
  },
  person: {
    en: { one: "person", other: "people" },
    ru: { one: "человек", few: "человека", many: "человек" },
  },
  sample: {
    en: { one: "sample", other: "samples" },
    ru: { one: "сэмпл", few: "сэмпла", many: "сэмплов" },
  },
  preset: {
    en: { one: "preset", other: "presets" },
    ru: { one: "пресет", few: "пресета", many: "пресетов" },
  },
  time: {
    en: { one: "time", other: "times" },
    ru: { one: "раз", few: "раза", many: "раз" },
  },
  finish: {
    en: { one: "finish", other: "finishes" },
    ru: { one: "финиш", few: "финиша", many: "финишей" },
  },
  run: {
    en: { one: "run", other: "runs" },
    ru: { one: "ран", few: "рана", many: "ранов" },
  },
} as const satisfies Record<string, PluralForms>;

/** Fills the `{_word}` placeholder of a dict template with the form that agrees with `n`. */
export function withPlural(
  template: string,
  locale: Locale,
  n: number,
  word: keyof typeof WORDS,
): string {
  return template.replaceAll(`{_${word}}`, plural(locale, n, WORDS[word]));
}

/** A finishing place as a short ordinal: `1st`, `22nd`, `111th` in English, `1-е` in Russian. */
export function ordinalPlace(locale: Locale, n: number): string {
  if (locale === "ru") return `${n}-е`;
  return `${n}${EN_ORDINAL_SUFFIX[PR_EN_ORDINAL.select(n) as keyof typeof EN_ORDINAL_SUFFIX]}`;
}
