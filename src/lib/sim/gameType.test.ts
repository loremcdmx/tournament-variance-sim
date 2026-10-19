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
import { compileSchedule, runSimulation } from "./engine";
import type { GameType, SimulationInput, TournamentRow } from "./types";

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

describe("applyGameType format switches", () => {
  const switchTo = (r: TournamentRow, next: GameType): TournamentRow => ({
    ...r,
    ...applyGameType(r, next),
  });
  // The main calculator's starting row (5000 players, 50+5) switched to PKO.
  const pko5000 = () =>
    switchTo(row({ players: 5000, buyIn: 50, rake: 0.1, gameType: "freezeout" }), "pko");
  const cashPool = (r: TournamentRow) => r.players * r.buyIn * (1 - r.bountyFraction!);
  const bountyPool = (r: TournamentRow) => r.players * r.buyIn * r.bountyFraction!;

  it("PKO → Ocean → PKO returns the 50/50 split and the 50+5 ticket", () => {
    const start = pko5000();
    expect(cashPool(start)).toBeCloseTo(125_000, 6);
    const ocean = switchTo(start, "ocean-ko");
    expect(ocean.bountyFraction).toBe(DEFAULT_OCEAN_BOUNTY_FRACTION);
    expect(ocean.buyIn * (1 + ocean.rake)).toBeCloseTo(55, 10);
    const back = switchTo(ocean, "pko");
    expect(back.bountyFraction).toBe(0.5);
    expect(back.buyIn).toBeCloseTo(50, 10);
    expect(back.rake).toBeCloseTo(0.1, 12);
    expect(cashPool(back)).toBeCloseTo(125_000, 6);
    expect(bountyPool(back)).toBeCloseTo(125_000, 6);
    expect(back.splitBeforeFixedFormat).toBeUndefined();
  });

  it("Ocean → Mystery drops Ocean's 50/92 share", () => {
    const viaOcean = switchTo(switchTo(pko5000(), "ocean-ko"), "mystery");
    expect(viaOcean.bountyFraction).toBe(0.5);
    expect(viaOcean.buyIn).toBeCloseTo(50, 10);
    expect(viaOcean.rake).toBeCloseTo(0.1, 12);
    // A row that started as Ocean has no earlier split: format default share,
    // the GG ticket stays as it is.
    const bornOcean = row({
      gameType: "ocean-ko",
      payoutStructure: "mtt-gg-bounty",
      bountyFraction: DEFAULT_OCEAN_BOUNTY_FRACTION,
      ...oceanKoRowFromTotalTicket(100),
    });
    const mystery = switchTo(bornOcean, "mystery");
    expect(mystery.bountyFraction).toBe(0.5);
    expect(mystery.buyIn).toBeCloseTo(92, 10);
    expect(mystery.buyIn * mystery.rake).toBeCloseTo(8, 10);
  });

  it("keeps a manual PKO share (40%) when switching to Mystery and back", () => {
    const manual = { ...pko5000(), bountyFraction: 0.4 };
    const mystery = switchTo(manual, "mystery");
    expect(mystery.bountyFraction).toBe(0.4);
    expect(switchTo(mystery, "pko").bountyFraction).toBe(0.4);
  });

  it("keeps a manual PKO share through a trip into Ocean and back", () => {
    const manual = { ...pko5000(), bountyFraction: 0.4 };
    const ocean = switchTo(manual, "ocean-ko");
    expect(ocean.bountyFraction).toBe(DEFAULT_OCEAN_BOUNTY_FRACTION);
    expect(switchTo(ocean, "mystery").bountyFraction).toBe(0.4);
    expect(switchTo(ocean, "pko").bountyFraction).toBe(0.4);
  });

  it("re-splits an Ocean ticket edited in Ocean with the player's earlier fee", () => {
    const ocean = { ...switchTo(pko5000(), "ocean-ko"), ...oceanKoRowFromTotalTicket(110) };
    const back = switchTo(ocean, "pko");
    expect(back.buyIn * (1 + back.rake)).toBeCloseTo(110, 10);
    expect(back.rake).toBeCloseTo(0.1, 12);
    expect(back.buyIn).toBeCloseTo(100, 10);
  });

  it("Ocean → freezeout restores the 50+5 ticket", () => {
    const freeze = switchTo(switchTo(pko5000(), "ocean-ko"), "freezeout");
    expect(freeze.bountyFraction).toBeUndefined();
    expect(freeze.buyIn).toBeCloseTo(50, 10);
    expect(freeze.rake).toBeCloseTo(0.1, 12);
  });

  it("keeps Battle Royale's 21/46 share out of PKO / Mystery and theirs out of BR", () => {
    const manual = { ...pko5000(), bountyFraction: 0.4 };
    const br = switchTo(manual, "mystery-royale");
    expect(br.bountyFraction).toBe(DEFAULT_BATTLE_ROYALE_BOUNTY_FRACTION);
    expect(switchTo(br, "mystery").bountyFraction).toBe(0.4);
    const freshBr = switchTo(row(), "mystery-royale");
    expect(switchTo(freshBr, "pko").bountyFraction).toBe(0.5);
    expect(switchTo(freshBr, "mystery").bountyFraction).toBe(0.5);
    // Ocean ↔ BR carries the player's own split along.
    const viaBoth = switchTo(switchTo(switchTo(manual, "ocean-ko"), "mystery-royale"), "pko");
    expect(viaBoth.bountyFraction).toBe(0.4);
  });

  it("ignores a broken remembered split from an old or edited link", () => {
    const ocean = row({
      gameType: "ocean-ko",
      payoutStructure: "mtt-gg-bounty",
      bountyFraction: DEFAULT_OCEAN_BOUNTY_FRACTION,
      ...oceanKoRowFromTotalTicket(100),
      splitBeforeFixedFormat: { rake: Number.NaN, bountyFraction: 5 },
    });
    const pko = switchTo(ocean, "pko");
    expect(pko.bountyFraction).toBe(0.5);
    expect(pko.buyIn).toBe(ocean.buyIn);
    expect(pko.rake).toBe(ocean.rake);
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

describe("PKO head-size noise does not follow a row into Mystery", () => {
  // ScheduleEditor.update(): the patch is merged and normalised on every edit.
  const update = (r: TournamentRow, patch: Partial<TournamentRow>) =>
    normalizeGameTypeConsistency({ ...r, ...patch });
  const switchTo = (r: TournamentRow, next: GameType) =>
    update(r, applyGameType(r, next));
  const start = row({ buyIn: 20, roi: 0.2, gameType: "freezeout" });
  const inputFor = (r: TournamentRow, extra: Partial<SimulationInput> = {}): SimulationInput => ({
    schedule: [r],
    scheduleRepeats: 20,
    samples: 2000,
    bankroll: 500,
    seed: 12345,
    finishModel: { id: "power-law" },
    ...extra,
  });

  it("the Mystery and Mystery-Royale patches clear pkoHeadVar and pkoHeat", () => {
    const pko = {
      ...switchTo(start, "pko"),
      pkoHeat: 0.3,
    };
    expect(pko.pkoHeadVar).toBe(0.4);
    for (const next of ["mystery", "mystery-royale"] as const) {
      const patch = applyGameType(pko, next);
      expect("pkoHeadVar" in patch).toBe(true);
      expect(patch.pkoHeadVar).toBeUndefined();
      expect("pkoHeat" in patch).toBe(true);
      expect(patch.pkoHeat).toBeUndefined();
    }
  });

  it("a PKO row flipped to Mystery compiles to the same per-KO variance as a fresh Mystery row", () => {
    const fresh = switchTo(start, "mystery");
    const viaPko = switchTo(switchTo(start, "pko"), "mystery");
    expect(viaPko.pkoHeadVar).toBeUndefined();
    expect(compileSchedule(inputFor(viaPko), "alpha").flat[0].mysteryBountyLogVar).toBe(2);
    expect(compileSchedule(inputFor(fresh), "alpha").flat[0].mysteryBountyLogVar).toBe(2);
    const a = runSimulation(inputFor(fresh));
    const b = runSimulation(inputFor(viaPko));
    expect(b.stats.mean).toBe(a.stats.mean);
    expect(b.stats.stdDev).toBe(a.stats.stdDev);
  });

  it("PKO → Mystery-Royale → Mystery does not bring the head-size noise back", () => {
    const viaRoyale = switchTo(switchTo(switchTo(start, "pko"), "mystery-royale"), "mystery");
    expect(viaRoyale.pkoHeadVar).toBeUndefined();
    expect(viaRoyale.pkoHeat).toBeUndefined();
    expect(compileSchedule(inputFor(viaRoyale), "alpha").flat[0].mysteryBountyLogVar).toBe(2);
  });

  it("normalisation strips a leftover pkoHeadVar / pkoHeat from an explicit Mystery or Mystery-Royale row", () => {
    for (const gameType of ["mystery", "mystery-royale"] as const) {
      const stale = row({
        gameType,
        payoutStructure: gameType === "mystery" ? "mtt-gg-mystery" : "battle-royale",
        bountyFraction: 0.5,
        mysteryBountyVariance: gameType === "mystery" ? 2 : 1.8,
        pkoHeadVar: 0.4,
        pkoHeat: 0.2,
      });
      const fixed = normalizeGameTypeConsistency(stale);
      expect(fixed.pkoHeadVar).toBeUndefined();
      expect(fixed.pkoHeat).toBeUndefined();
      expect(fixed.mysteryBountyVariance).toBe(stale.mysteryBountyVariance);
      expect(fixed.bountyFraction).toBe(0.5);
    }
  });

  it("returns a consistent Mystery row untouched (same object)", () => {
    const clean = switchTo(start, "mystery");
    expect(normalizeGameTypeConsistency(clean)).toBe(clean);
  });

  it("leaves PKO's own head-size default alone", () => {
    const pko = switchTo(start, "pko");
    expect(normalizeGameTypeConsistency(pko).pkoHeadVar).toBe(0.4);
  });
});

describe("a Field-size range does not follow a row into Battle Royale", () => {
  // Battle Royale is an 18-max sit-and-go: the editor shows its field as fixed
  // and disables the control, and persistence drops the range on reload. A
  // range left on the row kept the engine playing 140-700 entrants.
  const range = { kind: "uniform", min: 300, max: 700, buckets: 5 } as const;
  const ranged = row({ players: 500, gameType: "freezeout", fieldVariability: range });
  const update = (r: TournamentRow, patch: Partial<TournamentRow>) =>
    normalizeGameTypeConsistency({ ...r, ...patch });
  const switchTo = (r: TournamentRow, next: GameType) => update(r, applyGameType(r, next));
  const inputFor = (r: TournamentRow): SimulationInput => ({
    schedule: [r], scheduleRepeats: 5, samples: 500, bankroll: 100, seed: 7,
    finishModel: { id: "power-law" },
  });

  it("the Battle Royale switch drops the range from the row", () => {
    const patch = applyGameType(ranged, "mystery-royale");
    expect("fieldVariability" in patch).toBe(true);
    expect(patch.fieldVariability).toBeUndefined();
    expect(switchTo(ranged, "mystery-royale").fieldVariability).toBeUndefined();
  });

  it("leaves the range on every other format switch", () => {
    for (const next of ["freezeout", "pko", "mystery", "ocean-ko"] as const) {
      expect("fieldVariability" in applyGameType(ranged, next)).toBe(false);
      expect(switchTo(ranged, next).fieldVariability).toEqual(range);
    }
  });

  it("the switched row plays an 18-max field with no variants", () => {
    const br = switchTo(ranged, "mystery-royale");
    const entry = compileSchedule(inputFor(br), "alpha").flat[0];
    expect(entry.variants).toBeUndefined();
    expect(entry.fieldSize).toBe(18);
  });

  it("the switched row simulates exactly like the same row without a range", () => {
    const br = switchTo(ranged, "mystery-royale");
    const clean = { ...br, fieldVariability: undefined };
    const a = runSimulation(inputFor(br));
    const b = runSimulation(inputFor(clean));
    expect(a.stats.mean).toBe(b.stats.mean);
    expect(a.stats.stdDev).toBe(b.stats.stdDev);
  });

  it("normalisation clears a leftover range from every spelling of Battle Royale", () => {
    const legacyPayout = row({ gameType: undefined, payoutStructure: "battle-royale", players: 18, fieldVariability: range });
    const explicit = row({ gameType: "mystery-royale", payoutStructure: "battle-royale", players: 18, fieldVariability: range });
    const driftedPayout = row({ gameType: "mystery-royale", payoutStructure: "mtt-standard", players: 18, fieldVariability: range });
    for (const stale of [legacyPayout, explicit, driftedPayout]) {
      expect(normalizeGameTypeConsistency(stale).fieldVariability).toBeUndefined();
      expect(normalizeBrMrConsistency(stale).fieldVariability).toBeUndefined();
    }
  });

  it("does not clear the range of a row that is not Battle Royale", () => {
    const explicitMystery = row({
      gameType: "mystery", payoutStructure: "battle-royale", bountyFraction: 0.5,
      mysteryBountyVariance: 2, fieldVariability: range,
    });
    // Explicit gameType wins: the drifted payout is corrected, the row stays a plain Mystery.
    const fixed = normalizeGameTypeConsistency(explicitMystery);
    expect(fixed.payoutStructure).toBe("mtt-gg-mystery");
    expect(fixed.fieldVariability).toEqual(range);
    const plain = row({ gameType: "freezeout", fieldVariability: range });
    expect(normalizeGameTypeConsistency(plain)).toBe(plain);
  });

  it("keeps a fixed marker on a Battle Royale row and returns it untouched", () => {
    const r = row({
      gameType: "mystery-royale", payoutStructure: "battle-royale", players: 18,
      fieldVariability: { kind: "fixed" },
    });
    expect(normalizeGameTypeConsistency(r)).toBe(r);
  });

  it("the range does not come back when the row leaves Battle Royale", () => {
    const br = switchTo(ranged, "mystery-royale");
    expect(switchTo(br, "freezeout").fieldVariability).toBeUndefined();
  });
});
