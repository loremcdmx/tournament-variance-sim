"use client";

import { memo, useMemo, useState } from "react";
import {
  applyBountyBias,
  buildFinishPMF,
  calibrateAlpha,
  calibrateShelledItm,
  isAlphaAdjustable,
} from "@/lib/sim/finishModel";
import { makeBrTierSampler } from "@/lib/sim/brBountyTiers";
import { getPayoutTable } from "@/lib/sim/payouts";
import type { FinishModelConfig, TournamentRow } from "@/lib/sim/types";
import { useT } from "@/lib/i18n/LocaleProvider";
import type { DictKey } from "@/lib/i18n/dict";

import { useAdvancedMode } from "@/lib/ui/AdvancedModeProvider";

interface Props {
  row: TournamentRow;
  model: FinishModelConfig;
  /** If provided, the fixed-ITM shape controls panel is shown below the
   *  tier breakdown and can edit row.itmRate / row.finishBuckets. */
  onRowChange?: (updates: Partial<TournamentRow>) => void;
  /** When true, the global ITM cascade is driving row.itmRate — hide
   *  / disable the shape editor so the user knows tweaks would be
   *  overridden on the next render. */
  itmLocked?: boolean;
}

type TierKey =
  | "winner"
  | "top3"
  | "ft"
  | "top27"
  | "restItm"
  | "firstMincash"
  | "bubble"
  | "ootm";

type TierLabelKey =
  | "preview.tierWinner"
  | "preview.tierTop3"
  | "preview.tierFt"
  | "preview.tierTop27"
  | "preview.tierRestItm"
  | "preview.probFirstCash"
  | "preview.probBubble"
  | "preview.tierOotm";

interface TierRow {
  key: TierKey;
  labelKey: TierLabelKey;
  color: string;
  /** Dollar EV contributed by places in this tier (gross, cash + bounty). */
  ev: number;
  /** Cash-pool slice of `ev` — Σ pmf[i]·prizeByPlace[i] for places in tier. */
  cashEv: number;
  /** Bounty-pool slice of `ev` — Σ pmf[i]·bountyByPlace[i] for places in tier.
   *  For freezeouts this is 0; for PKO/Mystery/BR it's the chunk of this
   *  tier's EV that comes from busting opponents rather than seat equity. */
  bountyEv: number;
  /** Expected cash prize GIVEN a finish in this tier (conditional mean). */
  cashGivenFinish: number;
  /** Expected bounty dollars GIVEN a finish in this tier. */
  bountyGivenFinish: number;
  /** Expected number of opponents busted GIVEN a finish in this tier,
   *  under uniform-skill harmonic expectation E[busts | place p] =
   *  H(N-1) − H(p-1). Weighted by pmf across the tier's place range.
   *  For non-bounty formats this is still meaningful but less interesting. */
  bustsGivenFinish: number;
  /** Average size of one bounty collected in this tier (bounty$ / busts).
   *  Captures progressive-PKO head-growth up the ladder: a deep finisher
   *  collects fewer but bigger heads than someone busting early. */
  bountySizePerBust: number;
  /** Skill-calibrated share of finishes in this tier (Σ pmf). */
  field: number;
  /** Equilibrium (uniform 1/N) share — the "zero-skill" baseline. */
  eqShare: number;
  /** Net dollar contribution to ROI per entry: ev − field × entryCost.
   *  Sums across disjoint tiers to evPerEntry − entryCost = net profit. */
  netDollars: number;
  /** Same calc but at zero-skill equilibrium (uniform 1/N PMF). Sum
   *  across all disjoint tiers equals −rake per entry, since at random
   *  play the expected return is exactly the prize pool divided by
   *  players, and entryCost = buyIn × (1 + rake). */
  eqNetDollars: number;
  /** Seat count used in the label suffix. For cumulative-label tiers
   *  (winner, top0.1%, top0.5%, top1%, top5%, top10%, final table) this
   *  is `hi` — the cumulative top cut the label refers to. For disjoint
   *  tiers (rest-ITM, first min-cash, bubble, OOTM) it's the band width. */
  displaySeats: number;
  /** 1-indexed start of position range (inclusive). */
  posLo: number;
  /** 1-indexed end of position range (inclusive). */
  posHi: number;
}

export const FinishPMFPreview = memo(function FinishPMFPreview({
  row,
  model,
  onRowChange,
  itmLocked,
}: Props) {
  const t = useT();
  const { advanced } = useAdvancedMode();

  const committedBias = clampBountyBias(row.bountyEvBias ?? 0);
  const {
    stats,
    committedBountyShare,
    defaultBountyShare,
    minBountyShare,
    maxBountyShare,
  } = useMemo(() => {
    const nextStats = computeRowStats(row, model);
    const hasBounty = (row.bountyFraction ?? 0) > 0;
    const baseStats =
      hasBounty && Math.abs(committedBias) > 1e-9
        ? computeRowStats({ ...row, bountyEvBias: 0 }, model)
        : nextStats;
    const lowKoStats =
      hasBounty && Math.abs(committedBias - MAX_BOUNTY_BIAS) > 1e-9
        ? computeRowStats({ ...row, bountyEvBias: MAX_BOUNTY_BIAS }, model)
        : nextStats;
    const highKoStats =
      hasBounty && Math.abs(committedBias - MIN_BOUNTY_BIAS) > 1e-9
        ? computeRowStats({ ...row, bountyEvBias: MIN_BOUNTY_BIAS }, model)
        : nextStats;
    return {
      stats: nextStats,
      committedBountyShare: clampUnit(nextStats.bountyShare),
      defaultBountyShare: clampUnit(baseStats.bountyShare),
      minBountyShare: clampUnit(lowKoStats.bountyShare),
      maxBountyShare: clampUnit(highKoStats.bountyShare),
    };
  }, [row, model, committedBias]);

  const evTotal = stats.tiers.reduce((a, tier) => a + tier.ev, 0) || 1;

  const moneyFmt = (v: number) => {
    if (v === 0) return "$0";
    const sign = v < 0 ? "-" : "";
    const abs = Math.abs(v);
    if (abs < 1000) {
      const hasFraction = Math.abs(abs - Math.round(abs)) > 0.005;
      return `${sign}$${hasFraction ? abs.toFixed(2) : Math.round(abs).toString()}`;
    }
    return `${sign}$${Math.round(abs).toLocaleString()}`;
  };

  const netProfitPerEntry = stats.evPerEntry - stats.cost;

  return (
    <div className="flex flex-col gap-3.5">
      {/* Tournament identity */}
      <div className="text-sm font-semibold text-[color:var(--color-fg)]">
        {row.label || t("row.unnamed")}
        <span className="ml-1 font-normal tabular-nums text-[color:var(--color-fg-dim)]">
          , α {stats.alpha.toFixed(2)}
          {stats.progressivePko
            ? ` · ${t("preview.statBountyPko")}`
            : stats.bountyShare > 0
              ? ` · ${t("preview.statBountyFlat")}`
              : ""}
        </span>
      </div>

      {/* Buy-in → avg profit */}
      <div className="group relative overflow-hidden rounded-xl border border-[color:var(--color-border-strong)]/70 bg-[linear-gradient(135deg,var(--color-bg)_0%,var(--color-bg-elev)_55%,rgba(255,222,81,0.08)_100%)] p-3.5 shadow-[0_18px_40px_-32px_rgba(0,0,0,0.9)]">
        <div className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-[color:var(--color-accent)]/70 to-transparent" />
        <div className="pointer-events-none absolute -right-10 -top-16 h-36 w-36 rounded-full bg-[color:var(--color-accent)]/10 blur-2xl transition-opacity duration-700 group-hover:opacity-80" />
        <div className="relative grid grid-cols-1 items-stretch gap-2.5 sm:grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)]">
          <div className="rounded-lg border border-[color:var(--color-border)]/70 bg-[color:var(--color-bg)]/65 px-3 py-2.5 shadow-sm">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
              {t("preview.youPay")}
            </div>
            <div className="text-[24px] font-bold leading-none tabular-nums text-[color:var(--color-fg)]">
              {moneyFmt(stats.cost)}
            </div>
          </div>
          <div className="flex min-h-8 items-center justify-center">
            <div className="relative flex h-full min-h-8 w-full items-center justify-center overflow-hidden rounded-lg border border-[color:var(--color-border)]/60 bg-[color:var(--color-bg)]/50">
              <span className="absolute inset-x-2 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-[color:var(--color-accent)]/50 to-transparent" />
              <span className="relative flex h-7 w-7 animate-pulse items-center justify-center rounded-full border border-[color:var(--color-accent)]/40 bg-[color:var(--color-bg-elev)] text-[9px] font-bold uppercase tracking-wider text-[color:var(--color-accent)] shadow-[0_0_18px_rgba(255,222,81,0.16)]">
                EV
              </span>
            </div>
          </div>
          <div className="rounded-lg border border-[color:var(--color-accent)]/35 bg-[color:var(--color-accent)]/10 px-3 py-2.5 text-right shadow-sm">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
              {t("preview.avgReturn")}
            </div>
            <div
              className={`text-[24px] font-bold leading-none tabular-nums ${
                netProfitPerEntry >= 0
                  ? "text-[color:var(--color-accent)]"
                  : "text-[color:var(--color-danger)]"
              }`}
            >
              {netProfitPerEntry >= 0 ? "+" : ""}
              {moneyFmt(netProfitPerEntry)}
            </div>
          </div>
        </div>
        {stats.bountyEvPerEntry > 0 && (() => {
          const jp = stats.jackpotBountyEvPerEntry;
          const hasJp = jp > 0 && jp / stats.bountyEvPerEntry > 0.001;
          const regularBounty = stats.bountyEvPerEntry - jp;
          const thresholdStr = String(stats.jackpotThreshold);
          const jpLabel = t("preview.evSplit.bountyJackpot").replace(
            "{x}",
            thresholdStr,
          );
          const jpTip = t("preview.evSplit.jackpotTip").replace(
            "{x}",
            thresholdStr,
          );
          return (
            <div className="mt-3 border-t border-[color:var(--color-border)]/60 pt-2">
              <div className="mb-2 text-[9px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
                {t("preview.evSplit")}
              </div>
              <div className={`grid gap-2 ${hasJp ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                <PreviewSplitStat
                  label={t("preview.evSplit.cash")}
                  value={moneyFmt(stats.cashEvPerEntry)}
                  color="var(--color-accent)"
                />
                <PreviewSplitStat
                  label={
                    hasJp
                      ? t("preview.evSplit.bountyRegular")
                      : t("preview.evSplit.bounty")
                  }
                  value={moneyFmt(hasJp ? regularBounty : stats.bountyEvPerEntry)}
                  color="hsl(175, 72%, 55%)"
                />
                {hasJp && (
                  <PreviewSplitStat
                    label={jpLabel}
                    value={moneyFmt(jp)}
                    color="hsl(45, 95%, 60%)"
                    title={jpTip}
                  />
                )}
              </div>
            </div>
          );
        })()}
        {(row.bountyFraction ?? 0) > 0 && onRowChange && (
          <BountyShareSlider
            committedBias={committedBias}
            committedShare={committedBountyShare}
            defaultShare={defaultBountyShare}
            minShare={minBountyShare}
            maxShare={maxBountyShare}
            onCommit={(v) => onRowChange({ ...row, bountyEvBias: v })}
            title={t("preview.evBias.label")}
            cashLabel={t("preview.evBias.cash")}
            bountyLabel={t("preview.evBias.bounty")}
            tip={t("preview.evBias.tip")}
            resetLabel={t("preview.evBias.reset")}
          />
        )}
      </div>

      {/* Tier-by-tier breakdown + discrete position rows. Shared grid
          template: swatch | label | bar | %EV | field % | equilibrium % | $ ROI */}
      <div className="flex flex-col gap-1.5">
        <div className="grid grid-cols-[8px_minmax(0,1fr)_minmax(24px,1fr)_2.25rem_2.25rem_2.25rem_2.5rem] sm:grid-cols-[10px_minmax(0,1fr)_minmax(40px,1fr)_3rem_3.25rem_3.25rem_3.5rem] items-center gap-x-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
          <span />
          <span>{t("preview.evBreakdown")}</span>
          <span />
          <span className="text-right tabular-nums">{t("preview.colEv")}</span>
          <span className="text-right tabular-nums">{t("preview.colField")}</span>
          <span className="text-right tabular-nums">{t("preview.colEq")}</span>
          <span className="text-right tabular-nums">{t("preview.colRoi")}</span>
        </div>
        <div className="flex flex-col divide-y divide-[color:var(--color-border)]/60">
          {(() => {
            const rows: React.ReactNode[] = [];
            // Max evShare across disjoint tiers — used as the 100% baseline
            // for bar widths so the largest tier fills the full bar.
            let maxEv = 0;
            for (const tier of stats.tiers) {
              const s = tier.ev / evTotal;
              if (s > maxEv) maxEv = s;
            }
            // Disjoint tiers + interleaved cumulative summary rows (top3
            // and FT) injected right after the winner tier, so "топ3" and
            // "финалка" sit next to "1st place" instead of at the end.
            // Bounty overlay must contrast with every tier colour in the
            // palette (yellow / orange / violet / fuchsia / grey). Teal is
            // outside the tier hue range so the bounty slice stays visible
            // even on violet tiers like "Финалка" and "Остальные кеши".
            const bountyAccent = "hsl(175, 72%, 55%)";
            const hasBounty = stats.bountyEvPerEntry > 1e-6;
            for (const tier of stats.tiers) {
              const evShare = tier.ev / evTotal;
              const fieldShare = tier.field;
              if (evShare <= 0.0005 && fieldShare <= 0.0005) continue;
              const bountyShareOfTier =
                tier.ev > 1e-9 ? tier.bountyEv / tier.ev : 0;
              rows.push(
                <EvBreakdownRow
                  key={tier.key}
                  label={t(tier.labelKey)}
                  color={tier.color}
                  evShare={evShare}
                  fieldShare={fieldShare}
                  eqShare={tier.eqShare}
                  netDollars={tier.netDollars}
                  maxEvShare={maxEv}
                  bountyShareOfTier={bountyShareOfTier}
                  bountyColor={bountyAccent}
                  breakdown={{
                    tier,
                    hasBounty,
                    bountyColor: bountyAccent,
                    posRangeLabel:
                      tier.posLo === tier.posHi
                        ? `${tier.posLo}`
                        : `${tier.posLo}–${tier.posHi}`,
                  }}
                />,
              );
            }
            // Footer: the column-wise sum of net $ across disjoint tiers
            // equals net profit per entry — the user asked for ROI to
            // literally appear as the bottom of this column.
            const tierNetSum = stats.tiers.reduce(
              (a, x) => a + x.netDollars,
              0,
            );
            const tierEqNetSum = stats.tiers.reduce(
              (a, x) => a + x.eqNetDollars,
              0,
            );
            rows.push(
              <EvBreakdownFooter
                key="__footer__"
                label={t("preview.evBreakdownTotal")}
                netDollars={tierNetSum}
                eqNetDollars={tierEqNetSum}
              />,
            );
            return rows;
          })()}
        </div>
      </div>

      {advanced && onRowChange && !itmLocked && (
        <ShapeControls row={row} stats={stats} onRowChange={onRowChange} />
      )}
      {advanced && itmLocked && (
        <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-3 text-[10px] leading-snug text-[color:var(--color-fg-dim)]">
          {t("preview.itmLocked")}
        </div>
      )}
    </div>
  );
});

interface TierBreakdown {
  tier: TierRow;
  hasBounty: boolean;
  bountyColor: string;
  posRangeLabel: string;
}

function EvBreakdownRow({
  label,
  color,
  evShare,
  fieldShare,
  eqShare,
  netDollars,
  maxEvShare,
  bountyShareOfTier = 0,
  bountyColor,
  breakdown,
}: {
  label: string;
  color: string;
  evShare: number;
  fieldShare: number;
  eqShare: number;
  netDollars: number;
  maxEvShare?: number;
  /** 0..1 — fraction of this tier's EV that comes from the bounty pool.
   *  Renders as a right-anchored overlay on the EV bar in `bountyColor`,
   *  so the user can see at a glance how much of the tier is cash-equity
   *  (e.g. reaching the FT) vs busting opponents (heads for PKO/Mystery/BR). */
  bountyShareOfTier?: number;
  bountyColor?: string;
  /** When present, hovering the row reveals a popup with cash/bounty
   *  conditional means and heads busted — the "when I actually land
   *  here, what do I pocket" readout the user asked for. */
  breakdown?: TierBreakdown;
}) {
  const [hover, setHover] = useState(false);
  const labelClass = "text-[color:var(--color-fg)]";
  const netClass =
    netDollars > 0
      ? "text-[color:var(--color-accent)]"
      : netDollars < 0
        ? "text-[color:var(--color-danger)]"
        : "text-[color:var(--color-fg-dim)]";
  const evWidthPct = Math.min(
    100,
    Math.max(0, (maxEvShare ? evShare / maxEvShare : evShare) * 100),
  );
  const bountyWidthPct = evWidthPct * Math.max(0, Math.min(1, bountyShareOfTier));
  return (
    <div
      className="relative grid grid-cols-[8px_minmax(0,1fr)_minmax(24px,1fr)_2.25rem_2.25rem_2.25rem_2.5rem] sm:grid-cols-[10px_minmax(0,1fr)_minmax(40px,1fr)_3rem_3.25rem_3.25rem_3.5rem] items-center gap-x-1.5 py-1.5 text-[11px] hover:bg-[color:var(--color-bg-elev)]/30"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span
        className="h-2.5 w-2.5 rounded-sm"
        style={{ background: color }}
      />
      <span className={labelClass}>{label}</span>
      <div className="relative h-2 overflow-hidden rounded-sm bg-[color:var(--color-bg-elev-2)]">
        <div
          className="absolute inset-y-0 left-0 rounded-sm"
          style={{
            width: `${Math.min(100, Math.max(0, (maxEvShare ? eqShare / maxEvShare : eqShare) * 100))}%`,
            background: color,
            opacity: 0.3,
          }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-sm"
          style={{
            width: `${evWidthPct}%`,
            background: color,
          }}
        />
        {bountyWidthPct > 0.5 && bountyColor && (
          <div
            className="absolute inset-y-0 rounded-sm"
            style={{
              left: `${evWidthPct - bountyWidthPct}%`,
              width: `${bountyWidthPct}%`,
              background: bountyColor,
            }}
          />
        )}
      </div>
      <span className="text-right font-mono tabular-nums text-[color:var(--color-fg)]">
        {pct(evShare)}
      </span>
      <span className="text-right font-mono tabular-nums text-[color:var(--color-fg-dim)]">
        {pct(fieldShare)}
      </span>
      <span className="text-right font-mono tabular-nums text-[color:var(--color-fg-dim)]">
        {fmtEq(eqShare)}
      </span>
      <span
        className={`text-right font-mono tabular-nums ${netClass}`}
      >
        {fmtSignedMoney(netDollars)}
      </span>
      {hover && breakdown && (
        <TierHoverPopup label={label} breakdown={breakdown} />
      )}
    </div>
  );
}

function TierHoverPopup({
  label,
  breakdown,
}: {
  label: string;
  breakdown: TierBreakdown;
}) {
  const t = useT();
  const { tier, hasBounty, bountyColor, posRangeLabel } = breakdown;
  const oddsStr =
    tier.field > 1e-9
      ? `1 ${t("preview.hover.oddsIn")} ${Math.max(
          1,
          Math.round(1 / tier.field),
        )}`
      : "—";
  const [side, setSide] = useState<"right" | "left">("right");
  const measureRef = (el: HTMLDivElement | null) => {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) setSide("left");
    else if (rect.left < 8) setSide("right");
  };
  return (
    <div
      ref={measureRef}
      role="tooltip"
      className={`pointer-events-none absolute top-0 z-50 w-72 max-w-[85vw] rounded-md border-t-2 border-x border-b border-t-[color:var(--color-accent)] border-x-[color:var(--color-border-strong)] border-b-[color:var(--color-border-strong)] bg-[color:var(--color-bg-elev-2)] px-3 py-2.5 text-left text-[11px] leading-relaxed text-[color:var(--color-fg-muted)] shadow-[0_20px_40px_-12px_rgba(0,0,0,0.85)] ${
        side === "right" ? "left-full ml-2" : "right-full mr-2"
      }`}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-sm"
            style={{ background: tier.color }}
          />
          <span className="text-[12px] font-semibold text-[color:var(--color-fg)]">
            {label}
          </span>
        </div>
        <span className="font-mono text-[10px] tabular-nums text-[color:var(--color-fg-dim)]">
          {t("preview.hover.places")} {posRangeLabel}
        </span>
      </div>
      <div className="mb-2 flex items-baseline justify-between text-[10px]">
        <span className="uppercase tracking-wider text-[color:var(--color-fg-dim)]">
          {t("preview.hover.hitRate")}
        </span>
        <span className="font-mono tabular-nums text-[color:var(--color-fg)]">
          {pct(tier.field)} · {oddsStr}
        </span>
      </div>
      <div className="flex flex-col gap-1 border-t border-[color:var(--color-border)]/70 pt-1.5">
        <div className="text-[9px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
          {t("preview.hover.givenHit")}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-1.5 w-1.5 rounded-sm"
              style={{ background: tier.color }}
            />
            <span>{t("preview.hover.cashPayout")}</span>
          </span>
          <span className="font-mono tabular-nums text-[color:var(--color-fg)]">
            {fmtMoneyAbs(tier.cashGivenFinish)}
          </span>
        </div>
        {hasBounty && (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-1.5 w-1.5 rounded-sm"
                  style={{ background: bountyColor }}
                />
                <span>{t("preview.hover.bountyTotal")}</span>
              </span>
              <span className="font-mono tabular-nums text-[color:var(--color-fg)]">
                {fmtMoneyAbs(tier.bountyGivenFinish)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-[color:var(--color-fg-dim)]">
              <span>{t("preview.hover.bountyHeads")}</span>
              <span className="font-mono tabular-nums">
                {tier.bustsGivenFinish >= 1
                  ? tier.bustsGivenFinish.toFixed(1)
                  : tier.bustsGivenFinish.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-[color:var(--color-fg-dim)]">
              <span>{t("preview.hover.bountyAvgSize")}</span>
              <span className="font-mono tabular-nums">
                {fmtMoneyAbs(tier.bountySizePerBust)}
              </span>
            </div>
          </>
        )}
        <div className="mt-1 flex items-center justify-between gap-2 border-t border-[color:var(--color-border)]/50 pt-1 text-[color:var(--color-fg)]">
          <span className="font-semibold">{t("preview.hover.totalTake")}</span>
          <span className="font-mono tabular-nums">
            {fmtMoneyAbs(tier.cashGivenFinish + tier.bountyGivenFinish)}
          </span>
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-[color:var(--color-border)]/70 pt-1.5 text-[10px] text-[color:var(--color-fg-dim)]">
        <span>{t("preview.hover.perEntry")}</span>
        <span className="font-mono tabular-nums text-[color:var(--color-fg)]">
          {fmtMoneyAbs(tier.ev)}
        </span>
      </div>
    </div>
  );
}

function fmtMoneyAbs(v: number): string {
  if (!Number.isFinite(v) || v < 0.005) return "$0";
  if (v < 1000) {
    const hasFraction = Math.abs(v - Math.round(v)) > 0.005;
    return `$${hasFraction ? v.toFixed(2) : Math.round(v).toString()}`;
  }
  return `$${Math.round(v).toLocaleString()}`;
}

function EvBreakdownFooter({
  label,
  netDollars,
  eqNetDollars,
}: {
  label: string;
  netDollars: number;
  /** If provided, rendered inside the eq% column so the equilibrium
   *  (−rake) readout sits inline with ROI instead of on its own row. */
  eqNetDollars?: number;
}) {
  const netClass =
    netDollars > 0
      ? "text-[color:var(--color-accent)]"
      : netDollars < 0
        ? "text-[color:var(--color-danger)]"
        : "text-[color:var(--color-fg-dim)]";
  return (
    <div className="mt-0.5 grid grid-cols-[8px_minmax(0,1fr)_minmax(24px,1fr)_2.25rem_2.25rem_2.25rem_2.5rem] sm:grid-cols-[10px_minmax(0,1fr)_minmax(40px,1fr)_3rem_3.25rem_3.25rem_3.5rem] items-center gap-x-1.5 border-t border-[color:var(--color-border)] pt-1.5 text-[11px] font-semibold">
      <span />
      <span className="col-span-4 text-[10px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
        {label}
      </span>
      <span
        className="text-right font-mono text-[10px] tabular-nums text-[color:var(--color-fg-dim)]"
        title="equilibrium (−rake)"
      >
        {eqNetDollars != null ? fmtSignedMoney(eqNetDollars) : ""}
      </span>
      <span className={`text-right font-mono tabular-nums ${netClass}`}>
        {fmtSignedMoney(netDollars)}
      </span>
    </div>
  );
}

function fmtSignedMoney(v: number): string {
  if (!Number.isFinite(v) || Math.abs(v) < 0.005) return "$0";
  const sign = v < 0 ? "−" : "+";
  const abs = Math.abs(v);
  if (abs < 1000) {
    const hasFraction = Math.abs(abs - Math.round(abs)) > 0.005;
    return `${sign}$${hasFraction ? abs.toFixed(2) : Math.round(abs).toString()}`;
  }
  return `${sign}$${Math.round(abs).toLocaleString()}`;
}

function pct(v: number): string {
  if (!(v > 0)) return "0%";
  if (v >= 0.1) return `${(v * 100).toFixed(0)}%`;
  if (v >= 0.01) return `${(v * 100).toFixed(1)}%`;
  if (v >= 0.0001) return `${(v * 100).toFixed(3)}%`;
  return `${(v * 100).toFixed(4)}%`;
}

function fmtEq(p: number): string {
  if (!(p > 0)) return "—";
  if (p >= 0.1) return `${(p * 100).toFixed(0)}%`;
  if (p >= 0.01) return `${(p * 100).toFixed(1)}%`;
  if (p >= 0.0001) return `${(p * 100).toFixed(3)}%`;
  return `${(p * 100).toFixed(4)}%`;
}

// ---------------------------------------------------------------------------
// Shape controls — fixed-ITM panel with locks, presets, and target/current EW
// gap display. Activates when onRowChange is wired in.
// ---------------------------------------------------------------------------

interface ShapeControlsProps {
  row: TournamentRow;
  stats: RowStats;
  onRowChange: (updates: Partial<TournamentRow>) => void;
}

function ShapeControls({ row, stats, onRowChange }: ShapeControlsProps) {
  const t = useT();
  const active = stats.shellMode;

  const patchBuckets = (patch: Partial<NonNullable<TournamentRow["finishBuckets"]>>) => {
    const merged = { ...(row.finishBuckets ?? {}), ...patch };
    // Drop undefined keys so empty buckets disappear cleanly.
    const cleaned: NonNullable<TournamentRow["finishBuckets"]> = {};
    if (merged.first != null) cleaned.first = merged.first;
    if (merged.top3 != null) cleaned.top3 = merged.top3;
    if (merged.ft != null) cleaned.ft = merged.ft;
    onRowChange({
      finishBuckets: Object.keys(cleaned).length > 0 ? cleaned : undefined,
    });
  };

  const applyPreset = (preset: "auto" | "noskill" | "grinder" | "crusher") => {
    if (preset === "auto") {
      onRowChange({ itmRate: undefined, finishBuckets: undefined });
      return;
    }
    const paidFrac = stats.paidCount / Math.max(1, row.players);
    const next: Partial<TournamentRow> = { finishBuckets: undefined };
    if (preset === "noskill") next.itmRate = paidFrac;
    else if (preset === "grinder") next.itmRate = 0.16;
    else if (preset === "crusher") next.itmRate = 0.18;
    onRowChange(next);
  };

  const moneyFmt = (v: number) => {
    const sign = v < 0 ? "-" : "";
    const abs = Math.abs(v);
    if (abs < 1000) {
      const hasFraction = Math.abs(abs - Math.round(abs)) > 0.005;
      return `${sign}$${hasFraction ? abs.toFixed(2) : Math.round(abs).toString()}`;
    }
    return `${sign}$${Math.round(abs).toLocaleString()}`;
  };
  const pctFmt = (v: number) =>
    `${(v * 100).toFixed(v < 0.001 ? 3 : v < 0.01 ? 2 : v < 0.1 ? 2 : 1)}%`;

  const gap = stats.shellCurrentEv - stats.shellTargetEv;
  const gapPct = stats.shellTargetEv > 0 ? Math.abs(gap) / stats.shellTargetEv : 0;

  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[9px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
          {t("shape.title")}
        </div>
        <select
          value={
            row.itmRate == null
              ? "auto"
              : row.finishBuckets &&
                  (row.finishBuckets.first != null ||
                    row.finishBuckets.top3 != null ||
                    row.finishBuckets.ft != null)
                ? "custom"
                : row.itmRate === 0.16
                  ? "grinder"
                  : row.itmRate === 0.18
                    ? "crusher"
                    : "custom"
          }
          onChange={(e) => applyPreset(e.target.value as "auto" | "noskill" | "grinder" | "crusher")}
          className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-1.5 py-0.5 text-[10px] text-[color:var(--color-fg)] outline-none focus:border-[color:var(--color-accent)]"
        >
          <option value="auto">{t("shape.presetAuto")}</option>
          <option value="noskill">{t("shape.presetNoSkill")}</option>
          <option value="grinder">{t("shape.presetGrinder")}</option>
          <option value="crusher">{t("shape.presetCrusher")}</option>
          <option value="custom">{t("shape.presetCustom")}</option>
        </select>
      </div>

      {/* ITM rate input */}
      <label className="flex items-center justify-between gap-2 text-[11px] text-[color:var(--color-fg)]">
        <span>{t("shape.itmLabel")}</span>
        <input
          type="number"
          min={0}
          max={100}
          step={0.5}
          placeholder={t("shape.autoPlaceholder")}
          value={row.itmRate != null ? +(row.itmRate * 100).toFixed(2) : ""}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onRowChange({ itmRate: undefined, finishBuckets: undefined });
              return;
            }
            const v = Number(raw);
            if (!Number.isFinite(v) || v < 0 || v > 100) return;
            onRowChange({ itmRate: v / 100 });
          }}
          className="w-20 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-1.5 py-0.5 text-center text-[11px] tabular-nums text-[color:var(--color-fg)] outline-none focus:border-[color:var(--color-accent)]"
        />
      </label>

      {active && (
        <>
          {/* Shell locks */}
          <div className="flex flex-col divide-y divide-[color:var(--color-border)]/60">
            {(
              [
                { key: "first", label: t("shape.rowFirst"), current: stats.shellP1, value: row.finishBuckets?.first },
                { key: "top3", label: t("shape.rowTop3"), current: stats.shellTop3, value: row.finishBuckets?.top3 },
                { key: "ft", label: t("shape.rowFt"), current: stats.shellFt, value: row.finishBuckets?.ft },
              ] as const
            ).map((bucket) => {
              const locked = bucket.value != null;
              return (
                <div
                  key={bucket.key}
                  className="flex items-center justify-between gap-2 py-1 text-[11px]"
                >
                  <span className="min-w-[56px] text-[color:var(--color-fg)]">
                    {bucket.label}
                  </span>
                  <span className="flex-1 text-right font-mono tabular-nums text-[color:var(--color-fg-dim)]">
                    {pctFmt(bucket.current)}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    placeholder={t("shape.autoPlaceholder")}
                    value={locked ? +((bucket.value as number) * 100).toFixed(3) : ""}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === "") {
                        patchBuckets({ [bucket.key]: undefined } as Record<string, undefined>);
                        return;
                      }
                      const v = Number(raw);
                      if (!Number.isFinite(v) || v < 0 || v > 100) return;
                      patchBuckets({
                        [bucket.key]: v / 100,
                      } as Record<string, number>);
                    }}
                    className="w-16 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-1.5 py-0.5 text-center font-mono text-[11px] tabular-nums text-[color:var(--color-fg)] outline-none focus:border-[color:var(--color-accent)]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (locked) {
                        patchBuckets({ [bucket.key]: undefined } as Record<string, undefined>);
                      } else {
                        patchBuckets({ [bucket.key]: bucket.current } as Record<string, number>);
                      }
                    }}
                    className="w-12 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-1 py-0.5 text-[9px] uppercase tracking-wider text-[color:var(--color-fg-dim)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-fg)]"
                  >
                    {locked ? t("shape.unlock") : t("shape.lock")}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Target vs current + Auto-fit */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[color:var(--color-border)] pt-2 text-[10px]">
            <div className="flex flex-col gap-0.5">
              <div className="text-[color:var(--color-fg-dim)]">
                {t("shape.target")}{" "}
                <span className="font-mono tabular-nums text-[color:var(--color-fg)]">
                  {moneyFmt(stats.shellTargetEv)}
                </span>
              </div>
              <div className="text-[color:var(--color-fg-dim)]">
                {t("shape.current")}{" "}
                <span className="font-mono tabular-nums text-[color:var(--color-fg)]">
                  {moneyFmt(stats.shellCurrentEv)}
                </span>
                {!stats.shellFeasible && (
                  <span
                    className="ml-1 font-mono tabular-nums text-[color:var(--color-danger)]"
                    title={t("shape.infeasibleHint")}
                  >
                    ({gap >= 0 ? "+" : ""}
                    {moneyFmt(gap)}, {(gapPct * 100).toFixed(1)}%)
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onRowChange({ finishBuckets: undefined })}
              className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
            >
              {t("shape.autoFit")}
            </button>
          </div>
          {!stats.shellFeasible && (
            <div className="rounded-md border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/5 px-2 py-1 text-[10px] leading-snug text-[color:var(--color-danger)]">
              {t("shape.infeasible")}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PreviewSplitStat({
  label,
  value,
  color,
  title,
}: {
  label: string;
  value: string;
  color: string;
  title?: string;
}) {
  return (
    <div
      className="rounded-md border border-[color:var(--color-border)]/60 bg-[color:var(--color-bg)]/55 px-2.5 py-2 text-[10px] text-[color:var(--color-fg-dim)] shadow-sm"
      title={title}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block h-1.5 w-1.5 rounded-sm"
          style={{ background: color }}
        />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 font-mono text-[12px] font-semibold tabular-nums text-[color:var(--color-fg)]">
        {value}
      </div>
    </div>
  );
}

const MIN_BOUNTY_BIAS = -0.25;
const MAX_BOUNTY_BIAS = 0.25;
const BOUNTY_BIAS_STEP = 0.0125;
const BOUNTY_SHARE_STEP = 0.001;

function clampUnit(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function clampBountyBias(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(MIN_BOUNTY_BIAS, Math.min(MAX_BOUNTY_BIAS, v));
}

function bountyShareFromBias(
  defaultShare: number,
  minShare: number,
  maxShare: number,
  bias: number,
): number {
  const anchor = clampUnit(defaultShare);
  const low = clampUnit(minShare);
  const high = clampUnit(maxShare);
  const clamped = clampBountyBias(bias);
  return clampUnit(
    clamped >= 0
      ? anchor + (low - anchor) * (clamped / MAX_BOUNTY_BIAS)
      : anchor + (high - anchor) * (-clamped / -MIN_BOUNTY_BIAS),
  );
}

function biasFromBountyShare(
  targetShare: number,
  defaultShare: number,
  minShare: number,
  maxShare: number,
): number {
  const share = clampUnit(targetShare);
  const anchor = clampUnit(defaultShare);
  if (Math.abs(share - anchor) < 1e-9) return 0;
  if (share < anchor) {
    const span = anchor - clampUnit(minShare);
    if (span <= 1e-9) return 0;
    return clampBountyBias((anchor - share) / span * MAX_BOUNTY_BIAS);
  }
  const span = clampUnit(maxShare) - anchor;
  if (span <= 1e-9) return 0;
  return clampBountyBias(
    -((share - anchor) / span) * -MIN_BOUNTY_BIAS,
  );
}

function snapBountyBias(v: number): number {
  const snapped = Math.round(clampBountyBias(v) / BOUNTY_BIAS_STEP) * BOUNTY_BIAS_STEP;
  return clampBountyBias(Number(snapped.toFixed(4)));
}

function BountyShareSlider({
  committedBias,
  committedShare,
  defaultShare,
  minShare,
  maxShare,
  onCommit,
  title,
  cashLabel,
  bountyLabel,
  tip,
  resetLabel,
}: {
  committedBias: number;
  committedShare: number;
  defaultShare: number;
  minShare: number;
  maxShare: number;
  onCommit: (v: number) => void;
  title: string;
  cashLabel: string;
  bountyLabel: string;
  tip: string;
  resetLabel: string;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  // Derived: once committedBias has caught up to the dragged value, the
  // draft is "stale" and we ignore it. This keeps the thumb visually
  // locked at the released position through the computeRowStats hang
  // (otherwise it would snap back to old committedBias for one paint
  // while waiting for row → stats → re-render to propagate).
  const effectiveDraft =
    draft !== null && Math.abs(committedShare - draft) < 1e-6 ? null : draft;
  const lo = Math.min(minShare, maxShare);
  const hi = Math.max(minShare, maxShare);
  const value = Math.max(lo, Math.min(hi, effectiveDraft ?? committedShare));
  // Pending = dragged value hasn't been reflected by committedBias yet.
  // Used to show an indeterminate progress pulse while computeRowStats
  // re-runs on the main thread (drag → commit → parent recalc → prop update).
  const pending = effectiveDraft !== null;
  const defaultMarkerPct =
    hi - lo > 1e-9 ? ((defaultShare - lo) / (hi - lo)) * 100 : 50;
  const bountyPct = clampUnit(value) * 100;
  const cashPct = 100 - bountyPct;
  const commit = (rawShare: number) => {
    const nextShare = Math.max(lo, Math.min(hi, rawShare));
    const nextBias = snapBountyBias(
      biasFromBountyShare(nextShare, defaultShare, minShare, maxShare),
    );
    const snappedShare = bountyShareFromBias(
      defaultShare,
      minShare,
      maxShare,
      nextBias,
    );
    if (Math.abs(nextBias - committedBias) < 1e-9) {
      setDraft(null);
      return;
    }
    setDraft(snappedShare);
    onCommit(nextBias);
  };

  return (
    <div
      className="mt-3 border-t border-[color:var(--color-border)]/60 pt-2"
      title={tip}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--color-fg)]">
          {title}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="rounded px-1 py-0.5 text-[11px] font-mono tabular-nums text-[color:var(--color-fg)]">
            {pct(value)}
          </span>
          <button
            type="button"
            onClick={() => {
              setDraft(null);
              if (Math.abs(committedBias) > 1e-9) onCommit(0);
            }}
            disabled={Math.abs(committedBias) < 1e-9}
            className="rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)] transition hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-fg)] disabled:cursor-default disabled:opacity-40 disabled:hover:border-[color:var(--color-border)] disabled:hover:text-[color:var(--color-fg-dim)]"
          >
            {resetLabel}
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="relative">
          <input
            type="range"
            min={lo}
            max={hi}
            step={BOUNTY_SHARE_STEP}
            value={value}
            onChange={(e) => setDraft(Number(e.target.value))}
            onPointerUp={(e) => commit(Number(e.currentTarget.value))}
            onKeyUp={(e) => commit(Number(e.currentTarget.value))}
            onBlur={(e) => commit(Number(e.currentTarget.value))}
            className="relative z-10 block h-1 w-full cursor-pointer accent-[color:var(--color-accent)]"
            aria-label={title}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2 bg-[color:var(--color-border-strong)]"
            style={{ left: `${Math.max(0, Math.min(100, defaultMarkerPct))}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
          <span>{pct(lo)}</span>
          <span>{pct(hi)}</span>
        </div>
      </div>
      <div
        aria-hidden
        className="mt-1.5 relative h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--color-bg-elev-2)]"
      >
        <div
          className="absolute inset-y-0 left-0 bg-[color:var(--color-bg-elev)]/90"
          style={{ width: `${cashPct}%` }}
        />
        <div
          className="absolute inset-y-0 right-0 bg-[color:var(--color-accent)]/85"
          style={{ width: `${bountyPct}%` }}
        />
        <div
          className={
            pending
              ? "absolute inset-y-0 w-1/3 animate-[biasBar_900ms_linear_infinite] rounded-full bg-white/35"
              : "h-full w-0"
          }
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] font-medium text-[color:var(--color-fg-dim)]">
        <span>
          {cashLabel} {pct(1 - value)}
        </span>
        <span>
          {bountyLabel} {pct(value)}
        </span>
      </div>
    </div>
  );
}

interface RowStats {
  alpha: number;
  cost: number;
  itm: number;
  evPerEntry: number;
  payoutStd: number;
  cv: number;
  /** Gross cash-pool EV per entry — sum over places of pmf·prizeByPlace.
   *  For freezeouts this equals evPerEntry; for bounty formats it's the
   *  finish-only portion. */
  cashEvPerEntry: number;
  /** Gross bounty EV per entry — sum over places of pmf·bountyByPlace. */
  bountyEvPerEntry: number;
  /** Portion of bountyEvPerEntry coming from per-KO draws with ratio ≥
   *  JACKPOT_THRESHOLD × mean. Zero for PKO/freezeouts and tiny for mystery
   *  with σ²<1. Only meaningful on mystery / mystery-royale where the envelope
   *  distribution has a real jackpot tier. */
  jackpotBountyEvPerEntry: number;
  /** Ratio threshold (multiples of mean bounty) used to classify "jackpot"
   *  draws — same value for all rows so users compare apples to apples. */
  jackpotThreshold: number;
  bountyShare: number;
  progressivePko: boolean;
  topPlaces: number;
  /**
   * Adaptive EV/field breakdown. For small fields (N < 300) stays on the
   * original 5-tier layout; for high-field MTTs fans out to include
   * Top 0.1% / Top 0.5% / Top 5% / Final table so the concentration of EV
   * in the very top finishes is actually visible.
   */
  tiers: TierRow[];
  /** Smallest k such that top-k places cover ≥50% of expected payout. */
  halfMassK: number;
  /** Combined field share of those top-k places (= 1/odds). */
  halfMassField: number;
  /** Field share of the final table (top min(9, paidCount) places). */
  ftField: number;
  /** EV share of the final table. */
  ftEvShare: number;
  /** Fixed-ITM solver feedback — null when that mode is not active. */
  shellMode: boolean;
  shellFeasible: boolean;
  shellTargetEv: number;
  shellCurrentEv: number;
  shellP1: number;
  shellTop3: number;
  shellFt: number;
  /** Equilibrium probability of busting exactly at the bubble (first OOTM place). */
  shellBubble: number;
  /** Equilibrium probability of the last paid place — first mincash after the bubble. */
  shellFirstCash: number;
  /** Discrete position rows (top 1, top 3, final table, first cash, bubble)
   *  appended to the evBreakdown table. Each already carries EV share +
   *  field/equilibrium probability — rendered with the same row shape as
   *  tier rows but with an added rightmost equilibrium % column. */
  positions: PositionRow[];
  /** Number of paid places (= payouts that are > 0). */
  paidCount: number;
}

interface PositionRow {
  key: string;
  labelKey: DictKey;
  color: string;
  /** Fraction of total EV contributed by this slice. */
  ev: number;
  /** Skill-calibrated share of finishes in this slice. */
  field: number;
  /** Equilibrium share of this slice (width / N). */
  eqShare: number;
  /** Net dollar contribution: Σ ev$ − field × entryCost. Not summed into the
   *  footer (position rows overlap with tiers and each other). */
  netDollars: number;
  /** Per-tier place range (1-indexed, inclusive). Drives the tiny label suffix. */
  posLo: number;
  posHi: number;
}

/** Minimum ratio (× mean bounty) that counts a per-KO draw as a "jackpot"
 *  for the microscope widget split. Chosen so only the deep tail counts —
 *  at 100× buy-in it captures the top 1-3 GG BR tiers (e.g. 10000×/1000×/100×
 *  at the $1 profile) and gives essentially 0 for PKO/thin log-normal. */
const JACKPOT_THRESHOLD = 100;

/** Abramowitz & Stegun 7.1.26 approximation of the standard normal CDF
 *  Φ(x). Max error ≈ 1.5e-7 — more than enough for a UI readout. */
function stdNormalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-a * a);
  const erf = sign * y;
  return 0.5 * (1 + erf);
}

/**
 * Full per-entry EV decomposition for one row: prize + bounty, place by place,
 * then bucketed into tiers. Mirrors the bounty math used in the engine so the
 * preview matches what the simulator will actually sample.
 */
function computeRowStats(row: TournamentRow, model: FinishModelConfig): RowStats {
  const N = Math.max(2, Math.floor(row.players));
  const payouts = getPayoutTable(row.payoutStructure, N, row.customPayouts);
  const basePool = row.players * row.buyIn;
  const entryCost = row.buyIn * (1 + row.rake);
  const brSampler =
    row.payoutStructure === "battle-royale"
      ? makeBrTierSampler(row.buyIn)
      : null;

  const bountyFraction = Math.max(0, Math.min(0.9, row.bountyFraction ?? 0));
  const bountyPerSeat = row.buyIn * bountyFraction;
  const bountyLift = Math.max(0.1, Math.min(3, (1 + row.rake) * (1 + row.roi)));
  const defaultBountyMean = bountyPerSeat * bountyLift;
  // Mirror engine.ts compileSingleEntry: user-tunable EV-bias shifts the
  // split between cash and bounty channels while keeping total ROI intact.
  const bias = Math.max(-0.25, Math.min(0.25, row.bountyEvBias ?? 0));
  const totalWinningsEV = entryCost * (1 + row.roi);
  let bountyMean =
    bountyFraction > 0
      ? applyBountyBias(defaultBountyMean, totalWinningsEV, bias)
      : 0;
  const prizePool = basePool * (1 - bountyFraction);

  const targetRegular = Math.max(0.01, entryCost * (1 + row.roi) - bountyMean);
  const effectiveROI = targetRegular / entryCost - 1;
  const paidCount = payouts.reduce((n, p) => (p > 0 ? n + 1 : n), 0);
  let alpha: number;
  let pmf: Float64Array;
  let feasible = true;
  let currentWinningsFromSolver: number | null = null;
  if (row.itmRate != null && row.itmRate > 0) {
    const fi = calibrateShelledItm(
      N,
      paidCount,
      payouts,
      prizePool,
      targetRegular,
      row.itmRate,
      row.finishBuckets,
      model,
    );
    alpha = fi.alpha;
    pmf = fi.pmf;
    feasible = fi.feasible;
    currentWinningsFromSolver = fi.currentWinnings;
  } else {
    alpha = calibrateAlpha(
      N,
      payouts,
      prizePool,
      entryCost,
      effectiveROI,
      model,
    );
    pmf = buildFinishPMF(N, model, alpha);
  }

  const prizeByPlace = new Float64Array(N);
  for (let i = 0; i < Math.min(payouts.length, N); i++) {
    prizeByPlace[i] = payouts[i] * prizePool;
  }

  if (
    bountyFraction > 0 &&
    ((row.itmRate != null && row.itmRate > 0) || !isAlphaAdjustable(model))
  ) {
    let cashEVActual = 0;
    for (let i = 0; i < N; i++) cashEVActual += pmf[i] * prizeByPlace[i];
    bountyMean = Math.max(0, totalWinningsEV - cashEVActual);
  }

  const bountyByPlace = new Float64Array(N);
  // bountyBustsAtPos[i] = expected # of bounty-paying busts by finisher at
  // place i+1. For PKO every bust pays cash, so this equals the full
  // harmonic H(N−1)−H(p−1). For mystery / mystery-royale only busts whose
  // victim finishes inside the bounty window (ITM bubble, or top-9 FT for
  // BR) drop an envelope, so the harmonic is restricted to that window.
  // Tier metrics use this as the denominator of "avg bounty per head".
  const bountyBustsAtPos = new Float64Array(N);
  if (bountyMean > 0 && N >= 2) {
    const raw = new Float64Array(N);
    const isMystery =
      row.gameType === "mystery" ||
      row.gameType === "mystery-royale" ||
      brSampler !== null;

    if (isMystery) {
      const ft =
        row.gameType === "mystery-royale" || brSampler !== null
          ? Math.min(9, N)
          : paidCount;
      const mLo = Math.max(1, N - ft + 1);
      for (let i = 0; i < N; i++) {
        const p = i + 1;
        const mHi = N - p;
        if (mHi < mLo) {
          raw[i] = 0;
          bountyBustsAtPos[i] = 0;
        } else {
          let acc = 0;
          for (let m = mLo; m <= mHi; m++) acc += 1 / (N - m);
          raw[i] = acc;
          bountyBustsAtPos[i] = acc;
        }
      }
    } else {
      const Hprefix = new Float64Array(N);
      let hAcc = 0;
      for (let k = 1; k < N; k++) {
        hAcc += 1 / k;
        Hprefix[k] = hAcc;
      }
      const totalH = Hprefix[N - 1];
      for (let i = 0; i < N; i++) {
        bountyBustsAtPos[i] = totalH - Hprefix[i];
      }

      const cashAtBust = new Float64Array(N - 1);
      let T = N;
      for (let m = 1; m <= N - 1; m++) {
        const h = T / (N - m + 1);
        const cash = h / 2;
        cashAtBust[m - 1] = cash;
        T -= cash;
      }
      const Tfinal = T;
      const prefix = new Float64Array(N);
      let acc = 0;
      for (let m = 1; m <= N - 1; m++) {
        acc += cashAtBust[m - 1] / (N - m);
        prefix[m] = acc;
      }
      for (let i = 0; i < N; i++) {
        const p = i + 1;
        const upto = N - p;
        raw[i] = upto > 0 ? prefix[upto] : 0;
      }
      raw[0] += Tfinal;
    }

    let Z = 0;
    for (let i = 0; i < N; i++) Z += pmf[i] * raw[i];
    if (brSampler !== null && Z > 1e-12 && brSampler.meanValue > 1e-12) {
      const kScale = bountyMean / (brSampler.meanValue * Z);
      for (let i = 0; i < N; i++) {
        bountyBustsAtPos[i] *= kScale;
        bountyByPlace[i] = bountyBustsAtPos[i] * brSampler.meanValue;
      }
    } else if (Z > 1e-12) {
      const scale = bountyMean / Z;
      for (let i = 0; i < N; i++) bountyByPlace[i] = raw[i] * scale;
    }
  }

  const totalByPlace = new Float64Array(N);
  let totalEv = 0;
  let totalEv2 = 0;
  let cashEv = 0;
  let bountyEv = 0;
  for (let i = 0; i < N; i++) {
    totalByPlace[i] = prizeByPlace[i] + bountyByPlace[i];
    totalEv += pmf[i] * totalByPlace[i];
    totalEv2 += pmf[i] * totalByPlace[i] * totalByPlace[i];
    cashEv += pmf[i] * prizeByPlace[i];
    bountyEv += pmf[i] * bountyByPlace[i];
  }
  // Jackpot share of bounty EV — fraction of bountyEv that comes from
  // per-KO draws with ratio ≥ JACKPOT_THRESHOLD × mean. Derived from the
  // envelope distribution, independent of place (every KO is an iid draw).
  // BR reads the discrete 10-tier GG table; mystery uses log-normal with
  // E[Y]=1 → E[Y·1{Y>R}] = Φ((σ²/2 − ln R)/σ). PKO/freezeouts: thin tail, 0.
  let jackpotShareFrac = 0;
  if (bountyEv > 0) {
    if (brSampler !== null) {
      for (let i = 0; i < brSampler.ratios.length; i++) {
        if (brSampler.ratios[i] >= JACKPOT_THRESHOLD) {
          jackpotShareFrac += brSampler.probs[i] * brSampler.ratios[i];
        }
      }
    } else if ((row.mysteryBountyVariance ?? 0) > 0) {
      const sigma2 = row.mysteryBountyVariance!;
      const sigma = Math.sqrt(sigma2);
      const d = (sigma2 / 2 - Math.log(JACKPOT_THRESHOLD)) / sigma;
      jackpotShareFrac = stdNormalCdf(d);
    }
  }
  const jackpotBountyEv = bountyEv * jackpotShareFrac;
  const payoutVar = Math.max(0, totalEv2 - totalEv * totalEv);
  const payoutStd = Math.sqrt(payoutVar);
  const cv = totalEv > 1e-9 ? payoutStd / totalEv : 0;

  let itm = 0;
  for (let i = 0; i < paidCount; i++) itm += pmf[i];

  // Per-place arrays used for both tier binning and the half-mass fact.
  const evByPlace = new Float64Array(N);
  for (let i = 0; i < N; i++) evByPlace[i] = pmf[i] * totalByPlace[i];

  // Half-mass: smallest k such that top-k places cover ≥50% of total EV.
  // Computed over *paid* places (OOTM adds no EV) and bounded by paidCount.
  let cumEv = 0;
  let halfMassK = 0;
  const halfTarget = totalEv * 0.5;
  for (let i = 0; i < paidCount && halfMassK === 0; i++) {
    cumEv += evByPlace[i];
    if (cumEv >= halfTarget) halfMassK = i + 1;
  }
  if (halfMassK === 0) halfMassK = paidCount;
  let halfMassField = 0;
  for (let i = 0; i < halfMassK; i++) halfMassField += pmf[i];

  // Final-table stats (top 9 by tournament convention, or fewer if paidCount < 9).
  const ftEnd = Math.min(9, paidCount);
  let ftField = 0;
  let ftEvSum = 0;
  for (let i = 0; i < ftEnd; i++) {
    ftField += pmf[i];
    ftEvSum += evByPlace[i];
  }
  const ftEvShare = totalEv > 1e-9 ? ftEvSum / totalEv : 0;

  // Adaptive tier layout. Each tier is a half-open place range [lo, hi]
  // (1-indexed). We build the cut list first, then slice per tier — this
  // avoids the N≥300 branch having a different accumulator shape from the
  // small-field case. Cuts that collapse (e.g., ceil(500*0.001)==1) get
  // filtered out to avoid zero-width tiers.
  interface TierCut {
    key: TierKey;
    labelKey: TierLabelKey;
    color: string;
    hi: number;
  }
  const cuts: TierCut[] = [];
  cuts.push({ key: "winner", labelKey: "preview.tierWinner", color: "#ffde51", hi: 1 });
  // Fixed tier ladder: 1 / 2–3 / 4–9 / 10–27 (only for 100+ fields) / rest ITM.
  // Zero-width cuts are dropped downstream by the monotonic enforcement.
  cuts.push({
    key: "top3",
    labelKey: "preview.tierTop3",
    color: "#fb923c",
    hi: Math.min(3, paidCount),
  });
  cuts.push({
    key: "ft",
    labelKey: "preview.tierFt",
    color: "#a855f7",
    hi: Math.min(ftEnd, paidCount),
  });
  if (N >= 100) {
    cuts.push({
      key: "top27",
      labelKey: "preview.tierTop27",
      color: "#c026d3",
      hi: Math.min(27, paidCount),
    });
  }
  // 5%–ITM: everything from the last cumulative cut above down to the
  // ITM edge, merged into one bar. Replaces the old top-10% + restItM
  // pair so the user sees one clean range instead of two.
  if (paidCount >= 2) {
    cuts.push({
      key: "restItm",
      labelKey: "preview.tierRestItm",
      color: "#a855f7",
      hi: paidCount - 1,
    });
    cuts.push({
      key: "firstMincash",
      labelKey: "preview.probFirstCash",
      color: "#94a3b8",
      hi: paidCount,
    });
  }
  if (paidCount < N) {
    cuts.push({
      key: "bubble",
      labelKey: "preview.probBubble",
      color: "#475569",
      hi: paidCount + 1,
    });
  }
  cuts.push({
    key: "ootm",
    labelKey: "preview.tierOotm",
    color: "#1f2937",
    hi: N,
  });

  // Enforce monotonic, non-overlapping cuts — each tier starts where the
  // previous one ended, so ceil() rounding collapsing a tier into 0 width
  // just drops it cleanly.

  const tiers: TierRow[] = [];
  let prevHi = 0;
  for (const c of cuts) {
    const hi = Math.min(N, Math.max(prevHi, c.hi));
    if (hi <= prevHi) continue;
    let evTier = 0;
    let cashTier = 0;
    let bountyTier = 0;
    let fTier = 0;
    let totalTierSum = 0;
    let bustsWeighted = 0;
    for (let i = prevHi; i < hi; i++) {
      evTier += evByPlace[i];
      cashTier += pmf[i] * prizeByPlace[i];
      bountyTier += pmf[i] * bountyByPlace[i];
      fTier += pmf[i];
      totalTierSum += totalByPlace[i];
      bustsWeighted += pmf[i] * bountyBustsAtPos[i];
    }
    const width = hi - prevHi;
    const eqShareTier = N > 0 ? width / N : 0;
    const evEqTier = N > 0 ? totalTierSum / N : 0;
    const cashGivenFinish = fTier > 1e-12 ? cashTier / fTier : 0;
    const bountyGivenFinish = fTier > 1e-12 ? bountyTier / fTier : 0;
    const bustsGivenFinish = fTier > 1e-12 ? bustsWeighted / fTier : 0;
    const bountySizePerBust =
      bustsGivenFinish > 1e-9 ? bountyGivenFinish / bustsGivenFinish : 0;
    tiers.push({
      key: c.key,
      labelKey: c.labelKey,
      color: c.color,
      ev: evTier,
      cashEv: cashTier,
      bountyEv: bountyTier,
      cashGivenFinish,
      bountyGivenFinish,
      bustsGivenFinish,
      bountySizePerBust,
      field: fTier,
      eqShare: eqShareTier,
      netDollars: evTier - fTier * entryCost,
      eqNetDollars: evEqTier - eqShareTier * entryCost,
      displaySeats: width,
      posLo: prevHi + 1,
      posHi: hi,
    });
    prevHi = hi;
  }

  const bountyShareOfPayout =
    totalEv > 1e-9
      ? (() => {
          let bEv = 0;
          for (let i = 0; i < N; i++) bEv += pmf[i] * bountyByPlace[i];
          return bEv / totalEv;
        })()
      : 0;

  // Shell panel stats — probabilities from the final PMF, directly readable.
  const ftEndShell = Math.min(9, paidCount);
  const shellP1 = pmf[0] ?? 0;
  let shellTop3Sum = 0;
  for (let i = 0; i < Math.min(3, paidCount); i++) shellTop3Sum += pmf[i];
  let shellFtSum = 0;
  for (let i = 0; i < ftEndShell; i++) shellFtSum += pmf[i];
  const shellBubble = paidCount < N ? (pmf[paidCount] ?? 0) : 0;
  const shellFirstCash = paidCount > 0 ? (pmf[paidCount - 1] ?? 0) : 0;

  const positions: PositionRow[] = [];

  return {
    alpha,
    cost: entryCost,
    itm,
    evPerEntry: totalEv,
    payoutStd,
    cv,
    cashEvPerEntry: cashEv,
    bountyEvPerEntry: bountyEv,
    jackpotBountyEvPerEntry: jackpotBountyEv,
    jackpotThreshold: JACKPOT_THRESHOLD,
    bountyShare: bountyShareOfPayout,
    progressivePko: bountyFraction > 0,
    topPlaces: Math.max(1, Math.ceil(N * 0.01)),
    tiers,
    halfMassK,
    halfMassField,
    ftField,
    ftEvShare,
    shellMode: row.itmRate != null && row.itmRate > 0,
    shellFeasible: feasible,
    shellTargetEv: targetRegular,
    shellCurrentEv:
      currentWinningsFromSolver != null ? currentWinningsFromSolver : totalEv - bountyShareOfPayout * totalEv,
    shellP1,
    shellTop3: shellTop3Sum,
    shellFt: shellFtSum,
    shellBubble,
    shellFirstCash,
    positions,
    paidCount,
  };
}
