import { describe, expect, it } from "vitest";
import {
  computeProveEdgeRows,
  PROVE_EDGE_DEFAULT_CANDIDATES,
} from "./proveEdge";

const Z95 = 1.959964; // ≈ 95% two-tailed

describe("computeProveEdgeRows", () => {
  const baseFreeze = {
    format: "freeze" as const,
    afs: 200,
    rake: 0.10,
    z: Z95,
    currentRoi: 0.10,
    candidates: PROVE_EDGE_DEFAULT_CANDIDATES,
  };

  it("returns one row per candidate", () => {
    const rows = computeProveEdgeRows(baseFreeze);
    expect(rows).toHaveLength(PROVE_EDGE_DEFAULT_CANDIDATES.length);
    rows.forEach((r, i) =>
      expect(r.roi).toBe(PROVE_EDGE_DEFAULT_CANDIDATES[i]),
    );
  });

  it("highlights the row closest to currentRoi", () => {
    const rows = computeProveEdgeRows({ ...baseFreeze, currentRoi: 0.10 });
    const current = rows.find((r) => r.isCurrent);
    expect(current?.roi).toBe(0.10);
    expect(rows.filter((r) => r.isCurrent)).toHaveLength(1);
  });

  it("snaps highlight to nearest candidate when currentRoi is between grid points", () => {
    const rows = computeProveEdgeRows({ ...baseFreeze, currentRoi: 0.072 });
    // Closer to 0.05 than 0.10
    expect(rows.find((r) => r.isCurrent)?.roi).toBe(0.05);
  });

  it("N grows quadratically as ROI shrinks (freeze: σ is ROI-invariant)", () => {
    const rows = computeProveEdgeRows(baseFreeze);
    const r10 = rows.find((r) => r.roi === 0.10)!;
    const r5 = rows.find((r) => r.roi === 0.05)!;
    const r25 = rows.find((r) => r.roi === 0.025)!;
    // Halving ROI quadruples N (within ceiling rounding)
    const ratio5to10 = r5.tourneys / r10.tourneys;
    const ratio25to5 = r25.tourneys / r5.tourneys;
    expect(ratio5to10).toBeGreaterThan(3.9);
    expect(ratio5to10).toBeLessThan(4.1);
    expect(ratio25to5).toBeGreaterThan(3.9);
    expect(ratio25to5).toBeLessThan(4.1);
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

  it("ROI = 0 yields infinite tourneys (avoided here — defaults skip 0)", () => {
    const rows = computeProveEdgeRows({
      ...baseFreeze,
      candidates: [0, 0.05],
    });
    expect(rows[0].tourneys).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isFinite(rows[1].tourneys)).toBe(true);
  });

  it("|−5 %| matches |+5 %| — losing edge is just as detectable as winning edge of same magnitude", () => {
    const positive = computeProveEdgeRows({
      ...baseFreeze,
      candidates: [0.05],
    })[0];
    const negative = computeProveEdgeRows({
      ...baseFreeze,
      candidates: [-0.05],
    })[0];
    // For freeze (ROI-invariant σ) the answer is identical
    expect(negative.tourneys).toBe(positive.tourneys);
  });

  it("rake adjustment scales σ proportionally", () => {
    const at10 = computeProveEdgeRows({ ...baseFreeze, rake: 0.10 })[0];
    const at5 = computeProveEdgeRows({ ...baseFreeze, rake: 0.05 })[0];
    // Lower rake → bigger denominator (1+rake) on payouts, but rakeScale
    // = (1+fitRake)/(1+rake) so smaller user rake → bigger rakeScale →
    // bigger sigma.
    expect(at5.sigma).toBeGreaterThan(at10.sigma);
  });

  it("fields = tourneys / afs", () => {
    const rows = computeProveEdgeRows({ ...baseFreeze, afs: 500 });
    rows.forEach((r) => {
      if (Number.isFinite(r.tourneys)) {
        expect(r.fields).toBeCloseTo(r.tourneys / 500, 6);
      }
    });
  });

  it("higher CI (bigger z) requires more tournaments quadratically", () => {
    const at95 = computeProveEdgeRows({ ...baseFreeze, z: 1.96 })[3]; // 0.10
    const at99 = computeProveEdgeRows({ ...baseFreeze, z: 2.576 })[3];
    const ratio = at99.tourneys / at95.tourneys;
    // (2.576/1.96)² = 1.727
    expect(ratio).toBeGreaterThan(1.70);
    expect(ratio).toBeLessThan(1.75);
  });

  it("MBR format works at AFS=18 with its narrow ROI box", () => {
    const rows = computeProveEdgeRows({
      ...baseFreeze,
      format: "mystery-royale",
      afs: 18,
      candidates: [0.10, 0.05, 0.025, 0.01],
    });
    expect(rows).toHaveLength(4);
    rows.forEach((r) => {
      expect(Number.isFinite(r.tourneys)).toBe(true);
      expect(r.tourneys).toBeGreaterThan(0);
    });
  });
});
