import { describe, it, expect } from "vitest";
import {
  applyItmTarget,
  equilibriumItmRateForRow,
  isItmTargetActive,
  resolveItmTarget,
} from "./itmTarget";
import { validateSchedule } from "./validation";
import { compileSchedule } from "./compile";
import type { FinishModelConfig, TournamentRow } from "./types";

const baseRow: TournamentRow = {
  id: "r1",
  players: 500,
  buyIn: 25,
  rake: 0.1,
  roi: 0.1,
  payoutStructure: "mtt-standard",
  gameType: "freezeout",
  count: 1,
};

describe("resolveItmTarget", () => {
  it("returns null when disabled", () => {
    expect(resolveItmTarget({ enabled: false, pct: 18 })).toBeNull();
  });

  it("returns null for non-finite input", () => {
    expect(resolveItmTarget({ enabled: true, pct: NaN })).toBeNull();
  });

  it("returns null for non-positive fractions", () => {
    expect(resolveItmTarget({ enabled: true, pct: 0 })).toBeNull();
    expect(resolveItmTarget({ enabled: true, pct: -5 })).toBeNull();
  });

  it("converts whole-number percent to fraction", () => {
    expect(resolveItmTarget({ enabled: true, pct: 18.7 })).toBeCloseTo(0.187, 9);
  });

  it("clamps below to 0.005 to leave OOTM headroom", () => {
    expect(resolveItmTarget({ enabled: true, pct: 0.1 })).toBe(0.005);
  });

  it("clamps above to 0.99", () => {
    expect(resolveItmTarget({ enabled: true, pct: 120 })).toBe(0.99);
  });
});

describe("isItmTargetActive", () => {
  it("tracks resolveItmTarget", () => {
    expect(isItmTargetActive({ enabled: false, pct: 18 })).toBe(false);
    expect(isItmTargetActive({ enabled: true, pct: 0 })).toBe(false);
    expect(isItmTargetActive({ enabled: true, pct: 18 })).toBe(true);
  });
});

describe("applyItmTarget", () => {
  it("fills rows with their payout equilibrium when global target is off", () => {
    const schedule = [baseRow];
    const result = applyItmTarget(schedule, { enabled: false, pct: 18 });
    expect(result).not.toBe(schedule);
    expect(result[0].itmRate).toBeCloseTo(0.15, 9);
  });

  it("uses the enabled global value only for rows without their own ITM", () => {
    const schedule: TournamentRow[] = [
      { ...baseRow, id: "a" },
      { ...baseRow, id: "b", itmRate: 0.05, finishBuckets: { first: 0.01 } },
    ];
    const result = applyItmTarget(schedule, { enabled: true, pct: 20 });
    expect(result).not.toBe(schedule);
    expect(result[0].itmRate).toBe(0.20);
    expect(result[1].itmRate).toBe(0.05);
    expect(result[0].finishBuckets).toBeUndefined();
    expect(result[1].finishBuckets).toEqual({ first: 0.01 });
  });

  it("row-level value wins over the global when enabled", () => {
    const schedule = [{ ...baseRow, itmRate: 0.35 }];
    const result = applyItmTarget(schedule, { enabled: true, pct: 12 });
    expect(result[0].itmRate).toBe(0.35);
  });

  it("normalizes stale freezeout bounty fields before resolving ITM", () => {
    const schedule = [
      {
        ...baseRow,
        bountyFraction: 0.5,
        payoutStructure: "mtt-gg-bounty" as const,
      },
    ];
    const result = applyItmTarget(schedule, { enabled: false, pct: 18 });
    expect(result[0].bountyFraction).toBeUndefined();
    expect(result[0].payoutStructure).toBe("mtt-standard");
    expect(result[0].itmRate).toBeCloseTo(equilibriumItmRateForRow(baseRow), 9);
  });
});

describe("applyItmTarget on a table whose paid places all pay the same", () => {
  const model: FinishModelConfig = { id: "powerlaw-realdata-influenced" };
  const off = { enabled: false, pct: 18.7 };
  const oneLevel = (payoutStructure: TournamentRow["payoutStructure"], players: number, roi: number): TournamentRow => ({
    ...baseRow, buyIn: 100, payoutStructure, players, roi,
  });

  it.each([
    ["winner-takes-all", 2, 0.05, 0.5775],
    ["winner-takes-all", 6, 0.2, 0.22],
    ["winner-takes-all", 20, 0, 0.055],
    ["satellite-ticket", 100, 0.2, 0.132],
    ["satellite-ticket", 1000, -0.2, 0.088],
  ] as const)("%s, %i players, ROI %f: fills the ITM the ROI implies", (structure, players, roi, itm) => {
    for (const cfg of [off, { enabled: true, pct: 18.7 }]) {
      const live = applyItmTarget([oneLevel(structure, players, roi)], cfg);
      expect(live[0].itmRate).toBeCloseTo(itm, 12);
      expect(validateSchedule(live, model).ok).toBe(true);
    }
  });

  it("keeps the zero-skill default where it already hits the ROI", () => {
    const live = applyItmTarget([{ ...oneLevel("winner-takes-all", 6, 0), rake: 0 }], off);
    expect(live[0].itmRate).toBe(1 / 6);
  });

  it("keeps the default, and the block, where no ITM can pay the ROI", () => {
    // Heads-up at +100% would need a 110% win rate.
    const live = applyItmTarget([oneLevel("winner-takes-all", 2, 1)], off);
    expect(live[0].itmRate).toBe(0.5);
    expect(validateSchedule(live, model).ok).toBe(false);
  });

  it("leaves a typed ITM, a field range and a bounty row with more seats alone", () => {
    const typed = applyItmTarget([{ ...oneLevel("winner-takes-all", 6, 0.2), itmRate: 0.3 }], off);
    expect(typed[0].itmRate).toBe(0.3);
    const ranged = applyItmTarget([{
      ...oneLevel("satellite-ticket", 100, 0.2),
      fieldVariability: { kind: "uniform", min: 80, max: 120 },
    }], off);
    expect(ranged[0].itmRate).toBe(equilibriumItmRateForRow(ranged[0]));
    // With more seats than heads-up the bounty share depends on the shape.
    const sixMax = applyItmTarget([{
      ...oneLevel("winner-takes-all", 6, 0.2), gameType: "pko", bountyFraction: 0.5,
    }], off);
    expect(sixMax[0].itmRate).toBe(1 / 6);
  });

  it.each([
    ["pko", 0, 0.55],
    ["pko", 0.05, 0.5775],
    ["mystery", 0.2, 0.66],
  ] as const)("heads-up %s at ROI %f: the winner takes cash and bounty pool, ITM %f", (gameType, roi, itm) => {
    // $100+$10, half of it bounty: EV = ITM x ($100 cash + $100 bounty pool).
    const hu: TournamentRow = {
      ...oneLevel("mtt-gg-bounty", 2, roi), gameType, bountyFraction: 0.5,
    };
    const live = applyItmTarget([hu], off, model);
    expect(live[0].itmRate).toBeCloseTo(itm, 12);
    expect(validateSchedule(live, model).ok).toBe(true);
  });

  it("keeps the heads-up bounty default where it already reaches the ROI, and where nothing does", () => {
    const breakEven = { ...oneLevel("mtt-gg-bounty", 2, -1 / 11), gameType: "pko" as const, bountyFraction: 0.5 };
    expect(applyItmTarget([breakEven], off, model)[0].itmRate).toBe(0.5);
    // +100% needs $220 of a $200 table.
    const live = applyItmTarget([{ ...breakEven, roi: 1 }], off, model);
    expect(live[0].itmRate).toBe(0.5);
    expect(validateSchedule(live, model).ok).toBe(false);
  });

  it("stamps the ROI's own ITM where the zero-skill one leaves the pool a little short", () => {
    // Heads-up winner-takes-all, $100+$10, half of it bounty, ROI -9.05 %: the
    // $100.045 target leaves $50.045 of KO EV at ITM 0.5, where a winner
    // collects $50. The 0.09 % excess is inside the on-target tolerance, which
    // let the engine pay it out of a pool that does not hold it. ITM 0.500225
    // reaches the target with the KO EV exactly at the pool's share.
    const hu: TournamentRow = { ...oneLevel("winner-takes-all", 2, -0.0905), gameType: "pko", bountyFraction: 0.5 };
    const live = applyItmTarget([hu], off, model);
    expect(live[0].itmRate).toBeCloseTo(0.500225, 12);
    const entry = compileSchedule({
      schedule: live, scheduleRepeats: 1, samples: 1, bankroll: 0, seed: 1, finishModel: model,
    }).flat[0];
    let won = entry.aliasProb[0] / 2;
    for (let i = 0; i < 2; i++) if (entry.aliasIdx[i] === 0) won += (1 - entry.aliasProb[i]) / 2;
    const ko = entry.analyticMeanSingle - won * entry.prizeByPlace[0];
    const ceiling = 2 * 100 * 0.5 * won;
    expect(ko).toBeLessThanOrEqual(ceiling * (1 + 1e-9));
    expect(entry.analyticMeanSingle).toBeCloseTo(100.045, 9);
    expect(validateSchedule(live, model).ok).toBe(true);
  });

  it("keeps the table's own ITM for a model that does not aim at the ROI", () => {
    const wta = oneLevel("winner-takes-all", 6, 0.2);
    for (const fixed of [{ id: "uniform" }, { id: "empirical" }, { id: "freeze-realdata-tilt", alpha: 0.2 }] as const) {
      expect(applyItmTarget([wta], off, fixed)[0].itmRate).toBe(1 / 6);
    }
    expect(applyItmTarget([wta], off, model)[0].itmRate).toBeCloseTo(0.22, 12);
    expect(applyItmTarget([wta], off, { id: "plackett-luce" })[0].itmRate).toBeCloseTo(0.22, 12);
    // No model given reads as the default model, which aims at the ROI.
    expect(applyItmTarget([wta], off)[0].itmRate).toBeCloseTo(0.22, 12);
  });

  it("treats a small-field MTT table that pays one place as winner-takes-all, on purpose", () => {
    // mtt-standard pays one place up to 13 players; the ITM then sets the ROI.
    const small = { ...baseRow, buyIn: 100, payoutStructure: "mtt-standard" as const, players: 9, roi: 0.2 };
    const live = applyItmTarget([small], off, model);
    expect(live[0].itmRate).toBeCloseTo(132 / 900, 12);
    expect(validateSchedule(live, model).ok).toBe(true);
    expect(applyItmTarget([{ ...small, players: 14 }], off, model)[0].itmRate)
      .toBe(equilibriumItmRateForRow({ ...small, players: 14 }));
  });

  it("stamps ordinary tables exactly as before", () => {
    // Fields large enough that every table pays more than one prize level (an
    // MTT table on 9 players pays one place, and is a winner-takes-all table).
    const cases: [TournamentRow["payoutStructure"], number[]][] = [
      ["mtt-standard", [45, 500, 5000]], ["mtt-flat", [45, 500, 5000]],
      ["mtt-top-heavy", [45, 500, 5000]], ["mtt-gg", [45, 500, 5000]],
      ["mtt-pokerstars", [45, 500, 5000]], ["sng-50-30-20", [3, 9]], ["sng-65-35", [6, 9]],
    ];
    for (const [payoutStructure, fields] of cases) {
      for (const players of fields) {
        for (const roi of [-0.3, 0, 0.1, 1]) {
          const r = { ...baseRow, payoutStructure, players, roi };
          for (const cfg of [off, { enabled: true, pct: 22 }]) {
            const expected = cfg.enabled ? 0.22 : equilibriumItmRateForRow(r);
            const got = applyItmTarget([r], cfg)[0].itmRate;
            expect(got, `${payoutStructure} ${players} ${roi}`).toBe(
              equilibriumItmRateForRow(r) === 1 ? 1 : expected,
            );
          }
        }
      }
    }
  });
});
