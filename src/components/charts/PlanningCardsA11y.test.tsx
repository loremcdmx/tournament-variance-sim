import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DICT } from "@/lib/i18n/dict";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { fmtAfs } from "@/lib/sim/convergenceMath";
import type { ItmTargetConfig } from "@/lib/sim/itmTarget";
import type { TournamentRow } from "@/lib/sim/types";
import { ConvergenceChart } from "./ConvergenceChart";
import { ProveEdgeCard } from "./ProveEdgeCard";

const OFF: ItmTargetConfig = { enabled: false, pct: 0 };
const render = (node: React.ReactNode) =>
  renderToStaticMarkup(<LocaleProvider>{node}</LocaleProvider>);
const sliders = (markup: string) =>
  (markup.match(/<input\b[^>]*>/g) ?? []).filter((tag) => tag.includes('type="range"'));

const schedule: TournamentRow[] = [
  {
    id: "r", label: "r", players: 5000, buyIn: 10, rake: 0.1, roi: 0.1,
    payoutStructure: "mtt-standard", gameType: "freezeout", count: 100,
  },
];

// The slider's value is a 0-1 position on a log scale; read aloud it is "0.353".
describe("AFS sliders say the field size", () => {
  it("on the convergence card", () => {
    const markup = render(<ConvergenceChart schedule={schedule} itmTarget={OFF} />);
    const [afs] = sliders(markup).filter((tag) => tag.includes('aria-label="AFS"'));
    expect(afs).toBeDefined();
    expect(afs).toContain(`aria-valuetext="${fmtAfs(5000, "ru-RU")}"`);
  });

  it("on the prove-edge card", () => {
    const markup = render(<ProveEdgeCard itmTarget={OFF} />);
    const [afs] = sliders(markup).filter((tag) =>
      tag.includes(`aria-label="${DICT["proveEdge.label.fieldSize"].ru}"`),
    );
    expect(afs).toBeDefined();
    expect(afs).toContain(`aria-valuetext="${fmtAfs(200, "ru-RU")}"`);
  });
});

// At 320 CSS px the card is about 250 px wide. A flex row cannot shrink a range
// input below its 129 px intrinsic width unless min-width is 0, and a fixed
// w-32 nowrap caption takes half of what is left.
describe("slider rows fit a 320 px screen", () => {
  it("lets every range input shrink inside a flex row", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const rule = css.match(/input\[type="range"\]\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/min-width:\s*0\b/);
  });

  it("does not pin the prove-edge captions to a wide nowrap column", () => {
    const markup = render(<ProveEdgeCard itmTarget={OFF} />);
    expect(markup).not.toContain("w-32 shrink-0 whitespace-nowrap");
  });
});

const buttons = (markup: string) => markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
const attr = (tag: string, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
const FORMAT_LABELS = ["freeze", "pko", "ocean-ko", "mystery", "mystery-royale", "mix", "exact"] as const;

describe("format tabs say which one is selected", () => {
  const formatButtons = (markup: string) =>
    buttons(markup).filter((tag) =>
      FORMAT_LABELS.some((f) => tag.includes(`>${DICT[`chart.convergence.format.${f}`].ru}</button>`)),
    );

  it("on the convergence card", () => {
    const tabs = formatButtons(render(<ConvergenceChart schedule={schedule} itmTarget={OFF} />));
    expect(tabs).toHaveLength(FORMAT_LABELS.length);
    expect(tabs.map((tag) => attr(tag, "aria-pressed"))).toEqual(
      FORMAT_LABELS.map((f) => (f === "exact" ? "false" : f === "freeze" ? "true" : "false")),
    );
  });

  it("on the prove-edge card", () => {
    const tabs = buttons(render(<ProveEdgeCard itmTarget={OFF} />)).filter((tag) =>
      tag.includes("uppercase tracking-wider"),
    );
    expect(tabs.length).toBeGreaterThanOrEqual(2);
    expect(tabs.filter((tag) => attr(tag, "aria-pressed") === "true")).toHaveLength(1);
    expect(tabs.every((tag) => attr(tag, "aria-pressed") !== undefined)).toBe(true);
  });
});

// A reset button says where it lands. The schedule's own figure is not where it
// lands when the control's range cuts it off, and the text is the UI language.
describe("convergence reset buttons", () => {
  const resets = (markup: string) =>
    buttons(markup).filter((tag) => />↺<\/button>$/.test(tag));
  const ranged = (over: Partial<TournamentRow>): TournamentRow[] => [{ ...schedule[0], ...over }];

  it("name the target in Russian, as the button's title and its accessible name", () => {
    const found = resets(render(<ConvergenceChart schedule={schedule} itmTarget={OFF} />));
    expect(found.length).toBe(5);
    for (const tag of found) {
      expect(attr(tag, "title")).toBeDefined();
      expect(attr(tag, "aria-label")).toBe(attr(tag, "title"));
      expect(attr(tag, "title")).toMatch(/^Сбросить к /);
      expect(attr(tag, "title")).not.toMatch(/reset to/i);
    }
    const titles = found.map((tag) => attr(tag, "title"));
    expect(titles).toContain("Сбросить к 95%");
    expect(titles).toContain("Сбросить к Фриз");
  });

  it("quote the value the reset applies when the schedule lies outside the range", () => {
    const small = resets(render(
      <ConvergenceChart schedule={ranged({ players: 18, roi: 1.5 })} itmTarget={OFF} />,
    )).map((tag) => attr(tag, "title"));
    expect(small).toContain("Сбросить к 50 (в расписании 18 — вне диапазона этой карточки)");
    expect(small).toContain("Сбросить к 100.0% (в расписании 150.0% — вне диапазона этой карточки)");
  });

  it("stay plain when the schedule is inside the range", () => {
    const inside = resets(render(
      <ConvergenceChart schedule={ranged({ players: 1000, roi: 0.15 })} itmTarget={OFF} />,
    )).map((tag) => attr(tag, "title"));
    expect(inside).toContain(`Сбросить к ${fmtAfs(1000, "ru-RU")}`);
    expect(inside).toContain("Сбросить к 15.0%");
    expect(inside.join("|")).not.toContain("вне диапазона");
  });
});
