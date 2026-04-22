import { describe, expect, it } from "vitest";

import { normalizeNumericDraft } from "./numberDraft";

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
