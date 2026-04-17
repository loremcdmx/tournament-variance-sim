"use client";

import { useEffect, useMemo, useState } from "react";

import { Card } from "./ui/Section";
import { getPayoutTable } from "@/lib/sim/payouts";
import type { TournamentRow } from "@/lib/sim/types";
import { useT } from "@/lib/i18n/LocaleProvider";

interface Props {
  schedule: TournamentRow[];
}

const TOP_ROWS = 9;

type PaletteId = "accent" | "medal" | "heat" | "ocean" | "mono";
const PALETTE_IDS: readonly PaletteId[] = ["accent", "medal", "heat", "ocean", "mono"] as const;
const PALETTE_STORAGE_KEY = "tvs.payoutPalette";

function paletteColor(id: PaletteId, place: number, paid: number, muted?: boolean): string {
  const alpha = muted ? 0.4 : 1;
  switch (id) {
    case "accent":
      return muted
        ? `color-mix(in srgb, var(--color-accent) 35%, transparent)`
        : `var(--color-accent)`;
    case "medal":
      if (place === 1) return muted ? "hsla(45, 90%, 55%, 0.4)" : "hsl(45, 90%, 55%)";
      if (place === 2) return muted ? "hsla(210, 15%, 75%, 0.4)" : "hsl(210, 15%, 75%)";
      if (place === 3) return muted ? "hsla(25, 70%, 50%, 0.4)" : "hsl(25, 70%, 50%)";
      return muted ? "hsla(220, 10%, 55%, 0.35)" : "hsl(220, 10%, 55%)";
    case "heat": {
      const t = paid > 1 ? (place - 1) / (paid - 1) : 0;
      const hue = 15 + t * 50;
      const light = 58 - t * 12;
      return `hsla(${hue}, 85%, ${light}%, ${alpha})`;
    }
    case "ocean": {
      const t = paid > 1 ? (place - 1) / (paid - 1) : 0;
      const hue = 185 + t * 60;
      const light = 60 - t * 15;
      return `hsla(${hue}, 70%, ${light}%, ${alpha})`;
    }
    case "mono": {
      const t = paid > 1 ? (place - 1) / (paid - 1) : 0;
      const light = 75 - t * 35;
      return `hsla(220, 8%, ${light}%, ${alpha})`;
    }
  }
}

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
  const [palette, setPalette] = useState<PaletteId>(() => {
    if (typeof window === "undefined") return "medal";
    try {
      const stored = localStorage.getItem(PALETTE_STORAGE_KEY);
      if (stored && (PALETTE_IDS as readonly string[]).includes(stored)) {
        return stored as PaletteId;
      }
    } catch {}
    return "medal";
  });

  useEffect(() => {
    try {
      localStorage.setItem(PALETTE_STORAGE_KEY, palette);
    } catch {}
  }, [palette]);

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
        <div className="flex items-center gap-2">
          <select
            value={palette}
            onChange={(e) => setPalette(e.target.value as PaletteId)}
            className="border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-2 py-1 text-[11px] text-[color:var(--color-fg)] focus:border-[color:var(--color-accent)] focus:outline-none"
            title={t("payouts.palette")}
          >
            {PALETTE_IDS.map((id) => (
              <option key={id} value={id}>
                {t(`payouts.palette.${id}` as const)}
              </option>
            ))}
          </select>
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
      </div>

      <div className="flex flex-col gap-1">
        {table.slice(0, topLen).map((v, i) => (
          <PayoutBar
            key={i}
            place={placeLabel(i + 1)}
            value={v}
            max={max}
            color={paletteColor(palette, i + 1, paid)}
          />
        ))}
        {tail.length > 0 && (
          <PayoutBar
            place={`${topLen + 1}–${paid}`}
            label={t("payouts.paidTail")}
            value={tailSum / tail.length}
            max={max}
            muted
            color={paletteColor(palette, Math.floor((topLen + 1 + paid) / 2), paid, true)}
            rangeText={
              tailMax === tailMin
                ? formatPct(tailMin)
                : `${formatPct(tailMin)}–${formatPct(tailMax)}`
            }
          />
        )}
        {row.players > paid && (
          <PayoutBar
            place={`${paid + 1}–${row.players}`}
            label={t("payouts.nonItm")}
            value={0}
            max={max}
            muted
            color="transparent"
            rangeText={t("payouts.nonItmShare").replace(
              "{pct}",
              (((row.players - paid) / row.players) * 100).toFixed(1),
            )}
          />
        )}
      </div>
    </Card>
  );
}

function PayoutBar({
  place,
  label,
  value,
  max,
  muted,
  rangeText,
  color,
}: {
  place: string;
  label?: string;
  value: number;
  max: number;
  muted?: boolean;
  rangeText?: string;
  color: string;
}) {
  const pct = max > 0 && value > 0 ? Math.max(0.02, value / max) : 0;
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
          className="absolute inset-y-0 left-0"
          style={{ width: `${pct * 100}%`, background: color }}
        />
        {label && (
          <div
            className="pointer-events-none absolute inset-y-0 flex items-center whitespace-nowrap px-1.5 text-[9px] uppercase tracking-wider text-[color:var(--color-fg-dim)]"
            style={{ left: `${Math.min(85, pct * 100)}%` }}
          >
            {label}
          </div>
        )}
      </div>
      <div
        className={`w-28 shrink-0 whitespace-nowrap text-right font-mono tabular-nums ${
          muted ? "text-[color:var(--color-fg-dim)]" : "text-[color:var(--color-fg)]"
        }`}
      >
        {rangeText ?? formatPct(value)}
      </div>
    </div>
  );
}
