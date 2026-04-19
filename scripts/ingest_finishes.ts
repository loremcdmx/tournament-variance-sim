/**
 * Ingest raw finish-place rows → canonical finish-shape JSON.
 *
 *   npx tsx scripts/ingest_finishes.ts \
 *     --input data/raw/finishes.csv \
 *     [--output data/finish-shapes/custom.json] \
 *     [--label "description"] \
 *     [--bucket-width 0.5] \
 *     [--cash-cutoff-pct 15.5] \
 *     [--itm-rate 0.187] \
 *     [--filter-roi-bucket winning] \
 *     [--filter-field-size 400-10000] \
 *     [--filter-game-type freezeout]
 *
 * Input schema (any subset of these column names, case-insensitive):
 *   required:  finish_place | place | rank | position
 *              field_size   | entries | players | N | field
 *   optional:  player_id    | player | user_id | uid
 *              tourney_id   | tournament_id | tid | event_id
 *              roi_bucket   | roi | bucket
 *              game_type    | format | type
 *              buyin        | buy_in | bi
 *              is_itm       | itm | cashed | in_the_money
 *
 * Output matches data/finish-shapes/freeze-cash.json schema — drop the
 * result into data/finish-shapes/ and wire it into a *Shape.ts consumer
 * to bake a new real-data model. See docs/INGEST.md.
 */

import fs from "node:fs";
import path from "node:path";

// ---------- arg parsing -----------------------------------------------------

interface Args {
  input: string;
  output: string;
  label: string;
  bucketWidth: number;
  cashCutoffPct: number;
  itmRate: number | null;
  filterRoiBucket: string | null;
  filterFieldSizeMin: number | null;
  filterFieldSizeMax: number | null;
  filterGameType: string | null;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    input: "",
    output: "",
    label: "",
    bucketWidth: 0.5,
    cashCutoffPct: 15.5,
    itmRate: null,
    filterRoiBucket: null,
    filterFieldSizeMin: null,
    filterFieldSizeMax: null,
    filterGameType: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--input":
      case "-i":
        out.input = next();
        break;
      case "--output":
      case "-o":
        out.output = next();
        break;
      case "--label":
        out.label = next();
        break;
      case "--bucket-width":
        out.bucketWidth = Number(next());
        break;
      case "--cash-cutoff-pct":
        out.cashCutoffPct = Number(next());
        break;
      case "--itm-rate":
        out.itmRate = Number(next());
        break;
      case "--filter-roi-bucket":
        out.filterRoiBucket = next().toLowerCase();
        break;
      case "--filter-field-size": {
        const [lo, hi] = next()
          .split("-")
          .map((s) => Number(s.trim()));
        out.filterFieldSizeMin = Number.isFinite(lo) ? lo : null;
        out.filterFieldSizeMax = Number.isFinite(hi) ? hi : null;
        break;
      }
      case "--filter-game-type":
        out.filterGameType = next().toLowerCase();
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        if (a.startsWith("--")) {
          console.error(`unknown flag: ${a}`);
          process.exit(2);
        }
    }
  }
  if (!out.input) {
    console.error("missing --input <path>");
    process.exit(2);
  }
  if (!out.output) {
    const base = path.basename(out.input, path.extname(out.input));
    out.output = path.join("data", "finish-shapes", `${base}.json`);
  }
  return out;
}

function printHelp(): void {
  console.log(`Ingest raw finish-place rows → canonical finish-shape JSON.

Usage:
  npx tsx scripts/ingest_finishes.ts --input <file.csv> [options]

Options:
  --input, -i <path>          CSV file (required). .xlsx not supported — export as CSV UTF-8 first.
  --output, -o <path>         Output JSON (default: data/finish-shapes/<input-basename>.json)
  --label <string>            Human-readable description stored in "source" field
  --bucket-width <number>     Histogram bucket width in place-percent units (default 0.5)
  --cash-cutoff-pct <number>  Cash band width in percent-of-field (default 15.5)
  --itm-rate <number>         Empirical ITM rate in [0,1]. If omitted, derived from is_itm column
                              when present, else defaults to cash-cutoff-pct/100.
  --filter-roi-bucket <s>     Keep only rows where roi_bucket == <s> (case-insensitive)
  --filter-field-size <a-b>   Keep only rows with a <= field_size <= b
  --filter-game-type <s>      Keep only rows where game_type == <s> (case-insensitive)
`);
}

// ---------- CSV parsing -----------------------------------------------------

function detectDelimiter(firstLine: string): string {
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = 0;
  for (const d of candidates) {
    // ignore delimiters inside quoted fields for detection purposes
    let inQuote = false;
    let count = 0;
    for (let i = 0; i < firstLine.length; i++) {
      const c = firstLine[i];
      if (c === '"') inQuote = !inQuote;
      else if (!inQuote && c === d) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

function parseCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') inQuote = true;
      else if (c === delim) {
        out.push(cur);
        cur = "";
      } else {
        cur += c;
      }
    }
  }
  out.push(cur);
  return out;
}

// ---------- column resolution ----------------------------------------------

const COLUMN_ALIASES: Record<string, string[]> = {
  finish_place: ["finish_place", "place", "rank", "position", "finish"],
  field_size: ["field_size", "entries", "players", "n", "field", "entrants"],
  player_id: ["player_id", "player", "user_id", "uid", "user"],
  tourney_id: ["tourney_id", "tournament_id", "tid", "event_id", "tournament"],
  roi_bucket: ["roi_bucket", "roi", "bucket"],
  game_type: ["game_type", "format", "type", "structure"],
  buyin: ["buyin", "buy_in", "bi", "buy-in"],
  is_itm: ["is_itm", "itm", "cashed", "in_the_money", "itm_flag"],
};

type CanonKey = keyof typeof COLUMN_ALIASES;

function resolveColumns(header: string[]): Partial<Record<CanonKey, number>> {
  const norm = header.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const out: Partial<Record<CanonKey, number>> = {};
  for (const canon of Object.keys(COLUMN_ALIASES) as CanonKey[]) {
    for (const alias of COLUMN_ALIASES[canon]) {
      const idx = norm.indexOf(alias);
      if (idx !== -1) {
        out[canon] = idx;
        break;
      }
    }
  }
  return out;
}

// ---------- aggregation -----------------------------------------------------

interface Counters {
  totalRows: number;
  acceptedRows: number;
  itmRows: number;
  hasIsItmColumn: boolean;
  /** bucketIdx → count, keyed by cash-conditional bucket centre */
  cashCounts: Map<number, number>;
  /** bucketIdx → count, keyed by full-field bucket centre */
  rawCounts: Map<number, number>;
}

function bucketCentre(xPct: number, width: number): number {
  // Right-closed bucket. x=84.5 with width 0.5 sits in bucket centred at 84.5.
  // We emit the right edge (matches freeze-cash.json convention where
  // bucket label "84.5" covers (84, 84.5]).
  if (xPct >= 100) return 100;
  return Math.min(100, Math.ceil(xPct / width) * width);
}

function roundTo(n: number, step: number): number {
  return Math.round(n / step) * step;
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const ext = path.extname(args.input).toLowerCase();
  if (ext === ".xlsx" || ext === ".xls") {
    console.error(
      `Excel files (.xlsx/.xls) are not supported directly.\n` +
        `Please export as CSV UTF-8 first:\n` +
        `  Excel: File → Save As → CSV UTF-8 (.csv)\n` +
        `  LibreOffice: File → Save As → Text CSV, encoding UTF-8\n` +
        `  Google Sheets: File → Download → Comma-separated values (.csv)\n`,
    );
    process.exit(2);
  }
  if (!fs.existsSync(args.input)) {
    console.error(`input not found: ${args.input}`);
    process.exit(2);
  }

  const raw = fs.readFileSync(args.input, "utf8");
  // Strip BOM and normalise line endings.
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  // Drop trailing empty lines.
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  if (lines.length < 2) {
    console.error("input has no data rows");
    process.exit(2);
  }

  const delim = detectDelimiter(lines[0]);
  const header = parseCsvLine(lines[0], delim);
  const cols = resolveColumns(header);
  if (cols.finish_place === undefined) {
    console.error(
      `missing required column: finish_place (or alias: ${COLUMN_ALIASES.finish_place.join(", ")})`,
    );
    console.error(`found headers: ${header.join(", ")}`);
    process.exit(2);
  }
  if (cols.field_size === undefined) {
    console.error(
      `missing required column: field_size (or alias: ${COLUMN_ALIASES.field_size.join(", ")})`,
    );
    console.error(`found headers: ${header.join(", ")}`);
    process.exit(2);
  }

  const counters: Counters = {
    totalRows: 0,
    acceptedRows: 0,
    itmRows: 0,
    hasIsItmColumn: cols.is_itm !== undefined,
    cashCounts: new Map(),
    rawCounts: new Map(),
  };

  const cashCutoffX = 100 - args.cashCutoffPct; // e.g. 84.5 for 15.5%
  const cashCutoffXRounded = roundTo(cashCutoffX, args.bucketWidth);

  for (let lineIdx = 1; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    if (line.trim() === "") continue;
    const fields = parseCsvLine(line, delim);
    counters.totalRows++;

    const place = Number(fields[cols.finish_place!]);
    const field = Number(fields[cols.field_size!]);
    if (!Number.isFinite(place) || !Number.isFinite(field)) continue;
    if (place < 1 || field < 1 || place > field) continue;

    if (args.filterFieldSizeMin !== null && field < args.filterFieldSizeMin) continue;
    if (args.filterFieldSizeMax !== null && field > args.filterFieldSizeMax) continue;

    if (args.filterRoiBucket !== null && cols.roi_bucket !== undefined) {
      const val = (fields[cols.roi_bucket] ?? "").trim().toLowerCase();
      if (val !== args.filterRoiBucket) continue;
    }
    if (args.filterGameType !== null && cols.game_type !== undefined) {
      const val = (fields[cols.game_type] ?? "").trim().toLowerCase();
      if (val !== args.filterGameType) continue;
    }

    counters.acceptedRows++;

    const xPct = ((field - place + 1) / field) * 100;
    const bx = bucketCentre(xPct, args.bucketWidth);

    // Raw: every finish lands in some bucket.
    counters.rawCounts.set(bx, (counters.rawCounts.get(bx) ?? 0) + 1);

    // Cash-conditional: only buckets at or above the cash cutoff.
    const inItm =
      cols.is_itm !== undefined
        ? parseItmFlag(fields[cols.is_itm])
        : xPct >= cashCutoffX;
    if (inItm) {
      counters.itmRows++;
      if (bx >= cashCutoffXRounded) {
        counters.cashCounts.set(bx, (counters.cashCounts.get(bx) ?? 0) + 1);
      }
    }
  }

  if (counters.acceptedRows === 0) {
    console.error("no rows survived filters — check column names and filters");
    process.exit(2);
  }

  // Empirical ITM rate: prefer explicit flag count, else explicit arg,
  // else derive from cash-cutoff.
  const itmRateEmpirical =
    args.itmRate !== null
      ? args.itmRate
      : counters.hasIsItmColumn
        ? counters.itmRows / counters.acceptedRows
        : args.cashCutoffPct / 100;

  // Emit buckets in ascending-x order across the full cash band.
  const cashBuckets: { x: number; density: number }[] = [];
  const cashTotal = Array.from(counters.cashCounts.values()).reduce(
    (a, b) => a + b,
    0,
  );
  if (cashTotal > 0) {
    for (
      let x = cashCutoffXRounded;
      x <= 100 + 1e-9;
      x = roundTo(x + args.bucketWidth, args.bucketWidth)
    ) {
      const n = counters.cashCounts.get(x) ?? 0;
      cashBuckets.push({ x, density: n / cashTotal });
    }
  }

  const rawBuckets: { x: number; density: number }[] = [];
  const rawTotal = Array.from(counters.rawCounts.values()).reduce(
    (a, b) => a + b,
    0,
  );
  if (rawTotal > 0) {
    for (
      let x = cashCutoffXRounded;
      x <= 100 + 1e-9;
      x = roundTo(x + args.bucketWidth, args.bucketWidth)
    ) {
      const n = counters.rawCounts.get(x) ?? 0;
      rawBuckets.push({ x, density: n / rawTotal });
    }
  }

  const filtersDescr: string[] = [];
  if (args.filterRoiBucket) filtersDescr.push(`roi_bucket=${args.filterRoiBucket}`);
  if (args.filterGameType) filtersDescr.push(`game_type=${args.filterGameType}`);
  if (args.filterFieldSizeMin !== null || args.filterFieldSizeMax !== null) {
    const lo = args.filterFieldSizeMin ?? "";
    const hi = args.filterFieldSizeMax ?? "";
    filtersDescr.push(`field_size=${lo}-${hi}`);
  }

  const out = {
    source:
      args.label ||
      `ingested from ${path.basename(args.input)} on ${new Date().toISOString().slice(0, 10)}`,
    filters: filtersDescr.length ? filtersDescr.join(", ") : "none",
    sample_size: counters.acceptedRows,
    itm_rate_empirical: Number(itmRateEmpirical.toFixed(6)),
    cash_cutoff_x: cashCutoffXRounded,
    cash_band_width_pct: args.cashCutoffPct,
    x_convention:
      "place_pct = (N - place + 1) / N * 100; 100 = winner, 0.5 = first bust",
    bucket_width_pct: args.bucketWidth,
    buckets_cash_conditional: cashBuckets,
    buckets_raw_over_all_finishes: rawBuckets,
  };

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, JSON.stringify(out, null, 2) + "\n", "utf8");

  console.log(`wrote ${args.output}`);
  console.log(
    `  total rows seen:   ${counters.totalRows}\n` +
      `  accepted:          ${counters.acceptedRows}\n` +
      `  itm rows:          ${counters.itmRows}${counters.hasIsItmColumn ? "" : " (derived from cash-cutoff)"}\n` +
      `  itm_rate:          ${(itmRateEmpirical * 100).toFixed(2)}%\n` +
      `  cash buckets:      ${cashBuckets.length}\n` +
      `  raw buckets:       ${rawBuckets.length}`,
  );
}

function parseItmFlag(v: string): boolean {
  const s = (v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y" || s === "t";
}

run();
