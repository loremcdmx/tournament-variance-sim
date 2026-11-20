import { describe, expect, it } from "vitest";
import { chooseClosestFeasibilityFix, closestFixForRow } from "./feasibilityFix";
import { applyItmTarget } from "./itmTarget";
import { inferGameType } from "./gameType";
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
    const blocked = row({ itmRate: 0.25 });
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
    const globalItm = { enabled: true, pct: 25 };
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

  it("does not rewrite the ROI when no single ROI fits every size (winner-takes-all, 10 players, 6..14)", () => {
    // Every size pays ITM x its own prize pool, so each one hits a different ROI.
    const blocked = ranged("winner-takes-all", 10, 6, 14, 0);
    const fix = clickOnce(blocked);
    expect(fix.kind).toBe("none");
    expect(fix.row).toBe(blocked);
    let again = blocked;
    for (let click = 0; click < 4; click++) again = clickOnce(again).row;
    expect(again.roi).toBe(0);
  });

  it("fits a range whose window runs through break-even (SNG 50/30/20, 10 players, 6..14)", () => {
    // At ITM 30 % every size passes from ROI -26.2 % up through break-even,
    // -rake/(1+rake), to -4.5 %, the most the 7-player size pays ($10.50):
    // the first-place floor gives way to the target on both sides of
    // break-even, so the window no longer ends there. The walk from ROI 0
    // lands on its edge nearest the typed ROI.
    const blocked = ranged("sng-50-30-20", 10, 6, 14, 0);
    const fix = clickOnce(blocked);
    expect(fix.kind).toBe("match-roi");
    expect(fix.row.itmRate).toBeUndefined();
    expect(blockedAfter(fix.row)).toBe(false);
    expect(fix.row.roi).toBeCloseTo(10.5 / 11 - 1, 6);
    expect(blockedAfter({ ...fix.row, roi: fix.row.roi + 0.002 })).toBe(true);
    for (const roi of [-0.26, -1 / 11 - 1e-7, -1 / 11, -1 / 11 + 1e-7, -0.05]) {
      expect(blockedAfter({ ...blocked, roi }), `${roi}`).toBe(false);
    }
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

  it("tells a row whose fit changes nothing from one it fixes and one that is fine", () => {
    const stuck = ranged("winner-takes-all", 10, 6, 14, 0);
    const fixable = ranged("mtt-standard", 30, 15, 45, -0.1);
    expect(closestFixForRow(stuck, baseModel, noGlobalItm)).toEqual({ kind: "none", row: stuck });
    expect(closestFixForRow(fixable, baseModel, noGlobalItm)?.kind).toBe("match-roi");
    expect(closestFixForRow(row({ itmRate: 0.2, roi: 0.05 }), baseModel, noGlobalItm)).toBeNull();
  });

  it("keeps the single-field behaviour: a blocked fixed-size row is still rewritten", () => {
    const blocked = row({ itmRate: 0.25 });
    const fix = clickOnce(blocked);
    expect(fix.kind).toBe("match-roi");
  });
});

describe("Fit closest on a single field never returns a row that is still blocked", () => {
  const model: FinishModelConfig = { id: "powerlaw-realdata-influenced" };
  const globalItm = { enabled: true, pct: 18.7 };
  const blockedWith = (r: TournamentRow) =>
    validateSchedule(applyItmTarget([r], globalItm), model).issues[0];

  it("moves a ROI under what the row can reach onto its lowest EV in one click", () => {
    // ROI -10% at the 18.7% target cannot come below $118.50, the bottom of
    // the α range; the first-place floor gives way to the target on both
    // sides of break-even, so one click lands on that EV (ROI +7.7%).
    const r = row({
      players: 30, buyIn: 100, rake: 0.1, roi: -0.1, payoutStructure: "mtt-top-heavy",
      itmRate: undefined, count: 1,
    });
    const issue = blockedWith(r);
    expect(issue).toBeDefined();
    const fix = chooseClosestFeasibilityFix(r, issue!, model, globalItm);
    expect(fix.kind).toBe("match-roi");
    expect(blockedWith(fix.row)).toBeUndefined();
  });

  it("clears contradictory locks and lowers the ROI in one click when clearing alone still blocks", () => {
    // Locks that contradict each other on a heads-up PKO row ($100+10, 50 %
    // bounty) at ROI +100 %. Without the locks the ITM is blank, and the
    // heads-up default takes the ITM the ROI implies, cost x (1+ROI) / (prize
    // + bounty pool), up to 0.99: $220 of a $200 table is out of reach, so the
    // nearest runnable ROI is 0.99 x 200 / 110 - 1 = +80 %.
    const r = row({
      id: "hu", players: 2, buyIn: 100, rake: 0.1, roi: 1, gameType: "pko",
      payoutStructure: "mtt-gg-bounty", bountyFraction: 0.5, itmRate: 0.5, count: 1,
      finishBuckets: { first: 0.6 },
    });
    const off = { enabled: false, pct: 18.7 };
    const issue = validateSchedule(applyItmTarget([r], off), model).issues[0];
    expect(issue?.cause).toBe("inconsistent-finish-locks");
    const cleared = { ...r, itmRate: undefined, finishBuckets: undefined };
    expect(validateSchedule(applyItmTarget([cleared], off, model), model).issues[0]?.cause).toBe("bounty-pool");
    const fix = chooseClosestFeasibilityFix(r, issue!, model, off);
    expect(fix.kind).toBe("clear-locks");
    expect(fix.row.finishBuckets).toBeUndefined();
    expect(fix.row.roi).toBeCloseTo((0.99 * 200) / 110 - 1, 6);
    expect(validateSchedule(applyItmTarget([fix.row], off, model), model).ok).toBe(true);
    expect(validateSchedule(applyItmTarget([{ ...fix.row, roi: fix.row.roi + 1e-4 }], off, model), model).ok).toBe(false);
    expect(closestFixForRow(r, model, off)?.kind).toBe("clear-locks");
  });
});

describe("Fit closest goes to the edge of the window nearest the typed ROI", () => {
  const off = { enabled: false, pct: 20 };
  const model: FinishModelConfig = { id: "power-law" };
  const passes = (r: TournamentRow) => validateSchedule(applyItmTarget([r], off, model), model).ok;
  const fit = (r: TournamentRow) => {
    const fix = closestFixForRow(r, model, off);
    expect(fix).not.toBeNull();
    expect(passes(fix!.row)).toBe(true);
    expect(passes({ ...fix!.row, roi: fix!.row.roi + 1e-4 * Math.sign(r.roi - fix!.row.roi) })).toBe(false);
    return fix!;
  };

  it.each([
    // A blank ITM on a one-prize-level table follows the ROI up to 0.99; the
    // EV the walk reads at the typed ROI is the fallback ITM's, about
    // break-even, and the window runs on to the 0.99 edge.
    ["heads-up PKO $100+10, 50 % bounty, +100 %", row({
      players: 2, buyIn: 100, rake: 0.1, roi: 1, gameType: "pko", payoutStructure: "mtt-gg-bounty",
      bountyFraction: 0.5, itmRate: undefined, count: 1,
    }), (0.99 * 200) / 110 - 1],
    ["6-max winner-takes-all $10+1, +600 %", row({
      players: 6, buyIn: 10, rake: 0.1, roi: 6, payoutStructure: "winner-takes-all", itmRate: undefined, count: 1,
    }), (0.99 * 60) / 11 - 1],
  ])("keeps the ROI the blank ITM still reaches (%s)", (_, r, edge) => {
    const fix = fit(r);
    expect(fix.kind).toBe("match-roi");
    expect(fix.row.itmRate).toBeUndefined();
    expect(fix.row.roi).toBeCloseTo(edge, 6);
  });

  it("does not take a typed ITM for a blank one that falls back to it (heads-up $10+1 winner-takes-all, ITM 50 %, +100 %)", () => {
    // At +100 % the blank ITM would need 1.1 and falls back to the table's
    // 50 %, so at the typed ROI the row without its ITM plays the row with it.
    // Typed, 50 % pays break-even at most; blank, the ITM follows the ROI up
    // to 0.99.
    const r = row({ players: 2, buyIn: 10, rake: 0.1, roi: 1, payoutStructure: "winner-takes-all", itmRate: 0.5, count: 1 });
    expect(applyItmTarget([{ ...r, itmRate: undefined }], off, model)[0]?.itmRate).toBe(0.5);
    const fix = fit(r);
    expect(fix.kind).toBe("clear-locks");
    expect(fix.row.itmRate).toBeUndefined();
    expect(fix.row.roi).toBeCloseTo((0.99 * 20) / 11 - 1, 6);
  });

  const sng = (over: Partial<TournamentRow>) =>
    row({ players: 9, buyIn: 10, rake: 0.1, payoutStructure: "sng-65-35", itmRate: 0.3, count: 1, ...over });
  const narrowRange = { players: 6, payoutStructure: "sng-50-30-20" as const, itmRate: 0.6, fieldVariability: { kind: "uniform" as const, min: 2, max: 8, buckets: 8 } };

  it.each([
    // The first-place floor used to switch on in one step at break-even and
    // block these rows from there up, leaving a window just under it. It now
    // gives way to the target, so they run as typed and on both sides of
    // break-even, and there is nothing to fit.
    ["SNG 65/35 $50+0 at break-even, 0 %", sng({ buyIn: 50, rake: 0, roi: 0 })],
    ["SNG 65/35 $92+8 at break-even, -8 %", sng({ buyIn: 92, rake: 8 / 92, roi: -0.08 })],
    ["SNG 65/35 $20+5 at break-even, -20 %", sng({ buyIn: 20, rake: 0.25, roi: -0.2 })],
    ["SNG 65/35 $10+1 above break-even, 0 %", sng({ roi: 0 })],
    ["SNG 50/30/20 range of 2-8 players at ITM 60 % at break-even", row({ ...narrowRange, buyIn: 10, rake: 0.1, roi: -0.1 / 1.1, count: 1 })],
  ])("leaves a row the first-place floor no longer blocks at break-even as it is (%s)", (_, r) => {
    const breakEven = -r.rake / (1 + r.rake);
    expect(passes(r)).toBe(true);
    expect(closestFixForRow(r, model, off)).toBeNull();
    expect(passes({ ...r, roi: breakEven - 1e-7 })).toBe(true);
    expect(passes({ ...r, roi: breakEven + 1e-7 })).toBe(true);
  });

  it("fits a narrow range at the most its 4-player size pays (SNG 50/30/20 range of 2-8 players at ITM 60 %, +50 %)", () => {
    // The range passes from ROI -9.14 %, 0.045 points under break-even, up to
    // +9.09 %, the most the 4-player size pays ($12), where the window used
    // to end at break-even.
    const r = row({ ...narrowRange, buyIn: 10, rake: 0.1, roi: 0.5, count: 1 });
    expect(passes(r)).toBe(false);
    const fix = closestFixForRow(r, model, off)!;
    expect(fix.kind).toBe("match-roi");
    expect(fix.row.itmRate).toBe(0.6);
    expect(fix.row.roi).toBeCloseTo(12 / 11 - 1, 6);
    expect(passes(fix.row)).toBe(true);
    expect(passes({ ...fix.row, roi: fix.row.roi + 0.002 })).toBe(false);
  });

  it("keeps the ROI a fixed shape plays under a ROI typed below it, not the edge of its tolerance (PKO, 5 players, α -0.1, ROI -80 %)", () => {
    // The hand-set α pays more than ROI -80 % needs, and the row passes from
    // one on-target tolerance under the ROI it plays, -67.8 %, up through
    // break-even. A ROI at that tolerance edge plays the same EV, so the fit
    // keeps the one the row plays exactly.
    const pinned: FinishModelConfig = { id: "power-law", alpha: -0.1 };
    const r = row({
      players: 5, buyIn: 10, rake: 0.1, roi: -0.8, gameType: "pko", payoutStructure: "mtt-gg-bounty",
      bountyFraction: 0.5, itmRate: undefined, count: 1,
    });
    const pass = (x: TournamentRow) => validateSchedule(applyItmTarget([x], off, pinned), pinned).ok;
    const issue = validateSchedule(applyItmTarget([r], off, pinned), pinned).issues[0]!;
    expect(issue.currentEv).toBeGreaterThan(issue.targetEv);
    const played = issue.currentEv / (r.buyIn * (1 + r.rake)) - 1;
    expect(pass({ ...r, roi: played - 2e-4 })).toBe(true);
    expect(pass({ ...r, roi: -1 / 11 - 1e-7 })).toBe(true);
    const fix = closestFixForRow(r, pinned, off)!;
    expect(fix.kind).toBe("match-roi");
    expect(fix.row.roi).toBe(played);
  });

  it("keeps the ROI the row plays exactly when the window ends there", () => {
    // ITM 20 % on 30 players reaches $23.18 at most; a ROI within the
    // on-target tolerance above that would pass too, but plays the same EV.
    const r = row({ players: 30, buyIn: 10, rake: 0.1, roi: 2, itmRate: 0.2, count: 1 });
    const issue = validateSchedule([r], model).issues[0]!;
    expect(issue.currentEv).toBeCloseTo(23.18, 2);
    const fix = chooseClosestFeasibilityFix(r, issue, model, off);
    expect(fix.kind).toBe("match-roi");
    expect(fix.row.roi).toBe(issue.currentEv / (r.buyIn * (1 + r.rake)) - 1);
  });

  it("is never farther than the nearest passing point of a ROI grid on its own shapes", () => {
    // The fit searches the shapes below and the ROI on each; a grid point that
    // passes on one of them bounds the score the fit may return, up to the
    // bisection's resolution (24 halvings of a ROI span under 100: 6e-6 of ROI,
    // 6e-4 points). Grid: ROI -0.95 to +3 in steps of 0.05, plus +5, +10, +20,
    // and 1e-7 under break-even, where a first-place floor that switched on in
    // one step at break-even left the only window; the rows are typed on the
    // grid and at break-even.
    const breakEven = -0.1 / 1.1;
    const grid = [...Array.from({ length: 80 }, (_, k) => -0.95 + k * 0.05), 5, 10, 20, breakEven - 1e-7];
    const score = (base: TournamentRow, next: TournamentRow) =>
      Math.abs(next.roi - base.roi) * 100 +
      ((base.itmRate ?? null) !== (next.itmRate ?? null) ? 30 : 0) +
      (base.finishBuckets !== next.finishBuckets ? 18 : 0);
    let compared = 0;
    for (const gameType of ["freezeout", "pko"] as const)
      for (const players of [2, 6, 9, 30])
        for (const roi of [-0.6, breakEven, 0, 0.5, 4])
          for (const itmRate of [undefined, 0.3])
            for (const finishBuckets of [undefined, { first: 0.2 }]) {
              const r = row({
                id: "o", players, buyIn: 10, rake: 0.1, roi, gameType, itmRate, finishBuckets, count: 1,
                payoutStructure: gameType === "pko" ? "mtt-gg-bounty" : players === 2 ? "winner-takes-all" : "sng-50-30-20",
                bountyFraction: gameType === "pko" ? 0.5 : undefined,
              });
              const fix = closestFixForRow(r, model, off);
              if (fix === null) continue;
              const bounty = inferGameType(r) === "pko";
              const shapes = [
                r,
                bounty ? { ...r, itmRate: undefined, finishBuckets: undefined } : { ...r, finishBuckets: undefined },
                { ...r, itmRate: undefined, finishBuckets: undefined },
                ...(bounty ? [] : [{ ...r, itmRate: 0.16, finishBuckets: undefined }]),
              ];
              const fixScore = fix.kind === "none" ? Infinity : score(r, fix.row);
              const label = JSON.stringify({ gameType, players, roi, itmRate, finishBuckets, fix: [fix.kind, fix.row.roi] });
              for (const shape of shapes)
                for (const g of grid) {
                  const at = { ...shape, roi: g };
                  if (score(r, at) < fixScore - 1e-3 && passes(at)) expect.fail(`${label} passes at ${JSON.stringify([g, shape.itmRate, shape.finishBuckets])}`);
                }
              compared++;
            }
    expect(compared).toBeGreaterThan(40);
  });
});

describe("Fit closest on a fixed shape whose KO EV the bounty pool cuts", () => {
  const off = { enabled: false, pct: 20 };
  const passes = (r: TournamentRow, model: FinishModelConfig) =>
    validateSchedule(applyItmTarget([r], off, model), model).ok;

  it.each(["uniform", "empirical"] as const)(
    "clears the locks and lowers the ROI to what the pool pays (%s, 3-player Mystery)",
    (id) => {
      // P(1st) 4 % pinned on a table that pays one place at ITM 60 % is a
      // contradiction. Without the locks the model plays its own shape:
      // $125 of cash and pooled bounties against the $187 that ROI +70 %
      // needs, so clearing the locks alone leaves the row blocked.
      const model: FinishModelConfig = { id };
      const r = row({
        id: "m3", players: 3, buyIn: 100, rake: 0.1, roi: 0.7, gameType: "mystery",
        payoutStructure: "mtt-standard", bountyFraction: 0.25, mysteryBountyVariance: 2,
        itmRate: 0.6, finishBuckets: { first: 0.04 }, count: 1,
      });
      const issue = validateSchedule(applyItmTarget([r], off, model), model).issues[0];
      expect(issue?.cause).toBe("inconsistent-finish-locks");
      const cleared = validateSchedule(
        applyItmTarget([{ ...r, itmRate: undefined, finishBuckets: undefined }], off, model),
        model,
      ).issues[0];
      expect(cleared?.cause).toBe("fixed-shape");
      expect(cleared?.currentEv).toBeCloseTo(125, 9);

      const fix = chooseClosestFeasibilityFix(r, issue!, model, off);
      expect(fix.kind).toBe("clear-locks");
      expect(fix.row.finishBuckets).toBeUndefined();
      expect(fix.row.itmRate).toBeUndefined();
      expect(fix.row.roi).toBeCloseTo(125 / 110 - 1, 9);
      expect(passes(fix.row, model)).toBe(true);
    },
  );

  it("returns only rows validateSchedule accepts, and leaves only rows no ROI unblocks", () => {
    // Every model kind on small bounty and freezeout fields, contradictory
    // and consistent locks, pinned and default ITMs, fixed fields and ranges.
    // A row the fix leaves is checked against every shape the fix tries at
    // every ROI from -99 % to +301 % in steps of 4 points.
    const models: FinishModelConfig[] = [
      { id: "uniform" }, { id: "empirical" }, { id: "power-law" },
      { id: "power-law", alpha: 0.2 }, { id: "powerlaw-realdata-influenced" },
    ];
    let blocked = 0;
    let fixed = 0;
    let combined = 0;
    let left = 0;
    for (const model of models)
      for (const gameType of ["freezeout", "pko", "mystery"] as const)
        for (const players of [2, 3, 6, 18])
          for (const roi of [-0.5, 0, 0.7, 2])
            for (const itmRate of [undefined, 0.3, 0.6])
              for (const finishBuckets of [undefined, { first: 0.7 }, { first: 0.02 }])
                for (const fieldVariability of players < 6 ? [undefined] : [
                  undefined,
                  { kind: "uniform" as const, min: players / 2, max: players * 1.5, buckets: 3 },
                ]) {
                const r = row({
                  id: "g", players, buyIn: 10, rake: 0.1, roi, gameType, itmRate, finishBuckets, fieldVariability,
                  payoutStructure: gameType === "freezeout" ? "mtt-standard" : "mtt-gg-bounty",
                  bountyFraction: gameType === "freezeout" ? undefined : 0.5,
                  mysteryBountyVariance: gameType === "mystery" ? 2 : undefined,
                  count: 1,
                });
                const issue = validateSchedule(applyItmTarget([r], off, model), model).issues[0];
                if (!issue) continue;
                blocked++;
                const fix = chooseClosestFeasibilityFix(r, issue, model, off);
                const label = JSON.stringify({ model, gameType, players, roi, itmRate, finishBuckets, fieldVariability });
                if (fix.kind !== "none") {
                  fixed++;
                  expect(passes(fix.row, model), label).toBe(true);
                  if (fix.kind !== "match-roi" && fix.row.roi !== r.roi) combined++;
                  continue;
                }
                left++;
                expect(fix.row, label).toBe(r);
                const shapes = [
                  r,
                  { ...r, finishBuckets: undefined },
                  { ...r, itmRate: undefined, finishBuckets: undefined },
                  { ...r, itmRate: 0.16, finishBuckets: undefined },
                ];
                for (const shape of shapes)
                  for (let k = 0; k <= 100; k++) {
                    expect(passes({ ...shape, roi: -0.99 + k * 0.04 }, model), label).toBe(false);
                  }
              }
    // The grid is not vacuous: it holds every outcome the fit can have.
    expect(blocked).toBeGreaterThan(1000);
    expect(fixed).toBeGreaterThan(blocked / 2);
    expect(combined).toBeGreaterThan(0);
    expect(left).toBeGreaterThan(0);
  });
});
