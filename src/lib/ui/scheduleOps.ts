import { MAX_SCHEDULE_ROWS } from "@/lib/persistence";
import { normalizeGameTypeConsistency } from "@/lib/sim/gameType";
import type { TournamentRow } from "@/lib/sim/types";

// Row operations are emitted as updaters, never as arrays built from the
// schedule the editor last rendered: a field committed on blur goes through a
// transition that may not have rendered yet, and a plain array computed from
// the older schedule would overwrite it.

export function newScheduleRow(id: string): TournamentRow {
  return {
    id,
    label: "",
    players: 500,
    buyIn: 10,
    rake: 0.1,
    roi: 0.2,
    payoutStructure: "mtt-standard",
    count: 1,
  };
}

export function patchRow(
  prev: TournamentRow[],
  id: string,
  patch: Partial<TournamentRow>,
): TournamentRow[] {
  return prev.map((r) =>
    r.id === id ? normalizeGameTypeConsistency({ ...r, ...patch }) : r,
  );
}

export function removeRow(prev: TournamentRow[], id: string): TournamentRow[] {
  return prev.length > 1 ? prev.filter((r) => r.id !== id) : prev;
}

export function duplicateRow(
  prev: TournamentRow[],
  id: string,
  copyId: string,
): TournamentRow[] {
  if (prev.length >= MAX_SCHEDULE_ROWS) return prev;
  const idx = prev.findIndex((r) => r.id === id);
  if (idx < 0) return prev;
  const next = [...prev];
  next.splice(idx + 1, 0, { ...prev[idx], id: copyId });
  return next;
}

export function appendRow(prev: TournamentRow[], row: TournamentRow): TournamentRow[] {
  return prev.length >= MAX_SCHEDULE_ROWS ? prev : [...prev, row];
}

export function applyImportedRows(
  prev: TournamentRow[],
  rows: readonly TournamentRow[],
  mode: "append" | "replace",
): TournamentRow[] {
  const merged = mode === "replace" ? [...rows] : [...prev, ...rows];
  return merged.length > MAX_SCHEDULE_ROWS ? prev : merged;
}
