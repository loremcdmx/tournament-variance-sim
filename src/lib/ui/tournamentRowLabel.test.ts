import { describe, expect, it } from "vitest";
import { getTournamentRowDisplayLabel } from "./tournamentRowLabel";
import type { DictKey } from "@/lib/i18n/dict";
import type { TournamentRow } from "@/lib/sim/types";

const row = (overrides: Partial<TournamentRow> = {}): TournamentRow => ({
  id: "r1",
  players: 500,
  buyIn: 10,
  rake: 0.1,
  roi: 0.1,
  payoutStructure: "mtt-standard",
  count: 1,
  ...overrides,
});

const translate = (key: DictKey): string => {
  switch (key) {
    case "row.gameType.freezeout":
      return "Фризаут";
    case "row.gameType.pko":
      return "PKO";
    case "row.gameType.mystery":
      return "Mystery";
    case "row.gameType.mysteryRoyale":
      return "GG Battle Royal";
    default:
      return key;
  }
};

describe("getTournamentRowDisplayLabel", () => {
  it("collapses freezeout-reentry into freezeout for user-facing labels", () => {
    expect(
      getTournamentRowDisplayLabel(
        row({
          gameType: "freezeout-reentry",
          maxEntries: 2,
          reentryRate: 1,
        }),
        translate,
      ),
    ).toBe("Фризаут $10+$1");
  });
});
