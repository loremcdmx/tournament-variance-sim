import { describe, expect, it } from "vitest";

import {
  commitDraftValue,
  isDraftInvalid,
  liveDraftValue,
  normalizeNumericDraft,
  parseNumericDraft,
} from "./numberDraft";

describe("normalizeNumericDraft", () => {
  it("removes redundant leading zeros from integers", () => {
    expect(normalizeNumericDraft("0100")).toBe("100");
    expect(normalizeNumericDraft("0005")).toBe("5");
    expect(normalizeNumericDraft("-0012")).toBe("-12");
  });

  it("preserves one zero for decimal inputs", () => {
    expect(normalizeNumericDraft("00.5")).toBe("0.5");
    expect(normalizeNumericDraft("000.50")).toBe("0.50");
    expect(normalizeNumericDraft("00.")).toBe("0.");
  });

  it("leaves already-normal or partial values alone", () => {
    expect(normalizeNumericDraft("0")).toBe("0");
    expect(normalizeNumericDraft("100")).toBe("100");
    expect(normalizeNumericDraft("")).toBe("");
    expect(normalizeNumericDraft(".5")).toBe(".5");
    expect(normalizeNumericDraft("1e3")).toBe("1e3");
  });
});

describe("draft values", () => {
  it.each(["", " ", "   ", "-", "+", ".", "abc", "1e999", "Infinity"])(
    "treats %j as no value, never as zero",
    (draft) => {
      expect(parseNumericDraft(draft)).toBeNull();
      expect(commitDraftValue(draft, 1, 100)).toBeNull();
      expect(liveDraftValue(draft, 1, 100)).toBeNull();
      expect(isDraftInvalid(draft, 1, 100)).toBe(true);
    },
  );

  it("keeps a real zero", () => {
    expect(parseNumericDraft("0")).toBe(0);
    expect(commitDraftValue("0", undefined, undefined)).toBe(0);
    expect(commitDraftValue("0", 1, 100)).toBe(1);
  });

  it("clamps on commit but applies only in-bounds numbers while typing", () => {
    expect(commitDraftValue("5", 100, 1000)).toBe(100);
    expect(commitDraftValue("5000", 100, 1000)).toBe(1000);
    expect(commitDraftValue("-5", undefined, undefined)).toBe(-5);
    expect(liveDraftValue("5", 100, 1000)).toBeNull();
    expect(liveDraftValue("500", 100, 1000)).toBe(500);
    expect(liveDraftValue("5000", 100, 1000)).toBeNull();
    expect(isDraftInvalid("5", 100, 1000)).toBe(true);
    expect(isDraftInvalid("500", 100, 1000)).toBe(false);
  });

  it("types 1000 into a 50..50000 field without the first keystroke clamping the rest", () => {
    const committed: number[] = [];
    for (const typed of ["1", "10", "100", "1000"]) {
      const next = liveDraftValue(typed, 50, 50_000);
      if (next !== null) committed.push(next);
    }
    expect(committed).toEqual([100, 1000]);
    expect(commitDraftValue("1000", 50, 50_000)).toBe(1000);
  });

  it("types 99 and a negative ROI as typed", () => {
    expect(["9", "99"].map((d) => liveDraftValue(d, 50, 99.99))).toEqual([null, 99]);
    expect(["-", "-5"].map((d) => liveDraftValue(d, -50, 100))).toEqual([null, -5]);
  });
});
