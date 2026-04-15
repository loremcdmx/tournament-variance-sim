import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Experimental fit-quality harness for the freeze cash-zone shape against
 * the 2026-04 real-data histogram. Not plugged into the engine — it
 * evaluates three candidate model families and prints metrics so we can
 * pick which one to integrate into production.
 *
 *   A. Pure power-law p_i ∝ i^(-α), grid-search α.
 *   B. Empirical identity — real-data buckets used as-is (ground truth).
 *   C. Real-data shape × power-law tilt (1 - x/100)^(-α_tilt) — preserves
 *      data fidelity at α_tilt=0, gives a knob for ROI adjustment.
 *
 * Data loaded from data/finish-shapes/freeze-cash.json (cash-conditional,
 * 32 buckets from x=84.5 to x=100, width 0.5%).
 */

interface Bucket {
  x: number;
  density: number;
}

const DATA = JSON.parse(
  readFileSync(
    join(process.cwd(), "data", "finish-shapes", "freeze-cash.json"),
    "utf8",
  ),
);

const REALDATA: Bucket[] = DATA.buckets_cash_conditional;
const CUT_X: number = DATA.cash_cutoff_x; // 84.5

function rmse(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s / a.length);
}

function l1(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s;
}

interface Kpis {
  winnerMass: number; // mass in bucket x=100
  top2pctMass: number; // mass in x ∈ [98, 100] (4 buckets = top 2% of field)
  rampRatio: number; // density(x=100) / density(x=84.5)
}

function kpis(bs: Bucket[]): Kpis {
  const winner = bs[bs.length - 1].density;
  const first = bs[0].density;
  const top2 = bs.filter((b) => b.x >= 98).reduce((s, b) => s + b.density, 0);
  return { winnerMass: winner, top2pctMass: top2, rampRatio: winner / first };
}

function densities(bs: Bucket[]): number[] {
  return bs.map((b) => b.density);
}

// Bin a per-place density function into the 32 real-data cash-zone buckets.
// Place i (1-indexed) maps to x_i = (N - i + 1) / N * 100.
// Bucket labeled x covers place_pct ∈ (x − 0.5, x].
function binToRealData(
  placeDensity: (i: number) => number,
  N: number,
): Bucket[] {
  const out = REALDATA.map((b) => ({ x: b.x, density: 0 }));
  // Lowest bucket (x=84.5) covers v ∈ (84.0, 84.5]. Places whose v rounds
  // up into the 84.5 bucket have v ∈ (84.0, 84.5]. Break only when v has
  // dropped below that range entirely.
  const vFloor = CUT_X - 0.5;
  for (let i = 1; i <= N; i++) {
    const v = ((N - i + 1) / N) * 100;
    if (v <= vFloor + 1e-9) break;
    const bx = Math.ceil(v * 2) / 2;
    const idx = out.findIndex((b) => Math.abs(b.x - bx) < 1e-9);
    if (idx >= 0) out[idx].density += placeDensity(i);
  }
  const total = out.reduce((s, b) => s + b.density, 0);
  return out.map((b) => ({
    x: b.x,
    density: total > 0 ? b.density / total : 0,
  }));
}

// ---- Model A: pure power-law ----
function modelA(alpha: number, N = 1000): Bucket[] {
  return binToRealData((i) => Math.pow(i, -alpha), N);
}

// ---- Model B: empirical identity ----
function modelB(): Bucket[] {
  return REALDATA.map((b) => ({ ...b }));
}

// ---- Model C: real-data × (1 - x/100)^(-α_tilt) ----
// Use left edge of bucket for u so x=100 bucket (u ∈ [0, 0.005]) stays finite.
function modelC(alphaTilt: number): Bucket[] {
  const out = REALDATA.map((b) => {
    const u = 1 - (b.x - 0.25) / 100; // left-edge u = 1 - (x - 0.25)/100
    const tilt = Math.pow(Math.max(u, 1e-4), -alphaTilt);
    return { x: b.x, density: b.density * tilt };
  });
  const total = out.reduce((s, b) => s + b.density, 0);
  return out.map((b) => ({ x: b.x, density: b.density / total }));
}

function gridSearch(
  build: (alpha: number) => Bucket[],
  lo: number,
  hi: number,
  step: number,
): { alpha: number; rmse: number } {
  const target = densities(REALDATA);
  let best = { alpha: lo, rmse: Infinity };
  for (let a = lo; a <= hi + 1e-9; a += step) {
    const r = rmse(densities(build(a)), target);
    if (r < best.rmse) best = { alpha: a, rmse: r };
  }
  return best;
}

describe("freeze cash-zone shape fit (experimental, 3 models)", () => {
  const realK = kpis(REALDATA);
  console.log("\n── real-data ground truth KPIs ──");
  console.log(
    `  winner_mass=${realK.winnerMass.toFixed(5)}  top2pct_mass=${realK.top2pctMass.toFixed(4)}  ramp_ratio=${realK.rampRatio.toFixed(3)}`,
  );
  console.log(
    `  (cash-conditional, 32 buckets, sum=${densities(REALDATA).reduce((s, v) => s + v, 0).toFixed(6)})`,
  );

  it("Model A: pure power-law grid-search", () => {
    const best = gridSearch(modelA, -1, 3, 0.001);
    const fit = modelA(best.alpha);
    const k = kpis(fit);
    const tgt = densities(REALDATA);
    const cur = densities(fit);
    console.log("\n── Model A: pure power-law ──");
    console.log(
      `  best α = ${best.alpha.toFixed(3)}   RMSE = ${best.rmse.toFixed(5)}   L1 = ${l1(cur, tgt).toFixed(4)}`,
    );
    console.log(
      `  winner_mass=${k.winnerMass.toFixed(5)} (Δ${((k.winnerMass / realK.winnerMass - 1) * 100).toFixed(1)}%)  top2=${k.top2pctMass.toFixed(4)} (Δ${((k.top2pctMass / realK.top2pctMass - 1) * 100).toFixed(1)}%)  ramp=${k.rampRatio.toFixed(3)} (real ${realK.rampRatio.toFixed(3)})`,
    );
    // Side-by-side on 6 checkpoints
    const checkX = [84.5, 88, 92, 96, 99.5, 100];
    console.log("    x      real      modelA    Δ");
    for (const x of checkX) {
      const ab = REALDATA.find((b) => b.x === x);
      const fb = fit.find((b) => b.x === x);
      if (ab && fb) {
        const delta = ((fb.density - ab.density) / ab.density) * 100;
        console.log(
          `  ${x.toFixed(1).padStart(5)}  ${ab.density.toFixed(5)}  ${fb.density.toFixed(5)}  ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`,
        );
      }
    }
    expect(best.rmse).toBeLessThan(0.01);
  });

  it("Model B: empirical identity", () => {
    const fit = modelB();
    const k = kpis(fit);
    const r = rmse(densities(fit), densities(REALDATA));
    console.log("\n── Model B: empirical identity ──");
    console.log(
      `  RMSE = ${r.toFixed(8)} (trivially 0)   mass=${densities(fit).reduce((s, v) => s + v, 0).toFixed(6)}`,
    );
    console.log(
      `  winner_mass=${k.winnerMass.toFixed(5)}  top2=${k.top2pctMass.toFixed(4)}  ramp=${k.rampRatio.toFixed(3)}`,
    );
    expect(r).toBeLessThan(1e-12);
  });

  it("Model C: real-data × power-law tilt", () => {
    const best = gridSearch(modelC, -0.5, 0.5, 0.001);
    console.log("\n── Model C: real-data × (1-x/100)^(-α_tilt) ──");
    console.log(
      `  best α_tilt (vs real-data) = ${best.alpha.toFixed(3)}   RMSE = ${best.rmse.toFixed(6)} (should ≈ 0)`,
    );
    console.log("  α_tilt sensitivity (RMSE vs real-data + KPI shifts):");
    console.log(
      "     α_tilt    RMSE     winner_mass  Δwin%    top2     Δtop2%   ramp",
    );
    for (const t of [-0.5, -0.25, -0.1, 0, 0.1, 0.25, 0.5]) {
      const m = modelC(t);
      const k = kpis(m);
      const r = rmse(densities(m), densities(REALDATA));
      console.log(
        `    ${t.toFixed(3).padStart(6)}   ${r.toFixed(5)}   ${k.winnerMass.toFixed(5)}    ${((k.winnerMass / realK.winnerMass - 1) * 100).toFixed(1).padStart(5)}%  ${k.top2pctMass.toFixed(4)}   ${((k.top2pctMass / realK.top2pctMass - 1) * 100).toFixed(1).padStart(5)}%   ${k.rampRatio.toFixed(3)}`,
      );
    }
    expect(Math.abs(best.alpha)).toBeLessThan(0.01);
  });

  it("head-to-head: bucket-wise max error for each model", () => {
    const a = gridSearch(modelA, -1, 3, 0.001);
    const fitA = modelA(a.alpha);
    const fitB = modelB();
    const fitC = modelC(0);
    const tgt = densities(REALDATA);
    const maxErr = (bs: Bucket[]): { x: number; delta: number } => {
      let worst = { x: 0, delta: 0 };
      for (let i = 0; i < bs.length; i++) {
        const d = Math.abs(bs[i].density - tgt[i]);
        if (d > Math.abs(worst.delta))
          worst = { x: bs[i].x, delta: bs[i].density - tgt[i] };
      }
      return worst;
    };
    const mA = maxErr(fitA);
    const mB = maxErr(fitB);
    const mC = maxErr(fitC);
    console.log("\n── Head-to-head bucket max error ──");
    console.log(
      `  A (power-law α=${a.alpha.toFixed(3)}): max |Δ| = ${Math.abs(mA.delta).toFixed(5)} at x=${mA.x}  (${((mA.delta / tgt[fitA.findIndex((b) => b.x === mA.x)]) * 100).toFixed(1)}% of bucket)`,
    );
    console.log(
      `  B (empirical):                        max |Δ| = ${Math.abs(mB.delta).toFixed(8)}`,
    );
    console.log(
      `  C (real-data × tilt=0):               max |Δ| = ${Math.abs(mC.delta).toFixed(8)}`,
    );
    console.log(
      `\n  RMSE ranking:  B = ${rmse(densities(fitB), tgt).toFixed(8)}  <  C = ${rmse(densities(fitC), tgt).toFixed(8)}  <  A = ${a.rmse.toFixed(5)}`,
    );
  });
});
