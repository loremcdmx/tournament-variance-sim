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
  ITM_TOP_HEAVY_BIAS_STEP,
  MAX_ITM_TOP_HEAVY_BIAS,
  MIN_ITM_TOP_HEAVY_BIAS,
} from "@/lib/sim/itmTopHeavy";
import { derivePreviewRowEconomics } from "@/lib/sim/previewRowEconomics";
import {
  computeRowStats,
  type RowStats,
} from "@/lib/sim/previewRowStats";
import type { FinishModelConfig, TournamentRow } from "@/lib/sim/types";
import { useLocale, useT } from "@/lib/i18n/LocaleProvider";
import { getTournamentRowDisplayLabel } from "@/lib/ui/tournamentRowLabel";

import { useAdvancedMode } from "@/lib/ui/AdvancedModeProvider";
import {
  EvBreakdownFooter,
  EvBreakdownRow,
  EV_BREAKDOWN_GAP,
  EV_BREAKDOWN_GRID,
  EV_BREAKDOWN_NUM,
  evPct,
  evPctInputValue,
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
  /** If provided, the fixed-ITM shape controls panel is shown below the
   *  tier breakdown and can edit row.itmRate / row.finishBuckets. */
  onRowChange?: (updates: Partial<TournamentRow>) => void;
  /** When true, the global ITM cascade is driving row.itmRate — hide
   *  / disable the shape editor so the user knows tweaks would be
   *  overridden on the next render. */
  itmLocked?: boolean;
}

export const FinishPMFPreview = memo(function FinishPMFPreview({
  row,
  model,
  rakebackPct = 0,
  onRowChange,
  itmLocked,
}: Props) {
  const t = useT();
  const { locale } = useLocale();
  const { advanced } = useAdvancedMode();
  const {
    id,
    label,
    tags,
    gameType,
    players,
    fieldVariability,
    buyIn,
    rake,
    roi,
    itmRate,
    itmTopHeavyBias,
    finishBuckets,
    payoutStructure,
    customPayouts,
    guarantee,
    count,
    bountyFraction,
    sitThroughPayJumps,
    payJumpAggression,
    mysteryBountyVariance,
    pkoHeat,
    pkoHeadVar,
  } = row;

  const committedBias = clampBountyBias(row.bountyEvBias ?? 0);
  const committedItmTopHeavyBias = clampItmTopHeavyBias(
    row.itmTopHeavyBias ?? 0,
  );
  const previewEconomics = useMemo(() => derivePreviewRowEconomics(row), [row]);
  const stats = useMemo(() => computeRowStats(row, model), [row, model]);
  const rbFrac = Math.max(0, rakebackPct) / 100;
  const directRakebackPerEntry =
    rbFrac *
    row.rake *
    row.buyIn *
    previewEconomics.expectedBullets;
  const leaderboardPromoPerEntry = 0;
  const totalEvPerEntry =
    stats.evPerEntry + directRakebackPerEntry + leaderboardPromoPerEntry;
  const committedBountyShare = clampUnit(stats.bountyShare);
  const shareProbeBaseRow = useMemo<TournamentRow>(
    () => ({
      id,
      label,
      tags,
      gameType,
      players,
      fieldVariability,
      buyIn,
      rake,
      roi,
      itmRate,
      itmTopHeavyBias,
      finishBuckets,
      payoutStructure,
      customPayouts,
      guarantee,
      count,
      bountyFraction,
      sitThroughPayJumps,
      payJumpAggression,
      mysteryBountyVariance,
      pkoHeat,
      pkoHeadVar,
      bountyEvBias: 0,
    }),
    [
      id,
      label,
      tags,
      gameType,
      players,
      fieldVariability,
      buyIn,
      rake,
      roi,
      itmRate,
      itmTopHeavyBias,
      finishBuckets,
      payoutStructure,
      customPayouts,
      guarantee,
      count,
      bountyFraction,
      sitThroughPayJumps,
      payJumpAggression,
      mysteryBountyVariance,
      pkoHeat,
      pkoHeadVar,
    ],
  );
  const { defaultBountyShare, minBountyShare, maxBountyShare } = useMemo(() => {
    const hasBounty = (shareProbeBaseRow.bountyFraction ?? 0) > 0;
    if (!hasBounty) {
      return {
        defaultBountyShare: 0,
        minBountyShare: 0,
        maxBountyShare: 0,
      };
    }
    const baseStats = computeRowStats(shareProbeBaseRow, model);
    const lowKoStats = computeRowStats(
      { ...shareProbeBaseRow, bountyEvBias: MAX_BOUNTY_BIAS },
      model,
    );
    const highKoStats = computeRowStats(
      { ...shareProbeBaseRow, bountyEvBias: MIN_BOUNTY_BIAS },
      model,
    );
    return {
      defaultBountyShare: clampUnit(baseStats.bountyShare),
      minBountyShare: clampUnit(lowKoStats.bountyShare),
      maxBountyShare: clampUnit(highKoStats.bountyShare),
    };
  }, [shareProbeBaseRow, model]);

  const evTotal = totalEvPerEntry || 1;

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

  const netProfitPerEntry = totalEvPerEntry - stats.cost;
  const roiPerEntry = stats.cost > 1e-9 ? netProfitPerEntry / stats.cost : 0;
  const rakeAmount = previewEconomics.totalRake;
  const rakeFooter =
    rakeAmount > 0.005
      ? `${moneyFmt(previewEconomics.buyInTotal)} + ${moneyFmt(rakeAmount)} ${t("chart.convergence.rake")}`
      : moneyFmt(previewEconomics.buyInTotal);
  const quickRoi = `${roiPerEntry >= 0 ? "+" : ""}${(roiPerEntry * 100).toFixed(1)}%`;
  const quickItm = `${(stats.itm * 100).toFixed(1)}%`;
  const quickField = previewEconomics.fieldSize.toLocaleString(
    locale === "ru" ? "ru-RU" : "en-US",
  );
  const rowTitle = getTournamentRowDisplayLabel(row, t);
  const bountyTag = stats.progressivePko
    ? t("preview.statBountyPko")
    : stats.bountyShare > 0
      ? t("preview.statBountyFlat")
      : "";

  return (
    <div className="flex flex-col gap-3.5">
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
      <div className="group relative overflow-hidden rounded-md border border-[color:var(--color-border-strong)]/70 bg-[linear-gradient(135deg,var(--color-bg)_0%,var(--color-bg-elev)_60%,rgba(255,222,81,0.08)_100%)] p-3.5 shadow-[0_18px_40px_-32px_rgba(0,0,0,0.9)]">
        <div className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-[color:var(--color-accent)]/70 to-transparent" />
        <div className="relative grid grid-cols-1 items-stretch gap-2.5 sm:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
          <PreviewHeroStat
            label={t("preview.youPay")}
            value={moneyFmt(stats.cost)}
            footer={
              <span className="rounded-md border border-[color:var(--color-border-strong)]/70 bg-[color:var(--color-bg-elev)]/90 px-2.5 py-1.5 font-mono text-[11px] font-medium tabular-nums text-[color:var(--color-fg)] opacity-80">
                {rakeFooter}
              </span>
            }
          />
          <PreviewHeroStat
            label="EV"
            value={moneyFmt(totalEvPerEntry)}
            accent
            details={[
              { label: t("row.roi"), value: quickRoi, tone: "accent" },
              { label: t("preview.statItm"), value: quickItm },
              { label: t("preview.statField"), value: quickField },
            ]}
            footer={
              <div
                className={`inline-flex max-w-full items-center gap-2 rounded-md border px-2.5 py-1.5 shadow-sm ${
                  netProfitPerEntry >= 0
                    ? "border-[color:var(--color-accent)]/50 bg-[color:var(--color-accent)]/14"
                    : "border-[color:var(--color-danger)]/45 bg-[color:var(--color-danger)]/12"
                }`}
              >
                <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-fg)] opacity-70">
                  {t("preview.avgReturn")}
                </span>
                <span
                  className={`font-mono text-[15px] font-bold leading-none tabular-nums ${
                    netProfitPerEntry >= 0
                      ? "text-[color:var(--color-accent)]"
                      : "text-[color:var(--color-danger)]"
                  }`}
                >
                  {netProfitPerEntry >= 0 ? "+" : ""}
                  {moneyFmt(netProfitPerEntry)}
                </span>
              </div>
            }
          />
        </div>
        {(stats.bountyEvPerEntry > 0 ||
          directRakebackPerEntry > 1e-6 ||
          leaderboardPromoPerEntry > 1e-6) &&
          (() => {
          const jp = stats.jackpotBountyEvPerEntry;
          const hasJp = jp > 0 && jp / stats.bountyEvPerEntry > 0.001;
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
              ? leaderboardPromoPerEntry / totalEvPerEntry
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
                {leaderboardPromoPerEntry > 1e-6 && (
                  <PreviewSplitStat
                    label={t("chart.brLeaderboard.meanPayout")}
                    value={moneyFmt(leaderboardPromoPerEntry)}
                    share={promoShare}
                    color="var(--color-rival)"
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
            onCommit={(v) => onRowChange({ bountyEvBias: v })}
            title={t("preview.evBias.label")}
            cashLabel={t("preview.evBias.cash")}
            bountyLabel={t("preview.evBias.bounty")}
            tip={t("preview.evBias.tip")}
            resetLabel={t("preview.evBias.reset")}
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
          />
        )}
      </div>

      {/* Tier-by-tier breakdown + discrete position rows. Shared grid
          template: swatch | label | bar | %EV | field % | equilibrium % | $ ROI */}
      <div className="flex flex-col gap-1.5 pl-6">
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
              leaderboardPromoPerEntry > 1e-6
                ? {
                    key: "__promo__",
                    label: t("chart.brLeaderboard.meanPayout"),
                    color: "var(--color-rival)",
                    evShare: leaderboardPromoPerEntry / evTotal,
                    netDollars: leaderboardPromoPerEntry,
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
            // Max evShare across disjoint tiers — used as the 100% baseline
            // for bar widths so the largest tier fills the full bar.
            let maxEv = 0;
            for (const tier of stats.tiers) {
              const s = tier.ev / evTotal;
              if (s > maxEv) maxEv = s;
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
            const hasBounty = stats.bountyEvPerEntry > 1e-6;
            for (const tier of stats.tiers) {
              const evShare = tier.ev / evTotal;
              const fieldShare = tier.field;
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
                  tierNetSum + directRakebackPerEntry + leaderboardPromoPerEntry
                }
                eqNetDollars={
                  tierEqNetSum + directRakebackPerEntry + leaderboardPromoPerEntry
                }
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
  const [draftBias, setDraftBias] = useState<number | null>(null);
  const [manualText, setManualText] = useState<string | null>(null);
  const submittedBiasRef = useRef<number | null>(null);
  const sliderFrameRef = useRef<number | null>(null);
  const pendingSliderBiasRef = useRef<number | null>(null);
  const axisMin = -MAX_BOUNTY_BIAS;
  const axisMax = -MIN_BOUNTY_BIAS;
  const axisRange = axisMax - axisMin;
  const locked = Math.abs(maxShare - minShare) <= 1e-9;
  const hasActiveDraft =
    draftBias !== null && Math.abs(committedBias - draftBias) > 1e-9;
  const effectiveBias = locked ? 0 : hasActiveDraft ? draftBias! : committedBias;
  const value = hasActiveDraft
    ? bountyShareFromBias(defaultShare, minShare, maxShare, effectiveBias)
    : committedShare;
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
  const manualValue = manualText ?? evPctInputValue(value);

  useEffect(() => {
    return () => {
      if (sliderFrameRef.current !== null) cancelAnimationFrame(sliderFrameRef.current);
    };
  }, []);

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

  const commitBias = (rawBias: number) => {
    const nextBias = locked ? 0 : snapBountyBias(rawBias);
    const submittedBias = submittedBiasRef.current;
    if (
      Math.abs(nextBias - committedBias) < 1e-9 ||
      (submittedBias !== null && Math.abs(nextBias - submittedBias) < 1e-9)
    ) {
      setDraftBias(nextBias);
      setManualText(null);
      return;
    }
    submittedBiasRef.current = nextBias;
    setDraftBias(nextBias);
    setManualText(null);
    onCommit(nextBias);
  };

  const parseManualShare = (raw: string): number | null => {
    const normalized = raw.trim().replace(",", ".");
    if (normalized === "") return null;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return null;
    return parsed / 100;
  };

  const clampManualShare = (share: number): number =>
    Math.max(inputMinShare, Math.min(inputMaxShare, share));

  const shareToBias = (share: number): number =>
    biasFromBountyShare(
      clampManualShare(share),
      defaultShare,
      minShare,
      maxShare,
    );

  const manualParsedShare = manualText !== null ? parseManualShare(manualText) : null;
  const manualOutOfRange =
    manualParsedShare !== null &&
    (manualParsedShare < inputMinShare || manualParsedShare > inputMaxShare);

  const updateManualShare = (raw: string) => {
    setManualText(raw);
    const nextShare = parseManualShare(raw);
    if (nextShare == null || locked) return;
    setDraftBias(snapBountyBias(shareToBias(nextShare)));
  };

  const commitManualShare = () => {
    const nextShare = parseManualShare(manualValue);
    if (nextShare == null || locked) {
      setManualText(null);
      setDraftBias(null);
      return;
    }
    commitBias(shareToBias(nextShare));
  };

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
              className={`${PREVIEW_SLIDER_VALUE_INPUT} w-14 text-[15px]`}
            />
            <span className={`${PREVIEW_SLIDER_VALUE_SUFFIX} text-[12px]`}>
              %
            </span>
          </label>
          <button
            type="button"
            onClick={() => {
              submittedBiasRef.current = 0;
              setDraftBias(0);
              setManualText(null);
              if (Math.abs(committedBias) > 1e-9) onCommit(0);
            }}
            disabled={Math.abs(committedBias) < 1e-9}
            className={PREVIEW_SLIDER_RESET_CHROME}
          >
            {resetLabel}
          </button>
        </div>
      </div>
      <div className="mt-2.5 flex flex-col gap-1.5">
        <div className="relative h-7">
          <div
            aria-hidden
            className="absolute left-0 right-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev-2)]"
          >
            <div
              className="absolute inset-y-0 left-0 bg-[color:var(--color-bg-elev)]"
              style={{ width: `${centerPct}%` }}
            />
            <div
              className="absolute inset-y-0 right-0 bg-[color:var(--color-accent)]/25"
              style={{ width: `${100 - centerPct}%` }}
            />
            <div
              className="absolute inset-y-0 rounded-full bg-[color:var(--color-accent)]/85"
              style={{ left: `${tiltLeft}%`, width: `${tiltWidth}%` }}
            />
          </div>
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 h-4 w-px -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color:var(--color-border-strong)]"
            style={{ left: `${centerPct}%` }}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[color:var(--color-bg)] bg-[color:var(--color-accent)] shadow-sm"
            style={{ left: `${valuePct}%` }}
          />
          <input
            type="range"
            min={axisMin}
            max={axisMax}
            step={BOUNTY_BIAS_STEP}
            value={-effectiveBias}
            onChange={(e) => {
              setManualText(null);
              scheduleSliderDraft(-Number(e.target.value));
            }}
            onPointerUp={(e) => commitBias(-Number(e.currentTarget.value))}
            onKeyUp={(e) => commitBias(-Number(e.currentTarget.value))}
            onBlur={(e) => commitBias(-Number(e.currentTarget.value))}
            disabled={locked}
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
          {cashLabel} {evPct(1 - value)}
        </span>
        <span className={pending ? "text-[color:var(--color-fg)]" : undefined}>
          {bountyLabel} {evPct(value)}
        </span>
      </div>
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

function TopHeavyPlacementSlider({
  committedBias,
  onCommit,
  title,
  lowLabel,
  highLabel,
  tip,
  resetLabel,
}: {
  committedBias: number;
  onCommit: (v: number) => void;
  title: string;
  lowLabel: string;
  highLabel: string;
  tip: string;
  resetLabel: string;
}) {
  const [draftBias, setDraftBias] = useState<number | null>(null);
  const [manualText, setManualText] = useState<string | null>(null);
  const submittedBiasRef = useRef<number | null>(null);
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

  const commitBias = (rawBias: number) => {
    const nextBias = snapItmTopHeavyBias(rawBias);
    const submittedBias = submittedBiasRef.current;
    if (
      Math.abs(nextBias - committedBias) < 1e-9 ||
      (submittedBias !== null && Math.abs(nextBias - submittedBias) < 1e-9)
    ) {
      setDraftBias(nextBias);
      setManualText(null);
      return;
    }
    submittedBiasRef.current = nextBias;
    setDraftBias(nextBias);
    setManualText(null);
    onCommit(nextBias);
  };

  const parseManualPercent = (raw: string): number | null => {
    const normalized = raw.trim().replace(",", ".");
    if (normalized === "") return null;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return null;
    return parsed;
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
    setDraftBias(snapItmTopHeavyBias(topHeavyPercentToBias(nextPercent)));
  };

  const commitManualPercent = () => {
    const nextPercent = parseManualPercent(manualValue);
    if (nextPercent == null) {
      setManualText(null);
      setDraftBias(null);
      return;
    }
    commitBias(topHeavyPercentToBias(nextPercent));
  };

  return (
    <div
      className="mt-3 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)]/70 p-2.5"
      title={tip}
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
              className={`${PREVIEW_SLIDER_VALUE_INPUT} w-16 text-[17px]`}
            />
            <span className={`${PREVIEW_SLIDER_VALUE_SUFFIX} text-[13px]`}>
              %
            </span>
          </label>
          <button
            type="button"
            onClick={() => {
              submittedBiasRef.current = 0;
              setDraftBias(0);
              setManualText(null);
              if (Math.abs(committedBias) > 1e-9) onCommit(0);
            }}
            disabled={Math.abs(committedBias) < 1e-9}
            className={PREVIEW_SLIDER_RESET_CHROME}
          >
            {resetLabel}
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <div className="relative h-8">
          <div
            aria-hidden
            className="absolute left-0 right-0 top-1/2 h-2.5 -translate-y-1/2 overflow-hidden rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev-2)]"
          >
            <div
              className="absolute inset-y-0 left-0 bg-[color:var(--color-bg-elev)]"
              style={{ width: `${centerPct}%` }}
            />
            <div
              className="absolute inset-y-0 right-0 bg-[color:var(--color-accent)]/25"
              style={{ width: `${100 - centerPct}%` }}
            />
            <div
              className="absolute inset-y-0 rounded-full bg-[color:var(--color-accent)]/85"
              style={{ left: `${tiltLeft}%`, width: `${tiltWidth}%` }}
            />
          </div>
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 h-5 w-px -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color:var(--color-border-strong)]"
            style={{ left: `${centerPct}%` }}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 h-4.5 w-4.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[color:var(--color-bg)] bg-[color:var(--color-accent)] shadow-sm"
            style={{ left: `${valuePct}%` }}
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
            onPointerUp={(e) => commitBias(Number(e.currentTarget.value))}
            onKeyUp={(e) => commitBias(Number(e.currentTarget.value))}
            onBlur={(e) => commitBias(Number(e.currentTarget.value))}
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
    </div>
  );
}
