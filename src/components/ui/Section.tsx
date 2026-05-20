import type { CSSProperties, ReactNode } from "react";

type Suit = "spade" | "heart" | "diamond" | "club";

const SUIT_META: Record<
  Suit,
  { glyph: string; colorVar: string }
> = {
  spade: { glyph: "♠", colorVar: "var(--color-spade)" },
  heart: { glyph: "♥", colorVar: "var(--color-heart)" },
  diamond: { glyph: "♦", colorVar: "var(--color-diamond)" },
  club: { glyph: "♣", colorVar: "var(--color-club)" },
};

interface Props {
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
  /** Editorial section number — rendered as big mono numeral in the gutter. */
  number?: string;
  /** Suit accent — drives the color of the number, eyebrow, and underline. */
  suit?: Suit;
  /** Optional DOM id on the section wrapper for scroll-into-view anchors. */
  anchorId?: string;
}

export function Section({
  title,
  subtitle,
  children,
  actions,
  number,
  suit = "club",
  anchorId,
}: Props) {
  const meta = SUIT_META[suit];
  const headerStyle = {
    "--section-accent": meta.colorVar,
    background:
      "linear-gradient(135deg, color-mix(in oklab, var(--c-bg-elev-2) 86%, transparent), color-mix(in oklab, var(--c-bg) 72%, transparent))",
  } as CSSProperties;

  return (
    <section id={anchorId} className="flex flex-col gap-4 scroll-mt-24">
      <header
        className="relative isolate flex min-w-0 flex-wrap items-stretch justify-between overflow-hidden rounded-xl border border-[color:var(--color-border)] shadow-[inset_0_1px_0_rgba(255,255,255,0.055),0_12px_34px_rgba(0,0,0,0.16)]"
        style={headerStyle}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--section-accent),color-mix(in_srgb,var(--section-accent)_18%,transparent),transparent)] opacity-80"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-[color:var(--section-accent)] opacity-90"
        />

        <div className="flex min-w-0 flex-1 items-stretch">
          {number && (
            <div className="relative flex w-[6.5rem] shrink-0 items-center justify-center pl-3 pr-4 sm:w-[8rem] sm:pl-4 sm:pr-5">
              <span
                className="section-num text-[48px] tabular-nums sm:text-[58px]"
                aria-hidden
              >
                {number}
              </span>
              <span
                aria-hidden
                className="absolute right-0 top-1/2 h-14 w-px -translate-y-1/2 bg-[linear-gradient(180deg,transparent,color-mix(in_srgb,var(--section-accent)_54%,var(--color-border-strong)),transparent)]"
              />
            </div>
          )}

          <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-4 sm:gap-4 sm:px-5">
            <div className="relative hidden h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-[color:var(--color-border-strong)]/80 bg-[color:var(--color-bg)]/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_0_0_1px_color-mix(in_srgb,var(--section-accent)_9%,transparent)] sm:flex">
              <span
                aria-hidden
                className="text-[23px] font-black leading-none text-[color:var(--section-accent)] drop-shadow-[0_0_14px_color-mix(in_srgb,var(--section-accent)_28%,transparent)]"
              >
                {meta.glyph}
              </span>
              <span
                aria-hidden
                className="absolute -bottom-1 left-1/2 h-[3px] w-7 -translate-x-1/2 rounded-full bg-[color:var(--section-accent)]"
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  aria-hidden
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[color:var(--color-border-strong)]/75 bg-[color:var(--color-bg)]/55 text-[15px] font-black leading-none text-[color:var(--section-accent)] sm:hidden"
                >
                  {meta.glyph}
                </span>
                <h2 className="min-w-0 text-[21px] font-black uppercase leading-none tracking-[0.105em] text-[color:var(--color-fg)] sm:text-[28px]">
                  {title}
                </h2>
              </div>
              {subtitle && (
                <p className="mt-2 max-w-[72rem] text-[13px] leading-relaxed text-[color:var(--color-fg-muted)] sm:text-sm">
                  {subtitle}
                </p>
              )}
              <div className="mt-3 flex max-w-[24rem] items-center gap-3">
                <span className="h-[4px] w-[min(10rem,42%)] shrink-0 rounded-full bg-[color:var(--section-accent)] shadow-[0_0_22px_color-mix(in_srgb,var(--section-accent)_30%,transparent)]" />
                <span className="h-[2px] min-w-12 flex-1 rounded-full bg-[color:var(--section-accent)] opacity-30" />
              </div>
            </div>
          </div>
        </div>

        {actions && (
          <div className="flex min-w-0 items-center px-4 py-3">{actions}</div>
        )}
      </header>
      {children}
    </section>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        "relative min-w-0 border-t-[2px] border-x border-b border-t-[color:var(--color-fg)]/70 border-x-[color:var(--color-border)] border-b-[color:var(--color-border)] bg-[color:var(--color-bg-elev)]/60 " +
        className
      }
    >
      {children}
    </div>
  );
}
