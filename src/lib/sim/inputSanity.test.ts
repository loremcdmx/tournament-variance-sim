import { describe, expect, it } from "vitest";
import {
  checkInputSanity,
  MIN_EMPIRICAL_BUCKETS,
  PKO_SINGLE_TABLE_MAX_FIELD,
  type SanityInputs,
} from "./inputSanity";
import type { TournamentRow } from "./types";

const calmControls: SanityInputs = {
  tiltFastGain: 0,
  tiltFastScale: 0,
  tiltSlowGain: 0,
  tiltSlowThreshold: 0,
  bankroll: 1000,
  finishModelId: "power-law",
};

function makeRow(overrides: Partial<TournamentRow> = {}): TournamentRow {
  return {
    id: "r1",
    label: "test",
    players: 100,
    buyIn: 10,
    rake: 0.1,
    roi: 0.05,
    payoutStructure: "mtt-standard",
    gameType: "freezeout",
    count: 1,
    ...overrides,
  };
}

describe("checkInputSanity", () => {
  it("returns no findings for sane defaults", () => {
    const findings = checkInputSanity(calmControls, [makeRow()]);
    expect(findings).toEqual([]);
  });

  it("flags fast tilt with gain but zero scale", () => {
    const findings = checkInputSanity(
      { ...calmControls, tiltFastGain: -0.3, tiltFastScale: 0 },
      [makeRow()],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("tilt-fast-no-scale");
  });

  it("does not flag fast tilt when both are zero", () => {
    const findings = checkInputSanity(calmControls, [makeRow()]);
    expect(findings.find((f) => f.id === "tilt-fast-no-scale")).toBeUndefined();
  });

  it("does not flag fast tilt when scale is set but gain is zero (benign)", () => {
    const findings = checkInputSanity(
      { ...calmControls, tiltFastGain: 0, tiltFastScale: 5000 },
      [makeRow()],
    );
    expect(findings.find((f) => f.id === "tilt-fast-no-scale")).toBeUndefined();
  });

  it("flags slow tilt with gain but no threshold", () => {
    const findings = checkInputSanity(
      { ...calmControls, tiltSlowGain: -0.05, tiltSlowThreshold: 0 },
      [makeRow()],
    );
    expect(findings.some((f) => f.id === "tilt-slow-no-threshold")).toBe(true);
  });

  it("flags slow tilt whose minimum duration floors to zero tournaments", () => {
    for (const tiltSlowMinDuration of [0, 0.9, -5]) {
      const findings = checkInputSanity(
        { ...calmControls, tiltSlowGain: -0.05, tiltSlowThreshold: 5000, tiltSlowMinDuration },
        [makeRow()],
      );
      expect(findings.map((f) => f.id), String(tiltSlowMinDuration)).toEqual([
        "tilt-slow-no-min-duration",
      ]);
    }
  });

  it("takes an unset minimum duration as the engine's default of 500 tournaments", () => {
    const findings = checkInputSanity(
      { ...calmControls, tiltSlowGain: -0.05, tiltSlowThreshold: 5000 },
      [makeRow()],
    );
    expect(findings).toEqual([]);
    expect(
      checkInputSanity(
        { ...calmControls, tiltSlowGain: -0.05, tiltSlowThreshold: 5000, tiltSlowMinDuration: 1 },
        [makeRow()],
      ),
    ).toEqual([]);
  });

  it("says one thing per dead slow-tilt setting, and nothing when the gain is zero", () => {
    const both = checkInputSanity(
      { ...calmControls, tiltSlowGain: 0.1, tiltSlowThreshold: 0, tiltSlowMinDuration: 0 },
      [makeRow()],
    );
    expect(both.map((f) => f.id)).toEqual(["tilt-slow-no-threshold", "tilt-slow-no-min-duration"]);
    expect(
      checkInputSanity(
        { ...calmControls, tiltSlowGain: 0, tiltSlowThreshold: 0, tiltSlowMinDuration: 0 },
        [makeRow()],
      ),
    ).toEqual([]);
  });

  it("flags PKO row with zero bountyFraction", () => {
    const findings = checkInputSanity(calmControls, [
      makeRow({ id: "pko-row", label: "PKO", gameType: "pko", bountyFraction: 0 }),
    ]);
    const f = findings.find((x) => x.id === "row-bounty-format-no-bounty");
    expect(f).toBeDefined();
    expect(f?.rowIdx).toBe(0);
    expect(f?.rowLabel).toBe("PKO");
  });

  it("flags Mystery row with zero variance", () => {
    const findings = checkInputSanity(calmControls, [
      makeRow({
        id: "mystery-row",
        label: "Mystery",
        gameType: "mystery",
        bountyFraction: 0.5,
        mysteryBountyVariance: 0,
      }),
    ]);
    expect(
      findings.some((f) => f.id === "row-mystery-no-variance" && f.rowIdx === 0),
    ).toBe(true);
  });

  it("flags Mystery Battle Royale row with zero bounty but ignores its variance", () => {
    // BR envelopes come from the tier table; the editor hides σ² for BR rows.
    const findings = checkInputSanity(calmControls, [
      makeRow({
        id: "mbr-row",
        label: "MBR",
        gameType: "mystery-royale",
        payoutStructure: "battle-royale",
        bountyFraction: 0,
        mysteryBountyVariance: 0,
      }),
    ]);
    expect(
      findings.some((f) => f.id === "row-bounty-format-no-bounty"),
    ).toBe(true);
    expect(findings.some((f) => f.id === "row-mystery-no-variance")).toBe(false);
  });

  it("battle-royale row with no variance yields no findings", () => {
    const findings = checkInputSanity(calmControls, [
      makeRow({
        gameType: "mystery-royale",
        payoutStructure: "battle-royale",
        players: 18,
        bountyFraction: 0.45,
        mysteryBountyVariance: 0,
      }),
    ]);
    expect(findings).toEqual([]);
  });

  it("does not flag a freezeout row with zero bounty (not a contradiction)", () => {
    const findings = checkInputSanity(calmControls, [
      makeRow({ gameType: "freezeout", bountyFraction: 0 }),
    ]);
    expect(
      findings.find((f) => f.id === "row-bounty-format-no-bounty"),
    ).toBeUndefined();
  });

  it("flags zero-count rows", () => {
    const findings = checkInputSanity(calmControls, [
      makeRow({ id: "dead", label: "dead row", count: 0 }),
    ]);
    expect(
      findings.some((f) => f.id === "row-zero-count" && f.rowLabel === "dead row"),
    ).toBe(true);
  });

  it("preserves row index when multiple rows are present", () => {
    const findings = checkInputSanity(calmControls, [
      makeRow({ id: "good", label: "good" }),
      makeRow({
        id: "bad-pko",
        label: "bad-pko",
        gameType: "pko",
        bountyFraction: 0,
      }),
      makeRow({ id: "good2", label: "good2" }),
    ]);
    const pko = findings.find((f) => f.id === "row-bounty-format-no-bounty");
    expect(pko?.rowIdx).toBe(1);
    expect(pko?.rowLabel).toBe("bad-pko");
  });

  it("flags zero-bankroll when there is at least one row", () => {
    const findings = checkInputSanity(
      { ...calmControls, bankroll: 0 },
      [makeRow()],
    );
    expect(findings.some((f) => f.id === "zero-bankroll")).toBe(true);
  });

  it("does not flag zero-bankroll on an empty schedule (run is impossible anyway)", () => {
    const findings = checkInputSanity(
      { ...calmControls, bankroll: 0 },
      [],
    );
    expect(findings.some((f) => f.id === "zero-bankroll")).toBe(false);
  });

  it("flags empirical mode without enough buckets", () => {
    const findings = checkInputSanity(
      {
        ...calmControls,
        finishModelId: "empirical",
        empiricalBuckets: new Array(MIN_EMPIRICAL_BUCKETS - 1).fill(1),
      },
      [makeRow()],
    );
    expect(findings.some((f) => f.id === "empirical-too-few-buckets")).toBe(true);
  });

  it("does not flag empirical mode with enough buckets", () => {
    const findings = checkInputSanity(
      {
        ...calmControls,
        finishModelId: "empirical",
        empiricalBuckets: new Array(MIN_EMPIRICAL_BUCKETS).fill(1),
      },
      [makeRow()],
    );
    expect(findings.some((f) => f.id === "empirical-too-few-buckets")).toBe(false);
  });

  it("does not flag empirical-too-few-buckets when a different model is active", () => {
    const findings = checkInputSanity(
      {
        ...calmControls,
        finishModelId: "power-law",
        empiricalBuckets: undefined,
      },
      [makeRow()],
    );
    expect(findings.some((f) => f.id === "empirical-too-few-buckets")).toBe(false);
  });

  it("flags PKO heat with no bounty", () => {
    const findings = checkInputSanity(calmControls, [
      makeRow({ gameType: "pko", bountyFraction: 0, pkoHeat: 0.4 }),
    ]);
    expect(findings.some((f) => f.id === "row-pko-heat-no-bounty")).toBe(true);
  });

  it("does not flag PKO heat when bounty is set", () => {
    const findings = checkInputSanity(calmControls, [
      makeRow({ gameType: "pko", bountyFraction: 0.5, pkoHeat: 0.4 }),
    ]);
    expect(findings.some((f) => f.id === "row-pko-heat-no-bounty")).toBe(false);
  });

  describe("session noise when one session is the whole run", () => {
    const withSession = (patch: Partial<SanityInputs>): SanityInputs => ({
      ...calmControls,
      roiShockPerSession: 0.05,
      roiDriftSigma: 0.01,
      ...patch,
    });
    const flagged = (controls: SanityInputs, count = 1) =>
      checkInputSanity(controls, [makeRow({ count })]).some((f) => f.id === "session-noise-whole-run");

    it("flags session shock or drift when a session covers the whole run", () => {
      expect(flagged(withSession({ scheduleRepeats: 1, tournamentsPerSession: 50 }), 50)).toBe(true);
      expect(flagged(withSession({ scheduleRepeats: 2, tournamentsPerSession: 50 }), 20)).toBe(true);
      expect(flagged(withSession({ scheduleRepeats: 1, tournamentsPerSession: 50, roiDriftSigma: 0 }), 30)).toBe(true);
      expect(flagged(withSession({ scheduleRepeats: 1, tournamentsPerSession: 50, roiShockPerSession: 0 }), 30)).toBe(true);
    });

    it("stays quiet once the run spans several sessions, however the distance is stored", () => {
      expect(flagged(withSession({ scheduleRepeats: 1, tournamentsPerSession: 50 }), 10_000)).toBe(false);
      expect(flagged(withSession({ scheduleRepeats: 200, tournamentsPerSession: 50 }), 1)).toBe(false);
      expect(flagged(withSession({ scheduleRepeats: 1, tournamentsPerSession: 50 }), 51)).toBe(false);
    });

    it("stays quiet with both channels off or with no repeat count given", () => {
      expect(flagged(withSession({ scheduleRepeats: 1, tournamentsPerSession: 50, roiShockPerSession: 0, roiDriftSigma: 0 }), 30)).toBe(false);
      expect(flagged(withSession({ tournamentsPerSession: 50 }), 30)).toBe(false);
    });

    it("reads an unset session length as the engine does, one session per schedule pass", () => {
      expect(flagged(withSession({ scheduleRepeats: 1 }), 10_000)).toBe(true);
      expect(flagged(withSession({ scheduleRepeats: 200 }), 50)).toBe(false);
    });
  });

  describe("single-table PKO", () => {
    const flagged = (row: Partial<TournamentRow>) =>
      checkInputSanity(calmControls, [makeRow(row)]).some((f) => f.id === "row-pko-single-table");
    const pko = { gameType: "pko" as const, payoutStructure: "mtt-gg-bounty" as const, bountyFraction: 0.5 };

    it("flags a PKO row of 18 players or fewer", () => {
      for (const players of [2, 6, 9, PKO_SINGLE_TABLE_MAX_FIELD]) {
        expect(flagged({ ...pko, players }), String(players)).toBe(true);
      }
      expect(flagged({ ...pko, players: PKO_SINGLE_TABLE_MAX_FIELD + 1 })).toBe(false);
    });

    it("reads the smallest field the engine plays, not the nominal one", () => {
      expect(
        flagged({ ...pko, players: 100, fieldVariability: { kind: "uniform", min: 10, max: 30, buckets: 5 } }),
      ).toBe(true);
      expect(flagged({ ...pko, players: 9, lateRegMultiplier: 3 })).toBe(false);
    });

    it("flags a row the engine infers as PKO and skips other bounty formats", () => {
      expect(flagged({ gameType: undefined, payoutStructure: "mtt-gg-bounty", bountyFraction: 0.5, players: 6 })).toBe(true);
      expect(flagged({ ...pko, players: 6, bountyFraction: 0 })).toBe(false);
      expect(flagged({ ...pko, gameType: "mystery", mysteryBountyVariance: 2, players: 6 })).toBe(false);
      expect(flagged({ gameType: "freezeout", players: 6 })).toBe(false);
    });
  });
});
