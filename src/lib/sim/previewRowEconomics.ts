import type { TournamentRow } from "./types";

export interface PreviewRowEconomics {
  fieldSize: number;
  effectiveSeats: number;
  buyInTotal: number;
  singleCost: number;
  costPerTournament: number;
  totalRake: number;
  basePool: number;
  overlay: number;
  prizePoolBeforeBounty: number;
}

export function derivePreviewRowEconomics(
  row: Pick<
    TournamentRow,
    "players" | "buyIn" | "rake" | "lateRegMultiplier" | "guarantee"
  >,
): PreviewRowEconomics {
  const lateRegMult = Math.max(1, row.lateRegMultiplier ?? 1);
  const fieldSize = Math.max(2, Math.floor(row.players * lateRegMult));
  const effectiveSeats = fieldSize;
  const buyInTotal = row.buyIn;
  const singleCost = row.buyIn * (1 + row.rake);
  const costPerTournament = singleCost;
  const totalRake = Math.max(0, costPerTournament - buyInTotal);
  const basePool = effectiveSeats * row.buyIn;
  const overlay = Math.max(0, (row.guarantee ?? 0) - basePool);
  return {
    fieldSize,
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
