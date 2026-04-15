"use client";

import { useMemo, useState } from "react";
import { Card } from "./ui/Section";
import { getPayoutTable } from "@/lib/sim/payouts";
import type { TournamentRow } from "@/lib/sim/types";
import { useT } from "@/lib/i18n/LocaleProvider";

interface Props {
  schedule: TournamentRow[];
}

const TOP_ROWS = 9;

function formatPct(v: number): string {
  if (v >= 0.01) return `${(v * 100).toFixed(1)}%`;
  if (v >= 0.0001) return `${(v * 100).toFixed(2)}%`;
  return `${(v * 100).toFixed(3)}%`;
}

function placeLabel(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

export function PayoutStructureCard({ schedule }: Props) {
  const t = useT();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const row = useMemo(
    () => schedule.find((r) => r.id === selectedId) ?? schedule[0] ?? null,
    [schedule, selectedId],
  );

  const table = useMemo(() => {
    if (!row) return null;
    try {
      return getPayoutTable(row.payoutStructure, row.players, row.customPayouts);
    } catch {
      return null;
    }
  }, [row]);

  if (!row || !table || table.length === 0) return null;

  const paid = table.length;
  const max = table[0];
  const topLen = Math.min(TOP_ROWS, paid);
  const tail = paid > topLen ? table.slice(topLen) : [];
  const tailSum = tail.reduce((a, b) => a + b, 0);
  const tailMin = tail.length ? tail[tail.length - 1] : 0;
  const tailMax = tail.length ? tail[0] : 0;
  const totalPaidPct = paid / row.players;

  // Min-cash in buy-in units: fraction × players = min cash per buy-in
  const minCashBuyIns = (table[paid - 1] * row.players).toFixed(2);

  return (
    <Card className="flex h-full flex-col p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <div className="text-sm font-semibold text-[color:var(--color-fg)]">
            {t("payouts.title")}
          </div>
          <div className="text-[11px] text-[color:var(--color-fg-dim)]">
            {t("payouts.subtitle")
              .replace("{paid}", paid.toLocaleString())
              .replace("{total}", row.players.toLocaleString())
              .replace("{pct}", (totalPaidPct * 100).toFixed(1))
              .replace("{min}", minCashBuyIns)}
          </div>
        </div>
        {schedule.length > 1 && (
          <select
            value={row.id}
            onChange={(e) => setSelectedId(e.target.value)}
            className="max-w-[180px] border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-2 py-1 text-[11px] text-[color:var(--color-fg)] focus:border-[color:var(--color-accent)] focus:outline-none"
            title={t("payouts.rowPicker")}
          >
            {schedule.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label || r.id}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {table.slice(0, topLen).map((v, i) => (
          <PayoutBar key={i} place={placeLabel(i + 1)} value={v} max={max} />
        ))}
        {tail.length > 0 && (
          <PayoutBar
            place={`${topLen + 1}–${paid}`}
            value={(tailSum / tail.length)}
            max={max}
            muted
            suffix={
              tailMax === tailMin
                ? ` · ${formatPct(tailMin)} each`
                : ` · ${formatPct(tailMin)}–${formatPct(tailMax)}`
            }
          />
        )}
      </div>
    </Card>
  );
}

function PayoutBar({
  place,
  value,
  max,
  muted,
  suffix,
}: {
  place: string;
  value: number;
  max: number;
  muted?: boolean;
  suffix?: string;
}) {
  const pct = max > 0 ? Math.max(0.02, value / max) : 0;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <div
        className={`w-14 shrink-0 text-right font-mono tabular-nums ${
          muted ? "text-[color:var(--color-fg-dim)]" : "text-[color:var(--color-fg-muted)]"
        }`}
      >
        {place}
      </div>
      <div className="relative h-3 flex-1 overflow-hidden rounded-sm bg-[color:var(--color-bg)]">
        <div
          className={`absolute inset-y-0 left-0 ${
            muted
              ? "bg-[color:var(--color-accent)]/35"
              : "bg-[color:var(--color-accent)]"
          }`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      <div
        className={`w-28 shrink-0 text-right font-mono tabular-nums ${
          muted ? "text-[color:var(--color-fg-dim)]" : "text-[color:var(--color-fg)]"
        }`}
      >
        {formatPct(value)}
        {suffix && (
          <span className="text-[color:var(--color-fg-dim)]">{suffix}</span>
        )}
      </div>
    </div>
  );
}
