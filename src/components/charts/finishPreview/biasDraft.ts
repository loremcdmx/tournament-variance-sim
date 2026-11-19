const SAME = 1e-9;
const MAX_IN_FLIGHT = 8;

// Biases handed to onCommit that the row has not shown yet, oldest first. A
// value the row shows that was never sent is an outside change (a scenario
// reload, "Apply reported ROI"), and the slider's draft has to give way to it.

// While a submission is landing, the row will end on the last one sent, so a
// return to the value it shows now is a new submission, not a repeat.
export function isRepeatSubmission(
  inflight: readonly number[],
  next: number,
  committed: number,
): boolean {
  const landing = inflight[inflight.length - 1] ?? committed;
  return Math.abs(next - landing) < SAME;
}

export function submitBias(inflight: readonly number[], next: number): number[] {
  return [...inflight, next].slice(-MAX_IN_FLIGHT);
}

export function settleCommitted(
  inflight: readonly number[],
  committed: number,
): { inflight: number[]; external: boolean } {
  const landed = inflight.findIndex((v) => Math.abs(v - committed) < SAME);
  if (landed >= 0) return { inflight: inflight.slice(landed + 1), external: false };
  return { inflight: [], external: true };
}
