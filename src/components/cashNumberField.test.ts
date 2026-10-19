import { describe, expect, it } from "vitest";
import {
  clampNumFieldValue,
  commitNumFieldDraft,
  parseNumFieldDraft,
  stepNumFieldValue,
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

describe("stepNumFieldValue", () => {
  it("steps from the current value, not from the minimum", () => {
    expect(stepNumFieldValue(1, 1, 0.25, 0.01)).toBe(1.25);
    expect(stepNumFieldValue(1, -1, 0.25, 0.01)).toBe(0.75);
    expect(stepNumFieldValue(100, 1, 5, 1)).toBe(105);
    expect(stepNumFieldValue(20_000, 1, 10_000, 1000)).toBe(30_000);
    expect(stepNumFieldValue(20_000, -1, 10_000, 1000)).toBe(10_000);
    expect(stepNumFieldValue(2000, 1, 500, 100)).toBe(2500);
  });

  it("keeps decimal steps free of float noise", () => {
    expect(stepNumFieldValue(0.1, 1, 0.05, 0.05, 1)).toBe(0.15);
    expect(stepNumFieldValue(0.7, 1, 0.05, 0, 1)).toBe(0.75);
    expect(stepNumFieldValue(2.2, 1, 0.1)).toBe(2.3);
  });

  it("stops at the field bounds", () => {
    expect(stepNumFieldValue(0.01, -1, 0.25, 0.01)).toBe(0.01);
    expect(stepNumFieldValue(95, 1, 10, 0, 100)).toBe(100);
    expect(stepNumFieldValue(-1000, -1, 0.5, -1000, 1000)).toBe(-1000);
  });
});
