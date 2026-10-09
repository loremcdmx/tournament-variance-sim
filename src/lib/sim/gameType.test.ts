import { describe, expect, it } from "vitest";
import {
  applyGameType,
  DEFAULT_BATTLE_ROYALE_BOUNTY_FRACTION,
  DEFAULT_OCEAN_BOUNTY_FRACTION,
  inferGameType,
  normalizeBrMrConsistency,
  normalizeGameTypeConsistency,
  oceanKoRowFromTotalTicket,
  rowHasActiveBounty,
} from "./gameType";
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

describe("Ocean KO format", () => {
  it("turns a full lobby ticket into the prize-pool part and the 8% fee", () => {
    const ticket = oceanKoRowFromTotalTicket(100);
    expect(ticket.buyIn).toBeCloseTo(92, 10);
    expect(ticket.buyIn * ticket.rake).toBeCloseTo(8, 10);
    expect(ticket.buyIn * (1 + ticket.rake)).toBeCloseTo(100, 10);
    const source = row({ buyIn: 25, rake: 0 });
    const switched = applyGameType(source, "ocean-ko");
    expect(switched.buyIn).toBe(oceanKoRowFromTotalTicket(25).buyIn);
    expect(switched.rake).toBe(oceanKoRowFromTotalTicket(25).rake);
  });

  it("preserves the total ticket and applies GG's published 42/50/8 split", () => {
    const source = row({ buyIn: 90, rake: 10 / 90, mysteryBountyVariance: 2, pkoHeat: 0.5 });
    const ocean = { ...source, ...applyGameType(source, "ocean-ko") };
    expect(ocean.buyIn).toBeCloseTo(92, 10);
    expect(ocean.buyIn * ocean.rake).toBeCloseTo(8, 10);
    expect(ocean.buyIn * ocean.bountyFraction!).toBeCloseTo(50, 10);
    expect(ocean.buyIn * (1 - ocean.bountyFraction!)).toBeCloseTo(42, 10);
    expect(inferGameType(ocean)).toBe("ocean-ko");
    expect(rowHasActiveBounty(ocean)).toBe(true);
    expect(ocean.mysteryBountyVariance).toBeUndefined();
    expect(ocean.pkoHeat).toBeUndefined();
  });

  it("keeps Ocean authoritative over stale BR and Mystery fields", () => {
    const ocean = normalizeGameTypeConsistency(row({
      gameType: "ocean-ko", payoutStructure: "battle-royale",
      mysteryBountyVariance: 3, pkoHeadVar: 10, pkoHeat: 0.5,
    }));
    expect(ocean.payoutStructure).toBe("mtt-gg-bounty");
    expect(ocean.bountyFraction).toBe(DEFAULT_OCEAN_BOUNTY_FRACTION);
    expect(ocean.mysteryBountyVariance).toBeUndefined();
    expect(ocean.pkoHeadVar).toBeUndefined();
    expect(ocean.pkoHeat).toBeUndefined();
  });
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

describe("normalizeBrMrConsistency — gameType is authoritative", () => {
  it("no drift → row returned unchanged", () => {
    const r = row({
      gameType: "mystery-royale",
      payoutStructure: "battle-royale",
    });
    expect(normalizeBrMrConsistency(r)).toBe(r);
  });

  it("gameType=mystery-royale + non-BR payout → payout corrected to BR", () => {
    const fixed = normalizeBrMrConsistency(
      row({
        gameType: "mystery-royale",
        payoutStructure: "mtt-standard",
      }),
    );
    expect(fixed.gameType).toBe("mystery-royale");
    expect(fixed.payoutStructure).toBe("battle-royale");
  });

  it("SPLIT-BRAIN: gameType=mystery + payoutStructure=battle-royale → payout corrected to mtt-gg-mystery (gameType wins)", () => {
    // Canary for #131 split-brain. This row used to have UI classify as
    // Mystery while engine normalizer rewrote gameType to "mystery-royale"
    // and hot-loop ran MBR — two truths. Option A (explicit gameType wins)
    // resolves both paths to Mystery.
    const fixed = normalizeBrMrConsistency(
      row({
        gameType: "mystery",
        bountyFraction: 0.5,
        mysteryBountyVariance: 2.0,
        payoutStructure: "battle-royale",
      }),
    );
    expect(fixed.gameType).toBe("mystery");
    expect(fixed.payoutStructure).toBe("mtt-gg-mystery");
    // And inferGameType returns the same format — UI and engine agree.
    expect(inferGameType(fixed)).toBe("mystery");
  });

  it("gameType=pko + BR payout → payout corrected to mtt-gg-bounty", () => {
    const fixed = normalizeBrMrConsistency(
      row({
        gameType: "pko",
        bountyFraction: 0.5,
        payoutStructure: "battle-royale",
      }),
    );
    expect(fixed.gameType).toBe("pko");
    expect(fixed.payoutStructure).toBe("mtt-gg-bounty");
  });

  it("gameType=freezeout + BR payout → payout corrected to mtt-standard", () => {
    const fixed = normalizeBrMrConsistency(
      row({
        gameType: "freezeout",
        payoutStructure: "battle-royale",
      }),
    );
    expect(fixed.gameType).toBe("freezeout");
    expect(fixed.payoutStructure).toBe("mtt-standard");
  });

  it("legacy row (no gameType) + BR payout → upgraded to MBR", () => {
    // Backward-compat case: rows saved before the gameType column existed
    // or manual localStorage edits. payoutStructure=battle-royale is the
    // only signal available — treat it as MBR.
    const fixed = normalizeBrMrConsistency(
      row({
        payoutStructure: "battle-royale",
      }),
    );
    expect(fixed.gameType).toBe("mystery-royale");
    expect(fixed.payoutStructure).toBe("battle-royale");
  });

  it("both flags absent (pure mtt-standard) → returned unchanged", () => {
    const r = row({ gameType: "freezeout" });
    expect(normalizeBrMrConsistency(r)).toBe(r);
  });
});

describe("applyGameType defaults", () => {
  it("uses 45% bounty share for fresh Battle Royale rows", () => {
    const patch = applyGameType(row({ bountyFraction: undefined }), "mystery-royale");
    expect(patch.bountyFraction).toBe(DEFAULT_BATTLE_ROYALE_BOUNTY_FRACTION);
  });
});

describe("normalizeGameTypeConsistency", () => {
  it("strips stale bounty fields from explicit freezeouts", () => {
    const fixed = normalizeGameTypeConsistency(
      row({
        gameType: "freezeout",
        payoutStructure: "mtt-gg-bounty",
        bountyFraction: 0.5,
        mysteryBountyVariance: 2,
        pkoHeadVar: 0.4,
        pkoHeat: 0.2,
        bountyEvBias: 0.1,
        battleRoyaleLeaderboardEnabled: true,
        battleRoyaleLeaderboardShare: 0.5,
      }),
    );
    expect(fixed.gameType).toBe("freezeout");
    expect(fixed.payoutStructure).toBe("mtt-standard");
    expect(fixed.bountyFraction).toBeUndefined();
    expect(fixed.mysteryBountyVariance).toBeUndefined();
    expect(fixed.pkoHeadVar).toBeUndefined();
    expect(fixed.pkoHeat).toBeUndefined();
    expect(fixed.bountyEvBias).toBeUndefined();
    expect(fixed.battleRoyaleLeaderboardEnabled).toBeUndefined();
    expect(fixed.battleRoyaleLeaderboardShare).toBeUndefined();
    expect(rowHasActiveBounty(fixed)).toBe(false);
  });

  it("keeps bounty formats active", () => {
    const pko = normalizeGameTypeConsistency(
      row({
        gameType: "pko",
        payoutStructure: "mtt-gg-bounty",
        bountyFraction: 0.5,
      }),
    );
    expect(rowHasActiveBounty(pko)).toBe(true);
    expect(pko.bountyFraction).toBe(0.5);
  });

});
