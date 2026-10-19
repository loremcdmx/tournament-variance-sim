import { describe, expect, it } from "vitest";
import { applyItmTarget } from "@/lib/sim/itmTarget";
import { validateSchedule } from "@/lib/sim/validation";
import type { TournamentRow } from "@/lib/sim/types";
import { isTop3LockAvailable, patchFinishLocks } from "./shapeLocks";

const itmOff = { enabled: false, pct: 18.7 };
const raw: TournamentRow = {
  id: "r1",
  players: 1000,
  buyIn: 25,
  rake: 0.1,
  roi: 0.1,
  payoutStructure: "mtt-standard",
  gameType: "freezeout",
  count: 1,
};

// What page.tsx does with a panel edit: the panel sees the effective row, the
// patch is merged into the raw row, and the next render derives the effective
// row again.
const edit = (rawRow: TournamentRow, patch: (effective: TournamentRow) => Partial<TournamentRow>) => {
  const effective = applyItmTarget([rawRow], itmOff)[0];
  const nextRaw = { ...rawRow, ...patch(effective) };
  return { raw: nextRaw, effective: applyItmTarget([nextRaw], itmOff)[0] };
};

describe("patchFinishLocks", () => {
  it("a lock typed on a row with a blank ITM survives applyItmTarget", () => {
    expect(raw.itmRate).toBeUndefined();
    const effectiveBefore = applyItmTarget([raw], itmOff)[0];
    expect(effectiveBefore.itmRate).toBeCloseTo(0.15, 12);

    const { raw: nextRaw, effective } = edit(raw, (e) => patchFinishLocks(e, { first: 0.02 }));
    expect(nextRaw.itmRate).toBeCloseTo(0.15, 12);
    expect(effective.finishBuckets).toEqual({ first: 0.02 });
    expect(effective.itmRate).toBeCloseTo(0.15, 12);
  });

  it("the plain patch, without the ITM, is what applyItmTarget used to throw away", () => {
    const { effective } = edit(raw, () => ({ finishBuckets: { first: 0.02 } }));
    expect(effective.finishBuckets).toBeUndefined();
  });

  it("a Lock click (first at its current value) is honoured the same way", () => {
    const { effective } = edit(raw, (e) => patchFinishLocks(e, { first: 0.000287 }));
    expect(effective.finishBuckets).toEqual({ first: 0.000287 });
  });

  it("does not move an ITM the row already has", () => {
    const explicit = { ...raw, itmRate: 0.16 };
    const { raw: nextRaw, effective } = edit(explicit, (e) => patchFinishLocks(e, { first: 0.02 }));
    expect(nextRaw.itmRate).toBe(0.16);
    expect(effective.finishBuckets).toEqual({ first: 0.02 });
  });

  it("removing the last lock leaves the ITM alone and clears the buckets", () => {
    const locked = { ...raw, itmRate: 0.16, finishBuckets: { first: 0.02 } };
    const patch = patchFinishLocks(locked, { first: undefined });
    expect(patch).toEqual({ finishBuckets: undefined });
    expect("itmRate" in patch).toBe(false);
  });

  it("carries no ITM when the panel has none to show", () => {
    expect(patchFinishLocks({ finishBuckets: undefined, itmRate: undefined }, { first: 0.02 }))
      .toEqual({ finishBuckets: { first: 0.02 } });
    expect(patchFinishLocks({ finishBuckets: undefined, itmRate: 0 }, { first: 0.02 }))
      .toEqual({ finishBuckets: { first: 0.02 } });
  });

  it("drops undefined keys", () => {
    const row = { itmRate: 0.16, finishBuckets: { first: 0.01, ft: 0.08 } };
    expect(patchFinishLocks(row, { ft: undefined })).toEqual({
      finishBuckets: { first: 0.01 },
      itmRate: 0.16,
    });
  });

  describe("Top-3 needs First or FT beside it", () => {
    it("refuses a lone Top-3 lock", () => {
      const row = { itmRate: 0.16, finishBuckets: undefined };
      expect(patchFinishLocks(row, { top3: 0.05 })).toEqual({ finishBuckets: undefined });
    });

    it("accepts Top-3 once First or FT is locked", () => {
      expect(patchFinishLocks({ itmRate: 0.16, finishBuckets: { first: 0.01 } }, { top3: 0.05 }))
        .toEqual({ finishBuckets: { first: 0.01, top3: 0.05 }, itmRate: 0.16 });
      expect(patchFinishLocks({ itmRate: 0.16, finishBuckets: { ft: 0.1 } }, { top3: 0.05 }))
        .toEqual({ finishBuckets: { top3: 0.05, ft: 0.1 }, itmRate: 0.16 });
    });

    it("unlocking the only anchor takes the Top-3 lock with it", () => {
      const row = { itmRate: 0.16, finishBuckets: { first: 0.01, top3: 0.05 } };
      expect(patchFinishLocks(row, { first: undefined })).toEqual({ finishBuckets: undefined });
    });

    it("unlocking one of two anchors keeps the Top-3 lock", () => {
      const row = { itmRate: 0.16, finishBuckets: { first: 0.01, top3: 0.05, ft: 0.1 } };
      expect(patchFinishLocks(row, { first: undefined })).toEqual({
        finishBuckets: { top3: 0.05, ft: 0.1 },
        itmRate: 0.16,
      });
    });

    it("no sequence of panel edits ever leaves a lone Top-3 lock for validateSchedule to reject", () => {
      const steps: Array<Partial<{ first: number | undefined; top3: number | undefined; ft: number | undefined }>> = [
        { first: 0.002 }, { top3: 0.05 }, { ft: 0.1 }, { first: undefined }, { ft: undefined },
        { top3: 0.05 }, { ft: 0.1 }, { top3: undefined }, { first: 0.002 }, { first: undefined }, { ft: undefined },
      ];
      let rawRow: TournamentRow = raw;
      for (const step of steps) {
        rawRow = edit(rawRow, (e) => patchFinishLocks(e, step)).raw;
        const effective = applyItmTarget([rawRow], itmOff)[0];
        const locks = effective.finishBuckets;
        expect(locks?.top3 != null && locks.first == null && locks.ft == null).toBe(false);
        expect(
          validateSchedule([effective], { id: "power-law" }).issues.map((i) => i.reason),
        ).not.toContain("inconsistent-finish-locks");
      }
    });
  });
});

describe("isTop3LockAvailable", () => {
  it("needs First or FT", () => {
    expect(isTop3LockAvailable(undefined)).toBe(false);
    expect(isTop3LockAvailable({})).toBe(false);
    expect(isTop3LockAvailable({ top3: 0.05 })).toBe(false);
    expect(isTop3LockAvailable({ first: 0.01 })).toBe(true);
    expect(isTop3LockAvailable({ ft: 0.1 })).toBe(true);
  });
});
