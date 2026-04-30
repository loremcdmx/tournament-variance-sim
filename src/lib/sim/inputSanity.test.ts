import { describe, expect, it } from "vitest";
import {
  checkInputSanity,
  MIN_EMPIRICAL_BUCKETS,
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

  it("flags Mystery Battle Royale row with zero variance and zero bounty independently", () => {
    const findings = checkInputSanity(calmControls, [
      makeRow({
        id: "mbr-row",
        label: "MBR",
        gameType: "mystery-royale",
        bountyFraction: 0,
        mysteryBountyVariance: 0,
      }),
    ]);
    expect(
      findings.some((f) => f.id === "row-bounty-format-no-bounty"),
    ).toBe(true);
    expect(findings.some((f) => f.id === "row-mystery-no-variance")).toBe(true);
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

  it("flags re-entry slots with no rate", () => {
    const findings = checkInputSanity(calmControls, [
      makeRow({ maxEntries: 3, reentryRate: 0 }),
    ]);
    expect(findings.some((f) => f.id === "row-reentry-slots-no-rate")).toBe(true);
  });

  it("flags re-entry rate with no slots", () => {
    const findings = checkInputSanity(calmControls, [
      makeRow({ maxEntries: 1, reentryRate: 0.5 }),
    ]);
    expect(findings.some((f) => f.id === "row-reentry-rate-no-slots")).toBe(true);
  });

  it("does not flag re-entry when slots and rate are both off (single bullet)", () => {
    const findings = checkInputSanity(calmControls, [
      makeRow({ maxEntries: 1, reentryRate: 0 }),
    ]);
    expect(
      findings.some(
        (f) =>
          f.id === "row-reentry-slots-no-rate" ||
          f.id === "row-reentry-rate-no-slots",
      ),
    ).toBe(false);
  });

  it("does not flag re-entry when slots and rate are coherent", () => {
    const findings = checkInputSanity(calmControls, [
      makeRow({ maxEntries: 3, reentryRate: 0.7 }),
    ]);
    expect(
      findings.some(
        (f) =>
          f.id === "row-reentry-slots-no-rate" ||
          f.id === "row-reentry-rate-no-slots",
      ),
    ).toBe(false);
  });
});
