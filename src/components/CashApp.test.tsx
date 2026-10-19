import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { DICT } from "@/lib/i18n/dict";
import { MAX_TOTAL_SIM_HANDS } from "@/lib/sim/cashInput";
import { CashApp } from "./CashApp";

const markup = renderToStaticMarkup(
  <LocaleProvider>
    <CashApp />
  </LocaleProvider>,
);
const ruCount = (n: number) => n.toLocaleString("ru-RU");

describe("cash inputs form", () => {
  it("gives every on/off switch an accessible name", () => {
    const switches = [...markup.matchAll(/<button[^>]*role="switch"[^>]*>/g)];
    expect(switches.length).toBe(3);
    const names = switches.map(([tag]) => tag.match(/aria-label="([^"]+)"/)?.[1]);
    expect(names).toEqual([
      DICT["cash.group.hourly"].ru,
      DICT["cash.group.stakes"].ru,
      DICT["cash.group.rake"].ru,
    ]);
  });

  it("explains the shared hands x simulations budget under both fields", () => {
    const handsHint = DICT["cash.hands.budgetHint"].ru
      .replace("{max}", ruCount(100_000))
      .replace("{sims}", ruCount(2_000))
      .replace("{total}", ruCount(MAX_TOTAL_SIM_HANDS));
    const simsHint = DICT["cash.nSimulations.budgetHint"].ru
      .replace("{max}", ruCount(2_000))
      .replace("{hands}", ruCount(100_000))
      .replace("{total}", ruCount(MAX_TOTAL_SIM_HANDS));

    expect(markup).toContain(handsHint);
    expect(markup).toContain(simsHint);
  });

  it("shows no failure banner before any run", () => {
    expect(markup).not.toContain('role="alert"');
  });
});
