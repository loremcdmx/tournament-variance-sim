"use client";

import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  clampItmTopHeavyBias,
  finishModelSupportsItmTopHeavy,
  ITM_TOP_HEAVY_BIAS_STEP,
  MAX_ITM_TOP_HEAVY_BIAS,
  MIN_ITM_TOP_HEAVY_BIAS,
} from "@/lib/sim/itmTopHeavy";
import { equilibriumItmRateForRow } from "@/lib/sim/itmTarget";
import { isBattleRoyaleRow } from "@/lib/sim/bountySplit";
import {
  computeRowStats,
  type RowStats,
} from "@/lib/sim/previewRowStats";
import {
  normalizeGameTypeConsistency,
  rowHasActiveBounty,
} from "@/lib/sim/gameType";
import type { FinishModelConfig, TournamentRow } from "@/lib/sim/types";
import { useLocale, useT } from "@/lib/i18n/LocaleProvider";
import { numberLocaleTag } from "@/lib/i18n/numberLocale";
import { getTournamentRowDisplayLabel } from "@/lib/ui/tournamentRowLabel";
import { fmt } from "@/lib/results/formatters";

import { useAdvancedMode } from "@/lib/ui/AdvancedModeProvider";
import { isRepeatSubmission, settleCommitted, submitBias } from "./finishPreview/biasDraft";
import { isTop3LockAvailable, patchFinishLocks } from "./finishPreview/shapeLocks";
import { tierLabel, tierPlacesLabel } from "./finishPreview/tierPlaces";
import { zeroSkillEvShares } from "./finishPreview/zeroSkillEv";
import {
  EvBreakdownFooter,
  EvBreakdownRow,
  EV_BREAKDOWN_GAP,
  EV_BREAKDOWN_GRID,
  EV_BREAKDOWN_NUM,
  evPct,
  evPctInputPlaces,
  evPctInputValue,
  fmtSignedPct,
  PREVIEW_SLIDER_RESET_CHROME,
  PREVIEW_SLIDER_VALUE_CHROME,
  PREVIEW_SLIDER_VALUE_INPUT,
  PREVIEW_SLIDER_VALUE_SUFFIX,
  PreviewHeroStat,
  PreviewSplitStat,
} from "./finishPreview/PreviewParts";

interface Props {
  row: TournamentRow;
  model: FinishModelConfig;
  rakebackPct?: number;
  leaderboardPromoPerEntry?: number;
  /** If provided, the fixed-ITM shape controls panel is shown below the
   *  tier breakdown and can edit row.itmRate / row.finishBuckets. */
  onRowChange?: (updates: Partial<TournamentRow>) => void;
  /** When true, the global ITM cascade is driving row.itmRate — hide
   *  / disable the shape editor so the user knows tweaks would be
   *  overridden on the next render. */
  itmLocked?: boolean;
  /** Under the "Like PrimeDope" preset the PrimeDope pass plays its own table
   *  and finishes; this card still shows the app's model, and says so. */
  primeDopePreset?: boolean;
}

const MONEY_DISPLAY_EPS = 0.005;

export const FinishPMFPreview = memo(function FinishPMFPreview({
  row,
  model,
  rakebackPct = 0,
  leaderboardPromoPerEntry = 0,
  onRowChange,
  itmLocked,
  primeDopePreset = false,
}: Props) {
  const t = useT();
  const { locale } = useLocale();
  const numberLocale = numberLocaleTag(locale);
  const { advanced } = useAdvancedMode();
  const effectiveRow = useMemo(() => normalizeGameTypeConsistency(row), [row]);

  const committedBias = clampBountyBias(effectiveRow.bountyEvBias ?? 0);
  const committedItmTopHeavyBias = clampItmTopHeavyBias(
    effectiveRow.itmTopHeavyBias ?? 0,
  );
  const stats = useMemo(
    () => computeRowStats(effectiveRow, model),
    [effectiveRow, model],
  );
  const rbFrac = Math.max(0, rakebackPct) / 100;
  const directRakebackPerEntry =
    rbFrac * effectiveRow.rake * effectiveRow.buyIn;
  const safeLeaderboardPromoPerEntry = Math.max(0, leaderboardPromoPerEntry);
  const totalEvPerEntry =
    stats.evPerEntry + directRakebackPerEntry + safeLeaderboardPromoPerEntry;
  const hasActiveBounty = rowHasActiveBounty(effectiveRow);
  const hasVisibleBountyEv =
    hasActiveBounty && stats.bountyEvPerEntry > MONEY_DISPLAY_EPS;
  const committedBountyShare = clampUnit(stats.bountyShare);
  // The probes and the realised-share table set the bias themselves, so they
  // read the engine's whole row with the bias taken out, and a new bias alone
  // keeps them: the table survives the commit of a drag or a typed share.
  const [heldShareRow, setShareRow] = useState(() => withoutBountyBias(effectiveRow));
  let shareRow = heldShareRow;
  if (!sameRowApartFromBias(heldShareRow, effectiveRow)) {
    shareRow = withoutBountyBias(effectiveRow);
    setShareRow(shareRow);
  }
  const realised = useMemo(
    () => realisedBountyShare(shareRow, model),
    [shareRow, model],
  );
  const { defaultBountyShare, minBountyShare, maxBountyShare, poolCapsTop } = useMemo(() => {
    if (!((shareRow.bountyFraction ?? 0) > 0)) {
      return {
        defaultBountyShare: 0,
        minBountyShare: 0,
        maxBountyShare: 0,
        poolCapsTop: false,
      };
    }
    return {
      defaultBountyShare: realised.at(0),
      minBountyShare: realised.at(MAX_BOUNTY_BIAS),
      maxBountyShare: realised.at(MIN_BOUNTY_BIAS),
      poolCapsTop: realised.atPoolCeiling(MIN_BOUNTY_BIAS),
    };
  }, [shareRow, realised]);

  const evTotal = totalEvPerEntry || 1;

  const moneyFmt = (v: number) => {
    if (!(Math.abs(v) >= MONEY_DISPLAY_EPS)) return "$0";
    const sign = v < 0 ? "-" : "";
    const abs = Math.abs(v);
    if (abs < 1000) {
      const hasFraction = Math.abs(abs - Math.round(abs)) > 0.005;
      return `${sign}$${hasFraction ? abs.toFixed(2) : Math.round(abs).toString()}`;
    }
    return `${sign}$${Math.round(abs).toLocaleString(numberLocale)}`;
  };

  const netProfitPerEntry = totalEvPerEntry - stats.cost;
  const roiPerEntry = stats.cost > 1e-9 ? netProfitPerEntry / stats.cost : 0;
  // The ROI chip's rounded figure decides the sign and colour of both chips, so
  // a sub-$1 ticket cannot print opposite signs side by side and a net that
  // rounds to 0.0% is neutral; a sub-cent net keeps one significant digit.
  // A neutral net on a big ticket can still be dollars, so it keeps its minus.
  const quickRoi = fmtSignedPct(roiPerEntry);
  const netSign = quickRoi === fmtSignedPct(0) ? 0 : Math.sign(netProfitPerEntry);
  const netAbs = Math.abs(netProfitPerEntry);
  const netText = netSign === 0
    ? moneyFmt(netProfitPerEntry)
    : (netSign > 0 ? "+" : "-") +
      (netAbs >= MONEY_DISPLAY_EPS ? moneyFmt(netAbs) : `$${netAbs.toPrecision(1)}`);
  const netTextClass =
    netSign > 0
      ? "text-[color:var(--color-accent)]"
      : netSign < 0
        ? "text-[color:var(--color-danger)]"
        : "text-[color:var(--color-fg-dim)]";
  const rowTitle = getTournamentRowDisplayLabel(effectiveRow, t);
  const bountyTag = effectiveRow.gameType === "ocean-ko"
    ? t("row.gameType.oceanKo")
    : stats.progressivePko
    ? t("preview.statBountyPko")
    : stats.bountyShare > 0
      ? t("preview.statBountyFlat")
      : "";

  return (
    <div className="flex flex-col gap-3.5">
      {primeDopePreset && (
        <p className="text-[11px] leading-snug text-[color:var(--color-fg-dim)]">
          {t("preview.primedopeNote")}
        </p>
      )}
      {/* Tournament identity */}
      <div className="text-sm font-semibold text-[color:var(--color-fg)]">
        {rowTitle}
        {bountyTag && (
          <span className="ml-1 font-normal text-[color:var(--color-fg-dim)]">
            · {bountyTag}
          </span>
        )}
      </div>

      {/* Buy-in and expected return */}
      {stats.payoutVarianceBounded && (
        <details className="text-xs text-[color:var(--color-fg-muted)]">
          <summary className="w-fit cursor-pointer rounded py-1 font-semibold text-[color:var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]">
            {t("oceanKo.previewDetails")}
          </summary>
          <div className="mt-1 rounded-md border border-[color:var(--color-border)] px-3 py-2 leading-relaxed">
            <div>{t("oceanKo.sigmaBounds")}: <span className="font-mono tabular-nums">{moneyFmt(stats.payoutStdLower ?? 0)}–{moneyFmt(stats.payoutStd)}</span></div>
            <p className="mt-1">{t("oceanKo.previewNote")}</p>
          </div>
        </details>
      )}
      <div className="group relative overflow-hidden rounded-md border border-[color:var(--color-border-strong)]/70 bg-[linear-gradient(135deg,var(--color-bg)_0%,var(--color-bg-elev)_60%,rgba(255,222,81,0.08)_100%)] p-3.5 shadow-[0_18px_40px_-32px_rgba(0,0,0,0.9)]">
        <div className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-[color:var(--color-accent)]/70 to-transparent" />
        <div className="relative">
          <PreviewHeroStat
            label="EV"
            value={moneyFmt(totalEvPerEntry)}
            accent
            footer={
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <div className="inline-flex max-w-full items-center gap-2 rounded-md border border-[color:var(--color-accent)]/45 bg-[color:var(--color-accent)]/12 px-2.5 py-1.5 shadow-sm">
                  <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-fg)] opacity-70">
                    {t("preview.statRoi")}
                  </span>
                  <span className={`font-mono text-[15px] font-bold leading-none tabular-nums ${netTextClass}`}>
                    {quickRoi}
                  </span>
                </div>
                <div
                  className={`inline-flex max-w-full items-center gap-2 rounded-md border px-2.5 py-1.5 shadow-sm ${
                    netSign >= 0
                      ? "border-[color:var(--color-accent)]/50 bg-[color:var(--color-accent)]/14"
                      : "border-[color:var(--color-danger)]/45 bg-[color:var(--color-danger)]/12"
                  }`}
                >
                  <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-fg)] opacity-70">
                    {t("preview.avgReturn")}
                  </span>
                  <span className={`font-mono text-[15px] font-bold leading-none tabular-nums ${netTextClass}`}>
                    {netText}
                  </span>
                </div>
              </div>
            }
          />
        </div>
        {(hasVisibleBountyEv ||
          directRakebackPerEntry > 1e-6 ||
          safeLeaderboardPromoPerEntry > 1e-6) &&
          (() => {
          const jp = stats.jackpotBountyEvPerEntry;
          const hasJp =
            stats.jackpotEvAvailable !== false &&
            hasVisibleBountyEv &&
            jp > MONEY_DISPLAY_EPS &&
            jp / stats.bountyEvPerEntry > 0.001;
          const regularBounty = stats.bountyEvPerEntry - jp;
          const cashShare =
            totalEvPerEntry > 1e-9 ? stats.cashEvPerEntry / totalEvPerEntry : 0;
          const bountyShare =
            totalEvPerEntry > 1e-9
              ? stats.bountyEvPerEntry / totalEvPerEntry
              : 0;
          const regularBountyShare =
            totalEvPerEntry > 1e-9 ? regularBounty / totalEvPerEntry : 0;
          const jackpotShare =
            totalEvPerEntry > 1e-9 ? jp / totalEvPerEntry : 0;
          const directRbShare =
            totalEvPerEntry > 1e-9
              ? directRakebackPerEntry / totalEvPerEntry
              : 0;
          const promoShare =
            totalEvPerEntry > 1e-9
              ? safeLeaderboardPromoPerEntry / totalEvPerEntry
              : 0;
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
              <div className="mb-2.5 text-[13px] font-semibold tracking-[0.08em] text-[color:var(--color-fg-dim)]">
                {t("preview.evSplit")}
              </div>
              <div className="flex flex-wrap justify-center gap-2.5 sm:gap-3">
                <PreviewSplitStat
                  label={t("preview.evSplit.cash")}
                  value={moneyFmt(stats.cashEvPerEntry)}
                  share={cashShare}
                  color="var(--color-accent)"
                />
                {hasVisibleBountyEv && (
                  <PreviewSplitStat
                    label={
                      hasJp
                        ? t("preview.evSplit.bountyRegular")
                        : t("preview.evSplit.bounty")
                    }
                    value={moneyFmt(hasJp ? regularBounty : stats.bountyEvPerEntry)}
                    share={hasJp ? regularBountyShare : bountyShare}
                    color="hsl(175, 72%, 55%)"
                  />
                )}
                {hasJp && (
                  <PreviewSplitStat
                    label={jpLabel}
                    value={moneyFmt(jp)}
                    share={jackpotShare}
                    color="hsl(45, 95%, 60%)"
                    title={jpTip}
                  />
                )}
                {directRakebackPerEntry > 1e-6 && (
                  <PreviewSplitStat
                    label={t("chart.brLeaderboard.directRb")}
                    value={moneyFmt(directRakebackPerEntry)}
                    share={directRbShare}
                    color="var(--color-club)"
                  />
                )}
                {safeLeaderboardPromoPerEntry > 1e-6 && (
                  <PreviewSplitStat
                    label={t("chart.brLeaderboard.meanPayout")}
                    value={moneyFmt(safeLeaderboardPromoPerEntry)}
                    share={promoShare}
                    color="var(--color-rival)"
                  />
                )}
              </div>
            </div>
          );
        })()}
        {hasVisibleBountyEv && onRowChange && (
          <BountyShareSlider
            committedBias={committedBias}
            committedShare={committedBountyShare}
            defaultShare={defaultBountyShare}
            minShare={minBountyShare}
            maxShare={maxBountyShare}
            realised={realised}
            poolCapsTop={poolCapsTop}
            onCommit={(v) => onRowChange({ bountyEvBias: v })}
            title={t("preview.evBias.label")}
            cashLabel={t("preview.evBias.cash")}
            bountyLabel={t("preview.evBias.bounty")}
            tip={t("preview.evBias.tip")}
            resetLabel={t("preview.evBias.reset")}
            poolCapNote={t("preview.evBias.poolCap")}
            rangeNote={t("preview.evBias.range")}
            gapNote={t("preview.evBias.gap")}
          />
        )}
        {stats.shellMode && stats.paidCount > 1 && onRowChange && (
          <TopHeavyPlacementSlider
            committedBias={committedItmTopHeavyBias}
            onCommit={(v) => onRowChange({ itmTopHeavyBias: v })}
            title={t("preview.topHeavyBias.label")}
            lowLabel={t("preview.topHeavyBias.flat")}
            highLabel={t("preview.topHeavyBias.heavy")}
            tip={t("preview.topHeavyBias.tip")}
            resetLabel={t("preview.evBias.reset")}
            disabledReason={
              finishModelSupportsItmTopHeavy(model.id) || isBattleRoyaleRow(effectiveRow)
                ? undefined
                : t("preview.topHeavyBias.unsupported")
            }
          />
        )}
      </div>

      {/* Tier-by-tier breakdown + discrete position rows. Shared grid
          template: swatch | label | bar | %EV | field % | equilibrium % | $ ROI */}
      <div className="flex flex-col gap-1.5">
        <div
          className={`grid ${EV_BREAKDOWN_GRID} ${EV_BREAKDOWN_GAP} items-center text-[9px] font-semibold uppercase tracking-[0.12em] text-[color:var(--color-fg-dim)] sm:text-[10px]`}
        >
          <span />
          <span>{t("preview.evBreakdown")}</span>
          <span />
          <span className={`${EV_BREAKDOWN_NUM} text-[color:var(--color-fg-dim)]`}>
            {t("preview.colEv")}
          </span>
          <span className={`${EV_BREAKDOWN_NUM} text-[color:var(--color-fg-dim)]`}>
            {t("preview.colField")}
          </span>
          <span className={`${EV_BREAKDOWN_NUM} text-[color:var(--color-fg-dim)]`}>
            {t("preview.colEq")}
          </span>
          <span className={`${EV_BREAKDOWN_NUM} text-[color:var(--color-fg-dim)]`}>
            {t("preview.colRoi")}
          </span>
        </div>
        <div className="flex flex-col divide-y divide-[color:var(--color-border)]/60">
          {(() => {
            const extraRows = [
              directRakebackPerEntry > 1e-6
                ? {
                    key: "__rb__",
                    label: t("chart.brLeaderboard.directRb"),
                    color: "var(--color-club)",
                    evShare: directRakebackPerEntry / evTotal,
                    netDollars: directRakebackPerEntry,
                  }
                : null,
              safeLeaderboardPromoPerEntry > 1e-6
                ? {
                    key: "__promo__",
                    label: t("chart.brLeaderboard.meanPayout"),
                    color: "var(--color-rival)",
                    evShare: safeLeaderboardPromoPerEntry / evTotal,
                    netDollars: safeLeaderboardPromoPerEntry,
                  }
                : null,
            ].filter(Boolean) as Array<{
              key: string;
              label: string;
              color: string;
              evShare: number;
              netDollars: number;
            }>;
            const rows: ReactNode[] = [];
            const eqEvShares = zeroSkillEvShares(stats, directRakebackPerEntry);
            // Max evShare across disjoint tiers — used as the 100% baseline
            // for bar widths so the largest tier fills the full bar. The
            // zero-skill baseline bars share the scale.
            let maxEv = 0;
            for (const tier of stats.tiers) {
              const s = tier.ev / evTotal;
              if (s > maxEv) maxEv = s;
            }
            for (const share of eqEvShares) {
              if (share > maxEv) maxEv = share;
            }
            for (const extra of extraRows) {
              if (extra.evShare > maxEv) maxEv = extra.evShare;
            }
            // Disjoint tiers + interleaved cumulative summary rows (top3
            // and FT) injected right after the winner tier, so "топ3" and
            // "финалка" sit next to "1st place" instead of at the end.
            // Bounty overlay must contrast with every tier colour in the
            // palette (yellow / orange / violet / fuchsia / grey). Teal is
            // outside the tier hue range so the bounty slice stays visible
            // even on violet tiers like "Финалка" and "Остальные кеши".
            const bountyAccent = "hsl(175, 72%, 55%)";
            const hasBounty = hasVisibleBountyEv;
            for (const [tierIdx, tier] of stats.tiers.entries()) {
              const evShare = tier.ev / evTotal;
              const fieldShare = tier.field;
              const bountyShareOfTier =
                tier.ev > 1e-9 ? tier.bountyEv / tier.ev : 0;
              const hasUsefulBreakdown =
                hasBounty &&
                (tier.bountyGivenFinish > 0.005 ||
                  tier.bountyEv > 0.005 ||
                  tier.bustsGivenFinish > 0.005);
              rows.push(
                <EvBreakdownRow
                  key={tier.key}
                  label={tierLabel(tier, t)}
                  color={tier.color}
                  evShare={evShare}
                  fieldShare={fieldShare}
                  eqShare={tier.eqShare}
                  eqEvShare={eqEvShares[tierIdx]}
                  netDollars={tier.netDollars}
                  maxEvShare={maxEv}
                  bountyShareOfTier={bountyShareOfTier}
                  bountyColor={bountyAccent}
                  breakdown={
                    hasUsefulBreakdown
                      ? {
                          tier,
                          hasBounty,
                          bountyColor: bountyAccent,
                          posRangeLabel: tierPlacesLabel(
                            tier,
                            t("preview.hover.placesVary"),
                          ),
                        }
                      : undefined
                  }
                />,
              );
            }
            for (const extra of extraRows) {
              rows.push(
                <EvBreakdownRow
                  key={extra.key}
                  label={extra.label}
                  color={extra.color}
                  evShare={extra.evShare}
                  fieldShare={null}
                  eqShare={null}
                  netDollars={extra.netDollars}
                  maxEvShare={maxEv}
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
                netDollars={
                  tierNetSum + directRakebackPerEntry + safeLeaderboardPromoPerEntry
                }
                eqNetDollars={
                  tierEqNetSum + directRakebackPerEntry + safeLeaderboardPromoPerEntry
                }
              />,
            );
            return rows;
          })()}
        </div>
      </div>

      {advanced && onRowChange && !itmLocked && (
        <ShapeControls row={effectiveRow} stats={stats} onRowChange={onRowChange} />
      )}
      {advanced && itmLocked && (
        <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-3 text-[10px] leading-snug text-[color:var(--color-fg-dim)]">
          {t("preview.itmLocked")}
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Shape controls — fixed-ITM panel with locks, presets, and target/current EW
// gap display. Activates when onRowChange is wired in.
// ---------------------------------------------------------------------------

interface ShapeControlsProps {
  row: TournamentRow;
  stats: RowStats;
  onRowChange: (updates: Partial<TournamentRow>) => void;
}

export function ShapeControls({ row, stats, onRowChange }: ShapeControlsProps) {
  const t = useT();
  const { locale } = useLocale();
  const numberLocale = numberLocaleTag(locale);
  const active = stats.shellMode;

  const patchBuckets = (patch: Partial<NonNullable<TournamentRow["finishBuckets"]>>) => {
    onRowChange(patchFinishLocks(row, patch));
  };
  const top3Available = isTop3LockAvailable(row.finishBuckets);

  const applyPreset = (preset: "auto" | "noskill" | "grinder" | "crusher") => {
    if (preset === "auto") {
      onRowChange({ itmRate: undefined, finishBuckets: undefined });
      return;
    }
    const next: Partial<TournamentRow> = { finishBuckets: undefined };
    if (preset === "noskill") next.itmRate = equilibriumItmRateForRow(row);
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
    return `${sign}$${Math.round(abs).toLocaleString(numberLocale)}`;
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
                { key: "first", label: t("shape.rowFirst"), current: stats.shellP1, lockAt: stats.lockP1, value: row.finishBuckets?.first },
                { key: "top3", label: t(stats.paidCount < 3 ? "shape.rowItm" : "shape.rowTop3"), current: stats.shellTop3, lockAt: stats.lockTop3, value: row.finishBuckets?.top3 },
                { key: "ft", label: t(stats.paidCount < 9 ? "shape.rowItm" : "shape.rowFt"), current: stats.shellFt, lockAt: stats.lockFt, value: row.finishBuckets?.ft },
              ] as const
            ).map((bucket) => {
              const locked = bucket.value != null;
              const needsAnchor = bucket.key === "top3" && !locked && !top3Available;
              const anchorHint = needsAnchor ? t("shape.top3NeedsAnchor") : undefined;
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
                    disabled={needsAnchor}
                    title={anchorHint}
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
                    className="w-16 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-1.5 py-0.5 text-center font-mono text-[11px] tabular-nums text-[color:var(--color-fg)] outline-none focus:border-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <button
                    type="button"
                    disabled={needsAnchor}
                    title={anchorHint}
                    onClick={() => {
                      if (locked) {
                        patchBuckets({ [bucket.key]: undefined } as Record<string, undefined>);
                      } else {
                        patchBuckets({ [bucket.key]: bucket.lockAt } as Record<string, number>);
                      }
                    }}
                    className="w-12 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-1 py-0.5 text-[9px] uppercase tracking-wider text-[color:var(--color-fg-dim)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[color:var(--color-border)] disabled:hover:text-[color:var(--color-fg-dim)]"
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

const MIN_BOUNTY_BIAS = -0.25;
const MAX_BOUNTY_BIAS = 0.25;
const BOUNTY_BIAS_STEP = 0.0125;

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
  return clampBountyBias(((share - anchor) / span) * MIN_BOUNTY_BIAS);
}

function snapBountyBias(v: number): number {
  const snapped = Math.round(clampBountyBias(v) / BOUNTY_BIAS_STEP) * BOUNTY_BIAS_STEP;
  return clampBountyBias(Number(snapped.toFixed(4)));
}

/** Every bias a drag can land on, written by `snapBountyBias` so the table is keyed by the drag's own values. */
const BOUNTY_BIAS_GRID: readonly number[] = Array.from(
  { length: Math.round((MAX_BOUNTY_BIAS - MIN_BOUNTY_BIAS) / BOUNTY_BIAS_STEP) + 1 },
  (_, k) => snapBountyBias(MIN_BOUNTY_BIAS + k * BOUNTY_BIAS_STEP),
);

function withoutBountyBias(row: TournamentRow): TournamentRow {
  return { ...row, bountyEvBias: 0 };
}

function sameRowApartFromBias(a: TournamentRow, b: TournamentRow): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof TournamentRow>;
  for (const key of keys) {
    if (key !== "bountyEvBias" && !Object.is(a[key], b[key])) return false;
  }
  return true;
}

export interface RealisedBountyShare {
  /** The KO share the row realises at a bias; the first ask of a bias solves the row. */
  at: (bias: number) => number;
  /** The KO share at a bias already solved; never solves. */
  solved: (bias: number) => number | undefined;
  /** The KO EV at this bias is all the bounty pool can pay the entry. */
  atPoolCeiling: (bias: number) => boolean;
  /** Milliseconds of the cheapest solve so far; Infinity before the first. */
  solveMs: () => number;
}

/** Each bias is solved once per row: a drag reads the 41 grid biases, and a
 *  large or ranged field costs tens of milliseconds a solve. */
export function realisedBountyShare(
  row: TournamentRow,
  model: FinishModelConfig,
): RealisedBountyShare {
  const solvedAt = new Map<number, { share: number; atPoolCeiling: boolean }>();
  // The cheapest solve, not the first: the first can carry a one-off warm-up.
  let cheapestMs = Infinity;
  const solve = (bias: number) => {
    let point = solvedAt.get(bias);
    if (point === undefined) {
      const started = performance.now();
      const stats = computeRowStats({ ...row, bountyEvBias: bias }, model, {
        skipCompiledSigma: true,
      });
      cheapestMs = Math.min(cheapestMs, performance.now() - started);
      point = { share: clampUnit(stats.bountyShare), atPoolCeiling: stats.bountyAtPoolCeiling };
      solvedAt.set(bias, point);
    }
    return point;
  };
  return {
    at: (bias) => solve(bias).share,
    solved: (bias) => solvedAt.get(bias)?.share,
    atPoolCeiling: (bias) => solve(bias).atPoolCeiling,
    solveMs: () => cheapestMs,
  };
}

/** A table fill solves for at most this long before it yields to the page. */
const FILL_SLICE_MS = 8;
/** A row whose solve costs no more fills its table as soon as it is shown:
 *  41 solves then fit in a few slices. */
const EAGER_FILL_SOLVE_MS = 1;

function nearestUnsolvedBias(realised: RealisedBountyShare, near: number): number | null {
  let best: number | null = null;
  for (const bias of BOUNTY_BIAS_GRID) {
    if (realised.solved(bias) !== undefined) continue;
    if (best === null || Math.abs(bias - near) < Math.abs(best - near)) best = bias;
  }
  return best;
}

export function BountyShareSlider({
  committedBias,
  committedShare,
  defaultShare,
  minShare,
  maxShare,
  realised,
  poolCapsTop,
  onCommit,
  title,
  cashLabel,
  bountyLabel,
  tip,
  resetLabel,
  poolCapNote,
  rangeNote,
  gapNote,
}: {
  committedBias: number;
  committedShare: number;
  defaultShare: number;
  minShare: number;
  maxShare: number;
  /** The KO share the row realises at a bias; falls as the bias rises. */
  realised: RealisedBountyShare;
  /** At the KO end of the axis the KO EV is all the bounty pool can pay. */
  poolCapsTop: boolean;
  onCommit: (v: number) => void;
  title: string;
  cashLabel: string;
  bountyLabel: string;
  tip: string;
  resetLabel: string;
  /** Template with {x}: a typed share above what the bounty pool pays. */
  poolCapNote: string;
  /** Template with {lo} and {hi}: a typed share outside what the row plays. */
  rangeNote: string;
  /** Template with {x} and {y}: a typed share the row jumps over, and the one it plays. */
  gapNote: string;
}) {
  const [draftBias, setDraftBias] = useState<number | null>(null);
  const [manualText, setManualText] = useState<string | null>(null);
  // The last typed share and the share its commit plays stay under the box
  // until the next edit, so a landing elsewhere than typed is never silent.
  const [typedLanding, setTypedLanding] = useState<{ typed: number; played: number } | null>(null);
  const [fillFor, setFillFor] = useState<RealisedBountyShare | null>(null);
  const [sliding, setSliding] = useState(false);
  const [, setFilledSlices] = useState(0);
  const inflightBiasRef = useRef<number[]>([]);
  const sliderFrameRef = useRef<number | null>(null);
  const pendingSliderBiasRef = useRef<number | null>(null);
  const axisMin = -MAX_BOUNTY_BIAS;
  const axisMax = -MIN_BOUNTY_BIAS;
  const axisRange = axisMax - axisMin;
  const locked = Math.abs(maxShare - minShare) <= 1e-9;
  const hasActiveDraft =
    draftBias !== null && Math.abs(committedBias - draftBias) > 1e-9;
  const effectiveBias = locked ? 0 : hasActiveDraft ? draftBias! : committedBias;
  const pending = hasActiveDraft;
  const valuePct = locked
    ? 50
    : clampUnit((-effectiveBias - axisMin) / axisRange) * 100;
  const centerPct = 50;
  const tiltLeft = Math.min(centerPct, valuePct);
  const tiltWidth = Math.abs(valuePct - centerPct);
  const lowShare = bountyShareFromBias(
    defaultShare,
    minShare,
    maxShare,
    MAX_BOUNTY_BIAS,
  );
  const highShare = bountyShareFromBias(
    defaultShare,
    minShare,
    maxShare,
    MIN_BOUNTY_BIAS,
  );
  const inputMinShare = Math.min(lowShare, highShare);
  const inputMaxShare = Math.max(lowShare, highShare);
  const inputMinPct = Number((inputMinShare * 100).toFixed(3));
  const inputMaxPct = Number((inputMaxShare * 100).toFixed(3));

  useEffect(() => {
    return () => {
      if (sliderFrameRef.current !== null) cancelAnimationFrame(sliderFrameRef.current);
    };
  }, []);

  useEffect(() => {
    const settled = settleCommitted(inflightBiasRef.current, committedBias);
    inflightBiasRef.current = settled.inflight;
    if (!settled.external) return;
    // An outside change to the stored bias replaces the local draft once.
    setDraftBias(null);
    setManualText(null);
    setTypedLanding(null);
  }, [committedBias]);

  // A drag reads the realised share at each grid bias from a table filled in
  // slices of solving, one per macrotask, nearest the thumb first: a solve in
  // a render would stall the drag, and the whole table in one go would freeze
  // the page on a large or ranged field. A light row fills it as soon as it is
  // shown; a heavier one waits until the pointer or focus reaches the slider,
  // so editing a field elsewhere is not followed by seconds of solving. The
  // fill waits while the thumb moves or a figure is typed: an input event then
  // waits at most one slice or one solve.
  const typing = manualText !== null;
  const fillNow = fillFor === realised || realised.solveMs() <= EAGER_FILL_SOLVE_MS;
  useEffect(() => {
    if (!fillNow || sliding || typing || locked) return;
    if (nearestUnsolvedBias(realised, effectiveBias) === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = () => {
      const started = performance.now();
      for (
        let next = nearestUnsolvedBias(realised, effectiveBias);
        next !== null;
        next = nearestUnsolvedBias(realised, effectiveBias)
      ) {
        if (performance.now() - started >= FILL_SLICE_MS) {
          timer = setTimeout(step, 0);
          break;
        }
        realised.at(next);
      }
      setFilledSlices((n) => n + 1);
    };
    timer = setTimeout(step, 0);
    return () => clearTimeout(timer);
  }, [fillNow, realised, sliding, typing, locked, effectiveBias]);

  const scheduleSliderDraft = (rawBias: number) => {
    const nextBias = locked ? 0 : snapBountyBias(rawBias);
    pendingSliderBiasRef.current = nextBias;
    if (sliderFrameRef.current !== null) return;
    sliderFrameRef.current = requestAnimationFrame(() => {
      sliderFrameRef.current = null;
      const pendingBias = pendingSliderBiasRef.current;
      if (pendingBias === null) return;
      setDraftBias(pendingBias);
    });
  };

  const commitBias = (bias: number) => {
    const nextBias = locked ? 0 : bias;
    if (isRepeatSubmission(inflightBiasRef.current, nextBias, committedBias)) {
      setDraftBias(nextBias);
      setManualText(null);
      return;
    }
    inflightBiasRef.current = submitBias(inflightBiasRef.current, nextBias);
    setDraftBias(nextBias);
    setManualText(null);
    onCommit(nextBias);
  };

  const commitSliderDraft = () => {
    // React may restore the controlled DOM value before the draft's rAF.
    // Commit the latest input event, then discard its pending paint. With no
    // input event the slider did not move, and the value the browser holds is
    // the stored bias snapped to the drag grid: committing it would snap a
    // typed share on Tab or blur.
    const nextBias = pendingSliderBiasRef.current;
    if (sliderFrameRef.current !== null) cancelAnimationFrame(sliderFrameRef.current);
    sliderFrameRef.current = null;
    pendingSliderBiasRef.current = null;
    setSliding(false);
    if (nextBias === null) return;
    // The release is solved here, in the event and never in a render, so from
    // the release on the readout is the share the engine plays, not an estimate.
    if (!locked) realised.at(nextBias);
    commitBias(nextBias);
  };

  // A typed share is held to the places the box prints, not to the drag grid
  // (1/20 of each side of the axis, 0.6-1 pp of share on the default rows).
  const parseManualShare = (raw: string): number | null => {
    const normalized = raw.trim().replace(",", ".");
    if (normalized === "") return null;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return null;
    const scale = 10 ** evPctInputPlaces(parsed);
    return Math.round(parsed * scale) / scale / 100;
  };

  const clampManualShare = (share: number): number =>
    Math.max(inputMinShare, Math.min(inputMaxShare, share));

  // A grid bias the table has not reached reads the straight line between the
  // solved biases either side of it, and the readout marks it as an estimate.
  const estimateShare = (bias: number): number => {
    let below = { bias: MIN_BOUNTY_BIAS, share: maxShare };
    let above = { bias: MAX_BOUNTY_BIAS, share: minShare };
    for (const gridBias of BOUNTY_BIAS_GRID) {
      const share = gridBias === 0 ? defaultShare : realised.solved(gridBias);
      if (share === undefined) continue;
      if (gridBias <= bias && gridBias > below.bias) below = { bias: gridBias, share };
      if (gridBias >= bias && gridBias < above.bias) above = { bias: gridBias, share };
    }
    if (above.bias <= below.bias) return below.share;
    return below.share + ((above.share - below.share) * (bias - below.bias)) / (above.bias - below.bias);
  };

  const lineBias = (share: number): number =>
    biasFromBountyShare(clampManualShare(share), defaultShare, minShare, maxShare);

  // The realised share is not a straight line in the bias wherever some
  // field's cash side saturates or empties (small fields, a range's small
  // buckets, a field pinned to an ITM far from its own), and the line through
  // the three probes then misses a typed share by up to 5 pp. The row is
  // solved between the line's guess and the far end of the axis by false
  // position (Illinois); the share falls as the bias rises. A share the row
  // jumps over lands on the nearer side of the jump.
  const shareToBias = (share: number): { bias: number; share: number } => {
    const target = clampManualShare(share);
    const point = (bias: number) => ({ bias, share: realised.at(bias) });
    const guess = point(lineBias(target));
    const gGuess = guess.share - target;
    if (Math.abs(gGuess) < 1e-9) return guess;
    const far = point(gGuess > 0 ? MAX_BOUNTY_BIAS : MIN_BOUNTY_BIAS);
    const gFar = far.share - target;
    if (Math.abs(gFar) < 1e-9 || Math.sign(gFar) === Math.sign(gGuess)) return far;
    let [lo, hi] = gGuess > 0 ? [guess, far] : [far, guess];
    let gLo = lo.share - target;
    let gHi = hi.share - target;
    let moved: "lo" | "hi" | null = null;
    for (let i = 0; i < 40; i++) {
      const mid = point((lo.bias * gHi - hi.bias * gLo) / (gHi - gLo));
      const g = mid.share - target;
      if (Math.abs(g) < 1e-9) return mid;
      if (g > 0) {
        lo = mid;
        gLo = g;
        if (moved === "lo") gHi /= 2;
        moved = "lo";
      } else {
        hi = mid;
        gHi = g;
        if (moved === "hi") gLo /= 2;
        moved = "hi";
      }
    }
    // The Illinois halving scales gLo and gHi, so the nearer side is read off the shares.
    return Math.abs(lo.share - target) < Math.abs(hi.share - target) ? lo : hi;
  };

  const manualParsedShare = manualText !== null ? parseManualShare(manualText) : null;
  // The ends come out of a solve and can sit an ulp inside a figure typed at
  // the end the box shows, and the box prints 3 places under 1 % and 1 above:
  // compare at the precision the box prints, not bit for bit.
  const halfShownUnit = (a: number, b: number) =>
    0.005 * 10 ** -evPctInputPlaces(Math.max(a, b) * 100);
  const aboveMax = (share: number) => share - inputMaxShare > halfShownUnit(share, inputMaxShare);
  const belowMin = (share: number) => inputMinShare - share > halfShownUnit(share, inputMinShare);
  const shownApart = (a: number, b: number) => Math.abs(a - b) >= halfShownUnit(a, b);
  const manualOutOfRange =
    manualParsedShare !== null && (belowMin(manualParsedShare) || aboveMax(manualParsedShare));
  // The slider never solves the row in a render. While a figure is typed the
  // readout shows it as a commit will land it and the thumb rides the line; the
  // commit solves. A drag reads the table, or an estimate marked as one until
  // the table has that bias.
  const draftShare =
    manualParsedShare === null && hasActiveDraft ? realised.solved(effectiveBias) : undefined;
  const estimated =
    manualParsedShare === null && hasActiveDraft && !locked && draftShare === undefined;
  const value =
    manualParsedShare !== null && !locked
      ? clampManualShare(manualParsedShare)
      : hasActiveDraft
        ? (draftShare ?? estimateShare(effectiveBias))
        : committedShare;
  const manualValue = estimated ? "" : (manualText ?? evPctInputValue(value));
  const approx = estimated ? "≈ " : "";
  // While a figure is typed the note names a share above the row's range only:
  // a figure on its way to a valid one can pass below the range, never above.
  // A share inside the range is named only once committed, if the row jumps
  // over it: no keystroke solves the row.
  const landing = locked
    ? null
    : manualParsedShare === null
      ? typedLanding
      : aboveMax(manualParsedShare)
        ? { typed: manualParsedShare, played: inputMaxShare }
        : null;
  const limitNote =
    landing === null
      ? null
      : aboveMax(landing.typed) && poolCapsTop
        ? fmt(poolCapNote, { x: evPct(inputMaxShare) })
        : aboveMax(landing.typed) || belowMin(landing.typed)
          ? fmt(rangeNote, { lo: evPct(inputMinShare), hi: evPct(inputMaxShare) })
          : shownApart(landing.played, landing.typed)
            ? fmt(gapNote, { x: evPct(landing.typed), y: evPct(landing.played) })
            : null;

  const updateManualShare = (raw: string) => {
    setManualText(raw);
    setTypedLanding(null);
    const nextShare = parseManualShare(raw);
    if (locked) return;
    // A cleared box or a lone "-" is not a figure: the thumb and the readout
    // go back to the stored share instead of the previous keystroke's guess.
    setDraftBias(nextShare == null ? null : lineBias(nextShare));
  };

  // Only a typed figure commits. The box prints the stored share rounded, so
  // focus alone, or retyping the figure it shows, must keep the stored bias.
  const commitManualShare = () => {
    if (manualText === null) return;
    const nextShare = parseManualShare(manualText);
    const shown =
      inflightBiasRef.current.length === 0 &&
      nextShare === parseManualShare(evPctInputValue(committedShare));
    if (nextShare == null || locked || shown) {
      setManualText(null);
      setDraftBias(null);
      return;
    }
    // Past an end the commit lands on that end (the pool's cap at the KO end
    // of a capped row), and across a jump in the realised share on its nearer
    // side; the note under the slider says where it stopped.
    const landed = shareToBias(nextShare);
    setTypedLanding({ typed: nextShare, played: landed.share });
    commitBias(landed.bias);
  };

  const startFill = () => setFillFor(realised);

  return (
    <div
      className="mt-3 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/75 p-3"
      title={tip}
      aria-busy={pending}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--color-fg)]">
          {title}
        </span>
        <div className="flex items-stretch gap-2">
          <label
            className={`${PREVIEW_SLIDER_VALUE_CHROME} ${
              manualOutOfRange
                ? "border-[color:var(--color-danger)]"
                : "border-[color:var(--color-border)]"
            }`}
          >
            <input
              type="number"
              min={inputMinPct}
              max={inputMaxPct}
              step={0.1}
              value={manualValue}
              placeholder={estimated ? `≈${evPctInputValue(value)}` : undefined}
              onChange={(e) => updateManualShare(e.target.value)}
              onBlur={commitManualShare}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitManualShare();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setManualText(null);
                  setDraftBias(null);
                }
              }}
              disabled={locked}
              aria-label={title}
              aria-invalid={manualOutOfRange || undefined}
              inputMode="decimal"
              className={`${PREVIEW_SLIDER_VALUE_INPUT} pmf-slider-value-input w-14 text-[15px]`}
            />
            <span className={`${PREVIEW_SLIDER_VALUE_SUFFIX} text-[12px]`}>
              %
            </span>
          </label>
          <button
            type="button"
            onClick={() => {
              setDraftBias(0);
              setManualText(null);
              setTypedLanding(null);
              if (Math.abs(committedBias) > 1e-9) {
                inflightBiasRef.current = submitBias(inflightBiasRef.current, 0);
                onCommit(0);
              }
            }}
            disabled={Math.abs(committedBias) < 1e-9}
            className={PREVIEW_SLIDER_RESET_CHROME}
          >
            {resetLabel}
          </button>
        </div>
      </div>
      <div className="mt-2.5 flex flex-col gap-1.5">
        <div className="pmf-slider" onPointerEnter={startFill}>
          <div
            aria-hidden
            className="pmf-slider-track"
          >
            <div
              className="absolute inset-y-0 rounded-full bg-[color:var(--color-accent)]/85"
              style={{ left: `${tiltLeft}%`, width: `${tiltWidth}%` }}
            />
          </div>
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 h-4 w-px -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color:var(--color-border-strong)]"
            style={{ left: `calc(${centerPct}% + ${10 - centerPct / 5}px)` }}
          />
          <span
            aria-hidden
            className="pmf-slider-thumb pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: `calc(${valuePct}% + ${10 - valuePct / 5}px)` }}
          />
          <input
            type="range"
            min={axisMin}
            max={axisMax}
            step={BOUNTY_BIAS_STEP}
            value={-effectiveBias}
            onChange={(e) => {
              setManualText(null);
              setTypedLanding(null);
              setSliding(true);
              scheduleSliderDraft(-Number(e.target.value));
            }}
            onPointerUp={commitSliderDraft}
            onKeyUp={commitSliderDraft}
            onFocus={startFill}
            onBlur={commitSliderDraft}
            disabled={locked}
            aria-valuetext={`${approx}${evPct(value)}`}
            className="absolute inset-0 z-10 block h-full w-full cursor-pointer appearance-none bg-transparent opacity-0 disabled:cursor-default"
            aria-label={title}
          />
        </div>
        <div className="grid grid-cols-3 text-[9px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
          <span>{evPct(lowShare)}</span>
          <span className="text-center text-[color:var(--color-fg)]">{evPct(defaultShare)}</span>
          <span className="text-right">{evPct(highShare)}</span>
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] font-medium text-[color:var(--color-fg-dim)]">
        <span>
          {cashLabel} {approx}{evPct(1 - value)}
        </span>
        <span className={pending ? "text-[color:var(--color-fg)]" : undefined}>
          {bountyLabel} {approx}{evPct(value)}
        </span>
      </div>
      <p
        role="status"
        className={`text-[10px] leading-snug text-[color:var(--color-fg-dim)] ${limitNote ? "mt-1.5" : ""}`}
      >
        {limitNote}
      </p>
    </div>
  );
}

function topHeavyPctInputValue(v: number): string {
  const clamped = Math.max(0, Math.min(100, v));
  if (Math.abs(clamped - Math.round(clamped)) < 0.005) {
    return Math.round(clamped).toString();
  }
  return clamped.toFixed(1);
}

function biasToTopHeavyPercent(bias: number): number {
  const clamped = clampItmTopHeavyBias(bias);
  const axisRange = MAX_ITM_TOP_HEAVY_BIAS - MIN_ITM_TOP_HEAVY_BIAS;
  return ((clamped - MIN_ITM_TOP_HEAVY_BIAS) / axisRange) * 100;
}

function topHeavyPercentToBias(percent: number): number {
  const clamped = Math.max(0, Math.min(100, percent));
  const axisRange = MAX_ITM_TOP_HEAVY_BIAS - MIN_ITM_TOP_HEAVY_BIAS;
  return clampItmTopHeavyBias(
    MIN_ITM_TOP_HEAVY_BIAS + (clamped / 100) * axisRange,
  );
}

function snapItmTopHeavyBias(v: number): number {
  const snapped =
    Math.round(clampItmTopHeavyBias(v) / ITM_TOP_HEAVY_BIAS_STEP) *
    ITM_TOP_HEAVY_BIAS_STEP;
  return clampItmTopHeavyBias(Number(snapped.toFixed(4)));
}

export function TopHeavyPlacementSlider({
  committedBias,
  onCommit,
  title,
  lowLabel,
  highLabel,
  tip,
  resetLabel,
  disabledReason,
}: {
  committedBias: number;
  onCommit: (v: number) => void;
  title: string;
  lowLabel: string;
  highLabel: string;
  tip: string;
  resetLabel: string;
  /** Set when the finish model ignores the bias; the engine plays 0. */
  disabledReason?: string;
}) {
  const disabled = disabledReason !== undefined;
  const [draftBias, setDraftBias] = useState<number | null>(null);
  const [manualText, setManualText] = useState<string | null>(null);
  const inflightBiasRef = useRef<number[]>([]);
  const sliderFrameRef = useRef<number | null>(null);
  const pendingSliderBiasRef = useRef<number | null>(null);
  const axisMin = MIN_ITM_TOP_HEAVY_BIAS;
  const axisMax = MAX_ITM_TOP_HEAVY_BIAS;
  const axisRange = axisMax - axisMin;
  const hasActiveDraft =
    draftBias !== null && Math.abs(committedBias - draftBias) > 1e-9;
  const effectiveBias = hasActiveDraft ? draftBias! : committedBias;
  const pending = hasActiveDraft;
  const valuePct = ((effectiveBias - axisMin) / axisRange) * 100;
  const centerPct = 50;
  const tiltLeft = Math.min(centerPct, valuePct);
  const tiltWidth = Math.abs(valuePct - centerPct);
  const manualValue =
    manualText ?? topHeavyPctInputValue(biasToTopHeavyPercent(effectiveBias));

  useEffect(() => {
    return () => {
      if (sliderFrameRef.current !== null) {
        cancelAnimationFrame(sliderFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const settled = settleCommitted(inflightBiasRef.current, committedBias);
    inflightBiasRef.current = settled.inflight;
    if (!settled.external) return;
    // An outside change to the stored bias replaces the local draft once.
    setDraftBias(null);
    setManualText(null);
  }, [committedBias]);

  const scheduleSliderDraft = (rawBias: number) => {
    const nextBias = snapItmTopHeavyBias(rawBias);
    pendingSliderBiasRef.current = nextBias;
    if (sliderFrameRef.current !== null) return;
    sliderFrameRef.current = requestAnimationFrame(() => {
      sliderFrameRef.current = null;
      const pendingBias = pendingSliderBiasRef.current;
      if (pendingBias === null) return;
      setDraftBias(pendingBias);
    });
  };

  const commitBias = (nextBias: number) => {
    if (isRepeatSubmission(inflightBiasRef.current, nextBias, committedBias)) {
      setDraftBias(nextBias);
      setManualText(null);
      return;
    }
    inflightBiasRef.current = submitBias(inflightBiasRef.current, nextBias);
    setDraftBias(nextBias);
    setManualText(null);
    onCommit(nextBias);
  };

  const commitSliderDraft = () => {
    // React may restore the controlled DOM value before the draft's rAF.
    // Commit the latest input event, then discard its pending paint. With no
    // input event the slider did not move, and the value the browser holds is
    // the stored bias snapped to the drag grid: committing it would snap a
    // typed figure on Tab or blur.
    const nextBias = pendingSliderBiasRef.current;
    if (sliderFrameRef.current !== null) cancelAnimationFrame(sliderFrameRef.current);
    sliderFrameRef.current = null;
    pendingSliderBiasRef.current = null;
    if (nextBias !== null) commitBias(nextBias);
  };

  // A typed figure is held to the one decimal the box prints, not to the
  // drag grid's 2.5 points.
  const parseManualPercent = (raw: string): number | null => {
    const normalized = raw.trim().replace(",", ".");
    if (normalized === "") return null;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return null;
    return Math.round(parsed * 10) / 10;
  };

  const manualParsedPercent =
    manualText !== null ? parseManualPercent(manualText) : null;
  const manualOutOfRange =
    manualParsedPercent !== null &&
    (manualParsedPercent < 0 || manualParsedPercent > 100);

  const updateManualPercent = (raw: string) => {
    setManualText(raw);
    const nextPercent = parseManualPercent(raw);
    if (nextPercent == null) return;
    setDraftBias(topHeavyPercentToBias(nextPercent));
  };

  // Only a typed figure commits, and not the one the box already shows: a
  // stored bias off the box's 0.1 grid (a link, an older save) stays put.
  const commitManualPercent = () => {
    if (manualText === null) return;
    const nextPercent = parseManualPercent(manualText);
    const shown =
      inflightBiasRef.current.length === 0 &&
      nextPercent ===
        parseManualPercent(topHeavyPctInputValue(biasToTopHeavyPercent(committedBias)));
    if (nextPercent == null || shown) {
      setManualText(null);
      setDraftBias(null);
      return;
    }
    commitBias(topHeavyPercentToBias(nextPercent));
  };

  return (
    <div
      className="mt-3 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/70 p-2.5"
      title={disabledReason ?? tip}
      aria-busy={pending}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--color-fg)]">
          {title}
        </span>
        <div className="flex items-stretch gap-2">
          <label
            className={`${PREVIEW_SLIDER_VALUE_CHROME} ${
              manualOutOfRange
                ? "border-[color:var(--color-danger)]"
                : "border-[color:var(--color-border)]"
            }`}
          >
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={manualValue}
              onChange={(e) => updateManualPercent(e.target.value)}
              onBlur={commitManualPercent}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitManualPercent();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setManualText(null);
                  setDraftBias(null);
                }
              }}
              aria-label={title}
              aria-invalid={manualOutOfRange || undefined}
              disabled={disabled}
              inputMode="decimal"
              className={`${PREVIEW_SLIDER_VALUE_INPUT} pmf-slider-value-input w-16 text-[17px]`}
            />
            <span className={`${PREVIEW_SLIDER_VALUE_SUFFIX} text-[13px]`}>
              %
            </span>
          </label>
          <button
            type="button"
            onClick={() => {
              setDraftBias(0);
              setManualText(null);
              if (Math.abs(committedBias) > 1e-9) {
                inflightBiasRef.current = submitBias(inflightBiasRef.current, 0);
                onCommit(0);
              }
            }}
            disabled={Math.abs(committedBias) < 1e-9}
            className={PREVIEW_SLIDER_RESET_CHROME}
          >
            {resetLabel}
          </button>
        </div>
      </div>
      <div className={`mt-3 flex flex-col gap-2${disabled ? " opacity-50" : ""}`}>
        <div className="pmf-slider">
          <div
            aria-hidden
            className="pmf-slider-track"
          >
            <div
              className="absolute inset-y-0 rounded-full bg-[color:var(--color-accent)]/85"
              style={{ left: `${tiltLeft}%`, width: `${tiltWidth}%` }}
            />
          </div>
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 h-5 w-px -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color:var(--color-border-strong)]"
            style={{ left: `calc(${centerPct}% + ${10 - centerPct / 5}px)` }}
          />
          <span
            aria-hidden
            className="pmf-slider-thumb pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: `calc(${valuePct}% + ${10 - valuePct / 5}px)` }}
          />
          <input
            type="range"
            min={axisMin}
            max={axisMax}
            step={ITM_TOP_HEAVY_BIAS_STEP}
            value={effectiveBias}
            onChange={(e) => {
              setManualText(null);
              scheduleSliderDraft(Number(e.target.value));
            }}
            onPointerUp={commitSliderDraft}
            onKeyUp={commitSliderDraft}
            onBlur={commitSliderDraft}
            aria-valuetext={`${topHeavyPctInputValue(biasToTopHeavyPercent(effectiveBias))}%`}
            disabled={disabled}
            className="absolute inset-0 z-10 block h-full w-full cursor-pointer appearance-none bg-transparent opacity-0"
            aria-label={title}
          />
        </div>
        <div className="grid grid-cols-3 text-[10px] font-medium uppercase tracking-wider text-[color:var(--color-fg-dim)]">
          <span>0%</span>
          <span className="text-center text-[color:var(--color-fg)]">50%</span>
          <span className="text-right">100%</span>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] font-medium text-[color:var(--color-fg-dim)]">
        <span>{lowLabel}</span>
        <span className={pending ? "text-[color:var(--color-fg)]" : undefined}>
          {topHeavyPctInputValue(biasToTopHeavyPercent(effectiveBias))}%
        </span>
        <span className="text-right">{highLabel}</span>
      </div>
      {disabledReason && (
        <p className="mt-2 text-[11px] text-[color:var(--color-fg-dim)]">{disabledReason}</p>
      )}
    </div>
  );
}
