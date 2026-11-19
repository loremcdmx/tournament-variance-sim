import { describe, expect, it } from "vitest";
import {
  computeProveEdge,
  defaultProveEdgeFormat,
  proveEdgeDetectionPct,
  proveEdgeRuntimeSigmaPoints,
  PROVE_EDGE_DEFAULT_CANDIDATES,
  PROVE_EDGE_POSITIVE_CANDIDATES,
  rowIsPointOnly,
} from "./proveEdge";
import {
  formatRuntimeSigma,
  hasFormatRuntimeSigma,
  runtimeSigmaCacheSize,
} from "./formatRuntimeSigma";
import { applyGameType } from "./gameType";
import type { TournamentRow } from "./types";
import { buildOceanKoSigmaBand, ciToZ } from "./convergenceMath";
import { compileSchedule } from "./compile";
import { applyItmTarget } from "./itmTarget";
import { validateSchedule } from "./validation";

const computeProveEdgeRows = (input: Parameters<typeof computeProveEdge>[0]) =>
  computeProveEdge(input).rows;

// The two-sided 95 % bar over zero, and the one-sided Φ⁻¹(0.95) power term.
const Z95 = ciToZ(0.95);
const ZPOW95 = ciToZ(0.9);
const DETECT95 = Z95 + ZPOW95;

const baseFreeze = {
  format: "freeze" as const,
  afs: 200,
  rake: 0.10,
  confidence: 0.95,
  currentRoi: 0.10,
  candidates: PROVE_EDGE_POSITIVE_CANDIDATES,
};

describe("computeProveEdgeRows (single-format mode)", () => {
  it("Ocean KO evaluates each ROI through the runtime model without a residual band", () => {
    const result = computeProveEdge({
      ...baseFreeze,
      format: "ocean-ko",
      candidates: [0.05, 0.1],
    });
    expect(result.bandPolicy).toBe("outside-fit-box");
    for (const row of result.rows) {
      const expected = buildOceanKoSigmaBand({
        afs: baseFreeze.afs,
        rake: baseFreeze.rake,
        roi: row.roi,
        totalTicket: 100,
      });
      expect(row.sigma).toBe(expected.s);
      expect(row.tourneys).toBe(Math.ceil(Math.pow(DETECT95 * expected.s / row.roi, 2)));
      expect(row.tourneysLo).toBe(row.tourneys);
      expect(row.tourneysHi).toBe(row.tourneys);
      expect(row.insideFitBox).toBe(false);
    }
  });
  it("Ocean KO tab σ equals Schedule mode for the same one-row Ocean schedule", () => {
    const rake = 8 / 92;
    const base: TournamentRow = {
      id: "ocean",
      players: 1000,
      buyIn: 100 / (1 + rake),
      rake,
      roi: 0.1,
      payoutStructure: "mtt-gg-bounty",
      count: 1,
    };
    const ocean = { ...base, ...applyGameType(base, "ocean-ko"), buyIn: base.buyIn, rake };
    for (const itmTarget of [
      { enabled: false, pct: 0 },
      { enabled: true, pct: 18.7 },
    ]) {
      const tab = computeProveEdge({
        format: "ocean-ko",
        afs: 1000,
        rake,
        oceanKoTotalTicket: 100,
        itmTarget,
        confidence: 0.95,
        currentRoi: 0.1,
        candidates: [0.1],
      });
      const schedule = computeProveEdge({
        format: "exact",
        schedule: applyItmTarget([ocean], itmTarget),
        afs: 0,
        rake: 0,
        confidence: 0.95,
        currentRoi: 0,
        candidates: [0.1],
      });
      expect(tab.anchor.sigma).toBe(schedule.anchor.sigma);
      expect(tab.anchor.tourneys).toBe(schedule.anchor.tourneys);
    }
  });

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

  it("N grows just under quadratically as ROI shrinks (freeze σ falls a little with ROI)", () => {
    // The old flat surface (C1 = 0) gave exactly 4× per halving. The engine
    // row's σ rises with ROI, so halving the ROI quadruples the 1/ROI² factor
    // but shaves the σ² factor: the ratio sits below 4, not on it.
    const rows = computeProveEdgeRows(baseFreeze);
    const r10 = rows.find((r) => r.roi === 0.10)!;
    const r5 = rows.find((r) => r.roi === 0.05)!;
    const r25 = rows.find((r) => r.roi === 0.025)!;
    expect(r5.tourneys / r10.tourneys).toBeGreaterThan(3.4);
    expect(r5.tourneys / r10.tourneys).toBeLessThan(4.0);
    expect(r25.tourneys / r5.tourneys).toBeGreaterThan(3.4);
    expect(r25.tourneys / r5.tourneys).toBeLessThan(4.0);
  });

  it("sizes for detection power: N = ((z + Φ⁻¹(C))·σ/ROI)², 3.4× the 50%-power median at 95 %", () => {
    const r10 = computeProveEdgeRows(baseFreeze).find((r) => r.roi === 0.10)!;
    const powered = Math.ceil(Math.pow((DETECT95 * r10.sigma) / 0.10, 2));
    const naiveMedian = Math.ceil(Math.pow((Z95 * r10.sigma) / 0.10, 2));
    expect(r10.tourneys).toBe(powered);
    // ((1.959964 + 1.644854) / 1.959964)² = 3.383; the two ceilings move it by under 1e-4.
    expect(r10.tourneys / naiveMedian).toBeGreaterThan(3.38);
    expect(r10.tourneys / naiveMedian).toBeLessThan(3.39);
  });

  it("a player whose true ROI is the tested one clears the C bar with probability C", () => {
    // That player's mean sits |roi|·√N/σ standard errors over zero and the bar
    // at z = Φ⁻¹((1 + C)/2), so the chance of clearing it is Φ(|roi|·√N/σ − z).
    // ciToZ(c) = Φ⁻¹((1 + c)/2), so Φ(x) = C exactly when x = ciToZ(2C − 1).
    // N is a ceiling, which can only raise the margin, by less than one
    // tournament's worth: |roi|·(√N − √(N − 1))/σ.
    for (const ciPct of [50, 60, 75, 90, 95, 99, 99.9]) {
      const c = ciPct / 100;
      const z = ciToZ(c);
      const rows = computeProveEdgeRows({
        ...baseFreeze,
        confidence: c,
        candidates: [0.10, 0.01, -0.05],
      });
      for (const r of rows) {
        const absRoi = Math.abs(r.roi);
        const margin = (absRoi * Math.sqrt(r.tourneys)) / r.sigma - z;
        const ceilSlack = (absRoi * (Math.sqrt(r.tourneys) - Math.sqrt(r.tourneys - 1))) / r.sigma;
        expect(margin, `${ciPct} % at ${r.roi}`).toBeGreaterThanOrEqual(ciToZ(2 * c - 1) - 1e-9);
        expect(margin - ciToZ(2 * c - 1), `${ciPct} % at ${r.roi}`).toBeLessThanOrEqual(ceilSlack + 1e-9);
        // A margin of z itself would deliver (1 + C)/2, not C.
        expect(margin, `${ciPct} % at ${r.roi}`).toBeLessThan(z - 0.2);
      }
      expect(proveEdgeDetectionPct(ciPct)).toBe(ciPct);
    }
  });

  it("below 50 % the power term stays at 0: the bar sits on the tested ROI, a 50 % chance", () => {
    for (const ciPct of [30, 40, 49]) {
      const c = ciPct / 100;
      const r10 = computeProveEdgeRows({ ...baseFreeze, confidence: c }).find((r) => r.roi === 0.10)!;
      expect(r10.tourneys).toBe(Math.ceil(Math.pow((ciToZ(c) * r10.sigma) / 0.10, 2)));
      expect(proveEdgeDetectionPct(ciPct)).toBe(50);
    }
    const at50 = computeProveEdgeRows({ ...baseFreeze, confidence: 0.5 })[3];
    const at49 = computeProveEdgeRows({ ...baseFreeze, confidence: 0.49 })[3];
    expect(at49.tourneys).toBeLessThan(at50.tourneys);
    expect(at49.tourneys / at50.tourneys).toBeGreaterThan(0.95);
  });

  it("freeze σ grows with ROI across the candidate grid (the old fit was flat in ROI)", () => {
    // Candidates run from +30 % down to +0.1 %; σ must fall monotonically.
    const rows = computeProveEdgeRows(baseFreeze);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].sigma).toBeLessThan(rows[i - 1].sigma);
    }
    const r30 = rows.find((r) => r.roi === 0.30)!;
    const r1 = rows.find((r) => r.roi === 0.01)!;
    expect(r30.sigma).toBeGreaterThan(r1.sigma * 1.1);
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

  it("|−5 %| needs fewer tournaments than |+5 %| for freeze (σ rises with ROI)", () => {
    const positive = computeProveEdgeRows({ ...baseFreeze, candidates: [0.05] })[0];
    const negative = computeProveEdgeRows({ ...baseFreeze, candidates: [-0.05] })[0];
    expect(negative.sigma).toBeLessThan(positive.sigma);
    expect(negative.tourneys).toBeLessThan(positive.tourneys);
  });

  it("rake adjustment scales σ proportionally", () => {
    const at10 = computeProveEdgeRows({ ...baseFreeze, rake: 0.10 })[0];
    const at5 = computeProveEdgeRows({ ...baseFreeze, rake: 0.05 })[0];
    expect(at5.sigma).toBeGreaterThan(at10.sigma);
  });

  it("higher confidence requires more tournaments quadratically", () => {
    const at95 = computeProveEdgeRows({ ...baseFreeze, confidence: 0.95 })[3];
    const at99 = computeProveEdgeRows({ ...baseFreeze, confidence: 0.99 })[3];
    // ((2.575829 + 2.326348) / (1.959964 + 1.644854))² = 1.8492.
    const ratio = at99.tourneys / at95.tourneys;
    expect(ratio).toBeGreaterThan(1.84);
    expect(ratio).toBeLessThan(1.86);
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

describe("the highlight keeps the sign of the tested ROI", () => {
  it("a losing ROI on the winning-only grid highlights nothing", () => {
    const hidden = computeProveEdge({ ...baseFreeze, currentRoi: -0.10 });
    expect(hidden.rows.filter((r) => r.isCurrent)).toHaveLength(0);
    expect(hidden.anchor.roi).toBe(-0.10);
    const shown = computeProveEdge({
      ...baseFreeze,
      currentRoi: -0.10,
      candidates: PROVE_EDGE_DEFAULT_CANDIDATES,
    });
    expect(shown.rows.filter((r) => r.isCurrent).map((r) => r.roi)).toEqual([-0.10]);
  });

  it("a losing schedule highlights nothing on the winning-only grid", () => {
    const losing = applyItmTarget(
      [{
        id: "a",
        label: "a",
        players: 500,
        buyIn: 10,
        rake: 0.1,
        roi: -0.08,
        payoutStructure: "mtt-standard",
        gameType: "freezeout",
        count: 1,
      }],
      { enabled: false, pct: 0 },
    );
    const input = {
      format: "exact" as const,
      schedule: losing,
      afs: 0,
      rake: 0,
      confidence: 0.95,
      currentRoi: 0,
    };
    const hidden = computeProveEdge({ ...input, candidates: PROVE_EDGE_POSITIVE_CANDIDATES });
    expect(hidden.rows.some((r) => r.isCurrent)).toBe(false);
    const shown = computeProveEdge({ ...input, candidates: PROVE_EDGE_DEFAULT_CANDIDATES });
    expect(shown.rows.filter((r) => r.isCurrent).map((r) => r.roi)).toEqual([-0.10]);
  });

  it("same-sign snapping is unchanged", () => {
    const up = computeProveEdge({ ...baseFreeze, currentRoi: 1.0 });
    expect(up.rows.filter((r) => r.isCurrent).map((r) => r.roi)).toEqual([0.30]);
  });
});

describe("an ROI the pinned-ITM row cannot pay is flagged, not printed as reached", () => {
  // Field 50, fee 20 %: the paid share and the first prize cap a freezeout at
  // about +84 %, so Run (validateSchedule) blocks a +100 % row.
  const corner = { ...baseFreeze, afs: 50, rake: 0.2, currentRoi: 1.0 };

  it("the anchor carries roiReached=false and no range; a reachable fee keeps both", () => {
    const blocked = computeProveEdge(corner);
    expect(blocked.anchor.roiReached).toBe(false);
    expect(blocked.anchor.insideFitBox).toBe(false);
    expect(blocked.bandPolicy).toBe("outside-fit-box");
    expect(blocked.anchor.tourneysLo).toBe(blocked.anchor.tourneys);
    const fine = computeProveEdge({ ...corner, rake: 0.1 });
    expect(fine.anchor.roiReached).toBe(true);
    expect(fine.bandPolicy).toBe("numeric");
  });

  it("candidate rows below what a 50 % global ITM forces are flagged, the rest keep their band", () => {
    const result = computeProveEdge({
      ...baseFreeze,
      itmTarget: { enabled: true, pct: 50 },
      currentRoi: 0.6,
      candidates: [0.6, 0.45, 0.2, 0.1],
    });
    // At field 200 a 50 % ITM cannot pay less than about +38 %.
    expect(result.rows.map((r) => r.roiReached)).toEqual([true, true, false, false]);
    // Out of reach the row saturates: two labels, one σ, so it is neither label's.
    expect(result.rows[2].sigma).toBe(result.rows[3].sigma);
    for (const r of result.rows.filter((row) => !row.roiReached)) {
      expect(r.tourneysLo).toBe(r.tourneys);
      expect(r.tourneysHi).toBe(r.tourneys);
      expect(rowIsPointOnly(result, r)).toBe(false);
    }
    expect(result.bandPolicy).toBe("numeric");
    expect(result.rows[0].tourneysLo).toBeLessThan(result.rows[0].tourneys);
  });

  it("a model that ignores the row ROI is never flagged (Run accepts it)", () => {
    const result = computeProveEdge({ ...corner, finishModel: { id: "uniform" } });
    expect(result.anchor.roiReached).toBe(true);
  });

  it("the Ocean KO tab is gated on its pinned row as Run gates it", () => {
    // Field 300 at a 50 % global ITM: an Ocean row cannot be tuned down to −30 %.
    const ocean = {
      format: "ocean-ko" as const,
      afs: 300,
      rake: 0.087,
      oceanKoTotalTicket: 100,
      itmTarget: { enabled: true, pct: 50 },
      confidence: 0.95,
      currentRoi: -0.3,
      candidates: [-0.3, 0.1],
    };
    const result = computeProveEdge(ocean);
    const runGate = (roi: number) => {
      const base: TournamentRow = {
        id: "o",
        players: 300,
        buyIn: 100 / 1.087,
        rake: 0.087,
        roi,
        payoutStructure: "mtt-gg-bounty",
        count: 1,
      };
      const row = { ...base, ...applyGameType(base, "ocean-ko"), buyIn: base.buyIn, rake: base.rake };
      const [pinned] = applyItmTarget([row], ocean.itmTarget);
      return validateSchedule([pinned], { id: "power-law" }).ok;
    };
    expect(runGate(-0.3)).toBe(false);
    expect(runGate(0.1)).toBe(true);
    expect(result.anchor.roiReached).toBe(false);
    expect(result.rows.map((r) => r.roiReached)).toEqual([false, true]);
    expect(computeProveEdge({ ...ocean, itmTarget: { enabled: false, pct: 0 } }).anchor.roiReached).toBe(true);
  });
});

describe("proveEdgeRuntimeSigmaPoints (card warm-up list)", () => {
  it("lists exactly the σ computeProveEdge reads, so a warmed table is cache-only", () => {
    for (const format of ["freeze", "pko", "mystery", "mystery-royale"] as const) {
      const input = {
        ...baseFreeze,
        format,
        afs: 12_345,
        rake: 0.07,
        currentRoi: 0.123,
        candidates: PROVE_EDGE_DEFAULT_CANDIDATES,
      };
      const points = proveEdgeRuntimeSigmaPoints(input);
      expect(points).toHaveLength(PROVE_EDGE_DEFAULT_CANDIDATES.length + 1);
      for (const { format: f, point } of points) formatRuntimeSigma(f, point);
      expect(points.every(({ format: f, point }) => hasFormatRuntimeSigma(f, point))).toBe(true);
      const before = runtimeSigmaCacheSize();
      const result = computeProveEdge(input);
      expect(runtimeSigmaCacheSize()).toBe(before);
      expect(result.anchor.sigma).toBe(formatRuntimeSigma(format, points[points.length - 1].point));
    }
  });

  it("is empty for schedule mode and Ocean KO, which do not use the runtime σ cache", () => {
    expect(proveEdgeRuntimeSigmaPoints({ ...baseFreeze, format: "ocean-ko" })).toEqual([]);
    expect(proveEdgeRuntimeSigmaPoints({ ...baseFreeze, format: "exact", schedule: [] })).toEqual([]);
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
    // computed at 0.072 exactly; σ differs per ROI in both formats.
    const freezeRes = computeProveEdge({ ...baseFreeze, currentRoi: 0.072 });
    const pkoRes = computeProveEdge({
      ...baseFreeze,
      format: "pko",
      currentRoi: 0.072,
    });
    expect(freezeRes.anchor.roi).toBe(0.072);
    expect(pkoRes.anchor.roi).toBe(0.072);
    const freezeAt5 = freezeRes.rows.find((r) => r.roi === 0.05)!;
    const freezeAt10 = freezeRes.rows.find((r) => r.roi === 0.10)!;
    expect(freezeRes.anchor.sigma).toBeGreaterThan(freezeAt5.sigma);
    expect(freezeRes.anchor.sigma).toBeLessThan(freezeAt10.sigma);
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

  it("|+5 %| and |−5 %| differ for freeze too (runtime σ rises with ROI)", () => {
    const result = computeProveEdge({
      ...baseFreeze,
      candidates: [0.05, -0.05],
    });
    expect(result.rows[0].sigma).toBeGreaterThan(result.rows[1].sigma);
    expect(result.rows[0].tourneys).toBeGreaterThan(result.rows[1].tourneys);
  });

  it("|+5 %| and |−5 %| differ for PKO (σ asymmetric in ROI sign — b1·ROI term in fit)", () => {
    const result = computeProveEdge({
      ...baseFreeze,
      format: "pko",
      candidates: [0.05, -0.05],
    });
    // σ at +5% > σ at -5%: winners realize their edge through deeper
    // finishes, which carry more per-tournament variance.
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
      confidence: 0.95,
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
      confidence: 0.95,
      currentRoi: 0,
      candidates: PROVE_EDGE_POSITIVE_CANDIDATES,
    });
    expect(res.anchor.roi).toBeCloseTo(0.0928, 3);
  });

  it("anchor follows the engine's compiled ROI when the finish model ignores the row ROI", () => {
    const schedule = applyItmTarget(
      [makeRow({ players: 500, buyIn: 10, roi: 0.10 })],
      { enabled: false, pct: 0 },
    );
    const engineRoi = (id: "freeze-realdata-linear" | "uniform" | "power-law") => {
      const c = compileSchedule({
        schedule, scheduleRepeats: 1, samples: 1, bankroll: 1, seed: 1, finishModel: { id },
      });
      return c.expectedProfit / c.totalBuyIn;
    };
    const anchorFor = (id: "freeze-realdata-linear" | "uniform" | "power-law") =>
      computeProveEdge({
        format: "exact",
        schedule,
        finishModel: { id },
        afs: 0,
        rake: 0,
        confidence: 0.95,
        currentRoi: 0,
        candidates: PROVE_EDGE_POSITIVE_CANDIDATES,
      }).anchor;

    const linear = anchorFor("freeze-realdata-linear");
    expect(engineRoi("freeze-realdata-linear")).toBeGreaterThan(0.15);
    expect(linear.roi).toBe(engineRoi("freeze-realdata-linear"));
    expect(linear.tourneys).toBe(
      Math.ceil(Math.pow((DETECT95 * linear.sigma) / linear.roi, 2)),
    );
    expect(anchorFor("uniform").roi).toBeCloseTo(-1 / 11, 9);
    // The calibrated model still reads the typed ROI.
    expect(anchorFor("power-law").roi).toBe(0.10);
  });

  it("a bounty row on a fixed-shape model keeps its typed ROI (the bounty closes the gap)", () => {
    const pko = makeRow({
      id: "p", players: 500, gameType: "pko", payoutStructure: "mtt-gg-bounty", bountyFraction: 0.5,
    });
    const res = computeProveEdge({
      format: "exact",
      schedule: applyItmTarget([pko], { enabled: false, pct: 0 }),
      finishModel: { id: "pko-realdata-linear" },
      afs: 0,
      rake: 0,
      confidence: 0.95,
      currentRoi: 0,
      candidates: PROVE_EDGE_POSITIVE_CANDIDATES,
    });
    expect(res.anchor.roi).toBeCloseTo(0.10, 9);
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
      confidence: 0.95,
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
      confidence: 0.95,
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
      confidence: 0.95,
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
      confidence: 0.95,
      currentRoi: 0,
      candidates: [0.10],
    });
    const b = computeProveEdge({
      format: "exact",
      schedule: withDeadRow,
      afs: 0,
      rake: 0,
      confidence: 0.95,
      currentRoi: 0,
      candidates: [0.10],
    });
    expect(b.anchor.roi).toBeCloseTo(a.anchor.roi, 6);
  });
});

describe("defaultProveEdgeFormat — the tab follows the schedule until the user picks one", () => {
  const freeze: TournamentRow = {
    id: "f",
    players: 200,
    buyIn: 10,
    rake: 0.1,
    roi: 0.1,
    payoutStructure: "mtt-standard",
    gameType: "freezeout",
    count: 10,
  };
  const pko: TournamentRow = { ...freeze, id: "p", ...applyGameType(freeze, "pko"), count: 30 };

  it("opens on the format played most, and re-derives when the schedule changes", () => {
    expect(defaultProveEdgeFormat([freeze], "avg")).toBe("freeze");
    expect(defaultProveEdgeFormat([pko], "avg")).toBe("pko");
    expect(defaultProveEdgeFormat([freeze, pko], "avg")).toBe("pko");
    expect(defaultProveEdgeFormat([{ ...freeze, count: 50 }, pko], "avg")).toBe("freeze");
  });

  it("opens on the Schedule tab after a run, but only when there is a schedule", () => {
    expect(defaultProveEdgeFormat([freeze], "exact")).toBe("exact");
    expect(defaultProveEdgeFormat([], "exact")).toBe("pko");
    expect(defaultProveEdgeFormat(null, "avg")).toBe("pko");
  });
});
