import { describe, expect, it } from "vitest";
import { chooseClosestFeasibilityFix } from "./feasibilityFix";
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
