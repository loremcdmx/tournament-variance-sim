import type { RowStats, TierKey, TierRow } from "./previewRowStats";

const mean = (xs: readonly number[]): number =>
  xs.reduce((a, b) => a + b, 0) / xs.length;

function nearestToMean(sizes: readonly number[]): number {
  const centre = mean(sizes);
  let best = 0;
  for (let i = 1; i < sizes.length; i++) {
    if (Math.abs(sizes[i] - centre) < Math.abs(sizes[best] - centre)) best = i;
  }
  return best;
}

function mixTiers(parts: readonly RowStats[], repIdx: number): TierRow[] {
  // A bucket without a tier (no top-27 below 100 entrants, no bubble when
  // everyone is paid) has no finishes there, and its places sit in the
  // neighbouring tier, so a missing tier counts as zero and the union of keys
  // keeps the shares summing to one.
  const order: TierKey[] = [];
  for (const part of parts) {
    let after = -1;
    for (const tier of part.tiers) {
      const at = order.indexOf(tier.key);
      if (at >= 0) {
        after = at;
        continue;
      }
      after += 1;
      order.splice(after, 0, tier.key);
    }
  }
  const byKey = parts.map((p) => new Map(p.tiers.map((t) => [t.key, t] as const)));
  return order.map((key) => {
    const present = byKey.map((m) => m.get(key));
    // Place ranges and their labels belong to a concrete field; they come from
    // the bucket nearest the range midpoint, the shares are the mixture. A tier
    // that bucket lacks keeps its mixed shares but no range of its own: taking
    // one from another field put e.g. the rest-of-cashes places of a 258-entry
    // field next to a bubble at 19.
    const repTier = present[repIdx];
    const layout = repTier ?? present.find((t) => t !== undefined)!;
    const share = (pick: (t: TierRow) => number) =>
      mean(present.map((t) => (t ? pick(t) : 0)));
    const field = share((t) => t.field);
    const cashEv = share((t) => t.cashEv);
    const bountyEv = share((t) => t.bountyEv);
    const busts = share((t) => t.field * t.bustsGivenFinish);
    const given = (total: number) => (field > 1e-12 ? total / field : 0);
    const bustsGivenFinish = given(busts);
    const bountyGivenFinish = given(bountyEv);
    return {
      key: layout.key,
      labelKey: layout.labelKey,
      color: layout.color,
      ev: share((t) => t.ev),
      cashEv,
      bountyEv,
      cashGivenFinish: given(cashEv),
      bountyGivenFinish,
      bustsGivenFinish,
      bountySizePerBust:
        bustsGivenFinish > 1e-9 ? bountyGivenFinish / bustsGivenFinish : 0,
      field,
      eqShare: share((t) => t.eqShare),
      netDollars: share((t) => t.netDollars),
      eqNetDollars: share((t) => t.eqNetDollars),
      displaySeats: layout.displaySeats,
      posLo: layout.posLo,
      posHi: layout.posHi,
      ...(repTier ? null : { placesVary: true as const }),
    };
  });
}

/**
 * The preview of a row whose field is drawn uniformly from several sizes, as
 * the engine samples it: every additive quantity (finish and tier shares, ITM,
 * EV and its cash / bounty split, shell probabilities) is the equal-weight mean
 * over the per-size stats, the σ is the mixture's (total variance across the
 * sizes), and what only makes sense at one concrete field (place ranges,
 * half-mass place, α) is read from the size nearest the mean. The paid-place
 * count is the rounded mean, so paid places over the range midpoint stays the
 * paid share whatever the bucket count.
 */
export function mixRowStats(
  parts: readonly RowStats[],
  sizes: readonly number[],
): RowStats {
  if (parts.length === 1) return parts[0];
  const repIdx = nearestToMean(sizes);
  const rep = parts[repIdx];
  const avg = (pick: (s: RowStats) => number) => mean(parts.map(pick));

  const evPerEntry = avg((s) => s.evPerEntry);
  const bountyEvPerEntry = avg((s) => s.bountyEvPerEntry);
  const mixtureStd = (std: (s: RowStats) => number) =>
    Math.sqrt(
      Math.max(
        0,
        avg((s) => std(s) ** 2 + s.evPerEntry ** 2) - evPerEntry ** 2,
      ),
    );
  const payoutStd = mixtureStd((s) => s.payoutStd);
  const ftEv = avg((s) => s.ftEvShare * s.evPerEntry);
  // Show the bucket furthest from the target so a row blocked at one size
  // reads its real shortfall instead of a shortfall diluted by the others.
  const relativeGap = (s: RowStats) =>
    Math.abs(s.shellCurrentEv - s.shellTargetEv) /
    Math.max(1e-9, Math.abs(s.shellTargetEv));
  const worst = parts.reduce((a, b) => (relativeGap(b) > relativeGap(a) ? b : a));

  return {
    ...rep,
    itm: avg((s) => s.itm),
    evPerEntry,
    payoutStd,
    payoutStdLower: mixtureStd((s) => s.payoutStdLower ?? s.payoutStd),
    cv: evPerEntry > 1e-9 ? payoutStd / evPerEntry : 0,
    cashEvPerEntry: avg((s) => s.cashEvPerEntry),
    bountyEvPerEntry,
    jackpotBountyEvPerEntry: avg((s) => s.jackpotBountyEvPerEntry),
    bountyShare: evPerEntry > 1e-9 ? bountyEvPerEntry / evPerEntry : 0,
    tiers: mixTiers(parts, repIdx),
    ftField: avg((s) => s.ftField),
    ftEvShare: evPerEntry > 1e-9 ? ftEv / evPerEntry : 0,
    shellFeasible: parts.every((s) => s.shellFeasible),
    shellTargetEv: worst.shellTargetEv,
    shellCurrentEv: worst.shellCurrentEv,
    shellP1: avg((s) => s.shellP1),
    shellTop3: avg((s) => s.shellTop3),
    shellFt: avg((s) => s.shellFt),
    shellBubble: avg((s) => s.shellBubble),
    shellFirstCash: avg((s) => s.shellFirstCash),
    paidCount: Math.round(avg((s) => s.paidCount)),
  };
}
