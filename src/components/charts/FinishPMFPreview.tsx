"use client";

import { useMemo } from "react";
import { buildFinishPMF, calibrateAlpha } from "@/lib/sim/finishModel";
import { getPayoutTable } from "@/lib/sim/payouts";
import type { FinishModelConfig, TournamentRow } from "@/lib/sim/types";
import { useT } from "@/lib/i18n/LocaleProvider";

interface Props {
  row: TournamentRow;
  model: FinishModelConfig;
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

export function FinishPMFPreview({ row, model }: Props) {
  const t = useT();

  const stats = useMemo(() => computeRowStats(row, model), [row, model]);

  const evTiers = [
    stats.evWinner,
    stats.evTop1,
    stats.evTop10,
    stats.evRestItm,
    stats.evOotm,
  ];
  const evTotal = evTiers.reduce((a, b) => a + b, 0) || 1;

  // Share-of-EV and share-of-field per tier. OOTM gets a field-only bar under
  // the EV bar so you can see "x% of finishes bring 0 EV" side-by-side.
  const evShares = evTiers.map((v) => v / evTotal);
  const fieldShares = [
    stats.fieldWinner,
    stats.fieldTop1,
    stats.fieldTop10,
    stats.fieldRestItm,
    stats.fieldOotm,
  ];

  const moneyFmt = (v: number) =>
    v === 0
      ? "0"
      : Math.abs(v) < 10
      ? `$${v.toFixed(2)}`
      : `$${Math.round(v).toLocaleString()}`;

  const pct = (v: number) => `${(v * 100).toFixed(v < 0.001 ? 2 : 1)}%`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-fg)]">
          {row.label || t("row.unnamed")}
        </div>
        <div className="text-[10px] text-[color:var(--color-fg-dim)] tabular-nums">
          N={row.players} · buy-in {moneyFmt(stats.cost)} · α={stats.alpha.toFixed(2)}
        </div>
      </div>

      {/* Stat callouts — 4 key numbers that actually describe variance */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label={t("preview.statItm")}
          value={pct(stats.itm)}
          hint={`1 in ${stats.itm > 0 ? Math.round(1 / stats.itm) : "∞"}`}
        />
        <Stat
          label={t("preview.statTop1")}
          value={pct(stats.top1EvShare)}
          hint={t("preview.statTop1Hint")}
          accent
        />
        <Stat
          label={t("preview.statCv")}
          value={stats.cv.toFixed(1)}
          hint={t("preview.statCvHint")}
        />
        <Stat
          label={t("preview.statBounty")}
          value={stats.bountyShare > 0 ? pct(stats.bountyShare) : "—"}
          hint={
            stats.progressivePko
              ? t("preview.statBountyPko")
              : stats.bountyShare > 0
              ? t("preview.statBountyFlat")
              : t("preview.statBountyNone")
          }
        />
      </div>

      {/* Stacked bar: where your EV actually comes from */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
          <span>{t("preview.evBreakdown")}</span>
          <span className="tabular-nums text-[color:var(--color-fg-muted)]">
            EV/entry {moneyFmt(stats.evPerEntry)} · σ {moneyFmt(stats.payoutStd)}
          </span>
        </div>

        <div className="flex h-6 w-full overflow-hidden rounded-sm border border-[color:var(--color-border)]">
          {TIERS.map((tier, i) => {
            const share = evShares[i];
            if (share <= 0.0005) return null;
            return (
              <div
                key={tier.key}
                className="relative flex items-center justify-center"
                style={{ width: `${share * 100}%`, background: tier.color }}
                title={`${t(tier.labelKey)} · ${pct(share)} EV`}
              >
                {share > 0.08 && (
                  <span className="text-[9px] font-bold text-black/80 tabular-nums">
                    {Math.round(share * 100)}%
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Field-share bar — same tiers, but showing how rare each outcome is */}
        <div className="flex h-1.5 w-full overflow-hidden rounded-sm">
          {TIERS.map((tier, i) => {
            const share = fieldShares[i];
            if (share <= 0) return null;
            return (
              <div
                key={tier.key}
                style={{
                  width: `${share * 100}%`,
                  background: tier.color,
                  opacity: 0.35,
                }}
                title={`${t(tier.labelKey)} · ${pct(share)} of finishes`}
              />
            );
          })}
        </div>

        {/* Legend with per-tier EV contributions */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-[color:var(--color-fg-muted)] sm:grid-cols-5">
          {TIERS.map((tier, i) => (
            <div key={tier.key} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 flex-shrink-0"
                style={{ background: tier.color }}
              />
              <div className="flex min-w-0 flex-col leading-tight">
                <span className="truncate">{t(tier.labelKey)}</span>
                <span className="tabular-nums text-[color:var(--color-fg-dim)]">
                  {pct(evShares[i])} · {pct(fieldShares[i])}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="text-[10px] leading-relaxed text-[color:var(--color-fg-dim)]">
        {t("preview.footnote")}
      </div>
    </div>
  );
}

interface StatProps {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}

function Stat({ label, value, hint, accent }: StatProps) {
  return (
    <div className="flex flex-col gap-0.5 border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-3 py-2">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-dim)]">
        {label}
      </div>
      <div
        className={`text-[18px] font-bold leading-none tabular-nums ${
          accent
            ? "text-[color:var(--color-accent)]"
            : "text-[color:var(--color-fg)]"
        }`}
      >
        {value}
      </div>
      {hint && (
        <div className="text-[9px] leading-tight text-[color:var(--color-fg-dim)]">
          {hint}
        </div>
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
  top1EvShare: number;
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
  const alpha = calibrateAlpha(
    N,
    payouts,
    prizePool,
    entryCost,
    effectiveROI,
    model,
  );
  const pmf = buildFinishPMF(N, model, alpha);

  const prizeByPlace = new Float64Array(N);
  for (let i = 0; i < Math.min(payouts.length, N); i++) {
    prizeByPlace[i] = payouts[i] * prizePool;
  }

  // Bounty weights — same code path as engine.ts (flat or progressive PKO).
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

    if (row.progressiveKO) {
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
    } else {
      for (let i = 0; i < N; i++) raw[i] = totalH - Hprefix[i];
    }

    let Z = 0;
    for (let i = 0; i < N; i++) Z += pmf[i] * raw[i];
    if (Z > 1e-12) {
      const scale = bountyMean / Z;
      for (let i = 0; i < N; i++) bountyByPlace[i] = raw[i] * scale;
    }
  }

  // Per-place total payout, ITM cutoff, moments.
  const totalByPlace = new Float64Array(N);
  let totalEv = 0;
  let totalEv2 = 0;
  let paidCount = 0;
  for (let i = 0; i < N; i++) {
    totalByPlace[i] = prizeByPlace[i] + bountyByPlace[i];
    totalEv += pmf[i] * totalByPlace[i];
    totalEv2 += pmf[i] * totalByPlace[i] * totalByPlace[i];
    if (payouts[i] > 0 || bountyByPlace[i] > 0) paidCount++;
  }
  const payoutVar = Math.max(0, totalEv2 - totalEv * totalEv);
  const payoutStd = Math.sqrt(payoutVar);
  const cv = totalEv > 1e-9 ? payoutStd / totalEv : 0;

  // ITM = Σ pmf over places that cash (prize places only — bounty-only busts
  // are not "cashing" in the usual sense).
  let itm = 0;
  const paidMtt = payouts.reduce((n, p) => (p > 0 ? n + 1 : n), 0);
  for (let i = 0; i < paidMtt; i++) itm += pmf[i];

  // Tier boundaries. We bucket by finish place:
  //   winner = place 1
  //   top1 = places 2..ceil(N*0.01)
  //   top10 = places ..ceil(N*0.10)
  //   restItm = the rest of the cashing places
  //   ootm = everything else
  const cutTop1 = Math.max(1, Math.ceil(N * 0.01));
  const cutTop10 = Math.max(cutTop1, Math.ceil(N * 0.1));
  const cutItm = Math.max(cutTop10, paidMtt);

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

  const top1EvShare = totalEv > 1e-9 ? (evWinner + evTop1) / totalEv : 0;
  const bountyShareOfPayout =
    totalEv > 1e-9
      ? (() => {
          let bEv = 0;
          for (let i = 0; i < N; i++) bEv += pmf[i] * bountyByPlace[i];
          return bEv / totalEv;
        })()
      : 0;

  return {
    alpha,
    cost: entryCost,
    itm,
    evPerEntry: totalEv,
    payoutStd,
    cv,
    bountyShare: bountyShareOfPayout,
    progressivePko: !!row.progressiveKO && bountyFraction > 0,
    top1EvShare,
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
  };
}
