/**
 * Turns pasted or uploaded text into finishing places for the empirical
 * finish model, and says what it did with every token.
 *
 * Three shapes are understood:
 *  - `list`: a column of numbers or a run of numbers split by whitespace,
 *    commas or semicolons. Every token is a candidate place.
 *  - `header`: a table whose first line names the place column (place,
 *    position, finish, pos, rank, место, позиция). Only that column is read.
 *  - `first-column`: a table with several columns and no place header. The
 *    first column is read and the caller gets a warning, because the other
 *    columns (field size, buy-in) are not places. Without any header line this
 *    needs a tab, semicolon or comma between cells: space-separated rows of
 *    equal length stay a wrapped list.
 *
 * A candidate counts only if it is a whole number in 1..MAX_PLACE. Everything
 * else, and anything past MAX_ENTRIES, lands in `skipped`.
 */

/** Caps keep a pasted 100-MB file from pegging the main thread. */
export const MAX_ENTRIES = 500_000;
/** Stops a buckets[Number.MAX_SAFE_INTEGER - 1] allocation. */
export const MAX_PLACE = 100_000;

export type PlacesMethod = "list" | "header" | "first-column";

export type PlacesWarning =
  | { code: "first-column"; columns: number }
  | { code: "capped"; limit: number };

export interface ParsedPlaces {
  places: number[];
  accepted: number;
  skipped: number;
  /** Worst (largest) accepted place; 0 when nothing was accepted. */
  maxPlace: number;
  method: PlacesMethod;
  warnings: PlacesWarning[];
}

const PLACE_HEADERS: ReadonlySet<string> = new Set([
  "place",
  "places",
  "position",
  "positions",
  "finish",
  "finishplace",
  "finishposition",
  "pos",
  "rank",
  "место",
  "места",
  "позиция",
  "позиции",
]);

const NUMBER_LIKE = /^[+-]?\d+(?:[.,]\d+)?$/;
const WHOLE = /^\d+$/;
const WHITESPACE = /\s+/;

type Delimiter = string | RegExp;

function cleanCell(cell: string): string {
  return cell.trim().replace(/^"+|"+$/g, "").trim();
}

function isPlaceHeader(cell: string): boolean {
  return PLACE_HEADERS.has(cell.toLowerCase().replace(/[^\p{L}]/gu, ""));
}

function pickDelimiter(line: string): Delimiter {
  if (line.includes("\t")) return "\t";
  if (line.includes(";")) return ";";
  if (line.includes(",")) return ",";
  return WHITESPACE;
}

function splitCells(line: string, delimiter: Delimiter): string[] {
  const raw =
    delimiter === WHITESPACE ? line.trim().split(WHITESPACE) : line.split(delimiter);
  return raw.map(cleanCell);
}

interface Table {
  method: "header" | "first-column";
  column: number;
  columns: number;
  body: string[][];
}

function maxCells(rows: readonly string[][]): number {
  let max = 0;
  for (const row of rows) if (row.length > max) max = row.length;
  return max;
}

function detectTable(lines: readonly string[]): Table | null {
  if (lines.length < 2) return null;
  const delimiter = pickDelimiter(lines[0]);
  const head = splitCells(lines[0], delimiter);
  const headerLike = head.some((cell) => cell !== "" && !NUMBER_LIKE.test(cell));
  const named = headerLike ? head.findIndex(isPlaceHeader) : -1;
  // One cell and no place name is a plain column, not a table.
  if (head.length < 2 && named < 0) return null;

  const body = (headerLike ? lines.slice(1) : lines).map((line) =>
    splitCells(line, delimiter),
  );
  const columns = maxCells(body);

  if (headerLike) {
    // Spaces split a multi-word whitespace header ("Final place") into more
    // cells than the rows have, which would point at the wrong column.
    const trusted = delimiter !== WHITESPACE || head.length === body[0].length;
    if (named >= 0 && trusted) return { method: "header", column: named, columns, body };
    if (head.length >= 2 && columns >= 2) {
      return { method: "first-column", column: 0, columns, body };
    }
    return null;
  }

  // Without a header, spaces mean a wrapped list ("1 2 3" / "4 5 6"); only a
  // real cell separator (tab, semicolon, comma) makes an unnamed table.
  if (delimiter !== WHITESPACE && body.every((row) => row.length === head.length)) {
    return { method: "first-column", column: 0, columns: head.length, body };
  }
  return null;
}

export function parsePlaces(raw: string): ParsedPlaces {
  const text = raw.replace(/^﻿/, "");
  const lines = text.split(/\r\n|\r|\n/).filter((line) => line.trim() !== "");
  const table = detectTable(lines);

  const places: number[] = [];
  let skipped = 0;
  let capped = false;
  let maxPlace = 0;

  const take = (cell: string) => {
    if (!WHOLE.test(cell)) {
      skipped += 1;
      return;
    }
    const place = Number(cell);
    if (place < 1 || place > MAX_PLACE) {
      skipped += 1;
      return;
    }
    if (places.length >= MAX_ENTRIES) {
      capped = true;
      skipped += 1;
      return;
    }
    places.push(place);
    if (place > maxPlace) maxPlace = place;
  };

  const warnings: PlacesWarning[] = [];
  let method: PlacesMethod = "list";

  if (table) {
    method = table.method;
    for (const row of table.body) take(row[table.column] ?? "");
    if (table.method === "first-column") {
      warnings.push({ code: "first-column", columns: table.columns });
    }
  } else {
    for (const token of text.split(/[\s,;]+/)) {
      const cell = cleanCell(token);
      if (cell !== "") take(cell);
    }
  }
  if (capped) warnings.push({ code: "capped", limit: MAX_ENTRIES });

  return { places, accepted: places.length, skipped, maxPlace, method, warnings };
}

/** Histogram of accepted places, index 0 = 1st place; undefined when nothing was accepted. */
export function placesToBuckets(
  parsed: Pick<ParsedPlaces, "places" | "maxPlace">,
): number[] | undefined {
  if (parsed.places.length === 0) return undefined;
  const buckets = new Array<number>(parsed.maxPlace).fill(0);
  for (const place of parsed.places) buckets[place - 1] += 1;
  return buckets;
}
