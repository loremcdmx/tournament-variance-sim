/**
 * Field-size scan: compare our HONEST engine (alpha calibration) against
 * both PD live and our own PD-mimic mode, across field sizes. This is
 * the probe behind dossier §2 — the claim that PD's uniform-band model
 * systematically underestimates SD on large fields because top finishes
 * concentrate skill edge.
 *
 * Replicates B1 (1000p / +5% ROI / $10k buy-ins) and adds 100/200/500/2000
 * anchors to show how the gap grows with paid count.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runSimulation } from "../src/lib/sim/engine";
import type {
  CalibrationMode,
  SimulationInput,
  TournamentRow,
} from "../src/lib/sim/types";
import { primedopeCurveForPaid } from "../src/lib/sim/pdCurves";

interface Scenario {
  name: string;
  players: number;
  placesPaid: number;
  buyIn: number;
  rakePct: number;
  roiPct: number;
  number: number;
}

const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(here, "pd_cache");
if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });

function hashKey(o: unknown): string {
  return createHash("sha1").update(JSON.stringify(o)).digest("hex").slice(0, 16);
}

async function pdCalc(sc: Scenario, samples = 5000): Promise<any> {
  const params = {
    num_tournaments: 1,
    samples,
    bankroll: 1000,
    showConfidenceIntervals: "true",
    players0: sc.players,
    places_paid0: sc.placesPaid,
    buyin0: sc.buyIn,
    rake0: sc.rakePct,
    roi0: sc.roiPct,
    number0: sc.number,
  };
  const key = hashKey(params);
  const cacheFile = join(cacheDir, `${key}.json`);
  if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, "utf-8"));
  const kv = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const url =
    "https://www.primedope.com/prime.php?p=tournament-variance-calculator&sub_routine=calc&args=" +
    encodeURIComponent(kv).replace(/%20/g, " ");
  await new Promise((r) => setTimeout(r, 800));
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 pd-field-scan" } });
  if (!res.ok) throw new Error(`PD ${res.status}`);
  const json = await res.json();
  writeFileSync(cacheFile, JSON.stringify(json, null, 2));
  return json;
}

function runOurs(sc: Scenario, mode: CalibrationMode) {
  const row: TournamentRow = {
    id: "r",
    label: sc.name,
    players: sc.players,
    buyIn: sc.buyIn,
    rake: sc.rakePct / 100,
    roi: sc.roiPct / 100,
    payoutStructure: "custom",
    customPayouts: primedopeCurveForPaid(sc.placesPaid),
    count: sc.number,
  };
  const input: SimulationInput = {
    schedule: [row],
    scheduleRepeats: 1,
    samples: 50_000,
    bankroll: 1000,
    seed: 42,
    finishModel: { id: "power-law" },
    calibrationMode: mode,
  };
  return runSimulation(input);
}

// Field-size scan — keep total buy-ins and ROI fixed so only field shape matters.
// $10k total buy-ins, ROI +5%, rake 10%, paid ≈ 15% of field.
const scenarios: Scenario[] = [
  { name: "100p   paid=15 ", players: 100,  placesPaid: 15,  buyIn: 10, rakePct: 10, roiPct: 5, number: 1000 },
  { name: "200p   paid=30 ", players: 200,  placesPaid: 30,  buyIn: 10, rakePct: 10, roiPct: 5, number: 1000 },
  { name: "500p   paid=75 ", players: 500,  placesPaid: 75,  buyIn: 10, rakePct: 10, roiPct: 5, number: 1000 },
  { name: "1000p  paid=150", players: 1000, placesPaid: 150, buyIn: 10, rakePct: 10, roiPct: 5, number: 1000 },
  { name: "2000p  paid=300", players: 2000, placesPaid: 300, buyIn: 10, rakePct: 10, roiPct: 5, number: 1000 },
];

const money = (n: number) => (n >= 0 ? "$" : "-$") + Math.abs(Math.round(n)).toLocaleString("en-US");

async function main() {
  console.log("=".repeat(100));
  console.log("Field-size scan: PD (binary-ITM) vs our honest engine (alpha+power-law)");
  console.log("Fixed: $10k buy-ins, +5% ROI, 10% rake, paid = 15% of field.");
  console.log("=".repeat(100));
  console.log();
  console.log(
    `${"scenario".padEnd(22)}  ${"PD SD".padStart(10)}  ${"mimic SD".padStart(10)}  ${"honest SD".padStart(11)}  ${"honest/PD".padStart(11)}  ${"itmRate".padStart(10)}`,
  );
  console.log("-".repeat(100));

  const rows: Array<Record<string, number>> = [];
  for (const sc of scenarios) {
    process.stdout.write(`  ${sc.name} … `);
    const pd = await pdCalc(sc);
    const mimic = runOurs(sc, "primedope-binary-itm");
    const honest = runOurs(sc, "alpha");
    const ratio = honest.stats.stdDev / pd.sd;
    const itm = honest.stats.itmRate;
    console.log("ok");
    rows.push({
      players: sc.players,
      pdSd: pd.sd,
      mimicSd: mimic.stats.stdDev,
      honestSd: honest.stats.stdDev,
      ratio,
      itm,
    });
    console.log(
      `${sc.name.padEnd(22)}  ${money(pd.sd).padStart(10)}  ${money(mimic.stats.stdDev).padStart(10)}  ${money(honest.stats.stdDev).padStart(11)}  ${(ratio.toFixed(2) + "x").padStart(11)}  ${(itm * 100).toFixed(2).padStart(8)}%`,
    );
  }

  console.log("-".repeat(100));
  console.log();
  console.log("Interpretation:");
  console.log("  • mimic SD should track PD SD to <1% (parity check).");
  console.log("  • honest/PD > 1 means our engine sees more variance than PD");
  console.log("    — that's dossier §2: uniform-band flattens top-finish edge.");
  console.log("  • Expected from B1: ~1.5–1.7x at 1000p/+5% ROI.");
  console.log();

  // Also print B1 verbatim for reference
  console.log("B1 anchor (dossier): 1000p, +5% ROI, $10k buy-ins");
  console.log("  PD SD_math ≈ $2783, our range $4200–4800 (+50–70%)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
