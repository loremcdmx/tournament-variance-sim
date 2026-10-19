import { preferredScrollBehavior } from "./scrollBehavior";

const RING_CLASSES = ["ring-2", "ring-rose-500/70"];
const RING_MS = 1800;

// One broken row is fixed in place; several are summarised by the banner.
export function runBlockedScrollTarget(
  issues: readonly { rowId: string }[],
): string {
  return issues.length === 1 ? `schedule-row-${issues[0].rowId}` : "feasibility-banner";
}

// Shared by the blocked Run button and the Cmd/Ctrl+Enter shortcut, which
// otherwise does nothing a keyboard user can see.
export function focusRunBlocker(
  doc: Pick<Document, "getElementById"> & { defaultView?: Pick<Window, "matchMedia"> | null },
  targetId: string,
): boolean {
  const el = doc.getElementById(targetId);
  if (!el) return false;
  el.scrollIntoView({ behavior: preferredScrollBehavior(doc.defaultView), block: "center" });
  el.classList.add(...RING_CLASSES);
  setTimeout(() => el.classList.remove(...RING_CLASSES), RING_MS);
  return true;
}
