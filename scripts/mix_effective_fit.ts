/**
 * Mix σ_ROI = sqrt(p·σ²_pko + (1−p)·σ²_freeze) is NOT a clean power law —
 * it's a sum of two power laws with different exponents. Fit an effective
 * C·field^β over [50, 50k] for common mix ratios × ROIs to report.
 *
 *   npx tsx scripts/mix_effective_fit.ts
 */

const FREEZE = { C0: 0.6564, C1: 0, beta: 0.3694 };
const PKO = { C0: 0.6265, C1: 0.4961, beta: 0.2763 };

const FIELDS = [
  50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500,
  10_000, 15_000, 25_000, 50_000,
];

function sigmaMix(afs: number, roi: number, p: number): number {
  const sigmaF = Math.max(0, FREEZE.C0 + FREEZE.C1 * roi) * Math.pow(afs, FREEZE.beta);
  const sigmaP = Math.max(0, PKO.C0 + PKO.C1 * roi) * Math.pow(afs, PKO.beta);
  return Math.sqrt(p * sigmaP * sigmaP + (1 - p) * sigmaF * sigmaF);
}

function fit(roi: number, p: number) {
  const xs = FIELDS.map((f) => Math.log(f));
  const ys = FIELDS.map((f) => Math.log(sigmaMix(f, roi, p)));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const beta = num / den;
  const C = Math.exp(my - beta * mx);
  let sr = 0;
  let st = 0;
  for (let i = 0; i < n; i++) {
    const pred = (my - beta * mx) + beta * xs[i];
    sr += (ys[i] - pred) ** 2;
    st += (ys[i] - my) ** 2;
  }
  return { C, beta, r2: 1 - sr / st };
}

const ROIS = [-0.1, 0, 0.1, 0.2, 0.4];
const MIXES = [0, 0.3, 0.4, 0.5, 0.6, 0.7, 1];

console.log("Effective σ_ROI = C · field^β fit over field ∈ [50, 50 000].");
console.log("(mix is a sum of two power laws — fit is approximate, R² drops in 30..70 %)");
console.log("");
console.log(
  "  ROI    pkoShare    C        β       R²      σ(1k)    σ(10k)",
);
console.log(
  "  ─────  ──────────  ───────  ──────  ──────  ───────  ───────",
);
for (const roi of ROIS) {
  for (const p of MIXES) {
    const f = fit(roi, p);
    const s1k = sigmaMix(1000, roi, p);
    const s10k = sigmaMix(10_000, roi, p);
    const label =
      p === 0 ? "freeze" : p === 1 ? "pko   " : `mix ${(p * 100).toFixed(0).padStart(2)}%`;
    console.log(
      `  ${((roi * 100) | 0).toString().padStart(4)}%  ${label}      ${f.C.toFixed(4)}   ${f.beta.toFixed(4)}  ${f.r2.toFixed(4)}  ${s1k.toFixed(3).padStart(6)}   ${s10k.toFixed(2).padStart(6)}`,
    );
  }
  console.log("");
}
