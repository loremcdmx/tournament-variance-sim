import { describe, expect, it } from "vitest";
import { chooseClosestFeasibilityFix, rowsFitCannotUnblock } from "./feasibilityFix";
import { applyItmTarget } from "./itmTarget";
import { validateSchedule } from "./validation";
import type { FinishModelConfig, TournamentRow } from "./types";

const baseModel: FinishModelConfig = { id: "power-law" };
const noGlobalItm = { enabled: false, pct: 20 };

function row(over: Partial<TournamentRow> = {}): TournamentRow {
  return {
    id: "r1",
    label: "Bread & butter",
    players: 30,
    buyIn: 0.92,
    rake: 0.08 / 0.92,
    roi: 0,
    payoutStructure: "mtt-standard",
    gameType: "freezeout",
    count: 7000,
    itmRate: 0.2,
    ...over,
  };
}

describe("chooseClosestFeasibilityFix", () => {
  it("preserves fixed ITM when matching ROI is the closest feasible edit", () => {
    const blocked = row();
    const issue = validateSchedule([blocked], baseModel).issues[0];
    expect(issue).toBeDefined();

    const fix = chooseClosestFeasibilityFix(
      blocked,
      issue!,
      baseModel,
      noGlobalItm,
    );

    expect(fix.kind).toBe("match-roi");
    expect(fix.row.itmRate).toBe(blocked.itmRate);
    expect(fix.row.finishBuckets).toBe(blocked.finishBuckets);
    expect(fix.row.roi).toBeCloseTo(issue!.currentEv / (blocked.buyIn * (1 + blocked.rake)) - 1);
    expect(validateSchedule([fix.row], baseModel).ok).toBe(true);
  });

  it("falls back to relaxing locks when ROI matching is not enough", () => {
    const blocked = row({
      buyIn: 50,
      rake: 0.1,
      roi: 1.5,
      players: 1000,
      finishBuckets: { first: 0.9 },
    });
    const issue = validateSchedule([blocked], baseModel).issues[0];
    expect(issue).toBeDefined();

    const fix = chooseClosestFeasibilityFix(
      blocked,
      issue!,
      baseModel,
      noGlobalItm,
    );

    expect(validateSchedule([fix.row], baseModel).ok).toBe(true);
  });

  it("can fit ROI while a global ITM lock is active", () => {
    const blocked = row({ itmRate: undefined });
    const globalItm = { enabled: true, pct: 20 };
    const issue = validateSchedule(
      applyItmTarget([blocked], globalItm),
      baseModel,
    ).issues[0];
    expect(issue).toBeDefined();

    const fix = chooseClosestFeasibilityFix(
      blocked,
      issue!,
      baseModel,
      globalItm,
    );

    expect(fix.kind).toBe("match-roi");
    expect(fix.row.itmRate).toBeUndefined();
    expect(validateSchedule(applyItmTarget([fix.row], globalItm), baseModel).ok).toBe(true);
  });
});

describe("Fit closest on a row with a Field-size range", () => {
  const ranged = (
    payoutStructure: TournamentRow["payoutStructure"],
    players: number,
    min: number,
    max: number,
    roi: number,
    buckets = 5,
  ): TournamentRow =>
    row({
      id: "ranged",
      label: "Ranged",
      players,
      buyIn: 10,
      rake: 0.1,
      roi,
      payoutStructure,
      count: 1,
      itmRate: undefined,
      fieldVariability: { kind: "uniform", min, max, buckets },
    });

  const clickOnce = (blocked: TournamentRow) => {
    const issue = validateSchedule(applyItmTarget([blocked], noGlobalItm), baseModel).issues[0];
    expect(issue).toBeDefined();
    return chooseClosestFeasibilityFix(blocked, issue!, baseModel, noGlobalItm);
  };
  const blockedAfter = (r: TournamentRow) =>
    !validateSchedule(applyItmTarget([r], noGlobalItm), baseModel).ok;

  it("finds the ROI every size can reach when one exists, in a single click", () => {
    const blocked = ranged("mtt-standard", 30, 15, 45, -0.1);
    expect(blockedAfter(blocked)).toBe(true);
    const fix = clickOnce(blocked);
    expect(fix.kind).toBe("match-roi");
    expect(fix.row.itmRate).toBeUndefined();
    expect(blockedAfter(fix.row)).toBe(false);
  });

  it("does not rewrite the ROI when sizes fall on both sides of it (SNG 50/30/20, 10 players, 6..14)", () => {
    const blocked = ranged("sng-50-30-20", 10, 6, 14, 0);
    const fix = clickOnce(blocked);
    expect(fix.kind).toBe("none");
    expect(fix.row).toBe(blocked);
    let again = blocked;
    for (let click = 0; click < 4; click++) again = clickOnce(again).row;
    expect(again.roi).toBe(0);
  });

  it("does not ping-pong when the small sizes fall short and the big ones cannot go lower (SNG 65/35, 9 players, 5..12)", () => {
    const blocked = ranged("sng-65-35", 9, 5, 12, 0.065);
    const rois = new Set<number>();
    let cur = blocked;
    for (let click = 0; click < 6; click++) {
      if (!blockedAfter(cur)) break;
      cur = clickOnce(cur).row;
      rois.add(cur.roi);
    }
    expect(rois.size).toBe(1);
  });

  it("never leaves a blocked ranged row rewritten and still blocked", () => {
    let blockedRows = 0;
    let fixed = 0;
    for (const payout of ["sng-50-30-20", "sng-65-35", "mtt-standard", "winner-takes-all"] as const) {
      for (const players of [9, 18, 30]) {
        for (const roi of [-0.1, 0, 0.1]) {
          const blocked = ranged(payout, players, Math.max(2, Math.round(players * 0.5)), Math.round(players * 1.5), roi, 3);
          if (!blockedAfter(blocked)) continue;
          blockedRows++;
          const fix = clickOnce(blocked);
          if (fix.kind === "none") {
            expect(fix.row, `${payout} ${players} ${roi}`).toBe(blocked);
          } else {
            fixed++;
            expect(blockedAfter(fix.row), `${payout} ${players} ${roi}`).toBe(false);
          }
        }
      }
    }
    expect(blockedRows).toBeGreaterThan(10);
    expect(fixed).toBeGreaterThan(0);
  });

  it("names the rows whose fit changes nothing", () => {
    const stuck = ranged("sng-50-30-20", 10, 6, 14, 0);
    const fixable = { ...ranged("mtt-standard", 30, 15, 45, -0.1), id: "fixable" };
    const fine = row({ id: "fine" });
    expect(
      rowsFitCannotUnblock([stuck, fixable, fine], baseModel, noGlobalItm),
    ).toEqual(["ranged"]);
    expect(rowsFitCannotUnblock([fixable, fine], baseModel, noGlobalItm)).toEqual([]);
  });

  it("keeps the single-field behaviour: a blocked fixed-size row is still rewritten", () => {
    const blocked = row();
    const fix = clickOnce(blocked);
    expect(fix.kind).toBe("match-roi");
  });
});
