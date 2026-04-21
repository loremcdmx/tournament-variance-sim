export function clampNumFieldValue(
  value: number,
  min?: number,
  max?: number,
): number {
  let next = value;
  if (typeof min === "number") next = Math.max(min, next);
  if (typeof max === "number") next = Math.min(max, next);
  return next;
}

export function formatNumFieldValue(value: number): string {
  return Number.isFinite(value) ? String(value) : "";
}

export function parseNumFieldDraft(
  raw: string,
  min?: number,
  max?: number,
): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return null;
  if (typeof min === "number" && parsed < min) return null;
  if (typeof max === "number" && parsed > max) return null;
  return parsed;
}

export function commitNumFieldDraft(
  raw: string,
  fallback: number,
  min?: number,
  max?: number,
): number {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const parsed = parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return fallback;
  return clampNumFieldValue(parsed, min, max);
}
