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

// The editor has no guarantee field, so a guarantee (an old save or link, a
// programmatic row) describes the pool the row had when it arrived. Once the
// visible pool changes it would turn into an overlay nobody typed and shrink
// the row's σ.
const POOL_FIELDS = [
  "players",
  "buyIn",
  "fieldVariability",
  "gameType",
  "payoutStructure",
] as const satisfies readonly (keyof TournamentRow)[];

function changesPool(row: TournamentRow, patch: Partial<TournamentRow>): boolean {
  return POOL_FIELDS.some(
    (key) =>
      key in patch && JSON.stringify(patch[key]) !== JSON.stringify(row[key]),
  );
}

export function patchRow(
  prev: TournamentRow[],
  id: string,
  patch: Partial<TournamentRow>,
): TournamentRow[] {
  return prev.map((r) => {
    if (r.id !== id) return r;
    const merged = { ...r, ...patch };
    if (
      merged.guarantee !== undefined &&
      !("guarantee" in patch) &&
      changesPool(r, patch)
    ) {
      merged.guarantee = undefined;
    }
    return normalizeGameTypeConsistency(merged);
  });
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
