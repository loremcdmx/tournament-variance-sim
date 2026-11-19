import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DICT } from "@/lib/i18n/dict";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import type { TournamentRow } from "@/lib/sim/types";
import { PayoutStructureCard } from "./PayoutStructureCard";

const row: TournamentRow = {
  id: "a", label: "a", players: 500, buyIn: 50, rake: 0.1, roi: 0.2,
  payoutStructure: "mtt-gg-freeze", count: 1,
};

const render = (primeDopePreset: boolean) =>
  renderToStaticMarkup(
    <LocaleProvider>
      <PayoutStructureCard schedule={[row]} primeDopePreset={primeDopePreset} />
    </LocaleProvider>,
  );

describe("PayoutStructureCard under the Like PrimeDope preset", () => {
  it("says the table is the row's own, only while the preset is on", () => {
    const note = DICT["payouts.primedopeNote"].ru;
    expect(render(true)).toContain(note);
    expect(render(false)).not.toContain(note);
  });

  it("ties PrimeDope's table to its toggle, which the user can turn off", () => {
    expect(DICT["payouts.primedopeNote"].en).toMatch(/with "PD payout curves" on, pays PrimeDope's table/);
    expect(DICT["payouts.primedopeNote"].ru).toContain("с включёнными «Пейаутами ПД»");
  });
});
