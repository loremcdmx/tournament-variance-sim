"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { FinishModelId } from "@/lib/sim/types";
import { finishModelSupportsTargetRoi } from "@/lib/sim/finishModel";
import type { ProgressStage } from "@/lib/sim/useSimulation";
import { useT } from "@/lib/i18n/LocaleProvider";
import { useAdvancedMode } from "@/lib/ui/AdvancedModeProvider";
import { computeRemainingMs } from "@/lib/ui/etaEstimator";
import {
  COMPLETING_HOLD_MS,
  type BarState,
  barFillPercent,
  nextBarState,
  progressPercent,
} from "@/lib/ui/progressBarState";
import { Card } from "./ui/Section";
import { InfoTooltip } from "./ui/Tooltip";

export interface ControlsState {
  scheduleRepeats: number;
  samples: number;
  bankroll: number;
  seed: number;
  finishModelId: FinishModelId;
  alphaOverride: number | null;
  compareWithPrimedope: boolean;
  /**
   * When true, the PrimeDope comparison pass also substitutes PD's native
   * payout curve. Default false — both passes use the user's selected
   * payout so the A/B diff isolates the finish-model effect.
   */
  usePrimedopePayouts: boolean;
  /** Keep PD's binary-ITM (uniform-over-paid) finish model on the PD pane. */
  usePrimedopeFinishModel: boolean;
  /** Keep PD's post-rake-pool variance quirk on the PD pane. */
  usePrimedopeRakeMath: boolean;
  /** Twin-run mode: "random" = two seeds, same model; "primedope" = same seed, our vs uniform-lift. */
  compareMode: "random" | "primedope";
  /**
   * One-sigma uncertainty on your ROI estimate, as a fraction. E.g. 0.05
   * = "maybe my true ROI is ±5 pp from what I think". Zero by default.
   */
  roiStdErr: number;
  /** Three-level ROI shock σ — see types.ts SimulationInput for semantics. */
  roiShockPerTourney: number;
  roiShockPerSession: number;
  roiDriftSigma: number;
  /** Tilt mechanics — see types.ts. */
  tiltFastGain: number;
  tiltFastScale: number;
  tiltSlowGain: number;
  tiltSlowThreshold: number;
  tiltSlowMinDuration: number;
  tiltSlowRecoveryFrac: number;
  /** Active model preset id. "custom" when user has hand-tuned. */
  modelPresetId: string;
  /** Global player ITM% default. Applied to every row that doesn't carry
   *  an explicit per-row `itmRate` override. Whole-number percent. */
  itmGlobalEnabled: boolean;
  itmGlobalPct: number;
  /** Global rakeback, as a whole-number % of rake paid back per entry.
   *  Engine adds `(rakebackPct/100) × row.rake × row.buyIn` to each bullet's
   *  profit. Pure deterministic shift — σ is untouched. */
  rakebackPct: number;
  /**
   * Empirical histogram buckets in arbitrary units. Parsed out of CSV /
   * paste upload — each line is one finishing position from a real
   * tournament history. Used only when finishModelId === "empirical".
   */
  empiricalBuckets?: number[];
}

interface DoneSummary {
  mean: number;
  median: number;
  roi: number;
  probProfit: number;
  riskOfRuin: number;
  worstDrawdown: number;
  longestCashlessWorst: number;
  elapsedMs: number | null;
  resultsAnchorId: string;
}

interface Props {
  value: ControlsState;
  onChange: (next: ControlsState) => void;
  onRun: () => void;
  onCancel: () => void;
  running: boolean;
  progress: number;
  /**
   * Current pipeline phase while running. Surfaced as a small label under
   * the progress bar so 82→99% isn't a silent stall — the bar moves slowly
   * through envelopes/streaks on large S, and the label is what tells the
   * user the sim is still live rather than hung.
   */
  stage?: ProgressStage | null;
  /** Projected run duration in ms, or null when no prior run exists. */
  estimatedMs?: number | null;
  /** Tournaments in one schedule pass before repeat expansion. */
  tournamentsPerSchedule: number;
  /** Actual tournaments per sample after rounding to full schedule repeats. */
  tournamentsPerSession: number;
  /** When a run has just finished, a compact snapshot to display under the
   * run button so the user sees *something* happened without scrolling to
   * the full results section below. Null while running or before first run. */
  doneSummary?: DoneSummary | null;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString("ru-RU");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms / 100) * 100)} мс`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} с`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} с`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s === 0 ? `${m} мин` : `${m} мин ${s} с`;
}

// Pre-launch ETA is a per-machine guess based on one prior run's rate; showing
// "9.3 с" implies a precision we don't have. Round coarsely so the label
// reads as orientation, not a promise.
function formatRoughDuration(ms: number): string {
  if (ms < 2000) return "~1 с";
  if (ms < 15_000) return `${Math.round(ms / 1000)} с`;
  if (ms < 60_000) return `${Math.round(ms / 5000) * 5} с`;
  const m = Math.floor(ms / 60_000);
  const remSec = Math.round((ms % 60_000) / 10_000) * 10;
  return remSec === 0 ? `${m} мин` : `${m} мин ${remSec} с`;
}

export const ControlsPanel = memo(function ControlsPanel({
  value,
  onChange,
  onRun,
  onCancel,
  running,
  progress,
  stage,
  estimatedMs,
  tournamentsPerSchedule,
  tournamentsPerSession,
  doneSummary,
}: Props) {
  const t = useT();
  const { advanced } = useAdvancedMode();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [empError, setEmpError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Track elapsed-since-run-start via interval-driven state. The start
  // timestamp is captured inside the effect closure, so nothing impure
  // runs in render and no ref is read during render.
  const [runElapsedMs, setRunElapsedMs] = useState<number | null>(null);
  useEffect(() => {
    if (!running) return undefined;
    const start = performance.now();
    // Clear any stale value from the previous run *before* the first interval
    // tick. Otherwise `useRemainingMs` sees elapsed=<prev final> on the first
    // render of the new run and computes a nonsense ETA that counts down from
    // a wrong anchor until the 250 ms tick repairs it.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors external run-start edge; one-shot reset, no cascade.
    setRunElapsedMs(0);
    const id = window.setInterval(() => {
      setRunElapsedMs(performance.now() - start);
    }, 250);
    return () => window.clearInterval(id);
  }, [running]);
  // Bar state transitions live in `progressBarState.ts` (pure, unit-tested).
  // The only React-owned concern here is the `completing → hidden` timeout.
  const [barState, setBarState] = useState<BarState>("hidden");
  useEffect(() => {
    const next = nextBarState({ running, progress, prev: barState });
    if (next !== barState) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors external run state onto UI mount flag; deliberate sync, not derived.
      setBarState(next);
    }
    if (next !== "completing") return undefined;
    const id = window.setTimeout(() => setBarState("hidden"), COMPLETING_HOLD_MS);
    return () => window.clearTimeout(id);
  }, [running, progress, barState]);
  const barVisible = barState !== "hidden";
  // Remount the filled portion on each new-run edge so a previously-completed
  // bar (frozen at 100 %) doesn't animate 100 → 0 via CSS width transition
  // when the next run starts. Incrementing a key on the false→true edge is
  // enough — React replaces the node, starting fresh at 0 %.
  const [runToken, setRunToken] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bumps a remount key on the !running → running edge; no cascade (running is external state).
    if (running) setRunToken((t) => t + 1);
  }, [running]);
  const remainingMs = useRemainingMs({ running, runElapsedMs, progress, estimatedMs });
  const scheduleTournaments = Math.max(1, Math.round(tournamentsPerSchedule));
  const totalTournaments = Math.max(0, Math.round(tournamentsPerSession));
  const maxTournamentsPerSample = scheduleTournaments * 100_000;
  const seedLabel = `0x${(value.seed >>> 0).toString(16).padStart(8, "0")}`;
  const showSeedLabel = running || !!doneSummary;
  const set = <K extends keyof ControlsState>(k: K, v: ControlsState[K]) =>
    onChange({ ...value, [k]: v });
  const setTournamentTarget = (target: number) => {
    const roundedTarget = Math.max(scheduleTournaments, Math.floor(target));
    const repeats = Math.max(1, Math.ceil(roundedTarget / scheduleTournaments));
    set("scheduleRepeats", repeats);
  };

  const handleEmpiricalPaste = (raw: string) => {
    setEmpError(null);
    // Caps to keep a pasted 100-MB file from pegging the main thread and to
    // stop a malicious buckets[Number.MAX_SAFE_INTEGER-1] allocation.
    const MAX_ENTRIES = 500_000;
    const MAX_PLACE = 100_000;
    const positions: number[] = [];
    for (const tok of raw.split(/[\s,;]+/)) {
      if (positions.length >= MAX_ENTRIES) break;
      if (!/^\d+$/.test(tok)) continue;
      const n = Number(tok);
      if (!Number.isFinite(n) || n < 1 || n > MAX_PLACE) continue;
      positions.push(n);
    }
    if (positions.length === 0) {
      onChange({ ...value, empiricalBuckets: undefined });
      return;
    }
    let maxPlace = 0;
    for (const p of positions) if (p > maxPlace) maxPlace = p;
    const buckets = new Array<number>(maxPlace).fill(0);
    for (const p of positions) buckets[p - 1] += 1;
    onChange({ ...value, empiricalBuckets: buckets });
  };

  const handleFile = async (file: File) => {
    const MAX_FILE_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_FILE_BYTES) {
      setEmpError(t("controls.empFileError"));
      return;
    }
    try {
      const text = await file.text();
      handleEmpiricalPaste(text);
    } catch {
      setEmpError(t("controls.empFileError"));
    }
  };

  // Mark the model as customized any time a model-related field changes
  // through the panel. The preset selector itself sets modelPresetId
  // explicitly, so it short-circuits this path.
  const setModel = <K extends keyof ControlsState>(k: K, v: ControlsState[K]) =>
    onChange({ ...value, [k]: v, modelPresetId: "custom" });

  return (
    <Card className="p-5">
      <fieldset
        disabled={running}
        className="contents disabled:opacity-60 [&:disabled_*]:cursor-not-allowed"
      >
      {/* Run controls: target tournaments per sample, samples */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t("controls.scheduleRepeats")} hint={t("help.scheduleRepeats")}>
          <>
            <NumInput
              value={totalTournaments}
              min={scheduleTournaments}
              max={maxTournamentsPerSample}
              step={scheduleTournaments}
              onChange={setTournamentTarget}
            />
            <div className="mt-1 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fg-dim)]">
              {t("controls.scheduleRepeatsComputed")}: {formatCount(value.scheduleRepeats)}
            </div>
          </>
        </Field>
        <Field label={t("controls.samples")} hint={t("help.samples")}>
          <NumInput
            value={value.samples}
            min={100}
            max={1_000_000}
            step={1000}
            onChange={(v) => set("samples", Math.floor(v))}
          />
        </Field>
      </div>

      {advanced && (
      <button
        type="button"
        onClick={() => setShowAdvanced((s) => !s)}
        className="mt-5 w-full border border-dashed border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
      >
        {showAdvanced ? t("controls.collapseAdvanced") : t("controls.expandAdvanced")}
      </button>
      )}

      {advanced && showAdvanced && (
      <>
      {/* Advanced run knobs: seed + PD compare */}
      <SectionTitle>{t("controls.section.advanced")}</SectionTitle>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Seed is auto-randomized per run — field removed from UI */}
        <Field label={t("controls.compareMode")} hint={t("help.compareMode")}>
          <select
            value={value.compareMode}
            onChange={(e) =>
              set("compareMode", e.target.value as "random" | "primedope")
            }
            className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 text-sm text-[color:var(--color-fg)] outline-none transition-colors hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)]"
          >
            <option value="random">{t("controls.compareMode.random")}</option>
            <option value="primedope">{t("controls.compareMode.primedope")}</option>
          </select>
        </Field>
      </div>
      {/* Section B — Skill model (how ROI maps to finish positions) */}
      <SectionTitle>{t("controls.section.skill")}</SectionTitle>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Field label={t("controls.finishModel")} hint={t("help.finishModel")}>
          <select
            value={value.finishModelId}
            onChange={(e) =>
              setModel("finishModelId", e.target.value as FinishModelId)
            }
            className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 text-sm text-[color:var(--color-fg)] outline-none transition-colors hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)]"
          >
            <option value="power-law">Power-law</option>
            <option value="linear-skill">Linear skill</option>
            <option value="stretched-exp">Stretched-exp</option>
            <option value="plackett-luce">Plackett-Luce</option>
            <option value="uniform">Uniform</option>
            <option value="empirical">Empirical (CSV)</option>
            <option value="freeze-realdata-step">Freeze / real-data — step</option>
            <option value="freeze-realdata-linear">Freeze / real-data — linear</option>
            <option value="freeze-realdata-tilt">Freeze / real-data — tilt (α)</option>
            <option value="pko-realdata-step">PKO / real-data — step</option>
            <option value="pko-realdata-linear">PKO / real-data — linear</option>
            <option value="pko-realdata-tilt">PKO / real-data — tilt (α)</option>
            <option value="powerlaw-realdata-influenced">Power-law — real-data α</option>
          </select>
          {!finishModelSupportsTargetRoi(value.finishModelId) && (
            <div className="mt-1 text-[10px] uppercase tracking-wider text-amber-400/80">
              {t("controls.finishModel.referenceShape")}
            </div>
          )}
        </Field>
        <Field label={t("controls.alphaOverride")} hint={t("help.alphaOverride")}>
          <input
            type="number"
            step={value.finishModelId === "freeze-realdata-tilt" || value.finishModelId === "pko-realdata-tilt" ? 0.05 : 0.1}
            min={value.finishModelId === "freeze-realdata-tilt" || value.finishModelId === "pko-realdata-tilt" ? -0.5 : 0.1}
            max={value.finishModelId === "freeze-realdata-tilt" || value.finishModelId === "pko-realdata-tilt" ? 0.5 : 10}
            value={value.alphaOverride ?? ""}
            placeholder={t("controls.alphaPlaceholder")}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                setModel("alphaOverride", null);
                return;
              }
              const v = Number(raw);
              if (!Number.isFinite(v)) return;
              const isTilt = value.finishModelId === "freeze-realdata-tilt" || value.finishModelId === "pko-realdata-tilt";
              const lo = isTilt ? -0.5 : 0.1;
              const hi = isTilt ? 0.5 : 10;
              if (v < lo || v > hi) return;
              setModel("alphaOverride", v);
            }}
            className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 text-sm tabular-nums text-[color:var(--color-fg)] outline-none transition-colors hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)] placeholder:text-[color:var(--color-fg-dim)]"
          />
        </Field>
        <Field label={t("controls.roiStdErr")} hint={t("help.roiStdErr")}>
          <NumInput
            value={value.roiStdErr}
            min={0}
            max={5}
            step={0.01}
            onChange={(v) => setModel("roiStdErr", v)}
          />
        </Field>
      </div>

      {/* Sections C (shocks) and D (tilt) hidden — engine code intact,
         values stay at 0 from defaults. Re-enable after testing. */}
      </>
      )}

      {advanced && showAdvanced && value.finishModelId === "empirical" && (
        <div className="mt-4 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11px] font-medium uppercase tracking-wider text-[color:var(--color-fg-muted)]">
              {t("emp.title")}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-[color:var(--color-fg-dim)]">
              {value.empiricalBuckets && value.empiricalBuckets.length > 0 ? (
                <span>
                  {t("emp.loaded")}:{" "}
                  <span className="tabular-nums text-[color:var(--color-fg)]">
                    {value.empiricalBuckets.reduce((a, b) => a + b, 0)}
                  </span>{" "}
                  {t("emp.entries")}
                </span>
              ) : (
                <span>{t("emp.none")}</span>
              )}
              <button
                type="button"
                onClick={() => onChange({ ...value, empiricalBuckets: undefined })}
                className="rounded border border-[color:var(--color-border)] px-2 py-0.5 text-[10px] hover:border-[color:var(--color-border-strong)] hover:text-[color:var(--color-fg)]"
              >
                {t("emp.clear")}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <textarea
              rows={3}
              placeholder={t("emp.paste")}
              onChange={(e) => handleEmpiricalPaste(e.target.value)}
              className="resize-none rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-2.5 py-2 font-mono text-xs text-[color:var(--color-fg)] outline-none transition-colors hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)] placeholder:text-[color:var(--color-fg-dim)]"
            />
            <div className="flex flex-col items-start gap-2 text-xs text-[color:var(--color-fg-dim)]">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-3 py-1.5 text-[11px] font-medium text-[color:var(--color-fg-muted)] hover:border-[color:var(--color-border-strong)] hover:text-[color:var(--color-fg)]"
              >
                {t("controls.uploadCSV")}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt,text/plain"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              <div className="leading-relaxed">{t("controls.empHint")}</div>
              {empError && <div className="text-[color:var(--color-danger)]">{empError}</div>}
            </div>
          </div>
        </div>
      )}

      </fieldset>
      <div className="mt-5 flex flex-col gap-3 border-t border-[color:var(--color-border)] pt-4">
        <div className="flex flex-col items-center gap-3">
          {running ? (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-rose-500 to-rose-600 px-5 text-sm font-semibold text-white shadow-[0_1px_0_0_rgba(255,255,255,0.2)_inset,0_8px_24px_-8px_rgba(244,63,94,0.45)] transition-all hover:from-rose-400 hover:to-rose-500 active:translate-y-px"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
              {t("controls.stop")} {progressPercent(progress)}%
            </button>
          ) : (
            <button
              type="button"
              onClick={onRun}
              className="primary-run-button inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-indigo-500 to-indigo-600 px-5 text-sm font-semibold text-white shadow-[0_1px_0_0_rgba(255,255,255,0.2)_inset,0_8px_24px_-8px_rgba(99,102,241,0.5)] transition-all hover:from-indigo-400 hover:to-indigo-500 active:translate-y-px"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M6 4l14 8-14 8V4z" fill="currentColor" />
              </svg>
              {t("controls.run")}
            </button>
          )}
          <div className="flex w-full items-center justify-center gap-4 font-mono text-[12px] font-semibold tabular-nums text-[color:var(--color-fg-muted)]">
            <span className="inline-flex min-h-[1em] items-center gap-1">
              {running
                ? remainingMs == null
                  ? t("controls.starting")
                  : remainingMs < 800
                  ? t("controls.finishing")
                  : (
                    <>
                      <span>{t("controls.remaining")}</span>
                      <span className="relative -top-px text-[11px] leading-none">
                        ≈
                      </span>
                      <span>{formatDuration(remainingMs)}</span>
                    </>
                  )
                : estimatedMs != null && estimatedMs > 0
                ? (
                  <>
                    <span>{t("controls.eta")}</span>
                    <span className="relative -top-px text-[11px] leading-none">
                      ≈
                    </span>
                    <span>{formatRoughDuration(estimatedMs)}</span>
                  </>
                )
                : "\u00A0"}
            </span>
            <span className="text-[color:var(--color-fg-dim)]">·</span>
            <span>
              {formatCount(totalTournaments)} {t("controls.totalTourneys")}
            </span>
          </div>
          <div
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-fg-dim)]"
            title={t("help.seed")}
          >
            {t("controls.seed")}:{" "}
            <span className="tracking-normal text-[color:var(--color-fg-muted)]">
              {showSeedLabel ? seedLabel : t("controls.seedAuto")}
            </span>
          </div>
        </div>
        {barVisible && (
          <>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--color-bg)]">
              <div
                key={runToken}
                className="h-full bg-gradient-to-r from-indigo-500 to-indigo-300"
                style={{ width: barFillPercent(barState, progress) }}
              />
            </div>
            {barState === "running" && stage && (
              <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-fg-dim)]">
                {t(`controls.stage.${stage}`)}
              </div>
            )}
          </>
        )}
        {!running && doneSummary && (
          <DoneSummaryBlock summary={doneSummary} />
        )}
      </div>
    </Card>
  );
});

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 mt-5 flex items-center gap-2 first:mt-4">
      <div className="h-px flex-1 bg-[color:var(--color-border)]" />
      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--color-fg-dim)]">
        {children}
      </span>
      <div className="h-px flex-1 bg-[color:var(--color-border)]" />
    </div>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  // h-full + mt-auto pushes the input to the bottom of the grid cell so
  // wrapping labels (e.g. "Сколько сессий сыграем") don't shove their
  // input down and break horizontal alignment with neighbouring fields.
  return (
    <label className="flex h-full flex-col gap-1.5">
      <span className="flex items-start justify-center gap-1.5 text-center text-[10px] font-medium uppercase leading-tight tracking-[0.15em] text-[color:var(--color-fg-dim)]">
        {label}
        {hint && <InfoTooltip content={hint} />}
      </span>
      <div className="mt-auto">{children}</div>
    </label>
  );
}

function NumInput({
  value,
  onChange,
  step,
  min,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  // Local draft lets the user fully clear the field or type a below-min
  // number mid-edit without us force-correcting each keystroke. Parent state
  // only updates when the draft parses to a number inside [min, max]; on
  // blur we either commit a clamped value or revert to the last good one.
  const [draft, setDraft] = useState<string | null>(null);
  const display =
    draft !== null ? draft : Number.isFinite(value) ? String(value) : "";

  let invalid = false;
  if (draft !== null) {
    if (draft.trim() === "") {
      invalid = true;
    } else {
      const v = Number(draft);
      if (!Number.isFinite(v)) invalid = true;
      else if (min !== undefined && v < min) invalid = true;
      else if (max !== undefined && v > max) invalid = true;
    }
  }

  return (
    <input
      type="number"
      value={display}
      min={min}
      max={max}
      step={step}
      inputMode="decimal"
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        if (raw.trim() === "") return;
        const v = Number(raw);
        if (!Number.isFinite(v)) return;
        if (min !== undefined && v < min) return;
        if (max !== undefined && v > max) return;
        onChange(v);
      }}
      onBlur={() => {
        if (draft === null) return;
        const v = Number(draft);
        if (!Number.isFinite(v)) {
          setDraft(null);
          return;
        }
        const lo = min ?? -Infinity;
        const hi = max ?? Infinity;
        const clamped = Math.min(hi, Math.max(lo, v));
        if (clamped !== value) onChange(clamped);
        setDraft(null);
      }}
      className={`w-full rounded-md border bg-[color:var(--color-bg)] px-2 py-1.5 text-center text-[13px] tabular-nums text-[color:var(--color-fg)] outline-none transition-colors focus:border-[color:var(--color-accent)] ${
        invalid
          ? "border-rose-500/70 ring-1 ring-rose-500/30"
          : "border-[color:var(--color-border)] hover:border-[color:var(--color-border-strong)]"
      }`}
    />
  );
}

function fmtMoneyCompact(v: number): string {
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  if (abs === 0) return "$0";
  return `${sign}$${abs.toFixed(0)}`;
}

function useRemainingMs(opts: {
  running: boolean;
  runElapsedMs: number | null;
  progress: number;
  estimatedMs: number | null | undefined;
}): number | null {
  const { running, runElapsedMs, progress, estimatedMs } = opts;
  const [smoothed, setSmoothed] = useState<number | null>(null);
  const smoothedRef = useRef<number | null>(null);
  const lastSmoothAt = useRef<number | null>(null);

  useEffect(() => {
    if (running) return;
    smoothedRef.current = null;
    lastSmoothAt.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets ETA display when run ends; sync with external run lifecycle.
    setSmoothed(null);
  }, [running]);

  useEffect(() => {
    if (!running || runElapsedMs == null) return;
    const now = performance.now();
    const dt = lastSmoothAt.current == null ? 0 : now - lastSmoothAt.current;
    lastSmoothAt.current = now;
    const next = computeRemainingMs({
      elapsedMs: runElapsedMs,
      progress,
      estimatedMs,
      prevSmoothedMs: smoothedRef.current,
      dtMs: dt,
    });
    if (next == null) return;
    smoothedRef.current = next;
    const frame = requestAnimationFrame(() => setSmoothed(next));
    return () => cancelAnimationFrame(frame);
  }, [running, runElapsedMs, progress, estimatedMs]);

  return smoothed;
}

function DoneSummaryBlock({ summary }: { summary: DoneSummary }) {
  const t = useT();
  const meanPositive = summary.mean >= 0;
  const scrollToResults = () => {
    const el = document.getElementById(summary.resultsAnchorId);
    if (el)
      el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-300">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {t("controls.done.label")}
          {summary.elapsedMs != null && (
            <span className="font-mono text-[color:var(--color-fg-dim)]">
              · {formatDuration(summary.elapsedMs)}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={scrollToResults}
          className="flex items-center gap-1 text-[10.5px] font-semibold text-emerald-300 transition-colors hover:text-emerald-200"
        >
          {t("controls.done.seeBelow")} ↓
        </button>
      </div>
      <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 font-mono text-[11px] tabular-nums sm:grid-cols-6">
        <div className="flex flex-col">
          <span className="text-[9px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
            {t("controls.done.profit")}
          </span>
          <span
            className={`font-semibold ${
              meanPositive ? "text-emerald-300" : "text-rose-300"
            }`}
          >
            {fmtMoneyCompact(summary.mean)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
            ROI
          </span>
          <span
            className={`font-semibold ${
              summary.roi >= 0 ? "text-emerald-300" : "text-rose-300"
            }`}
          >
            {(summary.roi * 100).toFixed(1)}%
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
            {t("controls.done.upChance")}
          </span>
          <span className="font-semibold text-[color:var(--color-fg)]">
            {(summary.probProfit * 100).toFixed(0)}%
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
            {t("controls.done.ruin")}
          </span>
          <span
            className={`font-semibold ${
              summary.riskOfRuin > 0.05
                ? "text-rose-300"
                : "text-[color:var(--color-fg)]"
            }`}
          >
            {(summary.riskOfRuin * 100).toFixed(1)}%
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
            {t("controls.done.worstDD")}
          </span>
          <span className="font-semibold text-rose-300">
            {fmtMoneyCompact(summary.worstDrawdown)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
            {t("controls.done.dryStreak")}
          </span>
          <span className="font-semibold text-amber-300">
            {summary.longestCashlessWorst}
          </span>
        </div>
      </div>
    </div>
  );
}
