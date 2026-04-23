/**
 * PD parity along the UI path — not the cherry-picked "force PD curve"
 * path used by `pd_parity.ts`. Feeds the engine the exact shape the UI
 * feeds it (`payoutStructure: "mtt-standard"`, `compareWithPrimedope:
 * true`, PD flags at UI defaults) and reads `result.comparison.stats`
 * — that's what the PD pane renders. It also runs the explicit
 * `primedopeStyleEV` diagnostic opt-in, which is the only mode expected to
 * match the live site EV/SD byte-for-byte.
 *
 * If this fails but `pd_parity.ts` passes, the math is fine and the UI
 * pane is mislabeled "exact PrimeDope site" — normal UI intentionally keeps
 * the app's full-ticket ROI basis while borrowing PD's distribution quirks.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import { runSimulation } from "../src/lib/sim/engine";
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
  ev: number;
  sd: number;
  evSimulated: number;
  sdSimulated: number;
}

const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(here, "pd_cache");

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

function loadCachedPd(sc: Scenario): PdResponse {
  const f = join(cacheDir, `${cacheKey(sc)}.json`);
  if (!existsSync(f)) {
    throw new Error(
      `no cached PD response for ${sc.name} — run pd_parity.ts first to populate the cache`,
    );
  }
  return JSON.parse(readFileSync(f, "utf-8")) as PdResponse;
}

// Flags as the app's default ControlsState sets them. These are what a user
// sees when they just open the app and hit Run: PD distribution/rake quirks,
// but still our full-ticket ROI basis.
const UI_DEFAULT_FLAGS = {
  usePrimedopePayouts: true,
  usePrimedopeFinishModel: true,
  usePrimedopeRakeMath: true,
};

// Exact live-site parity also opts into PD's rake-ignored EV basis.
const PD_SITE_EV_FLAGS = {
  usePrimedopePayouts: true,
  usePrimedopeFinishModel: true,
  usePrimedopeRakeMath: true,
  primedopeStyleEV: true,
};

type PdUiFlags = typeof UI_DEFAULT_FLAGS & { primedopeStyleEV?: boolean };

function buildInput(
  sc: Scenario,
  flags: PdUiFlags,
): SimulationInput {
  // mimic the UI: user picks payoutStructure "mtt-standard" on a single
  // row, ticks "compare with PrimeDope". No customPayouts override.
  const row: TournamentRow = {
    id: "r",
    label: sc.name,
    players: sc.players,
    buyIn: sc.buyIn,
    rake: sc.rakePct / 100,
    roi: sc.roiPct / 100,
    payoutStructure: "mtt-standard",
    count: sc.number,
  };
  return {
    schedule: [row],
    scheduleRepeats: 1,
    samples: 200_000,
    bankroll: sc.bankroll,
    seed: 42,
    finishModel: { id: "power-law" },
    compareWithPrimedope: true,
    ...flags,
  };
}

function runUiPath(sc: Scenario, flags: PdUiFlags) {
  const result = runSimulation(buildInput(sc, flags));
  if (!result.comparison) throw new Error("no comparison in result");
  return {
    primary: { mean: result.stats.mean, sd: result.stats.stdDev },
    pdPane: {
      mean: result.comparison.stats.mean,
      sd: result.comparison.stats.stdDev,
    },
  };
}

const scenarios: Scenario[] = [
  { name: "S1 baseline 100p", players: 100, placesPaid: 15, buyIn: 50,  rakePct: 11, roiPct: 10, number: 1000, bankroll: 1000, samples: 5000 },
  { name: "S2 small 45p    ", players:  45, placesPaid:  6, buyIn: 30,  rakePct: 10, roiPct: 15, number:  500, bankroll:  500, samples: 5000 },
  { name: "S3 mid 200p     ", players: 200, placesPaid: 30, buyIn: 20,  rakePct: 10, roiPct: 10, number: 1000, bankroll:  500, samples: 5000 },
  { name: "S4 large 500p   ", players: 500, placesPaid: 75, buyIn: 10,  rakePct: 10, roiPct: 10, number: 1000, bankroll:  300, samples: 5000 },
  { name: "S5 high rake    ", players: 100, placesPaid: 15, buyIn: 25,  rakePct: 20, roiPct:  5, number: 1000, bankroll:  500, samples: 5000 },
  { name: "S8 high ROI 25% ", players: 100, placesPaid: 15, buyIn: 100, rakePct: 10, roiPct: 25, number:  200, bankroll: 2000, samples: 5000 },
];

const pad = (s: string | number, n: number) => String(s).padStart(n);
const money = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const relErr = (a: number, b: number) =>
  Math.abs(b) < 1e-9 ? Math.abs(a - b) : (a - b) / Math.abs(b);

function main() {
  console.log("=".repeat(100));
  console.log(
    "PD parity along the UI path — checks the ACTUAL PD pane that users see",
  );
  console.log(
    "  compareWithPrimedope: true, payoutStructure: mtt-standard (no forced PD curve)",
  );
  console.log("=".repeat(100));

  let worstUiSd = 0;
  let worstPdSiteSd = 0;

  for (const sc of scenarios) {
    const pd = loadCachedPd(sc);
    const ui = runUiPath(sc, UI_DEFAULT_FLAGS);
    const pdSite = runUiPath(sc, PD_SITE_EV_FLAGS);

    const uiSdErr = relErr(ui.pdPane.sd, pd.sd);
    const pdSiteSdErr = relErr(pdSite.pdPane.sd, pd.sd);
    worstUiSd = Math.max(worstUiSd, Math.abs(uiSdErr));
    worstPdSiteSd = Math.max(worstPdSiteSd, Math.abs(pdSiteSdErr));

    console.log();
    console.log(
      `${sc.name}  |  ${sc.players}p, paid=${sc.placesPaid}, $${sc.buyIn} +${sc.rakePct}%, ROI ${sc.roiPct}%, N=${sc.number}`,
    );
    console.log(
      `                      ${pad("EV", 10)}  ${pad("SD", 10)}  ${pad("Δ SD vs PD", 14)}`,
    );
    console.log(
      `  PD site (math)    :  ${pad(money(pd.ev), 10)}  ${pad(money(pd.sd), 10)}  ${pad("—", 14)}`,
    );
    console.log(
      `  UI PD pane full-cost: ${pad(money(ui.pdPane.mean), 10)}  ${pad(money(ui.pdPane.sd), 10)}  ${pad((uiSdErr * 100).toFixed(2) + "%", 14)}`,
    );
    console.log(
      `  PD-site EV opt-in:    ${pad(money(pdSite.pdPane.mean), 10)}  ${pad(money(pdSite.pdPane.sd), 10)}  ${pad((pdSiteSdErr * 100).toFixed(2) + "%", 14)}`,
    );
    console.log(
      `  UI primary (alpha):  ${pad(money(ui.primary.mean), 10)}  ${pad(money(ui.primary.sd), 10)}`,
    );
  }

  console.log();
  console.log("=".repeat(100));
  console.log(
    `WORST SD ERROR vs PD site:`,
  );
  console.log(
    `  UI full-cost PD pane: ${(worstUiSd * 100).toFixed(2)}%`,
  );
  console.log(
    `  PD-site EV opt-in:   ${(worstPdSiteSd * 100).toFixed(2)}%`,
  );
  console.log("=".repeat(100));
}

main();
