/**
 * Experiments for reverse-engineering PrimeDope's $5789 sim SD.
 *
 * Reference: 100 players, $50, 11 % rake, 10 % ROI, 1000 tourneys.
 * PrimeDope reports: EV $5000, SD-math $5607, SD-sim $5789.
 *
 * Run via:  npx tsx scripts/sd_experiments.ts
 *
 * All findings get appended to notes/primedope_sd_theories.md by hand.
 */

import { readFileSync } from "node:fs";
import { runSimulation } from "../src/lib/sim/engine";
import { compileSchedule, makeCheckpointGrid } from "../src/lib/sim/engine";
import { buildBinaryItmAssets } from "../src/lib/sim/finishModel";
import { getPayoutTable } from "../src/lib/sim/payouts";
import type { SimulationInput } from "../src/lib/sim/types";

const REF: SimulationInput = {
  schedule: [
    {
      id: "pd-1",
      label: "$50 MTT",
      players: 100,
      buyIn: 50,
      rake: 0.11,
      roi: 0.1,
      payoutStructure: "mtt-standard" as const,
      count: 1000,
    },
  ],
  scheduleRepeats: 1,
  samples: 5000,
  bankroll: 1000,
  seed: 42,
  finishModel: { id: "power-law" },
  compareWithPrimedope: true,
};

const N_TOURNEYS = 1000;

function bar() {
  console.log("─".repeat(72));
}

// ---------- Exp B: pure analytical SD from pmf+prizes ----------------------
function analyticalBinaryItmSd() {
  bar();
  console.log("EXP B — analytical binary-ITM σ from pmf×prizes (no sim)");

  const players = 100;
  const buyIn = 50;
  const rake = 0.11;
  const roi = 0.1;
  const payouts = getPayoutTable("mtt-standard", players);
  const paid = payouts.reduce((n, p) => (p > 0 ? n + 1 : n), 0);
  const prizePool = players * buyIn;
  const targetPDStyle = buyIn * (1 + roi); // PD-style: rake out of cost
  const targetWithRake = buyIn * (1 + rake) * (1 + roi);

  for (const [label, target] of [
    ["PD-style EV (rake out)", targetPDStyle],
    ["with-rake EV", targetWithRake],
  ] as const) {
    const { pmf, prizeByPlace } = buildBinaryItmAssets(
      players,
      paid,
      payouts,
      prizePool,
      target,
    );
    let mu = 0,
      mu2 = 0;
    for (let i = 0; i < players; i++) {
      mu += pmf[i] * prizeByPlace[i];
      mu2 += pmf[i] * prizeByPlace[i] * prizeByPlace[i];
    }
    // Per-tournament profit variance = winnings variance (cost is a constant).
    const varOne = mu2 - mu * mu;
    const sdOne = Math.sqrt(varOne);
    const sdN = sdOne * Math.sqrt(N_TOURNEYS);
    console.log(
      `  ${label}: target=$${target.toFixed(2)} μ=$${mu.toFixed(2)} σ₁=$${sdOne.toFixed(1)} σ_${N_TOURNEYS}=$${sdN.toFixed(0)}`,
    );
  }
}

// ---------- Exp A: log compiled-entry summary ------------------------------
function inspectCompiledEntries() {
  bar();
  console.log("EXP A — what does compileSchedule produce for the reference?");
  const compiled = compileSchedule(
    { ...REF, calibrationMode: "primedope-binary-itm", compareWithPrimedope: false },
    "primedope-binary-itm",
  );
  console.log(`  tournamentsPerSample = ${compiled.tournamentsPerSample}`);
  console.log(`  flat.length          = ${compiled.flat.length}`);
  if (compiled.flat.length > 0) {
    const e = compiled.flat[0];
    console.log(
      `  flat[0]: paid=${e.paidCount} singleCost=$${e.singleCost.toFixed(2)} alpha=${e.alpha.toFixed(3)} itm=${e.itm.toFixed(4)}`,
    );
    // Reconstruct prize moments from cdf+prizeByPlace
    const N = e.prizeByPlace.length;
    const pmf = new Float64Array(N);
    pmf[0] = e.cdf[0];
    for (let i = 1; i < N; i++) pmf[i] = e.cdf[i] - e.cdf[i - 1];
    let mu = 0,
      mu2 = 0;
    for (let i = 0; i < N; i++) {
      mu += pmf[i] * e.prizeByPlace[i];
      mu2 += pmf[i] * e.prizeByPlace[i] * e.prizeByPlace[i];
    }
    console.log(
      `  N=${N}  μ=$${mu.toFixed(2)}  σ₁=$${Math.sqrt(mu2 - mu * mu).toFixed(1)}  σ_${N_TOURNEYS}=$${(Math.sqrt(mu2 - mu * mu) * Math.sqrt(N_TOURNEYS)).toFixed(0)}`,
    );
    // First 5 prizes
    const first = Array.from(e.prizeByPlace.slice(0, 5)).map((p) =>
      Math.round(p),
    );
    console.log(`  prizes[0..4] = $${first.join(", $")}`);
  }
}

// ---------- Exp B'  empirical sim σ vs analytic σ from same compile ----
function empiricalVsAnalytical() {
  bar();
  console.log("EXP B′ — empirical sim σ side-by-side with analytical σ (PD-style)");
  const r = runSimulation(REF);
  const c = r.comparison!;
  console.log(`  empirical sim:  μ=$${c.stats.mean.toFixed(0)}  σ=$${c.stats.stdDev.toFixed(0)}`);
  console.log(`  PrimeDope site: μ=$5000             σ=$5789 (sim) / $5607 (math)`);
  console.log(`  alpha primary:  μ=$${r.stats.mean.toFixed(0)}  σ=$${r.stats.stdDev.toFixed(0)}`);
}

// ---------- Exp C:  seed-scatter — Monte-Carlo noise floor ---------------
function seedScatter() {
  bar();
  console.log("EXP C — SD scatter across 8 seeds (noise floor for binary-ITM run)");
  const sds: number[] = [];
  for (let s = 42; s < 50; s++) {
    const r = runSimulation({ ...REF, seed: s, samples: 2000 });
    sds.push(r.comparison!.stats.stdDev);
  }
  const mean = sds.reduce((a, b) => a + b, 0) / sds.length;
  const var_ = sds.reduce((a, b) => a + (b - mean) ** 2, 0) / sds.length;
  console.log(`  sds       = [${sds.map((x) => x.toFixed(0)).join(", ")}]`);
  console.log(`  mean σ̂   = $${mean.toFixed(0)}  spread (1σ) ≈ $${Math.sqrt(var_).toFixed(1)}`);
}

// ---------- Exp D:  scan payout-curve ratios → which gives PD's $5789? ----
function scanPayoutCurves() {
  bar();
  console.log("EXP D — analytic σ for varying payout-curve ratios (1.20…1.55)");
  const players = 100;
  const buyIn = 50;
  const roi = 0.1;
  const prizePool = players * buyIn;
  const target = buyIn * (1 + roi);
  const paid = 15;

  for (let ratio = 1.2; ratio <= 1.55; ratio += 0.05) {
    // Build geometric payouts with the given ratio
    const raw = new Array(paid);
    raw[0] = 1;
    for (let i = 1; i < paid; i++) raw[i] = raw[i - 1] / ratio;
    const sum = raw.reduce((a, b) => a + b, 0);
    const norm = raw.map((x) => x / sum);
    const prizes = norm.map((x) => x * prizePool);

    // Two-bin uniform ITM
    const l = (target * paid) / prizePool;
    const pPaid = l / paid;
    let mu = 0,
      mu2 = 0;
    for (let i = 0; i < paid; i++) {
      mu += pPaid * prizes[i];
      mu2 += pPaid * prizes[i] * prizes[i];
    }
    const sdOne = Math.sqrt(mu2 - mu * mu);
    console.log(
      `  ratio=${ratio.toFixed(2)}  1st=$${prizes[0].toFixed(0).padStart(4)}  σ₁=$${sdOne.toFixed(1)}  σ_${N_TOURNEYS}=$${(sdOne * Math.sqrt(N_TOURNEYS)).toFixed(0)}`,
    );
  }
}

// ---------- Exp E: scan paid count -----------------------------------------
function scanPaidCount() {
  bar();
  console.log("EXP E — analytic σ for varying paid count (10…20) at ratio=1.35");
  const players = 100;
  const buyIn = 50;
  const roi = 0.1;
  const prizePool = players * buyIn;
  const target = buyIn * (1 + roi);
  const ratio = 1.35;

  for (let paid = 10; paid <= 20; paid++) {
    const raw = new Array(paid);
    raw[0] = 1;
    for (let i = 1; i < paid; i++) raw[i] = raw[i - 1] / ratio;
    const sum = raw.reduce((a, b) => a + b, 0);
    const norm = raw.map((x) => x / sum);
    const prizes = norm.map((x) => x * prizePool);

    const l = (target * paid) / prizePool;
    const pPaid = l / paid;
    let mu = 0,
      mu2 = 0;
    for (let i = 0; i < paid; i++) {
      mu += pPaid * prizes[i];
      mu2 += pPaid * prizes[i] * prizes[i];
    }
    const sdOne = Math.sqrt(mu2 - mu * mu);
    console.log(
      `  paid=${paid.toString().padStart(2)}  1st=$${prizes[0].toFixed(0).padStart(4)}  σ₁=$${sdOne.toFixed(1)}  σ_${N_TOURNEYS}=$${(sdOne * Math.sqrt(N_TOURNEYS)).toFixed(0)}`,
    );
  }
}

// ---------- Exp F: field-size sweep — mtt-primedope vs best PD h[i] --------
function sweepFieldSizes() {
  bar();
  console.log(
    "EXP F — sweep: for several field sizes, compare our mtt-primedope σ against the best-matching h[i] from tmp_legacy.js",
  );
  // Parse tmp_legacy.js h[] tables once (same parser as dump_pd_tables.ts).
  const src = readFileSync("tmp_legacy.js", "utf8");
  const start = src.indexOf("var g, h = [");
  if (start < 0) {
    console.log("  (tmp_legacy.js not found — skipping sweep)");
    return;
  }
  const openBracket = src.indexOf("[", start);
  let depth = 0;
  let end = -1;
  for (let i = openBracket; i < src.length; i++) {
    const ch = src[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-eval
  const h: [number, number][][] = eval(src.slice(openBracket, end + 1));

  const expand = (tbl: [number, number][], maxField: number): number[] => {
    const out = new Array(maxField).fill(0);
    let prev = 0;
    for (const [place, frac] of tbl) {
      if (place > maxField) break;
      for (let p = prev + 1; p <= place; p++) out[p - 1] = frac;
      prev = place;
    }
    return out;
  };

  const analyticSdForPayouts = (
    N: number,
    fractions: number[],
    buyIn: number,
    roi: number,
  ): number => {
    const pool = N * buyIn;
    const target = buyIn * (1 + roi);
    const paid = fractions.reduce((n, f) => (f > 0 ? n + 1 : n), 0);
    if (paid === 0) return 0;
    const l = Math.min(1, (target * paid) / pool);
    const pPaid = l / paid;
    let mu = 0,
      mu2 = 0;
    for (let i = 0; i < paid; i++) {
      const prize = fractions[i] * pool;
      mu += pPaid * prize;
      mu2 += pPaid * prize * prize;
    }
    return Math.sqrt(Math.max(0, mu2 - mu * mu));
  };

  const fields = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
  const buyIn = 50;
  const roi = 0.1;
  const N_T = 1000;
  console.log(
    "  N     ourPaid  ourσ_1000    bestPdIdx  pdPaid  pdσ_1000    Δ%",
  );
  console.log("  " + "─".repeat(66));
  for (const N of fields) {
    const ours = getPayoutTable("mtt-primedope", N);
    const ourSd1 = analyticSdForPayouts(N, ours, buyIn, roi);
    const ourSd1k = ourSd1 * Math.sqrt(N_T);
    const ourPaid = ours.reduce((n, f) => (f > 0 ? n + 1 : n), 0);

    // Find best PD h[i] for this field size (closest σ to ours — proxy
    // for "which table would a well-calibrated PD user pick").
    let bestIdx = -1;
    let bestSd1k = 0;
    let bestDelta = Infinity;
    let bestPaid = 0;
    for (let idx = 0; idx < h.length; idx++) {
      const frac = expand(h[idx], N);
      const sumF = frac.reduce((a, b) => a + b, 0);
      if (sumF < 0.5 || sumF > 1.5) continue;
      const paid = frac.reduce((n, f) => (f > 0 ? n + 1 : n), 0);
      if (paid === 0) continue;
      const sd1 = analyticSdForPayouts(N, frac, buyIn, roi);
      const sd1k = sd1 * Math.sqrt(N_T);
      const delta = Math.abs(sd1k - ourSd1k);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestSd1k = sd1k;
        bestIdx = idx;
        bestPaid = paid;
      }
    }
    const deltaPct = (100 * (ourSd1k - bestSd1k)) / bestSd1k;
    console.log(
      `  ${N.toString().padStart(5)}  ${ourPaid
        .toString()
        .padStart(6)}   $${ourSd1k.toFixed(0).padStart(6)}     h[${bestIdx
        .toString()
        .padStart(2)}]     ${bestPaid.toString().padStart(4)}    $${bestSd1k
        .toFixed(0)
        .padStart(6)}   ${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%`,
    );
  }
}

// ----------------------------------------------------------------------
analyticalBinaryItmSd();
inspectCompiledEntries();
empiricalVsAnalytical();
seedScatter();
scanPayoutCurves();
scanPaidCount();
sweepFieldSizes();
bar();
