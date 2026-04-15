"use client";

import { useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n/LocaleProvider";
import type { SimulationResult, TournamentRow } from "@/lib/sim/types";

interface Props {
  result: SimulationResult;
  schedule?: TournamentRow[];
}

interface Row {
  targetPct: number;
  tourneys: number;
  fields: number;
}

const TARGETS = [0.3, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005];

// Log-scaled AFS slider range: ~50 .. ~50 000 players.
const AFS_LOG_MIN = Math.log(50);
const AFS_LOG_MAX = Math.log(50_000);

// Linear ROI slider range in ROI units (not percent). −30 % .. +100 %.
const ROI_MIN = -0.30;
const ROI_MAX = 1.00;

// σ_ROI(field, roi) = (C0 + C1·roi) · field^β — pooled log-log fit across
// an 18-point field sweep (50..50 000) × 7 ROIs (−20 %..+80 %) on the
// mtt-standard payout at rake 10 % (scripts/fit_beta.ts). C(roi) is linear,
// R²≈0.993. Ratio vs baseline cancels the constant:
//   σ(roi) / σ(roi0) = (C0 + C1·roi) / (C0 + C1·roi0) = (1 + K·roi)/(1 + K·roi0)
// with K = C1/C0. Only K survives in the widget, so that's the one constant.
const SIGMA_ROI_C0 = 0.6219;
const SIGMA_ROI_C1 = 0.2328;
const SIGMA_ROI_K = SIGMA_ROI_C1 / SIGMA_ROI_C0; // ≈ 0.374
function sigmaRoiMultiplierForRoi(roi: number, baselineRoi: number): number {
  const num = 1 + SIGMA_ROI_K * roi;
  const den = 1 + SIGMA_ROI_K * baselineRoi;
  if (!(num > 0) || !(den > 0)) return 1;
  return num / den;
}

function posToAfs(pos: number): number {
  return Math.exp(AFS_LOG_MIN + (AFS_LOG_MAX - AFS_LOG_MIN) * pos);
}
function afsToPos(afs: number): number {
  const clamped = Math.max(
    AFS_LOG_MIN,
    Math.min(AFS_LOG_MAX, Math.log(Math.max(1, afs))),
  );
  return (clamped - AFS_LOG_MIN) / (AFS_LOG_MAX - AFS_LOG_MIN);
}
function fmtAfs(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k`;
  return Math.round(n).toLocaleString();
}

// Winitzki's approximation of the inverse error function (max error ~4e-4),
// good enough to turn a user-picked two-tailed CI into a z-score.
function inverseErf(x: number): number {
  const a = 0.147;
  const ln1 = Math.log(1 - x * x);
  const t = 2 / (Math.PI * a) + ln1 / 2;
  const sign = x >= 0 ? 1 : -1;
  return sign * Math.sqrt(Math.sqrt(t * t - ln1 / a) - t);
}
function ciToZ(ciFrac: number): number {
  // Two-tailed CI → z such that Φ(z) − Φ(−z) = ciFrac.
  const clamped = Math.max(0, Math.min(0.999999, ciFrac));
  return Math.SQRT2 * inverseErf(clamped);
}

export function ConvergenceChart({ result, schedule }: Props) {
  const t = useT();

  const baseline = useMemo(() => {
    const N = result.tournamentsPerSample;
    const totalBuyIn = result.totalBuyIn;
    if (N <= 0 || totalBuyIn <= 0) return null;
    const abi = totalBuyIn / N;
    const sigmaTotal = result.stats.stdDev;
    if (!(sigmaTotal > 0)) return null;
    const sigmaRoi = sigmaTotal / Math.sqrt(N) / abi;
    const roi = result.expectedProfit / totalBuyIn;

    let countTotal = 0;
    let fieldWeighted = 0;
    if (schedule && schedule.length > 0) {
      for (const row of schedule) {
        const c = Math.max(0, row.count);
        const p = Math.max(1, row.players);
        countTotal += c;
        fieldWeighted += c * p;
      }
    }
    const avgField = countTotal > 0 ? fieldWeighted / countTotal : 1;
    return { sigmaRoi, avgField, roi };
  }, [result, schedule]);

  const [afsPosOverride, setAfsPosOverride] = useState<number | null>(null);
  const baselinePos = baseline ? afsToPos(baseline.avgField) : 0.5;
  const afsPos = afsPosOverride ?? baselinePos;
  const effectiveAfs = posToAfs(afsPos);
  // Confidence level for the CI bands — user-configurable in (90, 99.9).
  const [ciPct, setCiPct] = useState<number>(95);
  const z = ciToZ(ciPct / 100);

  // ROI override — decimal fraction. null means "use baseline roi".
  const [roiOverride, setRoiOverride] = useState<number | null>(null);
  const baselineRoi = baseline ? baseline.roi : 0;
  const effectiveRoi = roiOverride ?? baselineRoi;

  // Text buffers so the user can freely type intermediate values without
  // each keystroke being log-clamped or range-clamped mid-edit.
  const [afsInput, setAfsInput] = useState<string>(
    String(Math.round(effectiveAfs)),
  );
  useEffect(() => {
    setAfsInput(String(Math.round(effectiveAfs)));
  }, [effectiveAfs]);
  const commitAfsInput = (raw: string) => {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      setAfsPosOverride(afsToPos(n));
    } else {
      setAfsInput(String(Math.round(effectiveAfs)));
    }
  };

  const [roiInput, setRoiInput] = useState<string>(
    (effectiveRoi * 100).toFixed(1),
  );
  useEffect(() => {
    setRoiInput((effectiveRoi * 100).toFixed(1));
  }, [effectiveRoi]);
  const commitRoiInput = (raw: string) => {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      const clamped = Math.max(ROI_MIN, Math.min(ROI_MAX, n / 100));
      setRoiOverride(clamped);
    } else {
      setRoiInput((effectiveRoi * 100).toFixed(1));
    }
  };

  const rows = useMemo<Row[] | null>(() => {
    if (!baseline) return null;
    const afs = posToAfs(afsPos);
    // σ_ROI scales with field size as field^β with β ≈ 0.372 — sublinear,
    // because MTT top-heaviness saturates on huge fields. β = 0.5 (√field)
    // would cancel in `k/afs` and freeze the fields column. The 0.372 and
    // the ROI multiplier (1+K·roi) both come from scripts/fit_beta.ts
    // (18 fields × 7 ROIs, 60k × 500 samples each, R²≈0.995).
    //
    //   σ_ROI(afs, roi) = σ_baseline · (afs/baseField)^β · (1+K·roi)/(1+K·roi0)
    //   k               = ⌈(z · σ_ROI / target)²⌉
    //   fields          = k / afs
    const SIGMA_FIELD_EXPONENT = 0.372;
    const baseField = Math.max(1, baseline.avgField);
    const sigmaScale = Math.pow(afs / baseField, SIGMA_FIELD_EXPONENT);
    const roiScale = sigmaRoiMultiplierForRoi(effectiveRoi, baseline.roi);
    const sigmaRoi = baseline.sigmaRoi * sigmaScale * roiScale;
    return TARGETS.map((target) => {
      const k = Math.ceil(Math.pow((z * sigmaRoi) / target, 2));
      return {
        targetPct: target,
        tourneys: k,
        fields: k / Math.max(1, afs),
      };
    });
  }, [baseline, afsPos, z, effectiveRoi]);

  if (!baseline || !rows) {
    return (
      <div className="text-[11px] text-[color:var(--color-fg-dim)]">
        —
      </div>
    );
  }

  const fmtInt = (n: number): string => {
    if (!Number.isFinite(n)) return "—";
    if (n >= 1e7) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
    return Math.round(n).toLocaleString();
  };
  const fmtField = (n: number): string => {
    if (!Number.isFinite(n)) return "—";
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k×`;
    if (n >= 100) return `${Math.round(n)}×`;
    if (n >= 10) return `${n.toFixed(1)}×`;
    return `${n.toFixed(2)}×`;
  };

  return (
    <div className="overflow-x-auto">
      <div className="mb-3 flex items-center gap-3 text-[11px] text-[color:var(--color-fg-muted)]">
        <span className="whitespace-nowrap uppercase tracking-wider text-[color:var(--color-fg-dim)]">
          AFS
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={afsPos}
          onChange={(e) => setAfsPosOverride(Number(e.target.value))}
          className="flex-1 accent-[color:var(--color-accent)]"
          aria-label="AFS"
        />
        <input
          type="number"
          min={1}
          step={1}
          value={afsInput}
          onChange={(e) => setAfsInput(e.target.value)}
          onBlur={(e) => commitAfsInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitAfsInput((e.target as HTMLInputElement).value);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-20 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-1.5 py-0.5 text-right font-mono tabular-nums text-[color:var(--color-fg)] focus:border-[color:var(--color-accent)] focus:outline-none"
          aria-label="AFS value"
        />
        <button
          type="button"
          onClick={() => setAfsPosOverride(null)}
          className="rounded border border-[color:var(--color-border)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider hover:bg-[color:var(--color-bg-elev)]"
          title={`reset to ${fmtAfs(baseline.avgField)}`}
        >
          ↺
        </button>
      </div>
      <div className="mb-3 flex items-center gap-3 text-[11px] text-[color:var(--color-fg-muted)]">
        <span className="whitespace-nowrap uppercase tracking-wider text-[color:var(--color-fg-dim)]">
          ROI
        </span>
        <input
          type="range"
          min={ROI_MIN * 100}
          max={ROI_MAX * 100}
          step={0.5}
          value={effectiveRoi * 100}
          onChange={(e) => setRoiOverride(Number(e.target.value) / 100)}
          className="flex-1 accent-[color:var(--color-accent)]"
          aria-label="ROI"
        />
        <input
          type="number"
          min={ROI_MIN * 100}
          max={ROI_MAX * 100}
          step={0.5}
          value={roiInput}
          onChange={(e) => setRoiInput(e.target.value)}
          onBlur={(e) => commitRoiInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitRoiInput((e.target as HTMLInputElement).value);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-20 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-1.5 py-0.5 text-right font-mono tabular-nums text-[color:var(--color-fg)] focus:border-[color:var(--color-accent)] focus:outline-none"
          aria-label="ROI percent"
        />
        <button
          type="button"
          onClick={() => setRoiOverride(null)}
          className="rounded border border-[color:var(--color-border)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider hover:bg-[color:var(--color-bg-elev)]"
          title={`reset to ${(baselineRoi * 100).toFixed(1)}%`}
        >
          ↺
        </button>
      </div>
      <div className="mb-3 flex items-center gap-3 text-[11px] text-[color:var(--color-fg-muted)]">
        <span className="whitespace-nowrap uppercase tracking-wider text-[color:var(--color-fg-dim)]">
          CI
        </span>
        <input
          type="range"
          min={90}
          max={99.9}
          step={0.1}
          value={ciPct}
          onChange={(e) => setCiPct(Number(e.target.value))}
          className="flex-1 accent-[color:var(--color-accent)]"
          aria-label="Confidence interval"
        />
        <input
          type="number"
          min={90}
          max={99.9}
          step={0.1}
          value={ciPct}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) {
              setCiPct(Math.max(90, Math.min(99.9, n)));
            }
          }}
          className="w-20 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-1.5 py-0.5 text-right font-mono tabular-nums text-[color:var(--color-fg)] focus:border-[color:var(--color-accent)] focus:outline-none"
          aria-label="CI percent"
        />
        <button
          type="button"
          onClick={() => setCiPct(95)}
          className="rounded border border-[color:var(--color-border)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider hover:bg-[color:var(--color-bg-elev)]"
          title="reset to 95%"
        >
          ↺
        </button>
      </div>
      <div className="mb-2 text-[10px] text-[color:var(--color-fg-dim)]">
        z = {z.toFixed(3)}
      </div>
      <table className="w-full border-collapse text-[12px] tabular-nums">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
            <th className="py-1.5 pr-3 font-semibold">
              {t("chart.convergence.col.target")}
            </th>
            <th className="py-1.5 px-3 text-right font-semibold">
              {t("chart.convergence.col.tourneys")}
            </th>
            <th className="py-1.5 pl-3 text-right font-semibold">
              {t("chart.convergence.col.fields")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.targetPct}
              className="border-t border-[color:var(--color-border)]/50 text-[color:var(--color-fg)]"
            >
              <td className="py-1.5 pr-3 font-semibold">
                ±{(row.targetPct * 100).toFixed(row.targetPct < 0.01 ? 1 : 0)}%
              </td>
              <td className="py-1.5 px-3 text-right">{fmtInt(row.tourneys)}</td>
              <td className="py-1.5 pl-3 text-right text-[color:var(--color-accent)]">
                {fmtField(row.fields)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 text-[10px] text-[color:var(--color-fg-dim)]">
        {t("chart.convergence.assumptions")}
      </div>
    </div>
  );
}
