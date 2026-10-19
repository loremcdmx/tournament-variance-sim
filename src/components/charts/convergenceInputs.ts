import { commitDraftValue, parseNumericDraft } from "@/lib/ui/numberDraft";

export const CI_PCT_MIN = 75;
export const CI_PCT_MAX = 99.9;
export const RAKE_PCT_MIN = 0;
export const RAKE_PCT_MAX = 20;

// null means the box holds no number (cleared, or a lone "-"): leave the value as it was.
export function commitCiPct(raw: string): number | null {
  return commitDraftValue(raw, CI_PCT_MIN, CI_PCT_MAX);
}

export function commitRakePct(raw: string): number | null {
  return commitDraftValue(raw, RAKE_PCT_MIN, RAKE_PCT_MAX);
}

export function commitMixPct(raw: string): number | null {
  return commitDraftValue(raw, 0, 100);
}

export function commitRoiFraction(raw: string, roiMin: number, roiMax: number): number | null {
  const pct = parseNumericDraft(raw);
  if (pct === null) return null;
  return Math.max(roiMin, Math.min(roiMax, pct / 100));
}
