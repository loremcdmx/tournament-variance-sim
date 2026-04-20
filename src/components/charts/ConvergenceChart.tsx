"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import type { DictKey, Locale } from "@/lib/i18n/dict";
import type { TournamentRow } from "@/lib/sim/types";
import {
  getConvergenceBandPolicy,
  inferRowFormat,
  type FitBoxSample,
} from "@/lib/sim/convergencePolicy";
import {
  evalSigma,
  SIGMA_ROI_FREEZE,
  SIGMA_ROI_MYSTERY,
  SIGMA_ROI_MYSTERY_ROYALE,
  SIGMA_ROI_PKO,
  sigmaRoiForRow,
  type SigmaCoef,
} from "@/lib/sim/convergenceFit";

interface Props {
  schedule?: TournamentRow[];
}

interface Row {
  targetPct: number;
  tourneys: number;
  tourneysLo: number;
  tourneysHi: number;
  fields: number;
  fieldsLo: number;
  fieldsHi: number;
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

// Per-format σ_ROI surface fits. Two families:
//
//   single-β:    σ = (C0 + C1·roi) · field^β
//   log-poly-2d: log σ = a0 + a1·L + a2·L² + b1·R + b2·R² + c·R·L
//                        (L = log field, R = roi)
//
// Single-β is the legacy form — three parameters, cheap, fits Freeze and MBR
// well within their measured ranges. PKO and Mystery have real curvature in
// both log-field and ROI that single-β cannot capture: on production 11×18
// sweeps (120k samples, seed-fixed) single-β leaves LOO xval mean |Δ/σ| of
// 12.7 % (PKO) and 10.7 % (Mystery) with p95 residual ≥ 24 %. A 200k-field
// probe sweep (2026-04-20) confirmed the form — not the range — is the
// bottleneck. 2D log-poly closes the gap: mean 4 %, p95 12 % (PKO) / 17 %
// (Mystery) on the same grid. Bandwidth-hiding policy in
// src/lib/sim/convergencePolicy.ts now only hides for Mystery — PKO's
// new residual is tight enough to show the numeric ±band honestly.
// k ∝ σ², so ±ε on σ → ±2ε on k.
//
// Fit inputs:
//   Freeze — mtt-standard + freeze-realdata-linear, 7 ROIs (−20 %..+80 %),
//     18 fields (50..50 000), rake 10 %. C1 ≈ 0 because the realdata-linear
//     CDF is empirically pinned, ROI only shifts mean not shape.
//   PKO — mtt-gg-bounty + pko-realdata-linear, bountyFraction=0.5,
//     pkoHeadVar=0.4, 11 ROIs (−20 %..+80 %, densified 5/15/25/30 %),
//     18 fields, rake 10 %. Bounty channel amplifies deep runs.
//   Mystery — mtt-gg-mystery + mystery-realdata-linear, bountyFraction=0.5,
//     mysteryBountyVariance=2.0 (post-#71 jackpot tail calibration),
//     pkoHeadVar=0.4, 11 ROIs, 18 fields, rake 10 %. Mystery σ(field) isn't
//     cleanly power-law: the top-9 harmonic envelope saturates σ at small
//     fields, then σ grows log-linearly past field ≈ 1000. Quadratic-in-L
//     term captures that bend.
//   Mystery Battle Royale — AFS-locked at 18 in the UI (see #93), so
//     field-sweep is degenerate. fit_br_fixed18.ts measures σ across 11
//     ROIs at AFS=18, linear-fits C(roi); β=0 bakes 18^β into C coefficients.
//     Rake 8 % (GGPoker's real-world rate since March 2024).
//
// Rake-rescale: fits are at format-specific FIT_RAKE (see FIT_RAKE_BY_FORMAT
// below). σ_profit is rake-invariant, σ_ROI = σ_profit / cost where
// cost = buyIn·(1+rake), so rescale by (1+FIT_RAKE)/(1+rake).
//
// Residuals: resid = LOO p95 |Δ/σ| from refit_2d_logpoly.ts
// (PKO/Mystery) or held-out xval (Freeze/MBR). k = ⌈(z·σ/target)²⌉, so
// a k±band of ±2ε comes from σ±ε.
//
// All canonical data in scripts/fit_beta_*.json. Refit tool:
// scripts/refit_2d_logpoly.ts (no new measurements, pure OLS re-fit).

type ConvergenceFormat =
  | "freeze"
  | "pko"
  | "mystery"
  | "mystery-royale"
  | "mix"
  | "exact";

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
function localeTag(locale: Locale): "ru-RU" | "en-US" {
  return locale === "ru" ? "ru-RU" : "en-US";
}
function fmtAfs(n: number, locale: Locale): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k`;
  return Math.round(n).toLocaleString(localeTag(locale));
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
  const { locale, t } = useLocale();

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
        const rowFormat = inferRowFormat(row);
        if (rowFormat === "mystery-royale") mysteryRoyaleCount += c;
        else if (rowFormat === "mystery") mysteryCount += c;
        else if (rowFormat === "pko") pkoCount += c;
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
      const { sigma, sigmaLo, sigmaHi } = sigmaRoiForRow(row);
      const w = Math.max(0, row.count) / totalCount;
      return {
        index: i,
        label: row.label || `#${i + 1}`,
        afs: row.players,
        roi: row.roi,
        format: fmt,
        weight: w,
        sigma,
        sigmaLo,
        sigmaHi,
        variance: sigma * sigma,
        varContribution: w * sigma * sigma,
        varContributionLo: w * sigmaLo * sigmaLo,
        varContributionHi: w * sigmaHi * sigmaHi,
      };
    });
    const totalVar = perRow.reduce((a, r) => a + r.varContribution, 0);
    const totalVarLo = perRow.reduce((a, r) => a + r.varContributionLo, 0);
    const totalVarHi = perRow.reduce((a, r) => a + r.varContributionHi, 0);
    const sigmaEff = Math.sqrt(Math.max(0, totalVar));
    const sigmaEffLo = Math.sqrt(Math.max(0, totalVarLo));
    const sigmaEffHi = Math.sqrt(Math.max(0, totalVarHi));
    return {
      perRow: perRow.map((r) => ({
        ...r,
        varShare: totalVar > 0 ? r.varContribution / totalVar : 0,
      })),
      sigmaEff,
      sigmaEffLo,
      sigmaEffHi,
    };
  }, [effectiveMode, schedule]);

  const rows = useMemo<Row[]>(() => {
    const afs = effectiveAfs;
    // Closed-form σ_ROI from the per-format sweeps described at the top of
    // this file. Entirely analytic — doesn't depend on any simulation run,
    // so this widget is usable before the user clicks "go".
    //
    //   freeze / MBR: σ_ROI = (C0 + C1·roi) · field^β
    //   PKO / Mystery: log σ = a0 + a1·L + a2·L² + b1·R + b2·R² + c·R·L
    //   σ²_eff = f_freeze·σ²_freeze + f_pko·σ²_pko + f_mystery·σ²_mystery  (mix)
    //   k      = ⌈(z · σ_eff / target)²⌉
    //   fields = k / afs
    // rake-rescale: fits baseline = FIT_RAKE (10 %, or 8 % for MBR).
    // σ_profit ≈ rake-invariant, but σ_ROI = σ_profit / cost where
    // cost = buyIn·(1+rake), so scale by (1+FIT_RAKE)/(1+rake). At rake=0
    // this lifts σ by 10 %; at rake=20 % it drops σ by ~8 %.
    const rakeScale = (1 + FIT_RAKE) / (1 + rakePct / 100);
    const sigmaFor = (coef: SigmaCoef): { s: number; lo: number; hi: number } => {
      const s = evalSigma(coef, afs, gameRoi) * rakeScale;
      return { s, lo: s * (1 - coef.resid), hi: s * (1 + coef.resid) };
    };
    const f = sigmaFor(SIGMA_ROI_FREEZE);
    const p = sigmaFor(SIGMA_ROI_PKO);
    const m = sigmaFor(SIGMA_ROI_MYSTERY);
    const mr = sigmaFor(SIGMA_ROI_MYSTERY_ROYALE);
    // 3-way mix: σ²_mix = f_freeze·σ²_freeze + f_pko·σ²_pko + f_mystery·σ²_mystery.
    // Exact identity when each tournament is drawn independently from the pool
    // and all types share the same gameRoi (ROI is a single widget slider).
    // Uncertainty bands propagate by composing σ_lo² / σ_hi² with the same
    // mixture weights — a conservative bound since per-format residuals are
    // treated as perfectly correlated (worst case for the mix width).
    const [fFreeze, fPko, fMystery] = mix;
    const pick = (
      key: "s" | "lo" | "hi",
    ): number =>
      format === "mystery-royale"
        ? mr[key]
        : format === "mystery"
          ? m[key]
          : format === "pko"
            ? p[key]
            : format === "freeze"
              ? f[key]
              : Math.sqrt(
                  fFreeze * f[key] * f[key] +
                    fPko * p[key] * p[key] +
                    fMystery * m[key] * m[key],
                );
    const sigmaRoi =
      effectiveMode === "exact" && exactBreakdown
        ? exactBreakdown.sigmaEff
        : pick("s");
    const sigmaRoiLo =
      effectiveMode === "exact" && exactBreakdown
        ? exactBreakdown.sigmaEffLo
        : pick("lo");
    const sigmaRoiHi =
      effectiveMode === "exact" && exactBreakdown
        ? exactBreakdown.sigmaEffHi
        : pick("hi");
    return TARGETS.map((target) => {
      const k = Math.ceil(Math.pow((z * sigmaRoi) / target, 2));
      const kLo = Math.ceil(Math.pow((z * sigmaRoiLo) / target, 2));
      const kHi = Math.ceil(Math.pow((z * sigmaRoiHi) / target, 2));
      const invAfs = 1 / Math.max(1, afs);
      return {
        targetPct: target,
        tourneys: k,
        tourneysLo: kLo,
        tourneysHi: kHi,
        fields: k * invAfs,
        fieldsLo: kLo * invAfs,
        fieldsHi: kHi * invAfs,
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

  // Enriched samples for the band policy — policy needs (format, field, roi)
  // per sample to judge both Mystery presence AND training-box validity.
  // Exact mode: one sample per schedule row (its own field + ROI).
  // Averaged/mix mode: samples sit at the slider position (effectiveAfs,
  // effectiveRoi); single-format → one sample; mix → one per active format
  // weight > 0, all at the same slider point.
  const fitBoxSamples = useMemo<readonly FitBoxSample[]>(() => {
    if (effectiveMode === "exact" && schedule) {
      return schedule.map((row) => ({
        format: inferRowFormat(row),
        field: Math.max(1, row.players),
        roi: row.roi,
      }));
    }
    if (
      format === "freeze" ||
      format === "pko" ||
      format === "mystery" ||
      format === "mystery-royale"
    ) {
      return [
        { format, field: effectiveAfs, roi: effectiveRoi },
      ];
    }
    const [fFreeze, fPko, fMystery] = mix;
    const list: FitBoxSample[] = [];
    if (fFreeze > 0)
      list.push({ format: "freeze", field: effectiveAfs, roi: effectiveRoi });
    if (fPko > 0)
      list.push({ format: "pko", field: effectiveAfs, roi: effectiveRoi });
    if (fMystery > 0)
      list.push({ format: "mystery", field: effectiveAfs, roi: effectiveRoi });
    return list;
  }, [effectiveMode, schedule, format, mix, effectiveAfs, effectiveRoi]);
  const bandPolicy = useMemo(
    () => getConvergenceBandPolicy(fitBoxSamples),
    [fitBoxSamples],
  );
  const showBand = bandPolicy.kind === "numeric";

  const fmtInt = (n: number): string => {
    if (!Number.isFinite(n)) return "—";
    if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
    return Math.round(n).toLocaleString(localeTag(locale));
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
          title={afsLocked ? "—" : `reset to ${fmtAfs(baseline.avgField, locale)}`}
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
      {bandPolicy.kind === "warning" && (
        <div className="mb-2 rounded border border-amber-400/40 bg-amber-400/5 px-2 py-1.5 text-[11px] leading-snug text-amber-200">
          {t(
            bandPolicy.reason === "contains-mystery"
              ? "chart.convergence.bandWarning.mystery"
              : "chart.convergence.bandWarning.outsideFitBox",
          )}
        </div>
      )}
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
          {rows.map((row) => {
            const kRel = row.tourneys > 0
              ? Math.max(
                  (row.tourneys - row.tourneysLo) / row.tourneys,
                  (row.tourneysHi - row.tourneys) / row.tourneys,
                )
              : 0;
            const kPct = Math.round(kRel * 100);
            const kBandLabel = showBand && kPct > 0
              ? `±${kPct}% (${fmtInt(row.tourneysLo)}–${fmtInt(row.tourneysHi)})`
              : undefined;
            const fBandLabel = showBand && kPct > 0
              ? `${fmtField(row.fieldsLo)}–${fmtField(row.fieldsHi)}`
              : undefined;
            return (
              <tr
                key={row.targetPct}
                className="border-t border-[color:var(--color-border)]/50 text-[color:var(--color-fg)]"
              >
                <td className="py-1.5 pr-3 font-semibold">
                  ±{(row.targetPct * 100).toFixed(row.targetPct < 0.01 ? 1 : 0)}%
                </td>
                <td
                  className="py-1.5 px-3 text-right"
                  title={kBandLabel}
                >
                  {fmtInt(row.tourneys)}
                  {showBand && kPct > 0 && (
                    <span className="ml-1 text-[10px] text-[color:var(--color-fg-dim)]">
                      ±{kPct}%
                    </span>
                  )}
                </td>
                <td
                  className="py-1.5 pl-3 text-right text-[color:var(--color-accent)]"
                  title={fBandLabel}
                >
                  {fmtField(row.fields)}
                </td>
              </tr>
            );
          })}
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
                  <td className="py-1 px-2 text-right">{fmtAfs(r.afs, locale)}</td>
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
