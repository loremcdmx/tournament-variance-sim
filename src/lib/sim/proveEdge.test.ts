import { describe, expect, it } from "vitest";
import {
  computeProveEdge,
  computeProveEdgeRows,
  PROVE_EDGE_DEFAULT_CANDIDATES,
  PROVE_EDGE_POSITIVE_CANDIDATES,
} from "./proveEdge";
import type { TournamentRow } from "./types";

const Z95 = 1.959964;

const baseFreeze = {
  format: "freeze" as const,
  afs: 200,
  rake: 0.10,
  z: Z95,
  currentRoi: 0.10,
  candidates: PROVE_EDGE_POSITIVE_CANDIDATES,
};

describe("computeProveEdgeRows (single-format mode)", () => {
  it("returns one row per candidate", () => {
    const rows = computeProveEdgeRows(baseFreeze);
    expect(rows).toHaveLength(PROVE_EDGE_POSITIVE_CANDIDATES.length);
  });

  it("highlights the candidate closest to currentRoi", () => {
    const rows = computeProveEdgeRows({ ...baseFreeze, currentRoi: 0.10 });
    const current = rows.find((r) => r.isCurrent);
    expect(current?.roi).toBe(0.10);
    expect(rows.filter((r) => r.isCurrent)).toHaveLength(1);
  });

  it("snaps highlight to nearest candidate when currentRoi is between grid points", () => {
    const rows = computeProveEdgeRows({ ...baseFreeze, currentRoi: 0.072 });
    expect(rows.find((r) => r.isCurrent)?.roi).toBe(0.05);
  });

  it("N grows quadratically as ROI shrinks (freeze: σ is ROI-invariant)", () => {
    const rows = computeProveEdgeRows(baseFreeze);
    const r10 = rows.find((r) => r.roi === 0.10)!;
    const r5 = rows.find((r) => r.roi === 0.05)!;
    const r25 = rows.find((r) => r.roi === 0.025)!;
    expect(r5.tourneys / r10.tourneys).toBeGreaterThan(3.9);
    expect(r5.tourneys / r10.tourneys).toBeLessThan(4.1);
    expect(r25.tourneys / r5.tourneys).toBeGreaterThan(3.9);
    expect(r25.tourneys / r5.tourneys).toBeLessThan(4.1);
  });

  it("freeze σ is ROI-invariant — same σ across the candidate grid", () => {
    const rows = computeProveEdgeRows(baseFreeze);
    const sigmas = new Set(rows.map((r) => r.sigma.toFixed(6)));
    expect(sigmas.size).toBe(1);
  });

  it("PKO σ grows with ROI — non-trivial spread across the grid", () => {
    const rows = computeProveEdgeRows({ ...baseFreeze, format: "pko" });
    const r1 = rows.find((r) => r.roi === 0.001)!;
    const r30 = rows.find((r) => r.roi === 0.30)!;
    expect(r30.sigma).toBeGreaterThan(r1.sigma * 1.10);
  });

  it("ROI = 0 yields infinite tourneys", () => {
    const rows = computeProveEdgeRows({
      ...baseFreeze,
      candidates: [0, 0.05],
    });
    expect(rows[0].tourneys).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isFinite(rows[1].tourneys)).toBe(true);
  });

  it("|−5 %| matches |+5 %| for freeze (ROI-invariant σ)", () => {
    const positive = computeProveEdgeRows({ ...baseFreeze, candidates: [0.05] })[0];
    const negative = computeProveEdgeRows({ ...baseFreeze, candidates: [-0.05] })[0];
    expect(negative.tourneys).toBe(positive.tourneys);
  });

  it("rake adjustment scales σ proportionally", () => {
    const at10 = computeProveEdgeRows({ ...baseFreeze, rake: 0.10 })[0];
    const at5 = computeProveEdgeRows({ ...baseFreeze, rake: 0.05 })[0];
    expect(at5.sigma).toBeGreaterThan(at10.sigma);
  });

  it("higher CI (bigger z) requires more tournaments quadratically", () => {
    const at95 = computeProveEdgeRows({ ...baseFreeze, z: 1.96 })[3];
    const at99 = computeProveEdgeRows({ ...baseFreeze, z: 2.576 })[3];
    const ratio = at99.tourneys / at95.tourneys;
    expect(ratio).toBeGreaterThan(1.70);
    expect(ratio).toBeLessThan(1.75);
  });

  it("fields = tourneys / afs", () => {
    const rows = computeProveEdgeRows({ ...baseFreeze, afs: 500 });
    rows.forEach((r) => {
      if (Number.isFinite(r.tourneys)) {
        expect(r.fields).toBeCloseTo(r.tourneys / 500, 6);
      }
    });
  });

  it("MBR format works at AFS=18 with its narrow ROI box", () => {
    const rows = computeProveEdgeRows({
      ...baseFreeze,
      format: "mystery-royale",
      afs: 18,
      candidates: [0.10, 0.05, 0.025, 0.01],
    });
    expect(rows).toHaveLength(4);
    rows.forEach((r) => expect(r.tourneys).toBeGreaterThan(0));
  });
});

describe("computeProveEdge — band policy + anchor + fit-box", () => {
  it("inside fit-box → numeric band, sigmaLo < sigma < sigmaHi", () => {
    const result = computeProveEdge(baseFreeze);
    expect(result.bandPolicy).toBe("numeric");
    result.rows.forEach((r) => {
      expect(r.insideFitBox).toBe(true);
      expect(r.sigmaLo).toBeLessThan(r.sigma);
      expect(r.sigmaHi).toBeGreaterThan(r.sigma);
      // tourneys uses point sigma; bounds are inverted (more sigma → more tourneys)
      expect(r.tourneysLo).toBeLessThanOrEqual(r.tourneys);
      expect(r.tourneysHi).toBeGreaterThanOrEqual(r.tourneys);
    });
  });

  it("PKO at AFS < 50 (outside fit-box) → outside-fit-box, no band", () => {
    const result = computeProveEdge({
      ...baseFreeze,
      format: "pko",
      afs: 25,
    });
    expect(result.bandPolicy).toBe("outside-fit-box");
    result.rows.forEach((r) => {
      expect(r.insideFitBox).toBe(false);
      expect(r.sigmaLo).toBe(r.sigma);
      expect(r.sigmaHi).toBe(r.sigma);
      expect(r.tourneysLo).toBe(r.tourneys);
      expect(r.tourneysHi).toBe(r.tourneys);
    });
  });

  it("anchor uses precise σ at user's exact ROI, not snapped to grid", () => {
    // currentRoi = 0.072 snaps to 0.05 candidate, but anchor σ should be
    // computed at 0.072 exactly. For freeze (ROI-invariant) σ is the same;
    // for PKO σ differs per ROI.
    const freezeRes = computeProveEdge({ ...baseFreeze, currentRoi: 0.072 });
    const pkoRes = computeProveEdge({
      ...baseFreeze,
      format: "pko",
      currentRoi: 0.072,
    });
    expect(freezeRes.anchor.roi).toBe(0.072);
    expect(pkoRes.anchor.roi).toBe(0.072);
    // PKO anchor σ at 0.072 sits between σ at 0.05 and σ at 0.10
    const pkoAt5 = pkoRes.rows.find((r) => r.roi === 0.05)!;
    const pkoAt10 = pkoRes.rows.find((r) => r.roi === 0.10)!;
    expect(pkoRes.anchor.sigma).toBeGreaterThan(pkoAt5.sigma);
    expect(pkoRes.anchor.sigma).toBeLessThan(pkoAt10.sigma);
  });

  it("default bidirectional candidate grid covers both signs", () => {
    expect(PROVE_EDGE_DEFAULT_CANDIDATES.some((r) => r > 0)).toBe(true);
    expect(PROVE_EDGE_DEFAULT_CANDIDATES.some((r) => r < 0)).toBe(true);
    expect(PROVE_EDGE_DEFAULT_CANDIDATES.includes(0)).toBe(false);
  });

  it("|+5 %| and |−5 %| give identical tourneys for freeze (σ ROI-invariant)", () => {
    const result = computeProveEdge({
      ...baseFreeze,
      candidates: [0.05, -0.05],
    });
    expect(result.rows[0].tourneys).toBe(result.rows[1].tourneys);
  });

  it("|+5 %| and |−5 %| differ for PKO (σ asymmetric in ROI sign — b1·ROI term in fit)", () => {
    const result = computeProveEdge({
      ...baseFreeze,
      format: "pko",
      candidates: [0.05, -0.05],
    });
    // σ at +5% > σ at -5% because PKO fit's b1 = +0.673 (winners realize
    // edge through deeper finishes → higher per-tournament variance).
    expect(result.rows[0].sigma).toBeGreaterThan(result.rows[1].sigma);
    // Therefore N to prove +5% > N to prove -5%.
    expect(result.rows[0].tourneys).toBeGreaterThan(result.rows[1].tourneys);
  });
});

describe("computeProveEdge — schedule mode", () => {
  function makeRow(overrides: Partial<TournamentRow> = {}): TournamentRow {
    return {
      id: "r",
      label: "row",
      players: 200,
      buyIn: 50,
      rake: 0.10,
      roi: 0.10,
      payoutStructure: "mtt-standard",
      gameType: "freezeout",
      count: 1,
      ...overrides,
    };
  }

  it("uses schedule's σ from buildExactBreakdown, not single-format σ", () => {
    const schedule: TournamentRow[] = [makeRow({ players: 200, roi: 0.10 })];
    const res = computeProveEdge({
      format: "exact",
      schedule,
      afs: 0, // irrelevant
      rake: 0,
      z: Z95,
      currentRoi: 0,
      candidates: PROVE_EDGE_POSITIVE_CANDIDATES,
    });
    expect(res.effectiveAfs).toBe(200);
    // sigma is positive
    expect(res.anchor.sigma).toBeGreaterThan(0);
    // sigma constant across candidate grid (schedule mode aggregates once)
    const sigmas = new Set(res.rows.map((r) => r.sigma.toFixed(6)));
    expect(sigmas.size).toBe(1);
  });

  it("anchor ROI = cost-weighted mean ROI of the schedule", () => {
    const schedule: TournamentRow[] = [
      // Same buy-in, count weighting: row1 cheap × 4, row2 expensive × 1
      makeRow({ id: "a", buyIn: 10, count: 4, roi: 0.20 }),
      makeRow({ id: "b", buyIn: 100, count: 1, roi: 0.05 }),
    ];
    // Costs: a = 10*1.1*4 = 44, b = 100*1.1*1 = 110. Total = 154.
    // Cost-weighted ROI = (44*0.20 + 110*0.05) / 154 = (8.8 + 5.5)/154 ≈ 0.0928
    const res = computeProveEdge({
      format: "exact",
      schedule,
      afs: 0,
      rake: 0,
      z: Z95,
      currentRoi: 0,
      candidates: PROVE_EDGE_POSITIVE_CANDIDATES,
    });
    expect(res.anchor.roi).toBeCloseTo(0.0928, 3);
  });

  it("schedule with all rows in fit-box → numeric band", () => {
    const schedule: TournamentRow[] = [
      makeRow({ players: 200, roi: 0.10 }),
      makeRow({ id: "p", players: 500, roi: 0.05, gameType: "pko", payoutStructure: "mtt-gg-bounty", bountyFraction: 0.5 }),
    ];
    const res = computeProveEdge({
      format: "exact",
      schedule,
      afs: 0,
      rake: 0,
      z: Z95,
      currentRoi: 0,
      candidates: PROVE_EDGE_POSITIVE_CANDIDATES,
    });
    expect(res.bandPolicy).toBe("numeric");
    expect(res.anchor.sigmaLo).toBeLessThanOrEqual(res.anchor.sigma);
    expect(res.anchor.sigmaHi).toBeGreaterThanOrEqual(res.anchor.sigma);
  });

  it("schedule with one row outside fit-box → band suppressed", () => {
    const schedule: TournamentRow[] = [
      makeRow({ players: 200, roi: 0.10 }),
      // PKO at AFS=25 → below 50 → outside box
      makeRow({
        id: "p",
        players: 25,
        roi: 0.10,
        gameType: "pko",
        payoutStructure: "mtt-gg-bounty",
        bountyFraction: 0.5,
      }),
    ];
    const res = computeProveEdge({
      format: "exact",
      schedule,
      afs: 0,
      rake: 0,
      z: Z95,
      currentRoi: 0,
      candidates: PROVE_EDGE_POSITIVE_CANDIDATES,
    });
    expect(res.bandPolicy).toBe("outside-fit-box");
    res.rows.forEach((r) => {
      expect(r.sigmaLo).toBe(r.sigma);
      expect(r.sigmaHi).toBe(r.sigma);
    });
  });

  it("empty / null schedule degrades gracefully", () => {
    const res = computeProveEdge({
      format: "exact",
      schedule: [],
      afs: 0,
      rake: 0,
      z: Z95,
      currentRoi: 0,
      candidates: [0.10],
    });
    expect(res.bandPolicy).toBe("outside-fit-box");
    expect(res.anchor.sigma).toBe(0);
    // sigma = 0 → tourneys = 0 (formally; user shouldn't see this since
    // the UI hides schedule mode when no schedule is loaded)
    expect(res.rows[0].tourneys).toBe(0);
  });

  it("schedule respects per-row count weighting (zero-count rows ignored)", () => {
    const live: TournamentRow[] = [
      makeRow({ id: "live", count: 1, roi: 0.10 }),
    ];
    const withDeadRow: TournamentRow[] = [
      makeRow({ id: "live", count: 1, roi: 0.10 }),
      makeRow({ id: "dead", count: 0, roi: 0.50 }),
    ];
    const a = computeProveEdge({
      format: "exact",
      schedule: live,
      afs: 0,
      rake: 0,
      z: Z95,
      currentRoi: 0,
      candidates: [0.10],
    });
    const b = computeProveEdge({
      format: "exact",
      schedule: withDeadRow,
      afs: 0,
      rake: 0,
      z: Z95,
      currentRoi: 0,
      candidates: [0.10],
    });
    expect(b.anchor.roi).toBeCloseTo(a.anchor.roi, 6);
  });
});
