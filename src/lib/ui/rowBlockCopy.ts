import type { DictKey } from "@/lib/i18n/dict";
import type { RowBlockCause, RowFeasibilityIssue } from "@/lib/sim/validation";

const CAUSE_KEY: Record<RowBlockCause, DictKey> = {
  "inconsistent-finish-locks": "shape.rowBlocked.inconsistent-finish-locks",
  "pinned-itm": "shape.rowBlocked.pinned-itm",
  "pinned-shells": "shape.rowBlocked.pinned-shells",
  "bounty-pool": "shape.rowBlocked.bounty-pool",
  "fixed-shape": "shape.rowBlocked.fixed-shape",
  "model-saturation": "shape.rowBlocked.model-saturation",
};

export function rowBlockedKey(cause: RowBlockCause): DictKey {
  return CAUSE_KEY[cause];
}

/** Each cause among `issues` once, in the order of the rows that carry it. */
export function blockedCauseKeys(issues: readonly Pick<RowFeasibilityIssue, "cause">[]): DictKey[] {
  return [...new Set(issues.map((issue) => CAUSE_KEY[issue.cause]))];
}
