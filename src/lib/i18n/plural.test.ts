import { describe, expect, it } from "vitest";
import { DICT, type DictKey } from "./dict";
import { ordinalPlace, plural, withPlural, WORDS } from "./plural";

describe("plural", () => {
  it.each([
    [0, "турниров"],
    [1, "турнир"],
    [2, "турнира"],
    [4, "турнира"],
    [5, "турниров"],
    [11, "турниров"],
    [12, "турниров"],
    [21, "турнир"],
    [22, "турнира"],
    [101, "турнир"],
    [111, "турниров"],
    [1000, "турниров"],
  ])("agrees the Russian noun with %i", (n, word) => {
    expect(plural("ru", n, WORDS.tournament)).toBe(word);
  });

  it("keeps the English singular for exactly one", () => {
    expect(plural("en", 1, WORDS.run)).toBe("run");
    expect(plural("en", 0, WORDS.run)).toBe("runs");
    expect(plural("en", 2, WORDS.run)).toBe("runs");
  });

  it("has Russian forms for a run", () => {
    expect([1, 2, 5, 21].map((n) => plural("ru", n, WORDS.run))).toEqual([
      "ран",
      "рана",
      "ранов",
      "ран",
    ]);
  });
});

describe("withPlural", () => {
  it("replaces the {_word} placeholder with the form that agrees with the count", () => {
    expect(withPlural("{n} {_run}", "ru", 1, "run")).toBe("{n} ран");
    expect(withPlural("{n} {_run}", "ru", 3, "run")).toBe("{n} рана");
    expect(withPlural("{n} {_run}", "en", 1, "run")).toBe("{n} run");
  });

  it("leaves a template without the placeholder alone", () => {
    expect(withPlural("{n} things", "en", 1, "run")).toBe("{n} things");
  });
});

describe("ordinalPlace", () => {
  it("writes English ordinals, including the teens and 21-23", () => {
    const text = [1, 2, 3, 4, 9, 11, 12, 13, 21, 22, 23, 101, 111].map((n) =>
      ordinalPlace("en", n),
    );
    expect(text).toEqual([
      "1st", "2nd", "3rd", "4th", "9th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th",
    ]);
  });

  it("writes Russian ordinals with the neuter ending of 'место'", () => {
    expect([1, 2, 3, 9, 21].map((n) => ordinalPlace("ru", n))).toEqual([
      "1-е", "2-е", "3-е", "9-е", "21-е",
    ]);
  });
});

// A count printed next to a noun must agree with it in both languages: every
// template that carries a `{_word}` placeholder fills it from the count beside it.
describe("dict templates with a counted noun", () => {
  const COUNTED: DictKey[] = [
    "pd.report.probLoss",
    "pd.delta.tournaments",
    "stat.probProfit.sub",
    "stat.riskOfRuin.horizon",
    "chart.traj.ddDuration",
    "chart.traj.legend.runs",
    "chart.brLeaderboardObserved.rowLine",
    "chart.brLeaderboardObserved.observedMixLine",
  ];

  it.each(COUNTED)("%s takes its noun from a placeholder, not a fixed form", (key) => {
    for (const locale of ["en", "ru"] as const) {
      const text = DICT[key][locale];
      expect(text, `${key}.${locale}`).toMatch(/\{_(tournament|run)\}/);
      expect(text, `${key}.${locale}`).not.toMatch(/\}\s+(турниров|ранов|tournaments|runs)\b/);
    }
  });

  it.each([
    ["chart.traj.ddDuration", { n: "21" }, "tournament", 21, "длилась 21 турнир", "lasted 21 tournaments"],
    ["chart.traj.ddDuration", { n: "2" }, "tournament", 2, "длилась 2 турнира", "lasted 2 tournaments"],
    ["chart.traj.ddDuration", { n: "1" }, "tournament", 1, "длилась 1 турнир", "lasted 1 tournament"],
    ["chart.traj.legend.runs", { n: "1" }, "run", 1, "1 ран", "1 run"],
    ["chart.traj.legend.runs", { n: "2" }, "run", 2, "2 рана", "2 runs"],
    ["chart.traj.legend.runs", { n: "1,000" }, "run", 1000, "1,000 ранов", "1,000 runs"],
  ] as const)("renders %s with %j", (key, vars, word, n, ru, en) => {
    const fill = (locale: "en" | "ru") =>
      withPlural(DICT[key][locale], locale, n, word).replace(/\{(\w+)\}/g, (_, k) => vars[k as "n"]);
    expect(fill("ru")).toBe(ru);
    expect(fill("en")).toBe(en);
  });
});
