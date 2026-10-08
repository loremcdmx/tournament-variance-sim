import { describe, expect, it } from "vitest";
import { battleRoyaleRowFromTotalTicket } from "./battleRoyaleTicket";
import {
  buildExactBreakdown,
  ciToZ,
  computeConvergenceRows,
  type MixTuple,
} from "./convergenceMath";
import {
  buildFormatRuntimeRow,
  buildRuntimeSigmaOverrides,
  formatRuntimeSigma,
  formatRuntimeSigmaBand,
  hasFormatRuntimeSigma,
  runtimeSigmaBandResid,
  type RuntimeSigmaFormat,
} from "./formatRuntimeSigma";
import { applyGameType } from "./gameType";
import { applyItmTarget, type ItmTargetConfig } from "./itmTarget";
import { computeProveEdge, proveEdgeRuntimeSigmaPoints } from "./proveEdge";
import { RUNTIME_SIGMA_BANDS } from "./runtimeSigmaBands";
import type { GameType, TournamentRow } from "./types";

const z95 = ciToZ(0.95);
const FORMATS: RuntimeSigmaFormat[] = ["freeze", "pko", "mystery", "mystery-royale"];
const GAME_TYPE: Record<RuntimeSigmaFormat, GameType> = {
  freeze: "freezeout",
  pko: "pko",
  mystery: "mystery",
  "mystery-royale": "mystery-royale",
};

/**
 * The row the schedule editor produces when a user picks the format on a
 * fresh freezeout row, run through the run path's ITM defaults. Written out
 * independently of `buildFormatRuntimeRow` so the grid below compares two
 * constructions of the same schedule, not a function with itself.
 */
function editorRow(
  format: RuntimeSigmaFormat,
  afs: number,
  roi: number,
  rake: number,
  itmTarget: ItmTargetConfig = { enabled: false, pct: 0 },
): TournamentRow {
  const isBr = format === "mystery-royale";
  const fresh: TournamentRow = {
    id: "editor-row",
    label: "editor-row",
    players: isBr ? 18 : afs,
    buyIn: isBr ? battleRoyaleRowFromTotalTicket(10).buyIn : 25,
    rake,
    roi,
    payoutStructure: "mtt-standard",
    gameType: "freezeout",
    count: 1,
  };
  const picked: TournamentRow = {
    ...fresh,
    ...applyGameType(fresh, GAME_TYPE[format]),
    rake,
    roi,
    buyIn: fresh.buyIn,
  };
  return applyItmTarget([picked], itmTarget)[0];
}

function mixFor(format: RuntimeSigmaFormat): MixTuple {
  return format === "pko" ? [0, 1, 0] : format === "mystery" ? [0, 0, 1] : [1, 0, 0];
}

describe("planning cards share one σ with schedule mode", () => {
  const AFS = [100, 1000, 5000];
  const ROI = [-0.1, 0, 0.1, 0.3];
  const RAKE = [0.08, 0.1];

  for (const format of FORMATS) {
    const fields = format === "mystery-royale" ? [18] : AFS;
    it(`${format}: convergence chip σ = prove-edge σ = schedule σ across the grid`, () => {
      for (const afs of fields) {
        for (const roi of ROI) {
          for (const rake of RAKE) {
            const label = `${format} afs=${afs} roi=${roi} rake=${rake}`;
            const schedule = buildExactBreakdown([editorRow(format, afs, roi, rake)])!
              .sigmaEff;

            const overrides = buildRuntimeSigmaOverrides({
              format,
              mix: mixFor(format),
              point: { afs, roi, rake },
            })!;
            const chip = overrides[format]!.s;

            const proveEdge = computeProveEdge({
              format,
              afs,
              rake,
              z: z95,
              currentRoi: roi,
              candidates: [roi],
            });

            expect(Math.abs(chip - schedule) / schedule, label).toBeLessThan(1e-9);
            expect(
              Math.abs(proveEdge.anchor.sigma - schedule) / schedule,
              label,
            ).toBeLessThan(1e-9);
            expect(
              Math.abs(proveEdge.rows[0].sigma - schedule) / schedule,
              label,
            ).toBeLessThan(1e-9);

            // The table the chip renders sizes its volume off that same σ.
            const row = computeConvergenceRows({
              afs,
              z: z95,
              roi,
              mix: mixFor(format),
              format,
              rakePct: rake * 100,
              sigmaOverrides: overrides,
            }).find((r) => r.targetPct === 0.05)!;
            expect(row.tourneys, label).toBe(
              Math.ceil(Math.pow((z95 * schedule) / 0.05, 2)),
            );
          }
        }
      }
    });
  }
});

describe("runtime σ replaces the stale synthetic rows", () => {
  it("Battle Royale uses the $10 tier envelopes, not the $25 table", () => {
    const sigma = formatRuntimeSigma("mystery-royale", {
      afs: 18,
      roi: 0.1,
      rake: 0.08,
    })!;
    // The old chip built a $50 row (σ ≈ 5.79 BI); a $10 BR row sits near 7.8.
    expect(sigma).toBeGreaterThan(7.6);
    expect(sigma).toBeLessThan(8.1);
    const row = buildFormatRuntimeRow("mystery-royale", { afs: 18, roi: 0.1, rake: 0.08 });
    expect(row.buyIn).toBeCloseTo(battleRoyaleRowFromTotalTicket(10).buyIn, 12);
    expect(row.players).toBe(18);
    expect(row.itmRate).toBe(0.18);
    expect(row.payoutStructure).toBe("battle-royale");
  });

  it("Battle Royale ignores the field argument — the lobby is always 18", () => {
    const at18 = formatRuntimeSigma("mystery-royale", { afs: 18, roi: 0.05, rake: 0.08 });
    const at500 = formatRuntimeSigma("mystery-royale", { afs: 500, roi: 0.05, rake: 0.08 });
    expect(at500).toBe(at18);
  });

  it("Mystery does not inherit the PKO head-size channel", () => {
    const row = buildFormatRuntimeRow("mystery", { afs: 1000, roi: 0.1, rake: 0.1 });
    expect(row.pkoHeadVar).toBeUndefined();
    expect(row.mysteryBountyVariance).toBe(2.0);
    expect(row.payoutStructure).toBe("mtt-gg-mystery");
  });

  it("freeze σ follows ROI (the old surface was flat in ROI)", () => {
    const at10 = computeProveEdge({
      format: "freeze",
      afs: 1000,
      rake: 0.1,
      z: z95,
      currentRoi: 0.1,
      candidates: [0.1],
    }).anchor;
    const at30 = computeProveEdge({
      format: "freeze",
      afs: 1000,
      rake: 0.1,
      z: z95,
      currentRoi: 0.3,
      candidates: [0.3],
    }).anchor;
    expect(at30.sigma).toBeGreaterThan(at10.sigma * 1.1);
    // The flat fit answered 12 097 here; the engine row needs about 16 000.
    expect(at30.tourneys).toBeGreaterThan(15_500);
    expect(at30.tourneys).toBeLessThan(16_500);
  });

  it("synthetic rows get the run path's ITM default, not a free finish shape", () => {
    for (const format of ["freeze", "pko", "mystery"] as const) {
      const row = buildFormatRuntimeRow(format, { afs: 1000, roi: 0.1, rake: 0.1 });
      expect(row.itmRate, format).toBeGreaterThan(0);
      expect(row.itmRate, format).toBeLessThan(0.3);
    }
    const pinned = formatRuntimeSigma("freeze", { afs: 1000, roi: 0.1, rake: 0.1 })!;
    const free = buildExactBreakdown([
      { ...buildFormatRuntimeRow("freeze", { afs: 1000, roi: 0.1, rake: 0.1 }), itmRate: undefined },
    ])!.sigmaEff;
    expect(Math.abs(pinned - free) / free).toBeGreaterThan(0.01);
  });

  it("an enabled global ITM target changes the row the same way the run path does", () => {
    const off = buildFormatRuntimeRow("pko", { afs: 1000, roi: 0.1, rake: 0.1 });
    const on = buildFormatRuntimeRow("pko", {
      afs: 1000,
      roi: 0.1,
      rake: 0.1,
      itmTarget: { enabled: true, pct: 18.7 },
    });
    expect(on.itmRate).toBeCloseTo(0.187, 12);
    expect(off.itmRate).not.toBeCloseTo(0.187, 6);
  });
});

describe("buildRuntimeSigmaOverrides", () => {
  const point = { afs: 1000, roi: 0.1, rake: 0.1 };

  it("single formats override only themselves", () => {
    for (const format of FORMATS) {
      const overrides = buildRuntimeSigmaOverrides({ format, mix: [1, 0, 0], point })!;
      expect(Object.keys(overrides)).toEqual([format]);
    }
  });

  it("mix overrides exactly the components that carry weight", () => {
    const all = buildRuntimeSigmaOverrides({ format: "mix", mix: [0.2, 0.3, 0.5], point })!;
    expect(Object.keys(all).sort()).toEqual(["freeze", "mystery", "pko"]);
    const two = buildRuntimeSigmaOverrides({ format: "mix", mix: [0.5, 0, 0.5], point })!;
    expect(Object.keys(two).sort()).toEqual(["freeze", "mystery"]);
  });

  it("exact and Ocean tabs get no runtime override from this helper", () => {
    expect(buildRuntimeSigmaOverrides({ format: "exact", mix: [1, 0, 0], point })).toBeUndefined();
    expect(buildRuntimeSigmaOverrides({ format: "ocean-ko", mix: [1, 0, 0], point })).toBeUndefined();
  });

  it("bands are the calibrated residual around the runtime point", () => {
    for (const format of FORMATS) {
      expect(runtimeSigmaBandResid(format)).toBe(RUNTIME_SIGMA_BANDS[format].resid);
      const formatPoint =
        format === "mystery-royale" ? { afs: 18, roi: 0.1, rake: 0.08 } : point;
      const band = buildRuntimeSigmaOverrides({
        format,
        mix: mixFor(format),
        point: formatPoint,
      })![format]!;
      const resid = RUNTIME_SIGMA_BANDS[format].resid;
      expect(band.lo, format).toBeCloseTo(band.s * (1 - resid), 12);
      expect(band.hi, format).toBeCloseTo(band.s * (1 + resid), 12);
      expect(formatRuntimeSigmaBand(format, formatPoint)).toEqual(band);
    }
  });

  it("memoized σ is stable across repeated calls", () => {
    const a = formatRuntimeSigma("mystery", { afs: 777, roi: 0.123, rake: 0.09 });
    const b = formatRuntimeSigma("mystery", { afs: 777, roi: 0.123, rake: 0.09 });
    expect(b).toBe(a);
  });
});

describe("one band for the chip, the prove-edge card and a one-row schedule", () => {
  const defaults: Record<RuntimeSigmaFormat, { afs: number; rake: number }> = {
    freeze: { afs: 1000, rake: 0.1 },
    pko: { afs: 1000, rake: 0.1 },
    mystery: { afs: 1000, rake: 0.1 },
    "mystery-royale": { afs: 18, rake: 0.08 },
  };

  for (const format of FORMATS) {
    it(`${format}: the three paths show the same half-width, equal to the calibration table`, () => {
      const { afs, rake } = defaults[format];
      const roi = 0.1;
      const resid = RUNTIME_SIGMA_BANDS[format].resid;

      const chip = buildRuntimeSigmaOverrides({
        format,
        mix: mixFor(format),
        point: { afs, roi, rake },
      })![format]!;
      const proveEdge = computeProveEdge({
        format,
        afs,
        rake,
        z: z95,
        currentRoi: roi,
        candidates: [roi],
      });
      const schedule = buildExactBreakdown([editorRow(format, afs, roi, rake)])!;

      expect(proveEdge.bandPolicy).toBe("numeric");
      expect(chip.hi / chip.s - 1).toBeCloseTo(resid, 12);
      expect(1 - chip.lo / chip.s).toBeCloseTo(resid, 12);
      expect(proveEdge.anchor.sigmaHi / proveEdge.anchor.sigma - 1).toBeCloseTo(resid, 12);
      expect(1 - proveEdge.anchor.sigmaLo / proveEdge.anchor.sigma).toBeCloseTo(resid, 12);
      expect(proveEdge.rows[0].sigmaHi / proveEdge.rows[0].sigma - 1).toBeCloseTo(resid, 12);
      expect(schedule.sigmaEffHi / schedule.sigmaEff - 1).toBeCloseTo(resid, 12);
      expect(1 - schedule.sigmaEffLo / schedule.sigmaEff).toBeCloseTo(resid, 12);

      // The volumes printed from those σ follow the same band in both cards.
      const chipRow = computeConvergenceRows({
        afs,
        z: z95,
        roi,
        mix: mixFor(format),
        format,
        rakePct: rake * 100,
        sigmaOverrides: { [format]: chip },
      }).find((r) => r.targetPct === 0.05)!;
      expect(chipRow.tourneysLo).toBe(Math.ceil(Math.pow((z95 * chip.lo) / 0.05, 2)));
      expect(chipRow.tourneysHi).toBe(Math.ceil(Math.pow((z95 * chip.hi) / 0.05, 2)));
      expect(proveEdge.anchor.tourneysLo).toBe(
        Math.ceil(Math.pow((2 * z95 * proveEdge.anchor.sigmaLo) / roi, 2)),
      );
      expect(proveEdge.anchor.tourneysHi).toBe(
        Math.ceil(Math.pow((2 * z95 * proveEdge.anchor.sigmaHi) / roi, 2)),
      );
    });
  }
});

describe("the global ITM target reaches the planning cards", () => {
  const target: ItmTargetConfig = { enabled: true, pct: 18.7 };
  const off: ItmTargetConfig = { enabled: false, pct: 0 };
  const pointFor = (format: RuntimeSigmaFormat) => ({
    afs: format === "mystery-royale" ? 18 : 1000,
    roi: 0.1,
    rake: format === "mystery-royale" ? 0.08 : 0.1,
  });

  for (const format of FORMATS) {
    it(`${format}: chip σ = prove-edge σ = schedule σ of the equivalent row, target on`, () => {
      const { afs, roi, rake } = pointFor(format);
      const schedule = buildExactBreakdown([editorRow(format, afs, roi, rake, target)])!.sigmaEff;
      const chip = buildRuntimeSigmaOverrides({
        format,
        mix: mixFor(format),
        point: { afs, roi, rake, itmTarget: target },
      })![format]!.s;
      const proveEdge = computeProveEdge({
        format,
        afs,
        rake,
        itmTarget: target,
        z: z95,
        currentRoi: roi,
        candidates: [roi],
      });
      expect(Math.abs(chip - schedule) / schedule).toBeLessThan(1e-9);
      expect(Math.abs(proveEdge.anchor.sigma - schedule) / schedule).toBeLessThan(1e-9);
      expect(Math.abs(proveEdge.rows[0].sigma - schedule) / schedule).toBeLessThan(1e-9);
    });
  }

  it("moves σ for freeze, PKO and Mystery and leaves Battle Royale alone", () => {
    const sigma = (format: RuntimeSigmaFormat, itmTarget: ItmTargetConfig) =>
      formatRuntimeSigma(format, { ...pointFor(format), itmTarget })!;
    for (const format of ["freeze", "pko", "mystery"] as const) {
      // 18.7 % against the payout table's own paid share: a few percent to a quarter of σ.
      expect(Math.abs(sigma(format, target) / sigma(format, off) - 1), format).toBeGreaterThan(0.05);
    }
    // A Battle Royale row carries its own ITM, which wins over the global target.
    expect(sigma("mystery-royale", target)).toBe(sigma("mystery-royale", off));
  });

  it("an off switch and an absent target are the same cache entry", () => {
    formatRuntimeSigma("pko", { afs: 321, roi: 0.07, rake: 0.1 });
    expect(
      hasFormatRuntimeSigma("pko", { afs: 321, roi: 0.07, rake: 0.1, itmTarget: off }),
    ).toBe(true);
    expect(
      hasFormatRuntimeSigma("pko", { afs: 321, roi: 0.07, rake: 0.1, itmTarget: target }),
    ).toBe(false);
  });

  it("the prove-edge warm-up list carries the target and warms exactly what the table reads", () => {
    const input = {
      format: "pko" as const,
      afs: 777,
      rake: 0.1,
      itmTarget: target,
      z: z95,
      currentRoi: 0.1,
      candidates: [0.1, 0.2],
    };
    const points = proveEdgeRuntimeSigmaPoints(input);
    expect(points.every(({ point }) => point.itmTarget === target)).toBe(true);
    for (const { format, point } of points) formatRuntimeSigma(format, point);
    expect(computeProveEdge(input).anchor.sigma).toBe(
      formatRuntimeSigma("pko", points[points.length - 1].point),
    );
  });
});

describe("card σ moves the way the sliders say", () => {
  const rakeFor = (format: RuntimeSigmaFormat) => (format === "mystery-royale" ? 0.08 : 0.1);
  const isIncreasing = (values: number[]) =>
    values.every((v, i) => i === 0 || v > values[i - 1]);

  it("σ rises with the field for freeze, PKO and Mystery across the whole AFS slider", () => {
    for (const format of ["freeze", "pko", "mystery"] as const) {
      const sigmas = [50, 100, 500, 1000, 5000, 10_000, 50_000].map(
        (afs) => formatRuntimeSigma(format, { afs, roi: 0.1, rake: 0.1 })!,
      );
      expect(isIncreasing(sigmas), format).toBe(true);
    }
  });

  it("σ rises with ROI across each tab's own ROI slider", () => {
    const rois: Record<RuntimeSigmaFormat, number[]> = {
      freeze: [-0.3, -0.1, 0, 0.1, 0.5, 1.0],
      pko: [-0.2, -0.1, 0, 0.1, 0.5, 0.8],
      mystery: [-0.2, -0.1, 0, 0.1, 0.5, 0.8],
      "mystery-royale": [-0.1, -0.05, 0, 0.05, 0.1],
    };
    for (const format of FORMATS) {
      const sigmas = rois[format].map(
        (roi) =>
          formatRuntimeSigma(format, {
            afs: format === "mystery-royale" ? 18 : 1000,
            roi,
            rake: rakeFor(format),
          })!,
      );
      expect(isIncreasing(sigmas), format).toBe(true);
    }
  });

  it("σ falls with rake for freeze, Mystery and Battle Royale (PKO does not: it rises there)", () => {
    for (const format of ["freeze", "mystery", "mystery-royale"] as const) {
      const sigmas = [0, 0.08, 0.2].map(
        (rake) =>
          formatRuntimeSigma(format, {
            afs: format === "mystery-royale" ? 18 : 1000,
            roi: 0,
            rake,
          })!,
      );
      expect(isIncreasing([...sigmas].reverse()), format).toBe(true);
    }
  });
});
