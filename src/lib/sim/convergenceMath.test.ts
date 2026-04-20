import { describe, expect, it } from "vitest";
import type { TournamentRow } from "./types";
import {
  AFS_MAX,
  AFS_MIN,
  afsToPos,
  buildExactBreakdown,
  ciToZ,
  computeConvergenceRows,
  formatPointRange,
  isRoiControlActive,
  posToAfs,
  roiControlBoundsForFormat,
  type MixTuple,
} from "./convergenceMath";

const z95 = ciToZ(0.95);
const targetRow = 3; // +/-10%

function kFor(input: {
  format: Parameters<typeof computeConvergenceRows>[0]["format"];
  roi: number;
  mix?: MixTuple;
  exactBreakdown?: ReturnType<typeof buildExactBreakdown>;
}): number {
  return computeConvergenceRows({
    afs: 1000,
    z: z95,
    roi: input.roi,
    mix: input.mix ?? [1, 0, 0],
    format: input.format,
    rakePct: 10,
    exactBreakdown: input.exactBreakdown,
  })[targetRow].tourneys;
}

describe("convergence math", () => {
  it("maps AFS slider endpoints exactly to the validated field box", () => {
    expect(posToAfs(0)).toBe(AFS_MIN);
    expect(posToAfs(1)).toBe(AFS_MAX);
    expect(posToAfs(afsToPos(AFS_MIN))).toBe(AFS_MIN);
    expect(posToAfs(afsToPos(AFS_MAX))).toBe(AFS_MAX);
  });

  it("uses validated ROI boxes for bounty format controls", () => {
    expect(roiControlBoundsForFormat("pko")).toEqual({
      min: -0.2,
      max: 0.8,
    });
    expect(roiControlBoundsForFormat("mystery")).toEqual({
      min: -0.2,
      max: 0.8,
    });
    expect(roiControlBoundsForFormat("mix")).toEqual({
      min: -0.2,
      max: 0.8,
    });
    expect(roiControlBoundsForFormat("mystery-royale")).toEqual({
      min: -0.1,
      max: 0.1,
    });
  });

  it("hides ROI control when the selected fit is ROI-invariant", () => {
    expect(isRoiControlActive("freeze", "avg", [1, 0, 0])).toBe(false);
    expect(isRoiControlActive("mix", "avg", [1, 0, 0])).toBe(false);
    expect(isRoiControlActive("exact", "exact", [0, 1, 0])).toBe(false);
  });

  it("keeps ROI control when bounty formats can move the table", () => {
    expect(isRoiControlActive("pko", "avg", [0, 1, 0])).toBe(true);
    expect(isRoiControlActive("mystery", "avg", [0, 0, 1])).toBe(true);
    expect(isRoiControlActive("mystery-royale", "avg", [1, 0, 0])).toBe(
      true,
    );
    expect(isRoiControlActive("mix", "avg", [0.99, 0.01, 0])).toBe(true);
    expect(isRoiControlActive("mix", "avg", [0.99, 0, 0.01])).toBe(true);
  });

  it("keeps freeze rows invariant to ROI and bounty rows sensitive to ROI", () => {
    expect(kFor({ format: "freeze", roi: -0.3 })).toBe(
      kFor({ format: "freeze", roi: 1.0 }),
    );
    expect(kFor({ format: "pko", roi: 1.0 })).toBeGreaterThan(
      kFor({ format: "pko", roi: -0.3 }),
    );
    expect(kFor({ format: "mystery", roi: 1.0 })).toBeGreaterThan(
      kFor({ format: "mystery", roi: -0.3 }),
    );
    expect(kFor({ format: "mystery-royale", roi: 0.1 })).toBeGreaterThan(
      kFor({ format: "mystery-royale", roi: -0.1 }),
    );
  });

  it("makes mix ROI-sensitive only when mix contains bounty formats", () => {
    expect(kFor({ format: "mix", mix: [1, 0, 0], roi: -0.3 })).toBe(
      kFor({ format: "mix", mix: [1, 0, 0], roi: 1.0 }),
    );
    expect(kFor({ format: "mix", mix: [0.7, 0.3, 0], roi: 1.0 })).toBeGreaterThan(
      kFor({ format: "mix", mix: [0.7, 0.3, 0], roi: -0.3 }),
    );
    expect(kFor({ format: "mix", mix: [0.7, 0, 0.3], roi: 1.0 })).toBeGreaterThan(
      kFor({ format: "mix", mix: [0.7, 0, 0.3], roi: -0.3 }),
    );
  });

  it("uses row data in exact mode instead of the widget ROI", () => {
    const schedule: TournamentRow[] = [
      {
        id: "freeze",
        label: "Freeze",
        players: 1000,
        buyIn: 50,
        rake: 0.1,
        roi: 0.1,
        payoutStructure: "mtt-standard",
        gameType: "freezeout",
        count: 50,
      },
      {
        id: "pko",
        label: "PKO",
        players: 500,
        buyIn: 50,
        rake: 0.1,
        roi: 0.25,
        payoutStructure: "mtt-gg-bounty",
        gameType: "pko",
        bountyFraction: 0.5,
        pkoHeadVar: 0.4,
        count: 50,
      },
    ];
    const exactBreakdown = buildExactBreakdown(schedule);
    expect(exactBreakdown).not.toBeNull();
    expect(kFor({ format: "exact", roi: -0.3, exactBreakdown })).toBe(
      kFor({ format: "exact", roi: 1.0, exactBreakdown }),
    );
  });

  it("formats point values with direct ranges, not +/- suffixes", () => {
    expect(formatPointRange("12.4k", "11.4k", "13.4k", true)).toBe(
      "12.4k · 11.4k–13.4k",
    );
    expect(formatPointRange("12.4x", "12.4x", "12.4x", true)).toBe("12.4x");
    expect(formatPointRange("12.4k", "11.4k", "13.4k", false)).toBe(
      "12.4k",
    );
  });
});
