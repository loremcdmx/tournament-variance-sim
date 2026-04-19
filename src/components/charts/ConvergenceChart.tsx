"use client";

import { memo, useEffect, useMemo, useState } from "react";
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

const TARGETS = [0.5, 0.3, 0.2, 0.1, 0.05, 0.025, 0.01, 0.005, 0.001];

// Log-scaled AFS slider range: ~50 .. ~50 000 players.
const AFS_LOG_MIN = Math.log(50);
const AFS_LOG_MAX = Math.log(50_000);

// Linear ROI slider range in ROI units (not percent). Default is wide
// (−30 %..+100 %) for exploration. Battle Royale narrows to ±5 %
// because that's the real winrate band for regs — the sweep is calibrated
// across the full range, but UX-wise there's no honest reason to ask
// "how many tourneys for a +80 % edge in MBR".
const ROI_MIN_DEFAULT = -0.30;
const ROI_MAX_DEFAULT = 1.00;
const ROI_MIN_MBR = -0.10;
const ROI_MAX_MBR = 0.10;

type MixTuple = [number, number, number];
function normalizeMix(m: MixTuple): MixTuple {
  const s = m[0] + m[1] + m[2];
  if (s <= 1e-9) return [1 / 3, 1 / 3, 1 / 3];
  return [m[0] / s, m[1] / s, m[2] / s];
}

// σ_ROI(field, roi) = (C0 + C1·roi) · field^β — pooled log-log fit across
// an 18-point field sweep (50..50 000), 500 tourneys × 120 k samples.
// Freeze/PKO/Mystery fit at rake 10 %; Mystery Battle Royale at rake 8 %
// (GGPoker's real-world rake since March 2024). The widget's rake-rescale
// factor (1+FIT_RAKE_format)/(1+rake) converts to user-picked rake at render.
//
// Freeze: mtt-standard payout + freeze-realdata-linear finish, 7 ROIs (−20 %..+80 %).
// σ_ROI is flat across ROI here (C1 ≈ 0) because the realdata-linear finish CDF
// is fixed empirically — ROI only shifts the mean, not the shape.
// PKO: mtt-gg-bounty payout + pko-realdata-linear finish, bountyFraction=0.5,
// pkoHeadVar=0.4, 11 ROIs (−20 %..+80 %, densified at 5/15/25/30 %). The bounty
// channel amplifies deep runs so C grows meaningfully with ROI.
// Mystery: mtt-gg-bounty payout + mystery-realdata-linear finish (freeze non-cash
// + PKO cash), bountyFraction=0.5, mysteryBountyVariance=0.8 (log-normal jackpot
// noise), pkoHeadVar=0.4. Bounty $ concentrates on ITM-only finishes — the pre-
// ITM phase is freeze-like, phase 2 (post-ITM) activates envelope KOs. 11 ROIs.
// C1 ≈ 2× PKO because the ITM-concentrated bounty amplifies ROI shifts harder.
// Battle Royale: same finish model, mysteryBountyVariance=1.8 (jackpot tail).
// Higher log-variance both lifts C0 (~27 %) and amplifies C1 further — deep runs
// carry even more skew, so ROI-sensitivity is ~3× PKO's, ~1.5× Mystery's.
// Fit at rake 8 %; coefficients = 1.01852 × old rake-10 values, confirming
// σ_profit rake-invariance within fit noise (β unchanged).
// All fits produced by scripts/fit_sigma_parallel.ts.
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
// Mystery coefficients refit 2026-04-18 after adbf278 restricted the mystery
// envelope harmonic window to top-9 FT. Probe showed non-uniform drift
// (-5.7% to +17.4% across field×ROI) → full resweep.
// Fit: 11 ROIs × 18 fields at buy-in $50, rake 10%, mtt-gg-mystery payout,
// mysteryBountyVariance=2.0 (#71 jackpot tail). R²=0.996 on linear C(roi),
// but per-ROI field-fits only reach R²=0.80-0.87 — σ(field) isn't cleanly
// power-law: at small fields the top-9 harmonic envelope saturates σ near
// ~5.6, then σ grows log-linearly past field≈1000. Global β=0.1325 averages
// this. Cross-validation on 10 held-out (field,roi) pairs (xval_mystery.ts):
// mean |Δ/σ|=17.6%, max 26.6% at extremes. Acceptable for a quick-estimate
// widget, but a richer 2D model (or dual-β) would halve the residuals.
const SIGMA_ROI_MYSTERY = {
  C0: 2.5164,
  C1: 3.7097,
  beta: 0.1325,
};
// Battle Royale is fixed AFS=18 in the UI (see BR_FIXED_AFS + #93), so the
// field-sweep β is degenerate. `fit_br_fixed18.ts` measures σ_ROI across 11
// ROIs at a single AFS=18 and linear-fits C(roi). β=0 bakes 18^β into the
// C coefficients. Refit 2026-04-18 after adbf278 restricted the mystery
// envelope harmonic window to top-9 FT — bounty mass concentrates on fewer
// finishers, inflating σ_ROI by ~16% across the ROI band. Cross-validated
// on 10 held-out ROIs in [-15%, 60%]: max residual 0.07% of σ, mean
// |resid/SE|=0.16 (noise-indistinguishable). Quadratic term has curvature
// 0.048 — negligible over the UI's ±10% band. Linear is optimal.
const SIGMA_ROI_MYSTERY_ROYALE = {
  C0: 8.1534,
  C1: 7.9063,
  beta: 0,
};

type ConvergenceFormat =
  | "freeze"
  | "pko"
  | "mystery"
  | "mystery-royale"
  | "mix"
  | "exact";

type RowFormat = "freeze" | "pko" | "mystery" | "mystery-royale";

function inferRowFormat(row: TournamentRow): RowFormat {
  const b = row.bountyFraction ?? 0;
  const m = row.mysteryBountyVariance ?? 0;
  if (b > 0 && m >= 1.4) return "mystery-royale";
  if (b > 0 && m > 0) return "mystery";
  if (b > 0) return "pko";
  return "freeze";
}

const SIGMA_COEF_BY_FORMAT: Record<
  RowFormat,
  typeof SIGMA_ROI_FREEZE
> = {
  freeze: SIGMA_ROI_FREEZE,
  pko: SIGMA_ROI_PKO,
  mystery: SIGMA_ROI_MYSTERY,
  "mystery-royale": SIGMA_ROI_MYSTERY_ROYALE,
};

const FIT_RAKE_BY_FORMAT: Record<RowFormat, number> = {
  freeze: 0.10,
  pko: 0.10,
  mystery: 0.10,
  "mystery-royale": 0.08,
};

function sigmaRoiForRow(
  row: TournamentRow,
  rakeScaleOverride?: number,
): { sigma: number; format: RowFormat } {
  const fmt = inferRowFormat(row);
  const coef = SIGMA_COEF_BY_FORMAT[fmt];
  const afs = Math.max(1, row.players);
  const roi = row.roi;
  // Per-row rake rescale: row's own rake vs the fit baseline for its format.
  // Callers can override (e.g. UI rake slider takes over the per-row rake).
  const rakeScale =
    rakeScaleOverride ??
    (1 + FIT_RAKE_BY_FORMAT[fmt]) / (1 + (row.rake ?? 0));
  const sigma =
    Math.max(0, coef.C0 + coef.C1 * roi) *
    Math.pow(afs, coef.beta) *
    rakeScale;
  return { sigma, format: fmt };
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

export const ConvergenceChart = memo(function ConvergenceChart({
  schedule,
}: Props) {
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
    let mysteryCount = 0;
    let mysteryRoyaleCount = 0;
    if (schedule && schedule.length > 0) {
      for (const row of schedule) {
        const c = Math.max(0, row.count);
        const p = Math.max(1, row.players);
        countTotal += c;
        fieldWeighted += c * p;
        roiWeighted += c * row.roi;
        // Match inferGameType's threshold so Battle Royale (σ²≥1.4) is
        // tracked as its own bucket — otherwise it collapses into "mystery"
        // and the baseline-format heuristic snaps to the wrong fit.
        const b = row.bountyFraction ?? 0;
        const m = row.mysteryBountyVariance ?? 0;
        if (b > 0 && m >= 1.4) mysteryRoyaleCount += c;
        else if (b > 0 && m > 0) mysteryCount += c;
        else if (b > 0) pkoCount += c;
      }
    }
    const avgField = countTotal > 0 ? fieldWeighted / countTotal : 1000;
    const roi = countTotal > 0 ? roiWeighted / countTotal : 0.1;
    const pkoShare = countTotal > 0 ? pkoCount / countTotal : 0;
    const mysteryShare = countTotal > 0 ? mysteryCount / countTotal : 0;
    const mysteryRoyaleShare =
      countTotal > 0 ? mysteryRoyaleCount / countTotal : 0;
    const freezeShare = Math.max(
      0,
      1 - pkoShare - mysteryShare - mysteryRoyaleShare,
    );
    return {
      avgField,
      roi,
      pkoShare,
      mysteryShare,
      mysteryRoyaleShare,
      freezeShare,
    };
  }, [schedule]);

  const [afsPosOverride, setAfsPosOverride] = useState<number | null>(null);
  const baselinePos = afsToPos(baseline.avgField);
  // Battle Royale is a fixed 18-max SNG — lobby size never changes between
  // buy-in tiers, and the σ_ROI fit was produced at N=18. Lock AFS so the
  // slider doesn't lie about a knob the user can't turn.
  const BR_FIXED_AFS = 18;
  // Confidence level for the CI bands — user-configurable in (75, 99.9).
  const [ciPct, setCiPct] = useState<number>(95);
  const z = ciToZ(ciPct / 100);
  const [ciInput, setCiInput] = useState<string>(String(ciPct));
  useEffect(() => {
    setCiInput(String(ciPct));
  }, [ciPct]);
  const commitCiInput = (raw: string) => {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      setCiPct(Math.max(75, Math.min(99.9, n)));
    } else {
      setCiInput(String(ciPct));
    }
  };

  // ROI override — decimal fraction. null means "use baseline roi".
  const [roiOverride, setRoiOverride] = useState<number | null>(null);
  const baselineRoi = baseline.roi;

  const hasSchedule = !!schedule && schedule.length > 0;

  // Format override. null → auto-pick from schedule composition.
  // "exact" is a first-class tab that computes per-row σ over the schedule
  // instead of averaging across AFS/ROI. Disabled when no schedule is loaded.
  const [formatOverride, setFormatOverride] =
    useState<ConvergenceFormat | null>(null);
  // "mix" aggregates the 3-way {freeze, pko, mystery} tuple — MBR is
  // deliberately excluded because it's AFS-locked at 18 and ROI-clipped.
  // So a schedule containing MBR alongside other formats would silently
  // drop MBR's σ contribution if we defaulted to "mix". Fall back to
  // "exact" in that case so per-row σ over the real schedule is shown.
  const baselineFormat: ConvergenceFormat =
    baseline.mysteryRoyaleShare >= 0.99
      ? "mystery-royale"
      : baseline.pkoShare >= 0.99
        ? "pko"
        : baseline.mysteryShare >= 0.99
          ? "mystery"
          : baseline.freezeShare >= 0.99
            ? "freeze"
            : baseline.mysteryRoyaleShare > 0 && hasSchedule
              ? "exact"
              : "mix";
  const rawFormat = formatOverride ?? baselineFormat;
  const format: ConvergenceFormat =
    rawFormat === "exact" && !hasSchedule ? "mix" : rawFormat;
  const effectiveMode: "avg" | "exact" = format === "exact" ? "exact" : "avg";

  // Format-dependent ROI bounds. MBR clips to ±5 % (reg band); others keep
  // the default wide range. effectiveRoi is clamped on read so user's
  // preferred ROI is preserved across format switches — swapping back to
  // a wider format restores the original value.
  const roiMin =
    format === "mystery-royale" ? ROI_MIN_MBR : ROI_MIN_DEFAULT;
  const roiMax =
    format === "mystery-royale" ? ROI_MAX_MBR : ROI_MAX_DEFAULT;
  const effectiveRoi = Math.max(
    roiMin,
    Math.min(roiMax, roiOverride ?? baselineRoi),
  );

  const afsLocked = format === "mystery-royale";
  const afsPos = afsLocked
    ? afsToPos(BR_FIXED_AFS)
    : (afsPosOverride ?? baselinePos);
  const effectiveAfs = afsLocked ? BR_FIXED_AFS : posToAfs(afsPos);

  // 3-way mix: [freeze, pko, mystery], each 0..1, sum = 1.
  // null → use schedule-derived baseline. Mystery in the mix uses the
  // Mystery (not Battle Royale) σ fit — BR is a distinct format selection.
  const [mixOverride, setMixOverride] = useState<MixTuple | null>(null);
  const baselineMix = useMemo<MixTuple>(
    () => normalizeMix([baseline.freezeShare, baseline.pkoShare, baseline.mysteryShare]),
    [baseline.freezeShare, baseline.pkoShare, baseline.mysteryShare],
  );
  const mix = useMemo<MixTuple>(
    () =>
      format === "pko"
        ? [0, 1, 0]
        : format === "freeze"
          ? [1, 0, 0]
          : format === "mystery"
            ? [0, 0, 1]
            : (mixOverride ?? baselineMix),
    [format, mixOverride, baselineMix],
  );
  // When one mix component is edited, distribute the delta across the other
  // two in proportion to their current values. If both others are zero,
  // split the remainder evenly.
  const updateMixComponent = (idx: 0 | 1 | 2, nextVal: number) => {
    const v = Math.max(0, Math.min(1, nextVal));
    const others: [number, number] = idx === 0 ? [1, 2] : idx === 1 ? [0, 2] : [0, 1];
    const rest = 1 - v;
    const sumOthers = mix[others[0]] + mix[others[1]];
    const next: MixTuple = [...mix] as MixTuple;
    next[idx] = v;
    if (sumOthers > 1e-9) {
      next[others[0]] = mix[others[0]] * rest / sumOthers;
      next[others[1]] = mix[others[1]] * rest / sumOthers;
    } else {
      next[others[0]] = rest / 2;
      next[others[1]] = rest / 2;
    }
    setMixOverride(next);
  };

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
      const clamped = Math.max(roiMin, Math.min(roiMax, n / 100));
      setRoiOverride(clamped);
    } else {
      setRoiInput((effectiveRoi * 100).toFixed(1));
    }
  };

  // Rake — fraction of buy-in taken by the room. σ fits were measured at
  // format-specific baselines (see scripts/fit_sigma_parallel.ts): 10% for
  // freeze/PKO/mystery, 8% for Mystery Battle Royale (GGPoker's actual
  // rake since March 2024). We rescale by (1+FIT_RAKE_format)/(1+rake) —
  // σ_profit is ~rake-invariant but σ_ROI divides by cost basis
  // buyIn·(1+rake), so higher rake compresses ROI-unit σ.
  const FIT_RAKE = format === "mystery-royale" ? 0.08 : 0.10;
  // Default rake snaps to format's real-world baseline on format switch —
  // matches "as-fit" σ for that format without relying on the rake-rescale
  // to do compensation work at every render. Users can still slide away.
  const formatDefaultRake = format === "mystery-royale" ? 8 : 10;
  const [rakePct, setRakePct] = useState<number>(formatDefaultRake);
  const [rakeInput, setRakeInput] = useState<string>(formatDefaultRake.toFixed(1));
  useEffect(() => {
    setRakePct(formatDefaultRake);
  }, [formatDefaultRake]);
  useEffect(() => {
    setRakeInput(rakePct.toFixed(1));
  }, [rakePct]);
  const commitRakeInput = (raw: string) => {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      setRakePct(Math.max(0, Math.min(20, n)));
    } else {
      setRakeInput(rakePct.toFixed(1));
    }
  };

  const gameRoi = effectiveRoi;

  // Per-row σ breakdown — only populated in "exact" mode. Each entry is
  // {row index, AFS, ROI, format, count share, σ² share}.
  const exactBreakdown = useMemo(() => {
    if (effectiveMode !== "exact" || !schedule) return null;
    // In exact mode every row's own rake drives its σ rescale — the widget's
    // rake slider is hidden so there's nothing to override with.
    const totalCount = schedule.reduce(
      (acc, r) => acc + Math.max(0, r.count),
      0,
    );
    if (totalCount <= 0) return null;
    const perRow = schedule.map((row, i) => {
      const fmt = inferRowFormat(row);
      const { sigma } = sigmaRoiForRow(row);
      const w = Math.max(0, row.count) / totalCount;
      return {
        index: i,
        label: row.label || `#${i + 1}`,
        afs: row.players,
        roi: row.roi,
        format: fmt,
        weight: w,
        sigma,
        variance: sigma * sigma,
        varContribution: w * sigma * sigma,
      };
    });
    const totalVar = perRow.reduce((a, r) => a + r.varContribution, 0);
    const sigmaEff = Math.sqrt(Math.max(0, totalVar));
    return {
      perRow: perRow.map((r) => ({
        ...r,
        varShare: totalVar > 0 ? r.varContribution / totalVar : 0,
      })),
      sigmaEff,
    };
  }, [effectiveMode, schedule]);

  const rows = useMemo<Row[]>(() => {
    const afs = effectiveAfs;
    // Closed-form σ_ROI from the 18-field × 7-ROI fits (freeze: fit_beta.ts,
    // PKO: fit_beta_pko.ts). Entirely analytic — doesn't depend on any
    // simulation run, so this widget is usable before the user clicks "go".
    //
    //   σ_ROI(afs, roi) = (C0 + C1·roi) · afs^β           (per format)
    //   σ²_eff          = p·σ²_pko + (1−p)·σ²_freeze      (mix)
    //   k               = ⌈(z · σ_eff / target)²⌉
    //   fields          = k / afs
    // rake-rescale: fits baseline = FIT_RAKE (10%). σ_profit ≈ rake-invariant,
    // but σ_ROI = σ_profit / cost where cost = buyIn·(1+rake), so scale by
    // (1+FIT_RAKE)/(1+rake). At rake=0 this lifts σ by 10%; at rake=20% it
    // drops σ by ~8%. Same factor applies to every format.
    const rakeScale = (1 + FIT_RAKE) / (1 + rakePct / 100);
    const sigmaFor = (coef: typeof SIGMA_ROI_FREEZE): number =>
      Math.max(0, coef.C0 + coef.C1 * gameRoi) *
      Math.pow(Math.max(1, afs), coef.beta) *
      rakeScale;
    const sigmaFreeze = sigmaFor(SIGMA_ROI_FREEZE);
    const sigmaPko = sigmaFor(SIGMA_ROI_PKO);
    const sigmaMystery = sigmaFor(SIGMA_ROI_MYSTERY);
    const sigmaMysteryRoyale = sigmaFor(SIGMA_ROI_MYSTERY_ROYALE);
    // 3-way mix: σ²_mix = f_freeze·σ²_freeze + f_pko·σ²_pko + f_mystery·σ²_mystery.
    // Exact identity when each tournament is drawn independently from the pool
    // and all types share the same gameRoi (ROI is a single widget slider).
    const [fFreeze, fPko, fMystery] = mix;
    const sigmaRoiAvg =
      format === "mystery-royale"
        ? sigmaMysteryRoyale
        : format === "mystery"
          ? sigmaMystery
          : format === "pko"
            ? sigmaPko
            : format === "freeze"
              ? sigmaFreeze
              : Math.sqrt(
                  fFreeze * sigmaFreeze * sigmaFreeze +
                    fPko * sigmaPko * sigmaPko +
                    fMystery * sigmaMystery * sigmaMystery,
                );
    const sigmaRoi =
      effectiveMode === "exact" && exactBreakdown
        ? exactBreakdown.sigmaEff
        : sigmaRoiAvg;
    return TARGETS.map((target) => {
      const k = Math.ceil(Math.pow((z * sigmaRoi) / target, 2));
      return {
        targetPct: target,
        tourneys: k,
        fields: k / Math.max(1, afs),
      };
    });
  }, [
    effectiveAfs,
    z,
    gameRoi,
    mix,
    format,
    rakePct,
    effectiveMode,
    exactBreakdown,
    FIT_RAKE,
  ]);

  const fmtInt = (n: number): string => {
    if (!Number.isFinite(n)) return "—";
    if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
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
    { id: "mystery", labelKey: "chart.convergence.format.mystery" },
    {
      id: "mystery-royale",
      labelKey: "chart.convergence.format.mystery-royale",
    },
    { id: "mix", labelKey: "chart.convergence.format.mix" },
    { id: "exact", labelKey: "chart.convergence.format.exact" },
  ];
  return (
    <div className="overflow-x-auto">
      <div
        className="mb-3 flex items-center gap-3 text-[11px] text-[color:var(--color-fg-muted)]"
        title={
          effectiveMode === "exact" ? t("chart.convergence.mode.hint") : undefined
        }
      >
        <div className="flex flex-1 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] p-0.5">
          {FORMATS.map((f) => {
            const active = format === f.id;
            const disabled = f.id === "exact" && !hasSchedule;
            return (
              <button
                key={f.id}
                type="button"
                disabled={disabled}
                onClick={() => {
                  // Pin current AFS / ROI / CI so switching format never
                  // visually shifts them — lets the user A/B the σ tables
                  // at the same slider positions.
                  if (afsPosOverride == null) setAfsPosOverride(afsPos);
                  if (roiOverride == null) setRoiOverride(effectiveRoi);
                  setFormatOverride(f.id);
                }}
                className={`flex-1 whitespace-nowrap rounded px-1.5 py-1 text-[10px] uppercase tracking-wider transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  active
                    ? f.id === "exact"
                      ? "bg-emerald-500/20 text-emerald-200"
                      : "bg-fuchsia-500/20 text-fuchsia-200"
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
            setMixOverride(null);
          }}
          className="rounded border border-[color:var(--color-border)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider hover:bg-[color:var(--color-bg-elev)]"
          title={`reset to ${baselineFormat}${baselineFormat === "mix" ? ` (${Math.round(baselineMix[0] * 100)}/${Math.round(baselineMix[1] * 100)}/${Math.round(baselineMix[2] * 100)} freeze/PKO/mystery)` : ""}`}
        >
          ↺
        </button>
      </div>
      {format === "mix" && (
        <div className="mb-3 flex flex-col gap-1.5">
          <MixRow
            label={t("chart.convergence.format.freeze")}
            idx={0}
            mix={mix}
            accent="sky"
            onChange={updateMixComponent}
          />
          <MixRow
            label={t("chart.convergence.format.pko")}
            idx={1}
            mix={mix}
            accent="fuchsia"
            onChange={updateMixComponent}
          />
          <MixRow
            label={t("chart.convergence.format.mystery")}
            idx={2}
            mix={mix}
            accent="purple"
            onChange={updateMixComponent}
          />
        </div>
      )}
      {effectiveMode !== "exact" && (
      <div
        className={`mb-3 flex items-center gap-3 text-[11px] text-[color:var(--color-fg-muted)] ${
          afsLocked ? "opacity-60" : ""
        }`}
        title={afsLocked ? t("chart.convergence.afs.lockedBR") : undefined}
      >
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
          disabled={afsLocked}
          className="flex-1 accent-emerald-400 disabled:cursor-not-allowed"
          aria-label="AFS"
        />
        <input
          type="number"
          min={1}
          step={1}
          value={afsLocked ? String(BR_FIXED_AFS) : afsInput}
          onChange={(e) => setAfsInput(e.target.value)}
          onBlur={(e) => commitAfsInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitAfsInput((e.target as HTMLInputElement).value);
              (e.target as HTMLInputElement).blur();
            }
          }}
          disabled={afsLocked}
          className="w-20 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-1.5 py-0.5 text-center font-mono tabular-nums text-[color:var(--color-fg)] focus:border-emerald-400 focus:outline-none disabled:cursor-not-allowed"
          aria-label="AFS value"
        />
        <button
          type="button"
          onClick={() => setAfsPosOverride(null)}
          disabled={afsLocked}
          className="rounded border border-[color:var(--color-border)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider hover:bg-[color:var(--color-bg-elev)] disabled:cursor-not-allowed disabled:hover:bg-transparent"
          title={afsLocked ? "—" : `reset to ${fmtAfs(baseline.avgField)}`}
        >
          ↺
        </button>
      </div>
      )}
      {effectiveMode !== "exact" && (
      <div className="mb-3 flex items-center gap-3 text-[11px] text-[color:var(--color-fg-muted)]">
        <span className="w-8 shrink-0 whitespace-nowrap uppercase tracking-wider text-amber-400/80">
          ROI
        </span>
        <input
          type="range"
          min={roiMin * 100}
          max={roiMax * 100}
          step={0.5}
          value={effectiveRoi * 100}
          onChange={(e) => setRoiOverride(Number(e.target.value) / 100)}
          className="flex-1 accent-amber-400"
          aria-label="ROI"
        />
        <input
          type="number"
          min={roiMin * 100}
          max={roiMax * 100}
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
      )}
      {effectiveMode !== "exact" && (
      <div
        className="mb-3 flex items-center gap-3 text-[11px] text-[color:var(--color-fg-muted)]"
        title={t("chart.convergence.rake.title")}
      >
        <span className="w-8 shrink-0 whitespace-nowrap uppercase tracking-wider text-orange-400/80">
          {t("chart.convergence.rake")}
        </span>
        <input
          type="range"
          min={0}
          max={20}
          step={0.5}
          value={rakePct}
          onChange={(e) => setRakePct(Number(e.target.value))}
          className="flex-1 accent-orange-400"
          aria-label="Rake"
        />
        <input
          type="number"
          min={0}
          max={20}
          step={0.5}
          value={rakeInput}
          onChange={(e) => setRakeInput(e.target.value)}
          onBlur={(e) => commitRakeInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitRakeInput((e.target as HTMLInputElement).value);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-20 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-1.5 py-0.5 text-center font-mono tabular-nums text-[color:var(--color-fg)] focus:border-orange-400 focus:outline-none"
          aria-label="Rake percent"
        />
        <button
          type="button"
          onClick={() => setRakePct(formatDefaultRake)}
          className="rounded border border-[color:var(--color-border)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider hover:bg-[color:var(--color-bg-elev)]"
          title={`reset to ${formatDefaultRake.toFixed(1)}%`}
        >
          ↺
        </button>
      </div>
      )}
      <div className="mb-3 flex items-center gap-3 text-[11px] text-[color:var(--color-fg-muted)]">
        <span className="w-8 shrink-0 whitespace-nowrap uppercase tracking-wider text-sky-400/80">
          CI
        </span>
        <input
          type="range"
          min={75}
          max={99.9}
          step={0.1}
          value={ciPct}
          onChange={(e) => setCiPct(Number(e.target.value))}
          className="flex-1 accent-sky-400"
          aria-label="Confidence interval"
        />
        <input
          type="number"
          min={75}
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
          <col className="w-[112px]" />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
            <th className="py-1.5 pr-3 font-semibold whitespace-nowrap">
              {t("chart.convergence.col.target")}
            </th>
            <th className="py-1.5 px-3 text-right font-semibold whitespace-nowrap">
              {t("chart.convergence.col.tourneys")}
            </th>
            <th className="py-1.5 pl-3 text-right font-semibold whitespace-nowrap">
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
      {effectiveMode === "exact" && exactBreakdown && (
        <div className="mt-3 overflow-x-auto">
          <div className="mb-1 text-[11px] uppercase tracking-wider text-emerald-400/80">
            {t("chart.convergence.exact.breakdown")}
          </div>
          <table className="w-full border-collapse text-[11px] tabular-nums">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
                <th className="py-1 pr-2 font-semibold">
                  {t("chart.convergence.exact.rowCol.row")}
                </th>
                <th className="py-1 px-2 text-right font-semibold">
                  {t("chart.convergence.exact.rowCol.afs")}
                </th>
                <th className="py-1 px-2 text-right font-semibold">
                  {t("chart.convergence.exact.rowCol.roi")}
                </th>
                <th className="py-1 px-2 text-right font-semibold">
                  {t("chart.convergence.exact.rowCol.fmt")}
                </th>
                <th className="py-1 px-2 text-right font-semibold">
                  {t("chart.convergence.exact.rowCol.share")}
                </th>
                <th className="py-1 pl-2 text-right font-semibold">
                  {t("chart.convergence.exact.rowCol.varShare")}
                </th>
              </tr>
            </thead>
            <tbody>
              {exactBreakdown.perRow.map((r) => (
                <tr
                  key={r.index}
                  className="border-t border-[color:var(--color-border)]/50 text-[color:var(--color-fg-muted)]"
                >
                  <td className="py-1 pr-2 truncate max-w-[160px]">{r.label}</td>
                  <td className="py-1 px-2 text-right">{fmtAfs(r.afs)}</td>
                  <td className="py-1 px-2 text-right">
                    {(r.roi * 100).toFixed(1)}%
                  </td>
                  <td className="py-1 px-2 text-right">
                    {t(`chart.convergence.format.${r.format}` as DictKey)}
                  </td>
                  <td className="py-1 px-2 text-right">
                    {(r.weight * 100).toFixed(1)}%
                  </td>
                  <td className="py-1 pl-2 text-right text-emerald-300">
                    {(r.varShare * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-2 text-[10px] text-[color:var(--color-fg-dim)]">
        {t("chart.convergence.assumptions")}
      </div>
    </div>
  );
});

type MixAccent = "sky" | "fuchsia" | "purple";
const MIX_ACCENT_CLASSES: Record<
  MixAccent,
  { label: string; range: string; focus: string }
> = {
  sky: {
    label: "text-sky-400/80",
    range: "accent-sky-400",
    focus: "focus:border-sky-400",
  },
  fuchsia: {
    label: "text-fuchsia-400/80",
    range: "accent-fuchsia-400",
    focus: "focus:border-fuchsia-400",
  },
  purple: {
    label: "text-purple-400/80",
    range: "accent-purple-400",
    focus: "focus:border-purple-400",
  },
};

function MixRow({
  label,
  idx,
  mix,
  accent,
  onChange,
}: {
  label: string;
  idx: 0 | 1 | 2;
  mix: readonly [number, number, number];
  accent: MixAccent;
  onChange: (idx: 0 | 1 | 2, next: number) => void;
}) {
  const classes = MIX_ACCENT_CLASSES[accent];
  const pct = Math.round(mix[idx] * 100);
  const [raw, setRaw] = useState<string>(String(pct));
  useEffect(() => {
    setRaw(String(pct));
  }, [pct]);
  const commit = (s: string) => {
    const n = Number(s);
    if (Number.isFinite(n)) {
      onChange(idx, Math.max(0, Math.min(100, n)) / 100);
    } else {
      setRaw(String(pct));
    }
  };
  return (
    <div className="flex items-center gap-3 text-[11px] text-[color:var(--color-fg-muted)]">
      <span
        className={`w-14 shrink-0 whitespace-nowrap uppercase tracking-wider ${classes.label}`}
      >
        {label}
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={pct}
        onChange={(e) => onChange(idx, Number(e.target.value) / 100)}
        className={`flex-1 ${classes.range}`}
        aria-label={`${label} share`}
      />
      <input
        type="number"
        min={0}
        max={100}
        step={1}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit((e.target as HTMLInputElement).value);
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={`w-20 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-1.5 py-0.5 text-center font-mono tabular-nums text-[color:var(--color-fg)] outline-none ${classes.focus}`}
        aria-label={`${label} percent`}
      />
      <span className="w-[22px]" />
    </div>
  );
}
