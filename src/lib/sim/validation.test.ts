import { describe, it, expect } from "vitest";
import { validateSchedule } from "./validation";
import { compileSchedule } from "./engine";
import { calibrateShelledItm, withinTargetEv } from "./finishModel";
import { applyGameType } from "./gameType";
import { chooseClosestFeasibilityFix } from "./feasibilityFix";
import { getPayoutTable } from "./payouts";
import { fieldVariantSizes } from "./fieldVariants";
import type { FinishModelConfig, TournamentRow } from "./types";
import { battleRoyaleRowFromTotalTicket } from "./battleRoyaleTicket";
import { applyItmTarget } from "./itmTarget";

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
    // 3 % at 1st: with the regular column's 1st at ~13 % of its pool, a 5 %
    // lock is worth more than the whole ROI target (the case below).
    const r = row({
      gameType: "pko",
      payoutStructure: "mtt-gg-bounty",
      roi: 1,
      itmRate: 0.20,
      bountyFraction: 0.5,
      finishBuckets: { first: 0.03 },
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

describe("validateSchedule: a Top-3 lock with no First or FT lock beside it", () => {
  const itmCfg = { enabled: false, pct: 18.7 };
  // Paid places: 1000 players 150, 50 players 7, 30 players 4.
  const fields = [1000, 50, 30] as const;

  it("the solver really ignores it, which is why validation must not wave it through", () => {
    const N = 1000;
    const payouts = getPayoutTable("mtt-standard", N);
    const paid = payouts.filter((p) => p > 0).length;
    const solve = (locks: { first?: number; top3?: number; ft?: number }) =>
      calibrateShelledItm(N, paid, payouts, N * 50, 55 * 1.1, 0.16, locks, baseModel);
    const free = solve({});
    const lone = solve({ top3: 0.05 });
    expect(lone.shells.top3).toBe(free.shells.top3);
    expect(lone.feasible).toBe(true);
    expect(solve({ first: 0.001, top3: 0.05 }).shells.top3).toBeCloseTo(0.05, 9);
    expect(solve({ top3: 0.05, ft: 0.08 }).shells.top3).toBeCloseTo(0.05, 9);
  });

  it.each(fields)("is reported as inconsistent locks at %i players", (players) => {
    const res = validateSchedule([row({ players, itmRate: 0.2, finishBuckets: { top3: 0.05 } })], baseModel);
    expect(res.ok).toBe(false);
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0].reason).toBe("inconsistent-finish-locks");
  });

  it("is no longer reported once First or FT is pinned beside it", () => {
    const reasons = (players: number, finishBuckets: { first?: number; top3?: number; ft?: number }) =>
      validateSchedule([row({ players, itmRate: 0.2, finishBuckets })], baseModel).issues.map((i) => i.reason);
    for (const finishBuckets of [
      { first: 0.002, top3: 0.05 },
      { top3: 0.05, ft: 0.1 },
      { first: 0.002, top3: 0.05, ft: 0.1 },
    ]) {
      expect(reasons(1000, finishBuckets)).not.toContain("inconsistent-finish-locks");
    }
    // 4 to 9 paid places: the FT shell is the whole ITM band, so only First anchors it.
    for (const players of [50, 30]) {
      expect(reasons(players, { first: 0.002, top3: 0.05 })).not.toContain("inconsistent-finish-locks");
    }
  });

  it("leaves a lone First or a lone FT lock alone", () => {
    for (const finishBuckets of [{ first: 0.002 }, { ft: 0.1 }]) {
      const res = validateSchedule([row({ itmRate: 0.2, finishBuckets })], baseModel);
      expect(res.issues.map((i) => i.reason)).not.toContain("inconsistent-finish-locks");
    }
  });

  it("does not apply to formats that pay three places or fewer, where Top-3 is the whole ITM band", () => {
    const sng = row({ players: 9, payoutStructure: "sng-50-30-20", itmRate: 1 / 3, finishBuckets: { top3: 1 / 3 } });
    expect(validateSchedule([sng], baseModel).issues.map((i) => i.reason)).not.toContain("inconsistent-finish-locks");
  });

  it("the one-click fix clears the lock and the row validates", () => {
    const r = row({ itmRate: 0.16, finishBuckets: { top3: 0.05 } });
    const issue = validateSchedule([r], baseModel).issues[0];
    const fix = chooseClosestFeasibilityFix(r, issue, baseModel, itmCfg);
    expect(fix.kind).toBe("clear-locks");
    expect(validateSchedule([fix.row], baseModel).ok).toBe(true);
  });
});

describe("validateSchedule plays every field of a Field-size range", () => {
  // $20+10% flat payout, ITM pinned at 10%, +30% ROI. Buckets at 37, 51 and 65
  // entrants cannot reach the target; 79 and 93 can. Checked only at the
  // nominal 100 the row used to validate, and the run quietly delivered less
  // ROI than it claimed.
  const ranged = (over: Partial<TournamentRow> = {}) =>
    row({
      players: 100,
      buyIn: 20,
      roi: 0.3,
      payoutStructure: "mtt-flat",
      itmRate: 0.1,
      fieldVariability: { kind: "uniform", min: 30, max: 100, buckets: 5 },
      ...over,
    });
  const atField = (r: TournamentRow, players: number) =>
    validateSchedule([{ ...r, players, fieldVariability: undefined }], baseModel);

  it("blocks the row when a small-field bucket cannot reach the ROI target", () => {
    const r = ranged();
    expect(atField(r, 100).ok).toBe(true);
    const res = validateSchedule([r], baseModel);
    expect(res.ok).toBe(false);
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0].rowId).toBe("r1");
    expect(res.issues[0].currentEv).toBeLessThan(res.issues[0].targetEv);
  });

  it("reports the bucket with the largest relative gap, the same numbers a fixed row at that field gets", () => {
    const r = ranged();
    const perBucket = [37, 51, 65, 79, 93].map((n) => atField(r, n));
    expect(perBucket.map((v) => v.ok)).toEqual([false, false, false, true, true]);
    const worst = perBucket[0].issues[0];
    const reported = validateSchedule([r], baseModel).issues[0];
    expect(reported.targetEv).toBeCloseTo(worst.targetEv, 9);
    expect(reported.currentEv).toBeCloseTo(worst.currentEv, 9);
    expect(reported.gap).toBeCloseTo(worst.gap, 9);
    for (const v of perBucket.slice(1, 3)) {
      expect(Math.abs(v.issues[0].gap) / v.issues[0].targetEv).toBeLessThan(
        Math.abs(reported.gap) / reported.targetEv,
      );
    }
  });

  it("accepts the range exactly when every bucket is feasible on its own", () => {
    const cases = [
      ranged(),
      ranged({ fieldVariability: { kind: "uniform", min: 70, max: 100, buckets: 3 } }),
      ranged({ roi: 0.05 }),
      row({ itmRate: 0.16, fieldVariability: { kind: "uniform", min: 600, max: 1400, buckets: 4 } }),
      row({ itmRate: 0.02, roi: 1, fieldVariability: { kind: "uniform", min: 60, max: 140, buckets: 5 } }),
    ];
    for (const r of cases) {
      const sizes = fieldVariantSizes(r);
      expect(validateSchedule([r], baseModel).ok).toBe(sizes.every((n) => atField(r, n).ok));
    }
  });

  it("applies the late-registration multiplier to every bucket, as the engine does", () => {
    const r = ranged({ lateRegMultiplier: 2 });
    const compiled = compileSchedule(
      { schedule: [r], scheduleRepeats: 1, samples: 1, bankroll: 0, seed: 1, finishModel: baseModel },
      "alpha",
    ).flat[0];
    expect(compiled.variants!.map((v) => v.fieldSize)).toEqual(
      fieldVariantSizes(r).map((n) => n * 2),
    );
    expect(validateSchedule([r], baseModel).ok).toBe(
      fieldVariantSizes(r).every((n) => atField({ ...r, lateRegMultiplier: 2 }, n).ok),
    );
  });

  it("still blocks a lock that is only inconsistent at the larger buckets' paid count", () => {
    // Top-3 alone is the whole ITM band at 25 players (3 paid) and pins nothing
    // at 35 (more than 3 paid).
    const r = row({
      players: 25,
      itmRate: 0.15,
      finishBuckets: { top3: 0.15 },
      fieldVariability: { kind: "uniform", min: 20, max: 40, buckets: 2 },
    });
    expect(fieldVariantSizes(r)).toEqual([25, 35]);
    expect(atField(r, 25).ok).toBe(true);
    const res = validateSchedule([r], baseModel);
    expect(res.ok).toBe(false);
    expect(res.issues[0].reason).toBe("inconsistent-finish-locks");
  });

  it("lets the one-click fix pick an edit that makes every bucket feasible", () => {
    const r = ranged();
    const issue = validateSchedule([r], baseModel).issues[0];
    const fix = chooseClosestFeasibilityFix(r, issue, baseModel, { enabled: false, pct: 18.7 });
    expect(validateSchedule([fix.row], baseModel).ok).toBe(true);
    for (const n of fieldVariantSizes(fix.row)) {
      expect(atField(fix.row, n).ok).toBe(true);
    }
  });

  it("leaves rows without a range exactly as they were", () => {
    const r = ranged({ fieldVariability: undefined });
    expect(validateSchedule([r], baseModel)).toEqual(atField(r, 100));
    expect(validateSchedule([ranged({ fieldVariability: { kind: "fixed" } })], baseModel).ok).toBe(true);
  });

  it("holds a row without a pinned ITM to every field as well, as the engine's warning does", () => {
    // $10+10% 50/30/20 SNG at +310%: the 9-entrant bucket tops out at $45
    // (always first, half of a $90 pool) against a $45.10 target. The mixture
    // of the four buckets is within a thousandth of the target, so a check of
    // the mixture alone lets the row run while the engine warns that it misses.
    const r = row({
      players: 18,
      buyIn: 10,
      roi: 3.1,
      payoutStructure: "sng-50-30-20",
      fieldVariability: { kind: "uniform", min: 6, max: 30, buckets: 4 },
    });
    const compiled = compileSchedule(
      { schedule: [r], scheduleRepeats: 1, samples: 1, bankroll: 0, seed: 1, finishModel: baseModel },
      "alpha",
    );
    const slot = compiled.flat[0];
    const targetEv = 11 * (1 + 3.1);
    expect(slot.variants!.map((v) => v.fieldSize)).toEqual([9, 15, 21, 27]);
    expect(Math.abs(compiled.expectedProfit + compiled.totalBuyIn - targetEv) / targetEv).toBeLessThan(1e-3);
    expect(compiled.calibrationWarnings).toHaveLength(1);

    const res = validateSchedule([r], baseModel);
    expect(res.ok).toBe(false);
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0].currentEv).toBeCloseTo(slot.variants![0].analyticMeanSingle, 9);
    expect(res.issues[0].currentEv).toBeLessThan(45);
    expect(validateSchedule([{ ...r, roi: 3 }], baseModel).ok).toBe(true);
  });
});

describe("validateSchedule gates the Battle Royale solve the engine plays", () => {
  // The editor's $10 BR row. Off the 18-max table (late registration pays 4+
  // places, finish locks) the BR solver steps aside and the shelled solve aims
  // at the KO-pool centre, 54 % of the winnings in cash. A gate that aims at
  // 50 % passes rows whose engine solve overshoots the target.
  const editorRow = row({ players: 18, buyIn: 10 });
  const br = (over: Partial<TournamentRow>): TournamentRow => ({
    ...editorRow,
    ...applyGameType(editorRow, "mystery-royale"),
    ...over,
  });
  const engineEntry = (r: TournamentRow) =>
    compileSchedule(
      { schedule: [r], scheduleRepeats: 1, samples: 1, bankroll: 0, seed: 1, finishModel: baseModel },
      "alpha",
    ).flat[0];
  const engineHits = (r: TournamentRow) =>
    withinTargetEv(engineEntry(r).analyticMeanSingle, r.buyIn * (1 + r.rake) * (1 + r.roi));

  it("blocks a late-registration row whose cash side alone passes the target", () => {
    const r = br({ itmRate: 0.54, roi: -0.05, lateRegMultiplier: 1.17 });
    const entry = engineEntry(r);
    expect(entry.fieldSize).toBe(21);
    expect(entry.paidCount).toBe(4);
    expect(engineHits(r)).toBe(false);

    const res = validateSchedule([r], baseModel);
    expect(res.ok).toBe(false);
    expect(res.issues[0].targetEv).toBeCloseTo(9.5, 9);
    expect(res.issues[0].currentEv).toBeCloseTo(entry.analyticMeanSingle, 9);
  });

  it("lets Run through exactly the rows the engine plays on target", () => {
    let compared = 0;
    for (const lateRegMultiplier of [1, 1.17, 1.5])
      for (const itmRate of [0.14, 0.3, 0.54])
        for (const roi of [-0.3, -0.05, 0.2])
          for (const bountyEvBias of [-0.25, 0, 0.25])
            for (const finishBuckets of [undefined, { first: itmRate * 0.3 }]) {
              const r = br({ itmRate, roi, bountyEvBias, lateRegMultiplier, finishBuckets });
              const res = validateSchedule([r], baseModel);
              if (res.issues[0]?.reason) continue;
              expect(res.ok, JSON.stringify({ lateRegMultiplier, itmRate, roi, bountyEvBias, finishBuckets })).toBe(engineHits(r));
              compared++;
            }
    expect(compared).toBe(162);
  });
});

describe("validateSchedule: a model that cannot move its finish shape", () => {
  const itmCfg = { enabled: false, pct: 18.7 };
  // applyItmTarget fills every row's ITM, which is what Run validates.
  const effective = (r: TournamentRow) => applyItmTarget([r], itmCfg);
  const uniform: FinishModelConfig = { id: "uniform" };
  const empirical: FinishModelConfig = {
    id: "empirical",
    empiricalBuckets: [8, 4, 2, 1, 1, 1, 1, 1, 1, 1],
  };

  it.each([uniform, empirical])("does not block Run at an off-equilibrium ROI on $id", (model) => {
    for (const roi of [-0.2, 0, 0.1, 0.6]) {
      const r = row({ players: 300, buyIn: 20, roi });
      expect(validateSchedule(effective(r), model)).toEqual({ ok: true, issues: [] });
    }
    // The same row is blocked on a model that does move its shape, so the
    // pass above is the model's doing and not an easy row.
    const hard = row({ players: 100, itmRate: 0.02, roi: 1 });
    expect(validateSchedule([hard], baseModel).ok).toBe(false);
    expect(validateSchedule([hard], model).ok).toBe(true);
  });

  it.each([uniform, empirical])("does not block a bounty row on $id", (model) => {
    const r = row({
      players: 300,
      payoutStructure: "mtt-gg-bounty",
      gameType: "pko",
      bountyFraction: 0.5,
      roi: 0.3,
    });
    expect(validateSchedule(effective(r), model).ok).toBe(true);
  });

  it("still refuses locks that contradict each other", () => {
    const r = row({ players: 300, itmRate: 0.2, finishBuckets: { first: 0.1, top3: 0.05 } });
    const res = validateSchedule([r], uniform);
    expect(res.ok).toBe(false);
    expect(res.issues[0].reason).toBe("inconsistent-finish-locks");
  });

  it("agrees with the engine: the row compiles and pays what its shape pays", () => {
    const r = effective(row({ players: 300, buyIn: 20, roi: 0.1 }))[0];
    const compiled = compileSchedule({
      schedule: [r],
      scheduleRepeats: 1,
      samples: 10,
      bankroll: 0,
      seed: 1,
      finishModel: uniform,
    });
    const target = compiled.flat[0].singleCost * 1.1;
    expect(Math.abs(compiled.flat[0].analyticMeanSingle - target)).toBeGreaterThan(1);
  });
});

describe("validateSchedule: how close counts as on target", () => {
  const engineMean = (r: TournamentRow) => {
    const entry = compileSchedule({
      schedule: [r],
      scheduleRepeats: 1,
      samples: 10,
      bankroll: 0,
      seed: 1,
      finishModel: baseModel,
    }).flat[0];
    return entry.analyticMeanSingle / (entry.singleCost * (1 + r.roi)) - 1;
  };

  it("accepts a row the engine hits to within a thousandth of the target", () => {
    // Best reachable EV is 1.3e-4 of the target away; the $0.001 slack refused it.
    const r = row({
      players: 51,
      buyIn: 19.412,
      rake: 0.08,
      roi: 0,
      payoutStructure: "mtt-primedope",
      itmRate: 0.25,
    });
    expect(Math.abs(engineMean(r))).toBeLessThan(1e-3);
    expect(Math.abs(engineMean(r))).toBeGreaterThan(1e-4);
    expect(validateSchedule([r], baseModel).ok).toBe(true);
  });

  it("refuses a micro-stake row the engine misses by a few percent", () => {
    // $0.01 ticket, 5% ITM at +30%: the best reachable EV is 6% short of the
    // target, a gap of 0.0009 that the old $0.001 slack waved through.
    const r = row({
      players: 100,
      buyIn: 0.01,
      rake: 0.1,
      roi: 0.3,
      itmRate: 0.05,
    });
    expect(engineMean(r)).toBeLessThan(-0.04);
    const res = validateSchedule([r], baseModel);
    expect(res.ok).toBe(false);
    expect(Math.abs(res.issues[0].gap)).toBeLessThan(1e-3);
  });

  it("holds a row without a pinned ITM to the same share", () => {
    // Linear skill tops out 2% under +80% on a $0.01 ticket: a gap of 0.0004
    // that an absolute dollar slack would have called on target.
    const r = row({ players: 100, buyIn: 0.01, rake: 0.1, roi: 0.8 });
    const res = validateSchedule([r], { id: "linear-skill" });
    expect(res.ok).toBe(false);
    expect(Math.abs(res.issues[0].gap)).toBeLessThan(1e-3);
    expect(validateSchedule([{ ...r, buyIn: 10 }], { id: "linear-skill" }).ok).toBe(false);
  });
});

describe("validateSchedule: the bounty residual cannot exceed the bounty pool", () => {
  const model: FinishModelConfig = { id: "powerlaw-realdata-influenced" };
  const hu = (over: Partial<TournamentRow> = {}) =>
    row({
      players: 2, buyIn: 100, roi: 0.05, gameType: "pko", payoutStructure: "mtt-gg-bounty",
      bountyFraction: 0.5, ...over,
    });

  it("blocks heads-up PKO at the zero-skill ITM and a winning ROI", () => {
    // P(win) 0.5 pays $50 cash; the other $65.50 of the $115.50 target would
    // be bounty, from a $100 pool the winner takes only half the time. Typed:
    // a blank ITM would get the one the ROI implies (applyItmTarget).
    const res = validateSchedule([hu({ itmRate: 0.5 })], model);
    expect(res.ok).toBe(false);
    expect(res.issues[0].targetEv).toBeCloseTo(115.5, 9);
    expect(res.issues[0].currentEv).toBeCloseTo(50 + 100 * 0.5, 9);
  });

  it("lets the same row run at the ITM its ROI implies, which a blank ITM gets", () => {
    expect(validateSchedule([hu({ itmRate: 0.5775 })], model).ok).toBe(true);
    const live = applyItmTarget([hu()], { enabled: false, pct: 18.7 }, model);
    expect(live[0].itmRate).toBeCloseTo(0.5775, 12);
  });

  it("blocks a 6-max PKO whose bounty EV would pass the whole pool", () => {
    const r = row({
      players: 6, buyIn: 100, roi: 2, gameType: "pko", payoutStructure: "mtt-gg-bounty",
      bountyFraction: 0.5,
    });
    expect(validateSchedule(applyItmTarget([r], { enabled: false, pct: 18.7 }), model).ok).toBe(false);
  });

  it("keeps ordinary fixed-ITM bounty rows that the residual closes", () => {
    const r = row({
      players: 500, buyIn: 100, roi: 0.3, gameType: "pko", payoutStructure: "mtt-gg-bounty",
      bountyFraction: 0.5,
    });
    expect(validateSchedule(applyItmTarget([r], { enabled: false, pct: 18.7 }), model).ok).toBe(true);
  });
});

describe("validateSchedule: an empirical history plays its own shape", () => {
  it("does not hold a pasted history to row locks it ignores", () => {
    const r = row({ players: 300, itmRate: 0.2, finishBuckets: { first: 0.1, top3: 0.05 } });
    const history: FinishModelConfig = { id: "empirical", empiricalBuckets: [8, 4, 2, 1, 1, 1, 1, 1, 1, 1] };
    expect(validateSchedule([r], history).ok).toBe(true);
    // With no data the model falls back to the row's ITM and locks, so they are checked.
    expect(validateSchedule([r], { id: "empirical" }).ok).toBe(false);
  });
});
