import { describe, expect, it } from "vitest";
import { inferGameType } from "./gameType";
import type { TournamentRow } from "./types";

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

describe("inferGameType", () => {
  it("does not infer Battle Royale from mystery variance alone", () => {
    expect(
      inferGameType(
        row({
          bountyFraction: 0.5,
          mysteryBountyVariance: 2.0,
        }),
      ),
    ).toBe("mystery");
  });

  it("uses payoutStructure as the legacy Battle Royale signal", () => {
    expect(
      inferGameType(
        row({
          bountyFraction: 0.5,
          mysteryBountyVariance: 1.8,
          payoutStructure: "battle-royale",
        }),
      ),
    ).toBe("mystery-royale");
  });

  it("lets explicit gameType override payoutStructure drift", () => {
    expect(
      inferGameType(
        row({
          gameType: "mystery",
          bountyFraction: 0.5,
          mysteryBountyVariance: 2.0,
          payoutStructure: "battle-royale",
        }),
      ),
    ).toBe("mystery");
  });
});
