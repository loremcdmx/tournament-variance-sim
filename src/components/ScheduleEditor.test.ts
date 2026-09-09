import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseBuyIn,
  displayItmPct,
  parseImportCSV,
  prepareScheduleImport,
  ScheduleEditor,
  suggestStandardBuyInFromBrCarryover,
} from "./ScheduleEditor";
import { battleRoyaleRowFromTotalTicket } from "@/lib/sim/battleRoyaleTicket";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { AdvancedModeProvider } from "@/lib/ui/AdvancedModeProvider";
import { DICT } from "@/lib/i18n/dict";

afterEach(() => vi.unstubAllGlobals());

describe("displayed row ITM follows the effective run policy", () => {
  const row = parseImportCSV("Standard, 500, 50+5, 10, 1, mtt-standard").rows[0];

  it("shows equilibrium when the global input is zero or disabled", () => {
    expect(displayItmPct(row, 0)).toBe(15);
    expect(displayItmPct(row, null)).toBe(15);
  });

  it("treats explicit row zero as automatic inheritance", () => {
    expect(displayItmPct({ ...row, itmRate: 0 }, 18.7)).toBe(18.7);
    expect(displayItmPct({ ...row, itmRate: 0 }, 0)).toBe(15);
  });

  it("shows 100% when every finishing place pays, even with a stale override", () => {
    expect(displayItmPct({ ...row, players: 2, payoutStructure: "custom", customPayouts: [0.5, 0.5], itmRate: 0.15 }, 18.7)).toBe(100);
  });

  it("preserves an ordinary positive row override over the global value", () => {
    expect(displayItmPct({ ...row, itmRate: 0.22 }, 18.7)).toBe(22);
  });
});

describe("inconsistent finish locks notice", () => {
  it("explains incompatible locks and offers clearing instead of an ROI fix", () => {
    vi.stubGlobal("React", React);
    const schedule = parseImportCSV("Locked, 9, 10+1, 0, 1, mtt-standard").rows;
    const html = renderToStaticMarkup(React.createElement(LocaleProvider, null,
      React.createElement(AdvancedModeProvider, null,
        React.createElement(ScheduleEditor, {
          schedule,
          onChange: vi.fn(),
          onFixRowClosest: vi.fn(),
          onFixRowAuto: vi.fn(),
          onFixRowPreset: vi.fn(),
          feasibilityIssues: [{ rowId: schedule[0].id, rowIdx: 0, label: "Locked",
            targetEv: 10, currentEv: 10, gap: 0, reason: "inconsistent-finish-locks" }],
        }),
      ),
    ));
    expect(html).toContain(DICT["shape.inconsistentFinishLocks"].ru);
    expect(html).toContain(DICT["shape.clearFinishLocks"].ru);
    expect(html).not.toContain(DICT["shape.fixClosest"].ru);
    expect(html).not.toContain("EW $10.00");
  });
});

describe("parseBuyIn", () => {
  it.each(["50abc", "50+50+5", "50..25+5", "0,25", "50+", "-50", "1e2"])(
    "rejects the entire malformed ticket %s",
    (ticket) => expect(parseBuyIn(ticket, 0.1)).toBeNull(),
  );

  it("accepts complete decimal and grouped tickets while preserving plain-entry rake", () => {
    expect(parseBuyIn("$50 + $5", 0.2)).toEqual({ buyIn: 50, rake: 0.1 });
    expect(parseBuyIn("$1,000.50", 0.2)).toEqual({ buyIn: 1000.5, rake: 0.2 });
    expect(parseBuyIn(".50+.05", 0.2)).toEqual({ buyIn: 0.5, rake: 0.1 });
    expect(parseBuyIn("50+0", 0.2)).toEqual({ buyIn: 50, rake: 0 });
  });
  it("rejects plus-form tickets when fee exceeds 100% of the buy-in", () => {
    expect(parseBuyIn("50+5000", 0.1)).toBeNull();
    expect(parseBuyIn("$50 + $51", 0.1)).toBeNull();
  });
});

describe("atomic schedule import", () => {
  const valid = "Valid, 500, 50+5, 10, 1, mtt-standard";
  const original = parseImportCSV(valid).rows;

  it.each(["append", "replace"] as const)("keeps the schedule on partial %s errors", (mode) => {
    const result = prepareScheduleImport(`${valid}\nBroken, abc, 50+5`, original, mode, "too many");
    expect(result.schedule).toBeNull();
    expect(result.errors).toEqual(["line 2: players must be 2..1000000"]);
    expect(original).toHaveLength(1);
  });

  it("rejects overflow instead of silently dropping imported rows", () => {
    const atCap = Array(300).fill(valid).join("\n");
    expect(prepareScheduleImport(atCap, [], "replace", "limit").schedule).toHaveLength(300);
    expect(prepareScheduleImport(atCap, original, "append", "limit")).toEqual({
      schedule: null, errors: ["limit"],
    });
    expect(prepareScheduleImport(`${atCap}\n${valid}`, original, "replace", "limit")).toEqual({
      schedule: null, errors: ["limit"],
    });
  });

  it("applies a completely valid append or replacement", () => {
    expect(prepareScheduleImport(valid, original, "append", "limit").schedule).toHaveLength(2);
    expect(prepareScheduleImport(valid, original, "replace", "limit").schedule).toHaveLength(1);
  });
});

describe("suggestStandardBuyInFromBrCarryover", () => {
  it("snaps carried-over BR tiers to a regular 10% buy-in+rake structure", () => {
    const br10 = battleRoyaleRowFromTotalTicket(10);
    const br3 = battleRoyaleRowFromTotalTicket(3);
    expect(suggestStandardBuyInFromBrCarryover(br10.buyIn, br10.rake)).toEqual({
      buyIn: 10,
      rake: 0.1,
    });
    expect(suggestStandardBuyInFromBrCarryover(br3.buyIn, br3.rake)).toEqual({
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

  it("canonicalizes imported Battle Royale rows to 18-max Mystery Royale", () => {
    const parsed = parseImportCSV(
      "Imported BR, 500, 9.20+0.80, 5, 12, battle-royale",
    );

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      players: 18,
      gameType: "mystery-royale",
      payoutStructure: "battle-royale",
      count: 12,
    });
  });
});
