"use client";

import { useMemo } from "react";
import type { AlignedData, Options } from "uplot";
import { UplotChart } from "./UplotChart";
import { darkAxes } from "./common";
import { buildFinishPMF, calibrateAlpha } from "@/lib/sim/finishModel";
import { getPayoutTable } from "@/lib/sim/payouts";
import type { FinishModelConfig, TournamentRow } from "@/lib/sim/types";
import { useT } from "@/lib/i18n/LocaleProvider";

interface Props {
  row: TournamentRow;
  model: FinishModelConfig;
  height?: number;
}

export function FinishPMFPreview({ row, model, height = 200 }: Props) {
  const t = useT();
  const { data, alpha } = useMemo(() => {
    const N = Math.max(2, Math.floor(row.players));
    const payouts = getPayoutTable(row.payoutStructure, N, row.customPayouts);
    const pool = row.players * row.buyIn;
    const cost = row.buyIn * (1 + row.rake);
    const a = calibrateAlpha(N, payouts, pool, cost, row.roi, model);
    const pmf = buildFinishPMF(N, model, a);
    const xs = new Array<number>(N);
    for (let i = 0; i < N; i++) xs[i] = i + 1;
    const payoutLine = new Array<number>(N).fill(0);
    const paid = Math.min(payouts.length, N);
    // Normalize payout line to the same visual scale as pmf
    const maxP = Math.max(...pmf);
    const maxPayout = payouts[0] ?? 1;
    const scale = maxP / maxPayout;
    for (let i = 0; i < paid; i++) payoutLine[i] = payouts[i] * scale;
    return {
      data: [xs, Array.from(pmf), payoutLine] as unknown as AlignedData,
      alpha: a,
    };
  }, [row, model]);

  const opts = useMemo<Omit<Options, "width" | "height">>(
    () => ({
      scales: { x: { time: false } },
      axes: darkAxes,
      series: [
        {},
        { stroke: "#a5b4fc", width: 2, fill: "rgba(129,140,248,0.1)" },
        { stroke: "rgba(52,211,153,0.7)", width: 1.5, dash: [4, 4] },
      ],
      legend: { show: false },
    }),
    [],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-[color:var(--color-fg-dim)]">
        <span>{t("preview.pmfLabel")}</span>
        <span className="tabular-nums text-[color:var(--color-fg-muted)]">
          α = {alpha.toFixed(2)}
        </span>
      </div>
      <UplotChart data={data} options={opts} height={height} />
    </div>
  );
}
