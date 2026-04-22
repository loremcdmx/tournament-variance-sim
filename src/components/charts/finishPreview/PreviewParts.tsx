"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useT } from "@/lib/i18n/LocaleProvider";
import type { TierRow } from "@/lib/sim/previewRowStats";

export function PreviewHeroStat({
  label,
  value,
  footer,
  details,
  accent = false,
}: {
  label: string;
  value: string;
  footer?: ReactNode;
  details?: Array<{ label: string; value: string; tone?: "accent" | "default" }>;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex h-full min-h-[7.25rem] flex-col justify-between rounded-md border px-3 py-3 shadow-sm ${
        accent
          ? "border-[color:var(--color-accent)]/35 bg-[color:var(--color-accent)]/10"
          : "border-[color:var(--color-border)]/70 bg-[color:var(--color-bg)]/65"
      }`}
    >
      <div className="flex flex-col gap-2">
        <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[color:var(--color-fg-dim)]">
          {label}
        </div>
        <div className="font-mono text-[24px] font-bold leading-none tabular-nums text-[color:var(--color-fg)] sm:text-[26px]">
          {value}
        </div>
        {details && details.length > 0 && (
          <div
            className={`grid gap-1.5 pt-1 ${
              details.length >= 3 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2"
            }`}
          >
            {details.map((item) => (
              <div
                key={item.label}
                className={`rounded-md border px-2.5 py-2 ${
                  item.tone === "accent"
                    ? "border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/12"
                    : "border-[color:var(--color-border)]/70 bg-[color:var(--color-bg)]/60"
                }`}
              >
                <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-fg-dim)]">
                  {item.label}
                </div>
                <div
                  className={`pt-1 font-mono text-[14px] font-semibold leading-none tabular-nums ${
                    item.tone === "accent"
                      ? "text-[color:var(--color-accent)]"
                      : "text-[color:var(--color-fg)]"
                  }`}
                >
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mt-3 flex min-h-[2.5rem] items-end">
        {footer ?? <span className="block h-8" aria-hidden />}
      </div>
    </div>
  );
}

interface TierBreakdown {
  tier: TierRow;
  hasBounty: boolean;
  bountyColor: string;
  posRangeLabel: string;
}

export function EvBreakdownRow({
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
  fieldShare: number | null;
  eqShare: number | null;
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
  const [pinned, setPinned] = useState(false);
  const [canHover, setCanHover] = useState(false);
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
  const fmtWidth = (pct: number) => `${Math.min(100, Math.max(0, pct)).toFixed(4)}%`;
  const showPopup = !!breakdown && (canHover ? hover : pinned);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setCanHover(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return (
      <div className="relative">
      <div
        className={`relative grid ${EV_BREAKDOWN_GRID} ${EV_BREAKDOWN_GAP} items-center py-1.5 text-[10px] sm:text-[11px] hover:bg-[color:var(--color-bg-elev)]/30 ${
          breakdown ? "cursor-default sm:cursor-help" : ""
        }`}
        onMouseEnter={() => {
          if (canHover) setHover(true);
        }}
        onMouseLeave={() => {
          if (canHover) setHover(false);
        }}
        onClick={() => {
          if (!breakdown || canHover) return;
          setPinned((v) => !v);
        }}
        onKeyDown={(e) => {
          if (!breakdown || canHover) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setPinned((v) => !v);
          } else if (e.key === "Escape") {
            setPinned(false);
          }
        }}
        onBlur={(e) => {
          if (canHover || !breakdown) return;
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setPinned(false);
          }
        }}
        tabIndex={breakdown ? 0 : undefined}
        role={breakdown ? "button" : undefined}
        aria-expanded={breakdown ? showPopup : undefined}
      >
        <span
          className="h-2.5 w-2.5 rounded-sm"
          style={{ backgroundColor: color }}
        />
        <span className={`min-w-0 truncate ${labelClass}`}>{label}</span>
        <div className="relative h-2 overflow-hidden rounded-sm bg-[color:var(--color-bg-elev-2)]">
          <div
            className="absolute inset-y-0 left-0 rounded-sm opacity-30"
            style={{
              width: fmtWidth(
                (maxEvShare ? (eqShare ?? 0) / maxEvShare : (eqShare ?? 0)) * 100,
              ),
              backgroundColor: color,
            }}
          />
          <div
            className="absolute inset-y-0 left-0 rounded-sm"
            style={{
              width: fmtWidth(evWidthPct),
              backgroundColor: color,
            }}
          />
          {bountyWidthPct > 0.5 && bountyColor && (
            <div
              className="absolute inset-y-0 rounded-sm"
              style={{
                left: fmtWidth(evWidthPct - bountyWidthPct),
                width: fmtWidth(bountyWidthPct),
                backgroundColor: bountyColor,
              }}
            />
          )}
        </div>
        <span className={`${EV_BREAKDOWN_NUM} text-[color:var(--color-fg)]`}>
          {pct(evShare)}
        </span>
        <span className={`${EV_BREAKDOWN_NUM} text-[color:var(--color-fg-dim)]`}>
          {fieldShare == null ? "—" : pct(fieldShare)}
        </span>
        <span className={`${EV_BREAKDOWN_NUM} text-[color:var(--color-fg-dim)]`}>
          {eqShare == null ? "—" : fmtEq(eqShare)}
        </span>
        <span
          className={`${EV_BREAKDOWN_NUM} ${netClass}`}
        >
          {fmtSignedMoney(netDollars)}
        </span>
      </div>
      {showPopup && breakdown && (
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
  const [placement, setPlacement] = useState<"right" | "left" | "below" | null>(
    null,
  );
  const popupRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = popupRef.current;
    if (!el) return;

    const anchorRect = el.parentElement?.getBoundingClientRect();
    const popupWidth = el.getBoundingClientRect().width;
    if (!anchorRect || popupWidth <= 0) return;

    const edgePad = 8;
    const gap = 8;
    const rightSpace = window.innerWidth - anchorRect.right - gap - edgePad;
    const leftSpace = anchorRect.left - gap - edgePad;
    const nextPlacement =
      window.innerWidth < 1100 || (rightSpace < popupWidth && leftSpace < popupWidth)
        ? "below"
        : rightSpace >= popupWidth
          ? "right"
          : "left";

    if (nextPlacement === placement) return;

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setPlacement(nextPlacement);
    });
    return () => {
      cancelled = true;
    };
  }, [
    label,
    placement,
    posRangeLabel,
    tier.bountyEv,
    tier.cashEv,
    tier.field,
    tier.ev,
  ]);

  return (
    <div
      ref={popupRef}
      role="tooltip"
      className={`pointer-events-none z-50 rounded-md border-t-2 border-x border-b border-t-[color:var(--color-accent)] border-x-[color:var(--color-border-strong)] border-b-[color:var(--color-border-strong)] bg-[color:var(--color-bg-elev-2)] px-3 py-2.5 text-left text-[11px] leading-relaxed text-[color:var(--color-fg-muted)] shadow-[0_20px_40px_-12px_rgba(0,0,0,0.85)] ${
        placement === "below"
          ? "relative mt-2 w-full max-w-full overflow-x-hidden"
          : placement === "left"
            ? "absolute right-full top-0 mr-2 w-72 max-w-[85vw]"
            : "absolute left-full top-0 ml-2 w-72 max-w-[85vw]"
      }`}
      style={placement ? undefined : { visibility: "hidden" }}
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
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
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 text-[10px]">
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

export function fmtMoneyAbs(v: number): string {
  if (!Number.isFinite(v) || v < 0.005) return "$0";
  if (v < 1000) {
    const hasFraction = Math.abs(v - Math.round(v)) > 0.005;
    return `$${hasFraction ? v.toFixed(2) : Math.round(v).toString()}`;
  }
  return `$${Math.round(v).toLocaleString()}`;
}

export function EvBreakdownFooter({
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
    <div
      className={`mt-0.5 grid ${EV_BREAKDOWN_GRID} ${EV_BREAKDOWN_GAP} items-center border-t border-[color:var(--color-border)] pt-1.5 text-[10px] font-semibold sm:text-[11px]`}
    >
      <span />
      <span className="col-span-4 text-[9px] uppercase tracking-[0.12em] text-[color:var(--color-fg-dim)] sm:text-[10px]">
        {label}
      </span>
      <span
        className={`${EV_BREAKDOWN_NUM} text-[10px] text-[color:var(--color-fg-dim)]`}
        title="equilibrium (−rake)"
      >
        {eqNetDollars != null ? fmtSignedMoney(eqNetDollars) : ""}
      </span>
      <span className={`${EV_BREAKDOWN_NUM} ${netClass}`}>
        {fmtSignedMoney(netDollars)}
      </span>
    </div>
  );
}

export function fmtSignedMoney(v: number): string {
  if (!Number.isFinite(v) || Math.abs(v) < 0.005) return "$0";
  const sign = v < 0 ? "−" : "+";
  const abs = Math.abs(v);
  if (abs < 1000) {
    const hasFraction = Math.abs(abs - Math.round(abs)) > 0.005;
    return `${sign}$${hasFraction ? abs.toFixed(2) : Math.round(abs).toString()}`;
  }
  return `${sign}$${Math.round(abs).toLocaleString()}`;
}

function clampUnit(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export function pct(v: number): string {
  if (!(v > 0)) return "0%";
  if (v >= 0.1) return `${(v * 100).toFixed(0)}%`;
  if (v >= 0.01) return `${(v * 100).toFixed(1)}%`;
  if (v >= 0.0001) return `${(v * 100).toFixed(3)}%`;
  return `${(v * 100).toFixed(4)}%`;
}

export function evPct(v: number): string {
  const p = clampUnit(v) * 100;
  if (!(p > 0)) return "0.0%";
  if (p >= 1) return `${p.toFixed(1)}%`;
  if (p >= 0.1) return `${p.toFixed(2)}%`;
  return `${p.toFixed(3)}%`;
}

export function evPctInputValue(v: number): string {
  const p = clampUnit(v) * 100;
  if (!(p > 0)) return "0";
  return p >= 1 ? p.toFixed(1) : p.toFixed(3);
}

export const PREVIEW_SLIDER_CONTROL_CHROME =
  "flex h-11 items-center rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)]";
export const PREVIEW_SLIDER_VALUE_CHROME =
  PREVIEW_SLIDER_CONTROL_CHROME + " px-2.5";
export const PREVIEW_SLIDER_RESET_CHROME =
  PREVIEW_SLIDER_CONTROL_CHROME +
  " min-w-[5.75rem] justify-center px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--color-fg-dim)] transition hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-fg)] disabled:cursor-default disabled:opacity-40 disabled:hover:border-[color:var(--color-border)] disabled:hover:text-[color:var(--color-fg-dim)]";
export const PREVIEW_SLIDER_VALUE_INPUT =
  "h-full min-w-0 bg-transparent text-right font-mono font-semibold leading-none tabular-nums text-[color:var(--color-fg)] outline-none disabled:opacity-60";
export const PREVIEW_SLIDER_VALUE_SUFFIX =
  "ml-1 font-mono font-semibold leading-none text-[color:var(--color-fg-dim)]";
export const EV_BREAKDOWN_GRID =
  "grid-cols-[8px_minmax(4.5rem,0.95fr)_minmax(28px,1fr)_3.25rem_4.2rem_4.2rem_5rem] sm:grid-cols-[10px_minmax(5.75rem,1fr)_minmax(48px,1fr)_3.4rem_4.5rem_4.5rem_5.2rem]";
export const EV_BREAKDOWN_GAP = "gap-x-1 sm:gap-x-1.5";
export const EV_BREAKDOWN_NUM =
  "min-w-0 whitespace-nowrap text-right font-mono tabular-nums";

export function fmtEq(p: number): string {
  if (!(p > 0)) return "—";
  if (p >= 0.1) return `${(p * 100).toFixed(0)}%`;
  if (p >= 0.01) return `${(p * 100).toFixed(1)}%`;
  if (p >= 0.0001) return `${(p * 100).toFixed(3)}%`;
  return `${(p * 100).toFixed(4)}%`;
}

export function PreviewSplitStat({
  label,
  value,
  share,
  color,
  title,
}: {
  label: string;
  value: string;
  share: number;
  color: string;
  title?: string;
}) {
  return (
    <div
      className="w-full rounded-md border border-[color:var(--color-border)]/60 bg-[color:var(--color-bg)]/55 px-3 py-2.5 text-[11px] text-[color:var(--color-fg-dim)] shadow-sm sm:w-[15.5rem]"
      title={title}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 rounded-sm"
          style={{ background: color }}
        />
        <span className="truncate text-[13px] font-medium text-[color:var(--color-fg-dim)]">
          {label}
        </span>
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <span className="font-mono text-[15px] font-semibold tabular-nums text-[color:var(--color-fg)]">
          {value}
        </span>
        <span className="rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg-elev)] px-1.5 py-0.5 font-mono text-[12px] font-semibold tabular-nums text-[color:var(--color-fg)]">
          {evPct(share)}
        </span>
      </div>
    </div>
  );
}
