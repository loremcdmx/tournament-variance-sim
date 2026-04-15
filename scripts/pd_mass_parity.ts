/**
 * Large-scale PD parity sweep. Generates ~100 diverse scenarios spanning
 * field size × paid count × buy-in × rake × ROI × schedule length, hits
 * the live PD API for each (cached under `scripts/pd_cache/`), runs our
 * engine in full-PD-compat mode (all three `usePrimedope*` flags true),
 * and reports worst-case EV / SD deltas plus a per-scenario dump.
 *
 * Target: EV err < 3 % (MC noise), SD err < 1 % (closed-form on PD side).
 * Anything beyond that is a real discrepancy to investigate.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runSimulation } from "../src/lib/sim/engine";
import { primedopeCurveForPaid } from "../src/lib/sim/pdCurves";
import type { SimulationInput, TournamentRow } from "../src/lib/sim/types";

interface Scenario {
  name: string;
  players: number;
  placesPaid: number;
  buyIn: number;
  rakePct: number;
  roiPct: number;
  number: number;
  bankroll: number;
  samples: number;
}

interface PdResponse {
  samplesize: number;
  ev: number;
  evSimulated: number;
  sd: number;
  sdSimulated: number;
}

const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(here, "pd_cache");
if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });

function cacheKey(sc: Scenario): string {
  const k = JSON.stringify([
    sc.players,
    sc.placesPaid,
    sc.buyIn,
    sc.rakePct,
    sc.roiPct,
    sc.number,
    sc.bankroll,
    sc.samples,
  ]);
  return createHash("sha1").update(k).digest("hex").slice(0, 16);
}

async function fetchPD(sc: Scenario): Promise<PdResponse> {
  const cacheFile = join(cacheDir, `${cacheKey(sc)}.json`);
  if (existsSync(cacheFile)) {
    return JSON.parse(readFileSync(cacheFile, "utf-8")) as PdResponse;
  }
  const kv = [
    `num_tournaments=1`,
    `samples=${sc.samples}`,
    `bankroll=${sc.bankroll}`,
    `showConfidenceIntervals=true`,
    `players0=${sc.players}`,
    `places_paid0=${sc.placesPaid}`,
    `buyin0=${sc.buyIn}`,
    `rake0=${sc.rakePct}`,
    `roi0=${sc.roiPct}`,
    `number0=${sc.number}`,
  ].join(" ");
  const url =
    "https://www.primedope.com/prime.php?p=tournament-variance-calculator&sub_routine=calc&args=" +
    encodeURIComponent(kv).replace(/%20/g, " ");
  await new Promise((r) => setTimeout(r, 900));
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 pd-mass-parity" },
  });
  if (!res.ok) throw new Error(`PD fetch ${sc.name}: HTTP ${res.status}`);
  const json = (await res.json()) as PdResponse;
  writeFileSync(cacheFile, JSON.stringify(json, null, 2));
  return json;
}

function runOurs(sc: Scenario) {
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
    samples: 200_000,
    bankroll: sc.bankroll,
    seed: 42,
    finishModel: { id: "power-law" },
    calibrationMode: "primedope-binary-itm",
    usePrimedopePayouts: true,
    usePrimedopeFinishModel: true,
    usePrimedopeRakeMath: true,
  };
  const r = runSimulation(input);
  return { mean: r.stats.mean, sd: r.stats.stdDev };
}

// PD dropdown values for `places_paid` (from pd_payout_cache/).
const PD_PAID_OPTIONS = [
  1, 2, 3, 4, 5, 6, 8, 9, 10, 15, 20, 25, 30, 35, 40, 50, 60, 75, 100, 125, 150,
  175, 200, 225, 250, 275, 300, 350, 400, 450, 500, 550, 600, 700,
];

// (players, paid) anchor pairs — representative field-size / paid-fraction
// combinations that span the PD dropdown. Picked to exercise every native
// curve at least once without blowing past the PD crash frontier.
const FIELD_PAID_PAIRS: Array<[number, number]> = [
  [30, 3], [30, 5], [45, 6], [45, 9],
  [90, 10], [90, 15], [100, 10], [100, 15], [100, 20], [100, 25],
  [150, 20], [150, 25], [200, 25], [200, 30], [200, 40], [200, 50],
  [300, 40], [300, 50], [300, 60],
  [500, 50], [500, 75], [500, 100],
  [750, 100], [750, 125], [1000, 100], [1000, 150], [1000, 200],
  [1500, 150], [1500, 225], [2000, 200], [2000, 300],
  [2500, 250], [2500, 375], [3000, 450],
  [4000, 500], [5000, 500], [5000, 700],
];

function safeScenario(
  players: number,
  paid: number,
  buyIn: number,
  rakePct: number,
  roiPct: number,
  number: number,
  bankroll: number,
): Scenario | null {
  // PD crash frontier: itm = (1+ROI/100) * paid / players ≥ 1 → server dies.
  const itm = ((1 + roiPct / 100) * paid) / players;
  if (itm >= 0.95) return null;
  if (buyIn < 0.1 || buyIn > 1e6) return null;
  if (rakePct < 0 || rakePct >= 99) return null;
  if (paid < 1 || paid >= players) return null;
  if (!PD_PAID_OPTIONS.includes(paid)) return null;
  const name = `${players}p/${paid} $${buyIn}+${rakePct}% ROI${
    roiPct >= 0 ? "+" : ""
  }${roiPct}% N=${number}`;
  return {
    name,
    players,
    placesPaid: paid,
    buyIn,
    rakePct,
    roiPct,
    number,
    bankroll,
    samples: 5000,
  };
}

function buildGrid(): Scenario[] {
  // Deterministic sampling: for each (players, paid) anchor, walk a few
  // (buyin, rake, roi, N) combos. Hash-rotate index so the picks differ
  // pair-to-pair without needing an RNG.
  const BUY = [5, 10, 25, 50, 100, 200, 500];
  const RAKE = [0, 5, 7, 10, 12, 15, 20];
  const ROI = [-20, -10, -5, 0, 5, 10, 15, 25, 50];
  const N_T = [5000];
  const BR = [300, 500, 1000, 2000];

  const out: Scenario[] = [];
  let idx = 0;
  for (const [players, paid] of FIELD_PAID_PAIRS) {
    for (let k = 0; k < 3; k++) {
      idx++;
      const buyIn = BUY[(idx * 3 + k) % BUY.length];
      const rakePct = RAKE[(idx * 5 + k * 2) % RAKE.length];
      const roiPct = ROI[(idx * 7 + k * 3) % ROI.length];
      const number = N_T[(idx * 11 + k) % N_T.length];
      const bankroll = BR[(idx * 13 + k) % BR.length];
      const sc = safeScenario(
        players,
        paid,
        buyIn,
        rakePct,
        roiPct,
        number,
        bankroll,
      );
      if (sc) out.push(sc);
    }
  }
  return out;
}

const pct = (n: number) => (n * 100).toFixed(2) + "%";
const relErr = (a: number, b: number) => {
  const d = Math.abs(b);
  if (d < 1e-9) return Math.abs(a - b);
  return (a - b) / d;
};

interface Row {
  sc: Scenario;
  pdEv: number;
  pdSd: number;
  ourEv: number;
  ourSd: number;
  evErr: number;
  sdErr: number;
}

async function main() {
  const scenarios = buildGrid();
  console.log(
    `Running ${scenarios.length} PD-parity scenarios (ours=200k MC, PD=closed-form)…`,
  );

  const rows: Row[] = [];
  let worstEv = 0;
  let worstSd = 0;
  let cached = 0;
  let fetched = 0;

  for (const sc of scenarios) {
    const cacheFile = join(cacheDir, `${cacheKey(sc)}.json`);
    const wasCached = existsSync(cacheFile);
    const pd = await fetchPD(sc);
    if (wasCached) cached++;
    else fetched++;
    const ours = runOurs(sc);
    const evErr = relErr(ours.mean, pd.ev);
    const sdErr = relErr(ours.sd, pd.sd);
    rows.push({
      sc,
      pdEv: pd.ev,
      pdSd: pd.sd,
      ourEv: ours.mean,
      ourSd: ours.sd,
      evErr,
      sdErr,
    });
    // EV-relative-error suppression when pd.ev is ~0 compared to σ
    if (Math.abs(pd.ev) > 0.01 * Math.abs(pd.sd)) {
      worstEv = Math.max(worstEv, Math.abs(evErr));
    }
    worstSd = Math.max(worstSd, Math.abs(sdErr));
    process.stdout.write(
      `  [${rows.length.toString().padStart(3)}/${scenarios.length}] ${sc.name.padEnd(40)}  evΔ ${(evErr * 100).toFixed(2).padStart(6)}%  sdΔ ${(sdErr * 100).toFixed(2).padStart(6)}%${wasCached ? "" : "  (live)"}\n`,
    );
  }

  console.log();
  console.log("=".repeat(100));
  console.log(
    `Summary: ${rows.length} scenarios (${cached} cached, ${fetched} live)`,
  );
  console.log(
    `Worst EV err vs PD math : ${pct(worstEv)} (target < 3 %, MC noise on ours)`,
  );
  console.log(
    `Worst SD err vs PD math : ${pct(worstSd)} (target < 1 %, both closed-form)`,
  );
  console.log("=".repeat(100));

  const byEv = [...rows].sort((a, b) => Math.abs(b.evErr) - Math.abs(a.evErr));
  const bySd = [...rows].sort((a, b) => Math.abs(b.sdErr) - Math.abs(a.sdErr));
  console.log("\nTop 10 worst EV errors:");
  for (const r of byEv.slice(0, 10)) {
    console.log(
      `  ${r.sc.name.padEnd(45)}  pd=${r.pdEv.toFixed(0).padStart(8)}  ours=${r.ourEv.toFixed(0).padStart(8)}  Δ ${(r.evErr * 100).toFixed(2)}%`,
    );
  }
  console.log("\nTop 10 worst SD errors:");
  for (const r of bySd.slice(0, 10)) {
    console.log(
      `  ${r.sc.name.padEnd(45)}  pd=${r.pdSd.toFixed(0).padStart(8)}  ours=${r.ourSd.toFixed(0).padStart(8)}  Δ ${(r.sdErr * 100).toFixed(2)}%`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
