import type { TournamentRow } from "./types";

type FieldRangeRow = Pick<TournamentRow, "players" | "fieldVariability">;

const DEFAULT_BUCKETS = 5;

interface FieldRange {
  lo: number;
  hi: number;
  buckets: number;
}

/**
 * The uniform range a row plays, or null for a fixed field. A range with a
 * non-finite end is no range: persistence drops it on reload, so the live row
 * must not play something else in the meantime.
 */
function fieldRange(row: FieldRangeRow): FieldRange | null {
  const fv = row.fieldVariability;
  if (!fv || fv.kind !== "uniform") return null;
  if (!Number.isFinite(fv.min) || !Number.isFinite(fv.max)) return null;
  const lo = Math.max(2, Math.floor(Math.min(fv.min, fv.max)));
  const hi = Math.max(lo, Math.floor(Math.max(fv.min, fv.max)));
  const requested = fv.buckets ?? DEFAULT_BUCKETS;
  const buckets = Math.max(
    1,
    Math.floor(Number.isFinite(requested) ? requested : DEFAULT_BUCKETS),
  );
  return { lo, hi, buckets };
}

export function isFieldRangeActive(row: FieldRangeRow): boolean {
  return fieldRange(row) !== null;
}

/**
 * Field size the row is documented to sit at while a range is active (the
 * range midpoint), or null for a fixed field.
 */
export function fieldRangeMidpoint(row: FieldRangeRow): number | null {
  const range = fieldRange(row);
  return range === null ? null : Math.round((range.lo + range.hi) / 2);
}

/**
 * Base field sizes (before late registration) the row is played at, each with
 * an equal share. The engine compiles one entry per size, so every other
 * consumer of "the field" has to read it from here.
 */
export function fieldVariantSizes(row: FieldRangeRow): number[] {
  const range = fieldRange(row);
  if (range === null) return [row.players];
  const { lo, hi, buckets } = range;
  if (buckets === 1 || lo === hi) return [Math.round((lo + hi) / 2)];
  const sizes: number[] = [];
  for (let b = 0; b < buckets; b++) {
    // Midpoints of evenly-spaced sub-intervals over [lo, hi].
    const t = (b + 0.5) / buckets;
    sizes.push(Math.round(lo + t * (hi - lo)));
  }
  return sizes;
}

/**
 * The engine ignores `players` under a range and plays the bucket sizes, so
 * the field a preview, validation or ITM default reads from `players` has to
 * be the range midpoint, or it describes a tournament that is never played.
 */
export function withRangeMidpointPlayers<T extends FieldRangeRow>(row: T): T {
  const mid = fieldRangeMidpoint(row);
  return mid === null || mid === row.players ? row : { ...row, players: mid };
}
