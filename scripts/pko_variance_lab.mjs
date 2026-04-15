// PKO variance lab: baseline vs variants C (lognormal head), D (latent heat),
// E (NegBin KO count), and combos. Standalone — no project imports.
//
// Mirrors engine.ts bounty construction: harmonic bountyKmean, cumulative-cash
// raw per-place bounty, normalized so Σ pmf·bbp = bountyMean (ROI-preserving).
// Runs M Monte Carlo draws per variant and prints σ uplift vs baseline.
//
// Run: node scripts/pko_variance_lab.mjs

const N = parseInt(process.env.N ?? "500", 10);
const buyIn = parseFloat(process.env.BUYIN ?? "100");
const rake = parseFloat(process.env.RAKE ?? "0.1");
const bountyFraction = parseFloat(process.env.BF ?? "0.5");
const roi = parseFloat(process.env.ROI ?? "0.2");
const paidCount = Math.floor(N * parseFloat(process.env.ITM ?? "0.15"));
const M = parseInt(process.env.M ?? "80000", 10);

const basePool = N * buyIn;
const bountyPerSeat = buyIn * bountyFraction;
const bountyMean = bountyPerSeat * (1 + roi);
const prizePool = basePool * (1 - bountyFraction);
const entryCost = buyIn * (1 + rake);
const targetRegular = Math.max(0.01, entryCost * (1 + roi) - bountyMean);

// --- Payouts: geometric top-heavy among paid places, sum to 1 -----------
const payouts = new Float64Array(N);
{
  const decay = 0.92;
  let s = 0;
  for (let i = 0; i < paidCount; i++) {
    payouts[i] = Math.pow(decay, i);
    s += payouts[i];
  }
  for (let i = 0; i < paidCount; i++) payouts[i] /= s;
}
const prizeByPlace = new Float64Array(N);
for (let i = 0; i < paidCount; i++) prizeByPlace[i] = payouts[i] * prizePool;

// --- Power-law finish pmf -----------------------------------------------
function buildPmf(alpha) {
  const w = new Float64Array(N);
  let s = 0;
  for (let i = 0; i < N; i++) {
    w[i] = Math.pow(N - i, alpha);
    s += w[i];
  }
  for (let i = 0; i < N; i++) w[i] /= s;
  return w;
}
function ewPrize(p) {
  let e = 0;
  for (let i = 0; i < N; i++) e += p[i] * prizeByPlace[i];
  return e;
}
// Bisect alpha to hit targetRegular.
function calibrateAlpha(target) {
  let lo = -3, hi = 12;
  for (let it = 0; it < 80; it++) {
    const mid = (lo + hi) / 2;
    if (ewPrize(buildPmf(mid)) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
const alpha = calibrateAlpha(targetRegular);
const basePmf = buildPmf(alpha);

// --- Harmonic bountyKmean + cumulative-cash raw + ROI-normalized bbp ----
// opts: { rawPower?: number, deepBoost?: number, skipNormalize?: boolean }
function buildBounty(pmfLocal, opts = {}) {
  const Hprefix = new Float64Array(N);
  let h = 0;
  for (let k = 1; k < N; k++) {
    h += 1 / k;
    Hprefix[k] = h;
  }
  const bkm = new Float64Array(N);
  for (let i = 0; i < N; i++) bkm[i] = Hprefix[N - 1] - Hprefix[i];

  const cashAtBust = new Float64Array(N - 1);
  let T = N;
  for (let m = 1; m <= N - 1; m++) {
    const hh = T / (N - m + 1);
    const cash = hh / 2;
    cashAtBust[m - 1] = cash;
    T -= cash;
  }
  const Tfinal = T;
  const prefix = new Float64Array(N);
  let acc = 0;
  for (let m = 1; m <= N - 1; m++) {
    acc += cashAtBust[m - 1] / (N - m);
    prefix[m] = acc;
  }
  const raw = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const upto = N - (i + 1);
    raw[i] = upto > 0 ? prefix[upto] : 0;
  }
  raw[0] += Tfinal;

  // Variant F: reshape raw via power (p>1 = steeper, deep runs get more mass)
  if (opts.rawPower && opts.rawPower !== 1) {
    for (let i = 0; i < N; i++) raw[i] = Math.pow(raw[i], opts.rawPower);
  }
  // Variant G: linear deep-run boost (place 0 gets 1+boost, place N-1 gets 1)
  if (opts.deepBoost && opts.deepBoost > 0) {
    for (let i = 0; i < N; i++) {
      const depthFrac = (N - i - 1) / (N - 1);
      raw[i] *= 1 + opts.deepBoost * depthFrac;
    }
  }

  const bbp = new Float64Array(N);
  if (opts.skipNormalize) {
    // Variant A: no normalization — use raw × bountyPerSeat directly.
    // raw is in N-units where Σ raw = N for uniform pmf, so mean bounty
    // for uniform hero = bountyPerSeat. Skilled hero will over-collect,
    // which is exactly what A exposes.
    for (let i = 0; i < N; i++) bbp[i] = raw[i] * bountyPerSeat;
  } else {
    let Z = 0;
    for (let i = 0; i < N; i++) Z += pmfLocal[i] * raw[i];
    if (Z > 1e-12) {
      const scale = bountyMean / Z;
      for (let i = 0; i < N; i++) bbp[i] = raw[i] * scale;
    }
  }
  return { bbp, bkm };
}
const { bbp: baseBbp, bkm: baseBkm } = buildBounty(basePmf);

// --- RNG + gauss + gamma + poisson --------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeGauss(rng) {
  let cache = null;
  return function () {
    if (cache !== null) {
      const v = cache;
      cache = null;
      return v;
    }
    let u1 = 0;
    while (u1 < 1e-12) u1 = rng();
    const u2 = rng();
    const r = Math.sqrt(-2 * Math.log(u1));
    const th = 2 * Math.PI * u2;
    cache = r * Math.sin(th);
    return r * Math.cos(th);
  };
}
// Knuth Poisson — adequate for our lam ≤ ln(500) ≈ 6.8
function poisson(lam, rng) {
  if (lam <= 0) return 0;
  const L = Math.exp(-lam);
  let k = 0,
    p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}
// Marsaglia-Tsang Gamma(shape, 1)
function gammaDraw(shape, rng, gauss) {
  if (shape < 1) {
    const g = gammaDraw(shape + 1, rng, gauss);
    return g * Math.pow(rng(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do {
      x = gauss();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

// --- Place drawer via inverse-CDF ---------------------------------------
function makePlaceDrawer(pmfLocal) {
  const cdf = new Float64Array(N);
  let acc = 0;
  for (let i = 0; i < N; i++) {
    acc += pmfLocal[i];
    cdf[i] = acc;
  }
  return function (u) {
    let lo = 0,
      hi = N - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < u) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
}
const baseDraw = makePlaceDrawer(basePmf);

// --- Heat bins for variant D (precomputed alpha-shifted banks) ----------
const HEAT_BINS = 13;
const HEAT_Z_RANGE = 3.0;
const HEAT_STEP = (2 * HEAT_Z_RANGE) / (HEAT_BINS - 1);
function buildHeatBank(gammaShift) {
  const bank = [];
  for (let i = 0; i < HEAT_BINS; i++) {
    const z = -HEAT_Z_RANGE + i * HEAT_STEP;
    const a = alpha + gammaShift * z;
    const pmf = buildPmf(a);
    const draw = makePlaceDrawer(pmf);
    const { bbp, bkm } = buildBounty(pmf);
    bank.push({ draw, bbp, bkm });
  }
  return bank;
}
function heatBinFor(z) {
  const zc = Math.max(-HEAT_Z_RANGE, Math.min(HEAT_Z_RANGE, z));
  return Math.round((zc + HEAT_Z_RANGE) / HEAT_STEP);
}

// --- Runner -------------------------------------------------------------
function runVariant(label, opts) {
  const rng = mulberry32(0xbeef ^ (opts.seed ?? 1));
  const gauss = makeGauss(rng);
  const heatBank = opts.latentGamma ? buildHeatBank(opts.latentGamma) : null;

  // If structural bounty-shape opts present, rebuild bbp/bkm for this variant.
  let localBbp = baseBbp;
  let localBkm = baseBkm;
  if (opts.rawPower || opts.deepBoost || opts.skipNormalize) {
    const b = buildBounty(basePmf, {
      rawPower: opts.rawPower,
      deepBoost: opts.deepBoost,
      skipNormalize: opts.skipNormalize,
    });
    localBbp = b.bbp;
    localBkm = b.bkm;
  }

  let sPnl = 0,
    s2Pnl = 0;
  let sB = 0,
    s2B = 0;
  let sPrize = 0;
  let deepRuns = 0;
  let maxPnl = -Infinity,
    minPnl = Infinity;

  for (let t = 0; t < M; t++) {
    let draw = baseDraw,
      bbp = localBbp,
      bkm = localBkm;
    if (heatBank) {
      const z = gauss();
      const h = heatBank[heatBinFor(z)];
      draw = h.draw;
      bbp = h.bbp;
      bkm = h.bkm;
    }
    const place = draw(rng());
    const prize = prizeByPlace[place];
    const mean = bbp[place];
    const lam = bkm[place];
    let bounty = 0;
    if (mean > 0 && lam > 0) {
      let k;
      if (opts.negBinR && isFinite(opts.negBinR)) {
        const lamPrime = gammaDraw(opts.negBinR, rng, gauss) * (lam / opts.negBinR);
        k = poisson(lamPrime, rng);
      } else {
        k = poisson(lam, rng);
      }
      bounty = (mean * k) / lam;
      if (opts.lognormalSigma && k > 0 && bounty > 0) {
        const sig = opts.lognormalSigma;
        const expM1 = Math.exp(sig * sig) - 1;
        const sigSum2 = Math.log1p(expM1 / k);
        const sigSum = Math.sqrt(sigSum2);
        bounty *= Math.exp(sigSum * gauss() - 0.5 * sigSum2);
      }
    } else if (mean > 0) {
      bounty = mean;
    }
    const payout = prize + bounty;
    const pnl = payout - entryCost;
    sPnl += pnl;
    s2Pnl += pnl * pnl;
    sB += bounty;
    s2B += bounty * bounty;
    sPrize += prize;
    if (place <= 4) deepRuns++;
    if (pnl > maxPnl) maxPnl = pnl;
    if (pnl < minPnl) minPnl = pnl;
  }

  const meanPnl = sPnl / M;
  const sdPnl = Math.sqrt(Math.max(0, s2Pnl / M - meanPnl * meanPnl));
  const meanB = sB / M;
  const sdB = Math.sqrt(Math.max(0, s2B / M - meanB * meanB));
  const meanPrize = sPrize / M;
  return {
    label,
    meanPnl,
    sdPnl,
    meanB,
    sdB,
    meanPrize,
    deepRunFrac: deepRuns / M,
    maxPnl,
    minPnl,
  };
}

const variants = [
  { label: "baseline  Poisson+scalar       ", opts: {} },
  { label: "C-lo      lognorm σ=0.20       ", opts: { lognormalSigma: 0.2 } },
  { label: "C-mid     lognorm σ=0.30       ", opts: { lognormalSigma: 0.3 } },
  { label: "C-hi      lognorm σ=0.50       ", opts: { lognormalSigma: 0.5 } },
  { label: "D-lo      heat γ=0.20          ", opts: { latentGamma: 0.2 } },
  { label: "D-mid     heat γ=0.40          ", opts: { latentGamma: 0.4 } },
  { label: "D-hi      heat γ=0.70          ", opts: { latentGamma: 0.7 } },
  { label: "E-lo      NegBin r=20          ", opts: { negBinR: 20 } },
  { label: "E-mid     NegBin r=8           ", opts: { negBinR: 8 } },
  { label: "E-hi      NegBin r=3           ", opts: { negBinR: 3 } },
  { label: "C+D       σ=0.30, γ=0.4        ", opts: { lognormalSigma: 0.3, latentGamma: 0.4 } },
  { label: "C+E       σ=0.30, r=8          ", opts: { lognormalSigma: 0.3, negBinR: 8 } },
  { label: "D+E       γ=0.4, r=8           ", opts: { latentGamma: 0.4, negBinR: 8 } },
  { label: "C+D+E     σ=0.30, γ=0.4, r=8   ", opts: { lognormalSigma: 0.3, latentGamma: 0.4, negBinR: 8 } },
  { label: "F-1.1     raw^1.1              ", opts: { rawPower: 1.1 } },
  { label: "F-1.2     raw^1.2              ", opts: { rawPower: 1.2 } },
  { label: "F-1.3     raw^1.3              ", opts: { rawPower: 1.3 } },
  { label: "F-1.4     raw^1.4              ", opts: { rawPower: 1.4 } },
  { label: "F-1.5     raw^1.5              ", opts: { rawPower: 1.5 } },
  { label: "F-1.6     raw^1.6              ", opts: { rawPower: 1.6 } },
  { label: "G-lo      deepBoost=1.0        ", opts: { deepBoost: 1.0 } },
  { label: "G-mid     deepBoost=2.0        ", opts: { deepBoost: 2.0 } },
  { label: "G-hi      deepBoost=4.0        ", opts: { deepBoost: 4.0 } },
  { label: "A         no normalization     ", opts: { skipNormalize: true } },
  { label: "F+C       raw^2.0, σ=0.30      ", opts: { rawPower: 2.0, lognormalSigma: 0.3 } },
  { label: "F+E       raw^2.0, r=8         ", opts: { rawPower: 2.0, negBinR: 8 } },
  { label: "F+C+E     raw^2.0, σ=0.30, r=8 ", opts: { rawPower: 2.0, lognormalSigma: 0.3, negBinR: 8 } },
];

console.log(`\nScenario: N=${N}, buyIn=$${buyIn}, rake=${rake * 100}%, bountyFrac=${bountyFraction}, ROI target=${roi * 100}%`);
console.log(`prizePool=$${prizePool}, bountyMean=$${bountyMean}, targetRegular=$${targetRegular.toFixed(2)}, α=${alpha.toFixed(3)}`);
console.log(`paidCount=${paidCount}, M=${M} tourneys per variant\n`);

console.log(
  "variant                          | meanPnl  | sdPnl    | meanB   | sdB     | deep≤5 | minPnl    | maxPnl    | ΔsdPnl%",
);
console.log(
  "---------------------------------|----------|----------|---------|---------|--------|-----------|-----------|--------",
);

let baselineSdPnl = null;
for (const v of variants) {
  const r = runVariant(v.label, v.opts);
  if (baselineSdPnl === null) baselineSdPnl = r.sdPnl;
  const delta = ((r.sdPnl - baselineSdPnl) / baselineSdPnl) * 100;
  console.log(
    [
      r.label,
      r.meanPnl.toFixed(2).padStart(8),
      r.sdPnl.toFixed(2).padStart(8),
      r.meanB.toFixed(2).padStart(7),
      r.sdB.toFixed(2).padStart(7),
      (r.deepRunFrac * 100).toFixed(2).padStart(5) + "%",
      r.minPnl.toFixed(0).padStart(9),
      r.maxPnl.toFixed(0).padStart(9),
      (delta >= 0 ? "+" : "") + delta.toFixed(1) + "%",
    ].join(" | "),
  );
}
console.log();

// ---- Multi-seed drift verification --------------------------------------
if (process.env.DRIFT) {
  console.log("Multi-seed drift check (baseline vs F-1.6, 10 seeds, M per seed):");
  const seeds = Array.from({length: 10}, (_, i) => 42 + i * 101);
  const rows = [];
  for (const s of seeds) {
    const b = runVariant("baseline", { seed: s });
    const f = runVariant("F-1.6", { seed: s, rawPower: 1.6 });
    rows.push({ seed: s, baseMean: b.meanPnl, fMean: f.meanPnl, baseSd: b.sdPnl, fSd: f.sdPnl, baseMaxB: b.maxPnl, fMaxB: f.maxPnl });
  }
  console.log("seed  | base mean | F-1.6 mean | drift   | base σ   | F-1.6 σ  | Δσ%   | base max | F-1.6 max");
  console.log("------|-----------|------------|---------|----------|----------|-------|----------|----------");
  let totDrift = 0, totBaseSd = 0, totFSd = 0;
  for (const r of rows) {
    const drift = r.fMean - r.baseMean;
    const dSd = (r.fSd - r.baseSd) / r.baseSd * 100;
    totDrift += drift;
    totBaseSd += r.baseSd;
    totFSd += r.fSd;
    console.log(`${String(r.seed).padStart(5)} | ${r.baseMean.toFixed(2).padStart(9)} | ${r.fMean.toFixed(2).padStart(10)} | ${drift.toFixed(2).padStart(7)} | ${r.baseSd.toFixed(2).padStart(8)} | ${r.fSd.toFixed(2).padStart(8)} | ${dSd.toFixed(1).padStart(5)}% | ${r.baseMaxB.toFixed(0).padStart(8)} | ${r.fMaxB.toFixed(0).padStart(8)}`);
  }
  const avgDrift = totDrift / rows.length;
  const stdDrift = Math.sqrt(rows.reduce((acc, r) => { const d = (r.fMean - r.baseMean) - avgDrift; return acc + d*d; }, 0) / rows.length);
  const avgSdChange = ((totFSd - totBaseSd) / totBaseSd) * 100;
  console.log(`mean Δmean = ${avgDrift.toFixed(3)} ± ${stdDrift.toFixed(3)}  (t = ${(avgDrift/(stdDrift/Math.sqrt(rows.length))).toFixed(2)})`);
  console.log(`mean Δσ = ${avgSdChange.toFixed(1)}%\n`);
}
