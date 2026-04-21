"use client";

import { memo, useMemo, useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import type { DictKey } from "@/lib/i18n/dict";
import type { SimulationInput, TournamentRow } from "@/lib/sim/types";
import {
  getConvergenceBandPolicy,
  inferRowFormat,
  type FitBoxSample,
} from "@/lib/sim/convergencePolicy";
import {
  AFS_MAX,
  AFS_MIN,
  afsToPos,
  buildExactBreakdown,
  ciToZ,
  computeConvergenceRows,
  fmtAfs,
  formatPointRange,
  isRoiControlActive,
  normalizeMix,
  posToAfs,
  roiControlBoundsForFormat,
  SIGMA_ROI_MYSTERY_ROYALE,
  type ConvergenceFormat,
  type MixTuple,
  type SigmaBand,
} from "@/lib/sim/convergenceMath";

interface Props {
  schedule?: TournamentRow[];
  finishModel?: SimulationInput["finishModel"];
}

const FORMAT_TAB_ACCENTS: Record<
  ConvergenceFormat,
  { text: string; border: string; bg: string; rail: string }
> = {
  freeze: {
    text: "#c4b5fd",
    border: "rgba(167,139,250,0.42)",
    bg: "rgba(139,92,246,0.18)",
    rail: "rgba(196,181,253,0.85)",
  },
  pko: {
    text: "#fb7185",
    border: "rgba(251,113,133,0.42)",
    bg: "rgba(251,113,133,0.16)",
    rail: "rgba(253,164,175,0.88)",
  },
  mystery: {
    text: "#38bdf8",
    border: "rgba(56,189,248,0.42)",
    bg: "rgba(14,165,233,0.16)",
    rail: "rgba(125,211,252,0.9)",
  },
  "mystery-royale": {
    text: "#f59e0b",
    border: "rgba(245,158,11,0.45)",
    bg: "rgba(245,158,11,0.16)",
    rail: "rgba(252,211,77,0.9)",
  },
  mix: {
    text: "#34d399",
    border: "rgba(52,211,153,0.42)",
    bg: "rgba(16,185,129,0.16)",
    rail: "rgba(110,231,183,0.9)",
  },
  exact: {
    text: "#86efac",
    border: "rgba(74,222,128,0.42)",
    bg: "rgba(34,197,94,0.16)",
    rail: "rgba(134,239,172,0.9)",
  },
};

function RangeBandValue({
  pointLabel,
  loLabel,
  hiLabel,
  showRange,
  title,
  accent = false,
  align = "right",
}: {
  pointLabel: string;
  loLabel: string;
  hiLabel: string;
  showRange: boolean;
  title?: string;
  accent?: boolean;
  align?: "right" | "left";
}) {
  if (!showRange) {
    return (
      <span
        className={
          accent
            ? "inline-flex items-center rounded border border-[color:var(--color-accent)]/45 bg-[color:var(--color-accent)]/15 px-1 py-0.5 font-mono text-[10.5px] font-bold leading-none text-[color:var(--color-accent)]"
            : "inline-flex items-center rounded border border-sky-300/45 bg-sky-300/15 px-1 py-0.5 font-mono text-[10.5px] font-bold leading-none text-sky-200"
        }
      >
        {pointLabel}
      </span>
    );
  }

  return (
    <div
      className={`min-w-0 ${align === "left" ? "text-left" : "text-right"}`}
      title={title}
      aria-label={title}
    >
      <div className="relative mb-1.5 h-2 px-1.5" aria-hidden="true">
        <div className="absolute inset-x-1.5 top-1/2 h-px -translate-y-1/2 bg-[color:var(--color-fg-dim)]/55" />
        <div className="absolute left-1.5 top-1/2 h-2 w-px -translate-y-1/2 bg-[color:var(--color-fg-dim)]/80" />
        <div className="absolute right-1.5 top-1/2 h-2 w-px -translate-y-1/2 bg-[color:var(--color-fg-dim)]/80" />
        <div className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[color:var(--color-bg)] bg-[color:var(--color-accent)] shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_24%,transparent)]" />
      </div>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5 font-mono tabular-nums">
        <span className="whitespace-nowrap text-left text-[9px] leading-none text-[color:var(--color-fg-dim)]">
          {loLabel}
        </span>
        <span
          className={
            accent
              ? "rounded border border-[color:var(--color-accent)]/45 bg-[color:var(--color-accent)]/15 px-1.5 py-0.5 text-[10.5px] font-bold leading-none text-[color:var(--color-accent)]"
              : "rounded border border-sky-300/45 bg-sky-300/15 px-1.5 py-0.5 text-[10.5px] font-bold leading-none text-sky-200"
          }
        >
          {pointLabel}
        </span>
        <span className="whitespace-nowrap text-right text-[9px] leading-none text-[color:var(--color-fg-dim)]">
          {hiLabel}
        </span>
      </div>
    </div>
  );
}

export const ConvergenceChart = memo(function ConvergenceChart({
  schedule,
  finishModel,
}: Props) {
  const { locale, t } = useLocale();
  const numberLocale = locale === "ru" ? "ru-RU" : "en-US";

  // Baseline avgField / roi are taken from the current schedule when present;
  // if the user hasn't loaded a schedule yet, fall back to neutral defaults
  // (1000-player field, +10 % ROI) so the widget is fully usable before any
  // simulation has been run. Bounty tabs use promoted runtime fits; freeze
  // uses a synthetic single-row runtime compile at the chosen AFS / ROI.
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
  const [ciDraft, setCiDraft] = useState<string | null>(null);
  const ciInput = ciDraft ?? String(ciPct);
  const commitCiInput = (raw: string) => {
    setCiDraft(null);
    const n = Number(raw);
    if (Number.isFinite(n)) {
      setCiPct(Math.max(75, Math.min(99.9, n)));
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

  // Format-dependent ROI bounds. Bounty formats are clipped to their validated
  // training boxes, so regular UI controls cannot land on a point where the
  // range band must be hidden as extrapolation. effectiveRoi is clamped on read
  // so the user's preferred ROI is preserved across format switches.
  const { min: roiMin, max: roiMax } = roiControlBoundsForFormat(format);
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
  const [afsDraft, setAfsDraft] = useState<string | null>(null);
  const afsInput = afsDraft ?? String(Math.round(effectiveAfs));
  const commitAfsInput = (raw: string) => {
    setAfsDraft(null);
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      const clamped = Math.max(AFS_MIN, Math.min(AFS_MAX, n));
      setAfsPosOverride(afsToPos(clamped));
    }
  };

  const [roiDraft, setRoiDraft] = useState<string | null>(null);
  const roiInput = roiDraft ?? (effectiveRoi * 100).toFixed(1);
  const commitRoiInput = (raw: string) => {
    setRoiDraft(null);
    const n = Number(raw);
    if (Number.isFinite(n)) {
      const clamped = Math.max(roiMin, Math.min(roiMax, n / 100));
      setRoiOverride(clamped);
    }
  };

  // Rake — fraction of buy-in taken by the room. Fit-based tabs were measured
  // at format-specific baselines (see scripts/fit_sigma_parallel.ts): 10% for
  // PKO/mystery, 8% for Mystery Battle Royale. Those tabs rescale σ by
  // (1+FIT_RAKE_format)/(1+rake). Freeze now compiles a runtime single-row
  // model directly at the chosen rake, so it doesn't rely on a promoted fit.
  // Default rake still snaps to a realistic baseline on format switch, and
  // users can slide away from it.
  const formatDefaultRake = format === "mystery-royale" ? 8 : 10;
  const [rakeOverridePct, setRakeOverridePct] = useState<number | null>(null);
  const rakePct = rakeOverridePct ?? formatDefaultRake;
  const [rakeDraft, setRakeDraft] = useState<string | null>(null);
  const rakeInput = rakeDraft ?? rakePct.toFixed(1);
  const commitRakeInput = (raw: string) => {
    setRakeDraft(null);
    const n = Number(raw);
    if (Number.isFinite(n)) {
      setRakeOverridePct(Math.max(0, Math.min(20, n)));
    }
  };

  const gameRoi = effectiveRoi;
  const roiControlActive = isRoiControlActive(format, effectiveMode, mix);

  // Per-row σ breakdown — only populated in "exact" mode. Each entry carries
  // the row's compiled field summary plus cost-share / σ²-share diagnostics.
  const exactBreakdown = useMemo(() => {
    if (effectiveMode !== "exact" || !schedule) return null;
    // In exact mode every row's own rake drives its σ rescale — the widget's
    // rake slider is hidden so there's nothing to override with.
    return buildExactBreakdown(schedule, { finishModel });
  }, [effectiveMode, schedule, finishModel]);
  const freezeSigmaOverride = useMemo<SigmaBand | null>(() => {
    if (effectiveMode === "exact") return null;
    if (format !== "freeze" && format !== "mix") return null;
    const syntheticFreeze = buildExactBreakdown(
      [
        {
          id: "convergence-freeze-runtime",
          label: "Freeze",
          players: Math.max(2, Math.round(effectiveAfs)),
          buyIn: 10,
          rake: rakePct / 100,
          roi: effectiveRoi,
          payoutStructure: "mtt-standard",
          gameType: "freezeout",
          count: 1,
        },
      ],
      { finishModel },
    );
    if (!syntheticFreeze) return null;
    return {
      s: syntheticFreeze.sigmaEff,
      lo: syntheticFreeze.sigmaEff,
      hi: syntheticFreeze.sigmaEff,
    };
  }, [effectiveMode, format, effectiveAfs, rakePct, effectiveRoi, finishModel]);
  const battleRoyaleSigmaOverride = useMemo<SigmaBand | null>(() => {
    if (effectiveMode === "exact") return null;
    if (format !== "mystery-royale") return null;
    const syntheticBattleRoyale = buildExactBreakdown(
      [
        {
          id: "convergence-br-runtime",
          label: "Battle Royale",
          players: BR_FIXED_AFS,
          buyIn: 50,
          rake: rakePct / 100,
          roi: effectiveRoi,
          payoutStructure: "battle-royale",
          gameType: "mystery-royale",
          bountyFraction: 0.5,
          mysteryBountyVariance: 1.8,
          pkoHeadVar: 0,
          itmRate: 0.18,
          count: 1,
        },
      ],
      { finishModel },
    );
    if (!syntheticBattleRoyale) return null;
    const resid = SIGMA_ROI_MYSTERY_ROYALE.resid;
    return {
      s: syntheticBattleRoyale.sigmaEff,
      lo: syntheticBattleRoyale.sigmaEff * (1 - resid),
      hi: syntheticBattleRoyale.sigmaEff * (1 + resid),
    };
  }, [effectiveMode, format, rakePct, effectiveRoi, finishModel]);
  const sigmaOverrides = useMemo<
    Partial<Record<"freeze" | "pko" | "mystery" | "mystery-royale", SigmaBand>> | undefined
  >(() => {
    const overrides: Partial<
      Record<"freeze" | "pko" | "mystery" | "mystery-royale", SigmaBand>
    > = {};
    if (freezeSigmaOverride) overrides.freeze = freezeSigmaOverride;
    if (battleRoyaleSigmaOverride) {
      overrides["mystery-royale"] = battleRoyaleSigmaOverride;
    }
    return Object.keys(overrides).length > 0 ? overrides : undefined;
  }, [freezeSigmaOverride, battleRoyaleSigmaOverride]);

  const rows = useMemo(() => {
    return computeConvergenceRows({
      afs: effectiveAfs,
      z,
      roi: gameRoi,
      mix,
      format,
      rakePct,
      exactBreakdown,
      sigmaOverrides,
    });
  }, [
    effectiveAfs,
    z,
    gameRoi,
    mix,
    format,
    rakePct,
    exactBreakdown,
    sigmaOverrides,
  ]);

  const fitBoxSamples = useMemo<readonly FitBoxSample[]>(() => {
    if (effectiveMode === "exact") return [];
    if (
      format === "freeze" ||
      format === "pko" ||
      format === "mystery" ||
      format === "mystery-royale"
    ) {
      return [{ format, field: effectiveAfs, roi: effectiveRoi }];
    }
    const [fFreeze, fPko, fMystery] = mix;
    const list: FitBoxSample[] = [];
    if (fFreeze > 0) {
      list.push({ format: "freeze", field: effectiveAfs, roi: effectiveRoi });
    }
    if (fPko > 0) {
      list.push({ format: "pko", field: effectiveAfs, roi: effectiveRoi });
    }
    if (fMystery > 0) {
      list.push({ format: "mystery", field: effectiveAfs, roi: effectiveRoi });
    }
    return list;
  }, [effectiveMode, format, mix, effectiveAfs, effectiveRoi]);
  const bandPolicy = useMemo(
    () => (effectiveMode === "exact" ? null : getConvergenceBandPolicy(fitBoxSamples)),
    [effectiveMode, fitBoxSamples],
  );
  const showBand = bandPolicy?.kind === "numeric";

  const fmtInt = (n: number): string => {
    if (!Number.isFinite(n)) return "—";
    if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 1 : 2)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 1 : 2)}M`;
    if (n >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
    return Math.round(n).toLocaleString(numberLocale);
  };
  const fmtField = (n: number): string => {
    if (!Number.isFinite(n)) return "—";
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k×`;
    if (n >= 100) return `${Math.round(n)}×`;
    if (n >= 10) return `${n.toFixed(1)}×`;
    return `${n.toFixed(2)}×`;
  };
  const fmtExactField = (row: {
    afs: number;
    fieldMin: number;
    fieldMax: number;
  }): string => {
    if (
      row.fieldMin > 0 &&
      row.fieldMax > 0 &&
      Math.abs(row.fieldMax - row.fieldMin) > 1e-9
    ) {
      return `${fmtAfs(row.fieldMin, numberLocale)}–${fmtAfs(row.fieldMax, numberLocale)}`;
    }
    return fmtAfs(row.afs, numberLocale);
  };
  const displayRows = rows.map((row) => {
    const showTourneysRange = showBand && row.tourneysLo !== row.tourneysHi;
    const showFieldsRange = showBand && row.fieldsLo !== row.fieldsHi;
    const tourneysPointLabel = fmtInt(row.tourneys);
    const tourneysLoLabel = fmtInt(row.tourneysLo);
    const tourneysHiLabel = fmtInt(row.tourneysHi);
    const fieldsPointLabel = fmtField(row.fields);
    const fieldsLoLabel = fmtField(row.fieldsLo);
    const fieldsHiLabel = fmtField(row.fieldsHi);
    const tourneysLabel = formatPointRange(
      tourneysPointLabel,
      tourneysLoLabel,
      tourneysHiLabel,
      showTourneysRange,
    );
    const fieldsLabel = formatPointRange(
      fieldsPointLabel,
      fieldsLoLabel,
      fieldsHiLabel,
      showFieldsRange,
    );
    const targetLabel = `±${(row.targetPct * 100).toFixed(
      row.targetPct < 0.01 ? 1 : 0,
    )}%`;
    return {
      ...row,
      targetLabel,
      showTourneysRange,
      showFieldsRange,
      tourneysPointLabel,
      tourneysLoLabel,
      tourneysHiLabel,
      fieldsPointLabel,
      fieldsLoLabel,
      fieldsHiLabel,
      tourneysLabel,
      fieldsLabel,
    };
  });

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
    <div className="overflow-hidden">
      <div
        className="mb-3 flex flex-col gap-2 text-[11px] text-[color:var(--color-fg-muted)] sm:flex-row sm:items-center sm:gap-3"
        title={
          effectiveMode === "exact" ? t("chart.convergence.mode.hint") : undefined
        }
      >
        <div className="grid flex-1 grid-cols-2 gap-1 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)]/80 p-1 min-[560px]:grid-cols-3 lg:grid-cols-6">
          {FORMATS.map((f) => {
            const active = format === f.id;
            const disabled = f.id === "exact" && !hasSchedule;
            const accent = FORMAT_TAB_ACCENTS[f.id];
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
                  setRakeOverridePct(null);
                  setRakeDraft(null);
                  setFormatOverride(f.id);
                }}
                className={`relative w-full whitespace-nowrap rounded-md border px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                  active
                    ? "shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                    : "border-transparent bg-transparent text-[color:var(--color-fg-muted)] hover:border-[color:var(--color-border)] hover:bg-[color:var(--color-bg)]/55 hover:text-[color:var(--color-fg)]"
                }`}
                style={
                  active
                    ? {
                        color: accent.text,
                        borderColor: accent.border,
                        backgroundColor: accent.bg,
                      }
                    : undefined
                }
              >
                <span
                  className="pointer-events-none absolute inset-x-2 top-1 h-px rounded-full opacity-70"
                  style={{ backgroundColor: accent.rail }}
                  aria-hidden
                />
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
            setRakeOverridePct(null);
            setRakeDraft(null);
          }}
          className="self-end rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/55 px-2 py-1 text-[10px] uppercase tracking-[0.14em] hover:bg-[color:var(--color-bg-elev)] sm:self-auto"
          title={`reset to ${baselineFormat}${baselineFormat === "mix" ? ` (${Math.round(baselineMix[0] * 100)}/${Math.round(baselineMix[1] * 100)}/${Math.round(baselineMix[2] * 100)} freeze/PKO/mystery)` : ""}`}
        >
          ↺
        </button>
      </div>
      {format === "mix" && (
        <div className="mb-3">
          <div className="flex flex-col gap-1.5">
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
          <div className="mt-1 text-[10px] leading-snug text-[color:var(--color-fg-dim)]">
            {t("chart.convergence.mix.note")}
          </div>
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
          onChange={(e) => {
            const next = Number(e.target.value);
            setAfsPosOverride(Math.max(0, Math.min(1, next)));
          }}
          disabled={afsLocked}
          className="flex-1 accent-emerald-400 disabled:cursor-not-allowed"
          aria-label="AFS"
        />
        <input
          type="number"
          min={afsLocked ? BR_FIXED_AFS : AFS_MIN}
          max={afsLocked ? BR_FIXED_AFS : AFS_MAX}
          step={1}
          value={afsLocked ? String(BR_FIXED_AFS) : afsInput}
          onFocus={(e) => setAfsDraft(e.currentTarget.value)}
          onChange={(e) => setAfsDraft(e.target.value)}
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
          title={afsLocked ? "—" : `reset to ${fmtAfs(baseline.avgField, numberLocale)}`}
        >
          ↺
        </button>
      </div>
      )}
      {effectiveMode !== "exact" && roiControlActive && (
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
            onFocus={(e) => setRoiDraft(e.currentTarget.value)}
            onChange={(e) => setRoiDraft(e.target.value)}
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
      {effectiveMode !== "exact" && !roiControlActive && (
        <div className="mb-3 flex items-center gap-3 text-[11px] text-[color:var(--color-fg-muted)]">
          <span className="w-8 shrink-0 whitespace-nowrap uppercase tracking-wider text-amber-400/80">
            ROI
          </span>
          <span className="text-[color:var(--color-fg-dim)]">
            {t("chart.convergence.roi.invariant")}
          </span>
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
          onChange={(e) => {
            setRakeDraft(null);
            setRakeOverridePct(Number(e.target.value));
          }}
          className="flex-1 accent-orange-400"
          aria-label="Rake"
        />
        <input
          type="number"
          min={0}
          max={20}
          step={0.5}
          value={rakeInput}
          onFocus={(e) => setRakeDraft(e.currentTarget.value)}
          onChange={(e) => setRakeDraft(e.target.value)}
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
          onClick={() => {
            setRakeOverridePct(null);
            setRakeDraft(null);
          }}
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
          onFocus={(e) => setCiDraft(e.currentTarget.value)}
          onChange={(e) => setCiDraft(e.target.value)}
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
      {effectiveMode === "exact" && exactBreakdown && (
        <div className="mb-2 rounded border border-emerald-400/30 bg-emerald-400/5 px-2 py-1.5 text-[11px] leading-snug text-emerald-200">
          {t("chart.convergence.exact.pointOnly")}{" "}
          <span className="font-mono text-emerald-100">
            {fmtAfs(exactBreakdown.avgField, numberLocale)}
          </span>
        </div>
      )}
      {bandPolicy?.kind === "warning" && (
        <div className="mb-2 rounded border border-amber-400/40 bg-amber-400/5 px-2 py-1.5 text-[11px] leading-snug text-amber-200">
          {t(
            bandPolicy.reason === "contains-mystery"
              ? "chart.convergence.bandWarning.containsMystery"
              : "chart.convergence.bandWarning.outsideFitBox",
          )}
        </div>
      )}
      <div className="space-y-2 sm:hidden">
        {displayRows.map((row) => (
          <div
            key={row.targetPct}
            className="rounded-md border border-[color:var(--color-border)]/70 bg-[color:var(--color-bg-elev)]/35 px-3 py-2.5"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-fg-dim)]">
                {t("chart.convergence.col.target")}
              </div>
              <div className="rounded-md border border-[color:var(--color-border)]/70 bg-[color:var(--color-bg)]/55 px-2 py-1 font-mono text-[12px] font-semibold text-[color:var(--color-fg)]">
                {row.targetLabel}
              </div>
            </div>
            <div className="mt-2 grid gap-2">
              <div className="rounded-md border border-[color:var(--color-border)]/60 bg-[color:var(--color-bg)]/45 px-2.5 py-2">
                <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-fg-dim)]">
                  {t("chart.convergence.col.tourneys")}
                </div>
                <RangeBandValue
                  pointLabel={row.tourneysPointLabel}
                  loLabel={row.tourneysLoLabel}
                  hiLabel={row.tourneysHiLabel}
                  showRange={row.showTourneysRange}
                  title={row.showTourneysRange ? row.tourneysLabel : undefined}
                  align="left"
                />
              </div>
              <div className="rounded-md border border-[color:var(--color-border)]/60 bg-[color:var(--color-bg)]/45 px-2.5 py-2">
                <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-fg-dim)]">
                  {t("chart.convergence.col.fields")}
                </div>
                <RangeBandValue
                  pointLabel={row.fieldsPointLabel}
                  loLabel={row.fieldsLoLabel}
                  hiLabel={row.fieldsHiLabel}
                  showRange={row.showFieldsRange}
                  title={row.showFieldsRange ? row.fieldsLabel : undefined}
                  accent
                  align="left"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[600px] table-fixed border-collapse text-[12px] tabular-nums">
          <colgroup>
            <col className="w-[104px]" />
            <col />
            <col className="w-[168px]" />
          </colgroup>
          <thead>
            <tr className="text-left text-[9px] uppercase tracking-[0.08em] text-[color:var(--color-fg-dim)]">
              <th className="py-1.5 pr-3 font-semibold whitespace-nowrap">
                {t("chart.convergence.col.target")}
              </th>
              <th className="py-1.5 px-2.5 text-right font-semibold whitespace-nowrap">
                {t("chart.convergence.col.tourneys")}
              </th>
              <th className="py-1.5 pl-2.5 text-right font-semibold whitespace-nowrap">
                {t("chart.convergence.col.fields")}
              </th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row) => (
              <tr
                key={row.targetPct}
                className="border-t border-[color:var(--color-border)]/50 text-[color:var(--color-fg)]"
              >
                <td className="py-1.5 pr-3 font-semibold">
                  {row.targetLabel}
                </td>
                <td
                  className="py-2 px-2.5 text-right align-middle"
                  title={row.showTourneysRange ? row.tourneysLabel : undefined}
                >
                  <RangeBandValue
                    pointLabel={row.tourneysPointLabel}
                    loLabel={row.tourneysLoLabel}
                    hiLabel={row.tourneysHiLabel}
                    showRange={row.showTourneysRange}
                    title={row.showTourneysRange ? row.tourneysLabel : undefined}
                  />
                </td>
                <td
                  className="py-2 pl-2.5 text-right align-middle"
                  title={row.showFieldsRange ? row.fieldsLabel : undefined}
                >
                  <RangeBandValue
                    pointLabel={row.fieldsPointLabel}
                    loLabel={row.fieldsLoLabel}
                    hiLabel={row.fieldsHiLabel}
                    showRange={row.showFieldsRange}
                    title={row.showFieldsRange ? row.fieldsLabel : undefined}
                    accent
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {effectiveMode === "exact" && exactBreakdown && (
        <div className="mt-3">
          <div className="mb-1 text-[11px] uppercase tracking-wider text-emerald-400/80">
            {t("chart.convergence.exact.breakdown")}
          </div>
          <div className="space-y-2 sm:hidden">
            {exactBreakdown.perRow.map((r) => (
              <div
                key={r.index}
                className="rounded-md border border-[color:var(--color-border)]/70 bg-[color:var(--color-bg-elev)]/35 px-3 py-2.5"
              >
                <div className="truncate text-[12px] font-semibold text-[color:var(--color-fg)]">
                  {r.label}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-[color:var(--color-fg-muted)]">
                  <div className="rounded-md border border-[color:var(--color-border)]/60 bg-[color:var(--color-bg)]/45 px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fg-dim)]">
                      {t("chart.convergence.exact.rowCol.afs")}
                    </div>
                    <div className="mt-1 font-mono text-[color:var(--color-fg)]">
                      {fmtExactField(r)}
                    </div>
                  </div>
                  <div className="rounded-md border border-[color:var(--color-border)]/60 bg-[color:var(--color-bg)]/45 px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fg-dim)]">
                      {t("chart.convergence.exact.rowCol.roi")}
                    </div>
                    <div className="mt-1 font-mono text-[color:var(--color-fg)]">
                      {(r.roi * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div className="rounded-md border border-[color:var(--color-border)]/60 bg-[color:var(--color-bg)]/45 px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fg-dim)]">
                      {t("chart.convergence.exact.rowCol.share")}
                    </div>
                    <div className="mt-1 font-mono text-[color:var(--color-fg)]">
                      {(r.costShare * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div className="rounded-md border border-emerald-400/35 bg-emerald-400/10 px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-emerald-200/80">
                      {t("chart.convergence.exact.rowCol.varShare")}
                    </div>
                    <div className="mt-1 font-mono text-emerald-200">
                      {(r.varShare * 100).toFixed(1)}%
                    </div>
                  </div>
                </div>
                <div className="mt-2 text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fg-dim)]">
                  {t(`chart.convergence.format.${r.format}` as DictKey)}
                </div>
              </div>
            ))}
          </div>
          <div className="hidden overflow-x-auto sm:block">
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
                    <td className="max-w-[160px] truncate py-1 pr-2">{r.label}</td>
                    <td className="py-1 px-2 text-right">{fmtExactField(r)}</td>
                    <td className="py-1 px-2 text-right">
                      {(r.roi * 100).toFixed(1)}%
                    </td>
                    <td className="py-1 px-2 text-right">
                      {t(`chart.convergence.format.${r.format}` as DictKey)}
                    </td>
                    <td className="py-1 px-2 text-right">
                      {(r.costShare * 100).toFixed(1)}%
                    </td>
                    <td className="py-1 pl-2 text-right text-emerald-300">
                      {(r.varShare * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="mt-3 rounded-md border border-[color:var(--color-border)]/60 bg-[color:var(--color-bg-elev)]/25 px-3 py-2.5 text-[11px] leading-relaxed text-[color:var(--color-fg-dim)] sm:mt-2 sm:border-transparent sm:bg-transparent sm:px-0 sm:py-0 sm:text-[10px] sm:leading-snug">
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
  const [rawDraft, setRawDraft] = useState<string | null>(null);
  const raw = rawDraft ?? String(pct);
  const commit = (s: string) => {
    setRawDraft(null);
    const n = Number(s);
    if (Number.isFinite(n)) {
      onChange(idx, Math.max(0, Math.min(100, n)) / 100);
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
        onFocus={(e) => setRawDraft(e.currentTarget.value)}
        onChange={(e) => setRawDraft(e.target.value)}
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
