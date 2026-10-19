"use client";

import { useState } from "react";
import {
  commitDraftValue,
  isDraftInvalid,
  normalizeNumericDraft,
} from "@/lib/ui/numberDraft";

/**
 * A number box that keeps what is typed as text and applies it on blur or
 * Enter. Driving a clamped number straight from each keystroke turns a typed
 * "1000" into 50 → 500 → 5000 → 50000 because the first digit is clamped up
 * to the minimum and the next digits are appended to that.
 */
export function DraftNumberInput({
  value,
  format = String,
  min,
  max,
  step,
  disabled,
  onCommit,
  className,
  ariaLabel,
}: {
  value: number;
  format?: (value: number) => string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
  className?: string;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && isDraftInvalid(draft, min, max);
  const commit = () => {
    if (draft === null) return;
    const next = commitDraftValue(draft, min, max);
    setDraft(null);
    if (next !== null) onCommit(next);
  };
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      inputMode="decimal"
      value={draft ?? format(value)}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(normalizeNumericDraft(e.target.value))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") setDraft(null);
      }}
      className={`${className ?? ""} ${invalid ? "ring-1 ring-rose-500/50" : ""}`}
    />
  );
}
