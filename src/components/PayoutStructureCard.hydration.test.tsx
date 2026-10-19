import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import type { TournamentRow } from "@/lib/sim/types";
import { PayoutStructureCard, loadPayoutPalette, savePayoutPalette } from "./PayoutStructureCard";

// Saved choices from before this test exist under this key.
const PALETTE_STORAGE_KEY = "tvs.payoutPalette";

const row: TournamentRow = {
  id: "a",
  label: "a",
  players: 500,
  buyIn: 20,
  rake: 0.1,
  roi: 0.1,
  payoutStructure: "mtt-standard",
  count: 1,
};

let store: Record<string, string> = {};
const globals = globalThis as { window?: unknown; localStorage?: unknown };

beforeEach(() => {
  store = {};
  globals.window = {};
  globals.localStorage = {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
  };
});
afterEach(() => {
  delete globals.window;
  delete globals.localStorage;
});

const MEDAL_FIRST_PLACE = "hsl(45, 90%, 55%)";

describe("payout bar palette and hydration", () => {
  it("renders the default palette on the first pass even when another one is stored", () => {
    store[PALETTE_STORAGE_KEY] = "ocean";
    const markup = renderToStaticMarkup(
      <LocaleProvider>
        <PayoutStructureCard schedule={[row]} />
      </LocaleProvider>,
    );
    expect(markup).toContain(MEDAL_FIRST_PLACE);
    expect(markup).toMatch(/<option value="medal"[^>]*selected/);
    expect(markup).not.toContain("hsla(185");
  });

  it("reads a stored palette after mount, and ignores anything it does not know", () => {
    store[PALETTE_STORAGE_KEY] = "ocean";
    expect(loadPayoutPalette()).toBe("ocean");
    store[PALETTE_STORAGE_KEY] = "rainbow";
    expect(loadPayoutPalette()).toBe("medal");
    delete store[PALETTE_STORAGE_KEY];
    expect(loadPayoutPalette()).toBe("medal");
  });

  it("writes the choice under the same key", () => {
    savePayoutPalette("heat");
    expect(store[PALETTE_STORAGE_KEY]).toBe("heat");
  });
});
