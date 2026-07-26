export type DurationLocale = "en" | "ru";

interface Units {
  ms: string;
  s: string;
  min: string;
}

const UNITS: Record<DurationLocale, Units> = {
  en: { ms: "ms", s: "s", min: "min" },
  ru: { ms: "мс", s: "с", min: "мин" },
};

export function formatDuration(
  ms: number,
  locale: DurationLocale = "en",
): string {
  const u = UNITS[locale];
  const safeMs = Math.max(0, ms);
  if (safeMs < 1000)
    return `${Math.max(1, Math.round(safeMs / 100) * 100)} ${u.ms}`;
  if (safeMs < 10_000) return `${(safeMs / 1000).toFixed(1)} ${u.s}`;
  const totalSeconds = Math.max(1, Math.round(safeMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds} ${u.s}`;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return s === 0 ? `${m} ${u.min}` : `${m} ${u.min} ${s} ${u.s}`;
}

// Pre-launch ETA is a per-machine guess based on one prior run's rate; showing
// "9.3 s" implies a precision we don't have. Round coarsely so the label
// reads as orientation, not a promise.
export function formatRoughDuration(
  ms: number,
  locale: DurationLocale = "en",
): string {
  const u = UNITS[locale];
  const safeMs = Math.max(0, ms);
  if (safeMs < 2000) return `~1 ${u.s}`;
  if (safeMs < 15_000) return `${Math.round(safeMs / 1000)} ${u.s}`;
  if (safeMs < 60_000) return `${Math.round(safeMs / 5000) * 5} ${u.s}`;
  const totalSeconds = Math.max(60, Math.round(safeMs / 10_000) * 10);
  const m = Math.floor(totalSeconds / 60);
  const remSec = totalSeconds % 60;
  return remSec === 0
    ? `${m} ${u.min}`
    : `${m} ${u.min} ${remSec} ${u.s}`;
}
