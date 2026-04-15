/**
 * Extra probes against PD we haven't covered in pd_parity.ts:
 *
 *  P1  Multi-tournament schedule (num_tournaments=2, mixed types)
 *  P2  Winner-take-all paid=1 across ROI levels
 *  P3  Tiny paid counts (paid=2, paid=3)
 *  P4  Biggest field PD supports (paid=700)
 *  P5  Huge num_tournaments (N=20000)
 *  P6  Does sub_routine=payout_info depend on rake?
 *  P7  Exact ITM threshold (just below the overflow line)
 *
 * Outputs are stored under scripts/pd_cache/ (same hash scheme as
 * pd_parity) so reruns are free.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runSimulation } from "../src/lib/sim/engine";
import type { SimulationInput, TournamentRow } from "../src/lib/sim/types";
import { primedopeCurveForPaid } from "../src/lib/sim/pdCurves";

interface RowSpec {
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

function hashKey(obj: unknown): string {
  return createHash("sha1").update(JSON.stringify(obj)).digest("hex").slice(0, 16);
}

async function pdCall(params: Record<string, string | number>): Promise<any> {
  const key = hashKey(params);
  const cacheFile = join(cacheDir, `${key}.json`);
  if (existsSync(cacheFile)) {
    return JSON.parse(readFileSync(cacheFile, "utf-8"));
  }
  const kv = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const url =
    "https://www.primedope.com/prime.php?p=tournament-variance-calculator&sub_routine=calc&args=" +
    encodeURIComponent(kv).replace(/%20/g, " ");
  await new Promise((r) => setTimeout(r, 800));
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 pd-probe" } });
  if (!res.ok) throw new Error(`PD ${res.status}`);
  const json = await res.json();
  writeFileSync(cacheFile, JSON.stringify(json, null, 2));
  return json;
}

async function pdCalc(
  rows: RowSpec[],
  samples = 5000,
  bankroll = 1000,
): Promise<any> {
  const params: Record<string, string | number> = {
    num_tournaments: rows.length,
    samples,
    bankroll,
    showConfidenceIntervals: "true",
  };
  rows.forEach((r, i) => {
    params[`players${i}`] = r.players;
    params[`places_paid${i}`] = r.placesPaid;
    params[`buyin${i}`] = r.buyIn;
    params[`rake${i}`] = r.rakePct;
    params[`roi${i}`] = r.roiPct;
    params[`number${i}`] = r.number;
  });
  return pdCall(params);
}

async function pdPayoutInfo(
  players: number,
  places_paid: number,
  buyin: number,
  rake: number,
): Promise<any> {
  const kv = `players=${players} places_paid=${places_paid} buyin=${buyin} rake=${rake}`;
  const key = hashKey({ op: "payout_info", players, places_paid, buyin, rake });
  const cacheFile = join(cacheDir, `${key}.json`);
  if (existsSync(cacheFile)) {
    return JSON.parse(readFileSync(cacheFile, "utf-8"));
  }
  const url =
    "https://www.primedope.com/prime.php?p=tournament-variance-calculator&sub_routine=payout_info&args=" +
    encodeURIComponent(kv).replace(/%20/g, " ");
  await new Promise((r) => setTimeout(r, 800));
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 pd-probe" } });
  if (!res.ok) throw new Error(`PD ${res.status}`);
  const json = await res.json();
  writeFileSync(cacheFile, JSON.stringify(json, null, 2));
  return json;
}

function runOurs(rows: RowSpec[], samples = 50_000, bankroll = 1000) {
  const schedule: TournamentRow[] = rows.map((r, i) => ({
    id: `r${i}`,
    label: `r${i}`,
    players: r.players,
    buyIn: r.buyIn,
    rake: r.rakePct / 100,
    roi: r.roiPct / 100,
    payoutStructure: "custom",
    customPayouts: primedopeCurveForPaid(r.placesPaid),
    count: r.number,
  }));
  const input: SimulationInput = {
    schedule,
    scheduleRepeats: 1,
    samples,
    bankroll,
    seed: 42,
    finishModel: { id: "power-law" },
    calibrationMode: "primedope-binary-itm",
  };
  return runSimulation(input);
}

const money = (n: number) => (n >= 0 ? "$" : "-$") + Math.abs(Math.round(n)).toLocaleString("en-US");
const pct = (n: number) => (n * 100).toFixed(2) + "%";
const relErr = (a: number, b: number) => (Math.abs(b) < 1 ? a - b : (a - b) / Math.abs(b));

function diffLine(label: string, pd: any, ours: any) {
  const evE = relErr(ours.stats.mean, pd.ev);
  const sdE = relErr(ours.stats.stdDev, pd.sd);
  console.log(
    `  ${label.padEnd(20)}  EV ${money(pd.ev)} vs ${money(ours.stats.mean)} (Δ ${(evE * 100).toFixed(2)}%)   SD ${money(pd.sd)} vs ${money(ours.stats.stdDev)} (Δ ${(sdE * 100).toFixed(2)}%)`,
  );
}

async function main() {
  console.log("=".repeat(100));
  console.log("PD extra probes");
  console.log("=".repeat(100));

  // -------- P1: multi-tournament schedule --------
  console.log("\nP1. Multi-tournament schedule (num_tournaments=2)");
  const p1Rows: RowSpec[] = [
    { players: 100, placesPaid: 15, buyIn: 50, rakePct: 10, roiPct: 10, number: 500 },
    { players: 500, placesPaid: 75, buyIn: 20, rakePct: 10, roiPct: 5, number: 500 },
  ];
  try {
    const pd = await pdCalc(p1Rows);
    const ours = runOurs(p1Rows);
    diffLine("P1 mixed 100p+500p", pd, ours);
  } catch (e) {
    console.log("  ERROR:", (e as Error).message);
  }

  // P1b: three mixed types
  console.log("\nP1b. Three-row schedule (small+mid+large)");
  const p1bRows: RowSpec[] = [
    { players: 45, placesPaid: 6, buyIn: 10, rakePct: 10, roiPct: 20, number: 300 },
    { players: 180, placesPaid: 25, buyIn: 50, rakePct: 10, roiPct: 10, number: 500 },
    { players: 1000, placesPaid: 150, buyIn: 100, rakePct: 10, roiPct: 5, number: 200 },
  ];
  try {
    const pd = await pdCalc(p1bRows);
    const ours = runOurs(p1bRows);
    diffLine("P1b 3-row mixed", pd, ours);
  } catch (e) {
    console.log("  ERROR:", (e as Error).message);
  }

  // -------- P2: winner-take-all paid=1 --------
  console.log("\nP2. Winner-take-all paid=1 across ROI levels");
  for (const roi of [-10, 0, 10, 25, 50, 100]) {
    const row: RowSpec = { players: 100, placesPaid: 1, buyIn: 50, rakePct: 10, roiPct: roi, number: 500 };
    try {
      const pd = await pdCalc([row]);
      const ours = runOurs([row]);
      diffLine(`paid=1 ROI ${roi}%`, pd, ours);
    } catch (e) {
      console.log(`  paid=1 ROI ${roi}% ERROR:`, (e as Error).message);
    }
  }

  // -------- P3: tiny paid counts --------
  console.log("\nP3. Tiny paid counts (paid=2, paid=3)");
  for (const paid of [2, 3]) {
    const row: RowSpec = { players: 20, placesPaid: paid, buyIn: 50, rakePct: 10, roiPct: 10, number: 500 };
    try {
      const pd = await pdCalc([row]);
      const ours = runOurs([row]);
      diffLine(`paid=${paid}`, pd, ours);
    } catch (e) {
      console.log(`  paid=${paid} ERROR:`, (e as Error).message);
    }
  }

  // -------- P4: biggest field --------
  console.log("\nP4. Biggest paid PD supports (paid=700)");
  const p4: RowSpec = { players: 7000, placesPaid: 700, buyIn: 10, rakePct: 10, roiPct: 10, number: 500 };
  try {
    const pd = await pdCalc([p4]);
    const ours = runOurs([p4]);
    diffLine(`paid=700 7000p`, pd, ours);
  } catch (e) {
    console.log(`  paid=700 ERROR:`, (e as Error).message);
  }

  // -------- P5: huge num_tournaments --------
  console.log("\nP5. Huge number= (20000 tourneys)");
  const p5: RowSpec = { players: 100, placesPaid: 15, buyIn: 20, rakePct: 10, roiPct: 10, number: 20000 };
  try {
    const pd = await pdCalc([p5], 2000);
    const ours = runOurs([p5]);
    diffLine(`N=20000`, pd, ours);
  } catch (e) {
    console.log(`  N=20000 ERROR:`, (e as Error).message);
  }

  // -------- P6: payout_info rake dependence --------
  console.log("\nP6. Does sub_routine=payout_info change with rake?");
  try {
    const a = await pdPayoutInfo(200, 30, 50, 0);
    const b = await pdPayoutInfo(200, 30, 50, 10);
    const c = await pdPayoutInfo(200, 30, 50, 50);
    const poolA = 200 * 50;
    const poolB = 200 * 50;
    const poolC = 200 * 50;
    const fracsA = a.payoutInfo.map((r: any) => r.prize / poolA).slice(0, 5);
    const fracsB = b.payoutInfo.map((r: any) => r.prize / poolB).slice(0, 5);
    const fracsC = c.payoutInfo.map((r: any) => r.prize / poolC).slice(0, 5);
    console.log(`  rake=0  first 5 prize/pool: [${fracsA.map((x: number) => x.toFixed(4)).join(", ")}]`);
    console.log(`  rake=10 first 5 prize/pool: [${fracsB.map((x: number) => x.toFixed(4)).join(", ")}]`);
    console.log(`  rake=50 first 5 prize/pool: [${fracsC.map((x: number) => x.toFixed(4)).join(", ")}]`);
  } catch (e) {
    console.log(`  P6 ERROR:`, (e as Error).message);
  }

  // -------- P7: exact ITM threshold (just below overflow) --------
  console.log("\nP7. ITM threshold edge (just below (1+ROI)*paid/players = 1)");
  // 100p paid=15, threshold is ROI = (100/15 - 1) = 5.666... → 566.67%
  // try 550% (itm=0.975), 560% (itm=0.99), 565% (itm=0.9975)
  for (const roi of [400, 500, 550, 560, 565]) {
    const row: RowSpec = { players: 100, placesPaid: 15, buyIn: 10, rakePct: 0, roiPct: roi, number: 500 };
    try {
      const pd = await pdCalc([row], 2000);
      const ours = runOurs([row]);
      diffLine(`ROI ${roi}% itm=${((1 + roi / 100) * 15 / 100).toFixed(3)}`, pd, ours);
    } catch (e) {
      console.log(`  ROI ${roi}% ERROR:`, (e as Error).message);
    }
  }

  console.log("\n" + "=".repeat(100));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
