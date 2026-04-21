import { describe, expect, it } from "vitest";
import { parseImportCSV } from "./ScheduleEditor";

describe("parseImportCSV", () => {
  it("rejects non-numeric count cells instead of importing NaN rows", () => {
    const parsed = parseImportCSV(
      "Bad count, 500, 50+5, 10, abc, mtt-standard",
    );

    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toEqual(["line 1: count must be >= 1"]);
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
