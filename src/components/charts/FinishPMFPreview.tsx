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

interface TierSpec {
  key: string;
  labelKey:
    | "preview.tierWinner"
    | "preview.tierTop1"
    | "preview.tierTop10"
    | "preview.tierRestItm"
    | "preview.tierOotm";
  color: string;
}

const TIERS: TierSpec[] = [
  { key: "winner", labelKey: "preview.tierWinner", color: "#ffde51" },
  { key: "top1", labelKey: "preview.tierTop1", color: "#f97316" },
  { key: "top10", labelKey: "preview.tierTop10", color: "#a855f7" },
  { key: "restItm", labelKey: "preview.tierRestItm", color: "#64748b" },
  { key: "ootm", labelKey: "preview.tierOotm", color: "#1f2937" },
];

export function FinishPMFPreview({ row, model, onRowChange }: Props) {
  const t = useT();
  const { advanced } = useAdvancedMode();

  const stats = useMemo(() => computeRowStats(row, model), [row, model]);

  const evTiers = [
    stats.evWinner,
    stats.evTop1,
    stats.evTop10,
    stats.evRestItm,
    stats.evOotm,
  ];
  const evTotal = evTiers.reduce((a, b) => a + b, 0) || 1;

  const evShares = evTiers.map((v) => v / evTotal);
  const fieldShares = [
    stats.fieldWinner,
    stats.fieldTop1,
    stats.fieldTop10,
    stats.fieldRestItm,
    stats.fieldOotm,
  ];

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

  // Top-heaviness hero: share of EV that lives in places 1..cutTop1
  // (i.e. winner + top-1% tier) and how often such a finish lands.
  const topShare = stats.evWinner + stats.evTop1;
  const topField = stats.fieldWinner + stats.fieldTop1;
  const topEvShareFrac = evTotal > 0 ? topShare / evTotal : 0;
  const topOdds = topField > 0 ? Math.max(1, Math.round(1 / topField)) : 0;
  const heroBodyKey =
    stats.topPlaces <= 1 ? "preview.heroBodyTop1" : "preview.heroBodyTopN";
  const heroBody = t(heroBodyKey)
    .replace("{share}", pct(topEvShareFrac))
    .replace("{n}", String(stats.topPlaces))
    .replace("{odds}", topOdds > 0 ? String(topOdds) : "∞");

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
          {TIERS.map((tier, i) => {
            const evShare = evShares[i];
            const fieldShare = fieldShares[i];
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
            const v = parseFloat(raw);
            onRowChange({
              itmRate: Number.isFinite(v) ? Math.max(0, Math.min(1, v / 100)) : undefined,
            });
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
                      const v = parseFloat(raw);
                      if (!Number.isFinite(v)) return;
                      patchBuckets({
                        [bucket.key]: Math.max(0, Math.min(1, v / 100)),
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
  evWinner: number;
  evTop1: number;
  evTop10: number;
  evRestItm: number;
  evOotm: number;
  fieldWinner: number;
  fieldTop1: number;
  fieldTop10: number;
  fieldRestItm: number;
  fieldOotm: number;
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

  const cutTop1 = Math.max(1, Math.ceil(N * 0.01));
  const cutTop10 = Math.max(cutTop1, Math.ceil(N * 0.1));
  const cutItm = Math.max(cutTop10, paidCount);

  let evWinner = 0;
  let evTop1 = 0;
  let evTop10 = 0;
  let evRestItm = 0;
  let evOotm = 0;
  let fWinner = 0;
  let fTop1 = 0;
  let fTop10 = 0;
  let fRestItm = 0;
  let fOotm = 0;
  for (let i = 0; i < N; i++) {
    const place = i + 1;
    const ev = pmf[i] * totalByPlace[i];
    const f = pmf[i];
    if (place === 1) {
      evWinner += ev;
      fWinner += f;
    } else if (place <= cutTop1) {
      evTop1 += ev;
      fTop1 += f;
    } else if (place <= cutTop10) {
      evTop10 += ev;
      fTop10 += f;
    } else if (place <= cutItm) {
      evRestItm += ev;
      fRestItm += f;
    } else {
      evOotm += ev;
      fOotm += f;
    }
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
  let shellP1 = pmf[0] ?? 0;
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
    topPlaces: cutTop1,
    evWinner,
    evTop1,
    evTop10,
    evRestItm,
    evOotm,
    fieldWinner: fWinner,
    fieldTop1: fTop1,
    fieldTop10: fTop10,
    fieldRestItm: fRestItm,
    fieldOotm: fOotm,
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
