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
      return normalizedGeometric(paid, 1.1);
    }

    case "mtt-top-heavy": {
      const paid = Math.max(1, Math.floor(players * 0.12));
      return normalizedGeometric(paid, 1.6);
    }

    case "mtt-primedope":
      return primedopeTable(players);

    case "mtt-pokerstars":
      return pokerStarsTable(players);

    case "mtt-gg":
      return ggTable(players);

    case "mtt-sunday-million":
      return sundayMillionTable(players);

    case "mtt-gg-bounty":
      return ggBountyTable(players);

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
      if (custom && custom.length > 0) return normalize(custom.slice());
      return normalizedGeometric(Math.max(1, Math.floor(players * 0.15)), 1.35);

    case "mtt-standard":
    default: {
      const paid = Math.max(1, Math.floor(players * 0.15));
      return normalizedGeometric(paid, 1.35);
    }
  }
}

/**
 * PrimeDope's "standard MTT" payout curve — the exact `h[8]` table from
 * their legacy JS (`tmp_legacy.js`). At N = 100 this pays 15 places with
 * 1st = 25.5 %, arithmetic-ish decay toward flat plateaus 10–12 (2.5 %)
 * and 13–15 (2 %). Reverse-engineered and documented in
 * `notes/primedope_sd_theories.md`. Using this curve puts our binary-ITM
 * σ within ~2 % of PD's reported numbers.
 *
 * For fields other than 100p we preserve the curve shape by resampling
 * the 15-slot reference onto `paid = floor(0.15·N)` places via piecewise
 * linear interpolation of the cumulative distribution.
 */
const PRIMEDOPE_H8_FRACTIONS: readonly number[] = [
  0.255, 0.16, 0.115, 0.09, 0.075, 0.06, 0.045, 0.035, 0.03, 0.025, 0.025,
  0.025, 0.02, 0.02, 0.02,
];

function primedopeTable(players: number): number[] {
  const paid = Math.max(1, Math.floor(players * 0.15));
  if (paid === PRIMEDOPE_H8_FRACTIONS.length) {
    return normalize(PRIMEDOPE_H8_FRACTIONS.slice());
  }
  // Resample by cumulative interpolation: treat h[8] as a density on [0,1]
  // of rank-in-paid-bracket, and integrate it across `paid` equal-width
  // buckets on the new field.
  const src = PRIMEDOPE_H8_FRACTIONS;
  const srcCum: number[] = new Array(src.length + 1);
  srcCum[0] = 0;
  for (let i = 0; i < src.length; i++) srcCum[i + 1] = srcCum[i] + src[i];
  const total = srcCum[src.length];
  const sampleCum = (t: number): number => {
    // Map t ∈ [0,1] to a position in the source CDF, linearly interpolated.
    const x = t * src.length;
    const lo = Math.floor(x);
    if (lo >= src.length) return total;
    const frac = x - lo;
    return srcCum[lo] + frac * (srcCum[lo + 1] - srcCum[lo]);
  };
  const out = new Array<number>(paid);
  for (let i = 0; i < paid; i++) {
    const a = sampleCum(i / paid);
    const b = sampleCum((i + 1) / paid);
    out[i] = b - a;
  }
  return normalize(out);
}

/**
 * Approximation of the PokerStars MTT payout curve — 15 % paid, sharper
 * concentration at the top (1st gets ~18 %, 2nd ~13 %, 3rd ~9 %, …).
 */
function pokerStarsTable(players: number): number[] {
  const paid = Math.max(1, Math.floor(players * 0.15));
  // Custom curve: 1st ~= 18 %, then geometric with ratio 1.45.
  const raw: number[] = new Array(paid);
  raw[0] = 0.18;
  for (let i = 1; i < paid; i++) {
    raw[i] = raw[i - 1] / 1.45;
  }
  return normalize(raw);
}

/**
 * Approximation of the GGPoker MTT payout curve — 18 % paid, slightly
 * flatter than PokerStars.
 */
function ggTable(players: number): number[] {
  const paid = Math.max(1, Math.floor(players * 0.18));
  const raw: number[] = new Array(paid);
  raw[0] = 0.16;
  for (let i = 1; i < paid; i++) {
    raw[i] = raw[i - 1] / 1.38;
  }
  return normalize(raw);
}

/**
 * PokerStars Sunday Million reference curve. Real recent tournaments pay
 * ~13.8 % of the field with a very top-heavy distribution:
 *   1st  ≈ 14.0 %
 *   2nd  ≈ 10.3 %
 *   3rd  ≈  7.5 %
 *   ...
 *   min-cash ≈ 0.015 %
 *
 * We fit these anchors with a hybrid: explicit top-9 percentages (final
 * table) taken from the observed 2024 payout charts, then a smooth
 * stretched-exponential decay for the remainder, finally re-normalised so
 * everything sums to 1.
 */
function sundayMillionTable(players: number): number[] {
  const paid = Math.max(9, Math.floor(players * 0.138));
  const topNine = [
    0.14, 0.103, 0.075, 0.055, 0.04, 0.029, 0.021, 0.0155, 0.0115,
  ];
  const raw: number[] = new Array(paid).fill(0);
  const ftLen = Math.min(9, paid);
  for (let i = 0; i < ftLen; i++) raw[i] = topNine[i];
  // Tail: stretched-exponential from 0.009 down to the minimum cash, where
  // the minimum is pinned to roughly 1.5 × buy-in in pool fraction terms.
  if (paid > ftLen) {
    const tailLen = paid - ftLen;
    const start = 0.009;
    const end = 0.00012;
    // p_i = start × (end / start) ^ ((i / (tailLen-1))^0.85)
    const lgRatio = Math.log(end / start);
    for (let j = 0; j < tailLen; j++) {
      const t = tailLen === 1 ? 1 : j / (tailLen - 1);
      raw[ftLen + j] = start * Math.exp(lgRatio * Math.pow(t, 0.85));
    }
  }
  return normalize(raw);
}

/**
 * GGPoker Bounty Builder reference curve. Bounty MTTs pay out roughly
 * half the prize pool as bounties, so the visible "regular" prize-pool
 * table has a much flatter top because half the EV is attached to each
 * knockout and doesn't live on this curve. For the purposes of our sim
 * we model the full visible payout column of the 2024 Bounty Builder
 * series (15 % paid, fairly flat):
 *   1st  ≈ 6 % · 2nd ≈ 4.4 % · 3rd ≈ 3.3 %
 * Remainder decays geometrically. Callers who want bountied EV should
 * additionally bump row.roi — this table only covers the regular side.
 */
function ggBountyTable(players: number): number[] {
  const paid = Math.max(9, Math.floor(players * 0.15));
  const topSeven = [0.06, 0.044, 0.033, 0.0245, 0.018, 0.0135, 0.01];
  const raw: number[] = new Array(paid).fill(0);
  const len = Math.min(7, paid);
  for (let i = 0; i < len; i++) raw[i] = topSeven[i];
  if (paid > len) {
    const tailLen = paid - len;
    const start = 0.0075;
    const end = 0.0008;
    const lgRatio = Math.log(end / start);
    for (let j = 0; j < tailLen; j++) {
      const t = tailLen === 1 ? 1 : j / (tailLen - 1);
      raw[len + j] = start * Math.exp(lgRatio * Math.pow(t, 0.9));
    }
  }
  return normalize(raw);
}

function normalizedGeometric(paid: number, ratio: number): number[] {
  const raw = new Array<number>(paid);
  for (let i = 0; i < paid; i++) raw[i] = Math.pow(ratio, -i);
  return normalize(raw);
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
