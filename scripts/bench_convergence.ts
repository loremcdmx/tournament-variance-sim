/**
 * Convergence bench — precomputes the ROI 90% band across a sweep of field
 * sizes at a fixed schedule length (N tournaments). Output lands in
 * public/bench/convergence.json so BenchConvergenceCard can cross-check our
 * engine's variance vs PrimeDope's calibration.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runSimulation } from "../src/lib/sim/engine";
import type { SimulationInput, SimulationResult, TournamentRow } from "../src/lib/sim/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..");

// Fixed buy-in/fee/ROI; field size varies per row.
const REFERENCE = {
  buyIn: 50,
  fee: 5.5,
  rake: 5.5 / 55,
  roi: 0.10,
};

const FIELDS = [25, 50, 100, 200, 500, 1000, 2000, 5000, 10000] as const;
const N_TOURNEYS = Number(process.env.BENCH_N) || 1000;
const SAMPLES = Number(process.env.BENCH_SAMPLES) || 20_000;
const FORCE = !!process.env.BENCH_FORCE;

function srcHash(): string {
  const h = createHash("sha256");
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      const p = join(dir, entry);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts")) {
        h.update(entry);
        h.update(readFileSync(p));
      }
    }
  };
  walk(join(repoRoot, "src", "lib", "sim"));
  return h.digest("hex").slice(0, 16);
}

function buildInput(
  mode: "alpha" | "primedope-binary-itm",
  players: number,
): SimulationInput {
  const row: TournamentRow = {
    id: "bench-ref",
    label: "Reference",
    players,
    buyIn: REFERENCE.buyIn,
    rake: REFERENCE.rake,
    roi: REFERENCE.roi,
    payoutStructure: "mtt-standard",
    count: N_TOURNEYS,
  };
  return {
    schedule: [row],
    scheduleRepeats: 1,
    samples: SAMPLES,
    bankroll: 0,
    seed: 42,
    finishModel: { id: "power-law" },
    calibrationMode: mode,
    // The bench exists specifically to cross-check our σ against PD's own
    // reference numbers — those numbers assume PD's native payout curve,
    // so the binary-ITM pass opts into it explicitly. Outside this file the
    // engine default is OFF (honour the user's selected payout).
    usePrimedopePayouts: mode === "primedope-binary-itm",
  };
}

function bandAtEnd(r: SimulationResult) {
  const last = r.envelopes.x.length - 1;
  const basis = r.totalBuyIn;
  return {
    p5: r.envelopes.p05[last] / basis,
    p50: r.envelopes.mean[last] / basis,
    p95: r.envelopes.p95[last] / basis,
  };
}

async function main() {
  const hash = srcHash();
  const outPath = join(repoRoot, "public", "bench", "convergence.json");
  try {
    const existing = JSON.parse(readFileSync(outPath, "utf8"));
    if (
      !FORCE &&
      existing.srcHash === hash &&
      existing.version === 2 &&
      existing.nTourneys === N_TOURNEYS &&
      (existing.samples ?? 0) >= SAMPLES &&
      Array.isArray(existing.points) &&
      existing.points.length === FIELDS.length
    ) {
      console.log(`convergence.json up to date (srcHash=${hash}) — skipping`);
      return;
    }
  } catch {
    /* no existing file — run */
  }

  const t0 = Date.now();
  console.log(
    `bench start: srcHash=${hash}, N=${N_TOURNEYS}, samples=${SAMPLES}\n` +
    `  fields: ${FIELDS.join(",")}`,
  );

  const points: Array<{
    players: number;
    tourneys: number;
    ours: { p5: number; p50: number; p95: number };
    pd: { p5: number; p50: number; p95: number };
  }> = [];

  for (const players of FIELDS) {
    const t = Date.now();
    const ours = runSimulation(buildInput("alpha", players));
    const pd = runSimulation(buildInput("primedope-binary-itm", players));
    points.push({
      players,
      tourneys: N_TOURNEYS,
      ours: bandAtEnd(ours),
      pd: bandAtEnd(pd),
    });
    console.log(`  ${players}p done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }

  const out = {
    version: 2,
    srcHash: hash,
    generatedAt: new Date().toISOString(),
    reference: REFERENCE,
    nTourneys: N_TOURNEYS,
    samples: SAMPLES,
    xAxis: "fieldSize",
    points,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(
    `wrote ${outPath} in ${((Date.now() - t0) / 1000).toFixed(1)}s total`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
