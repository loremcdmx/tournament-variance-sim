"use client";

import { memo, useMemo, useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import type { DictKey } from "@/lib/i18n/dict";
import type { TournamentRow } from "@/lib/sim/types";
import {
  getConvergenceBandPolicy,
  inferRowFormat,
  type FitBoxSample,
} from "@/lib/sim/convergencePolicy";
import {
  afsToPos,
  buildExactBreakdown,
  ciToZ,
  computeConvergenceRows,
  fmtAfs,
  formatPointRange,
  isRoiControlActive,
  normalizeMix,
  posToAfs,
  ROI_MAX_DEFAULT,
  ROI_MAX_MBR,
  ROI_MIN_DEFAULT,
  ROI_MIN_MBR,
  type ConvergenceFormat,
  type MixTuple,
} from "@/lib/sim/convergenceMath";

interface Props {
  schedule?: TournamentRow[];
}

export const ConvergenceChart = memo(function ConvergenceChart({
  schedule,
}: Props) {
  const { locale, t } = useLocale();
  const numberLocale = locale === "ru" ? "ru-RU" : "en-US";

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
  const [afsDraft, setAfsDraft] = useState<string | null>(null);
  const afsInput = afsDraft ?? String(Math.round(effectiveAfs));
  const commitAfsInput = (raw: string) => {
    setAfsDraft(null);
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      setAfsPosOverride(afsToPos(n));
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

  // Rake — fraction of buy-in taken by the room. σ fits were measured at
  // format-specific baselines (see scripts/fit_sigma_parallel.ts): 10% for
  // freeze/PKO/mystery, 8% for Mystery Battle Royale (GGPoker's actual
  // rake since March 2024). We rescale by (1+FIT_RAKE_format)/(1+rake) —
  // σ_profit is ~rake-invariant but σ_ROI divides by cost basis
  // buyIn·(1+rake), so higher rake compresses ROI-unit σ.
  // Default rake snaps to format's real-world baseline on format switch —
  // matches "as-fit" σ for that format without relying on the rake-rescale
  // to do compensation work at every render. Users can still slide away.
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

  // Per-row σ breakdown — only populated in "exact" mode. Each entry is
  // {row index, AFS, ROI, format, count share, σ² share}.
  const exactBreakdown = useMemo(() => {
    if (effectiveMode !== "exact" || !schedule) return null;
    // In exact mode every row's own rake drives its σ rescale — the widget's
    // rake slider is hidden so there's nothing to override with.
    return buildExactBreakdown(schedule);
  }, [effectiveMode, schedule]);

  const rows = useMemo(() => {
    return computeConvergenceRows({
      afs: effectiveAfs,
      z,
      roi: gameRoi,
      mix,
      format,
      rakePct,
      exactBreakdown,
    });
  }, [
    effectiveAfs,
    z,
    gameRoi,
    mix,
    format,
    rakePct,
    exactBreakdown,
  ]);

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
    return Math.round(n).toLocaleString(numberLocale);
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
                  setRakeOverridePct(null);
                  setRakeDraft(null);
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
            setRakeOverridePct(null);
            setRakeDraft(null);
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
            const showTourneysRange =
              showBand && row.tourneysLo !== row.tourneysHi;
            const showFieldsRange =
              showBand && row.fieldsLo !== row.fieldsHi;
            const tourneysLabel = formatPointRange(
              fmtInt(row.tourneys),
              fmtInt(row.tourneysLo),
              fmtInt(row.tourneysHi),
              showTourneysRange,
            );
            const fieldsLabel = formatPointRange(
              fmtField(row.fields),
              fmtField(row.fieldsLo),
              fmtField(row.fieldsHi),
              showFieldsRange,
            );
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
                  title={showTourneysRange ? tourneysLabel : undefined}
                >
                  {tourneysLabel}
                </td>
                <td
                  className="py-1.5 pl-3 text-right text-[color:var(--color-accent)]"
                  title={showFieldsRange ? fieldsLabel : undefined}
                >
                  {fieldsLabel}
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
                  <td className="py-1 px-2 text-right">{fmtAfs(r.afs, numberLocale)}</td>
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
