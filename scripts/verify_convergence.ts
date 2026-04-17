/**
 * Reproduces the σ_ROI / convergence row formula from ConvergenceChart.tsx
 * outside of React, so we can confirm the math moves when any slider moves.
 *
 *   npx tsx scripts/verify_convergence.ts
 */

const SIGMA_ROI_FREEZE = { C0: 0.6564, C1: 0, beta: 0.3694 };
const SIGMA_ROI_PKO = { C0: 0.6265, C1: 0.4961, beta: 0.2763 };

function inverseErf(x: number): number {
  const a = 0.147;
  const ln1 = Math.log(1 - x * x);
  const t = 2 / (Math.PI * a) + ln1 / 2;
  const sign = x >= 0 ? 1 : -1;
  return sign * Math.sqrt(Math.sqrt(t * t - ln1 / a) - t);
}
function ciToZ(ciFrac: number): number {
  const c = Math.max(0, Math.min(0.999999, ciFrac));
  return Math.SQRT2 * inverseErf(c);
}

function rowFor(
  afs: number,
  roi: number,
  pkoMix: number,
  ciFrac: number,
  target: number,
) {
  const z = ciToZ(ciFrac);
  const sigmaFor = (c: typeof SIGMA_ROI_FREEZE) =>
    Math.max(0, c.C0 + c.C1 * roi) * Math.pow(Math.max(1, afs), c.beta);
  const sigmaFreeze = sigmaFor(SIGMA_ROI_FREEZE);
  const sigmaPko = sigmaFor(SIGMA_ROI_PKO);
  const p = Math.max(0, Math.min(1, pkoMix));
  const sigmaRoi = Math.sqrt(
    p * sigmaPko * sigmaPko + (1 - p) * sigmaFreeze * sigmaFreeze,
  );
  const k = Math.ceil(Math.pow((z * sigmaRoi) / target, 2));
  return { sigmaFreeze, sigmaPko, sigmaRoi, k, fields: k / Math.max(1, afs) };
}

function walk(label: string, get: (x: number) => ReturnType<typeof rowFor>) {
  console.log(`\n==== ${label} ====`);
  for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    const r = get(x);
    console.log(
      `  x=${x.toFixed(2)}  σf=${r.sigmaFreeze.toFixed(3)}  σp=${r.sigmaPko.toFixed(3)}  σ=${r.sigmaRoi.toFixed(3)}  k=${r.k.toLocaleString()}  fields=${r.fields.toFixed(1)}`,
    );
  }
}

const AFS_LOG_MIN = Math.log(50);
const AFS_LOG_MAX = Math.log(50_000);
const posToAfs = (p: number) =>
  Math.exp(AFS_LOG_MIN + (AFS_LOG_MAX - AFS_LOG_MIN) * p);

// Fix all but the tested slider; target=±2 %, 95 % CI.
const CI = 0.95;
const TARGET = 0.02;
const AFS_BASE = 1000;
const ROI_BASE = 0.1;

console.log("baseline: target=±2%, CI=95%, AFS=1000, ROI=+10%");
console.log(`  freeze: σ=${rowFor(AFS_BASE, ROI_BASE, 0, CI, TARGET).sigmaRoi.toFixed(3)}`);
console.log(`  pko:    σ=${rowFor(AFS_BASE, ROI_BASE, 1, CI, TARGET).sigmaRoi.toFixed(3)}`);
console.log(`  mix60:  σ=${rowFor(AFS_BASE, ROI_BASE, 0.6, CI, TARGET).sigmaRoi.toFixed(3)}`);

// Test 1: walk AFS across [0.1 .. 0.9] slider pos, for freeze / pko / mix-60.
walk("FREEZE — AFS slider sweep", (x) =>
  rowFor(posToAfs(x), ROI_BASE, 0, CI, TARGET),
);
walk("PKO — AFS slider sweep", (x) =>
  rowFor(posToAfs(x), ROI_BASE, 1, CI, TARGET),
);
walk("MIX 60/40 — AFS slider sweep", (x) =>
  rowFor(posToAfs(x), ROI_BASE, 0.6, CI, TARGET),
);

// Test 2: walk ROI slider for each format.
const ROI_RANGE = (x: number) => -0.3 + x * (1.0 - (-0.3));
walk("FREEZE — ROI slider sweep", (x) =>
  rowFor(AFS_BASE, ROI_RANGE(x), 0, CI, TARGET),
);
walk("PKO — ROI slider sweep", (x) =>
  rowFor(AFS_BASE, ROI_RANGE(x), 1, CI, TARGET),
);
walk("MIX 60/40 — ROI slider sweep", (x) =>
  rowFor(AFS_BASE, ROI_RANGE(x), 0.6, CI, TARGET),
);

// Test 3: walk mix slider with AFS / ROI fixed.
walk("MIX slider sweep (AFS=1000 ROI=+10%)", (x) =>
  rowFor(AFS_BASE, ROI_BASE, x, CI, TARGET),
);

// Test 4: walk CI.
walk("CI slider sweep (AFS=1000 ROI=+10% mix=0.6)", (x) =>
  rowFor(AFS_BASE, ROI_BASE, 0.6, 0.9 + x * 0.099, TARGET),
);
