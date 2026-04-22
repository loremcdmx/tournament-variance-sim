import type { TournamentRow } from "./types";

export interface PreviewRowEconomics {
  fieldSize: number;
  expectedBullets: number;
  reentryExpected: number;
  effectiveSeats: number;
  buyInTotal: number;
  singleCost: number;
  costPerTournament: number;
  totalRake: number;
  basePool: number;
  overlay: number;
  prizePoolBeforeBounty: number;
}

export function expectedReentriesForRow(
  row: Pick<TournamentRow, "maxEntries" | "reentryRate">,
): number {
  const maxEntries = Math.max(1, Math.floor(row.maxEntries ?? 1));
  const reRate = Math.max(
    0,
    Math.min(1, row.reentryRate ?? (maxEntries > 1 ? 1 : 0)),
  );
  if (maxEntries <= 1 || reRate <= 0) return 0;
  if (reRate >= 1) return maxEntries - 1;
  return (reRate * (1 - Math.pow(reRate, maxEntries - 1))) / (1 - reRate);
}

export function derivePreviewRowEconomics(
  row: Pick<
    TournamentRow,
    | "players"
    | "buyIn"
    | "rake"
    | "lateRegMultiplier"
    | "maxEntries"
    | "reentryRate"
    | "guarantee"
  >,
): PreviewRowEconomics {
  const lateRegMult = Math.max(1, row.lateRegMultiplier ?? 1);
  const fieldSize = Math.max(2, Math.floor(row.players * lateRegMult));
  const reentryExpected = expectedReentriesForRow(row);
  const expectedBullets = 1 + reentryExpected;
  const effectiveSeats = fieldSize * expectedBullets;
  const buyInTotal = row.buyIn * expectedBullets;
  const singleCost = row.buyIn * (1 + row.rake);
  const costPerTournament = singleCost * expectedBullets;
  const totalRake = Math.max(0, costPerTournament - buyInTotal);
  const basePool = effectiveSeats * row.buyIn;
  const overlay = Math.max(0, (row.guarantee ?? 0) - basePool);
  return {
    fieldSize,
    expectedBullets,
    reentryExpected,
    effectiveSeats,
    buyInTotal,
    singleCost,
    costPerTournament,
    totalRake,
    basePool,
    overlay,
    prizePoolBeforeBounty: basePool + overlay,
  };
}
