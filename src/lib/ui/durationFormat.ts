export function formatDurationRu(ms: number): string {
  const safeMs = Math.max(0, ms);
  if (safeMs < 1000) return `${Math.max(1, Math.round(safeMs / 100) * 100)} мс`;
  if (safeMs < 10_000) return `${(safeMs / 1000).toFixed(1)} с`;
  const totalSeconds = Math.max(1, Math.round(safeMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds} с`;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return s === 0 ? `${m} мин` : `${m} мин ${s} с`;
}

// Pre-launch ETA is a per-machine guess based on one prior run's rate; showing
// "9.3 с" implies a precision we don't have. Round coarsely so the label
// reads as orientation, not a promise.
export function formatRoughDurationRu(ms: number): string {
  const safeMs = Math.max(0, ms);
  if (safeMs < 2000) return "~1 с";
  if (safeMs < 15_000) return `${Math.round(safeMs / 1000)} с`;
  if (safeMs < 60_000) return `${Math.round(safeMs / 5000) * 5} с`;
  const totalSeconds = Math.max(60, Math.round(safeMs / 10_000) * 10);
  const m = Math.floor(totalSeconds / 60);
  const remSec = totalSeconds % 60;
  return remSec === 0 ? `${m} мин` : `${m} мин ${remSec} с`;
}
