import { primedopeCurveForPaid } from "./pdCurves";
import type { PayoutStructureId } from "./types";

/**
 * Returns an array of prize fractions (of the prize pool) for places
 * 1..paid. Fractions sum to 1.
 */
export function getPayoutTable(
  structure: PayoutStructureId,
  players: number,
  custom?: number[],
): number[] {
  switch (structure) {
    case "winner-takes-all":
      return [1];

    case "sng-65-35":
      return normalize([0.65, 0.35]);

    case "sng-50-30-20":
      return normalize([0.5, 0.3, 0.2]);

    case "mtt-flat": {
      const paid = Math.max(1, Math.floor(players * 0.2));
      return buildRealisticCurve(paid, players, {
        firstShare: firstShareForField(0.095, 0.065, players),
        ftRatio: 1.25,
        minCashBuyIns: 2.0,
      });
    }

    case "mtt-top-heavy": {
      const paid = Math.max(1, Math.floor(players * 0.12));
      return buildRealisticCurve(paid, players, {
        firstShare: firstShareForField(0.25, 0.17, players),
        ftRatio: 1.55,
        minCashBuyIns: 1.5,
      });
    }

    case "battle-royale": {
      // GG Mystery Battle Royale is 18-max — fixed 3 paid, cash split
      // 100:75:50 per GG's published tables (e.g. $25 BIN pays $100/$75/$50
      // out of the non-bounty pool). Normalised that's 4:3:2 = 44.4/33.3/22.2.
      const paid = Math.max(1, Math.round((players * 3) / 18));
      if (paid <= 3) {
        return normalize([4, 3, 2].slice(0, paid));
      }
      return buildRealisticCurve(paid, players, {
        firstShare: firstShareForField(0.44, 0.3, players),
        ftRatio: 1.4,
        minCashBuyIns: 1.2,
      });
    }

    case "mtt-primedope":
      return primedopeTable(players, custom);

    case "mtt-pokerstars":
      return pokerStarsTable(players);

    case "mtt-gg":
      return ggTable(players);

    case "mtt-sunday-million":
      return sundayMillionTable(players);

    case "mtt-gg-bounty":
      return ggBountyTable(players);

    case "mtt-gg-mystery":
      return ggMysteryTable(players);

    case "satellite-ticket": {
      // Ticket satellite — every "paid" place wins the same ticket, no
      // graduated prize. Ordering above the seat line is irrelevant to EV,
      // which flattens upside variance hard (you can't "bink first" —
      // first and min-cash are identical outcomes). We default to the
      // top 10% of the field as seats; use the custom-payouts field to
      // override with an exact seat count.
      const seats = Math.max(1, Math.floor(players * 0.1));
      return new Array(seats).fill(1 / seats);
    }

    case "custom":
      if (custom && custom.length > 0) {
        // A payout table cannot pay more places than exist in the field.
        // Legacy share/localStorage payloads can still carry longer arrays;
        // trim the impossible tail so the runtime doesn't silently drop part
        // of the prize pool by normalizing over unreachable extra places.
        const paid = Math.max(1, Math.min(Math.floor(players), custom.length));
        return normalize(custom.slice(0, paid));
      }
      return normalizedGeometric(Math.max(1, Math.floor(players * 0.15)), 1.35);

    case "mtt-standard":
    default: {
      const paid = Math.max(1, Math.floor(players * 0.15));
      return buildRealisticCurve(paid, players, {
        firstShare: firstShareForField(0.19, 0.12, players),
        ftRatio: 1.40,
        minCashBuyIns: 1.75,
      });
    }
  }
}

/**
 * Log-linear interpolation of a field-size-dependent target between a
 * "small field" anchor (players=500) and a "large field" anchor
 * (players=15000). Real tables compress 1st-share as the field grows
 * because tier rounding eats the top; rather than bake a single fixed
 * target into each preset, we anchor at both ends and interpolate.
 */
function firstShareForField(
  small: number,
  large: number,
  players: number,
): number {
  const lo = Math.log10(500);
  const hi = Math.log10(15000);
  const t = Math.max(
    0,
    Math.min(1, (Math.log10(Math.max(players, 2)) - lo) / (hi - lo)),
  );
  return small * (1 - t) + large * t;
}

/**
 * PrimeDope's native MTT payout-table family — their scraped anchor curves
 * (see `pdCurves.ts`), picked by paid-place count.
 *
 * When `custom` is provided and non-empty, we honour its length as the
 * authoritative paid count and delegate to `primedopeCurveForPaid`.
 * Otherwise we fall back to PD's default rule (paid = floor(0.15 × players)).
 *
 * PD's own curve list caps at paid=700; beyond that their data pads with
 * zeros, which produces broken (no-min-cash) tables for 5k+ fields. We
 * detect the fallthrough and substitute a PD-shape realistic curve so the
 * structure stays usable on huge schedules.
 */
function primedopeTable(players: number, custom?: number[]): number[] {
  const paid =
    custom && custom.length > 0
      ? custom.length
      : Math.max(1, Math.floor(players * 0.15));
  if (paid > 700) {
    return buildRealisticCurve(paid, players, {
      firstShare: firstShareForField(0.22, 0.13, players),
      ftRatio: 1.42,
      minCashBuyIns: 1.75,
    });
  }
  return primedopeCurveForPaid(paid);
}

/**
 * PokerStars MTT payout approximation, anchored to SCOOP 119-L Main
 * (16,883 entries, $109, 1st=10.75%, ftRatio=1.40, min=1.75×bi).
 */
function pokerStarsTable(players: number): number[] {
  const paid = Math.max(1, Math.floor(players * 0.143));
  return buildRealisticCurve(paid, players, {
    firstShare: firstShareForField(0.16, 0.1075, players),
    ftRatio: 1.40,
    minCashBuyIns: 1.75,
  });
}

/**
 * CoinPoker MTT payout approximation, anchored to Mini CoinMasters
 * (911 entries, ₹25, 1st=16.71%, ftRatio=1.41, min=1.84×bi).
 */
function ggTable(players: number): number[] {
  const paid = Math.max(1, Math.floor(players * 0.158));
  return buildRealisticCurve(paid, players, {
    firstShare: firstShareForField(0.178, 0.115, players),
    ftRatio: 1.41,
    minCashBuyIns: 1.84,
  });
}

/**
 * PokerStars Sunday Million reference curve. Real 2024–2025 tables pay
 * ~13.8 % of the field with a top-heavy distribution. Anchored between
 * SCOOP Main-ish behaviour at 16k and richer ~16 % 1st at 500 runners.
 */
function sundayMillionTable(players: number): number[] {
  const paid = Math.max(9, Math.floor(players * 0.138));
  return buildRealisticCurve(paid, players, {
    firstShare: firstShareForField(0.165, 0.115, players),
    ftRatio: 1.42,
    minCashBuyIns: 1.85,
  });
}

/**
 * GGPoker Bounty Builder / PKO reference curve. In a PKO the visible
 * "regular" prize-pool column has two distinctive features we model
 * explicitly:
 *
 *   1. Half of each buy-in goes to the bounty pool, so the regular
 *      column is effectively half of a non-bounty table. Real 1st
 *      share lands around 6.5–7.5 % instead of 14–17 %.
 *   2. The top of the table is flat (1st ≈ 2nd) because the real EV
 *      boost for winning the whole thing is attached to bounties, not
 *      the regular column.
 *
 * Anchored to the Mini CoinHunter PKO sample in `data/payout-samples/`.
 */
function ggBountyTable(players: number): number[] {
  const paid = Math.max(9, Math.floor(players * 0.115));
  // ftRatio=1.26 rather than 1.40: a bounty FT with 1st=6.9 % and a
  // 1.40 cascade leaves ft[8]≈0.65 %, which caps the tail too low to
  // absorb the remaining 70 % of the pool (infeasible). A shallower
  // cascade keeps ft[8] high enough that the bisection solver can hit
  // both the min-cash and the sum-to-1 constraints.
  return buildRealisticCurve(paid, players, {
    firstShare: 0.069,
    ftRatio: 1.26,
    minCashBuyIns: 1.71,
    flatTop2: true,
  });
}

/**
 * GGPoker Mystery Bounty reference curve. Mystery format splits 50 % of
 * the buy-in into a bounty pool, same as PKO — but unlike PKO's
 * progressive heads, Mystery uses **fixed-amount envelopes** that only
 * drop during the ITM phase. Two shape consequences vs. `ggBountyTable`:
 *
 *   1. The regular column is still half-sized, so 1st share sits lower
 *      than a pure freezeout (7–11 % vs 14–17 %). But it's distinctly
 *      higher than PKO's ~7 % because the winner doesn't cap out at
 *      "one more head": envelopes don't replace the cash winner's
 *      jackpot, they stack on top of it.
 *   2. NO `flatTop2`. In PKO the 1st→2nd gap is mostly the final
 *      bounty, so regular-column 1st ≈ 2nd. In Mystery the envelopes
 *      are drawn fresh at every ITM KO; the winner's regular-side
 *      pay-jump is proportional and distinct.
 *
 * paid-share slightly shallower than mtt-standard (13 % vs 15 %) — GG
 * Mystery tends to pay tighter than vanilla MTTs to reserve budget for
 * the jackpot envelopes. Anchors aren't from a single sample; they're
 * sanity-checked against observed $100 / $215 Daily Mystery Bounty
 * tables and will be retuned when real samples land (#data-plan).
 */
function ggMysteryTable(players: number): number[] {
  const paid = Math.max(9, Math.floor(players * 0.13));
  return buildRealisticCurve(paid, players, {
    firstShare: firstShareForField(0.125, 0.09, players),
    ftRatio: 1.38,
    minCashBuyIns: 1.75,
  });
}

function normalizedGeometric(paid: number, ratio: number): number[] {
  const raw = new Array<number>(paid);
  for (let i = 0; i < paid; i++) raw[i] = Math.pow(ratio, -i);
  return normalize(raw);
}

interface RealisticCurveParams {
  /** Post-normalization 1st place share target (exact). */
  firstShare: number;
  /** FT geometric ratio: place N ≈ place (N+1) × ftRatio. Typically 1.40. */
  ftRatio: number;
  /** Post-normalization min-cash target in buy-in units. */
  minCashBuyIns: number;
  /** If true, 1st = 2nd (PKO bounty regular side). */
  flatTop2?: boolean;
}

/**
 * Realistic MTT curve generator — exact-constraint solver.
 *
 * Constraints hit exactly:
 *   - table[0] = firstShare               (post-normalization)
 *   - table[i]/table[i+1] = ftRatio       for i in 1..ftLen-1 (or i in 2..
 *     when `flatTop2` pins table[0] = table[1])
 *   - table[paid-1] = minCashBuyIns / players
 *   - sum(table) = 1
 *
 * Construction: build the FT directly in normalized space. The tail is
 * parameterised as a shifted-power curve:
 *
 *     tail[j] = tailEnd + (tailStart − tailEnd) · (1 − t)^c
 *
 * with t = j / (tailLen − 1). Monotone non-increasing in j for c ≥ 0, and
 * `sum(tail)` is monotone decreasing in c. We bisect on c to land on
 * `tailTarget = 1 − ftSum`. This replaces the earlier two-pass fixed-
 * point on `minRaw`, which couldn't simultaneously pin both 1st share
 * and min-cash and drifted 1–4 pp on huge fields.
 */
function buildRealisticCurve(
  paid: number,
  players: number,
  params: RealisticCurveParams,
): number[] {
  if (paid <= 0) return [1];
  if (paid === 1) return [1];

  const { firstShare, ftRatio, minCashBuyIns, flatTop2 = false } = params;
  const ftLen = Math.min(9, paid);

  const ft = new Array<number>(ftLen);
  ft[0] = firstShare;
  if (flatTop2 && ftLen >= 2) {
    ft[1] = firstShare;
    for (let i = 2; i < ftLen; i++) ft[i] = ft[i - 1] / ftRatio;
  } else {
    for (let i = 1; i < ftLen; i++) ft[i] = ft[i - 1] / ftRatio;
  }

  if (paid === ftLen) {
    return normalize(ft);
  }

  const ftSum = ft.reduce((a, b) => a + b, 0);
  const tailLen = paid - ftLen;
  const ftLast = ft[ftLen - 1];
  const targetTailSum = 1 - ftSum;

  const tailStart = ftLast * 0.98;
  const tailEndTarget = minCashBuyIns / Math.max(1, players);
  const tailEnd = Math.min(tailEndTarget, tailStart * 0.99);
  const delta = tailStart - tailEnd;

  const maxTailSum = tailLen * tailStart;
  const minTailSum = tailStart + (tailLen - 1) * tailEnd;

  if (targetTailSum >= maxTailSum || targetTailSum <= minTailSum) {
    const raw = ft.slice();
    for (let j = 0; j < tailLen; j++) {
      const t = tailLen === 1 ? 1 : j / (tailLen - 1);
      raw.push(tailEnd + delta * Math.pow(1 - t, 1));
    }
    return normalize(raw);
  }

  const sumAt = (c: number): number => {
    let s = 0;
    for (let j = 0; j < tailLen; j++) {
      const t = tailLen === 1 ? 1 : j / (tailLen - 1);
      s += tailEnd + delta * Math.pow(1 - t, c);
    }
    return s;
  };

  let lo = 0.001;
  let hi = 200;
  for (let iter = 0; iter < 80; iter++) {
    const mid = 0.5 * (lo + hi);
    const s = sumAt(mid);
    if (s > targetTailSum) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-10) break;
  }
  const c = 0.5 * (lo + hi);

  const result = new Array<number>(paid);
  for (let i = 0; i < ftLen; i++) result[i] = ft[i];
  for (let j = 0; j < tailLen; j++) {
    const t = tailLen === 1 ? 1 : j / (tailLen - 1);
    result[ftLen + j] = tailEnd + delta * Math.pow(1 - t, c);
  }
  return result;
}

function normalize(arr: number[]): number[] {
  let s = 0;
  for (const v of arr) s += v;
  if (s <= 0) return arr;
  return arr.map((v) => v / s);
}

/**
 * Parse a custom payout table from a user-entered string.
 * Accepts:
 *   "50 30 20"
 *   "50, 30, 20"
 *   "50% 30% 20%"
 *   lines, columns, any mix of whitespace / commas / percent signs
 */
export function parsePayoutString(input: string): number[] | null {
  const nums = input
    .split(/[\s,;]+/)
    .map((x) => x.replace(/%/g, ""))
    .filter(Boolean)
    .map(Number)
    .filter((x) => Number.isFinite(x) && x >= 0);
  if (nums.length === 0) return null;
  return normalize(nums);
}
