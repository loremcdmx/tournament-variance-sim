/**
 * GGPoker Battle Royale tiers are marketed as total ticket prices where the
 * fee is 8% of the full ticket, e.g. $10 = $9.20 to prize pool + $0.80 fee.
 *
 * The simulator's core MTT contract stores `rake` as fee / net buy-in
 * (prize-pool portion), so the same $10 BR ticket becomes:
 *   - buyIn = 9.20
 *   - rake  = 0.80 / 9.20 ~= 8.6957%
 */
export const BATTLE_ROYALE_MARKETED_RAKE_SHARE_OF_TOTAL = 0.08;
export const BATTLE_ROYALE_INTERNAL_RAKE =
  BATTLE_ROYALE_MARKETED_RAKE_SHARE_OF_TOTAL /
  (1 - BATTLE_ROYALE_MARKETED_RAKE_SHARE_OF_TOTAL);

export function battleRoyaleRowFromTotalTicket(totalTicket: number): {
  buyIn: number;
  rake: number;
} {
  const buyIn =
    totalTicket * (1 - BATTLE_ROYALE_MARKETED_RAKE_SHARE_OF_TOTAL);
  return {
    buyIn,
    rake: BATTLE_ROYALE_INTERNAL_RAKE,
  };
}
