/**
 * PD parity along the UI path — not the cherry-picked "force PD curve"
 * path used by `pd_parity.ts`. Feeds the engine the exact shape the UI
 * feeds it (`payoutStructure: "mtt-standard"`, `compareWithPrimedope:
 * true`, PD flags at UI defaults) and reads `result.comparison.stats`
 * — that's what the PD pane renders. Then diffs against cached PD
 * responses.
 *
 * If this fails but `pd_parity.ts` passes, the math is fine and the UI
 * pane is mislabeled "PrimeDope" — fix is to force PD curve/paid in
 * compare mode, not to touch math.
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

// Flags as the app's default ControlsState sets them (src/app/page.tsx
// CONTROLS_DEFAULT and src/lib/scenarios.ts BASE_CONTROLS). These are
// what a user sees when they just open the app and hit Run. As of the
// faithful-by-default fix, this equals PD_FAITHFUL_FLAGS.
const UI_DEFAULT_FLAGS = {
  usePrimedopePayouts: true,
  usePrimedopeFinishModel: true,
  usePrimedopeRakeMath: true,
};

// Historical "broken default" — usePrimedopePayouts=false was the UI
// default for one dev cycle. Kept here as a regression reference so the
// script can still show the gap that motivated flipping defaults back.
const UI_BROKEN_DEFAULT_FLAGS = {
  usePrimedopePayouts: false,
  usePrimedopeFinishModel: true,
  usePrimedopeRakeMath: false,
};

// "PD-faithful" means all three ON + PD curve forced. This is what the
// `primedope` model preset does (see modelPresets.ts).
const PD_FAITHFUL_FLAGS = {
  usePrimedopePayouts: true,
  usePrimedopeFinishModel: true,
  usePrimedopeRakeMath: true,
};

function buildInput(
  sc: Scenario,
  flags: typeof UI_DEFAULT_FLAGS,
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

function runUiPath(sc: Scenario, flags: typeof UI_DEFAULT_FLAGS) {
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
  let worstFaithfulSd = 0;

  for (const sc of scenarios) {
    const pd = loadCachedPd(sc);
    const broken = runUiPath(sc, UI_BROKEN_DEFAULT_FLAGS);
    const ui = runUiPath(sc, UI_DEFAULT_FLAGS);
    const fi = runUiPath(sc, PD_FAITHFUL_FLAGS);
    void broken;

    const uiSdErr = relErr(ui.pdPane.sd, pd.sd);
    const fiSdErr = relErr(fi.pdPane.sd, pd.sd);
    worstUiSd = Math.max(worstUiSd, Math.abs(uiSdErr));
    worstFaithfulSd = Math.max(worstFaithfulSd, Math.abs(fiSdErr));

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
      `  UI PD pane default:  ${pad(money(ui.pdPane.mean), 10)}  ${pad(money(ui.pdPane.sd), 10)}  ${pad((uiSdErr * 100).toFixed(2) + "%", 14)}`,
    );
    console.log(
      `  UI PD pane faithful: ${pad(money(fi.pdPane.mean), 10)}  ${pad(money(fi.pdPane.sd), 10)}  ${pad((fiSdErr * 100).toFixed(2) + "%", 14)}`,
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
    `  UI default flags  (usePrimedopePayouts=false): ${(worstUiSd * 100).toFixed(2)}%`,
  );
  console.log(
    `  UI PD-faithful    (all three flags ON):        ${(worstFaithfulSd * 100).toFixed(2)}%`,
  );
  console.log("=".repeat(100));
}

main();
