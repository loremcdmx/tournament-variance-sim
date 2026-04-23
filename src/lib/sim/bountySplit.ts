import type { TournamentRow } from "./types";

export function isBattleRoyaleRow(
  row: Pick<TournamentRow, "gameType" | "payoutStructure">,
): boolean {
  return row.gameType === "mystery-royale" || row.payoutStructure === "battle-royale";
}

export function clampBountyMean(bountyMean: number, totalWinningsEV: number): number {
  if (!Number.isFinite(bountyMean) || !Number.isFinite(totalWinningsEV)) return 0;
  return Math.max(0, Math.min(Math.max(0, totalWinningsEV), bountyMean));
}
