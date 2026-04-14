/**
 * PokerDope parity check — against the LIVE site, not a reimplementation.
 *
 * The current PD calculator is server-side math: the client JS (fetched
 * from primedope.com) does nothing but shell out to
 *   GET /prime.php?p=tournament-variance-calculator&sub_routine=calc&args=<kv...>
 * where kv pairs are space-separated. The response is a JSON blob with the
 * exact numbers the UI shows — ev, sd (math), sdSimulated, min50/15/5/1
 * percentiles, riskOfRuin, conf intervals, etc.
 *
 * This script hits that endpoint directly for each scenario (with a tiny
 * delay + on-disk cache so we don't hammer their box), runs our engine on
 * the same inputs in primedope-binary-itm mode, and diffs the two.
 *
 * "Our engine matches PD" ≡ diff of EV/SD/percentiles is within MC noise.
 * Any systematic gap = a real model discrepancy worth fixing.
 *
 * Cache: scripts/pd_cache/<hash>.json — delete to force a refetch.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runSimulation } from "../src/lib/sim/engine";
import type { SimulationInput, TournamentRow } from "../src/lib/sim/types";

interface Scenario {
  name: string;
  players: number;
  placesPaid: number; // must be a value from PD's paid_places dropdown
  buyIn: number;
  rakePct: number;
  roiPct: number;
  number: number;
  bankroll: number;
  samples: number; // PD sample size for their MC — affects their percentiles
}

// Reference 15-slot PD curve — only used to seed our engine's customPayouts.
// PD's server computes its own curve from (players, places_paid), but our
// engine needs an explicit vector. We pre-resample identically to how PD does
// it internally (CDF-stretch of h[8]) so the inputs agree.
const PD_H8 = [
  0.255, 0.16, 0.115, 0.09, 0.075, 0.06, 0.045, 0.035, 0.03, 0.025, 0.025,
  0.025, 0.02, 0.02, 0.02,
];

function pdCurveAt(paid: number): number[] {
  if (paid === PD_H8.length) return PD_H8.slice();
  const srcCum: number[] = new Array(PD_H8.length + 1);
  srcCum[0] = 0;
  for (let i = 0; i < PD_H8.length; i++) srcCum[i + 1] = srcCum[i] + PD_H8[i];
  const total = srcCum[PD_H8.length];
  const sampleCum = (t: number): number => {
    const x = t * PD_H8.length;
    const lo = Math.floor(x);
    if (lo >= PD_H8.length) return total;
    const frac = x - lo;
    return srcCum[lo] + frac * (srcCum[lo + 1] - srcCum[lo]);
  };
  const out = new Array<number>(paid);
  let sum = 0;
  for (let i = 0; i < paid; i++) {
    const a = sampleCum(i / paid);
    const b = sampleCum((i + 1) / paid);
    out[i] = b - a;
    sum += out[i];
  }
  for (let i = 0; i < paid; i++) out[i] /= sum;
  return out;
}

interface PdResponse {
  tournamentTypes: number;
  countTournaments: number;
  samplesize: number;
  min50percentile: number;
  min15percentile: number;
  min05percentile: number;
  min01percentile: number;
  neverBelowZero: number;
  riskOfRuin: number;
  sumBuyins: number;
  ev: number;
  evSimulated: number;
  roi: number;
  roiSimulated: number;
  sd: number;
  sdSimulated: number;
  countLoss: number;
  probLoss: number;
  conf70: [number, number];
  conf95: [number, number];
  conf997: [number, number];
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
  // PD's client code does URLSearchParams().toString() then replaceAll("&"," ")
  // so kv pairs are space-separated inside the single `args=` value.
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
  // Tiny polite delay between live calls
  await new Promise((r) => setTimeout(r, 800));
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 pd-parity-script" } });
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
    customPayouts: pdCurveAt(sc.placesPaid),
    count: sc.number,
  };
  const input: SimulationInput = {
    schedule: [row],
    scheduleRepeats: 1,
    samples: 50_000,
    bankroll: sc.bankroll,
    seed: 42,
    finishModel: { id: "power-law" },
    calibrationMode: "primedope-binary-itm",
    primedopeStyleEV: true,
  };
  const r = runSimulation(input);
  return {
    mean: r.stats.mean,
    sd: r.stats.stdDev,
    minBR50: r.stats.minBankrollRoR50pct ?? 0,
    minBR15: r.stats.minBankrollRoR15pct ?? 0,
    minBR5: r.stats.minBankrollRoR5pct,
    minBR1: r.stats.minBankrollRoR1pct,
    ruinFrac: r.stats.riskOfRuin,
  };
}

const scenarios: Scenario[] = [
  { name: "S1 baseline 100p", players: 100, placesPaid: 15, buyIn: 50,  rakePct: 11, roiPct: 10, number: 1000, bankroll: 1000, samples: 5000 },
  { name: "S2 small 45p    ", players:  45, placesPaid:  6, buyIn: 30,  rakePct: 10, roiPct: 15, number:  500, bankroll:  500, samples: 5000 },
  { name: "S3 mid 200p     ", players: 200, placesPaid: 30, buyIn: 20,  rakePct: 10, roiPct: 10, number: 1000, bankroll:  500, samples: 5000 },
  { name: "S4 large 500p   ", players: 500, placesPaid: 75, buyIn: 10,  rakePct: 10, roiPct: 10, number: 1000, bankroll:  300, samples: 5000 },
  { name: "S5 high rake    ", players: 100, placesPaid: 15, buyIn: 25,  rakePct: 20, roiPct:  5, number: 1000, bankroll:  500, samples: 5000 },
  { name: "S6 break-even   ", players: 200, placesPaid: 30, buyIn: 50,  rakePct: 10, roiPct:  0, number:  500, bankroll: 1000, samples: 5000 },
  { name: "S7 losing -5%   ", players: 500, placesPaid: 75, buyIn: 20,  rakePct: 10, roiPct: -5, number: 1000, bankroll:  500, samples: 5000 },
  { name: "S8 high ROI 25% ", players: 100, placesPaid: 15, buyIn: 100, rakePct: 10, roiPct: 25, number:  200, bankroll: 2000, samples: 5000 },
];

const pad = (s: string | number, n: number) => String(s).padStart(n);
const money = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const pct = (n: number) => (n * 100).toFixed(2) + "%";
const relErr = (a: number, b: number) => {
  const d = Math.abs(b);
  if (d < 1e-9) return Math.abs(a - b);
  return (a - b) / d;
};

async function main() {
  console.log("=".repeat(100));
  console.log("PokerDope LIVE parity check — fetching real numbers from primedope.com");
  console.log("=".repeat(100));

  let worstEvErr = 0;
  let worstSdErr = 0;

  for (const sc of scenarios) {
    process.stdout.write(`  fetching ${sc.name} … `);
    const pd = await fetchPD(sc);
    console.log("ok");
    const ours = runOurs(sc);

    const evErr = relErr(ours.mean, pd.ev);
    const sdErrMath = relErr(ours.sd, pd.sd);
    const sdErrSim = relErr(ours.sd, pd.sdSimulated);
    worstEvErr = Math.max(worstEvErr, Math.abs(evErr));
    worstSdErr = Math.max(worstSdErr, Math.abs(sdErrMath));

    console.log();
    console.log(
      `${sc.name}  |  ${sc.players}p, paid=${sc.placesPaid}, $${sc.buyIn} +${sc.rakePct}%, ROI ${sc.roiPct}%, N=${sc.number}, BR=${sc.bankroll}`,
    );
    console.log(
      `                  ${pad("EV", 10)}  ${pad("SD", 10)}  ${pad("min50%", 10)}  ${pad("min15%", 10)}  ${pad("min5%", 10)}  ${pad("min1%", 10)}  ${pad("RoR", 8)}`,
    );
    console.log(
      `  PD  math    :  ${pad(money(pd.ev), 10)}  ${pad(money(pd.sd), 10)}  ${pad("-", 10)}  ${pad("-", 10)}  ${pad("-", 10)}  ${pad("-", 10)}  ${pad("-", 8)}`,
    );
    console.log(
      `  PD  sim(${pad(pd.samplesize, 4)}):  ${pad(money(pd.evSimulated), 10)}  ${pad(money(pd.sdSimulated), 10)}  ${pad(money(-pd.min50percentile), 10)}  ${pad(money(-pd.min15percentile), 10)}  ${pad(money(-pd.min05percentile), 10)}  ${pad(money(-pd.min01percentile), 10)}  ${pad(pct(pd.riskOfRuin), 8)}`,
    );
    console.log(
      `  OUR sim(50k):  ${pad(money(ours.mean), 10)}  ${pad(money(ours.sd), 10)}  ${pad(money(ours.minBR50), 10)}  ${pad(money(ours.minBR15), 10)}  ${pad(money(ours.minBR5), 10)}  ${pad(money(ours.minBR1), 10)}  ${pad(pct(ours.ruinFrac), 8)}`,
    );
    console.log(
      `  Δ vs PD-math:  ${pad((evErr * 100).toFixed(2) + "%", 10)}  ${pad((sdErrMath * 100).toFixed(2) + "%", 10)}`,
    );
    console.log(
      `  Δ vs PD-sim :  ${pad(((ours.mean - pd.evSimulated) / Math.max(1, Math.abs(pd.evSimulated)) * 100).toFixed(2) + "%", 10)}  ${pad((sdErrSim * 100).toFixed(2) + "%", 10)}`,
    );
  }

  console.log();
  console.log("=".repeat(100));
  console.log(
    `WORST ERRORS vs PD (math):  EV ${(worstEvErr * 100).toFixed(2)}%, SD ${(worstSdErr * 100).toFixed(2)}%`,
  );
  console.log(
    "Expected: EV < 1% (MC noise on our side), SD < 2% (their SD formula has a small systematic bias vs uniform-band).",
  );
  console.log(
    "Percentiles: their numbers come from only 1000–5000 MC samples, so treat ±15% as noise floor on those.",
  );
  console.log("=".repeat(100));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
