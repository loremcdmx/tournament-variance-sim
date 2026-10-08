/**
 * Sampling error of the Space anchor behind the "Space -> Ocean" block.
 *
 * Reads the monthly moment table (one row per month x field bin x cap) the
 * anchor was built from, checks that the training months add up to the
 * published moments, runs a delete-one-month jackknife on sigma and ROI of the
 * 1000-1499 bin at the two published caps, and writes the result into
 * src/lib/calibration/space-runtime-profile.json (`training` and
 * `anchors[*].uncertainty`).
 *
 * The CSV and the QA json are research exports that stay outside the repo, so
 * the script is the audit trail for the numbers in the profile:
 *
 *   npx tsx scripts/anchor_uncertainty.ts --csv <calibration-monthly.csv> --qa <calibration-qa.json> [--check]
 *
 * --check recomputes everything and fails if the stored profile differs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { monthJackknife, pooledMoments, type MonthlyMomentSums } from "../src/lib/calibration/anchorUncertainty";
import type { SpaceJointMoments } from "../src/lib/calibration/types";

const PROFILE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../src/lib/calibration/space-runtime-profile.json");
const FIELD_BIN = "1000-1499";
const CAPS = [25, 100] as const;
const REPRODUCTION_TOLERANCE = 1e-12;
const SUM_COLUMNS = ["n", "sk", "sk2", "sx", "sx2", "sxk", "sc", "sc2", "sck", "sb", "sb2", "sbk", "scb"] as const;

interface CsvRow extends MonthlyMomentSums { fieldBin: string; cap: number; fieldK: number }

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readCsv(path: string): CsvRow[] {
  const [header, ...lines] = readFileSync(path, "utf8").trim().split(/\r?\n/);
  const columns = header.split(",");
  const required = ["month", "field_bin", "cap", "field_k", ...SUM_COLUMNS];
  for (const name of required) if (!columns.includes(name)) throw new Error(`CSV has no column ${name}`);
  return lines.map(line => {
    const cells = line.split(",");
    const get = (name: string) => cells[columns.indexOf(name)];
    const row = { month: get("month"), fieldBin: get("field_bin"), cap: Number(get("cap")), fieldK: Number(get("field_k")) } as CsvRow;
    for (const name of SUM_COLUMNS) row[name] = Number(get(name));
    return row;
  });
}

function relativeDifference(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(1, Math.abs(a), Math.abs(b));
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const csvPath = argument("csv"), qaPath = argument("qa");
if (!csvPath || !qaPath) fail("usage: npx tsx scripts/anchor_uncertainty.ts --csv <calibration-monthly.csv> --qa <calibration-qa.json> [--check]");
const check = process.argv.includes("--check");

const profile = JSON.parse(readFileSync(PROFILE_PATH, "utf8"));
const qa = JSON.parse(readFileSync(qaPath, "utf8")).rows.find((row: { period: string }) => row.period === "train");
if (!qa) fail("QA json has no train row");
const through: string = qa.last_date, from: string = qa.first_date;
const trainingRows = readCsv(csvPath).filter(row => row.month <= through.slice(0, 7));

const allFieldsEvents = trainingRows.filter(row => row.cap === 100).reduce((total, row) => total + row.n, 0);
const allFieldsEntries = trainingRows.filter(row => row.cap === 100).reduce((total, row) => total + row.sk, 0);
if (allFieldsEvents !== qa.events || allFieldsEntries !== qa.entries) fail(`CSV training sums (${allFieldsEvents} events, ${allFieldsEntries} entries) differ from the QA export (${qa.events}, ${qa.entries})`);

const binRows = (cap: number) => trainingRows.filter(row => row.fieldBin === FIELD_BIN && row.cap === cap).sort((a, b) => a.month.localeCompare(b.month));
const months = binRows(100).map(row => row.month);
if (months[0] !== from.slice(0, 7) || months[months.length - 1] !== through.slice(0, 7)) fail("training months do not span the QA window");
months.forEach((month, index) => {
  const [year, number] = month.split("-").map(Number);
  const [startYear, startNumber] = months[0].split("-").map(Number);
  if (year * 12 + number !== startYear * 12 + startNumber + index) fail(`training months are not consecutive at ${month}`);
});
const binEvents = binRows(100).reduce((total, row) => total + row.n, 0);
const binEntries = binRows(100).reduce((total, row) => total + row.sk, 0);
if (binEvents !== profile.trainingEvents || binEntries !== profile.trainingEntries) fail(`bin ${FIELD_BIN} sums (${binEvents}, ${binEntries}) differ from the profile`);

const { training: _previousTraining, anchors, ...head } = profile;
const next = { ...head, training: {} as Record<string, unknown>, anchors: JSON.parse(JSON.stringify(anchors)) };
for (const cap of CAPS) {
  const rows = binRows(cap);
  const anchor = next.anchors.find((item: { capBountyBI: number }) => item.capBountyBI === cap);
  const pooled = pooledMoments(rows);
  let worst = 0;
  for (const key of Object.keys(pooled) as (keyof SpaceJointMoments)[]) worst = Math.max(worst, relativeDifference(pooled[key], anchor.moments[key]));
  if (worst > REPRODUCTION_TOLERANCE) fail(`cap ${cap}: monthly sums do not reproduce the profile moments (worst relative difference ${worst})`);
  const jackknife = monthJackknife(rows);
  anchor.uncertainty = { method: "delete-one-month-jackknife", months: jackknife.months, sigmaSE: jackknife.sigmaSE, roiSE: jackknife.roiSE };
  console.log(`cap ${cap}: ${jackknife.months} months, moments reproduced to ${worst.toExponential(2)}, sigma ${jackknife.sigma.toFixed(4)} +- ${jackknife.sigmaSE.toFixed(4)}, ROI ${(jackknife.roi * 100).toFixed(3)}% +- ${(jackknife.roiSE * 100).toFixed(3)} pp`);
}

const fieldEntries = binRows(100).reduce((total, row) => total + row.fieldK, 0);
next.training = {
  from, through, months: months.length,
  playersAllFields: qa.players, allFieldsRange: "500-1999",
  meanFieldEntries: Math.round(fieldEntries / binEntries * 10) / 10,
};
console.log(`window ${from}..${through}, ${qa.players} players across fields 500-1999, mean field per entry ${next.training.meanFieldEntries}`);

const serialized = `${JSON.stringify(next, null, 2)}\n`;
if (check) {
  if (serialized !== readFileSync(PROFILE_PATH, "utf8")) fail("space-runtime-profile.json differs from the recomputed profile");
  console.log("profile matches the recomputation");
} else {
  writeFileSync(PROFILE_PATH, serialized);
  console.log(`wrote ${PROFILE_PATH}`);
}
