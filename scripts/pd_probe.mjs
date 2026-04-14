/**
 * PokerDope weakness probe.
 *
 * Pure Node script (no TS toolchain needed). Hits the live
 *   GET /prime.php?p=tournament-variance-calculator&sub_routine=calc&args=<kv...>
 * endpoint with a curated set of pathological scenarios designed to expose
 * weaknesses in PD's binary-ITM uniform-within-band model.
 *
 * Each probe is tagged with a category explaining what we're testing:
 *   A = itm = (1+r)*H/J overflow at high ROI
 *   B = uniform-within-cashed-band suppresses top-heavy variance
 *   C = sample-size / reproducibility (MC jitter in their percentiles)
 *   D = degenerate numerical / edge values
 *   E = dropdown boundary / paid_places edge
 *   F = missing features (rebuy/bounty/re-entry — documented, not probed)
 *   G = running-min RoR behavior
 *   H = rake edge
 *
 * Responses are cached on disk (scripts/pd_cache/) so reruns don't hammer
 * the server. Delete the cache dir to force refetch.
 *
 * Run: node scripts/pd_probe.mjs
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(here, "pd_cache");
if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });

const DELAY_MS = 1500; // polite pacing between live calls

const scenarios = [
  // ========== A: ITM overflow at high ROI ==========
  { cat: "A", name: "A1 +400% ROI    ", players: 100, places_paid: 15, buyin: 50, rake: 11, roi: 400,  number: 1000, bankroll: 1000, samples: 2000, note: "itm=(1+4)*15/100=0.75 — still valid but extreme" },
  // A2-A5 are known to crash their PHP-FPM pool (itm ≥ 1 overflow) and cause
  // 5-15 min of downtime on prime.php. Documented in notes/pokerdope_weaknesses.md.
  // Do NOT uncomment without a very good reason — this is not just our bug,
  // every concurrent user of the calculator site gets 502'd while it's dead.
  // { cat: "A", name: "A2 +566% ROI    ", players: 100, places_paid: 15, buyin: 50, rake: 11, roi: 566, number: 1000, bankroll: 1000, samples: 2000, note: "CRASH — itm ≈ 0.999" },
  // { cat: "A", name: "A3 +600% ROI    ", players: 100, places_paid: 15, buyin: 50, rake: 11, roi: 600, number: 1000, bankroll: 1000, samples: 2000, note: "CRASH — itm=1.05" },
  // { cat: "A", name: "A4 +1000% ROI   ", players: 100, places_paid: 15, buyin: 50, rake: 11, roi: 1000,number: 1000, bankroll: 1000, samples: 2000, note: "CRASH — itm=1.65" },
  // { cat: "A", name: "A5 45p/40paid +50% ROI", players: 45, places_paid: 40, buyin: 30, rake: 10, roi: 50, number: 500, bankroll: 500, samples: 2000, note: "CRASH — itm=1.33" },

  // ========== B: top-heavy variance suppression ==========
  { cat: "B", name: "B1 1000p +5% ROI", players: 1000, places_paid: 150, buyin: 10, rake: 10, roi: 5, number: 1000, bankroll: 500, samples: 2000, note: "large field — top prize dominates reality, PD flattens" },
  { cat: "B", name: "B2 WTA 100p/1   ", players: 100, places_paid: 1,   buyin: 50, rake: 10, roi: 10, number: 500, bankroll: 1000, samples: 2000, note: "winner-take-all — extreme top-heavy, tests flatten vs reality" },
  { cat: "B", name: "B3 HU 2p/1      ", players: 2,   places_paid: 1,   buyin: 50, rake: 10, roi: 10, number: 500, bankroll: 500, samples: 2000, note: "heads-up — minimum viable field" },

  // ========== C: sample size / RoR reproducibility ==========
  { cat: "C", name: "C1 baseline s=500 run1", players: 100, places_paid: 15, buyin: 50, rake: 11, roi: 10, number: 1000, bankroll: 1000, samples:  500, note: "low sample — noisy percentiles" },
  { cat: "C", name: "C2 baseline s=500 run2", players: 100, places_paid: 15, buyin: 50, rake: 11, roi: 10, number: 1000, bankroll: 1000, samples:  500, note: "same scenario, different call — measures their RNG jitter", _bustCache: 2 },
  { cat: "C", name: "C3 baseline s=500 run3", players: 100, places_paid: 15, buyin: 50, rake: 11, roi: 10, number: 1000, bankroll: 1000, samples:  500, note: "third call — 3-way spread", _bustCache: 3 },
  { cat: "C", name: "C4 baseline s=10000  ", players: 100, places_paid: 15, buyin: 50, rake: 11, roi: 10, number: 1000, bankroll: 1000, samples: 10000, note: "high sample — test server limit / latency" },
  { cat: "C", name: "C5 baseline s=50000  ", players: 100, places_paid: 15, buyin: 50, rake: 11, roi: 10, number: 1000, bankroll: 1000, samples: 50000, note: "very high sample — does server accept?" },

  // ========== D: degenerate / numerical edges ==========
  { cat: "D", name: "D1 ROI=0 exact  ", players: 100, places_paid: 15, buyin: 50, rake: 10, roi: 0,   number: 1000, bankroll: 1000, samples: 2000, note: "break-even — check math SD non-zero" },
  { cat: "D", name: "D2 ROI=-99%     ", players: 100, places_paid: 15, buyin: 50, rake: 10, roi: -99, number: 1000, bankroll: 1000, samples: 2000, note: "near-total loser — itm≈0, almost all samples ruin" },
  { cat: "D", name: "D3 ROI=-100%    ", players: 100, places_paid: 15, buyin: 50, rake: 10, roi: -100,number: 1000, bankroll: 1000, samples: 2000, note: "itm=0 exactly — does their math divide-by-zero?" },
  { cat: "D", name: "D4 N=1 single   ", players: 100, places_paid: 15, buyin: 50, rake: 11, roi: 10,  number: 1,    bankroll: 1000, samples: 2000, note: "single tourney — SD should equal per-tourney SD" },
  { cat: "D", name: "D5 N=20000 long ", players: 100, places_paid: 15, buyin: 50, rake: 11, roi: 10,  number: 20000, bankroll: 1000, samples: 1000, note: "20k tourneys — their server seems to choke beyond this" },
  { cat: "D", name: "D6 buyin=$0.01  ", players: 100, places_paid: 15, buyin: 0.01, rake: 11, roi: 10, number: 1000, bankroll: 10, samples: 2000, note: "micro buyin — numerical precision test" },
  { cat: "D", name: "D7 buyin=$100k  ", players: 100, places_paid: 15, buyin: 100000, rake: 11, roi: 10, number: 100, bankroll: 5000000, samples: 2000, note: "huge buyin — scaling test" },
  { cat: "D", name: "D8 500p paid=40 ", players: 500, places_paid: 40, buyin: 10, rake: 10, roi: 10, number: 1000, bankroll: 300, samples: 2000, note: "tight ITM 8% (not the usual 15%)" },

  // ========== E: dropdown boundary ==========
  { cat: "E", name: "E1 10p paid=10  ", players: 10, places_paid: 10, buyin: 10, rake: 10, roi: 10, number: 1000, bankroll: 100, samples: 2000, note: "everyone paid — itm=1.1 unless they clamp" },

  // ========== G: running-min / RoR behavior ==========
  { cat: "G", name: "G1 tight BR     ", players: 100, places_paid: 15, buyin: 50, rake: 11, roi: 10, number: 1000, bankroll: 100, samples: 2000, note: "bankroll=2 buyins, +10% ROI — should ruin often even as winner" },
  { cat: "G", name: "G2 huge BR      ", players: 100, places_paid: 15, buyin: 50, rake: 11, roi: 10, number: 1000, bankroll: 100000, samples: 2000, note: "200 buyins — near-zero ruin" },
  { cat: "G", name: "G3 winner ruin  ", players: 100, places_paid: 15, buyin: 50, rake: 11, roi: 20, number: 1000, bankroll: 200, samples: 2000, note: "+20% ROI, 4 buyins — how often does winner still bust?" },

  // ========== H: rake edges ==========
  { cat: "H", name: "H1 rake=0%      ", players: 100, places_paid: 15, buyin: 50, rake: 0,  roi: 10, number: 1000, bankroll: 1000, samples: 2000, note: "no rake — pure skill premium" },
  { cat: "H", name: "H2 rake=50%     ", players: 100, places_paid: 15, buyin: 50, rake: 50, roi: 10, number: 1000, bankroll: 1000, samples: 2000, note: "half rake — does EV formula still use buyin only?" },
  { cat: "H", name: "H3 rake=100%    ", players: 100, places_paid: 15, buyin: 50, rake: 100,roi: 10, number: 1000, bankroll: 1000, samples: 2000, note: "all rake — degenerate" },
];

function cacheKey(sc) {
  const k = JSON.stringify([
    sc.players, sc.places_paid, sc.buyin, sc.rake, sc.roi,
    sc.number, sc.bankroll, sc.samples, sc._bustCache ?? 1,
  ]);
  return createHash("sha1").update(k).digest("hex").slice(0, 16);
}

async function fetchPD(sc) {
  const cacheFile = join(cacheDir, `${cacheKey(sc)}.json`);
  if (existsSync(cacheFile)) {
    try {
      const j = JSON.parse(readFileSync(cacheFile, "utf-8"));
      return { json: j, cached: true };
    } catch {}
  }
  const kv = [
    `num_tournaments=1`,
    `samples=${sc.samples}`,
    `bankroll=${sc.bankroll}`,
    `showConfidenceIntervals=true`,
    `players0=${sc.players}`,
    `places_paid0=${sc.places_paid}`,
    `buyin0=${sc.buyin}`,
    `rake0=${sc.rake}`,
    `roi0=${sc.roi}`,
    `number0=${sc.number}`,
  ].join(" ");
  const url =
    "https://www.primedope.com/prime.php?p=tournament-variance-calculator&sub_routine=calc&args=" +
    encodeURIComponent(kv).replace(/%20/g, " ");
  await new Promise((r) => setTimeout(r, DELAY_MS));
  let res, text;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 pd-probe-script" },
    });
    text = await res.text();
  } catch (e) {
    return { json: null, cached: false, err: `fetch failed: ${e.message}` };
  }
  if (!res.ok) {
    return { json: null, cached: false, err: `HTTP ${res.status}`, raw: text.slice(0, 300) };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { json: null, cached: false, err: "invalid JSON", raw: text.slice(0, 400) };
  }
  writeFileSync(cacheFile, JSON.stringify(parsed, null, 2));
  return { json: parsed, cached: false };
}

const money = (n) => {
  if (n == null || Number.isNaN(n)) return "—";
  const s = Math.abs(n) >= 10000 ? n.toFixed(0) : n.toFixed(1);
  return (n < 0 ? "-$" : "$") + Math.abs(+s).toLocaleString("en-US");
};
const pct = (n) => (n == null ? "—" : (n * 100).toFixed(2) + "%");

async function main() {
  console.log("=".repeat(110));
  console.log("PokerDope weakness probe — live API, caching to scripts/pd_cache/");
  console.log("=".repeat(110));

  const results = [];
  let n = 0;
  const total = scenarios.length;
  const t0 = Date.now();

  for (const sc of scenarios) {
    n++;
    process.stdout.write(`[${String(n).padStart(2)}/${total}] ${sc.cat} ${sc.name} `);
    const r = await fetchPD(sc);
    if (r.err) {
      console.log(`  ERR: ${r.err}${r.raw ? " | " + r.raw.replace(/\s+/g, " ") : ""}`);
      results.push({ sc, err: r.err, raw: r.raw });
      continue;
    }
    const j = r.json;
    const tag = r.cached ? "(cache)" : "(live) ";
    console.log(
      `${tag}  EV ${money(j.ev).padStart(12)}  SDmath ${money(j.sd).padStart(11)}  SDsim ${money(j.sdSimulated).padStart(11)}  RoR ${pct(j.riskOfRuin).padStart(7)}`,
    );
    results.push({ sc, json: j });
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log();
  console.log(`Done in ${elapsed}s (${results.filter((r) => !r.err).length}/${total} ok).`);

  // ------------- analysis pass -------------
  const findings = [];

  const summarize = (r) => {
    const { sc, json, err } = r;
    if (err) return null;
    return {
      cat: sc.cat,
      name: sc.name.trim(),
      inputs: {
        players: sc.players, places_paid: sc.places_paid, buyin: sc.buyin,
        rake: sc.rake, roi: sc.roi, number: sc.number, bankroll: sc.bankroll,
        samples: sc.samples,
      },
      note: sc.note,
      ev: json.ev,
      sd: json.sd,
      evSim: json.evSimulated,
      sdSim: json.sdSimulated,
      sdRatio: json.sd > 0 ? json.sdSimulated / json.sd : null,
      riskOfRuin: json.riskOfRuin,
      min50: -json.min50percentile,
      min15: -json.min15percentile,
      min05: -json.min05percentile,
      min01: -json.min01percentile,
      probLoss: json.probLoss,
      conf70: json.conf70,
      conf95: json.conf95,
      conf997: json.conf997,
      sumBuyins: json.sumBuyins,
      // derived: EV/sumBuyins (observed ROI baseline)
      evRoi: json.sumBuyins > 0 ? json.ev / json.sumBuyins : null,
      neverBelowZero: json.neverBelowZero,
      samplesize: json.samplesize,
    };
  };

  const rows = results.map(summarize).filter(Boolean);
  const byCat = (c) => rows.filter((r) => r.cat === c);

  // Finding 1: ITM overflow behavior
  const A = byCat("A");
  if (A.length) {
    findings.push({
      key: "A",
      title: "ITM-формула ломается при ROI выше порога",
      detail: A.map((r) => ({
        scenario: r.name,
        itmTheoretical: (1 + r.inputs.roi / 100) * r.inputs.places_paid / r.inputs.players,
        ev: r.ev,
        sd: r.sd,
        evRoi: r.evRoi,
      })),
    });
  }

  // Finding 2: SD math vs sim (do they agree internally?)
  findings.push({
    key: "math_vs_sim",
    title: "SD (math) vs SD (simulated) — internal consistency",
    detail: rows
      .filter((r) => r.sd && r.sdSim)
      .map((r) => ({ name: r.name, sd: r.sd, sdSim: r.sdSim, ratio: r.sdRatio })),
  });

  // Finding 3: reproducibility (category C runs 1-3)
  const reproRuns = rows.filter((r) => r.name.startsWith("C1") || r.name.startsWith("C2") || r.name.startsWith("C3"));
  if (reproRuns.length >= 2) {
    const min01Values = reproRuns.map((r) => r.min01);
    const spread = Math.max(...min01Values) - Math.min(...min01Values);
    const mean = min01Values.reduce((a, b) => a + b, 0) / min01Values.length;
    findings.push({
      key: "repro",
      title: "RoR percentile reproducibility (identical inputs, 3 runs)",
      detail: {
        runs: reproRuns.map((r) => ({ name: r.name, min01: r.min01, min05: r.min05, min15: r.min15, ror: r.riskOfRuin })),
        min01Spread: spread,
        min01Mean: mean,
        min01RelSpread: mean > 0 ? spread / mean : null,
      },
    });
  }

  // Finding 4: degenerate cases
  findings.push({
    key: "degenerate",
    title: "Degenerate inputs (break-even, -100% ROI, N=1, extreme buyins)",
    detail: byCat("D").map((r) => ({
      name: r.name,
      note: r.note,
      ev: r.ev, sd: r.sd, riskOfRuin: r.riskOfRuin, probLoss: r.probLoss,
    })),
  });

  // Write final report
  const reportPath = join(here, "pd_probe_report.json");
  writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), results: rows, findings }, null, 2));
  console.log(`Report written to ${reportPath}`);

  console.log();
  console.log("=".repeat(110));
  console.log("KEY FINDINGS SNAPSHOT");
  console.log("=".repeat(110));

  // ITM overflow table
  if (A.length) {
    console.log("\nA. ITM overflow at high ROI:");
    console.log("   scenario             theoretical_itm   PD_ev      PD_sd     observed_roi");
    for (const r of A) {
      const itm = (1 + r.inputs.roi / 100) * r.inputs.places_paid / r.inputs.players;
      console.log(
        `   ${r.name.padEnd(20)} ${itm.toFixed(4).padStart(15)}   ${money(r.ev).padStart(9)}  ${money(r.sd).padStart(9)}  ${(r.evRoi == null ? "—" : (r.evRoi * 100).toFixed(2) + "%").padStart(8)}`,
      );
    }
  }

  // Repro
  if (reproRuns.length >= 2) {
    console.log("\nC. Reproducibility of min01 (1%-ile bankroll needed) across 3 identical calls:");
    for (const r of reproRuns) {
      console.log(`   ${r.name.padEnd(24)} min01 ${money(r.min01).padStart(10)}  min05 ${money(r.min05).padStart(10)}  min15 ${money(r.min15).padStart(10)}  RoR ${pct(r.riskOfRuin)}`);
    }
    const vals = reproRuns.map((r) => r.min01);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const spread = Math.max(...vals) - Math.min(...vals);
    console.log(`   → spread ${money(spread)} on mean ${money(mean)} = ${mean > 0 ? ((spread / mean) * 100).toFixed(1) : "—"}% MC jitter in their reported ruin threshold`);
  }

  // D - degenerates
  const D = byCat("D");
  if (D.length) {
    console.log("\nD. Degenerate / edge inputs:");
    for (const r of D) {
      console.log(`   ${r.name.padEnd(20)}  EV ${money(r.ev).padStart(14)}  SD ${money(r.sd).padStart(14)}  RoR ${pct(r.riskOfRuin).padStart(7)}  probLoss ${pct(r.probLoss).padStart(7)}`);
    }
  }

  // B - field size top-heavy
  const B = byCat("B");
  if (B.length) {
    console.log("\nB. Top-heaviness (uniform-within-band assumption):");
    for (const r of B) {
      console.log(`   ${r.name.padEnd(20)}  EV ${money(r.ev).padStart(14)}  SDmath ${money(r.sd).padStart(14)}  conf95 [${money(r.conf95?.[0])}, ${money(r.conf95?.[1])}]`);
    }
  }

  // H rake
  const H = byCat("H");
  if (H.length) {
    console.log("\nH. Rake edges (does EV still use buyin-only or does it flip?):");
    for (const r of H) {
      console.log(`   ${r.name.padEnd(20)}  EV ${money(r.ev).padStart(14)}  SD ${money(r.sd).padStart(14)}`);
    }
  }

  console.log();
  console.log("=".repeat(110));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
