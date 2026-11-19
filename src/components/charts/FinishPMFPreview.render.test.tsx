import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DICT } from "@/lib/i18n/dict";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { AdvancedModeProvider } from "@/lib/ui/AdvancedModeProvider";
import { applyItmTarget } from "@/lib/sim/itmTarget";
import { computeRowStats } from "@/lib/sim/previewRowStats";
import type { TournamentRow } from "@/lib/sim/types";
import { FinishPMFPreview } from "./FinishPMFPreview";

afterEach(() => vi.unstubAllGlobals());

const model = { id: "power-law" as const };

function render(
  row: TournamentRow,
  rakebackPct = 0,
  primeDopePreset = false,
  onRowChange?: (updates: Partial<TournamentRow>) => void,
): string {
  vi.stubGlobal("React", React);
  return renderToStaticMarkup(
    React.createElement(LocaleProvider, null,
      React.createElement(AdvancedModeProvider, null,
        React.createElement(FinishPMFPreview, { row, model, rakebackPct, primeDopePreset, onRowChange }),
      ),
    ),
  );
}

const breakEven = (over: Partial<TournamentRow>): TournamentRow =>
  applyItmTarget([{
    id: "r", players: 100, buyIn: 10, rake: 0.1, roi: 0,
    payoutStructure: "mtt-standard", gameType: "freezeout", count: 1, ...over,
  }], { enabled: false, pct: 18.7 })[0];

describe("FinishPMFPreview hero strip on a break-even row", () => {
  it.each([
    { players: 100 },
    { players: 500, gameType: "pko" as const, payoutStructure: "mtt-gg-bounty" as const, bountyFraction: 0.5 },
  ])("prints no negative zero and no loss colour for %o", (over) => {
    const row = breakEven(over);
    const stats = computeRowStats(row, model);
    expect(Math.abs(stats.evPerEntry - stats.cost)).toBeLessThan(1e-9);
    const html = render(row);
    expect(html).not.toMatch(/-0\.0%/);
    expect(html).not.toMatch(/[-−]\$0</);
    expect(html).not.toMatch(/var\(--color-danger\)\]">[-−+]?\$0</);
    expect(html).not.toContain("border-[color:var(--color-danger)]");
    expect(html).toContain('tabular-nums text-[color:var(--color-fg-dim)]">0.0%<');
    expect(html).toContain('tabular-nums text-[color:var(--color-fg-dim)]">$0<');
    expect(html).not.toMatch(/\+\$0</);
    expect(html).not.toMatch(/\+0\.0%/);
  });

  it("keeps the minus of a dollar loss that rounds to a 0.0% ROI", () => {
    const html = render(breakEven({ buyIn: 1000, roi: -0.0004 }));
    expect(html).toContain('tabular-nums text-[color:var(--color-fg-dim)]">0.0%<');
    expect(html).toMatch(/tabular-nums text-\[color:var\(--color-fg-dim\)\]">-\$0\.\d\d</);
  });

  it("gives the ROI and net chips one sign on a sub-$1 ticket", () => {
    const html = render(breakEven({ buyIn: 0.1, roi: -0.02 }));
    expect(html).toContain('tabular-nums text-[color:var(--color-danger)]">-2.0%<');
    expect(html).toContain('tabular-nums text-[color:var(--color-danger)]">-$0.002<');
    expect(html).not.toMatch(/\+\$0</);
  });
});

describe("FinishPMFPreview under the Like PrimeDope preset", () => {
  it("says the card shows the app's model, only while the preset is on", () => {
    const row = breakEven({ roi: 0.2, players: 500 });
    const note = DICT["preview.primedopeNote"].ru;
    expect(render(row, 0, true)).toContain(note);
    expect(render(row, 0, false)).not.toContain(note);
  });

  // The PD toggles can turn PrimeDope's payout table and flat ITM finishes
  // off, so the note must not state them as fact; it sits above the row title
  // and has to stay one line.
  it.each(["en", "ru"] as const)("stays true with the PD toggles off and short (%s)", (locale) => {
    const note = DICT["preview.primedopeNote"][locale];
    expect(note.length).toBeLessThanOrEqual(110);
    expect(note).not.toMatch(/payout table|flat in-the-money|таблице выплат|равномерн/);
  });
});

describe("FinishPMFPreview KO-share slider", () => {
  it("names the winnings it divides by, which the EV mix above does not use once rakeback is on", () => {
    const row = breakEven({
      players: 500, roi: 0.1, gameType: "pko", payoutStructure: "mtt-gg-bounty", bountyFraction: 0.5,
    });
    const stats = computeRowStats(row, model);
    const html = render(row, 30, false, vi.fn());
    expect(html).toContain(DICT["preview.evBias.label"].ru);
    expect(DICT["preview.evBias.label"].en).toContain("winnings");
    const sliderShare = stats.bountyEvPerEntry / (stats.cashEvPerEntry + stats.bountyEvPerEntry);
    expect(stats.bountyShare).toBeCloseTo(sliderShare, 12);
  });
});
