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
  SIGMA_ROI_MYSTERY_RUNTIME_RESID,
  type MixTuple,
} from "./convergenceMath";
import { SIGMA_ROI_MYSTERY_ROYALE, sigmaRoiForRow } from "./convergenceFit";

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

  it("hides ROI control only in exact mode", () => {
    expect(isRoiControlActive("exact", "exact", [0, 1, 0])).toBe(false);
  });

  it("keeps ROI control for every averaged mode, including freeze", () => {
    expect(isRoiControlActive("freeze", "avg", [1, 0, 0])).toBe(true);
    expect(isRoiControlActive("pko", "avg", [0, 1, 0])).toBe(true);
    expect(isRoiControlActive("mystery", "avg", [0, 0, 1])).toBe(true);
    expect(isRoiControlActive("mystery-royale", "avg", [1, 0, 0])).toBe(
      true,
    );
    expect(isRoiControlActive("mix", "avg", [1, 0, 0])).toBe(true);
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

  it("freeze averaged mode can use runtime sigma that reacts to ROI", () => {
    const mkFreeze = (roi: number) =>
      buildExactBreakdown([
        {
          id: "freeze",
          label: "Freeze",
          players: 1000,
          buyIn: 10,
          rake: 0.1,
          roi,
          payoutStructure: "mtt-standard",
          gameType: "freezeout",
          count: 1,
        },
      ]);
    const low = mkFreeze(-0.2);
    const high = mkFreeze(0.5);
    expect(low).not.toBeNull();
    expect(high).not.toBeNull();

    const lowRows = computeConvergenceRows({
      afs: 1000,
      z: z95,
      roi: -0.2,
      mix: [1, 0, 0],
      format: "freeze",
      rakePct: 10,
      sigmaOverrides: {
        freeze: {
          s: low!.sigmaEff,
          lo: low!.sigmaEff * 0.5,
          hi: low!.sigmaEff * 1.5,
        },
      },
    });
    const highRows = computeConvergenceRows({
      afs: 1000,
      z: z95,
      roi: 0.5,
      mix: [1, 0, 0],
      format: "freeze",
      rakePct: 10,
      sigmaOverrides: {
        freeze: {
          s: high!.sigmaEff,
          lo: high!.sigmaEff * 0.5,
          hi: high!.sigmaEff * 1.5,
        },
      },
    });

    expect(highRows[targetRow].tourneys).toBeGreaterThan(
      lowRows[targetRow].tourneys,
    );
    expect(lowRows[targetRow].tourneysLo).toBeLessThan(
      lowRows[targetRow].tourneys,
    );
    expect(lowRows[targetRow].tourneysHi).toBeGreaterThan(
      lowRows[targetRow].tourneys,
    );
    expect(highRows[targetRow].tourneysLo).toBeLessThan(
      highRows[targetRow].tourneys,
    );
    expect(highRows[targetRow].tourneysHi).toBeGreaterThan(
      highRows[targetRow].tourneys,
    );
  });

  it("battle royale averaged mode keeps the runtime point and can show a validated runtime-centered band", () => {
    const row: TournamentRow = {
      id: "br",
      label: "BR",
      players: 18,
      buyIn: 50,
      rake: 0.08,
      roi: 0.05,
      payoutStructure: "battle-royale",
      gameType: "mystery-royale",
      bountyFraction: 0.5,
      mysteryBountyVariance: 1.8,
      pkoHeadVar: 0,
      itmRate: 0.18,
      count: 1,
    };
    const runtime = buildExactBreakdown([row]);
    expect(runtime).not.toBeNull();

    const fitSigma = sigmaRoiForRow(row).sigma;
    expect(
      Math.abs(fitSigma - runtime!.sigmaEff) / runtime!.sigmaEff,
    ).toBeLessThanOrEqual(SIGMA_ROI_MYSTERY_ROYALE.resid);

    const resid = SIGMA_ROI_MYSTERY_ROYALE.resid;
    const runtimeRows = computeConvergenceRows({
      afs: 18,
      z: z95,
      roi: 0.05,
      mix: [1, 0, 0],
      format: "mystery-royale",
      rakePct: 8,
      sigmaOverrides: {
        "mystery-royale": {
          s: runtime!.sigmaEff,
          lo: runtime!.sigmaEff * (1 - resid),
          hi: runtime!.sigmaEff * (1 + resid),
        },
      },
    });

    const expectedK = Math.ceil(Math.pow((z95 * runtime!.sigmaEff) / 0.1, 2));
    expect(runtimeRows[targetRow].tourneys).toBe(expectedK);
    expect(runtimeRows[targetRow].tourneysLo).toBeLessThan(
      runtimeRows[targetRow].tourneys,
    );
    expect(runtimeRows[targetRow].tourneysHi).toBeGreaterThan(
      runtimeRows[targetRow].tourneys,
    );
  });

  it("mystery averaged mode can use a runtime-centered residual band across the full UI box", () => {
    const row: TournamentRow = {
      id: "mystery",
      label: "Mystery",
      players: 50_000,
      buyIn: 50,
      rake: 0.1,
      roi: 0.8,
      payoutStructure: "mtt-gg-mystery",
      gameType: "mystery",
      bountyFraction: 0.5,
      mysteryBountyVariance: 2.0,
      pkoHeadVar: 0.4,
      count: 1,
    };
    const runtime = buildExactBreakdown([row], {
      finishModel: { id: "mystery-realdata-linear" },
    });
    expect(runtime).not.toBeNull();

    const resid = SIGMA_ROI_MYSTERY_RUNTIME_RESID;
    const runtimeRows = computeConvergenceRows({
      afs: row.players,
      z: z95,
      roi: row.roi,
      mix: [0, 0, 1],
      format: "mystery",
      rakePct: 10,
      sigmaOverrides: {
        mystery: {
          s: runtime!.sigmaEff,
          lo: runtime!.sigmaEff * (1 - resid),
          hi: runtime!.sigmaEff * (1 + resid),
        },
      },
    });

    const expectedK = Math.ceil(Math.pow((z95 * runtime!.sigmaEff) / 0.1, 2));
    expect(runtimeRows[targetRow].tourneys).toBe(expectedK);
    expect(runtimeRows[targetRow].tourneysLo).toBeLessThan(
      runtimeRows[targetRow].tourneys,
    );
    expect(runtimeRows[targetRow].tourneysHi).toBeGreaterThan(
      runtimeRows[targetRow].tourneys,
    );
  });

  it("exact mode weights mixed ABI by dollar risk, not row count alone", () => {
    const schedule: TournamentRow[] = [
      {
        id: "low",
        label: "$5",
        players: 100,
        buyIn: 5,
        rake: 0.1,
        roi: 0.1,
        payoutStructure: "mtt-standard",
        count: 100,
      },
      {
        id: "high",
        label: "$500",
        players: 100,
        buyIn: 500,
        rake: 0.1,
        roi: 0.1,
        payoutStructure: "mtt-standard",
        count: 100,
      },
    ];
    const exact = buildExactBreakdown(schedule);
    expect(exact).not.toBeNull();
    const totalCount = schedule.reduce((acc, row) => acc + row.count, 0);
    const naiveCountShare = Math.sqrt(
      schedule.reduce((acc, row) => {
        const sigma = sigmaRoiForRow(row).sigma;
        return acc + (row.count / totalCount) * sigma * sigma;
      }, 0),
    );
    expect(exact!.sigmaEff).toBeGreaterThan(naiveCountShare * 1.25);
    expect(exact!.perRow[1].costShare).toBeGreaterThan(0.98);
  });

  it("field variability changes exact schedule sigma", () => {
    const baseRow: TournamentRow = {
      id: "freeze",
      label: "Freeze",
      players: 500,
      buyIn: 10,
      rake: 0.1,
      roi: 0.1,
      payoutStructure: "mtt-standard",
      count: 100,
    };
    const base = buildExactBreakdown([baseRow]);
    const variable = buildExactBreakdown([
      {
        ...baseRow,
        fieldVariability: { kind: "uniform", min: 500, max: 5000, buckets: 5 },
      },
    ]);
    expect(base).not.toBeNull();
    expect(variable).not.toBeNull();
    expect(variable!.sigmaEff).toBeGreaterThan(base!.sigmaEff);
    expect(variable!.perRow[0].fieldMin).toBeGreaterThan(500);
    expect(variable!.perRow[0].fieldMax).toBeLessThan(5000);
    expect(variable!.perRow[0].afs).toBeCloseTo(2750, 6);
  });

  it("payout shape changes exact schedule sigma", () => {
    const baseRow: TournamentRow = {
      id: "std",
      label: "Standard",
      players: 500,
      buyIn: 10,
      rake: 0.1,
      roi: 0.1,
      payoutStructure: "mtt-standard",
      count: 100,
    };
    const standard = buildExactBreakdown([baseRow]);
    const topHeavy = buildExactBreakdown([
      { ...baseRow, id: "top", label: "Top", payoutStructure: "mtt-top-heavy" },
    ]);
    expect(standard).not.toBeNull();
    expect(topHeavy).not.toBeNull();
    expect(topHeavy!.sigmaEff).toBeGreaterThan(standard!.sigmaEff);
  });

  it("exact mode fields use the compiled schedule AFS, not the hidden slider AFS", () => {
    const schedule: TournamentRow[] = [
      {
        id: "freeze-small",
        label: "Small",
        players: 500,
        buyIn: 10,
        rake: 0.1,
        roi: 0.1,
        payoutStructure: "mtt-standard",
        count: 50,
      },
      {
        id: "freeze-big",
        label: "Big",
        players: 5000,
        buyIn: 10,
        rake: 0.1,
        roi: 0.1,
        payoutStructure: "mtt-standard",
        count: 50,
      },
    ];
    const exact = buildExactBreakdown(schedule);
    expect(exact).not.toBeNull();
    expect(exact!.avgField).toBeCloseTo(2750, 6);

    const rowAt50 = computeConvergenceRows({
      afs: 50,
      z: z95,
      roi: 0.1,
      mix: [1, 0, 0],
      format: "exact",
      rakePct: 10,
      exactBreakdown: exact,
    })[targetRow];
    const rowAt50k = computeConvergenceRows({
      afs: 50_000,
      z: z95,
      roi: 0.1,
      mix: [1, 0, 0],
      format: "exact",
      rakePct: 10,
      exactBreakdown: exact,
    })[targetRow];

    expect(rowAt50.fields).toBe(rowAt50k.fields);
    expect(rowAt50.fields).toBeCloseTo(rowAt50.tourneys / exact!.avgField, 9);
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
