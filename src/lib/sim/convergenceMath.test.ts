import { describe, expect, it } from "vitest";
import type { TournamentRow } from "./types";
import {
  AFS_MAX,
  AFS_MIN,
  afsToPos,
  buildExactBreakdown,
  buildOceanKoSigmaBand,
  ciToZ,
  computeConvergenceRows,
  defaultOceanKoTicket,
  formatPointRange,
  formatTargetPct,
  isRoiControlActive,
  posToAfs,
  roiControlBoundsForFormat,
  TARGETS,
  type MixTuple,
} from "./convergenceMath";
import { runtimeSigmaBandResid } from "./runtimeSigmaBands";
import { buildFormatRuntimeRow, buildRuntimeSigmaBands } from "./formatRuntimeSigma";
import { applyGameType } from "./gameType";
import { applyItmTarget } from "./itmTarget";

const z95 = ciToZ(0.95);
const targetRow = 3; // +/-10%

/** k of the ±10 % row the chart prints: the tab's runtime bands at field 1000, ROI +10 %, rake 10 %. */
function kFor(input: {
  format: Parameters<typeof computeConvergenceRows>[0]["format"];
  mix?: MixTuple;
  exactBreakdown?: ReturnType<typeof buildExactBreakdown>;
}): number {
  const mix = input.mix ?? [1, 0, 0];
  return computeConvergenceRows({
    afs: 1000,
    z: z95,
    mix,
    format: input.format,
    exactBreakdown: input.exactBreakdown,
    sigmaBands: buildRuntimeSigmaBands({
      format: input.format,
      mix,
      point: { afs: 1000, roi: 0.1, rake: 0.1 },
    }),
  })[targetRow].tourneys;
}

describe("convergence math", () => {
  it("Ocean default ticket uses only Ocean entries and weights by tournament count", () => {
    const base: TournamentRow = {
      id: "ocean",
      players: 500,
      buyIn: 92,
      rake: 8 / 92,
      roi: 0.1,
      payoutStructure: "mtt-gg-bounty",
      gameType: "ocean-ko",
      count: 1,
    };
    expect(defaultOceanKoTicket()).toBe(100);
    expect(defaultOceanKoTicket([
      base,
      { ...base, id: "ocean-2", buyIn: 184, count: 3 },
      { ...base, id: "pko", gameType: "pko", buyIn: 10_000, count: 50 },
    ])).toBeCloseTo(175, 12);
  });

  it("Ocean synthetic estimates preserve the selected full ticket and rake", () => {
    const estimates: number[] = [];
    for (const totalTicket of [5, 10_000]) {
      const rake = 0.1;
      const base: TournamentRow = {
        id: "ticket",
        players: 200,
        buyIn: totalTicket / (1 + rake),
        rake,
        roi: 0.1,
        payoutStructure: "mtt-gg-bounty",
        count: 1,
      };
      const ocean = {
        ...base,
        ...applyGameType(base, "ocean-ko"),
        buyIn: base.buyIn,
        rake,
      };
      const direct = buildExactBreakdown(applyItmTarget([ocean], { enabled: false, pct: 0 }))!;
      const synthetic = buildOceanKoSigmaBand({ afs: 200, roi: 0.1, rake, totalTicket });
      expect(synthetic.s).toBe(direct.sigmaEff);
      estimates.push(synthetic.s);
    }
    expect(estimates[0]).not.toBeCloseTo(estimates[1], 6);
  });

  it("the Ocean tab compiles the row Run plays: ITM pinned, global target included", () => {
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
    const free = buildExactBreakdown([ocean])!.sigmaEff;
    for (const itmTarget of [
      { enabled: false, pct: 0 },
      { enabled: true, pct: 18.7 },
    ]) {
      const schedule = buildExactBreakdown(applyItmTarget([ocean], itmTarget))!.sigmaEff;
      const tab = buildOceanKoSigmaBand({ afs: 1000, roi: 0.1, rake, totalTicket: 100, itmTarget });
      expect(tab.s).toBe(schedule);
      // The unpinned row this tab used to compile is a different number.
      expect(Math.abs(tab.s / free - 1)).toBeGreaterThan(0.03);
    }
  });

  it("Ocean KO uses runtime variance in both its own tab and a mixed schedule", () => {
    const base: TournamentRow = {
      id: "ocean",
      players: 500,
      buyIn: 50,
      rake: 0.1,
      roi: 0.1,
      payoutStructure: "mtt-gg-bounty",
      count: 1,
    };
    const ocean = {
      ...base,
      ...applyGameType(base, "ocean-ko"),
      buyIn: base.buyIn,
      rake: base.rake,
    };
    const runtime = buildExactBreakdown(applyItmTarget([ocean], { enabled: false, pct: 0 }))!;
    expect(runtime.varianceEstimate).toBe("upper-bound");
    const rows = computeConvergenceRows({
      afs: 500,
      z: z95,
      mix: [0, 1, 0],
      format: "ocean-ko",
      sigmaBands: {
        "ocean-ko": buildOceanKoSigmaBand({
          afs: 500,
          roi: 0.1,
          rake: 0.1,
          totalTicket: ocean.buyIn * (1 + ocean.rake),
        }),
      },
    });
    const point = rows[targetRow];
    expect(point.tourneys).toBe(Math.ceil(Math.pow(z95 * runtime.sigmaEff / 0.1, 2)));
    expect(point.tourneysLo).toBe(point.tourneys);
    expect(point.tourneysHi).toBe(point.tourneys);
    const mixed = buildExactBreakdown([
      ocean,
      { ...base, id: "pko", ...applyGameType(base, "pko") },
    ])!;
    expect(mixed.perRow.map((r) => r.format)).toEqual(["ocean-ko", "pko"]);
    expect(mixed.varianceEstimate).toBe("upper-bound");
    expect(mixed.sigmaEffLo).toBe(mixed.sigmaEff);
    expect(mixed.sigmaEffHi).toBe(mixed.sigmaEff);
    expect(mixed.perRow[0].varShare).toBeGreaterThan(0);
  });
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
    expect(isRoiControlActive("exact")).toBe(false);
    expect(isRoiControlActive("avg")).toBe(true);
  });

  it("sizes every row of a single-format tab from the band it is given", () => {
    const kAt = (sigma: number, target: number) => Math.ceil(Math.pow((z95 * sigma) / target, 2));
    for (const format of ["freeze", "pko", "mystery", "mystery-royale", "ocean-ko"] as const) {
      const band = { s: 5, lo: 4, hi: 7 };
      const rows = computeConvergenceRows({
        afs: 400,
        z: z95,
        mix: [1, 0, 0],
        format,
        sigmaBands: { [format]: band },
      });
      for (const row of rows) {
        expect(row.tourneys, format).toBe(kAt(band.s, row.targetPct));
        expect(row.tourneysLo, format).toBe(kAt(band.lo, row.targetPct));
        expect(row.tourneysHi, format).toBe(kAt(band.hi, row.targetPct));
        expect(row.fields, format).toBeCloseTo(row.tourneys / 400, 9);
      }
    }
  });

  it("blends a Mix from its weighted components only", () => {
    const mix: MixTuple = [0.7, 0, 0.3];
    const f = { s: 4, lo: 3.9, hi: 4.1 };
    const m = { s: 6, lo: 5.8, hi: 6.2 };
    // No PKO band: a component with no weight is never compiled.
    const row = computeConvergenceRows({
      afs: 1000,
      z: z95,
      mix,
      format: "mix",
      sigmaBands: { freeze: f, mystery: m },
    })[targetRow];
    const blend = (key: "s" | "lo" | "hi") =>
      Math.sqrt(mix[0] * f[key] * f[key] + mix[2] * m[key] * m[key]);
    expect(row.tourneys).toBe(Math.ceil(Math.pow((z95 * blend("s")) / 0.1, 2)));
    expect(row.tourneysLo).toBe(Math.ceil(Math.pow((z95 * blend("lo")) / 0.1, 2)));
    expect(row.tourneysHi).toBe(Math.ceil(Math.pow((z95 * blend("hi")) / 0.1, 2)));
    // The chart's own bands for the same Mix carry exactly those two formats.
    expect(Object.keys(buildRuntimeSigmaBands({ format: "mix", mix, point: { afs: 1000, roi: 0.1, rake: 0.1 } })!).sort())
      .toEqual(["freeze", "mystery"]);
    expect(Number.isFinite(kFor({ format: "mix", mix }))).toBe(true);
  });

  it("prints no volume for a σ it was not given, never a closed-form estimate", () => {
    const absent = (rows: ReturnType<typeof computeConvergenceRows>) =>
      rows.every((r) =>
        [r.tourneys, r.tourneysLo, r.tourneysHi, r.fields, r.fieldsLo, r.fieldsHi].every(Number.isNaN),
      );
    // Everything a closed-form surface would need (field, ROI, rake) is there;
    // only the σ is not. At field 50, ROI +80 % the Mystery surface reads 2.07x
    // the card's σ.
    const point = { afs: 50, z: z95, roi: 0.8, rakePct: 10 };
    const call = (format: Parameters<typeof computeConvergenceRows>[0]["format"], mix: MixTuple = [1, 0, 0]) =>
      computeConvergenceRows({ ...point, mix, format, sigmaBands: {} });
    for (const format of ["freeze", "pko", "mystery", "mystery-royale", "ocean-ko", "mix", "exact"] as const) {
      expect(absent(call(format)), format).toBe(true);
    }
    // A weighted Mix component with no band leaves the blend undefined too.
    expect(absent(computeConvergenceRows({
      ...point, mix: [0.5, 0, 0.5], format: "mix", sigmaBands: { freeze: { s: 4, lo: 4, hi: 4 } },
    }))).toBe(true);
    // So do weights that are not shares, with every band present: none of them
    // is "no weight", and an all-zero Mix is not 0 tournaments.
    const every = { freeze: { s: 4, lo: 3, hi: 5 }, pko: { s: 6, lo: 5, hi: 7 }, mystery: { s: 8, lo: 7, hi: 9 } };
    const notShares: MixTuple[] = [
      [NaN, NaN, NaN], [NaN, 0, 1], [0, 0, 0], [1.2, -0.2, 0], [Infinity, 0, 0],
    ];
    for (const mix of notShares) {
      expect(absent(computeConvergenceRows({ ...point, mix, format: "mix", sigmaBands: every })), String(mix)).toBe(true);
    }
    expect(computeConvergenceRows({ ...point, mix: [0.2, 0.3, 0.5], format: "mix", sigmaBands: every })
      .every((r) => Number.isFinite(r.tourneys))).toBe(true);
    // The Schedule tab with no breakdown does not fall back to the Mix.
    expect(absent(computeConvergenceRows({
      ...point, mix: [1 / 3, 1 / 3, 1 / 3], format: "exact", exactBreakdown: null,
      sigmaBands: { freeze: { s: 4, lo: 4, hi: 4 }, pko: { s: 4, lo: 4, hi: 4 }, mystery: { s: 4, lo: 4, hi: 4 } },
    }))).toBe(true);
    // @ts-expect-error the σ is a required input: a caller cannot forget it
    expect(absent(computeConvergenceRows({ ...point, mix: [0, 0, 1], format: "mystery" }))).toBe(true);
  });

  it("uses row data in exact mode, not the tab's bands", () => {
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
        count: 50,
      },
    ];
    const exactBreakdown = buildExactBreakdown(schedule);
    expect(exactBreakdown).not.toBeNull();
    const withBands = computeConvergenceRows({
      afs: 1000,
      z: z95,
      mix: [0.5, 0.5, 0],
      format: "exact",
      exactBreakdown,
      sigmaBands: { freeze: { s: 99, lo: 99, hi: 99 }, pko: { s: 99, lo: 99, hi: 99 } },
    })[targetRow].tourneys;
    expect(withBands).toBe(kFor({ format: "exact", exactBreakdown }));
    expect(withBands).toBe(Math.ceil(Math.pow((z95 * exactBreakdown!.sigmaEff) / 0.1, 2)));
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
      mix: [1, 0, 0],
      format: "freeze",
      sigmaBands: {
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
      mix: [1, 0, 0],
      format: "freeze",
      sigmaBands: {
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
    // The card's own row: a hand-built $50 row draws the $25 envelope table.
    const row = buildFormatRuntimeRow("mystery-royale", { afs: 18, roi: 0.05, rake: 0.08 });
    const runtime = buildExactBreakdown([row]);
    expect(runtime).not.toBeNull();

    const resid = runtimeSigmaBandResid("mystery-royale");
    const runtimeRows = computeConvergenceRows({
      afs: 18,
      z: z95,
      mix: [1, 0, 0],
      format: "mystery-royale",
      sigmaBands: {
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
      count: 1,
    };
    const runtime = buildExactBreakdown([row], {
      finishModel: { id: "mystery-realdata-linear" },
    });
    expect(runtime).not.toBeNull();

    const resid = runtimeSigmaBandResid("mystery");
    const runtimeRows = computeConvergenceRows({
      afs: row.players,
      z: z95,
      mix: [0, 0, 1],
      format: "mystery",
      sigmaBands: {
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
        const sigma = buildExactBreakdown([{ ...row, count: 1 }])!.sigmaEff;
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
      mix: [1, 0, 0],
      format: "exact",
      exactBreakdown: exact,
      sigmaBands: undefined,
    })[targetRow];
    const rowAt50k = computeConvergenceRows({
      afs: 50_000,
      z: z95,
      mix: [1, 0, 0],
      format: "exact",
      exactBreakdown: exact,
      sigmaBands: undefined,
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

  it("labels every target row with its own precision, 2.5% included", () => {
    expect(TARGETS.map(formatTargetPct)).toEqual([
      "±50%", "±30%", "±20%", "±10%", "±5%", "±2.5%", "±1%", "±0.5%", "±0.1%",
    ]);
  });
});

describe("ciToZ", () => {
  it.each([
    [0.5, 0.6744897502],
    [0.8, 1.2815515655],
    [0.9, 1.6448536270],
    [0.95, 1.9599639845],
    [0.99, 2.5758293035],
    [0.999, 3.2905267315],
  ])("turns a %s two-sided interval into the textbook z", (ci, z) => {
    expect(ciToZ(ci)).toBeCloseTo(z, 6);
  });

  it("is 0 at 0 and finite at the slider ceiling", () => {
    expect(ciToZ(0)).toBe(0);
    expect(Number.isFinite(ciToZ(1))).toBe(true);
    expect(ciToZ(1)).toBeCloseTo(4.8916, 3);
  });

  it("rises with the interval", () => {
    let prev = ciToZ(0);
    for (let ci = 0.01; ci < 1; ci += 0.01) {
      const z = ciToZ(ci);
      expect(z).toBeGreaterThan(prev);
      prev = z;
    }
  });
});
