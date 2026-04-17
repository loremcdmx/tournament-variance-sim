"use client";

import { useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n/LocaleProvider";
import type { DictKey } from "@/lib/i18n/dict";
import type { TournamentRow } from "@/lib/sim/types";

interface Props {
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
// an 18-point field sweep (50..50 000), rake 10 %, 500 tourneys × 120 k samples.
//
// Freeze: mtt-standard payout + freeze-realdata-linear finish, 7 ROIs (−20 %..+80 %).
// σ_ROI is flat across ROI here (C1 ≈ 0) because the realdata-linear finish CDF
// is fixed empirically — ROI only shifts the mean, not the shape.
// PKO: mtt-gg-bounty payout + pko-realdata-linear finish, bountyFraction=0.5,
// pkoHeadVar=0.4, 11 ROIs (−20 %..+80 %, densified at 5/15/25/30 %). The bounty
// channel amplifies deep runs so C grows meaningfully with ROI.
// Both fits produced by scripts/fit_sigma_parallel.ts.
const SIGMA_ROI_FREEZE = {
  C0: 0.6564,
  C1: 0,
  beta: 0.3694,
};
const SIGMA_ROI_PKO = {
  C0: 0.6265,
  C1: 0.4961,
  beta: 0.2763,
};

type ConvergenceFormat = "freeze" | "pko" | "mix";

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

export function ConvergenceChart({ schedule }: Props) {
  const t = useT();

  // Baseline avgField / roi are taken from the current schedule when present;
  // if the user hasn't loaded a schedule yet, fall back to neutral defaults
  // (1000-player field, +10 % ROI) so the widget is fully usable before any
  // simulation has been run. σ_ROI itself is the closed-form analytic fit
  // C(roi) · afs^β, so no measurement input is required.
  const baseline = useMemo(() => {
    let countTotal = 0;
    let fieldWeighted = 0;
    let roiWeighted = 0;
    let pkoCount = 0;
    if (schedule && schedule.length > 0) {
      for (const row of schedule) {
        const c = Math.max(0, row.count);
        const p = Math.max(1, row.players);
        countTotal += c;
        fieldWeighted += c * p;
        roiWeighted += c * row.roi;
        if ((row.bountyFraction ?? 0) > 0) pkoCount += c;
      }
    }
    const avgField = countTotal > 0 ? fieldWeighted / countTotal : 1000;
    const roi = countTotal > 0 ? roiWeighted / countTotal : 0.1;
    const pkoShare = countTotal > 0 ? pkoCount / countTotal : 0;
    return { avgField, roi, pkoShare };
  }, [schedule]);

  const [afsPosOverride, setAfsPosOverride] = useState<number | null>(null);
  const baselinePos = afsToPos(baseline.avgField);
  const afsPos = afsPosOverride ?? baselinePos;
  const effectiveAfs = posToAfs(afsPos);
  // Confidence level for the CI bands — user-configurable in (90, 99.9).
  const [ciPct, setCiPct] = useState<number>(95);
  const z = ciToZ(ciPct / 100);
  const [ciInput, setCiInput] = useState<string>(String(ciPct));
  useEffect(() => {
    setCiInput(String(ciPct));
  }, [ciPct]);
  const commitCiInput = (raw: string) => {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      setCiPct(Math.max(90, Math.min(99.9, n)));
    } else {
      setCiInput(String(ciPct));
    }
  };

  // ROI override — decimal fraction. null means "use baseline roi".
  const [roiOverride, setRoiOverride] = useState<number | null>(null);
  const baselineRoi = baseline.roi;
  const effectiveRoi = roiOverride ?? baselineRoi;

  // Format override. null → auto-pick from schedule composition.
  const [formatOverride, setFormatOverride] =
    useState<ConvergenceFormat | null>(null);
  const baselineFormat: ConvergenceFormat =
    baseline.pkoShare >= 0.99
      ? "pko"
      : baseline.pkoShare <= 0.01
        ? "freeze"
        : "mix";
  const format = formatOverride ?? baselineFormat;
  // Mix fraction of PKO (0..1). null → schedule-derived default.
  const [pkoMixOverride, setPkoMixOverride] = useState<number | null>(null);
  const baselinePkoMix = baseline.pkoShare;
  const pkoMix =
    format === "pko"
      ? 1
      : format === "freeze"
        ? 0
        : (pkoMixOverride ?? baselinePkoMix);

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

  const rows = useMemo<Row[]>(() => {
    const afs = posToAfs(afsPos);
    // Closed-form σ_ROI from the 18-field × 7-ROI fits (freeze: fit_beta.ts,
    // PKO: fit_beta_pko.ts). Entirely analytic — doesn't depend on any
    // simulation run, so this widget is usable before the user clicks "go".
    //
    //   σ_ROI(afs, roi) = (C0 + C1·roi) · afs^β           (per format)
    //   σ²_eff          = p·σ²_pko + (1−p)·σ²_freeze      (mix)
    //   k               = ⌈(z · σ_eff / target)²⌉
    //   fields          = k / afs
    const sigmaFor = (coef: typeof SIGMA_ROI_FREEZE): number =>
      Math.max(0, coef.C0 + coef.C1 * effectiveRoi) *
      Math.pow(Math.max(1, afs), coef.beta);
    const sigmaFreeze = sigmaFor(SIGMA_ROI_FREEZE);
    const sigmaPko = sigmaFor(SIGMA_ROI_PKO);
    const p = Math.max(0, Math.min(1, pkoMix));
    const sigmaRoi = Math.sqrt(
      p * sigmaPko * sigmaPko + (1 - p) * sigmaFreeze * sigmaFreeze,
    );
    return TARGETS.map((target) => {
      const k = Math.ceil(Math.pow((z * sigmaRoi) / target, 2));
      return {
        targetPct: target,
        tourneys: k,
        fields: k / Math.max(1, afs),
      };
    });
  }, [afsPos, z, effectiveRoi, pkoMix]);

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

  const FORMATS: { id: ConvergenceFormat; labelKey: DictKey }[] = [
    { id: "freeze", labelKey: "chart.convergence.format.freeze" },
    { id: "pko", labelKey: "chart.convergence.format.pko" },
    { id: "mix", labelKey: "chart.convergence.format.mix" },
  ];

  return (
    <div className="overflow-x-auto">
      <div className="mb-3 flex items-center gap-3 text-[11px] text-[color:var(--color-fg-muted)]">
        <div className="flex flex-1 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] p-0.5">
          {FORMATS.map((f) => {
            const active = format === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  // Pin current AFS / ROI / CI so switching format never
                  // visually shifts them — lets the user A/B the three σ
                  // tables at the same slider positions.
                  if (afsPosOverride == null) setAfsPosOverride(afsPos);
                  if (roiOverride == null) setRoiOverride(effectiveRoi);
                  setFormatOverride(f.id);
                }}
                className={`flex-1 rounded px-2 py-1 text-[11px] uppercase tracking-wider transition ${
                  active
                    ? "bg-fuchsia-500/20 text-fuchsia-200"
                    : "text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)]"
                }`}
              >
                {t(f.labelKey)}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => {
            setFormatOverride(null);
            setPkoMixOverride(null);
          }}
          className="rounded border border-[color:var(--color-border)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider hover:bg-[color:var(--color-bg-elev)]"
          title={`reset to ${baselineFormat}${baselineFormat === "mix" ? ` (${Math.round(baselinePkoMix * 100)}% PKO)` : ""}`}
        >
          ↺
        </button>
      </div>
      {format === "mix" && (
        <div className="mb-3 flex items-center gap-3 text-[11px] text-[color:var(--color-fg-muted)]">
          <span className="w-8 shrink-0 whitespace-nowrap uppercase tracking-wider text-fuchsia-400/80">
            PKO
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(pkoMix * 100)}
            onChange={(e) => setPkoMixOverride(Number(e.target.value) / 100)}
            className="flex-1 accent-fuchsia-400"
            aria-label="PKO share"
          />
          <span className="w-20 text-center font-mono tabular-nums text-[color:var(--color-fg)]">
            {Math.round(pkoMix * 100)}% / {100 - Math.round(pkoMix * 100)}%
          </span>
          <span className="w-[22px]" />
        </div>
      )}
      <div className="mb-3 flex items-center gap-3 text-[11px] text-[color:var(--color-fg-muted)]">
        <span className="w-8 shrink-0 whitespace-nowrap uppercase tracking-wider text-emerald-400/80">
          AFS
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={afsPos}
          onChange={(e) => setAfsPosOverride(Number(e.target.value))}
          className="flex-1 accent-emerald-400"
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
          className="w-20 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-1.5 py-0.5 text-center font-mono tabular-nums text-[color:var(--color-fg)] focus:border-emerald-400 focus:outline-none"
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
        <span className="w-8 shrink-0 whitespace-nowrap uppercase tracking-wider text-amber-400/80">
          ROI
        </span>
        <input
          type="range"
          min={ROI_MIN * 100}
          max={ROI_MAX * 100}
          step={0.5}
          value={effectiveRoi * 100}
          onChange={(e) => setRoiOverride(Number(e.target.value) / 100)}
          className="flex-1 accent-amber-400"
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
          className="w-20 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-1.5 py-0.5 text-center font-mono tabular-nums text-[color:var(--color-fg)] focus:border-amber-400 focus:outline-none"
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
        <span className="w-8 shrink-0 whitespace-nowrap uppercase tracking-wider text-sky-400/80">
          CI
        </span>
        <input
          type="range"
          min={90}
          max={99.9}
          step={0.1}
          value={ciPct}
          onChange={(e) => setCiPct(Number(e.target.value))}
          className="flex-1 accent-sky-400"
          aria-label="Confidence interval"
        />
        <input
          type="number"
          min={90}
          max={99.9}
          step={0.1}
          value={ciInput}
          onChange={(e) => setCiInput(e.target.value)}
          onBlur={(e) => commitCiInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitCiInput((e.target as HTMLInputElement).value);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-20 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-1.5 py-0.5 text-center font-mono tabular-nums text-[color:var(--color-fg)] focus:border-sky-400 focus:outline-none"
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
      <table className="w-full table-fixed border-collapse text-[12px] tabular-nums">
        <colgroup>
          <col className="w-[72px]" />
          <col />
          <col />
        </colgroup>
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
