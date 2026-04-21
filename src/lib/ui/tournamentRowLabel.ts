import type { DictKey } from "@/lib/i18n/dict";
import { inferGameType } from "@/lib/sim/gameType";
import type { GameType, TournamentRow } from "@/lib/sim/types";

const GAME_TYPE_LABEL_KEY: Record<GameType, DictKey> = {
  freezeout: "row.gameType.freezeout",
  "freezeout-reentry": "row.gameType.freezeoutReentry",
  pko: "row.gameType.pko",
  mystery: "row.gameType.mystery",
  "mystery-royale": "row.gameType.mysteryRoyale",
};

function formatMoneyToken(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/\.?0+$/, "");
}

function formatBuyInToken(row: TournamentRow): string {
  const rakeAmount = row.buyIn * row.rake;
  if (rakeAmount < 0.005) return `$${formatMoneyToken(row.buyIn)}`;
  return `$${formatMoneyToken(row.buyIn)}+$${formatMoneyToken(rakeAmount)}`;
}

export function getTournamentRowDisplayLabel(
  row: TournamentRow,
  t: (key: DictKey) => string,
): string {
  const explicitLabel = row.label?.trim();
  if (explicitLabel) return explicitLabel;

  const gameType = inferGameType(row);
  return `${t(GAME_TYPE_LABEL_KEY[gameType])} ${formatBuyInToken(row)}`;
}
