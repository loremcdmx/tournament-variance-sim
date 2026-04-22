import { describe, expect, it } from "vitest";
import {
  parseBuyIn,
  parseImportCSV,
  suggestStandardBuyInFromBrCarryover,
} from "./ScheduleEditor";

describe("parseBuyIn", () => {
  it("rejects plus-form tickets when fee exceeds 100% of the buy-in", () => {
    expect(parseBuyIn("50+5000", 0.1)).toBeNull();
    expect(parseBuyIn("$50 + $51", 0.1)).toBeNull();
  });
});

describe("suggestStandardBuyInFromBrCarryover", () => {
  it("snaps carried-over BR tiers to a regular 10% buy-in+rake structure", () => {
    expect(suggestStandardBuyInFromBrCarryover(10 / 1.08, 0.08)).toEqual({
      buyIn: 10,
      rake: 0.1,
    });
    expect(suggestStandardBuyInFromBrCarryover(3 / 1.08, 0.08)).toEqual({
      buyIn: 3,
      rake: 0.1,
    });
  });

  it("does not suggest anything for normal non-BR structures", () => {
    expect(suggestStandardBuyInFromBrCarryover(10, 0.1)).toBeNull();
    expect(suggestStandardBuyInFromBrCarryover(50, 0.1)).toBeNull();
  });
});

describe("parseImportCSV", () => {
  it("rejects buy-ins whose fee would produce out-of-contract rake", () => {
    const parsed = parseImportCSV(
      "Bad rake, 500, 50+5000, 10, 1, mtt-standard",
    );

    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toEqual(['line 1: bad buy-in "50+5000"']);
  });

  it("rejects players above the editor max instead of importing giant fields", () => {
    const parsed = parseImportCSV(
      "Huge field, 20000000, 50+5, 10, 1, mtt-standard",
    );

    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toEqual(["line 1: players must be 2..1000000"]);
  });

  it("rejects non-numeric count cells instead of importing NaN rows", () => {
    const parsed = parseImportCSV(
      "Bad count, 500, 50+5, 10, abc, mtt-standard",
    );

    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toEqual(["line 1: count must be 1..100000"]);
  });

  it("rejects count cells above the UI max instead of importing huge runs", () => {
    const parsed = parseImportCSV(
      "Huge count, 500, 50+5, 10, 1000000000, mtt-standard",
    );

    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toEqual(["line 1: count must be 1..100000"]);
  });

  it("rejects junk numeric cells instead of silently truncating them", () => {
    const parsed = parseImportCSV(
      [
        "Sci players, 2e3, 50+5, 10, 3, mtt-standard",
        "Junk players, 500abc, 20+2, 5, 2, mtt-standard",
        "Junk roi, 1000, 10+1, 5oops, 1, mtt-standard",
        "Junk count, 1000, 10+1, 5, 2oops, mtt-standard",
      ].join("\n"),
    );

    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toEqual([
      "line 1: players must be 2..1000000",
      "line 2: players must be 2..1000000",
      "line 3: roi must be a plain number",
      "line 4: count must be 1..100000",
    ]);
  });

  it("keeps missing count optional and floors valid numeric counts", () => {
    const parsed = parseImportCSV(
      [
        "Missing count, 500, 50+5, 10",
        "Decimal count, 500, 50+5, 10, 3.9, mtt-standard",
      ].join("\n"),
    );

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].count).toBe(1);
    expect(parsed.rows[1].count).toBe(3);
  });
});
