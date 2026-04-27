"use client";

import type { ReactNode } from "react";
import { useT } from "@/lib/i18n/LocaleProvider";
import { InfoTooltip } from "@/components/ui/Tooltip";

type StatSuit = "club" | "heart" | "spade" | "diamond";

const SUIT_COLOR: Record<StatSuit, string> = {
  club: "var(--color-club)",
  heart: "var(--color-heart)",
  spade: "var(--color-spade)",
  diamond: "var(--color-diamond)",
};

const SUIT_GLYPH: Record<StatSuit, string> = {
  club: "♣",
  heart: "♥",
  spade: "♠",
  diamond: "♦",
};

const BIG_STAT_PANEL_CHROME =
  "max-w-full rounded-md border bg-[color:var(--color-bg)]/55 px-3 py-2.5";
const BIG_STAT_PANEL_TITLE =
  "text-[12px] font-medium tracking-[0.01em] text-[color:var(--color-fg-muted)]";
const BIG_STAT_PANEL_VALUE =
  "mt-0.5 whitespace-normal break-words font-mono text-[15px] font-semibold leading-[1.05] tabular-nums text-[color:var(--color-fg)] sm:text-[16px]";
const BIG_STAT_PANEL_CAPTION =
  "text-[11px] font-medium tracking-[0.01em] text-[color:var(--color-fg-muted)]";
const MINI_STAT_CHROME =
  "flex h-full flex-col items-center rounded-md border border-l-2 border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)]/55 px-3 py-3 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]";
const MINI_STAT_TITLE =
  "flex min-w-0 items-center justify-center gap-1 text-[14px] font-semibold leading-[1.15] tracking-[0.01em] sm:text-[15px]";
const MINI_STAT_VALUE =
  "font-display whitespace-normal break-words text-[22px] font-bold leading-[1.05] tabular-nums sm:text-[26px]";
const MINI_STAT_DETAIL =
  "mt-1 text-[11px] font-medium leading-snug text-[color:var(--color-fg-dim)]";

interface RangeSublineProps {
  label: string;
  fromLabel: string;
  toLabel: string;
  pointLabel: string;
  pointHint: string;
  minValue: string;
  maxValue: string;
  anchorRatio: number;
  accentColor?: string;
}

interface OutcomeSublineProps {
  label: string;
  leftLabel: string;
  rightLabel: string;
  leftValue: string;
  rightValue: string;
  ratio: number;
  accentColor?: string;
}

interface BigStatProps {
  label: string;
  value: string;
  sub?: string;
  rangeSubline?: Omit<RangeSublineProps, "accentColor">;
  outcomeSubline?: Omit<OutcomeSublineProps, "accentColor">;
  tone?: "pos" | "neg";
  tip?: string;
  suit?: StatSuit;
  pdValue?: string;
  pdDelta?: number | null;
  emphasizeTail?: boolean;
  pdLabel?: string;
}

interface MiniStatProps {
  label: string;
  value: string;
  detail?: string;
  tone?: "pos" | "neg";
  suit?: StatSuit;
  tip?: string;
  pdValue?: string;
  pdDelta?: number | null;
  emphasizeTail?: boolean;
  pdLabel?: string;
}

export function BigStat({
  label,
  value,
  sub,
  rangeSubline,
  outcomeSubline,
  tone,
  tip,
  suit = "club",
  pdValue,
  pdDelta,
  emphasizeTail,
  pdLabel,
}: BigStatProps) {
  const accentColor = SUIT_COLOR[suit];
  const toneColor =
    tone === "pos"
      ? "var(--color-success)"
      : tone === "neg"
        ? "var(--color-danger)"
        : accentColor;
  const titleColor = `color-mix(in srgb, ${accentColor} 72%, var(--color-fg) 28%)`;

  return (
    <div className="relative flex h-full flex-col gap-1.5 overflow-hidden rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)]/80 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
      <span
        className="absolute left-0 top-0 h-full w-[3px]"
        style={{ background: accentColor }}
      />
      <span
        className="absolute right-2 top-2 text-sm opacity-35"
        style={{ color: accentColor }}
      >
        {SUIT_GLYPH[suit]}
      </span>
      <div
        className="flex items-center gap-1.5 text-[15px] font-semibold leading-[1.15] tracking-[0.01em] sm:text-[16px]"
        style={{ color: titleColor }}
      >
        {label}
        {tip && <InfoTooltip content={tip} />}
      </div>
      <div
        className="font-display text-[30px] font-bold leading-none tabular-nums sm:text-[36px]"
        style={{ color: toneColor }}
      >
        {value}
      </div>
      {rangeSubline ? (
        <RangeSubline {...rangeSubline} accentColor={accentColor} />
      ) : outcomeSubline ? (
        <>
          <OutcomeSubline {...outcomeSubline} accentColor={accentColor} />
          {sub && <StatSubline text={sub} accentColor={accentColor} />}
        </>
      ) : (
        sub && <StatSubline text={sub} accentColor={accentColor} />
      )}
      {pdValue != null && (
        <PdCompareRow
          pdValue={pdValue}
          delta={pdDelta ?? null}
          emphasizeTail={emphasizeTail}
          pdLabel={pdLabel}
        />
      )}
    </div>
  );
}

function RangeSubline({
  label,
  fromLabel,
  toLabel,
  pointLabel,
  pointHint,
  minValue,
  maxValue,
  anchorRatio,
  accentColor,
}: RangeSublineProps) {
  const clampedRatio = Number.isFinite(anchorRatio)
    ? Math.max(0, Math.min(1, anchorRatio))
    : 0.5;
  const frameBorder = accentColor
    ? `color-mix(in srgb, ${accentColor} 18%, var(--color-border))`
    : "color-mix(in srgb, var(--color-border) 88%, transparent)";
  const endpointBorder = accentColor
    ? `color-mix(in srgb, ${accentColor} 34%, var(--color-border))`
    : "var(--color-border)";
  const rangeRail = accentColor
    ? `linear-gradient(90deg,
        color-mix(in srgb, ${accentColor} 10%, transparent) 0%,
        color-mix(in srgb, ${accentColor} 45%, transparent) 50%,
        color-mix(in srgb, ${accentColor} 10%, transparent) 100%)`
    : "linear-gradient(90deg, transparent 0%, var(--color-fg-dim) 50%, transparent 100%)";

  return (
    <div
      className={`${BIG_STAT_PANEL_CHROME} flex min-h-[11.25rem] flex-col`}
      style={{ borderColor: frameBorder }}
    >
      <div className="flex min-h-[1.85rem] items-start justify-between gap-3">
        <div className={`${BIG_STAT_PANEL_TITLE} capitalize`}>
          {label}
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-[0.02em]"
            style={{
              color: accentColor ?? "var(--color-fg-muted)",
              borderColor: accentColor
                ? `color-mix(in srgb, ${accentColor} 34%, var(--color-border))`
                : "var(--color-border)",
              backgroundColor: accentColor
                ? `color-mix(in srgb, ${accentColor} 10%, transparent)`
                : "rgba(255,255,255,0.02)",
            }}
          >
            {pointLabel}
          </div>
          <InfoTooltip content={pointHint} />
        </div>
      </div>
      <div className="relative mt-2.5 h-5 px-1">
        <div className="absolute inset-x-1 top-1/2 h-px -translate-y-1/2 rounded-full bg-[color:var(--color-border)]/70" />
        <div
          className="absolute inset-x-1 top-1/2 h-[3px] -translate-y-1/2 rounded-full opacity-90"
          style={{ background: rangeRail }}
        />
        <span
          className="absolute left-0 top-1/2 size-2.5 -translate-y-1/2 rounded-full border bg-[color:var(--color-bg-elev)] shadow-[0_0_0_2px_rgba(0,0,0,0.16)]"
          style={{ borderColor: endpointBorder }}
        />
        <span
          className="absolute right-0 top-1/2 size-2.5 -translate-y-1/2 rounded-full border bg-[color:var(--color-bg-elev)] shadow-[0_0_0_2px_rgba(0,0,0,0.16)]"
          style={{ borderColor: endpointBorder }}
        />
        <span
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-[color:var(--color-bg-elev)]"
          style={{
            left: `${clampedRatio * 100}%`,
            borderColor: accentColor ?? "var(--color-fg-muted)",
            boxShadow: accentColor
              ? `0 0 0 3px color-mix(in srgb, ${accentColor} 12%, transparent)`
              : "0 0 0 3px rgba(255,255,255,0.06)",
          }}
        />
      </div>
      <div className="mt-auto grid grid-cols-2 items-end gap-4 pt-2.5">
        <div className="min-w-0">
          <div className={BIG_STAT_PANEL_CAPTION}>
            {fromLabel}
          </div>
          <div className={BIG_STAT_PANEL_VALUE}>
            {minValue}
          </div>
        </div>
        <div className="min-w-0 text-right">
          <div className={BIG_STAT_PANEL_CAPTION}>
            {toLabel}
          </div>
          <div className={BIG_STAT_PANEL_VALUE}>
            {maxValue}
          </div>
        </div>
      </div>
    </div>
  );
}

function OutcomeSubline({
  label,
  leftLabel,
  rightLabel,
  leftValue,
  rightValue,
  ratio,
  accentColor,
}: OutcomeSublineProps) {
  const clampedRatio = Number.isFinite(ratio)
    ? Math.max(0, Math.min(1, ratio))
    : 0.5;
  const frameBorder = accentColor
    ? `color-mix(in srgb, ${accentColor} 18%, var(--color-border))`
    : "color-mix(in srgb, var(--color-border) 88%, transparent)";

  return (
    <div
      className={`${BIG_STAT_PANEL_CHROME} flex min-h-[11.25rem] flex-col`}
      style={{ borderColor: frameBorder }}
    >
      <div className="flex min-h-[1.85rem] items-start justify-between gap-3">
        <div className={`${BIG_STAT_PANEL_TITLE} capitalize`}>{label}</div>
        <span
          aria-hidden="true"
          className="invisible h-[1.6rem] w-[6.25rem] shrink-0 rounded-full border"
        />
      </div>
      <div className="mt-2.5">
        <div className="relative h-2.5 overflow-hidden rounded-full bg-[color:var(--color-border)]/40">
          <div
            className="absolute inset-y-0 left-0 rounded-l-full"
            style={{
              width: `${(1 - clampedRatio) * 100}%`,
              background:
                "linear-gradient(90deg, rgba(248,113,113,0.52) 0%, rgba(248,113,113,0.2) 100%)",
            }}
          />
          <div
            className="absolute inset-y-0 right-0 rounded-r-full"
            style={{
              width: `${clampedRatio * 100}%`,
              background:
                "linear-gradient(90deg, rgba(74,222,128,0.3) 0%, rgba(74,222,128,0.72) 100%)",
            }}
          />
          <span
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-[color:var(--color-bg-elev)]"
            style={{
              left: `${clampedRatio * 100}%`,
              borderColor: accentColor ?? "var(--color-fg-muted)",
              boxShadow: accentColor
                ? `0 0 0 3px color-mix(in srgb, ${accentColor} 10%, transparent)`
                : "0 0 0 3px rgba(255,255,255,0.06)",
            }}
          />
        </div>
      </div>
      <div className="mt-auto grid grid-cols-2 items-end gap-4 pt-2.5">
        <div className="min-w-0">
          <div className={BIG_STAT_PANEL_CAPTION}>
            {leftLabel}
          </div>
          <div className={`${BIG_STAT_PANEL_VALUE} text-[color:var(--color-danger)]`}>
            {leftValue}
          </div>
        </div>
        <div className="min-w-0 text-right">
          <div className={BIG_STAT_PANEL_CAPTION}>
            {rightLabel}
          </div>
          <div className={`${BIG_STAT_PANEL_VALUE} text-[color:var(--color-success)]`}>
            {rightValue}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatSubline({
  text,
  accentColor,
}: {
  text: string;
  accentColor?: string;
}) {
  const colonIdx = text.indexOf(":");
  const hasStructuredRange = colonIdx > 0 && text.includes("→");
  if (hasStructuredRange) {
    const label = text.slice(0, colonIdx).trim();
    const value = text.slice(colonIdx + 1).trim();
    const [rawMin, rawMax] = value.split("→");
    const minValue = rawMin?.trim() ?? "";
    const maxValue = rawMax?.trim() ?? "";
    const frameBorder = accentColor
      ? `color-mix(in srgb, ${accentColor} 18%, var(--color-border))`
      : "color-mix(in srgb, var(--color-border) 88%, transparent)";
    const endpointBorder = accentColor
      ? `color-mix(in srgb, ${accentColor} 42%, var(--color-border))`
      : "var(--color-border)";
    const rangeRail = accentColor
      ? `linear-gradient(90deg,
          color-mix(in srgb, ${accentColor} 14%, transparent) 0%,
          color-mix(in srgb, ${accentColor} 62%, white 3%) 50%,
          color-mix(in srgb, ${accentColor} 14%, transparent) 100%)`
      : "linear-gradient(90deg, transparent 0%, var(--color-fg-dim) 50%, transparent 100%)";

    return (
      <div
        className="max-w-full rounded-md border bg-[color:var(--color-bg)]/55 px-3 py-2.5"
        style={{ borderColor: frameBorder }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] font-medium capitalize tracking-[0.01em] text-[color:var(--color-fg-muted)]">
            {label}
          </div>
          <div
            className="text-[11px] leading-none"
            style={{
              color: accentColor
                ? `color-mix(in srgb, ${accentColor} 72%, var(--color-fg-muted))`
                : "var(--color-fg-muted)",
            }}
          >
            ↔
          </div>
        </div>
        <div className="mt-2.5">
          <div className="relative h-4">
            <div className="absolute inset-x-1 top-1/2 h-px -translate-y-1/2 rounded-full bg-[color:var(--color-border)]/70" />
            <div
              className="absolute inset-x-1 top-1/2 h-[3px] -translate-y-1/2 rounded-full opacity-90"
              style={{ background: rangeRail }}
            />
            <span
              className="absolute left-0 top-1/2 size-2 -translate-y-1/2 rounded-full border bg-[color:var(--color-bg-elev)] shadow-[0_0_0_2px_rgba(0,0,0,0.16)]"
              style={{ borderColor: endpointBorder }}
            />
            <span
              className="absolute right-0 top-1/2 size-2 -translate-y-1/2 rounded-full border bg-[color:var(--color-bg-elev)] shadow-[0_0_0_2px_rgba(0,0,0,0.16)]"
              style={{ borderColor: endpointBorder }}
            />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-medium tracking-[0.01em] text-[color:var(--color-fg-muted)]">
                От
              </div>
              <div className="mt-1 truncate font-mono text-[13px] font-semibold leading-none tabular-nums text-[color:var(--color-fg)]">
                {minValue}
              </div>
            </div>
            <div className="min-w-0 text-right">
              <div className="text-[10px] font-medium tracking-[0.01em] text-[color:var(--color-fg-muted)]">
                До
              </div>
              <div className="mt-1 truncate font-mono text-[13px] font-semibold leading-none tabular-nums text-[color:var(--color-fg)]">
                {maxValue}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="text-[11px] leading-snug text-[color:var(--color-fg-dim)]">
      {text}
    </div>
  );
}

export function MiniStat({
  label,
  value,
  detail,
  tone,
  suit = "club",
  tip,
  pdValue,
  pdDelta,
  emphasizeTail,
  pdLabel,
}: MiniStatProps) {
  const accentColor = SUIT_COLOR[suit];
  const toneColor =
    tone === "pos"
      ? "var(--color-success)"
      : tone === "neg"
        ? "var(--color-danger)"
        : "var(--color-fg)";
  const titleColor = `color-mix(in srgb, ${accentColor} 68%, var(--color-fg) 32%)`;

  return (
    <div
      className={MINI_STAT_CHROME}
      style={{ borderLeftColor: accentColor }}
    >
      <div
        className={`${MINI_STAT_TITLE} min-h-[1.6rem]`}
        style={{ color: titleColor }}
      >
        {label}
        {tip && <InfoTooltip content={tip} />}
      </div>
      <div className="mt-1.5 flex min-h-[2.9rem] flex-col justify-end">
        <div className={MINI_STAT_VALUE} style={{ color: toneColor }}>
          {value}
        </div>
        {detail && <div className={MINI_STAT_DETAIL}>{detail}</div>}
      </div>
      {pdValue != null && (
        <div className="mt-auto pt-2">
          <PdCompareRow
            pdValue={pdValue}
            delta={pdDelta ?? null}
            emphasizeTail={emphasizeTail}
            pdLabel={pdLabel}
            flush
          />
        </div>
      )}
    </div>
  );
}

function pdBadgeSeverity(
  delta: number | null,
  emphasizeTail: boolean | undefined,
): "none" | "mild" | "strong" {
  if (delta == null) return "none";
  const abs = Math.abs(delta);
  const midT = emphasizeTail ? 0.05 : 0.1;
  const hiT = emphasizeTail ? 0.12 : 0.25;
  if (abs >= hiT) return "strong";
  if (abs >= midT) return "mild";
  return "none";
}

function PdCompareRow({
  pdValue,
  delta,
  emphasizeTail,
  pdLabel,
  flush,
}: {
  pdValue: string;
  delta: number | null;
  emphasizeTail?: boolean;
  pdLabel?: string;
  flush?: boolean;
}) {
  const t = useT();
  const sev = pdBadgeSeverity(delta, emphasizeTail);
  const label = pdLabel ?? "PD";
  const matchThreshold = emphasizeTail ? 0.02 : 0.03;
  const matches =
    delta != null && Number.isFinite(delta) && Math.abs(delta) <= matchThreshold;

  if (matches) {
    const precisionPct = Math.max(1, Math.round(Math.abs(delta) * 100));
    return (
      <div
        className={`${flush ? "" : "mt-1.5 "}flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]`}
        style={{
          borderColor: "rgba(232,121,249,0.18)",
          backgroundColor: "rgba(255,255,255,0.015)",
        }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="rounded-sm px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.16em]"
            style={{
              color: "#f0abfc",
              backgroundColor: "rgba(232,121,249,0.14)",
            }}
          >
            {label}
          </span>
          <span className="truncate text-[color:var(--color-fg-dim)]">
            {t("pd.match")}
          </span>
        </div>
        <span
          className="shrink-0 rounded-sm border px-1.5 py-0.5 font-mono font-semibold tabular-nums"
          style={{
            color: "#f0abfc",
            borderColor: "rgba(232,121,249,0.32)",
            backgroundColor: "rgba(232,121,249,0.1)",
          }}
        >
          ±{precisionPct}%
        </span>
      </div>
    );
  }

  const arrow =
    delta == null
      ? ""
      : delta > 0.0005
        ? "▲"
        : delta < -0.0005
          ? "▼"
          : "≈";
  const pctStr =
    delta == null ? "" : `${arrow}${Math.round(Math.abs(delta) * 100)}%`;
  const deltaColor =
    sev === "strong"
      ? "var(--color-danger)"
      : sev === "mild"
        ? "var(--color-accent-strong)"
        : "rgba(232,121,249,0.75)";
  const deltaBorder =
    sev === "strong"
      ? "rgba(248,113,113,0.4)"
      : sev === "mild"
        ? "rgba(251,191,36,0.4)"
        : "rgba(232,121,249,0.35)";
  const deltaBg =
    sev === "strong"
      ? "rgba(248,113,113,0.12)"
      : sev === "mild"
        ? "rgba(251,191,36,0.12)"
        : "rgba(232,121,249,0.1)";

  return (
    <div
      className={`${flush ? "" : "mt-1.5 "}flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]`}
      style={{
        borderColor: "rgba(232,121,249,0.18)",
        backgroundColor: "rgba(255,255,255,0.015)",
      }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="rounded-sm px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.16em]"
          style={{
            color: "#f0abfc",
            backgroundColor: "rgba(232,121,249,0.14)",
          }}
        >
          {label}
        </span>
        <span className="truncate font-mono tabular-nums text-[color:var(--color-fg)]">
          {pdValue}
        </span>
      </div>
      {delta != null && (
        <span
          className="shrink-0 rounded-sm border px-1.5 py-0.5 font-mono font-semibold tabular-nums"
          style={{
            color: deltaColor,
            borderColor: deltaBorder,
            backgroundColor: deltaBg,
          }}
          aria-label={`delta vs PD ${pctStr}`}
        >
          {pctStr}
        </span>
      )}
    </div>
  );
}

export function StatGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-[color:var(--color-border)]" />
        <span className="font-display text-[14px] font-bold uppercase tracking-[0.2em] text-[color:var(--color-fg-muted)] sm:text-[15px]">
          {title}
        </span>
        <div className="h-px flex-1 bg-[color:var(--color-border)]" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(2,minmax(0,1fr))] md:grid-cols-[repeat(3,minmax(0,1fr))] xl:grid-cols-[repeat(4,minmax(0,1fr))] 2xl:grid-cols-[repeat(5,minmax(0,1fr))]">
        {children}
      </div>
    </div>
  );
}
