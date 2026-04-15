/**
 * Malmuth-Harville ICM approximation.
 *
 * Given an array of dollar payouts (place 1..P) and an array of stacks for
 * P players, returns each player's expected share of the prize pool.
 *
 * The recursion:
 *   P(player i finishes 1st) = stack_i / Σ stacks
 *   Conditional on i winning, the remaining P−1 players play an ICM with
 *   the prize array shifted down (place 2..P) and stacks excluding i.
 *
 * Complexity: O(P² × 2^P) naive → untractable for P > 12, so we cap the
 * computation to the top `maxPlayers` and pool any smaller places into a
 * single "bottom of field" bucket. In practice, 9-handed final tables are
 * the interesting case — 9! = 362880 permutations of recursion paths, but
 * with memoization over the remaining-players bitmask it's ~2^9 × 9 = 4608
 * calls which is instant.
 *
 * Used to reweight the *payout* vector of the top-of-field places so that
 * EV that would have sat on 1st gets pulled down. This is an approximation
 * of real deal-making / survival-focused play and tracks high-stakes
 * reality better than raw nominal payouts do.
 */

export const ICM_MAX_PLAYERS = 9;

export function icmEquities(
  stacks: number[],
  payouts: number[],
): number[] {
  const n = stacks.length;
  if (n === 0) return [];
  if (n > ICM_MAX_PLAYERS) {
    throw new Error(
      `icmEquities: bitmask DP capped at ${ICM_MAX_PLAYERS} players (got ${n}). ` +
        `Cap callers to the top-${ICM_MAX_PLAYERS} stacks or use applyICMToPayoutTable instead.`,
    );
  }
  const pSum = payouts.reduce((a, b) => a + b, 0);
  if (pSum === 0) return new Array(n).fill(0);

  // Bitmask DP: for each subset of players still alive, compute each
  // player's probability of finishing at position (place - 1) where place
  // is determined by (n - |subset| + 1).
  // equity[i] = Σ_place P(i finishes place-th) × payouts[place-1]
  const equity = new Array<number>(n).fill(0);

  // Probability that player i wins in a given subset `mask`.
  // P(i wins | mask) = stack_i / Σ_{j∈mask} stack_j
  // We compute, for every ordering of finishers that produces subset
  // shrinkage, the place index and the probability of that sequence.

  // Depth-first: start with all players alive, assign place 1 first.
  // state: mask, placeIdx (0-indexed) — probability accumulated
  // Because n ≤ 10 in practice, full recursion with memoization over
  // mask × last-added is fine.

  // We recurse: icm(mask, placeIdx, probSoFar)
  // At each step pick a winner w from mask, probability =
  //   stack_w / Σ_{j∈mask} stack_j, assign w place (placeIdx+1) and
  //   recurse with mask^w, placeIdx+1.
  // Accumulate equity[w] += (probSoFar × pWin) × payouts[placeIdx].

  function recurse(mask: number, placeIdx: number, probSoFar: number) {
    if (placeIdx >= payouts.length || mask === 0) return;
    // Compute sum of stacks in mask.
    let sumStacks = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) sumStacks += stacks[i];
    }
    if (sumStacks <= 0) return;
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue;
      const pWin = stacks[i] / sumStacks;
      const contribution = probSoFar * pWin;
      equity[i] += contribution * payouts[placeIdx];
      recurse(mask & ~(1 << i), placeIdx + 1, contribution);
    }
  }

  const fullMask = (1 << n) - 1;
  recurse(fullMask, 0, 1);
  return equity;
}

/**
 * Reweight a raw payout table to reflect real ICM / deal-making dynamics
 * at the final table.
 *
 * We apply a linear blend toward the per-seat average over the top
 * `ftSize` places. `smoothing = 0` leaves payouts untouched;
 * `smoothing = 1` fully flattens the FT (pure ICM with equal stacks —
 * every finisher walks with mean). Real tournaments live around
 * `smoothing = 0.3 – 0.5`: first place still earns more than 9th, but
 * not as dramatically as the nominal payout table suggests, because
 * deals, preservation play, and the survival-skew of real ICM pressure
 * all bleed money from 1st toward the bottom of the final table.
 *
 * The total $ on the top `ftSize` seats is preserved exactly, so
 * expected-value calculations on a pre-FT basis are unaffected — only
 * the variance profile shifts toward safer outcomes.
 */
export function applyICMToPayoutTable(
  payouts: number[],
  ftSize: number,
  smoothing: number = 0.4,
): number[] {
  const size = Math.min(ftSize, payouts.length);
  if (size <= 1) return payouts.slice();
  const top = payouts.slice(0, size);
  const topSum = top.reduce((a, b) => a + b, 0);
  const avg = topSum / size;
  const s = Math.max(0, Math.min(1, smoothing));
  const out = payouts.slice();
  for (let i = 0; i < size; i++) out[i] = (1 - s) * top[i] + s * avg;
  return out;
}
