"use client";

import { useMemo } from "react";
import {
  buildFinishPMF,
  calibrateAlpha,
  calibrateShelledItm,
} from "@/lib/sim/finishModel";
import { getPayoutTable } from "@/lib/sim/payouts";
import type { FinishModelConfig, TournamentRow } from "@/lib/sim/types";
import { useT } from "@/lib/i18n/LocaleProvider";
import { useAdvancedMode } from "@/lib/ui/AdvancedModeProvider";

interface Props {
  row: TournamentRow;
  model: FinishModelConfig;
  /** If provided, the fixed-ITM shape controls panel is shown below the
   *  tier breakdown and can edit row.itmRate / row.finishBuckets. */
  onRowChange?: (updates: Partial<TournamentRow>) => void;
}

type TierKey =
  | "winner"
  | "top01"
  | "top05"
  | "top1"
  | "top5"
  | "top10"
  | "ft"
  | "restItm"
  | "ootm";

type TierLabelKey =
  | "preview.tierWinner"
  | "preview.tierTop01"
  | "preview.tierTop05"
  | "preview.tierTop1"
  | "preview.tierTop5"
  | "preview.tierTop10"
  | "preview.tierFt"
  | "preview.tierRestItm"
  | "preview.tierOotm";

interface TierRow {
  key: TierKey;
  labelKey: TierLabelKey;
  color: string;
  ev: number;
  field: number;
}

export function FinishPMFPreview({ row, model, onRowChange }: Props) {
  const t = useT();
  const { advanced } = useAdvancedMode();

  const stats = useMemo(() => computeRowStats(row, model), [row, model]);

  const evTotal =
    stats.tiers.reduce((a, tier) => a + tier.ev, 0) || 1;

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

  const pct = (v: number) =>
    `${(v * 100).toFixed(v < 0.001 ? 2 : v < 0.1 ? 1 : 0)}%`;

  const itmOne = stats.itm > 0 ? Math.max(1, Math.round(1 / stats.itm)) : 0;
  const netProfitPerEntry = stats.evPerEntry - stats.cost;

  // Top-heaviness hero. For small/medium fields we describe the top-1%
  // tier (winner + anything between places 2..ceil(N*1%)). For high-field
  // MTTs we switch to a final-table framing — "share that lives at the
  // FT, which you reach 1 in K" — because it's the slice a high-field
  // grinder actually tracks in their head.
  const highField = row.players >= 300;
  const useFtFraming = highField && stats.ftEvShare > 0.3;
  let heroBody: string;
  if (useFtFraming) {
    const ftOdds =
      stats.ftField > 0 ? Math.max(1, Math.round(1 / stats.ftField)) : 0;
    heroBody = t("preview.heroBodyFt")
      .replace("{share}", pct(stats.ftEvShare))
      .replace("{odds}", ftOdds > 0 ? String(ftOdds) : "∞");
  } else {
    const topTier = stats.tiers.find((x) => x.key === "top1");
    const winnerTier = stats.tiers.find((x) => x.key === "winner");
    const topShare =
      (winnerTier?.ev ?? 0) + (topTier?.ev ?? 0);
    const topField =
      (winnerTier?.field ?? 0) + (topTier?.field ?? 0);
    const topEvShareFrac = evTotal > 0 ? topShare / evTotal : 0;
    const topOdds = topField > 0 ? Math.max(1, Math.round(1 / topField)) : 0;
    const heroBodyKey =
      stats.topPlaces <= 1 ? "preview.heroBodyTop1" : "preview.heroBodyTopN";
    heroBody = t(heroBodyKey)
      .replace("{share}", pct(topEvShareFrac))
      .replace("{n}", String(stats.topPlaces))
      .replace("{odds}", topOdds > 0 ? String(topOdds) : "∞");
  }

  // Entertaining fact: the smallest k such that top-k places carry ≥50%
  // of expected payout, and how rare that finish is. Only shown on
  // high-field MTTs, where the answer is actually surprising (e.g. 3 of
  // 500). For 18-man sit-and-gos it collapses to 1-of-3 and adds no info.
  const halfMassLine =
    highField && stats.halfMassK > 0 && stats.halfMassField > 0
      ? t("preview.halfMass")
          .replace("{k}", String(stats.halfMassK))
          .replace("{n}", String(row.players))
          .replace(
            "{odds}",
            String(Math.max(1, Math.round(1 / stats.halfMassField))),
          )
      : null;

  const itmLine = t("preview.itmLine")
    .replace("{n}", itmOne > 0 ? String(itmOne) : "∞")
    .replace("{pct}", pct(stats.itm));

  return (
    <div className="flex flex-col gap-5">
      {/* Eyebrow + tournament identity */}
      <div className="flex flex-col gap-1">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--color-fg-dim)]">
          {t("preview.eyebrow")}
        </div>
        <div className="text-sm font-semibold text-[color:var(--color-fg)]">
          {row.label || t("row.unnamed")}
        </div>
        <div className="text-[10px] tabular-nums text-[color:var(--color-fg-dim)]">
          {row.players} {t("preview.playersLabel")} · α {stats.alpha.toFixed(2)}
          {stats.progressivePko
            ? ` · ${t("preview.statBountyPko")}`
            : stats.bountyShare > 0
              ? ` · ${t("preview.statBountyFlat")}`
              : ""}
        </div>
      </div>

      {/* Buy-in → avg profit */}
      <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-3">
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
              {t("preview.youPay")}
            </div>
            <div className="text-[22px] font-bold leading-none tabular-nums text-[color:var(--color-fg)]">
              {moneyFmt(stats.cost)}
            </div>
          </div>
          <div className="pb-1 text-lg text-[color:var(--color-fg-dim)]">→</div>
          <div className="flex flex-col items-end gap-0.5">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
              {t("preview.avgReturn")}
            </div>
            <div
              className={`text-[22px] font-bold leading-none tabular-nums ${
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
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[color:var(--color-border)] pt-2 text-[11px] text-[color:var(--color-fg-muted)]">
          <span>{itmLine}</span>
          <span className="tabular-nums text-[color:var(--color-fg-dim)]">
            {t("preview.sigmaLabel")} {moneyFmt(stats.payoutStd)}
          </span>
        </div>
      </div>

      {/* Hero: top-heaviness — the point of the whole widget */}
      <div className="rounded-md border border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/5 p-3">
        <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-[color:var(--color-accent)]">
          {t("preview.heroTitle")}
        </div>
        <div className="text-[12px] leading-snug text-[color:var(--color-fg)]">
          {heroBody}
        </div>
        {halfMassLine && (
          <div className="mt-1.5 rounded-sm border border-[color:var(--color-accent)]/30 bg-[color:var(--color-accent)]/10 px-2 py-1 text-[11px] leading-snug text-[color:var(--color-fg)]">
            {halfMassLine}
          </div>
        )}
        <div className="mt-1.5 text-[10px] leading-snug text-[color:var(--color-fg-dim)]">
          {t("preview.heroTagline")}
        </div>
      </div>

      {/* Tier-by-tier breakdown: shared grid template for header + rows */}
      <div className="flex flex-col gap-1.5">
        <div className="grid grid-cols-[10px_minmax(0,1fr)_minmax(48px,1.25fr)_2.75rem_2.75rem] items-center gap-x-2 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
          <span />
          <span>{t("preview.evBreakdown")}</span>
          <span />
          <span className="text-right tabular-nums">{t("preview.colEv")}</span>
          <span className="text-right tabular-nums">{t("preview.colField")}</span>
        </div>
        <div className="flex flex-col divide-y divide-[color:var(--color-border)]/60">
          {stats.tiers.map((tier) => {
            const evShare = tier.ev / evTotal;
            const fieldShare = tier.field;
            if (evShare <= 0.0005 && fieldShare <= 0.0005) return null;
            return (
              <div
                key={tier.key}
                className="grid grid-cols-[10px_minmax(0,1fr)_minmax(48px,1.25fr)_2.75rem_2.75rem] items-center gap-x-2 py-1.5 text-[11px]"
              >
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ background: tier.color }}
                />
                <span className="text-[color:var(--color-fg)]">
                  {t(tier.labelKey)}
                </span>
                <div className="relative h-2 overflow-hidden rounded-sm bg-[color:var(--color-bg-elev-2)]">
                  {/* Field share — background pill */}
                  <div
                    className="absolute inset-y-0 left-0 rounded-sm"
                    style={{
                      width: `${fieldShare * 100}%`,
                      background: tier.color,
                      opacity: 0.3,
                    }}
                  />
                  {/* EV share — solid foreground */}
                  <div
                    className="absolute inset-y-0 left-0 rounded-sm"
                    style={{
                      width: `${evShare * 100}%`,
                      background: tier.color,
                    }}
                  />
                </div>
                <span className="text-right font-mono tabular-nums text-[color:var(--color-fg)]">
                  {pct(evShare)}
                </span>
                <span className="text-right font-mono tabular-nums text-[color:var(--color-fg-dim)]">
                  {pct(fieldShare)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {advanced && onRowChange && (
        <ShapeControls row={row} stats={stats} onRowChange={onRowChange} />
      )}
    </div>
  );
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
          className="w-20 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-1.5 py-0.5 text-right text-[11px] tabular-nums text-[color:var(--color-fg)] outline-none focus:border-[color:var(--color-accent)]"
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
                    className="w-16 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-1.5 py-0.5 text-right font-mono text-[11px] tabular-nums text-[color:var(--color-fg)] outline-none focus:border-[color:var(--color-accent)]"
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

interface RowStats {
  alpha: number;
  cost: number;
  itm: number;
  evPerEntry: number;
  payoutStd: number;
  cv: number;
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
  /** Number of paid places (= payouts that are > 0). */
  paidCount: number;
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

  const bountyFraction = Math.max(0, Math.min(0.9, row.bountyFraction ?? 0));
  const bountyPerSeat = row.buyIn * bountyFraction;
  const bountyLift = Math.max(0.1, Math.min(3, 1 + row.roi));
  const bountyMean = bountyPerSeat * bountyLift;
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

  const bountyByPlace = new Float64Array(N);
  if (bountyMean > 0 && N >= 2) {
    const Hprefix = new Float64Array(N);
    let hAcc = 0;
    for (let k = 1; k < N; k++) {
      hAcc += 1 / k;
      Hprefix[k] = hAcc;
    }
    const totalH = Hprefix[N - 1];
    const raw = new Float64Array(N);

    {
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
      void totalH;
    }

    let Z = 0;
    for (let i = 0; i < N; i++) Z += pmf[i] * raw[i];
    if (Z > 1e-12) {
      const scale = bountyMean / Z;
      for (let i = 0; i < N; i++) bountyByPlace[i] = raw[i] * scale;
    }
  }

  const totalByPlace = new Float64Array(N);
  let totalEv = 0;
  let totalEv2 = 0;
  for (let i = 0; i < N; i++) {
    totalByPlace[i] = prizeByPlace[i] + bountyByPlace[i];
    totalEv += pmf[i] * totalByPlace[i];
    totalEv2 += pmf[i] * totalByPlace[i] * totalByPlace[i];
  }
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
  // High-field granularity: show top 0.1% / 0.5% / 1% / 5% / 10%; low-field
  // collapses to just top 1% / top 10% (original layout).
  const highField = N >= 300;
  const veryHighField = N >= 1000;
  if (veryHighField) {
    cuts.push({
      key: "top01",
      labelKey: "preview.tierTop01",
      color: "#fb923c",
      hi: Math.ceil(N * 0.001),
    });
  }
  if (highField) {
    cuts.push({
      key: "top05",
      labelKey: "preview.tierTop05",
      color: "#f97316",
      hi: Math.ceil(N * 0.005),
    });
  }
  cuts.push({
    key: "top1",
    labelKey: "preview.tierTop1",
    color: "#ea580c",
    hi: Math.ceil(N * 0.01),
  });
  if (highField) {
    cuts.push({
      key: "top5",
      labelKey: "preview.tierTop5",
      color: "#c026d3",
      hi: Math.ceil(N * 0.05),
    });
  }
  cuts.push({
    key: "top10",
    labelKey: "preview.tierTop10",
    color: "#a855f7",
    hi: Math.ceil(N * 0.1),
  });
  if (highField && ftEnd > 0 && ftEnd < Math.ceil(N * 0.1)) {
    // Rare edge case: FT sits inside top10. Skip adding as a separate row
    // to keep tiers strictly non-overlapping; final-table stats stay
    // available via ftField/ftEvShare for the hero line.
  }
  cuts.push({
    key: "restItm",
    labelKey: "preview.tierRestItm",
    color: "#64748b",
    hi: paidCount,
  });
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
    let fTier = 0;
    for (let i = prevHi; i < hi; i++) {
      evTier += evByPlace[i];
      fTier += pmf[i];
    }
    tiers.push({
      key: c.key,
      labelKey: c.labelKey,
      color: c.color,
      ev: evTier,
      field: fTier,
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

  return {
    alpha,
    cost: entryCost,
    itm,
    evPerEntry: totalEv,
    payoutStd,
    cv,
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
    paidCount,
  };
}
