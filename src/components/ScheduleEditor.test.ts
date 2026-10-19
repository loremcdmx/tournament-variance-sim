import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdvancedRowPanel,
  buyInToCommit,
  parseBuyIn,
  displayItmPct,
  parseImportCSV,
  planScheduleImport,
  prepareScheduleImport,
  ScheduleEditor,
  suggestStandardBuyInFromBrCarryover,
} from "./ScheduleEditor";
import { battleRoyaleRowFromTotalTicket } from "@/lib/sim/battleRoyaleTicket";
import {
  DEFAULT_BATTLE_ROYALE_BOUNTY_FRACTION,
  applyGameType,
  inferGameType,
  normalizeGameTypeConsistency,
  rowHasActiveBounty,
} from "@/lib/sim/gameType";
import { checkInputSanity } from "@/lib/sim/inputSanity";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { AdvancedModeProvider } from "@/lib/ui/AdvancedModeProvider";
import { DICT } from "@/lib/i18n/dict";
import type { PayoutStructureId, TournamentRow } from "@/lib/sim/types";

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
  it.each(["50abc", "50+50+5", "50..25+5", "50+", "-50", "1e2"])(
    "rejects the entire malformed ticket %s",
    (ticket) => expect(parseBuyIn(ticket, 0.1)).toBeNull(),
  );

  describe("decimal and thousands commas", () => {
    it.each([
      ["0,25", { buyIn: 0.25, rake: 0.2 }],
      ["0,5", { buyIn: 0.5, rake: 0.2 }],
      ["5,5", { buyIn: 5.5, rake: 0.2 }],
      ["1,25", { buyIn: 1.25, rake: 0.2 }],
      ["12,34", { buyIn: 12.34, rake: 0.2 }],
      ["9,20+0,80", { buyIn: 9.2, rake: 0.8 / 9.2 }],
      ["0,55+0,05", { buyIn: 0.55, rake: 0.05 / 0.55 }],
      ["2,5+0,25", { buyIn: 2.5, rake: 0.1 }],
      ["$9,20 + $0,80", { buyIn: 9.2, rake: 0.8 / 9.2 }],
      ["9.20+0,80", { buyIn: 9.2, rake: 0.8 / 9.2 }],
      ["1,000", { buyIn: 1000, rake: 0.2 }],
      ["$1,050+$50", { buyIn: 1050, rake: 50 / 1050 }],
      ["1,000+100", { buyIn: 1000, rake: 0.1 }],
      ["1,000,000", { buyIn: 1_000_000, rake: 0.2 }],
      ["1,000.50", { buyIn: 1000.5, rake: 0.2 }],
    ])("reads %s", (ticket, expected) => {
      expect(parseBuyIn(ticket, 0.2)).toEqual(expected);
    });

    it.each([
      "0,250", "0,500", "00,250", "1,2345", "5,", ",5", "1,5,5", "1,000,5",
      "9,20+", "9,20+0,", "1.000,50", "5,5.5", "1,50.5", "0,0", "1,000+0,250",
    ])("rejects %s instead of guessing a hundredfold different buy-in", (ticket) => {
      expect(parseBuyIn(ticket, 0.2)).toBeNull();
    });
  });

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

  describe("Ocean KO tickets", () => {
    const ticketOf = (p: { buyIn: number; rake: number }) => p.buyIn * (1 + p.rake);

    it("reads a single number as the full ticket, fee included", () => {
      const p = parseBuyIn("100", 0.1, "ocean-ko")!;
      expect(p.buyIn).toBeCloseTo(92, 10);
      expect(p.buyIn * p.rake).toBeCloseTo(8, 10);
      expect(ticketOf(p)).toBeCloseTo(100, 10);
      expect(ticketOf(p) * 0.5).toBeCloseTo(50, 10);
    });

    it("ignores the row's previous rake for a single number", () => {
      const p = parseBuyIn("$25", 0.5, "ocean-ko")!;
      expect(ticketOf(p)).toBeCloseTo(25, 10);
      expect(p.rake).toBeCloseTo(8 / 92, 12);
    });

    it("keeps 92+8 as the same $100 row and still honours a custom fee", () => {
      const p = parseBuyIn("92+8", 0.1, "ocean-ko")!;
      expect(p.buyIn).toBe(92);
      expect(p.rake).toBeCloseTo(8 / 92, 12);
      expect(ticketOf(p)).toBeCloseTo(100, 10);
      expect(parseBuyIn("92+10", 0.1, "ocean-ko")).toEqual({ buyIn: 92, rake: 10 / 92 });
    });

    it("still rejects malformed Ocean input", () => {
      expect(parseBuyIn("100abc", 0.1, "ocean-ko")).toBeNull();
      expect(parseBuyIn("0", 0.1, "ocean-ko")).toBeNull();
    });

    it("leaves the other formats on the net-buy-in reading", () => {
      for (const gt of ["freezeout", "pko", "mystery"] as const) {
        expect(parseBuyIn("100", 0.1, gt)).toEqual({ buyIn: 100, rake: 0.1 });
      }
      expect(parseBuyIn("100", 0.1)).toEqual({ buyIn: 100, rake: 0.1 });
    });

    it("reads a single Battle Royale number as the full lobby ticket too", () => {
      const p = parseBuyIn("10", 0.1, "mystery-royale")!;
      expect(ticketOf(p)).toBeCloseTo(10, 10);
      expect(p.buyIn).toBeCloseTo(9.2, 10);
      expect(parseBuyIn("9.2+0.8", 0.1, "mystery-royale")).toEqual({ buyIn: 9.2, rake: 0.8 / 9.2 });
    });
  });
});

describe("buyInToCommit", () => {
  const cur = (buyIn: number, rake: number) => ({ buyIn, rake });

  it("leaves the row alone when the box is focused and left unchanged", () => {
    // The box shows 0.25 at 10 % as "0.25+0.03"; read back that is a 12 % rake.
    expect(parseBuyIn("0.25+0.03", 0.1)?.rake).toBeCloseTo(0.12, 12);
    for (const [buyIn, text] of [
      [0.25, "0.25+0.03"],
      [0.35, "0.35+0.03"],
      [0.75, "0.75+0.08"],
      [1.25, "1.25+0.13"],
      [50, "50+5"],
    ] as const) {
      expect(buyInToCommit(text, cur(buyIn, 0.1), "freezeout", "blur")).toBeNull();
    }
  });

  it("commits a real change, and keeps it when the typed text is the new ticket", () => {
    expect(buyInToCommit("55", cur(50, 0.1), "freezeout", "typing")).toEqual({ buyIn: 55, rake: 0.1 });
    expect(buyInToCommit("20+3", cur(50, 0.1), "freezeout", "blur")).toEqual({ buyIn: 20, rake: 3 / 20 });
    expect(buyInToCommit("20+3", cur(20, 3 / 20), "freezeout", "blur")).toBeNull();
  });

  it("does not re-commit text that already means the stored ticket", () => {
    expect(buyInToCommit("10", cur(10, 0.1), "freezeout", "typing")).toBeNull();
    expect(buyInToCommit("100", cur(92, 8 / 92), "ocean-ko", "blur")).toBeNull();
  });

  it("treats the canonical text as no change while typing too, spaces and $ aside", () => {
    for (const typed of ["0.25+0.03 ", " 0.25+0.03", "0.25 + 0.03", "$0.25+$0.03", "0.25+0.03"]) {
      expect(buyInToCommit(typed, cur(0.25, 0.1), "freezeout", "typing")).toBeNull();
      expect(buyInToCommit(typed, cur(0.25, 0.1), "freezeout", "blur")).toBeNull();
    }
  });

  it("compares against the ticket it is handed, so '10' after '1' commits even when the props still say 10", () => {
    expect(buyInToCommit("10", cur(1, 0.1), "freezeout", "typing")).toEqual({ buyIn: 10, rake: 0.1 });
    expect(buyInToCommit("10", cur(10, 0.1), "freezeout", "typing")).toBeNull();
  });

  it("does not commit an unparsable box", () => {
    expect(buyInToCommit("50+", cur(50, 0.1), "freezeout", "blur")).toBeNull();
    expect(buyInToCommit("", cur(50, 0.1), "freezeout", "blur")).toBeNull();
  });

  it("holds a comma until the box is left, since the keystrokes in between mean other numbers", () => {
    let committed = 0;
    for (const typed of ["5", "5,", "5,5"]) {
      if (buyInToCommit(typed, cur(50, 0.1), "freezeout", "typing")) committed++;
    }
    expect(committed).toBe(1);
    expect(buyInToCommit("5,5", cur(50, 0.1), "freezeout", "typing")).toBeNull();
    expect(buyInToCommit("5,5", cur(50, 0.1), "freezeout", "blur")).toEqual({ buyIn: 5.5, rake: 0.1 });
    expect(buyInToCommit("9,20+0,80", cur(50, 0.1), "freezeout", "blur")).toEqual({
      buyIn: 9.2, rake: 0.8 / 9.2,
    });
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

  it("counts the rows already in the live schedule against the cap", () => {
    expect(planScheduleImport(valid, 299, "append", "limit").rows).toHaveLength(1);
    expect(planScheduleImport(valid, 300, "append", "limit")).toEqual({ rows: null, errors: ["limit"] });
    expect(planScheduleImport(valid, 300, "replace", "limit").rows).toHaveLength(1);
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

describe("CSV import: payout cell and format defaults", () => {
  const line = (payout: string) => `Row, 500, 50+5, 10, 1${payout === undefined ? "" : `, ${payout}`}`;
  const one = (text: string) => {
    const parsed = parseImportCSV(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    return parsed.rows[0];
  };

  it.each(["mtt-pokerstar", "pokerstars", "mtt standard", "custom", "mtt-gg-bounty-", "toString"])(
    "rejects the unknown payout %s instead of importing a standard row",
    (payout) => {
      const parsed = parseImportCSV(line(payout));
      expect(parsed.rows).toEqual([]);
      expect(parsed.errors).toEqual([`line 1: unknown payout "${payout}"`]);
    },
  );

  it("reports each bad line and still refuses the whole import", () => {
    const text = [line("mtt-pokerstars"), line("mtt-pokerstar"), line("sng-65-35"), line("wta")].join("\n");
    const parsed = parseImportCSV(text);
    expect(parsed.rows.map((r) => r.payoutStructure)).toEqual(["mtt-pokerstars", "sng-65-35"]);
    expect(parsed.errors).toEqual(['line 2: unknown payout "mtt-pokerstar"', 'line 4: unknown payout "wta"']);
    expect(prepareScheduleImport(text, [], "replace", "limit")).toEqual({
      schedule: null,
      errors: parsed.errors,
    });
  });

  it("matches the id without regard to case or padding", () => {
    expect(one("Row, 500, 50+5, 10, 1,  MTT-PokerStars ").payoutStructure).toBe("mtt-pokerstars");
    expect(one(line("MTT-GG-FREEZE")).payoutStructure).toBe("mtt-gg-freeze");
  });

  it("keeps an absent or empty payout cell on the standard curve", () => {
    expect(one("Row, 500, 50+5, 10, 1").payoutStructure).toBe("mtt-standard");
    expect(one("Row, 500, 50+5, 10, 1,").payoutStructure).toBe("mtt-standard");
  });

  it("accepts every payout the editor offers except the legacy custom one", () => {
    const offered: Record<Exclude<PayoutStructureId, "custom">, true> = {
      "mtt-standard": true, "mtt-primedope": true, "mtt-flat": true, "mtt-top-heavy": true,
      "battle-royale": true, "mtt-pokerstars": true, "mtt-gg": true, "mtt-gg-freeze": true,
      "mtt-sunday-million": true, "mtt-gg-bounty": true, "mtt-gg-mystery": true,
      "satellite-ticket": true, "sng-50-30-20": true, "sng-65-35": true, "winner-takes-all": true,
    };
    for (const id of Object.keys(offered)) {
      expect(one(line(id)).payoutStructure).toBe(id);
    }
  });

  it("gives a PKO payout the PKO format and the editor's bounty split", () => {
    const row = one(line("mtt-gg-bounty"));
    const picked = applyGameType(row, "pko");
    expect(row).toMatchObject({
      gameType: "pko",
      payoutStructure: "mtt-gg-bounty",
      bountyFraction: picked.bountyFraction,
      pkoHeadVar: picked.pkoHeadVar,
      buyIn: 50, roi: 0.1, players: 500,
    });
    expect(row.bountyFraction).toBeGreaterThan(0);
    expect(rowHasActiveBounty(row)).toBe(true);
    expect(inferGameType(row)).toBe("pko");
    expect(normalizeGameTypeConsistency(row)).toEqual(row);
    expect(checkInputSanity({ tiltFastGain: 0, tiltFastScale: 0, tiltSlowGain: 0, tiltSlowThreshold: 0, bankroll: 1000, finishModelId: "power-law" }, [row])).toEqual([]);
  });

  it("gives a Mystery payout the Mystery format, split and bounty variance", () => {
    const row = one(line("mtt-gg-mystery"));
    const picked = applyGameType(row, "mystery");
    expect(row).toMatchObject({
      gameType: "mystery",
      payoutStructure: "mtt-gg-mystery",
      bountyFraction: picked.bountyFraction,
      mysteryBountyVariance: picked.mysteryBountyVariance,
    });
    expect(row.mysteryBountyVariance).toBeGreaterThan(0);
    expect(normalizeGameTypeConsistency(row)).toEqual(row);
  });

  it("gives Battle Royale its structural bounty share without touching the typed ticket and ROI", () => {
    const row = one("Row, 500, 9.2+0.8, 5, 1, battle-royale");
    expect(row).toMatchObject({
      gameType: "mystery-royale",
      players: 18,
      bountyFraction: DEFAULT_BATTLE_ROYALE_BOUNTY_FRACTION,
      mysteryBountyVariance: 1.8,
      buyIn: 9.2,
      roi: 0.05,
    });
    expect(row.rake).toBeCloseTo(0.8 / 9.2, 12);
  });

  it("reads a plain Battle Royale buy-in as the total ticket, the way typing it in the editor does", () => {
    const row = one("br, 18, 10, 3, 1, battle-royale");
    const typed = parseBuyIn("10", 0.1, "mystery-royale");
    expect(typed).toEqual(battleRoyaleRowFromTotalTicket(10));
    expect(row.buyIn).toBeCloseTo(9.2, 12);
    expect(row.rake).toBeCloseTo(0.08 / 0.92, 12);
    expect(row.buyIn * (1 + row.rake)).toBeCloseTo(10, 12);
    expect({ buyIn: row.buyIn, rake: row.rake }).toEqual(typed);
  });

  it("keeps an explicit net+fee cell on a Battle Royale row as spelled", () => {
    const row = one("br, 18, 10+1, 3, 1, battle-royale");
    expect(row.buyIn).toBe(10);
    expect(row.rake).toBeCloseTo(0.1, 12);
  });

  it("still reads a plain buy-in on every other payout as the net buy-in at the default rake", () => {
    for (const payout of ["mtt-standard", "mtt-gg-bounty", "mtt-gg-mystery", "sng-50-30-20"]) {
      const row = one(`Row, 500, 10, 3, 1, ${payout}`);
      expect(row.buyIn).toBe(10);
      expect(row.rake).toBe(0.1);
    }
  });

  it("reads a case-padded battle-royale payout cell the same way", () => {
    const row = one("br, 18, 10, 3, 1,  Battle-Royale ");
    expect(row.buyIn).toBeCloseTo(9.2, 12);
  });

  it("leaves freezeout payouts without bounty fields", () => {
    const row = one(line("mtt-primedope"));
    expect(row.gameType).toBeUndefined();
    expect(row.bountyFraction).toBeUndefined();
  });
});

describe("advanced row panel: Mystery σ²", () => {
  const row = (over: Partial<TournamentRow>): TournamentRow => ({
    id: "r", players: 500, buyIn: 10, rake: 0.1, roi: 0.1,
    payoutStructure: "mtt-standard", count: 1, bountyFraction: 0.5, ...over,
  });
  const panel = (r: TournamentRow) =>
    renderToStaticMarkup(
      React.createElement(LocaleProvider, null,
        React.createElement(AdvancedRowPanel, { row: r, onChange: vi.fn() })),
    );

  it("is editable for a plain Mystery row", () => {
    const html = panel(row({ gameType: "mystery", mysteryBountyVariance: 2 }));
    expect(html).toContain(DICT["row.mystery"].ru);
  });

  it("is not offered for Battle Royale, where the engine ignores it", () => {
    const html = panel(row({
      gameType: "mystery-royale", payoutStructure: "battle-royale", players: 18,
      mysteryBountyVariance: 1.8,
    }));
    expect(html).not.toContain(DICT["row.mystery"].ru);
    expect(html).not.toContain(DICT["row.mysteryHint"].ru);
  });

  it.each(["freezeout", "pko", "ocean-ko"] as const)("is not offered for %s", (gameType) => {
    expect(panel(row({ gameType }))).not.toContain(DICT["row.mystery"].ru);
  });
});

describe("AFS input under a Field-size range", () => {
  const base: TournamentRow = {
    id: "ranged", label: "ranged", players: 5000, buyIn: 20, rake: 0.1, roi: 0.1,
    payoutStructure: "mtt-standard", gameType: "freezeout", count: 1,
  };
  const rowHtml = (row: TournamentRow) => {
    vi.stubGlobal("React", React);
    return renderToStaticMarkup(React.createElement(LocaleProvider, null,
      React.createElement(AdvancedModeProvider, null,
        React.createElement(ScheduleEditor, { schedule: [row], onChange: vi.fn() }),
      ),
    ));
  };
  const playersInput = (row: TournamentRow) => {
    const html = rowHtml(row);
    const tag = html.match(new RegExp(`<input[^>]*id="schedule-${row.id}-players"[^>]*>`));
    expect(tag).not.toBeNull();
    return tag![0];
  };

  it("is editable for a fixed field", () => {
    const tag = playersInput(base);
    expect(tag).not.toContain('disabled=""');
    expect(tag).toContain('value="5000"');
  });

  it("shows the range midpoint, read-only, because the sim plays the range", () => {
    const tag = playersInput({
      ...base, fieldVariability: { kind: "uniform", min: 300, max: 700, buckets: 5 },
    });
    expect(tag).toContain('value="500"');
    expect(tag).toContain('disabled=""');
    expect(tag).toContain(DICT["row.playersFromRangeBasic"].ru);
  });

  it("does not send a basic-mode user to an Advanced panel that is not there", () => {
    const tag = playersInput({
      ...base, fieldVariability: { kind: "uniform", min: 300, max: 700, buckets: 5 },
    });
    expect(tag).not.toContain(DICT["row.playersFromRange"].ru);
    expect(DICT["row.playersFromRangeBasic"].en).not.toMatch(/Advanced panel|Min \/ Max/);
    expect(DICT["row.playersFromRangeBasic"].ru).not.toMatch(/расширенных параметрах строки|Мин \/ Макс/);
  });

  it("prints the range the row plays next to the read-only AFS, in basic mode", () => {
    const html = rowHtml({
      ...base, fieldVariability: { kind: "uniform", min: 700, max: 300, buckets: 4 },
    });
    expect(html).toContain(
      DICT["row.playersRangeReadout"].ru.replace("{min}", "300").replace("{max}", "700").replace("{n}", "4"),
    );
  });

  it("prints no range readout for a fixed field", () => {
    expect(rowHtml(base)).not.toContain(DICT["row.playersRangeReadout"].ru.split("{min}")[0]);
  });
});
