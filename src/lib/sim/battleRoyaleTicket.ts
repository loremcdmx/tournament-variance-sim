import { makeBrTierSampler } from "./brBountyTiers";

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

/** The final table opens with 9 players, so 8 busts drop an envelope. */
const BATTLE_ROYALE_ENVELOPE_DROPS = 8;
const BOUNTY_SHARE_REFERENCE_TICKET = 10;

/**
 * Share of the net buy-in pool (players x ticket x 92%) that GG's published
 * envelope table pays out as bounties: 8 drops x mean envelope over the pool.
 * Every published tier has a mean envelope of 0.945 x ticket, so for 18 players
 * this is 7.56 / 16.56 tickets = 21/46, which leaves exactly 9 tickets for the
 * 40/30/20 cash split.
 */
export function battleRoyaleBountyShareOfNetPool(players: number): number {
  const ticket = BOUNTY_SHARE_REFERENCE_TICKET;
  const meanEnvelope = makeBrTierSampler(
    battleRoyaleRowFromTotalTicket(ticket).buyIn,
  ).meanValue;
  const netPool =
    players * ticket * (1 - BATTLE_ROYALE_MARKETED_RAKE_SHARE_OF_TOTAL);
  return (BATTLE_ROYALE_ENVELOPE_DROPS * meanEnvelope) / netPool;
}
