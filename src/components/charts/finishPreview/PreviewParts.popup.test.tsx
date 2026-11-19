import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DICT } from "@/lib/i18n/dict";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { applyGameType, normalizeGameTypeConsistency } from "@/lib/sim/gameType";
import { applyItmTarget } from "@/lib/sim/itmTarget";
import { computeRowStats } from "@/lib/sim/previewRowStats";
import type { TournamentRow } from "@/lib/sim/types";
import { TierHoverPopup } from "./PreviewParts";

const render = (tier: ReturnType<typeof computeRowStats>["tiers"][number]) =>
  renderToStaticMarkup(
    <LocaleProvider>
      <TierHoverPopup label="1" breakdown={{ tier, hasBounty: true, bountyColor: "#0ff", posRangeLabel: "1" }} />
    </LocaleProvider>,
  );

describe("tier popup knockout lines", () => {
  it("shows a heads-up Mystery winner's bounty lump without a KO count of 0", () => {
    const seed: TournamentRow = {
      id: "hu", label: "hu", players: 500, buyIn: 10, rake: 0.1, roi: 0.1,
      payoutStructure: "mtt-standard", gameType: "freezeout", count: 1,
    };
    const row = normalizeGameTypeConsistency(
      applyItmTarget([{ ...seed, ...applyGameType(seed, "mystery"), players: 2 }], { enabled: false, pct: 0 })[0],
    );
    const winner = computeRowStats(row, { id: "power-law" }).tiers[0];
    expect(winner.bountyGivenFinish).toBeGreaterThan(0);
    expect(winner.bustsGivenFinish).toBe(0);
    const html = render(winner);
    expect(html).toContain(DICT["preview.hover.bountyTotal"].ru);
    expect(html).not.toContain(DICT["preview.hover.bountyHeads"].ru);
    expect(html).not.toContain(DICT["preview.hover.bountyAvgSize"].ru);
  });

  it("keeps the KO count on a PKO tier that has one", () => {
    const row: TournamentRow = {
      id: "p", label: "p", players: 200, buyIn: 20, rake: 0.1, roi: 0.1, gameType: "pko",
      payoutStructure: "mtt-gg-bounty", bountyFraction: 0.5, count: 1,
    };
    const winner = computeRowStats(row, { id: "power-law" }).tiers[0];
    expect(winner.bustsGivenFinish).toBeGreaterThan(0);
    const html = render(winner);
    expect(html).toContain(DICT["preview.hover.bountyHeads"].ru);
    expect(html).toContain(DICT["preview.hover.bountyAvgSize"].ru);
  });
});
