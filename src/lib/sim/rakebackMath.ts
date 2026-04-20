export function rakebackRoiContribution(
  rake: number,
  rakebackPct: number,
): number {
  if (!Number.isFinite(rake) || !Number.isFinite(rakebackPct)) return 0;
  const safeRake = Math.max(0, rake);
  const rb = Math.max(0, rakebackPct) / 100;
  return safeRake > 0 ? (rb * safeRake) / (1 + safeRake) : 0;
}

export function reportedRoiFromPreRakebackRoi(
  preRakebackRoi: number,
  rake: number,
  rakebackPct: number,
): number {
  return preRakebackRoi + rakebackRoiContribution(rake, rakebackPct);
}

export function preRakebackRoiFromReportedRoi(
  reportedRoi: number,
  rake: number,
  rakebackPct: number,
): number {
  return reportedRoi - rakebackRoiContribution(rake, rakebackPct);
}
