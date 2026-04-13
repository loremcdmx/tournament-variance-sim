"use client";

import { useRef, useState } from "react";
import type { FinishModelId } from "@/lib/sim/types";
import { useT } from "@/lib/i18n/LocaleProvider";
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
  running: boolean;
  progress: number;
}

export function ControlsPanel({
  value,
  onChange,
  onRun,
  running,
  progress,
}: Props) {
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [empError, setEmpError] = useState<string | null>(null);
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

  return (
    <Card className="p-5">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
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
        <Field label={t("controls.finishModel")} hint={t("help.finishModel")}>
          <select
            value={value.finishModelId}
            onChange={(e) =>
              set("finishModelId", e.target.value as FinishModelId)
            }
            className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 text-sm text-[color:var(--color-fg)] outline-none transition-colors hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)]"
          >
            <option value="power-law">Power-law</option>
            <option value="linear-skill">Linear skill</option>
            <option value="stretched-exp">Stretched-exp</option>
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
              set("alphaOverride", v === "" ? null : parseFloat(v));
            }}
            className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2.5 py-2 text-sm tabular-nums text-[color:var(--color-fg)] outline-none transition-colors hover:border-[color:var(--color-border-strong)] focus:border-[color:var(--color-accent)] placeholder:text-[color:var(--color-fg-dim)]"
          />
        </Field>
        <Field label={t("controls.seed")} hint={t("help.seed")}>
          <NumInput
            value={value.seed}
            step={1}
            onChange={(v) => set("seed", Math.floor(v))}
          />
        </Field>
      </div>

      {value.finishModelId === "empirical" && (
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

      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-3 py-2.5 text-xs transition-colors hover:border-[color:var(--color-border-strong)]">
        <input
          type="checkbox"
          checked={value.compareWithPrimedope}
          onChange={(e) => set("compareWithPrimedope", e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 accent-[color:var(--color-accent)]"
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium text-[color:var(--color-fg)]">
            {t("controls.compareLabel")}
          </span>
          <span className="text-[11px] text-[color:var(--color-fg-dim)]">
            {t("controls.compareHint")}
          </span>
        </span>
      </label>

      <div className="mt-5 flex flex-col gap-3 border-t border-[color:var(--color-border)] pt-4 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-indigo-500 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_1px_0_0_rgba(255,255,255,0.2)_inset,0_8px_24px_-8px_rgba(99,102,241,0.5)] transition-all hover:from-indigo-400 hover:to-indigo-500 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? (
            <>
              <Spinner />
              {t("controls.running")} {Math.round(progress * 100)}%
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M6 4l14 8-14 8V4z" fill="currentColor" />
              </svg>
              {t("controls.run")}
            </>
          )}
        </button>
        {running && (
          <div className="flex-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--color-bg)]">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-indigo-300 transition-[width]"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </Card>
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
