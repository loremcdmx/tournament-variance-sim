import { describe, expect, it } from "vitest";
import {
  clampNumFieldValue,
  commitNumFieldDraft,
  parseNumFieldDraft,
} from "./cashNumberField";

describe("cashNumberField", () => {
  it("keeps in-range drafts live but defers out-of-range ones", () => {
    expect(parseNumFieldDraft("1500", 1000)).toBe(1500);
    expect(parseNumFieldDraft("1", 1000)).toBeNull();
    expect(parseNumFieldDraft("25000", 100, 20_000)).toBeNull();
    expect(parseNumFieldDraft("oops", 0, 1)).toBeNull();
  });

  it("clamps committed drafts back inside visible bounds", () => {
    expect(clampNumFieldValue(1, 1000)).toBe(1000);
    expect(clampNumFieldValue(25_000, 100, 20_000)).toBe(20_000);
    expect(commitNumFieldDraft("1", 100_000, 1000)).toBe(1000);
    expect(commitNumFieldDraft("25000", 2000, 100, 20_000)).toBe(20_000);
    expect(commitNumFieldDraft("oops", 500, 100, 20_000)).toBe(500);
  });
});
