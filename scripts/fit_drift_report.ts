/**
 * In-sample drift report for σ_ROI runtime fits.
 *
 * Reads canonical scripts/fit_beta_*.json + optional matching
 * *_200k_probe.json artifacts and evaluates how well the runtime surface
 * reproduces the measured σ grid in each artifact. No simulation runs —
 * pure re-evaluation.
 *
 * Runtime forms:
 *   - Freeze: single-β, σ = (C0 + C1·roi) · field^β
 *   - PKO / Mystery: 2D log-poly,
 *       log σ = a0 + a1·L + a2·L² + b1·R + b2·R² + c·R·L
 *   - Mystery Battle Royale: fixed-AFS linear σ = C0 + C1·roi
 *
 * For freeze / pko / mystery the artifact carries a (fields × rois) table,
 * and we report residuals r = (σ_fit − σ_measured) / σ_measured in three
 * zones:
 *   full        — every cell in the artifact grid
 *   userWide    — field ∈ [100, 50 000], roi ∈ [−20 %, +40 %]
 *   userNarrow  — field ∈ [500, 10 000],  roi ∈ [−10 %, +30 %]
 *
 * For each (format, fit, grid, zone) combo we emit count,
 * meanSignedResid, rmsResid, p95AbsResid, maxAbsResid, worstCell.
 *
 * Combos per format (only when a probe artifact is on disk):
 *   canonical fit × canonical grid   — baseline (how well the live UI
 *                                       matches the data it was fit to)
 *   probe fit    × canonical grid   — regression check: would promoting
 *                                       the probe fit make the UI zone
 *                                       worse?
 *   probe fit    × probe grid       — probe's in-sample quality
 *
 * MBR uses a different artifact schema (fixed AFS=18, σ(roi) only) and
 * is reported separately — no field zones.
 *
 * Output: scripts/fit_drift_report.json
 */

import { promises as fs } from "node:fs";
import path from "node:path";

interface FieldFit {
  kind: "single-beta";
  C0: number;
  C1: number;
  beta: number;
}

interface LogPoly2DFit {
  kind: "log-poly-2d";
  a0: number;
  a1: number;
  a2: number;
  b1: number;
  b2: number;
  c: number;
}

type RuntimeFit = FieldFit | LogPoly2DFit;

interface FieldArtifact {
  fields: number[];
  rois: number[];
  table: Record<string, number[]>;
  globalBeta: number;
  cRoiLinear: { C0: number; C1: number; r2: number };
  meta?: Record<string, unknown>;
}

interface MbrArtifact {
  rois: number[];
  sigmas: number[];
  cRoiLinear: { C0: number; C1: number; r2: number };
  meta?: Record<string, unknown>;
}

interface Zone {
  name: "full" | "userWide" | "userNarrow";
  fieldMin: number;
  fieldMax: number;
  roiMin: number;
  roiMax: number;
}

interface ResidualStats {
  count: number;
  meanSignedResid: number;
  rmsResid: number;
  p95AbsResid: number;
  maxAbsResid: number;
  worstCell: { field: number; roi: number; sigmaMeasured: number; sigmaFit: number; resid: number } | null;
}

interface ComboReport {
  fit: "canonical" | "probe";
  grid: "canonical" | "probe";
  zones: Record<Zone["name"], ResidualStats>;
}

interface FormatReport {
  format: "freeze" | "pko" | "pko_core" | "mystery";
  canonicalPath: string;
  probePath: string | null;
  canonicalFit: RuntimeFit;
  probeFit: RuntimeFit | null;
  combos: ComboReport[];
}

const ZONES: Zone[] = [
  { name: "full", fieldMin: 0, fieldMax: Infinity, roiMin: -1, roiMax: 1 },
  { name: "userWide", fieldMin: 100, fieldMax: 50_000, roiMin: -0.20, roiMax: 0.40 },
  { name: "userNarrow", fieldMin: 500, fieldMax: 10_000, roiMin: -0.10, roiMax: 0.30 },
];

const FORMATS: Array<{
  id: FormatReport["format"];
  canonical: string;
  probe: string;
}> = [
  {
    id: "freeze",
    canonical: "scripts/fit_beta_freeze_realdata.json",
    probe: "scripts/fit_beta_freeze_realdata_200k_probe.json",
  },
  {
    id: "pko",
    canonical: "scripts/fit_beta_pko.json",
    probe: "scripts/fit_beta_pko_200k_probe.json",
  },
  {
    id: "pko_core",
    canonical: "scripts/fit_beta_pko_core.json",
    probe: "scripts/fit_beta_pko_core_200k_probe.json",
  },
  {
    id: "mystery",
    canonical: "scripts/fit_beta_mystery.json",
    probe: "scripts/fit_beta_mystery_200k_probe.json",
  },
];

const MBR_PATH = "scripts/fit_beta_mystery_royale.json";

function sigmaFit(f: RuntimeFit, field: number, roi: number): number {
  if (f.kind === "single-beta") {
    return (f.C0 + f.C1 * roi) * Math.pow(field, f.beta);
  }
  const L = Math.log(field);
  return Math.exp(
    f.a0 +
      f.a1 * L +
      f.a2 * L * L +
      f.b1 * roi +
      f.b2 * roi * roi +
      f.c * roi * L,
  );
}

function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function statsFor(
  fit: RuntimeFit,
  art: FieldArtifact,
  zone: Zone,
): ResidualStats {
  const resids: number[] = [];
  let signedSum = 0;
  let sqSum = 0;
  let worst: ResidualStats["worstCell"] = null;
  for (const roi of art.rois) {
    if (roi < zone.roiMin - 1e-9 || roi > zone.roiMax + 1e-9) continue;
    const key = String(roi);
    const col = art.table[key];
    if (!col) continue;
    for (let i = 0; i < art.fields.length; i++) {
      const field = art.fields[i];
      if (field < zone.fieldMin - 1e-9 || field > zone.fieldMax + 1e-9) continue;
      const sigmaMeas = col[i];
      if (sigmaMeas == null || !Number.isFinite(sigmaMeas) || sigmaMeas === 0) continue;
      const sigmaPred = sigmaFit(fit, field, roi);
      const resid = (sigmaPred - sigmaMeas) / sigmaMeas;
      resids.push(resid);
      signedSum += resid;
      sqSum += resid * resid;
      if (!worst || Math.abs(resid) > Math.abs(worst.resid)) {
        worst = { field, roi, sigmaMeasured: sigmaMeas, sigmaFit: sigmaPred, resid };
      }
    }
  }
  const n = resids.length;
  const absR = resids.map(Math.abs);
  return {
    count: n,
    meanSignedResid: n > 0 ? signedSum / n : 0,
    rmsResid: n > 0 ? Math.sqrt(sqSum / n) : 0,
    p95AbsResid: quantile(absR, 0.95),
    maxAbsResid: absR.reduce((a, b) => Math.max(a, b), 0),
    worstCell: worst,
  };
}

async function readJsonIfExists<T>(p: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(p, "utf-8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function asSingleBetaFit(art: { cRoiLinear: { C0: number; C1: number }; globalBeta?: number }): FieldFit {
  return {
    kind: "single-beta",
    C0: art.cRoiLinear.C0,
    C1: art.cRoiLinear.C1,
    beta: art.globalBeta ?? 0,
  };
}

function features2DLogPoly(field: number, roi: number): number[] {
  const L = Math.log(field);
  return [1, L, L * L, roi, roi * roi, roi * L];
}

function solve(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[piv][col])) piv = row;
    }
    if (piv !== col) [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    if (Math.abs(d) < 1e-14) throw new Error(`singular normal equation at col=${col}`);
    for (let j = col; j <= n; j++) M[col][j] /= d;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = M[row][col];
      for (let j = col; j <= n; j++) M[row][j] -= f * M[col][j];
    }
  }
  return M.map((row) => row[n]);
}

function fitLogPoly2D(art: FieldArtifact): LogPoly2DFit {
  const p = 6;
  const xtx: number[][] = Array.from({ length: p }, () => Array(p).fill(0));
  const xty: number[] = Array(p).fill(0);
  for (const roi of art.rois) {
    const row = art.table[String(roi)];
    if (!row || row.length !== art.fields.length) {
      throw new Error(`mismatched table row for roi=${roi}`);
    }
    for (let i = 0; i < art.fields.length; i++) {
      const sigma = row[i];
      if (!Number.isFinite(sigma) || sigma <= 0) {
        throw new Error(`invalid sigma=${sigma} for roi=${roi}, field=${art.fields[i]}`);
      }
      const x = features2DLogPoly(art.fields[i], roi);
      const y = Math.log(sigma);
      for (let j = 0; j < p; j++) {
        xty[j] += x[j] * y;
        for (let k = 0; k < p; k++) xtx[j][k] += x[j] * x[k];
      }
    }
  }
  const [a0, a1, a2, b1, b2, c] = solve(xtx, xty);
  return { kind: "log-poly-2d", a0, a1, a2, b1, b2, c };
}

function runtimeFitFor(format: FormatReport["format"], art: FieldArtifact): RuntimeFit {
  if (format === "pko" || format === "mystery") return fitLogPoly2D(art);
  return asSingleBetaFit(art);
}

async function runFieldFormat(
  id: FormatReport["format"],
  canonicalPath: string,
  probePath: string,
): Promise<FormatReport | null> {
  const canonical = await readJsonIfExists<FieldArtifact>(canonicalPath);
  if (!canonical) {
    console.warn(`skip ${id}: canonical artifact missing (${canonicalPath})`);
    return null;
  }
  if (!canonical.table || !canonical.fields) {
    console.warn(`skip ${id}: canonical artifact has no field×roi table (${canonicalPath})`);
    return null;
  }
  const probe = await readJsonIfExists<FieldArtifact>(probePath);

  const canonicalFit = runtimeFitFor(id, canonical);
  const probeFit = probe ? runtimeFitFor(id, probe) : null;

  const combos: ComboReport[] = [];

  const build = (fit: RuntimeFit, art: FieldArtifact): ComboReport["zones"] => ({
    full: statsFor(fit, art, ZONES[0]),
    userWide: statsFor(fit, art, ZONES[1]),
    userNarrow: statsFor(fit, art, ZONES[2]),
  });

  combos.push({ fit: "canonical", grid: "canonical", zones: build(canonicalFit, canonical) });
  if (probeFit && probe) {
    combos.push({ fit: "probe", grid: "canonical", zones: build(probeFit, canonical) });
    combos.push({ fit: "probe", grid: "probe", zones: build(probeFit, probe) });
  }

  return {
    format: id,
    canonicalPath,
    probePath: probe ? probePath : null,
    canonicalFit,
    probeFit,
    combos,
  };
}

interface MbrReport {
  format: "mystery_royale";
  canonicalPath: string;
  fit: { C0: number; C1: number; beta: 0 };
  stats: ResidualStats;
}

async function runMbr(): Promise<MbrReport | null> {
  const art = await readJsonIfExists<MbrArtifact>(MBR_PATH);
  if (!art) {
    console.warn(`skip mystery_royale: artifact missing (${MBR_PATH})`);
    return null;
  }
  const resids: number[] = [];
  let signedSum = 0;
  let sqSum = 0;
  let worst: ResidualStats["worstCell"] = null;
  for (let i = 0; i < art.rois.length; i++) {
    const roi = art.rois[i];
    const sigmaMeas = art.sigmas[i];
    if (sigmaMeas == null || !Number.isFinite(sigmaMeas) || sigmaMeas === 0) continue;
    const sigmaPred = art.cRoiLinear.C0 + art.cRoiLinear.C1 * roi;
    const resid = (sigmaPred - sigmaMeas) / sigmaMeas;
    resids.push(resid);
    signedSum += resid;
    sqSum += resid * resid;
    if (!worst || Math.abs(resid) > Math.abs(worst.resid)) {
      worst = { field: 18, roi, sigmaMeasured: sigmaMeas, sigmaFit: sigmaPred, resid };
    }
  }
  const n = resids.length;
  const absR = resids.map(Math.abs);
  return {
    format: "mystery_royale",
    canonicalPath: MBR_PATH,
    fit: { C0: art.cRoiLinear.C0, C1: art.cRoiLinear.C1, beta: 0 },
    stats: {
      count: n,
      meanSignedResid: n > 0 ? signedSum / n : 0,
      rmsResid: n > 0 ? Math.sqrt(sqSum / n) : 0,
      p95AbsResid: quantile(absR, 0.95),
      maxAbsResid: absR.reduce((a, b) => Math.max(a, b), 0),
      worstCell: worst,
    },
  };
}

function fmtPct(x: number): string {
  return (x * 100).toFixed(2) + "%";
}

function fitSummary(f: RuntimeFit): string {
  if (f.kind === "single-beta") {
    return `single-β C0=${f.C0.toFixed(4)} C1=${f.C1.toFixed(4)} β=${f.beta.toFixed(4)}`;
  }
  return (
    `log-poly-2d a0=${f.a0.toFixed(4)} a1=${f.a1.toFixed(4)} ` +
    `a2=${f.a2.toFixed(4)} b1=${f.b1.toFixed(4)} ` +
    `b2=${f.b2.toFixed(4)} c=${f.c.toFixed(4)}`
  );
}

function logCombo(format: string, combo: ComboReport): void {
  const label = `${combo.fit} fit × ${combo.grid} grid`;
  console.log(`  ${format.padEnd(12)} ${label}`);
  for (const z of ["full", "userWide", "userNarrow"] as const) {
    const s = combo.zones[z];
    const worst = s.worstCell
      ? ` worst=(f=${s.worstCell.field}, roi=${fmtPct(s.worstCell.roi)}, Δ=${fmtPct(s.worstCell.resid)})`
      : "";
    console.log(
      `    ${z.padEnd(11)} n=${String(s.count).padStart(3)} mean=${fmtPct(s.meanSignedResid).padStart(8)} rms=${fmtPct(s.rmsResid).padStart(7)} p95=${fmtPct(s.p95AbsResid).padStart(7)} max=${fmtPct(s.maxAbsResid).padStart(7)}${worst}`,
    );
  }
}

async function main() {
  const fieldReports: FormatReport[] = [];
  for (const f of FORMATS) {
    const rep = await runFieldFormat(f.id, f.canonical, f.probe);
    if (rep) fieldReports.push(rep);
  }
  const mbr = await runMbr();

  console.log("fit_drift_report — runtime-fit residuals (σ_fit − σ_measured) / σ_measured\n");
  for (const rep of fieldReports) {
    console.log(
      `${rep.format}:  canonical ${fitSummary(rep.canonicalFit)}` +
        (rep.probeFit
          ? `  |  probe ${fitSummary(rep.probeFit)}`
          : "  (no probe on disk)"),
    );
    for (const c of rep.combos) logCombo(rep.format, c);
    console.log("");
  }
  if (mbr) {
    console.log(
      `mystery_royale (fixed AFS=18): C0=${mbr.fit.C0.toFixed(4)} C1=${mbr.fit.C1.toFixed(4)}`,
    );
    const s = mbr.stats;
    const worst = s.worstCell
      ? ` worst=(roi=${fmtPct(s.worstCell.roi)}, Δ=${fmtPct(s.worstCell.resid)})`
      : "";
    console.log(
      `  n=${s.count} mean=${fmtPct(s.meanSignedResid)} rms=${fmtPct(s.rmsResid)} p95=${fmtPct(s.p95AbsResid)} max=${fmtPct(s.maxAbsResid)}${worst}`,
    );
    console.log("");
  }

  const outPath = "scripts/fit_drift_report.json";
  const payload = {
    generatedAt: new Date().toISOString(),
    zones: ZONES,
    fieldFormats: fieldReports,
    mysteryRoyale: mbr,
  };
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
  console.log(`wrote ${path.normalize(outPath)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
