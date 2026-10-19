import { describe, expect, it } from "vitest";

import { MAX_SCHEDULE_ROWS } from "@/lib/persistence";
import type { TournamentRow } from "@/lib/sim/types";
import {
  appendRow,
  applyImportedRows,
  duplicateRow,
  newScheduleRow,
  patchRow,
  removeRow,
} from "./scheduleOps";

type Updater = (prev: TournamentRow[]) => TournamentRow[];

const row = (id: string, over: Partial<TournamentRow> = {}): TournamentRow => ({
  id,
  label: id,
  players: 1000,
  buyIn: 20,
  rake: 0.1,
  roi: 0.1,
  payoutStructure: "mtt-standard",
  count: 1,
  ...over,
});

// What React does with updaters queued while an earlier transition has not
// rendered: they are applied in order on top of the same base state. A plain
// array replaces whatever came before it.
const settle = (base: TournamentRow[], queue: (Updater | TournamentRow[])[]) =>
  queue.reduce<TournamentRow[]>(
    (state, next) => (typeof next === "function" ? next(state) : next),
    base,
  );

describe("row operations as updaters", () => {
  const base = [row("a"), row("b")];
  const edit: Updater = (prev) => patchRow(prev, "a", { players: 7000 });

  it("loses a pending edit when the next array is computed from the rendered schedule", () => {
    const fromRender = appendRow(base, newScheduleRow("new"));
    expect(settle(base, [edit, fromRender])[0].players).toBe(1000);
  });

  it("keeps a pending edit across Add, Duplicate, Remove and a second edit", () => {
    const settled = settle(base, [
      edit,
      (prev) => appendRow(prev, newScheduleRow("new")),
      (prev) => duplicateRow(prev, "b", "b2"),
      (prev) => removeRow(prev, "b"),
      (prev) => patchRow(prev, "new", { count: 9 }),
    ]);
    expect(settled.map((r) => r.id)).toEqual(["a", "b2", "new"]);
    expect(settled[0].players).toBe(7000);
    expect(settled[2].count).toBe(9);
  });

  it("keeps a pending edit across an append import, and lets a replace import win", () => {
    const imported = [row("i1"), row("i2")];
    const appended = settle(base, [edit, (prev) => applyImportedRows(prev, imported, "append")]);
    expect(appended.map((r) => r.id)).toEqual(["a", "b", "i1", "i2"]);
    expect(appended[0].players).toBe(7000);
    const replaced = settle(base, [edit, (prev) => applyImportedRows(prev, imported, "replace")]);
    expect(replaced.map((r) => r.id)).toEqual(["i1", "i2"]);
  });

  it("gives the same rows when an updater is replayed", () => {
    const add: Updater = (prev) => appendRow(prev, newScheduleRow("new"));
    expect(add(base)).toEqual(add(base));
  });
});

describe("pure reducers", () => {
  it("patches one row through the game-type normalisation and leaves the others", () => {
    const base = [row("a"), row("b", { gameType: "freezeout" })];
    const next = patchRow(base, "a", { gameType: "freezeout", bountyFraction: 0.4 });
    expect(next[0].bountyFraction).toBeUndefined();
    expect(next[1]).toBe(base[1]);
    expect(patchRow(base, "gone", { buyIn: 1 })).toEqual(base);
  });

  it("never removes the last row", () => {
    expect(removeRow([row("a")], "a")).toHaveLength(1);
    expect(removeRow([row("a"), row("b")], "a").map((r) => r.id)).toEqual(["b"]);
    expect(removeRow([row("a"), row("b")], "gone")).toHaveLength(2);
  });

  it("duplicates right after the source and respects the row cap", () => {
    const base = [row("a"), row("b")];
    expect(duplicateRow(base, "a", "c").map((r) => r.id)).toEqual(["a", "c", "b"]);
    expect(duplicateRow(base, "gone", "c")).toBe(base);
    const full = Array.from({ length: MAX_SCHEDULE_ROWS }, (_, i) => row(`r${i}`));
    expect(duplicateRow(full, "r0", "c")).toBe(full);
    expect(appendRow(full, row("x"))).toBe(full);
    expect(appendRow(full.slice(1), row("x"))).toHaveLength(MAX_SCHEDULE_ROWS);
  });

  it("refuses an import that would pass the cap on the live schedule", () => {
    const nearFull = Array.from({ length: MAX_SCHEDULE_ROWS - 1 }, (_, i) => row(`r${i}`));
    expect(applyImportedRows(nearFull, [row("x")], "append")).toHaveLength(MAX_SCHEDULE_ROWS);
    expect(applyImportedRows(nearFull, [row("x"), row("y")], "append")).toBe(nearFull);
    expect(applyImportedRows(nearFull, [row("x")], "replace")).toHaveLength(1);
  });
});
