import type { ReactNode } from "react";

export type CashMoneyUnit = "bb" | "usd";
type ValueTone = "pos" | "neg";
export type StatRow = { label: string; value: string };
export type HeroStat = {
  accent: SuitAccent;
  label: string;
  value: string;
  sub: string;
  tone?: ValueTone;
};
export type SummaryStat = {
  accent: SuitAccent;
  label: string;
  value: string;
  tone?: ValueTone;
};

export type SuitAccent = "spade" | "heart" | "diamond" | "club";

export const CASH_ACCENT_META: Record<
  SuitAccent,
  {
    glyph: string;
    colorVar: string;
    chartStroke: string;
    chartFill: string;
    panelBorder: string;
    panelBg: string;
    badgeBg: string;
    badgeBorder: string;
  }
> = {
  spade: {
    glyph: "♠",
    colorVar: "var(--color-spade)",
    chartStroke: "#83b7ff",
    chartFill: "rgba(131,183,255,0.24)",
    panelBorder:
      "color-mix(in oklab, var(--color-rival), var(--color-border) 56%)",
    panelBg:
      "linear-gradient(180deg, color-mix(in oklab, var(--color-bg-elev), var(--color-rival) 8%) 0%, color-mix(in oklab, var(--color-bg-elev), black 8%) 100%)",
    badgeBg: "color-mix(in oklab, var(--color-rival), transparent 88%)",
    badgeBorder:
      "color-mix(in oklab, var(--color-rival), var(--color-border) 42%)",
  },
  heart: {
    glyph: "♥",
    colorVar: "var(--color-heart)",
    chartStroke: "#ff9176",
    chartFill: "rgba(255,145,118,0.23)",
    panelBorder:
      "color-mix(in oklab, var(--color-heart), var(--color-border) 56%)",
    panelBg:
      "linear-gradient(180deg, color-mix(in oklab, var(--color-bg-elev), var(--color-heart) 8%) 0%, color-mix(in oklab, var(--color-bg-elev), black 8%) 100%)",
    badgeBg: "color-mix(in oklab, var(--color-heart), transparent 88%)",
    badgeBorder:
      "color-mix(in oklab, var(--color-heart), var(--color-border) 42%)",
  },
  diamond: {
    glyph: "♦",
    colorVar: "var(--color-diamond)",
    chartStroke: "#f2cf45",
    chartFill: "rgba(242,207,69,0.24)",
    panelBorder:
      "color-mix(in oklab, var(--color-diamond), var(--color-border) 52%)",
    panelBg:
      "linear-gradient(180deg, color-mix(in oklab, var(--color-bg-elev), var(--color-diamond) 8%) 0%, color-mix(in oklab, var(--color-bg-elev), black 8%) 100%)",
    badgeBg: "color-mix(in oklab, var(--color-diamond), transparent 87%)",
    badgeBorder:
      "color-mix(in oklab, var(--color-diamond), var(--color-border) 40%)",
  },
  club: {
    glyph: "♣",
    colorVar: "var(--color-club)",
    chartStroke: "#7ccd96",
    chartFill: "rgba(124,205,150,0.23)",
    panelBorder:
      "color-mix(in oklab, var(--color-club), var(--color-border) 54%)",
    panelBg:
      "linear-gradient(180deg, color-mix(in oklab, var(--color-bg-elev), var(--color-club) 8%) 0%, color-mix(in oklab, var(--color-bg-elev), black 8%) 100%)",
    badgeBg: "color-mix(in oklab, var(--color-club), transparent 88%)",
    badgeBorder:
      "color-mix(in oklab, var(--color-club), var(--color-border) 42%)",
  },
};

export function CashChartFrame({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-sm border border-[color:var(--color-border)]/70 bg-[color:var(--color-bg)]/42 px-2 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] sm:px-3">
      {children}
    </div>
  );
}

export function ChartTitle({
  suit,
  title,
  note,
}: {
  suit: SuitAccent;
  title: string;
  note?: string;
}) {
  const accent = CASH_ACCENT_META[suit];
  return (
    <div className="mb-3 flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <span
          className="inline-flex h-6 w-6 items-center justify-center rounded-sm border text-[12px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
          style={{
            color: accent.colorVar,
            borderColor: accent.badgeBorder,
            background: accent.badgeBg,
          }}
        >
          {accent.glyph}
        </span>
        <h3 className="text-sm font-bold uppercase tracking-wide text-[color:var(--color-fg)]">
          <span className="mr-2 hidden text-[color:var(--color-fg-dim)] sm:inline">
            {accent.glyph}
          </span>
          {title}
        </h3>
      </div>
      {note && (
        <p className="max-w-3xl text-[11.5px] leading-relaxed text-[color:var(--color-fg-muted)]">
          {note}
        </p>
      )}
    </div>
  );
}

export function MiniChartTitle({
  suit,
  title,
  note,
}: {
  suit: SuitAccent;
  title: string;
  note?: string;
}) {
  const meta = CASH_ACCENT_META[suit];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-sm border text-[10px]"
          style={{
            color: meta.colorVar,
            borderColor: meta.badgeBorder,
            background: meta.badgeBg,
          }}
        >
          {meta.glyph}
        </span>
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--color-fg)]">
          {title}
        </h4>
      </div>
      {note && (
        <p className="text-[10.5px] leading-relaxed text-[color:var(--color-fg-muted)]">
          {note}
        </p>
      )}
    </div>
  );
}

export function HeroGrid({
  items,
}: {
  items: HeroStat[];
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
      {items.map((item) => (
        <HeroCard key={item.label} {...item} />
      ))}
    </div>
  );
}

function HeroCard({
  accent,
  label,
  value,
  sub,
  tone,
}: HeroStat) {
  const meta = CASH_ACCENT_META[accent];
  const toneClass =
    tone === "neg"
      ? "text-[color:var(--color-heart)]"
      : tone === "pos"
        ? "text-[color:var(--color-club)]"
        : "text-[color:var(--color-fg)]";
  return (
    <div
      className="data-surface-card flex h-full flex-col gap-3 rounded-sm border p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]"
      style={{
        borderColor: meta.panelBorder,
        background: meta.panelBg,
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-sm border text-[10px]"
          style={{
            color: meta.colorVar,
            borderColor: meta.badgeBorder,
            background: meta.badgeBg,
          }}
        >
          {meta.glyph}
        </span>
        <span className="eyebrow text-[10px] tracking-[0.14em] text-[color:var(--color-fg-muted)]">
          {label}
        </span>
      </div>
      <div className={`font-mono text-[26px] font-semibold leading-none ${toneClass}`}>
        {value}
      </div>
      <p className="text-[11px] leading-relaxed text-[color:var(--color-fg-muted)]">
        {sub}
      </p>
    </div>
  );
}

export function SummaryStrip({
  items,
}: {
  items: SummaryStat[];
}) {
  return (
    <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
      {items.map((item) => (
        <SummaryPill key={item.label} {...item} />
      ))}
    </div>
  );
}

function SummaryPill({
  accent,
  label,
  value,
  tone,
}: SummaryStat) {
  const meta = CASH_ACCENT_META[accent];
  const toneClass =
    tone === "neg"
      ? "text-[color:var(--color-heart)]"
      : tone === "pos"
        ? "text-[color:var(--color-club)]"
        : "text-[color:var(--color-fg)]";
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-sm border px-3 py-2.5"
      style={{
        borderColor: meta.badgeBorder,
        background: meta.badgeBg,
      }}
    >
      <span className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fg-muted)]">
        {label}
      </span>
      <span className={`font-mono text-[13px] font-semibold tabular-nums ${toneClass}`}>
        {value}
      </span>
    </div>
  );
}

export function DetailList({
  rows,
  accent,
}: {
  rows: StatRow[];
  accent: SuitAccent;
}) {
  const meta = CASH_ACCENT_META[accent];
  return (
    <div
      className="flex h-full flex-col gap-3 rounded-sm border p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
      style={{
        borderColor: meta.panelBorder,
        background: meta.panelBg,
      }}
    >
      <dl className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-start justify-between gap-4 border-b border-[color:var(--color-border)]/35 pb-2 last:border-b-0 last:pb-0"
          >
            <dt className="max-w-[58%] text-[11px] leading-relaxed text-[color:var(--color-fg-muted)]">
              {r.label}
            </dt>
            <dd className="text-right font-mono text-[15px] font-semibold tabular-nums leading-none text-[color:var(--color-fg)]">
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function MixTag({
  accent,
  children,
}: {
  accent: SuitAccent;
  children: ReactNode;
}) {
  const meta = CASH_ACCENT_META[accent];
  return (
    <span
      className="rounded-sm border px-2 py-1 font-mono text-[10px] tabular-nums"
      style={{
        borderColor: meta.badgeBorder,
        background: meta.badgeBg,
        color: meta.colorVar,
      }}
    >
      {children}
    </span>
  );
}

export function MixMetricBar({
  accent,
  label,
  share,
  detail,
}: {
  accent: SuitAccent;
  label: string;
  share: number;
  detail: string;
}) {
  const meta = CASH_ACCENT_META[accent];
  const clampedShare = Math.max(0, Math.min(share, 1));
  return (
    <div className="flex flex-col gap-1.5 rounded-sm border border-[color:var(--color-border)]/65 bg-[color:var(--color-bg)]/55 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fg-muted)]">
          {label}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-[color:var(--color-fg-muted)]">
          {detail}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[color:var(--color-bg-elev-2)]/90">
        <div
          className="h-full rounded-full transition-[width] duration-200"
          style={{
            width: `${clampedShare * 100}%`,
            background: meta.chartStroke,
            boxShadow: `0 0 0 1px ${meta.badgeBorder} inset`,
          }}
        />
      </div>
    </div>
  );
}

export function UnitToggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex items-center rounded-sm border border-[color:var(--color-border)]/70 bg-[color:var(--color-bg)]/55 p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-sm px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              active
                ? "bg-[color:var(--color-accent)]/18 text-[color:var(--color-accent)]"
                : "text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)]"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function convertCashMoney(
  valueBb: number,
  unit: CashMoneyUnit,
  bbSize: number,
): number {
  return unit === "usd" ? valueBb * bbSize : valueBb;
}

export function formatCashMoney(
  valueBb: number,
  unit: CashMoneyUnit,
  bbSize: number,
): string {
  const value = convertCashMoney(valueBb, unit, bbSize);
  const abs = Math.abs(value);
  const digits = unit === "usd" ? (abs >= 100 ? 0 : abs >= 10 ? 1 : 2) : 1;
  const formatted = abs.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
  if (unit === "usd") return `${value < 0 ? "-" : ""}$${formatted}`;
  return `${value < 0 ? "-" : ""}${formatted} BB`;
}

export function formatUsdRate(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  const formatted = abs.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
  return `${value < 0 ? "-" : ""}$${formatted}/h`;
}

export function formatCashPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatSignedBb100(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 || Number.isInteger(abs) ? 0 : 1;
  const formatted = abs.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
  return `${value < 0 ? "-" : "+"}${formatted}`;
}

export function formatUnsignedBb100(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 || Number.isInteger(abs) ? 0 : 1;
  return abs.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

export function formatUsdBbSize(value: number): string {
  const digits = value >= 10 ? 0 : value >= 1 ? 2 : 3;
  const formatted = value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits >= 2 ? 2 : 0,
  });
  return `$${formatted} BB`;
}

export function formatRiskThresholdBb(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 || Number.isInteger(abs) ? 0 : 1;
  const formatted = abs.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
  return `−${formatted} BB`;
}

export function formatRiskThreshold(
  valueBb: number,
  unit: CashMoneyUnit,
  bbSize: number,
): string {
  if (unit === "bb") return formatRiskThresholdBb(valueBb);
  const abs = Math.abs(valueBb * bbSize);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  const formatted = abs.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
  return `−$${formatted}`;
}

export function scaleMoneyHistogram(
  hist: { binEdges: number[]; counts: number[] },
  unit: CashMoneyUnit,
  bbSize: number,
): { binEdges: number[]; counts: number[] } {
  if (unit === "bb") return hist;
  return {
    binEdges: hist.binEdges.map((edge) => edge * bbSize),
    counts: hist.counts,
  };
}
