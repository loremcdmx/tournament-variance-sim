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

import { compileSchedule, runSimulation } from "../src/lib/sim/engine";
import { primedopeCurveForPaid } from "../src/lib/sim/pdCurves";
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

// Use the engine's own PD curve family (`src/lib/sim/pdCurves.ts`) — 34
// native curves scraped from PD's `sub_routine=payout_info` endpoint.
// Previously this script used a local `pd_curves.json` which only covered
// paid ≤ 31 and silently clamped larger fields onto a wrong curve.
function pdCurveAt(paid: number): number[] {
  return primedopeCurveForPaid(paid);
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

function quantileSorted(sorted: Float64Array, q: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const idx = q * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
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
    samples: 2_000_000,
    bankroll: sc.bankroll,
    seed: 42,
    finishModel: { id: "power-law" },
    calibrationMode: "primedope-binary-itm",
    primedopeStyleEV: true,
  };
  const compiled = compileSchedule(input, "primedope-binary-itm");
  const r = runSimulation(input);
  const sorted = new Float64Array(r.finalProfits);
  sorted.sort();
  return {
    exactEv: compiled.expectedProfit,
    mean: r.stats.mean,
    sd: r.stats.stdDev,
    minBR50: r.stats.minBankrollRoR50pct ?? 0,
    minBR15: r.stats.minBankrollRoR15pct ?? 0,
    minBR5: r.stats.minBankrollRoR5pct,
    minBR1: r.stats.minBankrollRoR1pct,
    ruinFrac: r.stats.riskOfRuin,
    neverBelowZeroFrac: r.stats.neverBelowZeroFrac,
    // PD conf intervals: conf70 = [15%, 85%], conf95 = [2.5%, 97.5%], conf997 = [0.15%, 99.85%]
    conf70: [quantileSorted(sorted, 0.15), quantileSorted(sorted, 0.85)] as const,
    conf95: [quantileSorted(sorted, 0.025), quantileSorted(sorted, 0.975)] as const,
    conf997: [quantileSorted(sorted, 0.0015), quantileSorted(sorted, 0.9985)] as const,
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
  let worstMinBRErr = 0;
  let worstConfErr = 0;

  for (const sc of scenarios) {
    process.stdout.write(`  fetching ${sc.name} … `);
    const pd = await fetchPD(sc);
    console.log("ok");
    const ours = runOurs(sc);

    const evErr = relErr(ours.exactEv, pd.ev);
    const simEvErr = relErr(ours.mean, pd.evSimulated);
    const sdErrMath = relErr(ours.sd, pd.sd);
    const sdErrSim = relErr(ours.sd, pd.sdSimulated);
    // Skip EV worst-case accumulation when |pd.ev| is trivially small vs SD —
    // break-even scenarios blow up relative errors on essentially-zero means.
    if (Math.abs(pd.ev) > 0.01 * pd.sd) {
      worstEvErr = Math.max(worstEvErr, Math.abs(evErr));
    }
    worstSdErr = Math.max(worstSdErr, Math.abs(sdErrMath));

    // min-bankroll percentiles: PD reports `minNpercentile` as a negative
    // profit number (the running-min dollar depth you need to cover). Ours
    // are positive bankrolls, which should match −pd.min*percentile.
    const pdMinBR50 = -pd.min50percentile;
    const pdMinBR15 = -pd.min15percentile;
    const pdMinBR5 = -pd.min05percentile;
    const pdMinBR1 = -pd.min01percentile;
    const minBR50Err = relErr(ours.minBR50, pdMinBR50);
    const minBR15Err = relErr(ours.minBR15, pdMinBR15);
    const minBR5Err = relErr(ours.minBR5, pdMinBR5);
    const minBR1Err = relErr(ours.minBR1, pdMinBR1);
    worstMinBRErr = Math.max(
      worstMinBRErr,
      ...[minBR50Err, minBR15Err, minBR5Err, minBR1Err].map(Math.abs),
    );

    // Conf-interval quantile errors (both bounds)
    const confErrs = [
      relErr(ours.conf70[0], pd.conf70[0]),
      relErr(ours.conf70[1], pd.conf70[1]),
      relErr(ours.conf95[0], pd.conf95[0]),
      relErr(ours.conf95[1], pd.conf95[1]),
      relErr(ours.conf997[0], pd.conf997[0]),
      relErr(ours.conf997[1], pd.conf997[1]),
    ];
    worstConfErr = Math.max(worstConfErr, ...confErrs.map(Math.abs));

    console.log();
    console.log(
      `${sc.name}  |  ${sc.players}p, paid=${sc.placesPaid}, $${sc.buyIn} +${sc.rakePct}%, ROI ${sc.roiPct}%, N=${sc.number}, BR=${sc.bankroll}`,
    );
    console.log(
      `                  ${pad("EV", 10)}  ${pad("SD", 10)}  ${pad("min50%", 10)}  ${pad("min15%", 10)}  ${pad("min5%", 10)}  ${pad("min1%", 10)}  ${pad("RoR", 8)}  ${pad("neverBZ", 9)}`,
    );
    console.log(
      `  PD  math    :  ${pad(money(pd.ev), 10)}  ${pad(money(pd.sd), 10)}  ${pad("-", 10)}  ${pad("-", 10)}  ${pad("-", 10)}  ${pad("-", 10)}  ${pad("-", 8)}  ${pad("-", 9)}`,
    );
    console.log(
      `  PD  sim(${pad(pd.samplesize, 4)}):  ${pad(money(pd.evSimulated), 10)}  ${pad(money(pd.sdSimulated), 10)}  ${pad(money(pdMinBR50), 10)}  ${pad(money(pdMinBR15), 10)}  ${pad(money(pdMinBR5), 10)}  ${pad(money(pdMinBR1), 10)}  ${pad(pct(pd.riskOfRuin), 8)}  ${pad(String(pd.neverBelowZero), 9)}`,
    );
    console.log(
      `  OUR exact EV:  ${pad(money(ours.exactEv), 10)}  ${pad("-", 10)}  ${pad("-", 10)}  ${pad("-", 10)}  ${pad("-", 10)}  ${pad("-", 10)}  ${pad("-", 8)}  ${pad("-", 9)}`,
    );
    console.log(
      `  OUR sim(2M)  :  ${pad(money(ours.mean), 10)}  ${pad(money(ours.sd), 10)}  ${pad(money(ours.minBR50), 10)}  ${pad(money(ours.minBR15), 10)}  ${pad(money(ours.minBR5), 10)}  ${pad(money(ours.minBR1), 10)}  ${pad(pct(ours.ruinFrac), 8)}  ${pad(pct(ours.neverBelowZeroFrac), 9)}`,
    );
    console.log(
      `  Δ vs PD-sim :  ${pad((simEvErr * 100).toFixed(2) + "%", 10)}  ${pad((sdErrSim * 100).toFixed(2) + "%", 10)}  ${pad((minBR50Err * 100).toFixed(1) + "%", 10)}  ${pad((minBR15Err * 100).toFixed(1) + "%", 10)}  ${pad((minBR5Err * 100).toFixed(1) + "%", 10)}  ${pad((minBR1Err * 100).toFixed(1) + "%", 10)}`,
    );
    console.log(
      `  Δ vs PD-math:  ${pad((evErr * 100).toFixed(2) + "%", 10)}  ${pad((sdErrMath * 100).toFixed(2) + "%", 10)}`,
    );
    console.log(
      `  conf70 :  PD [${money(pd.conf70[0])}, ${money(pd.conf70[1])}]  OUR [${money(ours.conf70[0])}, ${money(ours.conf70[1])}]  Δ [${(confErrs[0] * 100).toFixed(1)}%, ${(confErrs[1] * 100).toFixed(1)}%]`,
    );
    console.log(
      `  conf95 :  PD [${money(pd.conf95[0])}, ${money(pd.conf95[1])}]  OUR [${money(ours.conf95[0])}, ${money(ours.conf95[1])}]  Δ [${(confErrs[2] * 100).toFixed(1)}%, ${(confErrs[3] * 100).toFixed(1)}%]`,
    );
    console.log(
      `  conf997:  PD [${money(pd.conf997[0])}, ${money(pd.conf997[1])}]  OUR [${money(ours.conf997[0])}, ${money(ours.conf997[1])}]  Δ [${(confErrs[4] * 100).toFixed(1)}%, ${(confErrs[5] * 100).toFixed(1)}%]`,
    );
  }

  console.log();
  console.log("=".repeat(100));
  console.log(
    `WORST ERRORS vs PD (math):  EV ${(worstEvErr * 100).toFixed(2)}%, SD ${(worstSdErr * 100).toFixed(2)}%`,
  );
  console.log(
    `WORST ERRORS vs PD (sim) :  minBR ${(worstMinBRErr * 100).toFixed(1)}%, conf-bounds ${(worstConfErr * 100).toFixed(1)}%`,
  );
  console.log(
    "Expected: exact EV < 0.1%, SD < 0.2% (PD EV is closed-form; our sim mean is reported separately).",
  );
  console.log(
    "minBR / conf bounds: PD uses 5000 samples, we use 2M — expect ±5-20% noise on tail quantiles driven entirely by PD's low S.",
  );
  console.log("=".repeat(100));
  if (worstEvErr > 0.001 || worstSdErr > 0.002) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
