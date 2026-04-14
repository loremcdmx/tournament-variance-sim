"use client";

import { useRef, useState } from "react";
import type { FinishModelId } from "@/lib/sim/types";
import { useT } from "@/lib/i18n/LocaleProvider";
import { Card } from "./ui/Section";
import { InfoTooltip } from "./ui/Tooltip";
import { ModelPresetSelector } from "./ModelPresetSelector";

export interface ControlsState {
  scheduleRepeats: number;
  samples: number;
  bankroll: number;
  seed: number;
  finishModelId: FinishModelId;
  alphaOverride: number | null;
  compareWithPrimedope: boolean;
  /** Twin-run mode: "random" = two seeds, same model; "primedope" = same seed, our vs uniform-lift. */
  compareMode: "random" | "primedope";
  /** Match PrimeDope's (incorrect) buy-in-only EV calc on the comparison run. */
  primedopeStyleEV: boolean;
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
  /**
   * Empirical histogram buckets in arbitrary units. Parsed out of CSV /
   * paste upload — each line is one finishing position from a real
   * tournament history. Used only when finishModelId === "empirical".
   */
  empiricalBuckets?: number[];
}

interface Props {
  value: ControlsState;
  onChange: (next: ControlsState) => void;
  onRun: () => void;
  onCancel: () => void;
  running: boolean;
  progress: number;
  /** Projected run duration in ms, or null when no prior run exists. */
  estimatedMs?: number | null;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms / 100) * 100)} мс`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} с`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} с`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s === 0 ? `${m} мин` : `${m} мин ${s} с`;
}

export function ControlsPanel({
  value,
  onChange,
  onRun,
  onCancel,
  running,
  progress,
  estimatedMs,
}: Props) {
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [empError, setEmpError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const set = <K extends keyof ControlsState>(k: K, v: ControlsState[K]) =>
    onChange({ ...value, [k]: v });

  const handleEmpiricalPaste = (raw: string) => {
    setEmpError(null);
    const positions = raw
      .split(/[\s,;]+/)
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isFinite(n) && n >= 1);
    if (positions.length === 0) {
      onChange({ ...value, empiricalBuckets: undefined });
      return;
    }
    const maxPlace = Math.max(...positions);
    const buckets = new Array<number>(maxPlace).fill(0);
    for (const p of positions) buckets[p - 1] += 1;
    onChange({ ...value, empiricalBuckets: buckets });
  };

  const handleFile = async (file: File) => {
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
      <ModelPresetSelector value={value} onChange={onChange} />

      {/* Section A — Run controls (streak-grinder primary: sessions, samples, bankroll) */}
      <SectionTitle>{t("controls.section.run")}</SectionTitle>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label={t("controls.scheduleRepeats")} hint={t("help.scheduleRepeats")}>
          <NumInput
            value={value.scheduleRepeats}
            min={1}
            step={1}
            onChange={(v) => set("scheduleRepeats", Math.max(1, Math.floor(v)))}
          />
        </Field>
        <Field label={t("controls.samples")} hint={t("help.samples")}>
          <NumInput
            value={value.samples}
            min={100}
            step={1000}
            onChange={(v) => set("samples", Math.max(100, Math.floor(v)))}
          />
        </Field>
        <Field label={t("controls.bankroll")} hint={t("help.bankroll")}>
          <NumInput
            value={value.bankroll}
            min={0}
            step={100}
            onChange={(v) => set("bankroll", Math.max(0, v))}
          />
        </Field>
      </div>

      <button
        type="button"
        onClick={() => setShowAdvanced((s) => !s)}
        className="mt-5 w-full border border-dashed border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-fg-muted)] transition-colors hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
      >
        {showAdvanced ? t("controls.collapseAdvanced") : t("controls.expandAdvanced")}
      </button>

      {showAdvanced && (
      <>
      {/* Advanced run knobs: seed + PD compare */}
      <SectionTitle>{t("controls.section.advanced")}</SectionTitle>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label={t("controls.seed")} hint={t("help.seed")}>
          <div className="flex gap-1">
            <NumInput
              value={value.seed}
              min={0}
              step={1}
              onChange={(v) => set("seed", Math.max(0, Math.floor(v)))}
            />
            <button
              type="button"
              onClick={() => set("seed", Math.floor(Math.random() * 2 ** 30))}
              className="shrink-0 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
              title={t("controls.seedReroll")}
            >
              ⟳
            </button>
          </div>
        </Field>
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
      <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-[color:var(--color-fg-muted)]">
        <input
          type="checkbox"
          checked={value.primedopeStyleEV}
          onChange={(e) => set("primedopeStyleEV", e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-[color:var(--color-accent)]"
        />
        <span>
          <span className="font-medium text-[color:var(--color-fg)]">
            {t("controls.pdStyleEV.label")}
          </span>{" "}
          — {t("controls.pdStyleEV.body")}{" "}
          <span className="text-[color:var(--color-fg-dim)]">
            {t("controls.pdStyleEV.caveat")}
          </span>
        </span>
      </label>

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
          </select>
        </Field>
        <Field label={t("controls.alphaOverride")} hint={t("help.alphaOverride")}>
          <input
            type="number"
            step={0.1}
            value={value.alphaOverride ?? ""}
            placeholder={t("controls.alphaPlaceholder")}
            onChange={(e) => {
              const v = e.target.value;
              setModel("alphaOverride", v === "" ? null : parseFloat(v));
            }}
            className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 text-sm tabular-nums text-[color:var(--color-fg)] outline-none transition-colors hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)] placeholder:text-[color:var(--color-fg-dim)]"
          />
        </Field>
        <Field label={t("controls.roiStdErr")} hint={t("help.roiStdErr")}>
          <NumInput
            value={value.roiStdErr}
            min={0}
            step={0.01}
            onChange={(v) => setModel("roiStdErr", Math.max(0, v))}
          />
        </Field>
      </div>

      {/* Section C — Variance shocks (3 levels) */}
      <SectionTitle>{t("controls.section.shocks")}</SectionTitle>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label={t("controls.roiShockPerTourney")} hint={t("help.roiShockPerTourney")}>
          <NumInput
            value={value.roiShockPerTourney}
            min={0}
            step={0.01}
            onChange={(v) => setModel("roiShockPerTourney", Math.max(0, v))}
          />
        </Field>
        <Field label={t("controls.roiShockPerSession")} hint={t("help.roiShockPerSession")}>
          <NumInput
            value={value.roiShockPerSession}
            min={0}
            step={0.01}
            onChange={(v) => setModel("roiShockPerSession", Math.max(0, v))}
          />
        </Field>
        <Field label={t("controls.roiDriftSigma")} hint={t("help.roiDriftSigma")}>
          <NumInput
            value={value.roiDriftSigma}
            min={0}
            step={0.005}
            onChange={(v) => setModel("roiDriftSigma", Math.max(0, v))}
          />
        </Field>
      </div>

      {/* Section D — Tilt mechanics */}
      <SectionTitle>{t("controls.section.tilt")}</SectionTitle>
      <div className="text-[11px] text-[color:var(--color-fg-dim)] -mt-2 mb-3">
        {t("controls.tiltHint")}
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Field label={t("controls.tiltFastGain")} hint={t("help.tiltFastGain")}>
          <NumInput
            value={value.tiltFastGain}
            step={0.05}
            onChange={(v) => setModel("tiltFastGain", v)}
          />
        </Field>
        <Field label={t("controls.tiltFastScale")} hint={t("help.tiltFastScale")}>
          <NumInput
            value={value.tiltFastScale}
            min={0}
            step={100}
            onChange={(v) => setModel("tiltFastScale", Math.max(0, v))}
          />
        </Field>
        <div /> {/* spacer */}
        <Field label={t("controls.tiltSlowGain")} hint={t("help.tiltSlowGain")}>
          <NumInput
            value={value.tiltSlowGain}
            step={0.05}
            onChange={(v) => setModel("tiltSlowGain", v)}
          />
        </Field>
        <Field label={t("controls.tiltSlowThreshold")} hint={t("help.tiltSlowThreshold")}>
          <NumInput
            value={value.tiltSlowThreshold}
            min={0}
            step={100}
            onChange={(v) => setModel("tiltSlowThreshold", Math.max(0, v))}
          />
        </Field>
        <Field label={t("controls.tiltSlowMinDuration")} hint={t("help.tiltSlowMinDuration")}>
          <NumInput
            value={value.tiltSlowMinDuration}
            min={0}
            step={50}
            onChange={(v) => setModel("tiltSlowMinDuration", Math.max(0, Math.floor(v)))}
          />
        </Field>
      </div>
      </>
      )}

      {showAdvanced && value.finishModelId === "empirical" && (
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
      <div className="mt-5 flex flex-col gap-3 border-t border-[color:var(--color-border)] pt-4 sm:flex-row sm:items-center">
        {running ? (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-rose-500 to-rose-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_1px_0_0_rgba(255,255,255,0.2)_inset,0_8px_24px_-8px_rgba(244,63,94,0.45)] transition-all hover:from-rose-400 hover:to-rose-500 active:translate-y-px"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
            {t("controls.stop")} {Math.min(100, Math.floor(progress * 100))}%
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onRun}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-indigo-500 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_1px_0_0_rgba(255,255,255,0.2)_inset,0_8px_24px_-8px_rgba(99,102,241,0.5)] transition-all hover:from-indigo-400 hover:to-indigo-500 active:translate-y-px"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M6 4l14 8-14 8V4z" fill="currentColor" />
              </svg>
              {t("controls.run")}
            </button>
            {estimatedMs != null && estimatedMs > 0 && (
              <span
                className="text-[11px] text-[color:var(--color-fg-dim)]"
                title={t("controls.eta.hint")}
              >
                {t("controls.eta")} ≈ {formatDuration(estimatedMs)}
              </span>
            )}
          </>
        )}
        {running && (
          <div className="flex-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--color-bg)]">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-indigo-300"
                style={{ width: `${Math.min(100, progress * 100).toFixed(1)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

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
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.15em] text-[color:var(--color-fg-dim)]">
        {label}
        {hint && <InfoTooltip content={hint} />}
      </span>
      {children}
    </label>
  );
}

function NumInput({
  value,
  onChange,
  step,
  min,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : ""}
      min={min}
      step={step}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (!Number.isNaN(v)) onChange(v);
      }}
      className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 text-sm tabular-nums text-[color:var(--color-fg)] outline-none transition-colors hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)]"
    />
  );
}

function Spinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      className="animate-spin"
      fill="none"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
