import { describe, expect, it } from "vitest";
import { battleRoyaleRowFromTotalTicket } from "./battleRoyaleTicket";
import {
  buildExactBreakdown,
  ciToZ,
  computeConvergenceRows,
  type MixTuple,
} from "./convergenceMath";
import { SIGMA_ROI_MYSTERY_ROYALE, SIGMA_ROI_PKO } from "./convergenceFit";
import {
  buildFormatRuntimeRow,
  buildRuntimeSigmaOverrides,
  formatRuntimeSigma,
  runtimeSigmaBandResid,
  type RuntimeSigmaFormat,
} from "./formatRuntimeSigma";
import { applyGameType } from "./gameType";
import { applyItmTarget } from "./itmTarget";
import { computeProveEdge } from "./proveEdge";
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
  return applyItmTarget([picked], { enabled: false, pct: 0 })[0];
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

  it("bands keep their residual constants around the runtime point", () => {
    expect(runtimeSigmaBandResid("freeze")).toBe(0.5);
    expect(runtimeSigmaBandResid("pko")).toBe(SIGMA_ROI_PKO.resid);
    expect(runtimeSigmaBandResid("mystery")).toBe(0.03);
    expect(runtimeSigmaBandResid("mystery-royale")).toBe(SIGMA_ROI_MYSTERY_ROYALE.resid);
    const band = buildRuntimeSigmaOverrides({ format: "pko", mix: [0, 1, 0], point })!.pko!;
    expect(band.lo).toBeCloseTo(band.s * (1 - SIGMA_ROI_PKO.resid), 12);
    expect(band.hi).toBeCloseTo(band.s * (1 + SIGMA_ROI_PKO.resid), 12);
  });

  it("memoized σ is stable across repeated calls", () => {
    const a = formatRuntimeSigma("mystery", { afs: 777, roi: 0.123, rake: 0.09 });
    const b = formatRuntimeSigma("mystery", { afs: 777, roi: 0.123, rake: 0.09 });
    expect(b).toBe(a);
  });
});
