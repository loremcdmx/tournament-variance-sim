export function normalizeNumericDraft(raw: string): string {
  if (raw === "") return raw;
  const match = raw.match(/^([+-]?)(\d+)(\.(\d*))?$/);
  if (!match) return raw;
  const [, sign, integerPart, fractionalPart = ""] = match;
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, "");
  return `${sign}${normalizedInteger}${fractionalPart}`;
}

// Number("") and Number("  ") are 0, so a cleared field would otherwise commit
// the minimum (and a type=number input reports a lone "-" as "").
export function parseNumericDraft(draft: string): number | null {
  if (draft.trim() === "") return null;
  const value = Number(draft);
  return Number.isFinite(value) ? value : null;
}

export function isDraftInvalid(
  draft: string,
  min?: number,
  max?: number,
): boolean {
  const value = parseNumericDraft(draft);
  if (value === null) return true;
  return (min !== undefined && value < min) || (max !== undefined && value > max);
}

/** The value to apply while typing: a complete number already inside the bounds. */
export function liveDraftValue(
  draft: string,
  min?: number,
  max?: number,
): number | null {
  const value = parseNumericDraft(draft);
  if (value === null || isDraftInvalid(draft, min, max)) return null;
  return value;
}

/** The value to commit on blur or Enter: clamped into the bounds; null cancels the edit. */
export function commitDraftValue(
  draft: string,
  min?: number,
  max?: number,
): number | null {
  const value = parseNumericDraft(draft);
  if (value === null) return null;
  return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value));
}
