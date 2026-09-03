import { describe, it, expect } from "vitest";
import { validateSchedule } from "./validation";
import { compileSchedule } from "./engine";
import type { FinishModelConfig, TournamentRow } from "./types";
import { battleRoyaleRowFromTotalTicket } from "./battleRoyaleTicket";

const baseModel: FinishModelConfig = { id: "power-law" };

function row(over: Partial<TournamentRow> = {}): TournamentRow {
  return {
    id: "r1",
    players: 1000,
    buyIn: 50,
    rake: 0.1,
    roi: 0.1,
    payoutStructure: "mtt-standard",
    gameType: "freezeout",
    count: 1,
    ...over,
  };
}

describe("validateSchedule", () => {
  it("empty schedule is feasible", () => {
    expect(validateSchedule([], baseModel)).toEqual({ ok: true, issues: [] });
  });

  // No row skips validation: rows without itmRate go through the analytic
  // per-bullet EV check, rows with itmRate through the shelled solver. These
  // three are the feasible baselines the negative cases below contrast with.
  it("row without itmRate passes the analytic-EV check at a modest ROI", () => {
    const r = row();
    expect(validateSchedule([r], baseModel).ok).toBe(true);
  });

  it("row with itmRate and no shell locks is feasible at a modest ROI", () => {
    const r = row({ itmRate: 0.16 });
    expect(validateSchedule([r], baseModel).ok).toBe(true);
  });

  it("empty finishBuckets behaves like no shell locks (feasible at a modest ROI)", () => {
    const r = row({ itmRate: 0.16, finishBuckets: {} });
    expect(validateSchedule([r], baseModel).ok).toBe(true);
  });

  it("flags a lock-free fixed-ITM row when α saturates below the cash target", () => {
    // 2 % ITM on a 100-player field caps E[W] at ≈ itm × 1st prize even with
    // all paid mass pushed onto place 1 (α at its +25 ceiling); ROI +100 %
    // asks for 110 against a ceiling near 27.
    const r = row({ players: 100, itmRate: 0.02, roi: 1 });
    const res = validateSchedule([r], baseModel);
    expect(res.ok).toBe(false);
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0].rowId).toBe("r1");
    expect(res.issues[0].targetEv).toBeCloseTo(50 * 1.1 * 2, 9);
    expect(res.issues[0].currentEv).toBeLessThan(res.issues[0].targetEv);
    expect(res.issues[0].gap).toBeCloseTo(
      res.issues[0].currentEv - res.issues[0].targetEv,
      12,
    );
  });

  it("flags a lock-free fixed-ITM row when the α floor still overshoots a deep-negative ROI", () => {
    // 16 % ITM forces at least the min-cash mass; α at its −6 floor cannot
    // push E[W] under ≈ 14, but ROI −95 % asks for 2.75.
    const r = row({ itmRate: 0.16, roi: -0.95 });
    const res = validateSchedule([r], baseModel);
    expect(res.ok).toBe(false);
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0].targetEv).toBeCloseTo(50 * 1.1 * 0.05, 9);
    expect(res.issues[0].currentEv).toBeGreaterThan(res.issues[0].targetEv);
  });

  it("row with reasonable first-place lock is feasible", () => {
    const r = row({
      roi: 0.1,
      itmRate: 0.16,
      finishBuckets: { first: 0.002 },
    });
    expect(validateSchedule([r], baseModel).ok).toBe(true);
  });

  it("flags infeasible row when first lock leaves no budget for other places", () => {
    // Force a huge first-place mass with modest ROI → the remaining ITM
    // budget for paid places 2..N can't reach the required regular-side
    // target. calibrateShelledItm should return feasible: false.
    const r = row({
      roi: 1.5,
      itmRate: 0.20,
      finishBuckets: { first: 0.9 },
    });
    const res = validateSchedule([r], baseModel);
    expect(res.ok).toBe(false);
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0].rowId).toBe("r1");
    expect(res.issues[0].label).toBe("#1");
    expect(typeof res.issues[0].gap).toBe("number");
  });

  it("falls back to index label when row has no label", () => {
    const r = row({
      id: "X",
      roi: 1.5,
      itmRate: 0.20,
      finishBuckets: { first: 0.9 },
    });
    const res = validateSchedule([r], baseModel);
    expect(res.issues[0].rowIdx).toBe(0);
    expect(res.issues[0].label).toBe("#1");
  });

  it("uses provided label when present", () => {
    const r = row({
      label: "Mini Main",
      roi: 1.5,
      itmRate: 0.20,
      finishBuckets: { first: 0.9 },
    });
    const res = validateSchedule([r], baseModel);
    expect(res.issues[0].label).toBe("Mini Main");
  });

  it("flags only the infeasible rows in a mixed schedule", () => {
    const ok = row({ id: "ok", itmRate: 0.16, finishBuckets: { first: 0.002 } });
    const bad = row({
      id: "bad",
      roi: 1.5,
      itmRate: 0.20,
      finishBuckets: { first: 0.9 },
    });
    const res = validateSchedule([ok, bad], baseModel);
    expect(res.ok).toBe(false);
    expect(res.issues.map((i) => i.rowId)).toEqual(["bad"]);
    expect(res.issues[0].rowIdx).toBe(1);
  });

  it("flags non-ITM adjustable bounty rows when compile-time EV saturates below target", () => {
    const r = row({
      payoutStructure: "mtt-gg-bounty",
      gameType: "pko",
      players: 100,
      bountyFraction: 0.5,
      roi: 10,
    });
    const res = validateSchedule([r], baseModel);

    expect(res.ok).toBe(false);
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0].currentEv).toBeLessThan(res.issues[0].targetEv);
  });

  it("does not over-block adjustable bounty rows that still hit target EV analytically", () => {
    const r = row({
      payoutStructure: "mtt-gg-bounty",
      gameType: "pko",
      players: 1000,
      bountyFraction: 0.5,
      roi: 10,
    });

    expect(validateSchedule([r], baseModel).ok).toBe(true);
  });

  it("flags mystery-royale rows when extreme ROI exceeds the feasible cash+bounty envelope", () => {
    const br10 = battleRoyaleRowFromTotalTicket(10);
    const r = row({
      players: 18,
      buyIn: br10.buyIn,
      rake: br10.rake,
      payoutStructure: "battle-royale",
      gameType: "mystery-royale",
      bountyFraction: 0.5,
      mysteryBountyVariance: 1.8,
      roi: 5,
    });
    const res = validateSchedule([r], baseModel);

    expect(res.ok).toBe(false);
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0].currentEv).toBeLessThan(res.issues[0].targetEv);
  });

  it("allows fixed-ITM bounty rows when residual bounty EV closes total ROI", () => {
    // The shelled cash side cannot hit targetRegular here: first-place mass is
    // already too valuable. Engine compile then reconciles the actual bounty
    // budget as totalWinningsEV - cashEV, so the total row EV is still pinned.
    const r = row({
      gameType: "pko",
      payoutStructure: "mtt-gg-bounty",
      roi: 1,
      itmRate: 0.20,
      bountyFraction: 0.5,
      finishBuckets: { first: 0.05 },
    });

    expect(validateSchedule([r], baseModel).ok).toBe(true);
  });

  it("still flags fixed-ITM bounty rows when locked cash EV already exceeds total ROI", () => {
    // Residual bounty reconcile can add missing bounty EV, but it cannot
    // subtract cash EV. This remains infeasible and must keep blocking Run.
    const r = row({
      payoutStructure: "mtt-gg-bounty",
      roi: 0.2,
      itmRate: 0.20,
      bountyFraction: 0.5,
      finishBuckets: { first: 0.05 },
    });
    const res = validateSchedule([r], baseModel);

    expect(res.ok).toBe(false);
    expect(res.issues[0].currentEv).toBeGreaterThan(res.issues[0].targetEv);
  });

  it("agrees with the engine on fixed-ITM rows whose guarantee overlays the pool", () => {
    // With the overlay wrongly shrunk by (1−f) the shelled cash side looked
    // short of target, so residual bounty "closed" it and the row passed —
    // while the engine, holding the full overlay in cash, overshot ROI by 40%.
    const engineHitsTarget = (r: TournamentRow) => {
      const entry = compileSchedule({
        schedule: [r],
        scheduleRepeats: 1,
        samples: 1,
        bankroll: 1,
        seed: 1,
        finishModel: baseModel,
      }).flat[0];
      const target = entry.singleCost * (1 + r.roi);
      return Math.abs(entry.analyticMeanSingle - target) / target <= 1e-3;
    };
    const overlayRow = row({
      players: 100,
      buyIn: 10,
      roi: 0.1,
      payoutStructure: "mtt-gg-bounty",
      gameType: "pko",
      bountyFraction: 0.5,
      itmRate: 0.3,
      guarantee: 2000,
    });
    const controlRow = { ...overlayRow, guarantee: undefined };

    expect(engineHitsTarget(overlayRow)).toBe(false);
    expect(validateSchedule([overlayRow], baseModel).ok).toBe(false);
    expect(validateSchedule([controlRow], baseModel).ok).toBe(
      engineHitsTarget(controlRow),
    );
  });
});
