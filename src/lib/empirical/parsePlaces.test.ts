import { describe, expect, it } from "vitest";
import { MAX_ENTRIES, MAX_PLACE, parsePlaces, placesToBuckets } from "./parsePlaces";

describe("parsePlaces: plain lists", () => {
  it("reads one place per line", () => {
    expect(parsePlaces("3\n1\n7\n3\n")).toEqual({
      places: [3, 1, 7, 3],
      accepted: 4,
      skipped: 0,
      maxPlace: 7,
      method: "list",
      warnings: [],
    });
  });

  it.each(["3 1 7 3", "3,1,7,3", "3, 1, 7, 3", "3;1;7;3", "3\t1\t7\t3", "  3 ,, 1 ;7\r\n3  "])(
    "reads a separated list: %j",
    (text) => {
      const parsed = parsePlaces(text);
      expect(parsed.places).toEqual([3, 1, 7, 3]);
      expect(parsed.method).toBe("list");
      expect(parsed.warnings).toEqual([]);
    },
  );

  it("keeps the previous tokenisation for list-shaped input", () => {
    const legacy = (raw: string) => {
      const out: number[] = [];
      for (const tok of raw.split(/[\s,;]+/)) {
        if (!/^\d+$/.test(tok)) continue;
        const n = Number(tok);
        if (n < 1 || n > 100_000) continue;
        out.push(n);
      }
      return out;
    };
    for (const text of ["12\n5\n3\n3\n1", "1 2 3\n4 5", "9,8;7 6\n\n5", "1\n2\n3 4", "x 4 y 5", ""]) {
      expect(parsePlaces(text).places, text).toEqual(legacy(text));
    }
  });

  it("counts non-numeric, zero, negative, fractional and oversized tokens as skipped", () => {
    const parsed = parsePlaces(`0 -2 2.5 abc ${MAX_PLACE + 1} ${MAX_PLACE} 1`);
    expect(parsed.places).toEqual([MAX_PLACE, 1]);
    expect(parsed.accepted).toBe(2);
    expect(parsed.skipped).toBe(5);
    expect(parsed.maxPlace).toBe(MAX_PLACE);
  });

  it("reports nothing accepted for empty and blank text", () => {
    for (const text of ["", "  \n\t\n"]) {
      expect(parsePlaces(text)).toEqual({
        places: [],
        accepted: 0,
        skipped: 0,
        maxPlace: 0,
        method: "list",
        warnings: [],
      });
    }
  });

  it("reads a single line that starts with words as a list", () => {
    const parsed = parsePlaces("place 3 5");
    expect(parsed.places).toEqual([3, 5]);
    expect(parsed.skipped).toBe(1);
    expect(parsed.method).toBe("list");
  });

  it("treats an unnamed one-column heading as a skipped token, not a table", () => {
    const parsed = parsePlaces("result\n3\n1");
    expect(parsed).toMatchObject({ places: [3, 1], skipped: 1, method: "list", warnings: [] });
  });

  it("keeps a list wrapped onto lines of different length as a list", () => {
    expect(parsePlaces("1 2 3\n4 5")).toMatchObject({ places: [1, 2, 3, 4, 5], method: "list" });
  });
});

describe("parsePlaces: tables with a header", () => {
  it("reads only the place column of a place/field/buy-in CSV", () => {
    const parsed = parsePlaces("place,field,buyin\n3,120,1200\n1,120,1200\n7,120,1200");
    expect(parsed).toEqual({
      places: [3, 1, 7],
      accepted: 3,
      skipped: 0,
      maxPlace: 7,
      method: "header",
      warnings: [],
    });
  });

  it.each(["place", "Place", " PLACE ", "position", "Position", "finish", "Finish", "pos", "Pos", "rank", "RANK", "место", "Место", "позиция", "ПОЗИЦИЯ", "Pos ition", "Place #"])(
    "recognises the header %j in any column",
    (name) => {
      const parsed = parsePlaces(`field,${name},buyin\n120,3,1200\n120,1,1200`);
      expect(parsed.places).toEqual([3, 1]);
      expect(parsed.method).toBe("header");
      expect(parsed.warnings).toEqual([]);
    },
  );

  it("reads a semicolon table with a Russian header", () => {
    const parsed = parsePlaces("Поле;Бай-ин;Место\n120;1200;3\n120;1200;12");
    expect(parsed).toMatchObject({ places: [3, 12], maxPlace: 12, method: "header" });
  });

  it("reads a tab table and keeps an empty leading cell as a column", () => {
    const parsed = parsePlaces("\tplace\tfield\n\t3\t120\n\t5\t120");
    expect(parsed).toMatchObject({ places: [3, 5], method: "header" });
  });

  it("reads a whitespace table", () => {
    const parsed = parsePlaces("Field Place Buyin\n120 3 1200\n120 1 1200");
    expect(parsed).toMatchObject({ places: [3, 1], method: "header" });
  });

  it("does not trust a multi-word whitespace header that shifts the columns", () => {
    const parsed = parsePlaces("Final place Field\n3 120\n1 120");
    expect(parsed.places).toEqual([3, 1]);
    expect(parsed.method).toBe("first-column");
    expect(parsed.warnings).toEqual([{ code: "first-column", columns: 2 }]);
  });

  it("reads a one-column table whose header names the place", () => {
    expect(parsePlaces("place\n3\n1")).toMatchObject({
      places: [3, 1],
      skipped: 0,
      method: "header",
      warnings: [],
    });
  });

  it("counts bad cells in the place column as skipped but not the header row", () => {
    const parsed = parsePlaces(
      ["place,field", "3,120", "0,120", "2.5,120", ",120", "Total,120", "abc,120", "1"].join("\n"),
    );
    expect(parsed.places).toEqual([3, 1]);
    expect(parsed.accepted).toBe(2);
    expect(parsed.skipped).toBe(5);
  });

  it("counts a row too short to reach the place column as skipped", () => {
    const parsed = parsePlaces("field,buyin,place\n120,1200,3\n120");
    expect(parsed).toMatchObject({ places: [3], skipped: 1 });
  });

  it("handles a BOM, quotes and CRLF from an Excel export", () => {
    const parsed = parsePlaces('﻿"Place","Field"\r\n"3","120"\r\n"1","120"\r\n');
    expect(parsed).toMatchObject({ places: [3, 1], skipped: 0, method: "header" });
  });
});

describe("parsePlaces: tables without a place header", () => {
  it("takes the first column of a headerless numeric table and warns", () => {
    const parsed = parsePlaces("3,120,1200\n1,120,1200\n7,120,1200");
    expect(parsed).toEqual({
      places: [3, 1, 7],
      accepted: 3,
      skipped: 0,
      maxPlace: 7,
      method: "first-column",
      warnings: [{ code: "first-column", columns: 3 }],
    });
  });

  it("takes the first column when the header names no place column and warns", () => {
    const parsed = parsePlaces("result;field;buyin\n3;120;1200\n1;120;1200");
    expect(parsed.places).toEqual([3, 1]);
    expect(parsed.method).toBe("first-column");
    expect(parsed.warnings).toEqual([{ code: "first-column", columns: 3 }]);
  });

  it("does not warn when the data has a single column under an odd header", () => {
    const parsed = parsePlaces("my result\n3\n1");
    expect(parsed.places).toEqual([3, 1]);
    expect(parsed.method).toBe("list");
    expect(parsed.warnings).toEqual([]);
  });

  it("never turns the other columns into places", () => {
    const parsed = parsePlaces("3,120,1200\n1,120,1200\n7,120,1200");
    expect(parsed.places).not.toContain(1200);
    expect(parsed.places).not.toContain(120);
  });
});

describe("parsePlaces: limits", () => {
  it("accepts at most MAX_ENTRIES places and reports the rest as skipped with a warning", () => {
    const parsed = parsePlaces("1\n".repeat(MAX_ENTRIES + 5));
    expect(parsed.accepted).toBe(MAX_ENTRIES);
    expect(parsed.skipped).toBe(5);
    expect(parsed.warnings).toEqual([{ code: "capped", limit: MAX_ENTRIES }]);
  });

  it("does not warn when the input ends exactly at the cap", () => {
    const parsed = parsePlaces("2\n".repeat(MAX_ENTRIES));
    expect(parsed.accepted).toBe(MAX_ENTRIES);
    expect(parsed.skipped).toBe(0);
    expect(parsed.warnings).toEqual([]);
  });
});

describe("placesToBuckets", () => {
  it("builds a histogram sized to the worst place", () => {
    const buckets = placesToBuckets(parsePlaces("3 1 7 3"));
    expect(buckets).toEqual([1, 0, 2, 0, 0, 0, 1]);
  });

  it("keeps field size and buy-in out of the histogram for the place/field/buy-in CSV", () => {
    const buckets = placesToBuckets(parsePlaces("place,field,buyin\n3,120,1200\n1,120,1200\n7,120,1200"));
    expect(buckets).toHaveLength(7);
    expect(buckets?.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("returns undefined when nothing was accepted", () => {
    expect(placesToBuckets(parsePlaces("abc 0 -1"))).toBeUndefined();
  });
});
