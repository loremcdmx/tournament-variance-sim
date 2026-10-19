import { afsToPos, posToAfs } from "@/lib/sim/convergenceMath";
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

export interface ResetTarget {
  /** What the control reads after the reset. */
  value: number;
  /** True when the schedule's own figure lay outside the control's range. */
  clamped: boolean;
}

/** Where the AFS and ROI "reset" buttons land. The sliders hold AFS to its log
 *  grid and ROI to the bounds of the format on screen, so a schedule outside them
 *  resets to the nearest end, not to its own figure. */
export function convergenceResetTargets(args: {
  avgField: number;
  roi: number;
  roiMin: number;
  roiMax: number;
}): { afs: ResetTarget; roi: ResetTarget } {
  const landed = posToAfs(afsToPos(args.avgField));
  const afsClamped = Math.abs(landed - args.avgField) > 1e-9 * Math.max(1, args.avgField);
  const roi = Math.max(args.roiMin, Math.min(args.roiMax, args.roi));
  return {
    // Inside the grid the log round trip only adds float noise (999.9999999999 for 1000).
    afs: { value: afsClamped ? landed : args.avgField, clamped: afsClamped },
    roi: { value: roi, clamped: roi !== args.roi },
  };
}
