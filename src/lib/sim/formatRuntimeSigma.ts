/**
 * One σ per format for the planning cards ("Convergence" chips and "How many
 * to play"). The point estimate is the same number schedule mode shows for a
 * one-row schedule of that format: the row is built the way the schedule
 * editor builds a fresh row of the format (`applyGameType`, the format's
 * default payout table, the run path's ITM defaults) and compiled by the
 * engine's own analytic twin. No closed-form surface sits between the card
 * and the engine, so a card and a schedule row cannot disagree.
 *
 * The band around the point is a separate matter: `runtimeSigmaBandResid` is
 * how far this analytic σ sat from the engine's own Monte-Carlo σ over the grid
 * in `runtimeSigmaBands.ts`. The chips, the prove-edge card and schedule mode
 * all read that one number, and the gate that hides the band outside the grid
 * is `isInsideFitBox`.
 */
import { battleRoyaleRowFromTotalTicket } from "./battleRoyaleTicket";
import {
  buildExactBreakdown,
  type ConvergenceFormat,
  type MixTuple,
  type SigmaBand,
} from "./convergenceMath";
import type { ConvergenceRowFormat } from "./convergencePolicy";
import { applyGameType, BATTLE_ROYALE_PLAYERS } from "./gameType";
import {
  applyItmTarget,
  resolveItmTarget,
  type ItmTargetConfig,
} from "./itmTarget";
import {
  runtimeSigmaBandResid,
  type RuntimeSigmaFormat,
} from "./runtimeSigmaBands";
import type { FinishModelConfig, GameType, TournamentRow } from "./types";

export { runtimeSigmaBandResid, type RuntimeSigmaFormat };

/** Battle Royale is a fixed 18-max sit-and-go; the lobby never changes. */
export const RUNTIME_SIGMA_BR_FIELD = BATTLE_ROYALE_PLAYERS;
/** Total BR ticket (the cheapest-tier preset in the editor) behind the BR σ. */
export const RUNTIME_SIGMA_BR_TICKET = 10;

/** Stake-neutral buy-in for formats whose σ in buy-ins does not depend on it. */
const NEUTRAL_BUY_IN = 10;

/** Run-path default: the global ITM target is off, rows take the paid share. */
const DEFAULT_ITM_TARGET: ItmTargetConfig = { enabled: false, pct: 0 };

const GAME_TYPE_BY_FORMAT: Record<RuntimeSigmaFormat, GameType> = {
  freeze: "freezeout",
  pko: "pko",
  mystery: "mystery",
  "mystery-royale": "mystery-royale",
};

export interface RuntimeSigmaPoint {
  /** Field size; ignored for Battle Royale (always 18). */
  afs: number;
  /** ROI as a fraction (0.10 = +10 %). */
  roi: number;
  /** Rake as a fraction of the net buy-in (0.10 = 10 %). */
  rake: number;
  finishModel?: FinishModelConfig;
  /** Global ITM target of the run path; the cards use the default (off). */
  itmTarget?: ItmTargetConfig;
}

/**
 * The single-row schedule a card stands for, with the run path's ITM
 * defaults already applied (what the engine actually receives).
 */
export function buildFormatRuntimeRow(
  format: RuntimeSigmaFormat,
  point: Pick<RuntimeSigmaPoint, "afs" | "roi" | "rake" | "itmTarget">,
): TournamentRow {
  const isBr = format === "mystery-royale";
  const base: TournamentRow = {
    id: `runtime-sigma-${format}`,
    label: format,
    players: isBr
      ? RUNTIME_SIGMA_BR_FIELD
      : Math.max(2, Math.round(point.afs)),
    buyIn: isBr
      ? battleRoyaleRowFromTotalTicket(RUNTIME_SIGMA_BR_TICKET).buyIn
      : NEUTRAL_BUY_IN,
    rake: Math.max(0, point.rake),
    roi: point.roi,
    payoutStructure: "mtt-standard",
    gameType: "freezeout",
    count: 1,
  };
  const typed: TournamentRow = {
    ...base,
    ...applyGameType(base, GAME_TYPE_BY_FORMAT[format]),
    // The BR preset resets ticket, rake and ROI to its own defaults; the card
    // supplies rake and ROI, and the ticket stays on the $10 tier.
    buyIn: base.buyIn,
    rake: base.rake,
    roi: base.roi,
  };
  return applyItmTarget([typed], point.itmTarget ?? DEFAULT_ITM_TARGET)[0];
}

const SIGMA_CACHE_LIMIT = 512;
const sigmaCache = new Map<string, number | null>();

function cacheKey(format: RuntimeSigmaFormat, point: RuntimeSigmaPoint): string {
  const afs = format === "mystery-royale" ? RUNTIME_SIGMA_BR_FIELD : point.afs;
  // The resolved target, so an off switch and an absent target share an entry.
  const itm = String(
    point.itmTarget ? (resolveItmTarget(point.itmTarget) ?? "") : "",
  );
  const model = point.finishModel ? JSON.stringify(point.finishModel) : "";
  return `${format}|${afs}|${point.roi}|${point.rake}|${itm}|${model}`;
}

/** Number of memoized σ points; lets tests prove a call was cache-only. */
export function runtimeSigmaCacheSize(): number {
  return sigmaCache.size;
}

/** Whether `formatRuntimeSigma` would answer this point from the cache. */
export function hasFormatRuntimeSigma(
  format: RuntimeSigmaFormat,
  point: RuntimeSigmaPoint,
): boolean {
  return sigmaCache.has(cacheKey(format, point));
}

/**
 * σ of ROI per tournament for the format's default one-row schedule, in
 * buy-ins. `null` only when the engine reports no schedule at all.
 *
 * Memoized: the planning cards ask for ~19 ROI candidates per render and the
 * compile cost grows with the field, while the inputs repeat across renders.
 */
export function formatRuntimeSigma(
  format: RuntimeSigmaFormat,
  point: RuntimeSigmaPoint,
): number | null {
  const key = cacheKey(format, point);
  const hit = sigmaCache.get(key);
  if (hit !== undefined) return hit;
  const breakdown = buildExactBreakdown([buildFormatRuntimeRow(format, point)], {
    finishModel: point.finishModel,
  });
  const sigma = breakdown ? breakdown.sigmaEff : null;
  if (sigmaCache.size >= SIGMA_CACHE_LIMIT) {
    const oldest = sigmaCache.keys().next().value;
    if (oldest !== undefined) sigmaCache.delete(oldest);
  }
  sigmaCache.set(key, sigma);
  return sigma;
}

export function formatRuntimeSigmaBand(
  format: RuntimeSigmaFormat,
  point: RuntimeSigmaPoint,
): SigmaBand | null {
  const s = formatRuntimeSigma(format, point);
  if (s === null) return null;
  const resid = runtimeSigmaBandResid(format);
  return { s, lo: s * (1 - resid), hi: s * (1 + resid) };
}

/**
 * `sigmaOverrides` for `computeConvergenceRows` in single-format and mix
 * modes: one runtime band per format the selection actually uses. Mix keeps
 * its quadratic blend of the three per-format σ; only the inputs change.
 */
export function buildRuntimeSigmaOverrides(input: {
  format: ConvergenceFormat;
  mix: MixTuple;
  point: RuntimeSigmaPoint;
}): Partial<Record<ConvergenceRowFormat, SigmaBand>> | undefined {
  const { format, mix, point } = input;
  const wanted: RuntimeSigmaFormat[] =
    format === "freeze" ||
    format === "pko" ||
    format === "mystery" ||
    format === "mystery-royale"
      ? [format]
      : format === "mix"
        ? (["freeze", "pko", "mystery"] as const).filter((_, i) => mix[i] > 0)
        : [];
  const overrides: Partial<Record<ConvergenceRowFormat, SigmaBand>> = {};
  for (const f of wanted) {
    const band = formatRuntimeSigmaBand(f, point);
    if (band) overrides[f] = band;
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}
